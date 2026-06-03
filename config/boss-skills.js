/**
 * @file Boss Combat Skills (Kỹ Năng Chiến Đấu Boss)
 * @description Kỹ năng riêng của Boss, không thể học bởi người chơi.
 *
 * Bosses have infinite mana → mana_cost: 0 for all skills.
 * Format follows config/skills.js pattern.
 *
 * Bosses:
 *  - Thao Thiết (realm 8)    : devour, roar
 *  - Tiên Long   (realm 12)  : dragon_breath, tail_sweep, dragon_roar
 *  - Phượng Hoàng (realm 14) : nirvana_flame, phoenix_rebirth, feather_storm
 *  - Thiên Ma    (realm 20)  : dark_domain, soul_destroy, demon_army, ultimate_darkness
 */

const bossSkills = [
  // ═══════════════════════════════════════════
  //  THAO THIẾT (Realm 8, ATK 350)
  // ═══════════════════════════════════════════
  {
    id: 'devour',
    name: 'Nuốt Chửng',
    emoji: '👄',
    type: 'attack',
    element: 'neutral',
    damage_multiplier: 2.5,
    cooldown: 4,
    mana_cost: 0,
    target: 'single',
    extra_effect: { life_steal_percent: 30 },
    description: 'Thao Thiết mở rộng cự khẩu nuốt chửng mục tiêu. Gây 2.5x sát thương và hút 30% thành HP.',
  },
  {
    id: 'roar',
    name: 'Hống Thanh',
    emoji: '📢',
    type: 'debuff',
    element: 'neutral',
    cooldown: 5,
    mana_cost: 0,
    target: 'single',
    effect: { atk_reduction_percent: 20, stun_chance: 15, duration: 2 },
    description: 'Thao Thiết gầm vang trời đất, giảm 20% ATK kẻ địch, 15% cơ hội choáng.',
  },

  // ═══════════════════════════════════════════
  //  TIÊN LONG (Realm 12, ATK 1200)
  // ═══════════════════════════════════════════
  {
    id: 'dragon_breath',
    name: 'Long Tức',
    emoji: '🐉',
    type: 'attack',
    element: 'fire',
    damage_multiplier: 3.0,
    cooldown: 5,
    mana_cost: 0,
    target: 'single',
    extra_effect: { burn_damage_percent: 8, burn_duration: 3 },
    description: 'Tiên Long phun hỏa tức thiêu đốt vạn vật. Gây 3.0x sát thương hỏa và thiêu đốt 8% ATK/lượt trong 3 lượt.',
  },
  {
    id: 'tail_sweep',
    name: 'Vĩ Quét',
    emoji: '🌊',
    type: 'attack',
    element: 'neutral',
    damage_multiplier: 2.0,
    cooldown: 3,
    mana_cost: 0,
    target: 'single',
    extra_effect: { stun_chance: 30, stun_duration: 1 },
    description: 'Tiên Long quét đuôi rồng. Gây 2.0x sát thương, 30% cơ hội choáng 1 lượt.',
  },
  {
    id: 'dragon_roar',
    name: 'Long Hống',
    emoji: '🔱',
    type: 'buff',
    element: 'neutral',
    cooldown: 6,
    mana_cost: 0,
    target: 'self',
    effect: { atk_bonus_percent: 30, def_bonus_percent: 20, duration: 3 },
    description: 'Tiên Long hống thiên, long uy bùng phát. Tăng 30% ATK và 20% DEF trong 3 lượt.',
  },

  // ═══════════════════════════════════════════
  //  PHƯỢNG HOÀNG (Realm 14, ATK 1800)
  // ═══════════════════════════════════════════
  {
    id: 'nirvana_flame',
    name: 'Niết Bàn Chi Hỏa',
    emoji: '🔥',
    type: 'attack',
    element: 'fire',
    damage_multiplier: 3.5,
    cooldown: 4,
    mana_cost: 0,
    target: 'single',
    extra_effect: { burn_damage_percent: 10, burn_duration: 3 },
    description: 'Phượng Hoàng thiêu đốt bằng ngọn lửa Niết Bàn. Gây 3.5x sát thương hỏa, thiêu đốt 10% ATK/lượt trong 3 lượt.',
  },
  {
    id: 'phoenix_rebirth',
    name: 'Phượng Hoàng Trùng Sinh',
    emoji: '🌅',
    type: 'heal',
    element: 'fire',
    cooldown: 10,
    mana_cost: 0,
    target: 'self',
    effect: { heal_percent: 30, cleanse: true },
    description: 'Phượng Hoàng tái sinh từ tro tàn. Hồi phục 30% HP tối đa và tẩy sạch mọi debuff.',
  },
  {
    id: 'feather_storm',
    name: 'Vũ Mao Phong Bạo',
    emoji: '🪶',
    type: 'attack',
    element: 'fire',
    damage_multiplier: 2.5,
    cooldown: 5,
    mana_cost: 0,
    target: 'aoe',
    extra_effect: { def_break_percent: 15, duration: 2 },
    description: 'Bão lông vũ hỏa phượng quét sạch. Gây 2.5x sát thương hỏa diện rộng, giảm 15% phòng ngự 2 lượt.',
  },

  // ═══════════════════════════════════════════
  //  THIÊN MA (Realm 20, ATK 5000, World Boss)
  // ═══════════════════════════════════════════
  {
    id: 'dark_domain',
    name: 'Hắc Ám Lĩnh Vực',
    emoji: '🌑',
    type: 'debuff',
    element: 'dark',
    cooldown: 6,
    mana_cost: 0,
    target: 'single',
    effect: { all_stats_reduction_percent: 30, seal_skills: true, seal_duration: 1, duration: 3 },
    description: 'Thiên Ma triển khai lĩnh vực hắc ám. Giảm 30% toàn bộ chỉ số kẻ địch, phong ấn kỹ năng 1 lượt.',
  },
  {
    id: 'soul_destroy',
    name: 'Diệt Hồn',
    emoji: '💀',
    type: 'attack',
    element: 'dark',
    damage_multiplier: 4.0,
    cooldown: 5,
    mana_cost: 0,
    target: 'single',
    extra_effect: { ignore_def_percent: 40 },
    description: 'Thiên Ma diệt hồn, phá hủy linh hồn kẻ địch. Gây 4.0x sát thương hệ ám, bỏ qua 40% phòng ngự.',
  },
  {
    id: 'demon_army',
    name: 'Ma Quân Giáng Thế',
    emoji: '👹',
    type: 'attack',
    element: 'dark',
    damage_multiplier: 2.0,
    cooldown: 7,
    mana_cost: 0,
    target: 'aoe',
    extra_effect: { confuse_chance: 25, confuse_duration: 2 },
    description: 'Thiên Ma triệu hồi vạn ma quân. Gây 2.0x sát thương hệ ám diện rộng, 25% hoang mang 2 lượt.',
  },
  {
    id: 'ultimate_darkness',
    name: 'Tối Thượng Hắc Ám',
    emoji: '🕳️',
    type: 'attack',
    element: 'dark',
    damage_multiplier: 6.0,
    cooldown: 12,
    mana_cost: 0,
    target: 'single',
    extra_effect: { ignore_def_percent: 50, ignore_shield: true },
    description: 'Tuyệt chiêu tối thượng của Thiên Ma. Gây 6.0x sát thương hệ ám, bỏ qua 50% phòng ngự và phá hủy hộ thuẫn.',
  },
];

module.exports = {
  bossSkills,
  list: bossSkills,

  /**
   * Lấy boss skill theo id
   * @param {string} id - Skill ID
   * @returns {Object|undefined}
   */
  getBossSkillById(id) {
    return bossSkills.find(s => s.id === id);
  },

  /**
   * Lấy boss skills theo loại
   */
  getByType(type) {
    return bossSkills.filter(s => s.type === type);
  },

  /**
   * Lấy boss skills theo nguyên tố
   */
  getByElement(element) {
    return bossSkills.filter(s => s.element === element);
  },
};
