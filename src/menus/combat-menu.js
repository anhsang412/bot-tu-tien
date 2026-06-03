/**
 * @file Combat Menu — Chiến Trường
 * @description Săn Quái, Diệt Yêu Thú, Thách Đấu PvP, Quản lý Kỹ Năng
 *
 * Sử dụng combat engine (createPvECombat, createPvPCombat) cho chiến đấu chi tiết.
 * Hỗ trợ permadeath (PvE), cooldown PvP, drop vật phẩm, và nhật ký chiến đấu.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} = require('discord.js');
const db = require('../database/connection');
const { COLORS, COOLDOWNS } = require('../utils/constants');
const { formatNumber, progressBar, randomInt, formatTime } = require('../utils/helpers');
const { createPvECombat, createPvPCombat } = require('../systems/combat');
const {
  initInteractiveCombat,
  buildInteractiveEmbed,
  buildActionButtons,
} = require('../systems/interactive-combat');
const { checkCooldown, setCooldown } = require('../systems/cooldown');
const monsters = require('../../config/monsters');
const { getItemById } = require('../../config/items');
const { showSkillsMenu } = require('../systems/skills');
const { getMenuImage } = require('../utils/image-helper');
const { getMonsterImagePath } = require('../../config/monster-images');

// ═══════════════════════════════════════════
//  Prepared Statements
// ═══════════════════════════════════════════

const stmtUpdateHp = db.prepare('UPDATE players SET hp = ? WHERE id = ?');
const stmtKillPlayer = db.prepare('UPDATE players SET hp = 0, is_dead = 1 WHERE id = ?');
const stmtSetHp1 = db.prepare('UPDATE players SET hp = 1 WHERE id = ?');
const stmtAddRewards = db.prepare('UPDATE players SET exp = exp + ?, linh_thach = linh_thach + ? WHERE id = ?');
const stmtGetInvItem = db.prepare('SELECT quantity FROM inventory WHERE player_id = ? AND item_id = ?');
const stmtAddInvItem = db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE player_id = ? AND item_id = ?');
const stmtInsertInvItem = db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, 1)');
const stmtGetActivePet = db.prepare('SELECT * FROM player_pets WHERE player_id = ? AND is_active = 1');
const stmtGetPlayerByDiscord = db.prepare('SELECT * FROM players WHERE discord_id = ? AND is_dead = 0');
const stmtStealExp = db.prepare('UPDATE players SET exp = CASE WHEN exp >= ? THEN exp - ? ELSE 0 END WHERE id = ?');

// ═══════════════════════════════════════════
//  showCombatMenu — Menu chính chiến trường
// ═══════════════════════════════════════════

/**
 * Hiển thị menu chiến trường chính
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi từ DB
 */
