const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const db = require('../database/connection');
const techniquesConfig = require('../../config/techniques');
const realmsConfig = require('../../config/realms');
const { COLORS } = require('../utils/constants');
const { formatNumber } = require('../utils/helpers');

/**
 * Hiển thị menu công pháp — thông tin hiện tại + danh sách có thể học
 * @param {import('discord.js').Interaction} interaction
 * @param {Object} player - Dữ liệu người chơi từ DB
 */
async function showTechniqueMenu(interaction, player) {
  const currentTech = techniquesConfig.getTechniqueById(player.technique_id);
  const realm = realmsConfig.getRealmByOrder(player.realm_index + 1);
  const realmOrder = realm ? realm.order : player.realm_index + 1;

  // ── Thông tin công pháp hiện tại ──
  let currentInfo = '📖 _Chưa có công pháp_';
  if (currentTech) {
    const statLines = Object.entries(currentTech.stat_bonuses)
      .map(([key, val]) => `  +${val} ${key}`)
      .join('\n');

    currentInfo =
      `${currentTech.emoji} **${currentTech.name}**\n` +
      `Phẩm cấp: **${currentTech.grade.name}** (${currentTech.grade.color ? '●' : '○'})\n` +
      `Đạo: **${currentTech.dao_path === 'both' ? 'Chính Đạo & Ma Đạo' : currentTech.dao_path === 'chinh_dao' ? '☀️ Chính Đạo' : '🌙 Ma Đạo'}**\n\n` +
      `📈 **Tăng EXP tu luyện:** +${currentTech.exp_bonus}%\n\n` +
      `📊 **Chỉ số tăng thêm:**\n${statLines}\n\n`;

    // Hiển thị đặc biệt nếu có
    if (currentTech.special) {
      currentInfo +=
        `🌟 **${currentTech.special.name}** (Lv.${currentTech.special.min_level}+)\n` +
        `_${currentTech.special.description}_\n\n`;
    }

    currentInfo += `_${currentTech.description}_`;
  }

  // ── Danh sách công pháp khả dụng ──
  const availableTechs = techniquesConfig.getAvailableAt(realmOrder, player.dao_path);
  // Loại bỏ công pháp hiện tại
  const switchableTechs = availableTechs.filter(t => t.id !== player.technique_id);

  const embed = new EmbedBuilder()
    .setColor(currentTech ? (currentTech.grade.color || COLORS.CULTIVATION) : COLORS.CULTIVATION)
    .setTitle('📜 Công Pháp Tu Luyện')
    .setDescription(
      `**Công pháp hiện tại:**\n\n${currentInfo}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📋 **Có thể chuyển sang:** ${switchableTechs.length} công pháp\n` +
      `⚠️ _Chuyển công pháp sẽ mất **50% EXP** hiện tại!_`
    )
    .setFooter({ text: `EXP hiện tại: ${formatNumber(player.exp)}` });

  const components = [];

  // Select menu nếu có công pháp khả dụng
  if (switchableTechs.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select:technique')
      .setPlaceholder('Chọn công pháp muốn chuyển...')
      .addOptions(
        switchableTechs.slice(0, 25).map(tech => ({
          label: `${tech.name} [${tech.grade.name}]`,
          description: `+${tech.exp_bonus}% EXP | ${tech.dao_path === 'both' ? 'Mọi Đạo' : tech.dao_path === 'chinh_dao' ? 'Chính Đạo' : 'Ma Đạo'}`,
          value: tech.id,
          emoji: tech.emoji,
        }))
      );

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Nút quay lại
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('menu:cultivation')
        .setLabel('◀️ Quay Lại')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components });
  } else if (interaction.isButton && interaction.isButton()) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components });
  }
}

/**
 * Xử lý chuyển công pháp — xác nhận + phạt 50% EXP
 * @param {import('discord.js').Interaction} interaction
 * @param {Object} player
 * @param {string} techniqueId
 */
