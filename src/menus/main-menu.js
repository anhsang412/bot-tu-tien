const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { COLORS, EMOJIS } = require('../utils/constants');

/**
 * Main Menu handler — the hub of the game
 * Shows 8 navigation buttons
 */
async function showMainMenu(interaction, player) {
  const db = require('../database/connection');
  const realms = require('../../config/realms');
  const { createMainMenuEmbed } = require('../ui/embeds');
  const { createMainMenuButtons } = require('../ui/buttons');

  // Refresh player data
  const freshPlayer = db.prepare('SELECT * FROM players WHERE discord_id = ?').get(interaction.user.id);
  if (!freshPlayer) return;

  const file = new AttachmentBuilder(path.join(__dirname, '../../data/images/main_menu.png'));
  const embed = createMainMenuEmbed(freshPlayer);
  const rows = createMainMenuButtons();

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed], components: rows, files: [file] });
    } else {
      await interaction.update({ embeds: [embed], components: rows, files: [file] });
    }
  } catch (err) {
    // If update fails, try editing
    try {
      await interaction.editReply({ embeds: [embed], components: rows, files: [file] });
    } catch (e) {
      console.error('Failed to show main menu:', e.message);
    }
  }
}

module.exports = { showMainMenu };
