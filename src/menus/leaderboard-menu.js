const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../utils/constants');
const { formatNumber } = require('../utils/helpers');
const { getMenuImage } = require('../utils/image-helper');

/**
 * Leaderboard Menu — Bảng Xếp Hạng
 */
async function showLeaderboardMenu(interaction, player) {
  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('📊 Bảng Xếp Hạng')
    .setDescription('Chọn bảng xếp hạng muốn xem:')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('leaderboard:realm')
      .setLabel('🏆 Cảnh Giới')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('leaderboard:power')
      .setLabel('⚔️ Chiến Lực')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('leaderboard:wealth')
      .setLabel('💰 Tài Sản')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('leaderboard:sect')
      .setLabel('🏛️ Tông Môn')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('leaderboard');
  const updatePayload = { embeds: [embed], components: [row] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

/**
 * Show specific leaderboard
 */
async function showLeaderboard(interaction, type) {
  const db = require('../database/connection');
  const realms = require('../../config/realms');

  let title, query, formatter;

  switch (type) {
    case 'realm':
      title = '🏆 Bảng Xếp Hạng — Cảnh Giới';
      query = 'SELECT * FROM players WHERE is_dead = 0 ORDER BY realm_index DESC, sub_realm DESC, exp DESC LIMIT 10';
      formatter = (p, i) => {
        const realm = realms.list[p.realm_index];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${p.name} — ${realm ? realm.emoji : '🌟'} ${realm ? realm.name : 'Chí Tôn'} T${p.sub_realm}`;
      };
      break;

    case 'power':
      title = '⚔️ Bảng Xếp Hạng — Chiến Lực';
      query = 'SELECT *, (atk + def + speed + max_hp/10) as power FROM players WHERE is_dead = 0 ORDER BY power DESC LIMIT 10';
      formatter = (p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${p.name} — ⚔️ ${formatNumber(p.power || p.atk + p.def + p.speed)}`;
      };
      break;

    case 'wealth':
      title = '💰 Bảng Xếp Hạng — Tài Sản';
      query = 'SELECT *, (linh_thach + tien_thach * 100) as wealth FROM players WHERE is_dead = 0 ORDER BY wealth DESC LIMIT 10';
      formatter = (p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${p.name} — 💎 ${formatNumber(p.linh_thach)} | ✨ ${formatNumber(p.tien_thach)}`;
      };
      break;

    case 'sect':
      title = '🏛️ Bảng Xếp Hạng — Tông Môn';
      query = 'SELECT * FROM sects ORDER BY level DESC, treasury DESC LIMIT 10';
      formatter = (s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        const mCount = db.prepare('SELECT COUNT(*) as count FROM sect_members WHERE sect_id = ?').get(s.id).count;
        return `${medal} **${s.name}** — Cấp **${s.level}** | Đệ tử: **${mCount}**/${s.max_members} | Kho: 💎 **${formatNumber(s.treasury)}**`;
      };
      break;

    default:
      return;
  }

  const data = db.prepare(query).all();

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle(title)
    .setDescription(
      data.length > 0
        ? data.map(formatter).join('\n')
        : '_Chưa có ai trên bảng xếp hạng._'
    )
    .setFooter({ text: type === 'sect' ? 'Top 10 Tông Môn' : 'Top 10 Tu Sĩ' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('leaderboard:menu')
      .setLabel('🔙 Bảng Xếp Hạng')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🏠 Menu Chính')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

module.exports = {
  showLeaderboardMenu,
  showLeaderboard,
};
