/**
 * @file Skills Management System
 * @description Quản lý kỹ năng chiến đấu — học, trang bị, xem, tháo
 *
 * Slots: 1-4 = chủ động (active), 5-6 = bị động (passive)
 * Người chơi bắt đầu KHÔNG có kỹ năng — phải học từ sách kỹ năng
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const db = require('../database/connection');
const { getSkillById } = require('../../config/skills');
const { getItemById } = require('../../config/items');
const { COLORS, MAX_SKILL_SLOTS } = require('../utils/constants');
const { formatNumber } = require('../utils/helpers');

// ═══════════════════════════════════════════
//  Prepared Statements (cache 1 lần duy nhất)
// ═══════════════════════════════════════════

/** Lấy tất cả kỹ năng đã học */
const stmtGetLearned = db.prepare(
  'SELECT skill_id, level FROM learned_skills WHERE player_id = ?',
);

/** Kiểm tra kỹ năng đã học chưa */
const stmtHasSkill = db.prepare(
  'SELECT 1 FROM learned_skills WHERE player_id = ? AND skill_id = ?',
);

/** Thêm kỹ năng mới vào danh sách đã học */
const stmtLearnSkill = db.prepare(
  'INSERT INTO learned_skills (player_id, skill_id, level) VALUES (?, ?, 1)',
);

/** Lấy tất cả kỹ năng đã trang bị */
const stmtGetEquipped = db.prepare(
  'SELECT skill_id, slot, level, cooldown_remaining FROM player_skills WHERE player_id = ?',
);

/** Trang bị kỹ năng vào slot */
const stmtEquipSkill = db.prepare(
  'INSERT OR REPLACE INTO player_skills (player_id, skill_id, slot, level, cooldown_remaining) VALUES (?, ?, ?, ?, 0)',
);

/** Tháo kỹ năng khỏi slot */
const stmtUnequipSkill = db.prepare(
  'DELETE FROM player_skills WHERE player_id = ? AND slot = ?',
);

/** Kiểm tra slot đã có kỹ năng chưa */
const stmtGetSlot = db.prepare(
  'SELECT skill_id FROM player_skills WHERE player_id = ? AND slot = ?',
);

/** Lấy item từ inventory */
const stmtGetInvItem = db.prepare(
  'SELECT quantity FROM inventory WHERE player_id = ? AND item_id = ?',
);

/** Giảm số lượng item */
const stmtReduceItem = db.prepare(
  'UPDATE inventory SET quantity = quantity - 1 WHERE player_id = ? AND item_id = ?',
);

/** Xóa item hết số lượng */
const stmtDeleteItem = db.prepare(
  'DELETE FROM inventory WHERE player_id = ? AND item_id = ? AND quantity <= 0',
);

/** Lấy level kỹ năng đã học */
const stmtGetLearnedLevel = db.prepare(
  'SELECT level FROM learned_skills WHERE player_id = ? AND skill_id = ?',
);

// ═══════════════════════════════════════════
//  Hằng số hiển thị
// ═══════════════════════════════════════════

/** Emoji loại kỹ năng */
const TYPE_EMOJI = {
  attack: '⚔️',
  defense: '🛡️',
  buff: '💪',
  debuff: '☠️',
  heal: '💚',
  ultimate: '🌀',
};

/** Tên loại kỹ năng */
const TYPE_NAME = {
  attack: 'Tấn Công',
  defense: 'Phòng Thủ',
  buff: 'Tăng Cường',
  debuff: 'Suy Yếu',
  heal: 'Hồi Phục',
  ultimate: 'Tuyệt Chiêu',
};

/** Grade tiếng Việt */
const GRADE_NAME = {
  pham: 'Phàm',
  linh: 'Linh',
  bao: 'Bảo',
  thanh: 'Thánh',
  tien: 'Tiên',
  than: 'Thần',
};

// ═══════════════════════════════════════════
//  showSkillsMenu — Hiển thị menu kỹ năng
// ═══════════════════════════════════════════

