const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../utils/constants');
const { progressBar, formatNumber } = require('../utils/helpers');
const { getMenuImage } = require('../utils/image-helper');

/**
 * Profile Menu — shows player stats, equipment, skills, pets
 */
async function showProfileMenu(interaction, player) {
  const db = require('../database/connection');
  const realms = require('../../config/realms');
  const roots = require('../../config/spiritual-roots');
  const constitutions = require('../../config/constitutions');
  const techniques = require('../../config/techniques');

  const realm = realms.list[player.realm_index];
  const root = roots.list.find(r => r.id === player.spiritual_root);
  const constitution = constitutions.list.find(c => c.id === player.constitution);
  const technique = techniques.list.find(t => t.id === player.technique_id);
  const nextRealm = realms.list[player.realm_index + 1];

  const expNeeded = realm ? realm.exp_per_sub : 0;
  const expProgress = expNeeded > 0 ? progressBar(player.exp, expNeeded) : '██████████ MAX';

  const embed = new EmbedBuilder()
    .setColor(COLORS.profile)
    .setTitle(`👤 ${player.name}`)
    .setDescription(
      `${player.dao_path === 'ma' ? '😈 Ma Đạo' : '☀️ Chính Đạo'} Tu Sĩ\n` +
      `**Cảnh Giới**: ${realm ? realm.emoji : '🌟'} ${realm ? realm.name : 'Chí Tôn'} — Tầng ${player.sub_realm}/9\n` +
      `**Tu Vi**: ${expProgress} ${formatNumber(player.exp)}/${formatNumber(expNeeded)}`
    )
    .addFields(
      {
        name: '📊 Chỉ Số Cơ Bản',
        value: [
          `❤️ HP: **${formatNumber(player.hp)}**/${formatNumber(player.max_hp)}`,
          `⚔️ ATK: **${formatNumber(player.atk)}**`,
          `🛡️ DEF: **${formatNumber(player.def)}**`,
          `💨 Speed: **${formatNumber(player.speed)}**`,
          `🔮 Mana: **${formatNumber(player.mana)}**/${formatNumber(player.max_mana)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🌱 Thiên Phú',
        value: [
          `🌱 Linh Căn: **${root ? root.name : 'N/A'}** ${root ? root.emoji : ''}`,
          `💪 Thể Chất: **${constitution ? constitution.name : 'N/A'}**`,
          `📜 Công Pháp: **${technique ? technique.name : 'Cơ Bản Tâm Pháp'}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '💰 Tài Sản',
        value: [
          `💎 Linh Thạch: **${formatNumber(player.linh_thach)}**`,
          `✨ Tiên Thạch: **${formatNumber(player.tien_thach)}**`,
          `🏛️ Công Đức: **${formatNumber(player.cong_duc)}**`,
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: `Đại Giới: ${realm ? realm.tier : 'ĐỈNH PHONG'}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('profile:stats')
      .setLabel('📊 Chỉ Số Chi Tiết')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('profile:equipment')
      .setLabel('⚔️ Trang Bị')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('profile:skills')
      .setLabel('📜 Công Pháp & Kỹ Năng')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('profile:pets')
      .setLabel('🐾 Linh Thú')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('profile');
  const updatePayload = { embeds: [embed], components: [row] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

/**
 * Show detailed stats
 */
async function showDetailedStats(interaction, player) {
  const db = require('../database/connection');
  const realms = require('../../config/realms');
  const roots = require('../../config/spiritual-roots');
  const constitutions = require('../../config/constitutions');

  const realm = realms.list[player.realm_index];
  const root = roots.list.find(r => r.id === player.spiritual_root);
  const constitution = constitutions.list.find(c => c.id === player.constitution);

  const embed = new EmbedBuilder()
    .setColor(COLORS.profile)
    .setTitle(`📊 Chỉ Số Chi Tiết — ${player.name}`)
    .addFields(
      {
        name: '⚔️ Chiến Đấu',
        value: [
          `ATK: **${formatNumber(player.atk)}**`,
          `DEF: **${formatNumber(player.def)}**`,
          `Speed: **${formatNumber(player.speed)}**`,
          `Crit Rate: **5%**`,
          `Crit DMG: **150%**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '❤️ Sinh Tồn',
        value: [
          `HP: **${formatNumber(player.hp)}/${formatNumber(player.max_hp)}**`,
          `Mana: **${formatNumber(player.mana)}/${formatNumber(player.max_mana)}**`,
          `HP Regen: **${Math.floor(player.max_hp * 0.01)}/turn**`,
          `Mana Regen: **${Math.floor(player.max_mana * 0.02)}/turn**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🌱 Linh Căn Chi Tiết',
        value: root
          ? [
              `Tên: **${root.name}** ${root.emoji}`,
              `Nguyên Tố: **${root.element}**`,
              `Bonus: ${Object.entries(root.bonuses || {}).map(([k, v]) => `${k}: +${v}%`).join(', ')}`,
              `Nhược Điểm: ${Object.entries(root.weaknesses || {}).map(([k, v]) => `${k}: ${v}%`).join(', ')}`,
            ].join('\n')
          : 'Chưa có',
        inline: false,
      },
      {
        name: '💪 Thể Chất Chi Tiết',
        value: constitution
          ? [
              `Tên: **${constitution.name}**`,
              `Phẩm Cấp: **${constitution.rarity}**`,
              `Đặc Tính: ${constitution.special_ability || 'Không'}`,
            ].join('\n')
          : 'Phàm Thể',
        inline: false,
      }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('profile:main')
      .setLabel('🔙 Quay Lại Hồ Sơ')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Show equipped items
 */
async function showEquipment(interaction, player) {
  const db = require('../database/connection');
  const equipmentConfig = require('../../config/equipment');

  const equipped = db.prepare('SELECT * FROM player_equipment WHERE player_id = ?').all(player.id);

  const slots = {
    weapon: { emoji: '🗡️', name: 'Vũ Khí', item: null },
    armor: { emoji: '🛡️', name: 'Giáp', item: null },
    accessory: { emoji: '💍', name: 'Phụ Kiện', item: null },
    artifact: { emoji: '🔮', name: 'Pháp Bảo', item: null },
  };

  for (const eq of equipped) {
    const config = equipmentConfig.list.find(e => e.id === eq.equipment_id);
    if (config && slots[eq.slot]) {
      slots[eq.slot].item = { ...config, enhance_level: eq.enhance_level };
    }
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.profile)
    .setTitle(`⚔️ Trang Bị — ${player.name}`)
    .setDescription(
      Object.values(slots)
        .map(s => {
          if (s.item) {
            const enhance = s.item.enhance_level > 0 ? ` +${s.item.enhance_level}` : '';
            return `${s.emoji} **${s.name}**: ${s.item.name}${enhance} (${s.item.grade})`;
          }
          return `${s.emoji} **${s.name}**: _Trống_`;
        })
        .join('\n')
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('profile:main')
      .setLabel('🔙 Quay Lại Hồ Sơ')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Show equipped skills
 */
async function showSkills(interaction, player) {
  const db = require('../database/connection');
  const skillsConfig = require('../../config/skills');
  const techniques = require('../../config/techniques');

  const equippedSkills = db.prepare('SELECT * FROM player_skills WHERE player_id = ? ORDER BY slot').all(player.id);
  const technique = techniques.list.find(t => t.id === player.technique_id);

  let skillText = '';
  if (equippedSkills.length === 0) {
    skillText = '_Chưa trang bị kỹ năng nào_';
  } else {
    skillText = equippedSkills
      .map(s => {
        const config = skillsConfig.list.find(sk => sk.id === s.skill_id);
        const slotLabel = s.slot <= 4 ? `Active ${s.slot}` : `Passive ${s.slot - 4}`;
        return config
          ? `**[${slotLabel}]** ${config.emoji || '⚔️'} ${config.name} (Lv.${s.level}) — ${config.type}`
          : `**[${slotLabel}]** ??? — Không xác định`;
      })
      .join('\n');
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.cultivation)
    .setTitle(`📜 Công Pháp & Kỹ Năng — ${player.name}`)
    .addFields(
      {
        name: '📖 Công Pháp Đang Tu',
        value: technique
          ? `**${technique.name}** (${technique.grade})\nEXP Bonus: +${technique.exp_bonus}%\n${technique.description || ''}`
          : '**Cơ Bản Tâm Pháp** (Phàm)\nEXP Bonus: +0%',
        inline: false,
      },
      {
        name: '⚔️ Kỹ Năng Trang Bị',
        value: skillText,
        inline: false,
      }
    )
    .setFooter({ text: 'Tối đa: 4 Active + 2 Passive' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('profile:main')
      .setLabel('🔙 Quay Lại Hồ Sơ')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Show player's pets
 */
async function showPets(interaction, player) {
  const db = require('../database/connection');
  const petsConfig = require('../../config/pets');

  const pets = db.prepare('SELECT * FROM player_pets WHERE player_id = ?').all(player.id);

  let petText = '';
  if (pets.length === 0) {
    petText = '_Chưa có linh thú nào. Hãy đi bắt tại 🌍 Thế Giới!_';
  } else {
    petText = pets
      .map(p => {
        const config = petsConfig.list.find(pc => pc.id === p.pet_id);
        const active = p.is_active ? ' ✅ **ĐANG MANG**' : '';
        return config
          ? `${config.emoji} **${p.name || config.name}** (Lv.${p.level}) — ${config.tier}${active}\n  HP: ${p.hp} | ATK: ${p.atk} | DEF: ${p.def}`
          : `❓ **${p.name || 'Unknown'}** (Lv.${p.level})${active}`;
      })
      .join('\n\n');
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.profile)
    .setTitle(`🐾 Linh Thú — ${player.name}`)
    .setDescription(petText)
    .setFooter({ text: `${pets.length}/5 linh thú | Mang theo tối đa 1 con` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('profile:main')
      .setLabel('🔙 Quay Lại Hồ Sơ')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

module.exports = {
  showProfileMenu,
  showDetailedStats,
  showEquipment,
  showSkills,
  showPets,
};
