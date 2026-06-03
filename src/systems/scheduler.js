/**
 * @file Background Scheduler System
 * @description Quản lý các tác vụ nền tự động: hết hạn đấu giá và quá hạn yêu cầu giao dịch.
 */

const db = require('../database/connection');
const logger = require('../utils/logger');
const itemsConfig = require('../../config/items');
const { checkDespawn, getActiveRaid } = require('./world-boss');

// Prepared statements cho Đấu Giá Hết Hạn
const stmtGetExpiredListings = db.prepare(`
  SELECT al.*, p.discord_id, p.name as seller_name
  FROM auction_listings al
  JOIN players p ON al.seller_id = p.id
  WHERE datetime(al.created_at) < datetime('now', '-24 hours')
`);

const stmtGetInvItem = db.prepare('SELECT quantity FROM inventory WHERE player_id = ? AND item_id = ?');
const stmtAddInvItem = db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)');
const stmtUpdateInvItem = db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE player_id = ? AND item_id = ?');
const stmtDeleteListing = db.prepare('DELETE FROM auction_listings WHERE id = ?');

// Prepared statements cho Giao Dịch Hết Hạn
const stmtGetExpiredTrades = db.prepare(`
  SELECT t.*, sp.name as sender_name, rp.name as receiver_name
  FROM player_trades t
  JOIN players sp ON t.sender_id = sp.id
  JOIN players rp ON t.receiver_id = rp.id
  WHERE t.status = 'pending' AND datetime(t.created_at) < datetime('now', '-5 minutes')
`);
const stmtUpdateTradeStatus = db.prepare("UPDATE player_trades SET status = 'rejected' WHERE id = ?");

/**
 * Xử lý hết hạn các tin đăng đấu giá (Tụ Bảo Các) sau 24h
 */
