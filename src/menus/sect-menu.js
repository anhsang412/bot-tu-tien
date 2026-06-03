const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../utils/constants');
const { formatNumber } = require('../utils/helpers');
const { getMenuImage } = require('../utils/image-helper');

/**
 * Sect Menu — Tông Môn
 */
async function showSectMenu(interaction, player) {
  const db = require('../database/connection');

  const membership = db.prepare(
    'SELECT sm.*, s.name as sect_name, s.level, s.treasury FROM sect_members sm JOIN sects s ON sm.sect_id = s.id WHERE sm.player_id = ?'
  ).get(player.id);

  let embed;

  if (membership) {
    embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle(`🏛️ ${membership.sect_name}`)
      .setDescription(
        `**Chức vụ**: ${membership.role === 'leader' ? '👑 Tông Chủ' : membership.role === 'elder' ? '🧙 Trưởng Lão' : '🧑 Đệ Tử'}\n` +
        `**Cống hiến**: ${formatNumber(membership.contribution)}\n` +
        `**Cấp Tông**: ${membership.level}\n` +
        `**Kho Bạc**: 💎 ${formatNumber(membership.treasury)}`
      )
      .setTimestamp();
  } else {
    embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('🏛️ Tông Môn')
      .setDescription(
        'Bạn chưa gia nhập tông môn nào.\n\n' +
        '**Lập Tông**: Cần **Kim Đan** trở lên + 1000 💎\n' +
        '**Gia Nhập**: Tìm tông môn và xin gia nhập'
      )
      .setTimestamp();
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(membership ? 'sect:info' : 'sect:create')
      .setLabel(membership ? '📋 Thông Tin' : '🏗️ Lập Tông')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('sect:donate')
      .setLabel('💎 Cống Hiến')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!membership),
    new ButtonBuilder()
      .setCustomId('sect:join')
      .setLabel('🤝 Gia Nhập Tông')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!!membership),
    new ButtonBuilder()
      .setCustomId('sect:quests')
      .setLabel('📜 Nhiệm Vụ Tông')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!membership),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('sect');
  const updatePayload = { embeds: [embed], components: [row] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

module.exports = {
  showSectMenu,
};
