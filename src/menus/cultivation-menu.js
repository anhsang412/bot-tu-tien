const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS, COOLDOWNS } = require('../utils/constants');
const { progressBar, formatNumber, formatTime } = require('../utils/helpers');
const { getMenuImage } = require('../utils/image-helper');

/**
 * Cultivation Menu — Tu Luyện, Lĩnh Ngộ, Đột Phá, Vượt Kiếp
 */
async function showCultivationMenu(interaction, player) {
  const realms = require('../../config/realms');
  const techniques = require('../../config/techniques');

  const realm = realms.list[player.realm_index];
  const technique = techniques.list.find(t => t.id === player.technique_id);
  const nextRealm = realms.list[player.realm_index + 1];
  const expNeeded = realm ? realm.exp_per_sub : 0;

  // Check cooldown
  const db = require('../database/connection');
  const cooldown = db.prepare(
    "SELECT * FROM cooldowns WHERE player_id = ? AND action_type = 'cultivate'"
  ).get(player.id);
  const onCooldown = cooldown && Date.now() < cooldown.expires_at;

  const embed = new EmbedBuilder()
    .setColor(COLORS.cultivation)
    .setTitle('🧘 Tu Luyện Các')
    .setDescription(
      `**${player.name}** — ${realm ? realm.emoji : '🌟'} ${realm ? realm.name : 'Chí Tôn'} Tầng ${player.sub_realm}\n\n` +
      `📜 Công Pháp: **${technique ? technique.name : 'Cơ Bản Tâm Pháp'}**\n` +
      `📈 EXP Bonus: **+${technique ? technique.exp_bonus : 0}%**\n\n` +
      `**Tu Vi Tiến Độ**:\n` +
      `${progressBar(player.exp, expNeeded)} ${formatNumber(player.exp)}/${formatNumber(expNeeded)}\n\n` +
      (onCooldown
        ? `⏳ Thời gian hồi: **${formatTime(cooldown.expires_at - Date.now())}**`
        : '✅ Có thể tu luyện!')
    );

  const img = getMenuImage('cultivation');
  if (img) embed.setImage(`attachment://${img.imageName}`);
  embed.setTimestamp();

  // Check if can breakthrough
  const canBreakthrough = player.exp >= expNeeded && player.sub_realm >= 9 && nextRealm;
  const canSubBreakthrough = player.exp >= expNeeded && player.sub_realm < 9;
  // Check if can comprehend dao laws (Hóa Thần+, realm_index >= 4)
  const canComprehendLaws = player.realm_index >= 4;

  // Check if tribulation is required for next realm
  const needsTribulation = nextRealm && nextRealm.tribulation && player.sub_realm >= 9 && player.exp >= expNeeded;
  // Check if tribulation already passed
  let tribulationPassed = false;
  if (needsTribulation) {
    const { hasFlag } = require('../systems/cooldown');
    tribulationPassed = hasFlag(player.id, `tribulation_passed:${nextRealm.order || player.realm_index + 1}`);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cultivation:train')
      .setLabel('🧘 Tu Luyện')
      .setStyle(ButtonStyle.Success)
      .setDisabled(onCooldown),
    new ButtonBuilder()
      .setCustomId('cultivation:comprehend')
      .setLabel('📖 Lĩnh Ngộ Pháp Tắc')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canComprehendLaws),
    new ButtonBuilder()
      .setCustomId('cultivation:breakthrough')
      .setLabel('⬆️ Đột Phá')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canBreakthrough && !canSubBreakthrough),
    new ButtonBuilder()
      .setCustomId('cultivation:tribulation')
      .setLabel('⚡ Vượt Kiếp')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!needsTribulation || tribulationPassed),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('technique:menu')
      .setLabel('📜 Đổi Công Pháp')
      .setStyle(ButtonStyle.Primary),
  );

  const imgData = getMenuImage('cultivation');
  const updatePayload = { embeds: [embed], components: [row, row2] };
  if (imgData) updatePayload.files = [imgData.attachment];
  await interaction.update(updatePayload);
}

/**
 * Handle cultivation (tu luyện) action
 */
