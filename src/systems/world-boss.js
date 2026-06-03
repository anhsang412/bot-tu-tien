/**
 * @file World Boss Raid System
 * @description Hệ thống World Boss Raid - nhiều người chơi hợp lực đánh boss
 *
 * State machine:
 *   INACTIVE → SPAWNING → ACTIVE → DEFEATED/DESPAWNED → INACTIVE
 *
 * Features:
 *   - Boss spawn định kỳ mỗi 4 giờ (configurable)
 *   - Nhiều player tham gia, mỗi người tấn công riêng
 *   - HP pool chung, theo dõi damage contribution
 *   - Phase transitions (3 giai đoạn)
 *   - Phần thưởng dựa trên % đóng góp
 *   - Tự động despawn sau 60 phút
 */

const db = require('../database/connection');
const logger = require('../utils/logger');
const monstersConfig = require('../../config/monsters');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getMonsterImagePath } = require('../../config/monster-images');
const { COLORS } = require('../utils/constants');

// ═══════════════════════════════════════════
//  IN-MEMORY RAID STATE
// ═══════════════════════════════════════════

let activeRaid = null;

// Cooldown tracker: playerId -> timestamp of last attack
const attackCooldowns = new Map();

// Cooldown duration (ms)
const ATTACK_COOLDOWN = 60 * 1000; // 60 giây

/**
 * Lấy raid đang hoạt động
 * @returns {Object|null}
 */
function getActiveRaid() {
  return activeRaid;
}

// ═══════════════════════════════════════════
//  SPAWN WORLD BOSS
// ═══════════════════════════════════════════

/**
 * Spawn World Boss vào channel
 * @param {import('discord.js').Client} client - Discord client
 * @param {string} channelId - Channel ID để announce
 * @returns {Object|null} activeRaid hoặc null
 */
function spawnWorldBoss(client, channelId) {
  // Nếu đã có raid đang chạy, không spawn thêm
  if (activeRaid && activeRaid.status === 'active') {
    logger.warn('[WorldBoss] Đã có World Boss đang hoạt động, bỏ qua spawn.');
    return null;
  }

  const bosses = monstersConfig.getWorldBosses();
  if (bosses.length === 0) {
    logger.warn('[WorldBoss] Không tìm thấy config World Boss.');
    return null;
  }

  const boss = bosses[0]; // Thiên Ma Đại Đế

  activeRaid = {
    bossId: boss.id,
    bossName: boss.name,
    bossEmoji: boss.emoji,
    maxHp: boss.hp,
    currentHp: boss.hp,
    atk: boss.atk,
    def: boss.def,
    speed: boss.speed,
    participants: new Map(), // playerId -> { name, totalDamage, attacks }
    spawnedAt: Date.now(),
    channelId: channelId,
    phase: 1,
    status: 'active', // active, defeated, despawned
  };

  // Lưu vào database
  try {
    db.prepare(`INSERT INTO world_boss_raids (boss_id, boss_name, max_hp, current_hp, channel_id, status, spawned_at)
      VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))`)
      .run(boss.id, boss.name, boss.hp, boss.hp, channelId);
  } catch (err) {
    logger.error('[WorldBoss] Lỗi lưu raid vào DB:', err.message);
  }

  // Announce
  announceRaid(client, channelId, boss);

  logger.info(`[WorldBoss] ✦ ${boss.name} đã xuất hiện tại channel ${channelId}!`);
  return activeRaid;
}

// ═══════════════════════════════════════════
//  ANNOUNCE RAID
// ═══════════════════════════════════════════

/**
 * Gửi thông báo World Boss vào channel
 * @param {import('discord.js').Client} client
 * @param {string} channelId
 * @param {Object} boss - Boss config
 */
async function announceRaid(client, channelId, boss) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      logger.warn('[WorldBoss] Không tìm thấy channel:', channelId);
      return;
    }

    const imgPath = getMonsterImagePath(boss.id);

    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle(`👿 WORLD BOSS XUẤT HIỆN!`)
      .setDescription(
        `## ${boss.emoji} ${boss.name}\n\n` +
        `❤️ HP: **${formatNumber(boss.hp)}**\n` +
        `⚔️ ATK: **${formatNumber(boss.atk)}** | 🛡️ DEF: **${formatNumber(boss.def)}**\n\n` +
        `⏰ Thời gian: **60 phút**\n` +
        `👥 Tất cả tu sĩ hãy hợp lực tiêu diệt!\n\n` +
        `_${boss.description}_`
      )
      .setTimestamp();

    let files = [];
    if (imgPath) {
      const attachment = new AttachmentBuilder(imgPath, { name: 'boss.png' });
      files = [attachment];
      embed.setImage('attachment://boss.png');
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('worldboss:join')
        .setLabel('⚔️ Tham Gia Raid')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('worldboss:status')
        .setLabel('📊 Xem Trạng Thái')
        .setStyle(ButtonStyle.Primary),
    );

    await channel.send({ embeds: [embed], components: [row], files });
  } catch (err) {
    logger.error('[WorldBoss] Lỗi announce world boss:', err.message);
  }
}