async function showCombatMenu(interaction, player) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.combat)
    .setTitle('⚔️ Chiến Trường')
    .setDescription(
      `**${player.name}** — Chiến lực: **${formatNumber(player.atk + player.def + player.speed)}**\n` +
      `❤️ HP: ${progressBar(player.hp, player.max_hp)} ${formatNumber(player.hp)}/${formatNumber(player.max_hp)}\n\n` +
      `Chọn phương thức chiến đấu:`
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('combat:hunt')
      .setLabel('🐉 Săn Quái')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('combat:beast')
      .setLabel('👹 Diệt Yêu Thú')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('combat:pvp')
      .setLabel('⚔️ Thách Đấu')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('skills:menu')
      .setLabel('💫 Kỹ Năng')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('combat');
  const updatePayload = { embeds: [embed], components: [row1] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

// ═══════════════════════════════════════════
//  buildCombatLog — Tạo nhật ký chiến đấu hiển thị
// ═══════════════════════════════════════════

/**
 * Format nhật ký chiến đấu từ combat result
 * @param {Array<Object>} turns - Mảng lượt chiến đấu
 * @param {number} maxLines - Số dòng tối đa hiển thị
 * @returns {string}
 */
function buildCombatLog(turns, maxLines = 14) {
  const lines = [];

  for (const turn of turns) {
    // Sát thương người chơi
    if (turn.playerAction) {
      const skillName = turn.playerAction.skillName || 'Đánh thường';
      lines.push(`⚔️ L${turn.turn}: Bạn dùng ${skillName} gây ${turn.playerAction.damage} sát thương`);
    }

    // Sát thương quái/đối thủ
    if (turn.enemyAction) {
      const enemyName = turn.enemyAction.name || 'Kẻ địch';
      lines.push(`👹 L${turn.turn}: ${enemyName} gây ${turn.enemyAction.damage} sát thương`);
    }

    // Linh thú tấn công
    if (turn.petAction) {
      lines.push(`🐾 L${turn.turn}: Linh thú gây ${turn.petAction.damage} sát thương`);
    }

    // Hiệu ứng phụ
    if (turn.effects && turn.effects.length > 0) {
      for (const eff of turn.effects) {
        lines.push(`✨ L${turn.turn}: ${eff}`);
      }
    }
  }

  // Chỉ lấy maxLines dòng cuối
  return lines.slice(-maxLines).join('\n');
}

// ═══════════════════════════════════════════
//  getDangerRating — Đánh giá mức nguy hiểm
// ═══════════════════════════════════════════

/**
 * Tính mức nguy hiểm khi đối đầu quái vật
 * @param {Object} player - Dữ liệu người chơi
 * @param {Object} monster - Dữ liệu quái vật
 * @returns {{ stars: string, text: string, color: string }}
 */
function getDangerRating(player, monster) {
  const playerPower = (player.atk || 10) + (player.def || 5) + (player.max_hp || 100) / 10;
  const monsterPower = (monster.atk || 10) + (monster.def || 5) + (monster.hp || 100) / 10;
  const ratio = monsterPower / playerPower;
  if (ratio < 0.5) return { stars: '⭐', text: 'Dễ dàng', color: '#22C55E' };
  if (ratio < 0.8) return { stars: '⭐⭐', text: 'Bình thường', color: '#3B82F6' };
  if (ratio < 1.2) return { stars: '⭐⭐⭐', text: 'Thách thức', color: '#F59E0B' };
  if (ratio < 2.0) return { stars: '⭐⭐⭐⭐', text: 'Nguy hiểm', color: '#EF4444' };
  return { stars: '⭐⭐⭐⭐⭐', text: 'Chết chắc', color: '#7F1D1D' };
}

// ═══════════════════════════════════════════
//  showCombatPreview — Xem trước quái vật
// ═══════════════════════════════════════════

/**
 * Hiển thị preview quái vật trước khi chiến đấu
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 * @param {Object} monster - Dữ liệu quái vật
 * @param {string} confirmAction - CustomId cho nút xác nhận tấn công
 * @param {string} backAction - CustomId cho nút quay lại
 */
async function showCombatPreview(interaction, player, monster, confirmAction, backAction) {
  const danger = getDangerRating(player, monster);

  // Xác định loại quái
  const typeNames = {
    yeu_thu: '🐾 Yêu Thú',
    quy_tu: '👹 Quỷ Tu',
    ma_dao_tu_si: '🧙 Ma Đạo Tu Sĩ',
    thuong_co_di_thu: '🐲 Thượng Cổ Dị Thú',
    thien_ma: '👿 Thiên Ma',
    kiep_thu: '⛈️ Kiếp Thú',
  };
  const typeName = typeNames[monster.type] || monster.type;

  // Element text
  const elementNames = {
    fire: '🔥 Hỏa', water: '💧 Thủy', ice: '❄️ Băng', thunder: '⚡ Lôi',
    earth: '🌍 Thổ', wind: '🌪️ Phong', wood: '🌿 Mộc', dark: '🌑 Ám',
    light: '☀️ Quang', chaos: '🌀 Hỗn Độn', neutral: '⚪ Vô Thuộc Tính',
  };
  const elementText = elementNames[monster.element] || '⚪ Vô Thuộc Tính';

  const embed = new EmbedBuilder()
    .setColor(danger.color)
    .setTitle(`${monster.emoji} ${monster.name}`)
    .setDescription(
      `╔══════════════════════════════════╗\n` +
      `║ 📋 **THÔNG TIN QUÁI VẬT**\n` +
      `╠══════════════════════════════════╣\n` +
      `║ 📛 Loại: ${typeName}\n` +
      `║ 🏔️ Cảnh giới: Cấp **${monster.realm_level}**\n` +
      `║ ${elementText}\n` +
      `╠══════════════════════════════════╣\n` +
      `║ ❤️ HP: **${formatNumber(monster.hp)}**\n` +
      `║ ⚔️ ATK: **${formatNumber(monster.atk)}**\n` +
      `║ 🛡️ DEF: **${formatNumber(monster.def)}**\n` +
      `║ 💨 SPD: **${formatNumber(monster.speed)}**\n` +
      `╠══════════════════════════════════╣\n` +
      `║ ⚠️ Mức nguy hiểm: ${danger.stars}\n` +
      `║ 📊 Đánh giá: **${danger.text}**\n` +
      `╠══════════════════════════════════╣\n` +
      `║ 📖 _${monster.description || 'Không có mô tả.'}_\n` +
      `╚══════════════════════════════════╝`
    )
    .setTimestamp();

  // Monster image
  const imgPath = getMonsterImagePath(monster.id);
  let files = [];
  if (imgPath) {
    const attachment = new AttachmentBuilder(imgPath, { name: 'monster.png' });
    files = [attachment];
    embed.setThumbnail('attachment://monster.png');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmAction)
      .setLabel('⚔️ Tấn Công')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(backAction)
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row], files });
}

