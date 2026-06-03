const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../utils/constants');
const { formatNumber } = require('../utils/helpers');
const { getMenuImage } = require('../utils/image-helper');

/**
 * World Menu — Bí Cảnh, Khoáng Mạch, Tụ Bảo Các, NPC, Bắt Linh Thú
 */
async function showWorldMenu(interaction, player) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🌍 Thế Giới Tu Tiên')
    .setDescription(
      `**${player.name}** đang khám phá thế giới tu tiên.\n\n` +
      `Chọn nơi bạn muốn đến:`
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('world:secretrealm')
      .setLabel('🗺️ Bí Cảnh')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('world:mine')
      .setLabel('⛏️ Khoáng Mạch')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('world:shop')
      .setLabel('🏪 Tụ Bảo Các')
      .setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('world:npc')
      .setLabel('🧑 NPC')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('world:catchpet')
      .setLabel('🐾 Bắt Linh Thú')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('world');
  const updatePayload = { embeds: [embed], components: [row1, row2] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

/**
 * Mining system
 */
async function handleMining(interaction, player) {
  const db = require('../database/connection');
  const miningConfig = require('../../config/mining');
  const { formatTime, chance, randomInt } = require('../utils/helpers');
  const { COOLDOWNS } = require('../utils/constants');

  // Check cooldown
  const cooldown = db.prepare(
    "SELECT * FROM cooldowns WHERE player_id = ? AND action_type = 'mine'"
  ).get(player.id);

  if (cooldown && Date.now() < cooldown.expires_at) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⏳ Đang Nghỉ Ngơi')
      .setDescription(`Cần chờ **${formatTime(cooldown.expires_at - Date.now())}** để khai khoáng tiếp.`);
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('world:menu').setLabel('🔙 Quay Lại').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Get available mines based on realm
  const availableMines = miningConfig.list.filter(m => m.min_realm <= player.realm_index);
  if (availableMines.length === 0) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(COLORS.error).setDescription('Không có mỏ phù hợp.')],
      components: []
    });
  }

  // Check for mining tool (Cuốc Khai Khoáng)
  const pickaxe = db.prepare(
    "SELECT quantity FROM inventory WHERE player_id = ? AND item_id = 'cuoc_khai_khoang'"
  ).get(player.id);
  const hasPickaxe = pickaxe && pickaxe.quantity > 0;

  // Pick random mine
  const mine = availableMines[Math.floor(Math.random() * availableMines.length)];

  // Mine resources
  const rewards = [];
  const itemsConfig = require('../../config/items');
  for (const resource of mine.resources) {
    if (Math.random() < (resource.chance || 0.5)) {
      let qty = randomInt(resource.min_amount || 1, resource.max_amount || 3);
      if (hasPickaxe) {
        qty = Math.round(qty * 1.5);
      }
      const itemCfg = itemsConfig.getItemById(resource.item_id);
      const displayName = itemCfg ? `${itemCfg.emoji} ${itemCfg.name}` : resource.item_id;
      rewards.push({ id: resource.item_id, name: displayName, qty });

      // Add to inventory
      const existing = db.prepare('SELECT * FROM inventory WHERE player_id = ? AND item_id = ?').get(player.id, resource.item_id);
      if (existing) {
        db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE player_id = ? AND item_id = ?').run(qty, player.id, resource.item_id);
      } else {
        db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run(player.id, resource.item_id, qty);
      }
    }
  }

  // Bonus Linh Thạch
  let linhThach = randomInt(10, 30) * (player.realm_index + 1);
  if (hasPickaxe) {
    linhThach = Math.round(linhThach * 1.5);
  }
  db.prepare('UPDATE players SET linh_thach = linh_thach + ? WHERE id = ?').run(linhThach, player.id);

  // Set cooldown
  const expiresAt = Date.now() + COOLDOWNS.mine;
  db.prepare(
    "INSERT OR REPLACE INTO cooldowns (player_id, action_type, expires_at) VALUES (?, 'mine', ?)"
  ).run(player.id, expiresAt);

  const rewardText = rewards.length > 0
    ? rewards.map(r => `  ${r.name} ×${r.qty}`).join('\n')
    : '  _Không tìm thấy gì đặc biệt_';

  let description = `**${player.name}** đào được:\n\n` +
    `${rewardText}\n` +
    `💎 Linh Thạch: +**${formatNumber(linhThach)}**\n\n`;

  if (hasPickaxe) {
    description += `⛏️ *Nhờ sử dụng Cuốc Khai Khoáng, sản lượng và linh thạch tăng 50%!*\n\n`;
  }

  description += `⏳ Cooldown: **${formatTime(COOLDOWNS.mine)}**`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`⛏️ Khai Khoáng — ${mine.emoji} ${mine.name}`)
    .setDescription(description)
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('world:menu').setLabel('🌍 Thế Giới').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

module.exports = {
  showWorldMenu,
  handleMining,
};