async function handleTechniqueSwitch(interaction, player, techniqueId) {
  const newTech = techniquesConfig.getTechniqueById(techniqueId);
  if (!newTech) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('❌ Lỗi')
          .setDescription('Công pháp không tồn tại.'),
      ],
      ephemeral: true,
    });
  }

  // ── Kiểm tra công pháp trùng ──
  if (player.technique_id === techniqueId) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warning)
          .setTitle('⚠️ Cùng Công Pháp')
          .setDescription(`Bạn đang tu luyện **${newTech.name}** rồi!`),
      ],
      ephemeral: true,
    });
  }

  // ── Kiểm tra dao_path ──
  if (newTech.dao_path !== 'both' && newTech.dao_path !== player.dao_path) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('🚫 Không Phù Hợp Đạo')
          .setDescription(
            `**${newTech.name}** chỉ dành cho **${newTech.dao_path === 'chinh_dao' ? '☀️ Chính Đạo' : '🌙 Ma Đạo'}** tu sĩ.`
          ),
      ],
      ephemeral: true,
    });
  }

  // ── Kiểm tra cảnh giới ──
  const realm = realmsConfig.getRealmByOrder(player.realm_index + 1);
  const realmOrder = realm ? realm.order : player.realm_index + 1;

  if (realmOrder < newTech.min_realm) {
    const minRealm = realmsConfig.getRealmByOrder(newTech.min_realm);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('🔒 Chưa Đủ Cảnh Giới')
          .setDescription(
            `Cần đạt **${minRealm ? minRealm.name : `cảnh giới ${newTech.min_realm}`}** để tu luyện **${newTech.name}**.`
          ),
      ],
      ephemeral: true,
    });
  }

  // ── Hiển thị xác nhận với cảnh báo mất 50% EXP ──
  const expLoss = Math.floor(player.exp / 2);
  const currentTech = techniquesConfig.getTechniqueById(player.technique_id);

  // So sánh stat bonuses
  const oldStats = currentTech ? currentTech.stat_bonuses : {};
  const newStats = newTech.stat_bonuses;
  const allKeys = [...new Set([...Object.keys(oldStats), ...Object.keys(newStats)])];

  let compareLines = allKeys.map(key => {
    const oldVal = oldStats[key] || 0;
    const newVal = newStats[key] || 0;
    const diff = newVal - oldVal;
    const arrow = diff > 0 ? '🟢' : diff < 0 ? '🔴' : '⚪';
    return `  ${arrow} ${key}: ${oldVal} → ${newVal} (${diff >= 0 ? '+' : ''}${diff})`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('⚠️ Xác Nhận Chuyển Công Pháp')
    .setDescription(
      `${currentTech ? `${currentTech.emoji} ${currentTech.name}` : '📖 Không có'} → ${newTech.emoji} **${newTech.name}**\n\n` +
      `Phẩm cấp: **${newTech.grade.name}**\n` +
      `EXP bonus: +${newTech.exp_bonus}%\n\n` +
      `📊 **So sánh chỉ số:**\n${compareLines}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🔴 **CẢNH BÁO: Mất 50% EXP hiện tại!**\n` +
      `EXP hiện tại: **${formatNumber(player.exp)}**\n` +
      `EXP sau chuyển: **${formatNumber(player.exp - expLoss)}** (−${formatNumber(expLoss)})\n\n` +
      `_Bạn có chắc chắn muốn chuyển?_`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`technique:confirm:${techniqueId}`)
      .setLabel('✅ Xác Nhận Chuyển')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('cultivation:technique')
      .setLabel('❌ Hủy Bỏ')
      .setStyle(ButtonStyle.Secondary)
  );

  // Dùng update nếu đang ở select menu
  if (interaction.isStringSelectMenu()) {
    await interaction.update({ embeds: [embed], components: [row] });
  } else if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components: [row] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row] });
  }
}

/**
 * Xác nhận chuyển công pháp — cập nhật DB, trừ 50% EXP
 * @param {import('discord.js').Interaction} interaction
 * @param {Object} player
 * @param {string} techniqueId
 */
async function confirmTechniqueSwitch(interaction, player, techniqueId) {
  const newTech = techniquesConfig.getTechniqueById(techniqueId);
  if (!newTech) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('❌ Lỗi')
          .setDescription('Công pháp không tồn tại.'),
      ],
      ephemeral: true,
    });
  }

  // Thực hiện chuyển — trừ 50% EXP
  const oldExp = player.exp;
  db.prepare('UPDATE players SET technique_id = ?, exp = exp / 2 WHERE id = ?')
    .run(techniqueId, player.id);

  const newExp = Math.floor(oldExp / 2);
  const expLost = oldExp - newExp;

  // Bonus stats
  const statLines = Object.entries(newTech.stat_bonuses)
    .map(([key, val]) => `  +${val} ${key}`)
    .join('\n');

  let specialText = '';
  if (newTech.special) {
    specialText = `\n🌟 **${newTech.special.name}** (Lv.${newTech.special.min_level}+)\n_${newTech.special.description}_\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${newTech.emoji} Chuyển Công Pháp Thành Công!`)
    .setDescription(
      `Bạn đã chuyển sang tu luyện **${newTech.name}** [${newTech.grade.name}]!\n\n` +
      `📈 **EXP bonus:** +${newTech.exp_bonus}%\n\n` +
      `📊 **Chỉ số tăng thêm:**\n${statLines}\n` +
      specialText +
      `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💸 EXP đã mất: **−${formatNumber(expLost)}**\n` +
      `✨ EXP còn lại: **${formatNumber(newExp)}**\n\n` +
      `_${newTech.description}_`
    )
    .setFooter({ text: 'Công pháp mới đã được kích hoạt!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cultivation:technique')
      .setLabel('📜 Xem Công Pháp')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('menu:cultivation')
      .setLabel('◀️ Quay Lại')
      .setStyle(ButtonStyle.Secondary)
  );

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components: [row] });
  } else {
    await interaction.update({ embeds: [embed], components: [row] });
  }
}

module.exports = {
  showTechniqueMenu,
  handleTechniqueSwitch,
  confirmTechniqueSwitch,
};