async function handleCultivation(interaction, player) {
  const db = require('../database/connection');
  const realms = require('../../config/realms');
  const techniques = require('../../config/techniques');
  const { chance } = require('../utils/helpers');

  // Check cooldown
  const cooldown = db.prepare(
    "SELECT * FROM cooldowns WHERE player_id = ? AND action_type = 'cultivate'"
  ).get(player.id);

  if (cooldown && Date.now() < cooldown.expires_at) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⏳ Đang Thiền Định')
      .setDescription(`Bạn cần nghỉ ngơi thêm **${formatTime(cooldown.expires_at - Date.now())}** trước khi tu luyện tiếp.`);
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cultivation:menu').setLabel('🔙 Quay Lại').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  const realm = realms.list[player.realm_index];
  const technique = techniques.list.find(t => t.id === player.technique_id);
  const expBonus = technique ? technique.exp_bonus / 100 : 0;

  // Base EXP = 10-20 per cultivation session
  const baseExp = Math.floor(Math.random() * 11) + 10;
  const bonusExp = Math.floor(baseExp * expBonus);
  const totalExp = baseExp + bonusExp;

  // Ma Đạo: 20% more EXP but 5% chance of tẩu hỏa
  let tauHoa = false;
  let tauHoaDamage = 0;
  if (player.dao_path === 'ma') {
    const maBonus = Math.floor(totalExp * 0.2);
    const finalExp = totalExp + maBonus;

    if (chance(5)) {
      tauHoa = true;
      tauHoaDamage = Math.floor(player.max_hp * 0.15);
      const newHp = Math.max(1, player.hp - tauHoaDamage);

      db.prepare('UPDATE players SET exp = exp + ?, hp = ? WHERE id = ?').run(
        Math.floor(finalExp * 0.5), // Only get half EXP when tẩu hỏa
        newHp,
        player.id
      );

      // Check if player dies from tẩu hỏa
      if (newHp <= Math.floor(player.max_hp * 0.2) && chance(30)) {
        db.prepare('UPDATE players SET is_dead = 1 WHERE id = ?').run(player.id);
        const embed = new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('💀 TẨU HỎA NHẬP MA — THÂN TỬ ĐẠO TIÊU')
          .setDescription(
            `**${player.name}** tẩu hỏa nhập ma khi tu luyện ma đạo công pháp!\n\n` +
            `Kinh mạch đứt hết, đan điền vỡ nát...\n` +
            `Nhân vật đã **CHẾT VĨNH VIỄN**.\n\n` +
            `_Dùng /tutien để tạo nhân vật mới._`
          );
        return interaction.update({ embeds: [embed], components: [] });
      }
    } else {
      db.prepare('UPDATE players SET exp = exp + ? WHERE id = ?').run(finalExp, player.id);
    }
  } else {
    db.prepare('UPDATE players SET exp = exp + ? WHERE id = ?').run(totalExp, player.id);
  }

  // Set cooldown (30 minutes)
  const expiresAt = Date.now() + COOLDOWNS.cultivate;
  db.prepare(
    "INSERT OR REPLACE INTO cooldowns (player_id, action_type, expires_at) VALUES (?, 'cultivate', ?)"
  ).run(player.id, expiresAt);

  // Build result embed
  const embed = new EmbedBuilder()
    .setColor(tauHoa ? COLORS.error : COLORS.success)
    .setTitle(tauHoa ? '🔥 Tẩu Hỏa Nhập Ma!' : '🧘 Tu Luyện Thành Công!')
    .setDescription(
      tauHoa
        ? `**${player.name}** bị tẩu hỏa khi tu luyện!\n\n` +
          `💔 Mất **${formatNumber(tauHoaDamage)}** HP\n` +
          `📈 Chỉ nhận được **${formatNumber(Math.floor((totalExp + Math.floor(totalExp * 0.2)) * 0.5))}** EXP\n\n` +
          `⚠️ Tu luyện Ma Đạo mạnh mẽ nhưng đầy nguy hiểm!`
        : `**${player.name}** thiền định thành công!\n\n` +
          `📈 +**${formatNumber(totalExp)}** Tu Vi\n` +
          (bonusExp > 0 ? `📜 Bonus từ ${technique.name}: +**${formatNumber(bonusExp)}**\n` : '') +
          (player.dao_path === 'ma' ? `😈 Ma Đạo bonus: +**${formatNumber(Math.floor(totalExp * 0.2))}**\n` : '') +
          `\n⏳ Cooldown: **${formatTime(COOLDOWNS.cultivate)}**`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cultivation:menu')
      .setLabel('🔙 Quay Lại Tu Luyện')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🏠 Menu Chính')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Handle breakthrough (đột phá)
 */
async function handleBreakthrough(interaction, player) {
  const db = require('../database/connection');
  const realms = require('../../config/realms');
  const items = require('../../config/items');

  const realm = realms.list[player.realm_index];
  const expNeeded = realm ? realm.exp_per_sub : 0;

  if (player.exp < expNeeded) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('❌ Chưa Đủ Tu Vi')
      .setDescription(`Cần **${formatNumber(expNeeded)}** EXP để đột phá. Hiện có: **${formatNumber(player.exp)}**`);
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cultivation:menu').setLabel('🔙 Quay Lại').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  if (player.sub_realm < 9) {
    // Sub-realm breakthrough — just needs EXP
    db.prepare('UPDATE players SET sub_realm = sub_realm + 1, exp = 0 WHERE id = ?').run(player.id);

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('⬆️ Đột Phá Thành Công!')
      .setDescription(
        `**${player.name}** đã đột phá lên **${realm.name} Tầng ${player.sub_realm + 1}**!\n\n` +
        `Cảm giác sức mạnh tràn đầy cơ thể...`
      );

    // Update stats based on realm multiplier
    const statIncrease = Math.floor(realm.stat_multiplier * 5);
    db.prepare(
      'UPDATE players SET max_hp = max_hp + ?, hp = max_hp, atk = atk + ?, def = def + ?, speed = speed + ?, max_mana = max_mana + ?, mana = max_mana WHERE id = ?'
    ).run(statIncrease * 10, statIncrease, statIncrease, Math.floor(statIncrease * 0.5), statIncrease * 3, player.id);

    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cultivation:menu').setLabel('🧘 Tiếp Tục Tu Luyện').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Major realm breakthrough — needs pill + possibly tribulation
  const nextRealm = realms.list[player.realm_index + 1];
  if (!nextRealm) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('🌟 Đã Đạt Đỉnh Phong')
      .setDescription('Bạn đã đạt cảnh giới **Chí Tôn** — đỉnh cao của tu tiên!');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Check if tribulation is required
  if (nextRealm.tribulation) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⚡ Cần Vượt Thiên Kiếp!')
      .setDescription(
        `Để đột phá lên **${nextRealm.name}**, bạn cần vượt qua **${nextRealm.tribulation}** trước!\n\n` +
        `Nhấn **⚡ Vượt Kiếp** để bắt đầu.`
      );
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cultivation:tribulation').setLabel('⚡ Vượt Kiếp').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cultivation:menu').setLabel('🔙 Quay Lại').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Check for required pill
  const requiredPill = items.breakthroughPills[player.realm_index + 1];
  if (requiredPill) {
    const hasItem = db.prepare(
      'SELECT * FROM inventory WHERE player_id = ? AND item_id = ? AND quantity > 0'
    ).get(player.id, requiredPill.id);

    if (!hasItem) {
      const embed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('❌ Thiếu Đan Dược')
        .setDescription(
          `Cần **${requiredPill.name}** để đột phá lên **${nextRealm.name}**!\n\n` +
          `Có thể mua tại Tụ Bảo Các hoặc luyện đan.`
        );
      return interaction.update({ embeds: [embed], components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cultivation:menu').setLabel('🔙 Quay Lại').setStyle(ButtonStyle.Secondary)
        )
      ]});
    }

    // Consume pill
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE player_id = ? AND item_id = ?')
      .run(player.id, requiredPill.id);
  }

  // Perform breakthrough
  db.prepare('UPDATE players SET realm_index = realm_index + 1, sub_realm = 1, exp = 0 WHERE id = ?').run(player.id);

  // Big stat increase for realm change
  const statIncrease = Math.floor(nextRealm.stat_multiplier * 20);
  db.prepare(
    'UPDATE players SET max_hp = max_hp + ?, hp = max_hp, atk = atk + ?, def = def + ?, speed = speed + ?, max_mana = max_mana + ?, mana = max_mana WHERE id = ?'
  ).run(statIncrease * 15, statIncrease * 2, statIncrease * 2, statIncrease, statIncrease * 5, player.id);

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🌟 ĐỘT PHÁ THÀNH CÔNG!')
    .setDescription(
      `✨ **${player.name}** đã đột phá lên cảnh giới mới!\n\n` +
      `${nextRealm.emoji} **${nextRealm.name}** — ${nextRealm.tier}\n\n` +
      `Thiên địa chấn động, linh khí cuồn cuộn tụ lại...\n` +
      `Sức mạnh bùng nổ, cảnh giới thăng hoa!\n\n` +
      `⚔️ ATK +${statIncrease * 2} | 🛡️ DEF +${statIncrease * 2} | ❤️ HP +${statIncrease * 15}`
    )
    .setTimestamp();

  return interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cultivation:menu').setLabel('🧘 Tu Luyện').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

module.exports = {
  showCultivationMenu,
  handleCultivation,
  handleBreakthrough,
};