/**
 * Tạo nhật ký chiến đấu đơn giản (fallback khi combat engine chưa trả turns)
 * @param {Object} player - Dữ liệu người chơi
 * @param {Object} monster - Dữ liệu quái vật
 * @returns {Object} - Kết quả chiến đấu nội bộ
 */
function runSimpleCombat(player, monster) {
  const scaleFactor = 1 + (player.sub_realm - 1) * 0.05;
  const monsterHp = Math.floor(monster.hp * scaleFactor);
  const monsterAtk = Math.floor(monster.atk * scaleFactor);
  const monsterDef = Math.floor(monster.def * scaleFactor);

  let playerHp = player.hp;
  let mHp = monsterHp;
  let turn = 0;
  const turns = [];

  // Lấy linh thú active
  const activePet = stmtGetActivePet.get(player.id);

  while (playerHp > 0 && mHp > 0 && turn < 30) {
    turn++;
    const turnData = { turn, playerAction: null, enemyAction: null, petAction: null, effects: [] };

    // Người chơi tấn công
    const playerDmg = Math.max(1, player.atk - Math.floor(monsterDef * 0.3) + randomInt(-5, 5));
    mHp -= playerDmg;
    turnData.playerAction = { skillName: 'Đánh thường', damage: playerDmg };

    if (mHp <= 0) { turns.push(turnData); break; }

    // Quái tấn công
    const monsterDmg = Math.max(1, monsterAtk - Math.floor(player.def * 0.3) + randomInt(-5, 5));
    playerHp -= monsterDmg;
    turnData.enemyAction = { name: monster.name, damage: monsterDmg };

    // Linh thú tấn công
    if (activePet) {
      const petDmg = Math.max(1, Math.floor(activePet.atk * 0.5));
      mHp -= petDmg;
      turnData.petAction = { damage: petDmg };
    }

    turns.push(turnData);
  }

  return {
    won: mHp <= 0,
    playerHp: Math.max(0, playerHp),
    monsterHp: Math.max(0, mHp),
    turns,
    totalTurns: turn,
  };
}

// ═══════════════════════════════════════════
//  startHunt — Săn quái PvE (xem trước + chiến đấu)
// ═══════════════════════════════════════════

