const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../utils/constants');
const { formatNumber, progressBar, chance, randomInt } = require('../utils/helpers');
const { handleFeedPet, handleSwapPet, handleEvolvePet, handleReleasePet } = require('../systems/pets');
const { getMenuImage } = require('../utils/image-helper');

// Tên tier tiếng Việt
const TIER_NAME = {
  pham: 'Phàm',
  linh: 'Linh',
  bao: 'Bảo',
  thanh: 'Thánh',
  tien: 'Tiên',
  than: 'Thần',
};

// Emoji theo tier
const TIER_EMOJI = {
  pham: '⚪',
  linh: '🟢',
  bao: '🔵',
  thanh: '🟣',
  tien: '🟡',
  than: '🔴',
};

/**
 * Pet Menu — Linh Thú management
 * Hiển thị danh sách linh thú, thông tin chi tiết pet đang mang
 */
async function showPetMenu(interaction, player) {
  const db = require('../database/connection');
  const petsConfig = require('../../config/pets');

  const pets = db.prepare('SELECT * FROM player_pets WHERE player_id = ?').all(player.id);
  const activePet = pets.find(p => p.is_active);

  // ═══ Xây dựng danh sách linh thú ═══
  let petList = '_Chưa có linh thú. Hãy đi bắt tại 🌍 Thế Giới > 🐾 Bắt Linh Thú!_';
  if (pets.length > 0) {
    petList = pets.map((p, i) => {
      const config = petsConfig.list.find(pc => pc.id === p.pet_id);
      const tierKey = config ? config.tier : 'pham';
      const tierLabel = TIER_NAME[tierKey] || tierKey;
      const tierEmoji = TIER_EMOJI[tierKey] || '⚪';
      const petEmoji = config ? config.emoji : '🐾';
      const petName = p.name || (config ? config.name : 'Unknown');
      const active = p.is_active ? ' ✅' : '';
      return `**${i + 1}.** ${petEmoji} ${petName} — ${tierEmoji} ${tierLabel} | Lv.**${p.level}**${active}`;
    }).join('\n');
  }

  // ═══ Chi tiết pet đang mang ═══
  let activePetInfo = '**Đang mang**: _Không có linh thú nào_';
  if (activePet) {
    const activeConfig = petsConfig.list.find(pc => pc.id === activePet.pet_id);
    const activeTier = activeConfig ? (TIER_NAME[activeConfig.tier] || activeConfig.tier) : '?';
    const activeTierEmoji = activeConfig ? (TIER_EMOJI[activeConfig.tier] || '') : '';
    const activeEmoji = activeConfig ? activeConfig.emoji : '🐾';
    const activeName = activePet.name || (activeConfig ? activeConfig.name : 'Linh Thú');

    // Tính max level và EXP cần
    const maxLevel = activeConfig ? activeConfig.max_level : 100;
    const expNeeded = activePet.level * 100; // EXP cần để lên level tiếp
    const expCurrent = activePet.exp || 0;
    const expBar = progressBar(expCurrent, expNeeded, 10);
    const expPercent = expNeeded > 0 ? Math.min(Math.floor((expCurrent / expNeeded) * 100), 100) : 0;

    // Kiểm tra tiến hóa
    const canEvolve = activeConfig && activeConfig.evolves_to && activePet.level >= (activeConfig.evolve_level || 999);
    const evolveInfo = activeConfig && activeConfig.evolves_to
      ? `\n🔄 Tiến hóa: Lv.**${activeConfig.evolve_level}** ${canEvolve ? '✅ **Sẵn sàng!**' : `(còn ${activeConfig.evolve_level - activePet.level} level)`}`
      : '\n🔄 Tiến hóa: _Đã đạt tối đa_';

    activePetInfo =
      `**Đang mang**: ${activeEmoji} **${activeName}**\n` +
      `🏷️ Hạng: ${activeTierEmoji} **${activeTier}** | Lv.**${activePet.level}**/${maxLevel}\n\n` +
      `❤️ HP: **${formatNumber(activePet.hp)}** | ⚔️ ATK: **${formatNumber(activePet.atk)}** | 🛡️ DEF: **${formatNumber(activePet.def)}**\n` +
      `✨ EXP: ${expBar} **${expPercent}%** (${formatNumber(expCurrent)}/${formatNumber(expNeeded)})` +
      evolveInfo;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.PET)
    .setTitle('🐾 Linh Thú Quản Lý')
    .setDescription(
      `╔══════════════════════════════════╗\n` +
      `║ 📋 **Danh Sách Linh Thú**\n` +
      `╠══════════════════════════════════╣\n` +
      `${petList}\n\n` +
      `╠══════════════════════════════════╣\n` +
      `║ 🎯 **Chi Tiết Pet Chiến Đấu**\n` +
      `╠══════════════════════════════════╣\n` +
      `${activePetInfo}\n` +
      `╚══════════════════════════════════╝`
    )
    .setFooter({ text: `${pets.length}/5 linh thú | Cho ăn để tăng EXP, tiến hóa khi đủ level` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pet:feed')
      .setLabel('🍖 Cho Ăn')
      .setStyle(ButtonStyle.Success)
      .setDisabled(pets.length === 0),
    new ButtonBuilder()
      .setCustomId('pet:swap')
      .setLabel('🔄 Đổi Pet')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pets.length <= 1),
    new ButtonBuilder()
      .setCustomId('pet:evolve')
      .setLabel('✨ Tiến Hóa')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pets.length === 0),
    new ButtonBuilder()
      .setCustomId('pet:release')
      .setLabel('👋 Phóng Sinh')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(pets.length === 0),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('pet');
  const updatePayload = { embeds: [embed], components: [row] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

/**
 * Catch pet encounter
 */
async function handleCatchPet(interaction, player) {
  const db = require('../database/connection');
  const petsConfig = require('../../config/pets');

  // Check if player has room for more pets
  const petCount = db.prepare('SELECT COUNT(*) as count FROM player_pets WHERE player_id = ?').get(player.id);
  if (petCount.count >= 5) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('🐾 Chuồng Đầy!')
      .setDescription('Bạn chỉ có thể nuôi tối đa **5 linh thú**. Hãy phóng sinh bớt!');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pet:menu').setLabel('🐾 Quản Lý Pet').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Find available pets based on realm
  const availablePets = petsConfig.list.filter(p => {
    const tierOrder = { 'Phàm': 0, 'Linh': 1, 'Bảo': 2, 'Thánh': 3, 'Tiên': 4, 'Thần': 5 };
    const petTier = tierOrder[p.tier] || 0;
    return petTier <= Math.floor(player.realm_index / 2);
  });

  if (availablePets.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('🔍 Không tìm thấy linh thú')
      .setDescription('Không có linh thú nào xuất hiện ở khu vực này.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('world:menu').setLabel('🌍 Thế Giới').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Pick random pet
  const pet = availablePets[Math.floor(Math.random() * availablePets.length)];

  // Capture chance based on tier
  const captureChance = pet.capture_rate || 50;
  const success = chance(captureChance);

  if (success) {
    // Add pet to player
    const isFirst = petCount.count === 0;
    db.prepare(
      'INSERT INTO player_pets (player_id, pet_id, name, level, exp, hp, atk, def, is_active) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)'
    ).run(player.id, pet.id, pet.name, pet.base_hp, pet.base_atk, pet.base_def, isFirst ? 1 : 0);

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle(`🐾 Bắt Thành Công!`)
      .setDescription(
        `Bạn đã bắt được ${pet.emoji} **${pet.name}**!\n\n` +
        `🏷️ Hạng: **${pet.tier}**\n` +
        `❤️ HP: **${pet.base_hp}** | ⚔️ ATK: **${pet.base_atk}** | 🛡️ DEF: **${pet.base_def}**\n\n` +
        (isFirst ? '✅ Tự động mang theo chiến đấu!' : 'Dùng 🔄 Đổi Pet để mang theo.')
      );

    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('world:catchpet').setLabel('🐾 Tiếp Tục Bắt').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('pet:menu').setLabel('🐾 Quản Lý').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  } else {
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle(`🐾 Bắt Thất Bại!`)
      .setDescription(
        `${pet.emoji} **${pet.name}** đã trốn thoát!\n\n` +
        `Tỷ lệ bắt: **${captureChance}%** — Hãy thử lại!`
      );

    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('world:catchpet').setLabel('🐾 Thử Lại').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('world:menu').setLabel('🌍 Thế Giới').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }
}

module.exports = {
  showPetMenu,
  handleCatchPet,
  handleFeedPet,
  handleSwapPet,
  handleEvolvePet,
  handleReleasePet,
};