/**
 * Hiển thị menu kỹ năng: 6 slot + danh sách đã học + nút quản lý
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi từ DB
 */
async function showSkillsMenu(interaction, player) {
  const equipped = stmtGetEquipped.all(player.id);
  const learned = stmtGetLearned.all(player.id);

  // Xây dựng hiển thị 6 slot
  let slotsDisplay = '';
  for (let slot = 1; slot <= MAX_SKILL_SLOTS; slot++) {
    const slotType = slot <= 4 ? '⚔️ Chủ Động' : '🔮 Bị Động';
    const eq = equipped.find(e => e.slot === slot);

    if (eq) {
      const skillData = getSkillById(eq.skill_id);
      if (skillData) {
        slotsDisplay += `\`Slot ${slot}\` ${slotType} — ${skillData.emoji} **${skillData.name}** (Lv.${eq.level})\n`;
      } else {
        slotsDisplay += `\`Slot ${slot}\` ${slotType} — ❓ Kỹ năng không xác định\n`;
      }
    } else {
      slotsDisplay += `\`Slot ${slot}\` ${slotType} — _Trống_\n`;
    }
  }

  // Danh sách kỹ năng đã học
  let learnedDisplay = '';
  if (learned.length === 0) {
    learnedDisplay = '_Chưa học kỹ năng nào. Hãy sử dụng sách kỹ năng!_';
  } else {
    for (const ls of learned) {
      const skillData = getSkillById(ls.skill_id);
      if (skillData) {
        const isEquipped = equipped.some(e => e.skill_id === ls.skill_id);
        const tag = isEquipped ? ' ✅' : '';
        learnedDisplay += `${skillData.emoji} **${skillData.name}** — ${TYPE_NAME[skillData.type] || skillData.type} | ${GRADE_NAME[skillData.grade] || skillData.grade} Cấp (Lv.${ls.level})${tag}\n`;
      }
    }
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.COMBAT)
    .setTitle('💫 Kỹ Năng Chiến Đấu')
    .setDescription(
      `**${player.name}** — Kỹ năng: **${learned.length}** đã học | **${equipped.length}**/${MAX_SKILL_SLOTS} trang bị\n\n` +
      `╔══════════════════════════════════╗\n` +
      `║ 📋 **Slot Trang Bị**\n` +
      `╠══════════════════════════════════╣\n` +
      `${slotsDisplay}\n` +
      `╠══════════════════════════════════╣\n` +
      `║ 📚 **Kỹ Năng Đã Học**\n` +
      `╠══════════════════════════════════╣\n` +
      `${learnedDisplay}\n` +
      `╚══════════════════════════════════╝`
    )
    .setFooter({ text: 'Slot 1-4: Chủ động | Slot 5-6: Bị động' })
    .setTimestamp();

  // Nút quản lý
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('skills:equip')
      .setLabel('📥 Trang Bị')
      .setStyle(ButtonStyle.Success)
      .setDisabled(learned.length === 0),
    new ButtonBuilder()
      .setCustomId('skills:unequip')
      .setLabel('📤 Tháo Gỡ')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(equipped.length === 0),
    new ButtonBuilder()
      .setCustomId('combat:menu')
      .setLabel('🔙 Chiến Trường')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🏠 Menu Chính')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

// ═══════════════════════════════════════════
//  handleLearnSkill — Học kỹ năng từ sách
// ═══════════════════════════════════════════

/**
 * Sử dụng sách kỹ năng để học kỹ năng mới
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 * @param {string} skillBookItemId - ID item sách kỹ năng trong inventory
 */
async function handleLearnSkill(interaction, player, skillBookItemId) {
  // Kiểm tra item trong inventory
  const invItem = stmtGetInvItem.get(player.id, skillBookItemId);
  if (!invItem || invItem.quantity <= 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Không có vật phẩm')
      .setDescription('Bạn không có sách kỹ năng này trong kho đồ.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Lấy thông tin item sách kỹ năng
  const itemConfig = getItemById(skillBookItemId);
  if (!itemConfig || itemConfig.type !== 'skill_book') {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Vật phẩm không hợp lệ')
      .setDescription('Đây không phải sách kỹ năng.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Lấy skill_id từ effect của sách
  const skillId = itemConfig.effect?.learn_skill;
  if (!skillId) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Sách bị lỗi')
      .setDescription('Sách kỹ năng này không chứa dữ liệu kỹ năng.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Kiểm tra kỹ năng có tồn tại trong config không
  const skillData = getSkillById(skillId);
  if (!skillData) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Kỹ năng không tồn tại')
      .setDescription('Kỹ năng trong sách không có trong hệ thống.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Kiểm tra cảnh giới tối thiểu
  if (player.realm_index < skillData.min_realm) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Cảnh giới chưa đủ')
      .setDescription(
        `Kỹ năng **${skillData.name}** yêu cầu cảnh giới tối thiểu **${skillData.min_realm}**.\n` +
        `Cảnh giới hiện tại của bạn: **${player.realm_index}**`
      );
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Kiểm tra đã học chưa
  const alreadyLearned = stmtHasSkill.get(player.id, skillId);
  if (alreadyLearned) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Đã học rồi')
      .setDescription(`Bạn đã lĩnh ngộ **${skillData.name}** từ trước.`);
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skills:menu').setLabel('💫 Kỹ Năng').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Tiêu thụ sách kỹ năng và học kỹ năng (transaction)
  const learnTransaction = db.transaction(() => {
    stmtReduceItem.run(player.id, skillBookItemId);
    stmtDeleteItem.run(player.id, skillBookItemId);
    stmtLearnSkill.run(player.id, skillId);
  });
  learnTransaction();

  // Hiển thị kết quả
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('📖 Lĩnh Ngộ Thành Công!')
    .setDescription(
      `${skillData.emoji} Bạn đã học được **${skillData.name}**!\n\n` +
      `📋 Loại: ${TYPE_NAME[skillData.type] || skillData.type}\n` +
      `🏷️ Cấp bậc: ${GRADE_NAME[skillData.grade] || skillData.grade}\n` +
      `🎯 Mục tiêu: ${skillData.target || 'single'}\n` +
      `${skillData.description}\n\n` +
      `_Hãy vào menu kỹ năng để trang bị vào slot chiến đấu!_`
    )
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('skills:menu').setLabel('💫 Kỹ Năng').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

// ═══════════════════════════════════════════
//  handleEquipSkill — Trang bị kỹ năng vào slot
// ═══════════════════════════════════════════

/**
 * Trang bị kỹ năng đã học vào một slot
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 * @param {string} skillId - ID kỹ năng cần trang bị
 * @param {number} slot - Vị trí slot (1-6)
 */
async function handleEquipSkill(interaction, player, skillId, slot) {
  // Validate slot
  if (slot < 1 || slot > MAX_SKILL_SLOTS) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Slot không hợp lệ')
      .setDescription(`Slot phải từ 1 đến ${MAX_SKILL_SLOTS}.`);
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Kiểm tra kỹ năng đã học chưa
  const learned = stmtHasSkill.get(player.id, skillId);
  if (!learned) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Chưa học kỹ năng')
      .setDescription('Bạn chưa học kỹ năng này.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  const skillData = getSkillById(skillId);
  if (!skillData) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Kỹ năng không tồn tại')
      .setDescription('Kỹ năng không có trong hệ thống.');
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Lấy level kỹ năng đã học
  const learnedData = stmtGetLearnedLevel.get(player.id, skillId);
  const skillLevel = learnedData ? learnedData.level : 1;

  // Kiểm tra kỹ năng có đang được trang bị ở slot khác không
  const equipped = stmtGetEquipped.all(player.id);
  const existingSlot = equipped.find(e => e.skill_id === skillId);
  if (existingSlot) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Đã trang bị')
      .setDescription(`**${skillData.name}** đã nằm ở Slot ${existingSlot.slot}. Hãy tháo trước khi chuyển.`);
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Trang bị kỹ năng (sẽ thay thế kỹ năng cũ nếu slot đã có)
  stmtEquipSkill.run(player.id, skillId, slot, skillLevel);

  const slotType = slot <= 4 ? 'Chủ Động' : 'Bị Động';
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('📥 Trang Bị Thành Công!')
    .setDescription(
      `${skillData.emoji} **${skillData.name}** (Lv.${skillLevel}) đã được trang bị vào **Slot ${slot}** (${slotType})`
    )
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('skills:menu').setLabel('💫 Kỹ Năng').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('combat:menu').setLabel('⚔️ Chiến Trường').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

// ═══════════════════════════════════════════
//  handleUnequipSkill — Tháo kỹ năng khỏi slot
// ═══════════════════════════════════════════

/**
 * Tháo kỹ năng khỏi slot
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi
 * @param {number} slot - Vị trí slot (1-6)
 */
async function handleUnequipSkill(interaction, player, slot) {
  if (slot < 1 || slot > MAX_SKILL_SLOTS) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Slot không hợp lệ')
      .setDescription(`Slot phải từ 1 đến ${MAX_SKILL_SLOTS}.`);
    return interaction.update({ embeds: [embed], components: [] });
  }

  // Kiểm tra slot có kỹ năng không
  const slotData = stmtGetSlot.get(player.id, slot);
  if (!slotData) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Slot trống')
      .setDescription(`Slot ${slot} không có kỹ năng nào để tháo.`);
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  const skillData = getSkillById(slotData.skill_id);
  stmtUnequipSkill.run(player.id, slot);

  const skillName = skillData ? skillData.name : 'Không xác định';
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📤 Tháo Gỡ Thành Công')
    .setDescription(`Đã tháo **${skillName}** khỏi Slot ${slot}.`)
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('skills:menu').setLabel('💫 Kỹ Năng').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('combat:menu').setLabel('⚔️ Chiến Trường').setStyle(ButtonStyle.Secondary)
    )
  ]});
}

// ═══════════════════════════════════════════
//  getEquippedSkills — Lấy kỹ năng trang bị cho combat engine
// ═══════════════════════════════════════════

/**
 * Lấy danh sách kỹ năng đang trang bị, kèm config data
 * @param {number} playerId - ID người chơi
 * @returns {Array<Object>} - Mảng kỹ năng {slot, level, ...skillConfig}
 */
function getEquippedSkills(playerId) {
  const equipped = stmtGetEquipped.all(playerId);
  return equipped.map(eq => {
    const skillConfig = getSkillById(eq.skill_id);
    return {
      slot: eq.slot,
      level: eq.level,
      cooldown_remaining: eq.cooldown_remaining,
      ...skillConfig,
    };
  }).filter(s => s.id); // Loại bỏ kỹ năng bị null config
}

// ═══════════════════════════════════════════
//  getLearnedSkills — Lấy kỹ năng đã học cho hiển thị
// ═══════════════════════════════════════════

/**
 * Lấy danh sách kỹ năng đã học, kèm config data
 * @param {number} playerId - ID người chơi
 * @returns {Array<Object>} - Mảng kỹ năng {level, ...skillConfig}
 */
function getLearnedSkills(playerId) {
  const learned = stmtGetLearned.all(playerId);
  return learned.map(ls => {
    const skillConfig = getSkillById(ls.skill_id);
    return {
      level: ls.level,
      ...skillConfig,
    };
  }).filter(s => s.id); // Loại bỏ kỹ năng bị null config
}

module.exports = {
  showSkillsMenu,
  handleLearnSkill,
  handleEquipSkill,
  handleUnequipSkill,
  getEquippedSkills,
  getLearnedSkills,
  showEquipSelectMenu,
  showUnequipSelectMenu,
};

// ═══════════════════════════════════════════
//  showEquipSelectMenu — Hiển thị menu chọn kỹ năng để trang bị
// ═══════════════════════════════════════════

/**
 * Hiển thị StringSelectMenu các kỹ năng đã học nhưng chưa trang bị
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi từ DB
 */
async function showEquipSelectMenu(interaction, player) {
  const learned = stmtGetLearned.all(player.id);
  const equipped = stmtGetEquipped.all(player.id);

  // Lọc kỹ năng đã học nhưng chưa trang bị
  const equippedIds = new Set(equipped.map(e => e.skill_id));
  const available = learned
    .filter(ls => !equippedIds.has(ls.skill_id))
    .map(ls => {
      const skillData = getSkillById(ls.skill_id);
      return skillData ? { ...skillData, level: ls.level } : null;
    })
    .filter(Boolean);

  if (available.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Không có kỹ năng khả dụng')
      .setDescription(
        learned.length === 0
          ? 'Bạn chưa học kỹ năng nào. Hãy sử dụng sách kỹ năng!'
          : 'Tất cả kỹ năng đã học đều đang được trang bị.'
      );
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Tìm slot trống tiếp theo
  const occupiedSlots = new Set(equipped.map(e => e.slot));
  let nextSlot = null;
  for (let s = 1; s <= MAX_SKILL_SLOTS; s++) {
    if (!occupiedSlots.has(s)) {
      nextSlot = s;
      break;
    }
  }

  if (nextSlot === null) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Hết slot trống')
      .setDescription('Tất cả 6 slot đã đầy. Hãy tháo bớt kỹ năng trước khi trang bị mới.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skills:unequip').setLabel('📤 Tháo Gỡ').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Xây dựng StringSelectMenu
  const options = available.slice(0, 25).map(skill => ({
    label: `${skill.name} (Lv.${skill.level})`,
    description: `${TYPE_NAME[skill.type] || skill.type} | ${GRADE_NAME[skill.grade] || skill.grade} Cấp → Slot ${nextSlot}`,
    value: `${skill.id}:${nextSlot}`,
    emoji: skill.emoji || '💫',
  }));

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select:equip_skill')
      .setPlaceholder('Chọn kỹ năng để trang bị...')
      .addOptions(options)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
  );

  const slotType = nextSlot <= 4 ? 'Chủ Động' : 'Bị Động';
  const embed = new EmbedBuilder()
    .setColor(COLORS.COMBAT)
    .setTitle('📥 Trang Bị Kỹ Năng')
    .setDescription(
      `Chọn kỹ năng để trang bị vào **Slot ${nextSlot}** (${slotType}):\n\n` +
      `📋 Có **${available.length}** kỹ năng khả dụng`
    );

  await interaction.update({ embeds: [embed], components: [selectRow, backRow] });
}

// ═══════════════════════════════════════════
//  showUnequipSelectMenu — Hiển thị menu chọn kỹ năng để tháo
// ═══════════════════════════════════════════

/**
 * Hiển thị StringSelectMenu các kỹ năng đang trang bị để chọn tháo
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi từ DB
 */
async function showUnequipSelectMenu(interaction, player) {
  const equipped = stmtGetEquipped.all(player.id);

  if (equipped.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Không có kỹ năng để tháo')
      .setDescription('Bạn chưa trang bị kỹ năng nào.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  const options = equipped.map(eq => {
    const skillData = getSkillById(eq.skill_id);
    const slotType = eq.slot <= 4 ? 'Chủ Động' : 'Bị Động';
    return {
      label: `Slot ${eq.slot}: ${skillData ? skillData.name : 'Không xác định'} (Lv.${eq.level})`,
      description: `${slotType} — ${skillData ? (TYPE_NAME[skillData.type] || skillData.type) : '???'}`,
      value: `${eq.slot}`,
      emoji: skillData?.emoji || '💫',
    };
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select:unequip_skill')
      .setPlaceholder('Chọn slot để tháo kỹ năng...')
      .addOptions(options)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('skills:menu').setLabel('🔙 Kỹ Năng').setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.COMBAT)
    .setTitle('📤 Tháo Gỡ Kỹ Năng')
    .setDescription(
      `Chọn slot để tháo kỹ năng:\n\n` +
      `⚔️ Đang trang bị: **${equipped.length}**/${MAX_SKILL_SLOTS} slot`
    );

  await interaction.update({ embeds: [embed], components: [selectRow, backRow] });
}