// ═══════════════════════════════════════════
//  ATTACK BOSS
// ═══════════════════════════════════════════

/**
 * Player tấn công World Boss (3 lượt đánh + boss phản công 1 lượt)
 * @param {Object} player - { id, name, atk, def, hp, max_hp }
 * @returns {Object} Kết quả tấn công
 */
function attackBoss(player) {
  if (!activeRaid || activeRaid.status !== 'active') {
    return { error: 'Không có World Boss đang hoạt động!' };
  }
  if (activeRaid.currentHp <= 0) {
    return { error: 'World Boss đã bị tiêu diệt!' };
  }

  // Kiểm tra cooldown
  const lastAttack = attackCooldowns.get(player.id);
  if (lastAttack) {
    const elapsed = Date.now() - lastAttack;
    if (elapsed < ATTACK_COOLDOWN) {
      const remaining = Math.ceil((ATTACK_COOLDOWN - elapsed) / 1000);
      return { error: `Cần chờ **${remaining}** giây nữa để tấn công tiếp!`, cooldown: true, remaining };
    }
  }

  // Đặt cooldown
  attackCooldowns.set(player.id, Date.now());

  // Calculate damage dựa trên player stats vs boss DEF
  const playerAtk = player.atk || 10;
  const bossDef = activeRaid.def;

  // 3 lượt player tấn công
  let totalDamage = 0;
  const log = [];

  for (let i = 1; i <= 3; i++) {
    const variance = Math.floor(Math.random() * 11) - 5;
    let dmg = Math.max(1, Math.floor(playerAtk * 1.5 - bossDef * 0.3 + variance));

    // Crit chance 15%
    const isCrit = Math.random() < 0.15;
    if (isCrit) dmg = Math.floor(dmg * 1.5);

    totalDamage += dmg;
    log.push(`  Lượt ${i}: ${isCrit ? '💥 BẠO KÍCH! ' : '⚔️ '}Gây **${formatNumber(dmg)}** sát thương`);
  }

  // Boss phản công (1 lượt)
  const bossAtk = activeRaid.atk;
  const playerDef = player.def || 5;
  const bossDmg = Math.max(1, Math.floor(bossAtk * 0.5 - playerDef * 0.3 + Math.floor(Math.random() * 11) - 5));
  log.push(`  ${activeRaid.bossEmoji} ${activeRaid.bossName} phản công gây **${formatNumber(bossDmg)}** sát thương cho bạn!`);

  // Áp dụng damage lên boss
  activeRaid.currentHp = Math.max(0, activeRaid.currentHp - totalDamage);

  // Theo dõi đóng góp
  const existing = activeRaid.participants.get(player.id);
  if (existing) {
    existing.totalDamage += totalDamage;
    existing.attacks += 1;
  } else {
    activeRaid.participants.set(player.id, {
      name: player.name,
      totalDamage: totalDamage,
      attacks: 1,
    });
  }

  // Cập nhật DB
  try {
    db.prepare("UPDATE world_boss_raids SET current_hp = ? WHERE status = 'active' AND boss_id = ?")
      .run(activeRaid.currentHp, activeRaid.bossId);
  } catch (err) {
    logger.error('[WorldBoss] Lỗi cập nhật HP boss:', err.message);
  }

  // Phase transitions
  const hpRatio = activeRaid.currentHp / activeRaid.maxHp;
  if (hpRatio <= 0.4 && activeRaid.phase < 3) {
    activeRaid.phase = 3;
    activeRaid.atk = Math.floor(activeRaid.atk * 1.3);
    log.push(`\n⚡ **${activeRaid.bossName} chuyển sang Giai Đoạn 3!** ATK tăng mạnh!`);
  } else if (hpRatio <= 0.7 && activeRaid.phase < 2) {
    activeRaid.phase = 2;
    activeRaid.atk = Math.floor(activeRaid.atk * 1.2);
    log.push(`\n⚡ **${activeRaid.bossName} chuyển sang Giai Đoạn 2!** ATK tăng!`);
  }

  // Kiểm tra boss bị hạ
  let defeated = false;
  if (activeRaid.currentHp <= 0) {
    activeRaid.status = 'defeated';
    defeated = true;
    try {
      db.prepare("UPDATE world_boss_raids SET status = 'defeated', current_hp = 0, ended_at = datetime('now') WHERE status = 'active' AND boss_id = ?")
        .run(activeRaid.bossId);
    } catch (err) {
      logger.error('[WorldBoss] Lỗi cập nhật trạng thái defeated:', err.message);
    }
    logger.info(`[WorldBoss] ✦ ${activeRaid.bossName} đã bị tiêu diệt!`);
  }

  return {
    totalDamage,
    bossDmg,
    log,
    bossHpNow: activeRaid.currentHp,
    bossMaxHp: activeRaid.maxHp,
    defeated,
    phase: activeRaid.phase,
    participantCount: activeRaid.participants.size,
  };
}

// ═══════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════

