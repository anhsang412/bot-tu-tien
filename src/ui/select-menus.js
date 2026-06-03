const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { EMOJIS } = require('../utils/constants');

/**
 * Menu chọn linh căn — nhúng daoPath và name vào customId
 * @param {string} daoPath - 'chinh' hoặc 'ma'
 * @param {string} name - tên nhân vật
 */
function createSpiritualRootSelect(daoPath = 'chinh', name = 'Unknown') {
  const options = [
    { label: 'Hỏa Linh Căn', description: 'Lửa — ATK +15%, EXP +10%', value: 'hoa', emoji: '🔥' },
    { label: 'Thủy Linh Căn', description: 'Nước — HP +15%, Hồi phục +20%', value: 'thuy', emoji: '💧' },
    { label: 'Mộc Linh Căn', description: 'Gỗ — Luyện đan +20%, HP regen', value: 'moc', emoji: '🌿' },
    { label: 'Lôi Linh Căn', description: 'Sấm — Speed +20%, Crit +10%', value: 'loi', emoji: '⚡' },
    { label: 'Thổ Linh Căn', description: 'Đất — DEF +20%, HP +10%', value: 'tho', emoji: '🪨' },
    { label: 'Phong Linh Căn', description: 'Gió — Speed +25%, Dodge +15%', value: 'phong', emoji: '🌀' },
    { label: 'Băng Linh Căn', description: 'Băng — ATK +10%, Freeze chance', value: 'bang', emoji: '❄️' },
    { label: 'Quang Linh Căn', description: 'Sáng — DEF +15%, Tịnh hóa', value: 'quang', emoji: '☀️' },
  ];

  // Âm Linh Căn chỉ cho Ma Đạo
  if (daoPath === 'ma') {
    options.push({ label: 'Âm Linh Căn', description: 'Tối (Ma Đạo) — ATK +20%, Hút máu', value: 'am', emoji: '🌑' });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`select:root:${daoPath}:${name}`)
    .setPlaceholder('🌱 Chọn Linh Căn của ngươi...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

/**
 * Menu chọn thể chất đã roll
 */
function createConstitutionSelect(results) {
  const rarityEmoji = {
    common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣',
    legendary: '🟡', mythic: '🔴', divine: '✨',
  };

  const options = results.map(r => ({
    label: r.name,
    description: `Phẩm chất: ${r.rarity}`,
    value: r.id,
    emoji: rarityEmoji[r.rarity] || '⚪',
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('select:constitution')
    .setPlaceholder('💪 Chọn Thể Chất...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(select)];
}

/**
 * Menu chọn khu vực săn quái theo cảnh giới
 */
function createHuntingZoneSelect(playerRealm = 0) {
  const zones = [
    { label: 'Rừng Ngoại Ô', description: 'Quái yếu, an toàn', value: 'zone_forest', emoji: '🌲', minRealm: 0 },
    { label: 'Hang Động Tối', description: 'Quái trung bình', value: 'zone_cave', emoji: '🕳️', minRealm: 0 },
    { label: 'Đầm Lầy Độc', description: 'Quái độc, nguy hiểm', value: 'zone_swamp', emoji: '🐍', minRealm: 1 },
    { label: 'Núi Linh Thú', description: 'Linh thú mạnh', value: 'zone_mountain', emoji: '🏔️', minRealm: 2 },
    { label: 'Vực Sâu Ma Quái', description: 'Ma quái hung tàn', value: 'zone_abyss', emoji: '👹', minRealm: 3 },
    { label: 'Di Tích Cổ Xưa', description: 'Boss cổ đại', value: 'zone_ruins', emoji: '🏛️', minRealm: 5 },
  ];

  const available = zones.filter(z => playerRealm >= z.minRealm);

  const select = new StringSelectMenuBuilder()
    .setCustomId('select:zone')
    .setPlaceholder('🗺️ Chọn khu vực săn quái...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(available.map(z => ({
      label: z.label, description: z.description, value: z.value, emoji: z.emoji,
    })));

  return [new ActionRowBuilder().addComponents(select)];
}

/**
 * Menu chọn loại quái vật
 */
function createMonsterTypeSelect() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('select:monster_type')
    .setPlaceholder('👹 Chọn loại quái...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([
      { label: 'Yêu Thú', description: 'Drop nguyên liệu', value: 'beast', emoji: '🐺' },
      { label: 'Ma Vật', description: 'Drop ma thạch', value: 'demon', emoji: '👿' },
      { label: 'Linh Thú', description: 'Có thể bắt làm pet', value: 'spirit', emoji: '🐉' },
      { label: 'Boss Khu Vực', description: 'Thưởng lớn', value: 'boss', emoji: '💀' },
    ]);

  return [new ActionRowBuilder().addComponents(select)];
}

/**
 * Menu sử dụng vật phẩm
 */
function createItemUseSelect(items) {
  if (!items || items.length === 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('select:item_use')
      .setPlaceholder('📦 Không có vật phẩm nào')
      .setDisabled(true)
      .addOptions([{ label: 'Trống', value: 'empty' }]);
    return [new ActionRowBuilder().addComponents(select)];
  }

  const options = items.slice(0, 25).map(item => ({
    label: `${item.name} (x${item.quantity})`,
    description: item.description || `ID: ${item.id}`,
    value: String(item.id),
    emoji: item.emoji || EMOJIS.ITEM,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('select:item_use')
    .setPlaceholder('📦 Chọn vật phẩm...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(select)];
}

/**
 * Menu swap kỹ năng
 */
function createSkillSwapSelect(learnedSkills) {
  if (!learnedSkills || learnedSkills.length === 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('select:skill_swap')
      .setPlaceholder('💫 Chưa học kỹ năng nào')
      .setDisabled(true)
      .addOptions([{ label: 'Trống', value: 'empty' }]);
    return [new ActionRowBuilder().addComponents(select)];
  }

  const options = learnedSkills.slice(0, 25).map(skill => ({
    label: `${skill.name} (Lv.${skill.level})`,
    value: String(skill.skill_id),
    emoji: EMOJIS.SKILL,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('select:skill_swap')
    .setPlaceholder('💫 Chọn kỹ năng...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(select)];
}

/**
 * Menu chọn linh thú
 */
function createPetSelect(pets) {
  if (!pets || pets.length === 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('select:pet')
      .setPlaceholder('🐉 Chưa có linh thú nào')
      .setDisabled(true)
      .addOptions([{ label: 'Trống', value: 'empty' }]);
    return [new ActionRowBuilder().addComponents(select)];
  }

  const options = pets.slice(0, 25).map(pet => ({
    label: `${pet.name} (Lv.${pet.level})${pet.is_active ? ' ★' : ''}`,
    description: pet.is_active ? 'Đang xuất chiến' : 'Trong chuồng',
    value: String(pet.id),
    emoji: EMOJIS.PET,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('select:pet')
    .setPlaceholder('🐉 Chọn linh thú...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(select)];
}

module.exports = {
  createSpiritualRootSelect,
  createConstitutionSelect,
  createHuntingZoneSelect,
  createMonsterTypeSelect,
  createItemUseSelect,
  createSkillSwapSelect,
  createPetSelect,
};