/**
 * Bắt đầu săn quái — hiển thị preview quái vật trước
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 */
async function startHunt(interaction, player) {
  // Kiểm tra HP
  if (player.hp <= 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('💀 Đã tử vong')
      .setDescription('Nhân vật đã chết. Dùng /tutien để tạo nhân vật mới.');
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Lọc quái phù hợp cảnh giới (realm_level <= player realm, >= player realm - 2)
  const availableMonsters = monsters.list.filter(
    m => m.realm_level <= player.realm_index && m.realm_level >= player.realm_index - 2
  );

  if (availableMonsters.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('🔍 Không tìm thấy quái vật')
      .setDescription('Khu vực này không có quái vật phù hợp với cảnh giới của bạn.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Quay Lại').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Chọn quái ngẫu nhiên
  const monster = availableMonsters[Math.floor(Math.random() * availableMonsters.length)];

  // Lưu monster vào cache để dùng khi confirm
  if (!interaction.client._combatPreviewCache) interaction.client._combatPreviewCache = new Map();
  interaction.client._combatPreviewCache.set(interaction.user.id, { monster, type: 'hunt' });

  // Hiển thị preview
  return showCombatPreview(interaction, player, monster, 'combat:hunt_confirm', 'combat:menu');
}

/**
 * Thực hiện chiến đấu săn quái sau khi xác nhận từ preview
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 */
async function executeHunt(interaction, player) {
  // Lấy monster từ cache
  const cache = interaction.client._combatPreviewCache?.get(interaction.user.id);
  if (!cache || !cache.monster) {
    // Fallback: chọn lại quái ngẫu nhiên
    return startHunt(interaction, player);
  }
  const monster = cache.monster;
  interaction.client._combatPreviewCache.delete(interaction.user.id);

  // Boss → interactive combat
  if (monster.is_boss) {
    return startInteractiveBossFight(interaction, player, monster);
  }

  // Chạy chiến đấu qua combat engine (fallback nội bộ nếu chưa sẵn sàng)
  let combatResult;
  try {
    const rawResult = createPvECombat(player, monster);
    combatResult = {
      won: rawResult.winner === 'player',
      playerHp: rawResult.playerHpRemaining,
      turns: rawResult.turnLog,
      totalTurns: rawResult.totalTurns
    };
  } catch (_err) {
    // Fallback: chạy combat nội bộ nếu combat engine chưa triển khai
    combatResult = runSimpleCombat(player, monster);
  }

  const { won, playerHp, turns, totalTurns } = combatResult;
  const finalHp = Math.max(0, playerHp);

  // Cập nhật HP người chơi
  stmtUpdateHp.run(finalHp, player.id);

  if (won) {
    // ── Thắng: trao thưởng ──
    const expReward = monster.exp_reward + randomInt(0, Math.floor(monster.exp_reward * 0.2));
    const linhThachReward = randomInt(5, 20) * (player.realm_index + 1);
    stmtAddRewards.run(expReward, linhThachReward, player.id);

    // Cập nhật tiến trình nhiệm vụ
    try {
      const { updateQuestProgress } = require('../systems/quests');
      updateQuestProgress(player.id, 'hunt', monster.id, 1);
    } catch (_err) { /* ignore */ }

    // Xử lý rơi đồ theo drops mới: {item_id, chance}
    let dropText = '';
    if (monster.drops && monster.drops.length > 0) {
      for (const drop of monster.drops) {
        if (Math.random() < drop.chance) {
          const existing = stmtGetInvItem.get(player.id, drop.item_id);
          if (existing) {
            stmtAddInvItem.run(player.id, drop.item_id);
          } else {
            stmtInsertInvItem.run(player.id, drop.item_id);
          }
          // Lấy tên item từ config
          const itemConfig = getItemById(drop.item_id);
          const itemName = itemConfig ? itemConfig.name : drop.item_id;
          dropText += `\n║ 🎁 Rơi vật phẩm: ${itemName}`;
        }
      }
    }

    // Tạo nhật ký chiến đấu
    const combatLog = typeof turns[0] === 'string' ? turns.slice(-14).join('\n') : buildCombatLog(turns, 14);

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle(`⚔️ CHIẾN THẮNG! — ${monster.emoji} ${monster.name}`)
      .setDescription(
        `╔══════════════════════════════════╗\n` +
        `║ 📜 Nhật Ký Chiến Đấu (${totalTurns} lượt)\n` +
        `${combatLog}\n` +
        `╠══════════════════════════════════╣\n` +
        `║ 📈 EXP: +${formatNumber(expReward)}\n` +
        `║ 💎 Linh Thạch: +${formatNumber(linhThachReward)}` +
        `${dropText}\n` +
        `║ ❤️ HP: ${formatNumber(finalHp)}/${formatNumber(player.max_hp)}\n` +
        `╚══════════════════════════════════╝`
      )
      .setTimestamp();

    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:hunt').setLabel('🐉 Tiếp Tục Săn').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // ── Thua ──
  if (finalHp <= 0) {
    // Permadeath — nhân vật chết vĩnh viễn
    stmtKillPlayer.run(player.id);
    const combatLog = buildCombatLog(turns, 4);

    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('💀 THÂN TỬ ĐẠO TIÊU')
      .setDescription(
        `**${player.name}** đã bị ${monster.emoji} **${monster.name}** giết chết!\n\n` +
        `${combatLog}\n\n` +
        `💀 **PERMADEATH** — Nhân vật đã mất vĩnh viễn.\n` +
        `_Dùng /tutien để bắt đầu lại._`
      );
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Thua nhưng sống sót
  const combatLog = buildCombatLog(turns, 4);
  const embed = new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`💔 THẤT BẠI — ${monster.emoji} ${monster.name}`)
    .setDescription(
      `${combatLog}\n\n` +
      `❤️ HP còn lại: **${formatNumber(finalHp)}**/${formatNumber(player.max_hp)}\n` +
      `Bạn bỏ chạy kịp thời!`
    );

  return interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

// ═══════════════════════════════════════════
//  startBeastHunt — Diệt Yêu Thú (xem trước + chiến đấu)
// ═══════════════════════════════════════════

/**
 * Săn yêu thú — hiển thị preview trước khi chiến đấu
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 */
async function startBeastHunt(interaction, player) {
  // Kiểm tra HP
  if (player.hp <= 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('💀 Đã tử vong')
      .setDescription('Nhân vật đã chết. Dùng /tutien để tạo nhân vật mới.');
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Lọc quái loại yeu_thu phù hợp cảnh giới
  const availableMonsters = monsters.list.filter(
    m => m.type === 'yeu_thu' &&
         m.realm_level <= player.realm_index &&
         m.realm_level >= player.realm_index - 2
  );

  if (availableMonsters.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('🔍 Không tìm thấy yêu thú')
      .setDescription('Khu vực này không có yêu thú phù hợp với cảnh giới của bạn.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Quay Lại').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Chọn yêu thú ngẫu nhiên
  const monster = availableMonsters[Math.floor(Math.random() * availableMonsters.length)];

  // Lưu monster vào cache để dùng khi confirm
  if (!interaction.client._combatPreviewCache) interaction.client._combatPreviewCache = new Map();
  interaction.client._combatPreviewCache.set(interaction.user.id, { monster, type: 'beast' });

  // Hiển thị preview
  return showCombatPreview(interaction, player, monster, 'combat:beast_confirm', 'combat:menu');
}

/**
 * Thực hiện chiến đấu yêu thú sau khi xác nhận từ preview
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 */
async function executeBeastHunt(interaction, player) {
  // Lấy monster từ cache
  const cache = interaction.client._combatPreviewCache?.get(interaction.user.id);
  if (!cache || !cache.monster) {
    return startBeastHunt(interaction, player);
  }
  const monster = cache.monster;
  interaction.client._combatPreviewCache.delete(interaction.user.id);

  // Boss → interactive combat
  if (monster.is_boss) {
    return startInteractiveBossFight(interaction, player, monster);
  }

  // Chạy chiến đấu
  let combatResult;
  try {
    const rawResult = createPvECombat(player, monster);
    combatResult = {
      won: rawResult.winner === 'player',
      playerHp: rawResult.playerHpRemaining,
      turns: rawResult.turnLog,
      totalTurns: rawResult.totalTurns
    };
  } catch (_err) {
    combatResult = runSimpleCombat(player, monster);
  }

  const { won, playerHp, turns, totalTurns } = combatResult;
  const finalHp = Math.max(0, playerHp);

  // Cập nhật HP
  stmtUpdateHp.run(finalHp, player.id);

  if (won) {
    // ── Thắng yêu thú ──
    const expReward = monster.exp_reward + randomInt(0, Math.floor(monster.exp_reward * 0.2));
    const linhThachReward = randomInt(5, 20) * (player.realm_index + 1);
    stmtAddRewards.run(expReward, linhThachReward, player.id);

    // Cập nhật tiến trình nhiệm vụ
    try {
      const { updateQuestProgress } = require('../systems/quests');
      updateQuestProgress(player.id, 'hunt', monster.id, 1);
    } catch (_err) { /* ignore */ }

    // Rơi đồ
    let dropText = '';
    if (monster.drops && monster.drops.length > 0) {
      for (const drop of monster.drops) {
        if (Math.random() < drop.chance) {
          const existing = stmtGetInvItem.get(player.id, drop.item_id);
          if (existing) {
            stmtAddInvItem.run(player.id, drop.item_id);
          } else {
            stmtInsertInvItem.run(player.id, drop.item_id);
          }
          const itemConfig = getItemById(drop.item_id);
          const itemName = itemConfig ? itemConfig.name : drop.item_id;
          dropText += `\n║ 🎁 Rơi vật phẩm: ${itemName}`;
        }
      }
    }

    const combatLog = typeof turns[0] === 'string' ? turns.slice(-14).join('\n') : buildCombatLog(turns, 14);

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle(`⚔️ CHIẾN THẮNG! — ${monster.emoji} ${monster.name}`)
      .setDescription(
        `╔══════════════════════════════════╗\n` +
        `║ 📜 Nhật Ký Chiến Đấu (${totalTurns} lượt)\n` +
        `${combatLog}\n` +
        `╠══════════════════════════════════╣\n` +
        `║ 📈 EXP: +${formatNumber(expReward)}\n` +
        `║ 💎 Linh Thạch: +${formatNumber(linhThachReward)}` +
        `${dropText}\n` +
        `║ ❤️ HP: ${formatNumber(finalHp)}/${formatNumber(player.max_hp)}\n` +
        `╚══════════════════════════════════╝`
      )
      .setTimestamp();

    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:beast').setLabel('👹 Tiếp Tục Diệt').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // ── Thua yêu thú ──
  if (finalHp <= 0) {
    // Permadeath
    stmtKillPlayer.run(player.id);
    const combatLog = buildCombatLog(turns, 4);

    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('💀 THÂN TỬ ĐẠO TIÊU')
      .setDescription(
        `**${player.name}** đã bị ${monster.emoji} **${monster.name}** xé xác!\n\n` +
        `${combatLog}\n\n` +
        `💀 **PERMADEATH** — Nhân vật đã mất vĩnh viễn.\n` +
        `_Dùng /tutien để bắt đầu lại._`
      );
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Thua sống sót
  const combatLogLose = buildCombatLog(turns, 4);
  const embed = new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`💔 THẤT BẠI — ${monster.emoji} ${monster.name}`)
    .setDescription(
      `${combatLogLose}\n\n` +
      `❤️ HP còn lại: **${formatNumber(finalHp)}**/${formatNumber(player.max_hp)}\n` +
      `Bạn bỏ chạy kịp thời!`
    );

  return interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

// ═══════════════════════════════════════════
//  startPvP — Thách đấu PvP
// ═══════════════════════════════════════════

/**
 * Thách đấu PvP — chọn đối thủ từ danh sách thành viên server
 * @param {import('discord.js').ButtonInteraction|StringSelectMenuInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 */
async function startPvP(interaction, player) {
  // Kiểm tra HP
  if (player.hp <= 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('💀 Đã tử vong')
      .setDescription('Nhân vật đã chết. Dùng /tutien để tạo nhân vật mới.');
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Kiểm tra cooldown PvP (10 phút)
  const cd = checkCooldown(player.id, 'pvp');
  if (cd.onCooldown) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⏳ Đang hồi chiêu')
      .setDescription(
        `Thách đấu PvP đang trong thời gian hồi.\n` +
        `⏱️ Còn lại: **${formatTime(cd.remainingMs)}**`
      );
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Nếu đã chọn đối thủ từ StringSelectMenu
  if (interaction.isStringSelectMenu && interaction.isStringSelectMenu() && interaction.customId === 'select:pvp_target') {
    const targetDiscordId = interaction.values[0];
    return executePvP(interaction, player, targetDiscordId);
  }

  // Hiển thị danh sách đối thủ có thể chọn
  // Lấy danh sách thành viên server đang online có nhân vật
  let members;
  try {
    members = await interaction.guild.members.fetch({ force: false });
  } catch (_err) {
    members = interaction.guild.members.cache;
  }

  // Lọc thành viên có nhân vật (trừ bản thân, trừ bot)
  const potentialTargets = [];
  for (const [memberId, member] of members) {
    if (member.user.bot) continue;
    if (memberId === player.discord_id) continue;

    const targetPlayer = stmtGetPlayerByDiscord.get(memberId);
    if (targetPlayer) {
      potentialTargets.push({
        discordId: memberId,
        name: targetPlayer.name,
        realmIndex: targetPlayer.realm_index,
        hp: targetPlayer.hp,
        maxHp: targetPlayer.max_hp,
      });
    }
  }

  if (potentialTargets.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⚔️ Không có đối thủ')
      .setDescription('Không tìm thấy tu sĩ nào khác trong server để thách đấu.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Giới hạn 25 lựa chọn (Discord API limit)
  const options = potentialTargets.slice(0, 25).map(t => ({
    label: t.name,
    description: `Cảnh giới: ${t.realmIndex} | HP: ${formatNumber(t.hp)}/${formatNumber(t.maxHp)}`,
    value: t.discordId,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select:pvp_target')
    .setPlaceholder('🎯 Chọn đối thủ thách đấu...')
    .addOptions(options);

  const embed = new EmbedBuilder()
    .setColor(COLORS.combat)
    .setTitle('⚔️ Thách Đấu PvP')
    .setDescription(
      `**${player.name}**, chọn tu sĩ muốn thách đấu:\n\n` +
      `⚠️ PvP **KHÔNG** gây chết vĩnh viễn.\n` +
      `⏱️ Cooldown: **10 phút** sau mỗi trận.\n` +
      `🌙 Ma Đạo thắng sẽ cướp **20% EXP** đối phương.`
    )
    .setTimestamp();

  await interaction.update({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(selectMenu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary)
      )
    ],
  });
}

/**
 * Thực thi trận PvP sau khi chọn đối thủ
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {Object} attacker - Dữ liệu người tấn công
 * @param {string} targetDiscordId - Discord ID đối thủ
 */
async function executePvP(interaction, attacker, targetDiscordId) {
  // Lấy thông tin đối thủ
  const defender = stmtGetPlayerByDiscord.get(targetDiscordId);
  if (!defender) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('❌ Đối thủ không tồn tại')
      .setDescription('Tu sĩ này đã tử vong hoặc không tồn tại.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Đặt cooldown PvP
  setCooldown(attacker.id, 'pvp', COOLDOWNS.pvp);

  // Chạy PvP combat
  let pvpResult;
  try {
    const rawResult = createPvPCombat(attacker, defender);
    pvpResult = {
      winnerId: rawResult.winner === 'player' ? attacker.id : (rawResult.winner === 'enemy' ? defender.id : null),
      turns: rawResult.turnLog,
      totalTurns: rawResult.totalTurns,
      attackerHp: rawResult.playerHpRemaining,
      defenderHp: rawResult.enemyHpRemaining
    };
  } catch (_err) {
    // Fallback PvP: so sánh đơn giản
    pvpResult = runSimplePvP(attacker, defender);
  }

  const { winnerId, turns, totalTurns, attackerHp, defenderHp } = pvpResult;
  const attackerWon = winnerId === attacker.id;

  // PvP KHÔNG permadeath — người thua HP = 1
  if (attackerWon) {
    stmtUpdateHp.run(Math.max(1, attackerHp), attacker.id);
    stmtSetHp1.run(defender.id);
  } else {
    stmtSetHp1.run(attacker.id);
    stmtUpdateHp.run(Math.max(1, defenderHp), defender.id);
  }

  // Phần thưởng cho người thắng
  const winner = attackerWon ? attacker : defender;
  const loser = attackerWon ? defender : attacker;

  const expReward = Math.floor(loser.exp * 0.05) + randomInt(50, 200);
  const linhThachReward = randomInt(10, 50) * (winner.realm_index + 1);
  stmtAddRewards.run(expReward, linhThachReward, winner.id);

  // Ma Đạo thắng → cướp 20% EXP đối thủ
  let maDaoSteal = '';
  if (winner.dao_path === 'ma_dao') {
    const stolenExp = Math.floor(loser.exp * 0.20);
    if (stolenExp > 0) {
      stmtStealExp.run(stolenExp, stolenExp, loser.id);
      stmtAddRewards.run(stolenExp, 0, winner.id);
      maDaoSteal = `\n║ 🌙 Ma Đạo: Cướp **${formatNumber(stolenExp)}** EXP từ đối thủ!`;
    }
  }

  // Tạo nhật ký chiến đấu
  const combatLog = typeof turns[0] === 'string' ? turns.slice(-14).join('\n') : buildCombatLog(turns, 14);

  const resultTitle = attackerWon
    ? `⚔️ CHIẾN THẮNG! — ${attacker.name} vs ${defender.name}`
    : `💔 THẤT BẠI! — ${attacker.name} vs ${defender.name}`;

  const resultColor = attackerWon ? COLORS.success : COLORS.error;
  const winnerName = attackerWon ? attacker.name : defender.name;

  const embed = new EmbedBuilder()
    .setColor(resultColor)
    .setTitle(resultTitle)
    .setDescription(
      `╔══════════════════════════════════╗\n` +
      `║ 📜 Nhật Ký PvP (${totalTurns} lượt)\n` +
      `${combatLog}\n` +
      `╠══════════════════════════════════╣\n` +
      `║ 🏆 Người thắng: **${winnerName}**\n` +
      `║ 📈 EXP: +${formatNumber(expReward)}\n` +
      `║ 💎 Linh Thạch: +${formatNumber(linhThachReward)}` +
      `${maDaoSteal}\n` +
      `║ ❤️ Người thua HP → 1 (không chết)\n` +
      `╚══════════════════════════════════╝`
    )
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('combat:menu').setLabel('🔙 Chiến Trường').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

/**
 * Fallback PvP đơn giản khi combat engine chưa sẵn sàng
 * @param {Object} attacker - Người tấn công
 * @param {Object} defender - Người phòng thủ
 * @returns {Object}
 */
function runSimplePvP(attacker, defender) {
  let atkHp = attacker.hp;
  let defHp = defender.hp;
  let turn = 0;
  const turns = [];

  while (atkHp > 0 && defHp > 0 && turn < 30) {
    turn++;
    const turnData = { turn, playerAction: null, enemyAction: null, effects: [] };

    // Attacker đánh
    const atkDmg = Math.max(1, attacker.atk - Math.floor(defender.def * 0.3) + randomInt(-5, 5));
    defHp -= atkDmg;
    turnData.playerAction = { skillName: 'Đánh thường', damage: atkDmg };

    if (defHp <= 0) { turns.push(turnData); break; }

    // Defender đánh
    const defDmg = Math.max(1, defender.atk - Math.floor(attacker.def * 0.3) + randomInt(-5, 5));
    atkHp -= defDmg;
    turnData.enemyAction = { name: defender.name, damage: defDmg };

    turns.push(turnData);
  }

  const attackerWon = defHp <= 0;

  return {
    winnerId: attackerWon ? attacker.id : defender.id,
    attackerHp: Math.max(0, atkHp),
    defenderHp: Math.max(0, defHp),
    turns,
    totalTurns: turn,
  };
}

// ═══════════════════════════════════════════
//  startInteractiveBossFight — Boss Interactive Combat
// ═══════════════════════════════════════════

/**
 * Khởi tạo boss fight interactive thay vì auto-combat
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi từ DB
 * @param {Object} monster - Dữ liệu quái vật (is_boss === true)
 */
async function startInteractiveBossFight(interaction, player, monster) {
  // Check if player already in interactive combat
  if (!interaction.client._interactiveCombats) {
    interaction.client._interactiveCombats = new Map();
  }

  // Clean up old combat if exists
  const existing = interaction.client._interactiveCombats.get(interaction.user.id);
  if (existing) {
    interaction.client._interactiveCombats.delete(interaction.user.id);
  }

  // Init combat state
  const state = initInteractiveCombat(player, monster);
  interaction.client._interactiveCombats.set(interaction.user.id, state);

  // Build initial UI
  const embed = buildInteractiveEmbed(state);
  const buttons = buildActionButtons(state);

  await interaction.update({
    embeds: [embed],
    components: [buttons],
    files: [],
  });
}

// ═══════════════════════════════════════════
//  Module exports
// ═══════════════════════════════════════════

module.exports = {
  showCombatMenu,
  startHunt,
  executeHunt,
  startBeastHunt,
  executeBeastHunt,
  startPvP,
  executePvP,
  startInteractiveBossFight,
};