async function expireAuctionListings(client) {
  try {
    const expiredListings = stmtGetExpiredListings.all();
    if (expiredListings.length === 0) return;

    logger.info(`[Scheduler] Phát hiện ${expiredListings.length} tin đấu giá hết hạn.`);

    for (const listing of expiredListings) {
      // Bắt đầu transaction hoàn trả đồ và xóa tin đăng
      const refundTx = db.transaction(() => {
        const existing = stmtGetInvItem.get(listing.seller_id, listing.item_id);
        if (existing) {
          stmtUpdateInvItem.run(listing.quantity, listing.seller_id, listing.item_id);
        } else {
          stmtAddInvItem.run(listing.seller_id, listing.item_id, listing.quantity);
        }
        stmtDeleteListing.run(listing.id);
      });

      try {
        refundTx();
        logger.info(`[Scheduler] Đã hoàn trả vật phẩm [${listing.item_id}] (x${listing.quantity}) cho seller ID ${listing.seller_id} do hết hạn đấu giá.`);

        // Gửi DM thông báo nếu client được truyền vào
        if (client && listing.discord_id) {
          try {
            const user = await client.users.fetch(listing.discord_id);
            if (user) {
              const itemCfg = itemsConfig.getItemById(listing.item_id) || require('../../config/equipment').getEquipmentById(listing.item_id) || require('../../config/equipment').getById(listing.item_id);
              const itemName = itemCfg ? itemCfg.name : listing.item_id;
              const emoji = itemCfg ? itemCfg.emoji : '📦';
              await user.send(
                `🔔 **[Tụ Bảo Các] Thông Báo Hết Hạn Ký Gửi**\n` +
                `Bảo vật **${emoji} ${itemName}** (x${listing.quantity}) của đạo hữu ký gửi đấu giá quá 24h không có ai mua.\n` +
                `Hệ thống đã tự động thu hồi và hoàn trả vật phẩm về hành trang.`
              );
            }
          } catch (dmErr) {
            logger.debug(`Không gửi được DM thông báo hết hạn cho user ${listing.discord_id}: ${dmErr.message}`);
          }
        }
      } catch (err) {
        logger.error(`[Scheduler] Lỗi khi xử lý hoàn trả đấu giá hết hạn #${listing.id}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('[Scheduler] Lỗi trong quá trình quét hết hạn đấu giá:', err.message);
  }
}

/**
 * Xử lý hết hạn các yêu cầu giao dịch trực tiếp (P2P) sau 5 phút
 */
async function timeoutTradeRequests(client) {
  try {
    const expiredTrades = stmtGetExpiredTrades.all();
    if (expiredTrades.length === 0) return;

    logger.info(`[Scheduler] Phát hiện ${expiredTrades.length} yêu cầu giao dịch trực tiếp quá hạn.`);

    for (const trade of expiredTrades) {
      try {
        // Cập nhật trạng thái trong database
        stmtUpdateTradeStatus.run(trade.id);
        logger.info(`[Scheduler] Giao dịch #${trade.id} giữa ${trade.sender_name} và ${trade.receiver_name} đã quá hạn.`);

        // Cập nhật tin nhắn Discord nếu có thông tin message_id và channel_id
        if (client && trade.channel_id && trade.message_id) {
          try {
            const channel = await client.channels.fetch(trade.channel_id);
            if (channel) {
              const message = await channel.messages.fetch(trade.message_id);
              if (message) {
                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                
                // Disable các nút
                const disabledRow = new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId('dummy_accept').setLabel('Đồng Ý').setStyle(ButtonStyle.Success).setDisabled(true),
                  new ButtonBuilder().setCustomId('dummy_reject').setLabel('Từ Chối (Đã Hết Hạn)').setStyle(ButtonStyle.Danger).setDisabled(true)
                );

                const embed = EmbedBuilder.from(message.embeds[0])
                  .setColor(0xe74c3c) // Đỏ cho quá hạn
                  .setTitle('❌ GIAO DỊCH QUÁ HẠN ❌')
                  .setDescription(`Yêu cầu giao dịch giữa **${trade.sender_name}** và **${trade.receiver_name}** đã tự động bị hủy do quá hạn 5 phút.`);

                await message.edit({ embeds: [embed], components: [disabledRow] });
              }
            }
          } catch (discordErr) {
            logger.debug(`Không thể cập nhật tin nhắn giao dịch hết hạn #${trade.id} trên Discord: ${discordErr.message}`);
          }
        }
      } catch (err) {
        logger.error(`[Scheduler] Lỗi khi xử lý quá hạn giao dịch #${trade.id}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('[Scheduler] Lỗi trong quá trình quét quá hạn giao dịch:', err.message);
  }
}

/**
 * Kiểm tra World Boss despawn (gọi mỗi 60s)
 */
async function checkWorldBossDespawn(client) {
  try {
    const despawnResult = checkDespawn();
    if (despawnResult) {
      logger.info(`[Scheduler] World Boss ${despawnResult.bossName} đã biến mất (hết thời gian).`);

      // Thông báo trên channel
      if (client && despawnResult.channelId) {
        try {
          const { EmbedBuilder } = require('discord.js');
          const channel = await client.channels.fetch(despawnResult.channelId);
          if (channel) {
            const hpPercent = Math.floor((despawnResult.currentHp / despawnResult.maxHp) * 100);
            const embed = new EmbedBuilder()
              .setColor('#666666')
              .setTitle(`${despawnResult.bossEmoji} WORLD BOSS ĐÃ BIẾN MẤT!`)
              .setDescription(
                `**${despawnResult.bossName}** đã rời đi sau 60 phút!\n\n` +
                `❤️ HP còn lại: **${hpPercent}%**\n` +
                `👥 Số người tham gia: **${despawnResult.participantCount}**\n\n` +
                `_Boss sẽ xuất hiện lại sau..._`
              )
              .setTimestamp();
            await channel.send({ embeds: [embed] });
          }
        } catch (discordErr) {
          logger.debug(`[Scheduler] Không gửi được thông báo despawn: ${discordErr.message}`);
        }
      }
    }
  } catch (err) {
    logger.error('[Scheduler] Lỗi kiểm tra World Boss despawn:', err.message);
  }
}

/**
 * Khởi chạy Scheduler nền
 */
function startScheduler(client) {
  logger.info('✦ Đang khởi chạy hệ thống tác vụ nền (Scheduler)...');
  
  // Chạy ngay lần đầu
  expireAuctionListings(client);
  timeoutTradeRequests(client);
  checkWorldBossDespawn(client);

  // Lặp lại mỗi 60 giây
  const intervalId = setInterval(() => {
    expireAuctionListings(client);
    timeoutTradeRequests(client);
    checkWorldBossDespawn(client);
  }, 60000);

  // Trả về intervalId để phục vụ clear khi cần (ví dụ khi tắt bot hoặc chạy unit test)
  return intervalId;
}

module.exports = {
  expireAuctionListings,
  timeoutTradeRequests,
  checkWorldBossDespawn,
  startScheduler
};
