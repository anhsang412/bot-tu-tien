const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../utils/constants');
const { formatNumber } = require('../utils/helpers');
const { getMenuImage } = require('../utils/image-helper');

/**
 * Trade Menu — Tiệm NPC, Giao Dịch Player, Đấu Giá Tụ Bảo Các
 */
async function showTradeMenu(interaction, player) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('💰 Giao Dịch & Thương Mại')
    .setDescription(
      `💎 Linh Thạch: **${formatNumber(player.linh_thach)}**\n` +
      `✨ Tiên Thạch: **${formatNumber(player.tien_thach)}**\n\n` +
      `Chọn phương thức giao dịch:`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('trade:npcshop')
      .setLabel('🏪 Tiệm Bách Bảo')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('trade:auction')
      .setLabel('🔮 Tụ Bảo Các')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('trade:player')
      .setLabel('🤝 Giao Dịch Player')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🏠 Menu Chính')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('trade');
  const updatePayload = { embeds: [embed], components: [row] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

module.exports = {
  showTradeMenu,
};