/**
 * Lấy bảng xếp hạng damage
 * @returns {Array} Mảng participants sắp xếp theo damage giảm dần
 */
function getRaidLeaderboard() {
  if (!activeRaid) return [];
  const entries = Array.from(activeRaid.participants.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.totalDamage - a.totalDamage);
  return entries;
}

// ═══════════════════════════════════════════
//  DISTRIBUTE REWARDS
// ═══════════════════════════════════════════

/**
 * Phân phối phần thưởng dựa trên contribution %
 * @returns {Array} Mảng phần thưởng cho mỗi player
 */
function distributeRewards() {
  if (!activeRaid || activeRaid.status !== 'defeated') return [];

  const totalDamageAll = Array.from(activeRaid.participants.values())
    .reduce((sum, p) => sum + p.totalDamage, 0);

  if (totalDamageAll <= 0) return [];

  const rewards = [];
  const boss = monstersConfig.getMonsterById(activeRaid.bossId);
  const baseExp = boss ? boss.exp_reward : 500000;
  const baseLinhThach = 50000;

  for (const [playerId, data] of activeRaid.participants) {
    const contribution = data.totalDamage / totalDamageAll;
    const expReward = Math.floor(baseExp * contribution * 2); // 2x multiplier cho raid
    const goldReward = Math.floor(baseLinhThach * contribution * 2);

    // Trao phần thưởng
    try {
      db.prepare('UPDATE players SET exp = exp + ?, linh_thach = linh_thach + ? WHERE id = ?')
        .run(expReward, goldReward, playerId);
    } catch (err) {
      logger.error(`[WorldBoss] Lỗi trao thưởng cho player ${playerId}:`, err.message);
    }

    // Lưu contribution vào DB
    try {
      db.prepare(`INSERT OR REPLACE INTO world_boss_contributions (raid_id, player_id, damage_dealt, contribution_percent, exp_reward, gold_reward)
        VALUES ((SELECT MAX(id) FROM world_boss_raids WHERE boss_id = ?), ?, ?, ?, ?, ?)`)
        .run(activeRaid.bossId, playerId, data.totalDamage, Math.floor(contribution * 100), expReward, goldReward);
    } catch (err) {
      logger.error(`[WorldBoss] Lỗi lưu contribution cho player ${playerId}:`, err.message);
    }

    rewards.push({
      playerId,
      name: data.name,
      damage: data.totalDamage,
      contribution: Math.floor(contribution * 100),
      exp: expReward,
      gold: goldReward,
    });
  }

  // Reset raid
  activeRaid = null;
  attackCooldowns.clear();

  return rewards;
}

// ═══════════════════════════════════════════
//  DESPAWN CHECK
// ═══════════════════════════════════════════

/**
 * Kiểm tra và xử lý despawn (gọi bởi scheduler mỗi 60s)
 * @returns {Object|false} Thông tin raid đã despawn hoặc false
 */
function checkDespawn() {
  if (!activeRaid || activeRaid.status !== 'active') return false;

  const elapsed = Date.now() - activeRaid.spawnedAt;
  if (elapsed > 60 * 60 * 1000) { // 1 giờ
    activeRaid.status = 'despawned';

    try {
      db.prepare("UPDATE world_boss_raids SET status = 'despawned', ended_at = datetime('now') WHERE status = 'active'")
        .run();
    } catch (err) {
      logger.error('[WorldBoss] Lỗi cập nhật trạng thái despawned:', err.message);
    }

    const result = {
      bossName: activeRaid.bossName,
      bossEmoji: activeRaid.bossEmoji,
      channelId: activeRaid.channelId,
      currentHp: activeRaid.currentHp,
      maxHp: activeRaid.maxHp,
      participantCount: activeRaid.participants.size,
    };

    logger.info(`[WorldBoss] ${activeRaid.bossName} đã biến mất (hết thời gian).`);

    activeRaid = null;
    attackCooldowns.clear();

    return result;
  }

  return false;
}

// ═══════════════════════════════════════════
//  HP BAR HELPER
// ═══════════════════════════════════════════

/**
 * Tạo thanh HP hiển thị
 * @param {number} current - HP hiện tại
 * @param {number} max - HP tối đa
 * @param {number} length - Chiều dài thanh
 * @returns {string}
 */
function createHpBar(current, max, length = 20) {
  const ratio = Math.max(0, current / max);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${formatNumber(current)}/${formatNumber(max)}`;
}

/**
 * Format số có dấu phân cách hàng nghìn
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Lấy thời gian còn lại (format chuỗi)
 * @returns {string}
 */
function getRemainingTime() {
  if (!activeRaid) return '0 phút';
  const elapsed = Date.now() - activeRaid.spawnedAt;
  const remaining = Math.max(0, 60 * 60 * 1000 - elapsed);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes} phút ${seconds} giây`;
}

module.exports = {
  spawnWorldBoss,
  getActiveRaid,
  attackBoss,
  getRaidLeaderboard,
  distributeRewards,
  checkDespawn,
  createHpBar,
  formatNumber,
  getRemainingTime,
};
