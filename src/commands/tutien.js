const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { COLORS, EMOJIS } = require('../utils/constants');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tutien')
    .setDescription('🐉 Mở thế giới Tu Tiên — Bắt đầu hành trình tu luyện của bạn!'),

  async execute(interaction) {
    // Defer reply to prevent timeout
    await interaction.deferReply({ ephemeral: false });

    try {
      const db = require('../database/connection');
      const { createMainMenuEmbed, createCharacterCreationEmbed } = require('../ui/embeds');
      const { createMainMenuButtons, createDaoPathButtons } = require('../ui/buttons');

      const discordId = interaction.user.id;

      // Check if player exists
      const player = db.prepare('SELECT * FROM players WHERE discord_id = ?').get(discordId);

      if (player) {
        if (player.is_dead) {
          // Player is dead (permadeath) — offer reincarnation
          const deadEmbed = new EmbedBuilder()
            .setColor(COLORS.ERROR)
            .setTitle(`${EMOJIS.DEFEAT} Hồn Phách Tiêu Tán`)
            .setDescription(
              `Nhân vật **${player.name}** đã tử vong tại cảnh giới Tầng ${player.realm_index + 1}.\n\n` +
              `${EMOJIS.FIRE} Bạn có thể **luân hồi chuyển thế** để bắt đầu lại.\n` +
              `⚠️ _Tất cả tiến trình sẽ bị xóa!_`
            )
            .setTimestamp();
          const { createConfirmButtons } = require('../ui/buttons');
          const row = createConfirmButtons('reincarnate');
          return interaction.editReply({ embeds: [deadEmbed], components: row });
        }

        // Show main menu
        const imgPath = path.join(__dirname, '../../data/images/main_menu.png');
        const files = fs.existsSync(imgPath) ? [new AttachmentBuilder(imgPath)] : [];
        const embed = createMainMenuEmbed(player);
        const rows = createMainMenuButtons();
        return interaction.editReply({ embeds: [embed], components: rows, files });
      }

      // New player — start character creation
      const imgPath = path.join(__dirname, '../../data/images/welcome.png');
      const files = fs.existsSync(imgPath) ? [new AttachmentBuilder(imgPath)] : [];
      const embed = createCharacterCreationEmbed('welcome', {
        username: interaction.user.displayName,
      });
      const buttons = createDaoPathButtons();
      return interaction.editReply({ embeds: [embed], components: buttons, files });
    } catch (err) {
      logger.error('[/tutien] Lỗi chi tiết:', err.message);
      logger.error(err.stack);
      const errorEmbed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('❌ Lỗi')
        .setDescription(`\`\`\`${err.message}\`\`\``);
      return interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
