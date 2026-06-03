/**
 * @file Combat Engine (Hệ Thống Chiến Đấu)
 * @description Core turn-based auto-combat engine cho Tu Tiên RPG
 *
 * Vì Discord interaction hết hạn sau 15 phút, engine mô phỏng toàn bộ trận đấu
 * và trả về kết quả (auto-combat). Kỹ năng người chơi tự động sử dụng theo ưu tiên.
 *
 * Exports: createPvECombat, createPvPCombat, simulateCombat
 */

const db = require('../database/connection');
const { getSkillById } = require('../../config/skills');
const bossSkillsConfig = require('../../config/boss-skills');
const daoLawsConfig = require('../../config/dao-laws');
const techniquesConfig = require('../../config/techniques');
const petsConfig = require('../../config/pets');
const { randomInt, chance, clamp } = require('../utils/helpers');

// ═══════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════
const MAX_TURNS = 30;
const BASIC_ATTACK_MULTIPLIER = 1.0;
const PET_ATTACK_MULTIPLIER = 0.5;
const DEF_REDUCTION_FACTOR = 0.3;
const LOW_HP_THRESHOLD = 0.3; // 30% HP → ưu tiên heal
const DAMAGE_VARIANCE = 5;    // ±5 random damage

const ELEMENT_CHART = {
  fire:    { strong: ['ice', 'wood'],  weak: ['water'] },
  water:   { strong: ['fire'],         weak: ['thunder', 'ice'] },
  ice:     { strong: ['wind', 'water'], weak: ['fire'] },
  thunder: { strong: ['water'],        weak: ['earth'] },
  earth:   { strong: ['thunder'],      weak: ['wood', 'wind'] },
  wind:    { strong: ['earth'],        weak: ['ice'] },
  wood:    { strong: ['earth'],        weak: ['fire'] },
  dark:    { strong: ['light'],        weak: ['light'] },
  light:   { strong: ['dark'],         weak: ['dark'] },
  chaos:   { strong: [],               weak: [] },
  neutral: { strong: [],               weak: [] },
};

// ═══════════════════════════════════════════
//  COMBAT STATE BUILDER
// ═══════════════════════════════════════════

/**
 * Tạo combat state cho fighter (player hoặc enemy)
 * @param {Object} data - Dữ liệu fighter
 * @returns {Object} Fighter state
 */
function buildFighterState(data) {
  return {
    id: data.id || null,
    name: data.name || 'Unknown',
    emoji: data.emoji || '⚔️',
    hp: data.hp || data.max_hp || 100,
    maxHp: data.max_hp || data.maxHp || 100,
    mana: data.mana || data.max_mana || 50,
    maxMana: data.max_mana || data.maxMana || 50,
    atk: data.atk || 10,
    def: data.def || 5,
    speed: data.speed || 10,
    skills: data.skills || [],
    pet: data.pet || null,
    statuses: [],
    daoLaws: data.daoLaws || [],
    isBoss: data.isBoss || false,
    isPlayer: data.isPlayer !== undefined ? data.isPlayer : true,
    // Cooldown tracker: skill_id → lượt còn lại
    cooldowns: {},
    // Cờ đặc biệt
    _emergencyHealUsed: false, // Thủy Đạo Lv10
    _timeStopUsed: false,      // Thời Gian Đạo Lv10
    // Phase 1: Technique & element
    technique: data.technique || null,
    element: data.element || 'neutral',
    critRate: data.critRate || 5,
    critDamage: data.critDamage || 50,
    lifeSteal: data.lifeSteal || 0,
    armorPen: data.armorPen || 0,
    _reviveUsed: false,
    _invincibleTurns: 0,
    _transformTurns: 0,
    _spacePrisonUsed: false,   // Không Gian Đạo Lv10
    _currentPhase: 1,          // Boss phase
    _chaosImmunity: false,     // Hỗn Độn Đạo Lv10
    _fireIceImmunity: false,   // Hỏa Đạo Lv10
    _sangTaoDomainUsed: false, // Sáng Tạo Đạo Lv10
    // Phase 3: Combo tracking
    _comboCount: 0,
    _lastElement: null,
  };
}

function getElementModifier(attackElement, defenderElement, attacker) {
  if (!attackElement || attackElement === 'neutral') return { mod: 1.0, text: '' };
  // Hỗn Độn Đạo Lv10: chaos element ignores resistance (always strong)
  if (attackElement === 'chaos' && attacker) {
    const effects = getActiveDaoEffects(attacker);
    if (effects.chaos_ignore_resistance) {
      return { mod: 1.3, text: ' 🌀 Hỗn Độn Vô Kháng!' };
    }
  }
  const chart = ELEMENT_CHART[attackElement];
  if (!chart) return { mod: 1.0, text: '' };
  if (chart.strong.includes(defenderElement)) return { mod: 1.3, text: ' 🔥 Khắc Chế!' };
  if (chart.weak.includes(defenderElement)) return { mod: 0.7, text: ' 💨 Bị Khắc!' };
  return { mod: 1.0, text: '' };
}

/**
 * Kiểm tra và áp dụng combo (chuỗi tấn công cùng nguyên tố)
 * Combo tối đa 5x, mỗi stack +10% sát thương
 * @param {Object} attacker - Fighter tấn công
 * @param {string} element - Nguyên tố kỹ năng
 * @param {number} damage - Sát thương gốc
 * @param {Array} turnLog - Log chiến đấu
 * @returns {number} Sát thương sau combo
 */
function applyComboCheck(attacker, element, damage, turnLog) {
  if (!element || element === 'neutral') {
    attacker._comboCount = 0;
    attacker._lastElement = null;
    return damage;
  }
  if (element === attacker._lastElement) {
    attacker._comboCount = Math.min(attacker._comboCount + 1, 5);
    const comboBonus = attacker._comboCount * 0.1;
    const bonusDmg = Math.floor(damage * comboBonus);
    if (bonusDmg > 0) {
      turnLog.push(`  🔗 **Combo x${attacker._comboCount}!** +${attacker._comboCount * 10}% → +**${bonusDmg}** sát thương!`);
    }
    attacker._lastElement = element;
    return damage + bonusDmg;
  }
  attacker._comboCount = 1;
  attacker._lastElement = element;
  return damage;
}

/**
 * Tạo CombatState ban đầu
 * @param {Object} playerState - Fighter state người chơi
 * @param {Object} enemyState - Fighter state kẻ địch
 * @returns {Object} CombatState
 */
function createCombatState(playerState, enemyState) {
  return {
    player: playerState,
    enemy: enemyState,
    turnLog: [],
    turn: 0,
    maxTurns: MAX_TURNS,
    winner: null,
  };
}

// ═══════════════════════════════════════════
//  DAO LAWS COMBAT BONUSES
// ═══════════════════════════════════════════

/**
 * Áp dụng bonus đạo pháp vào stats fighter
 * @param {Object} fighter - Fighter state
 */
function applyDaoLawBonuses(fighter) {
  if (!fighter.daoLaws || fighter.daoLaws.length === 0) return;

  for (const law of fighter.daoLaws) {
    const daoConfig = daoLawsConfig.getDaoById(law.law_id);
    if (!daoConfig) continue;

    const bonuses = daoLawsConfig.getBonusesAtLevel(law.law_id, law.level);

    // Áp dụng bonus stats
    if (bonuses.atk_percent) {
      fighter.atk = Math.floor(fighter.atk * (1 + bonuses.atk_percent / 100));
    }
    if (bonuses.hp_percent) {
      const hpBonus = Math.floor(fighter.maxHp * bonuses.hp_percent / 100);
      fighter.maxHp += hpBonus;
      fighter.hp += hpBonus;
    }
    if (bonuses.def_percent) {
      fighter.def = Math.floor(fighter.def * (1 + bonuses.def_percent / 100));
    }
    if (bonuses.speed_percent) {
      fighter.speed = Math.floor(fighter.speed * (1 + bonuses.speed_percent / 100));
    }
    if (bonuses.mana_percent) {
      const manaBonus = Math.floor(fighter.maxMana * bonuses.mana_percent / 100);
      fighter.maxMana += manaBonus;
      fighter.mana += manaBonus;
    }
  }
}

function applyTechniqueBonuses(fighter) {
  if (!fighter.technique) return;
  const t = fighter.technique;
  const b = t.stat_bonuses || {};
  
  if (b.hp)    { fighter.maxHp += b.hp; fighter.hp += b.hp; }
  if (b.mana)  { fighter.maxMana += b.mana; fighter.mana += b.mana; }
  if (b.atk)   fighter.atk += b.atk;
  if (b.def)   fighter.def += b.def;
  if (b.speed) fighter.speed += b.speed;
  if (b.crit_rate)   fighter.critRate += b.crit_rate;
  if (b.crit_damage) fighter.critDamage += b.crit_damage;
  if (b.life_steal)  fighter.lifeSteal += b.life_steal;
}

function applyTechniqueSpecialEffects(fighter, opponent, turnLog) {
  if (!fighter.technique || !fighter.technique.special) return;
  const sp = fighter.technique.special;
  const fx = sp.effect || {};
  
  // Shield at battle start (Thanh Vân Quyết)
  if (fx.shield_percent) {
    const shieldVal = Math.floor(fighter.maxHp * fx.shield_percent / 100);
    fighter.statuses.push({ type: 'shield', value: shieldVal, duration: 99 });
    turnLog.push(`  ☁️ Công pháp **${fighter.technique.name}** tạo hộ thuẫn **${shieldVal}** HP!`);
  }
  
  // Damage reduction (Hồng Mông Đại Đạo)
  if (fx.damage_reduction) {
    fighter.statuses.push({ type: 'damage_reduction', value: fx.damage_reduction / 100, duration: 99 });
    turnLog.push(`  🌅 **${fighter.technique.name}** giảm **${fx.damage_reduction}%** sát thương nhận vào!`);
  }
  
  // Damage bonus (Hồng Mông Đại Đạo)
  if (fx.damage_bonus) {
    fighter._damageBonus = fx.damage_bonus;
    turnLog.push(`  🌅 **${fighter.technique.name}** tăng **${fx.damage_bonus}%** sát thương gây ra!`);
  }
  
  // CC immunity (Hồng Mông Đại Đạo)
  if (fx.cc_immunity) {
    fighter._ccImmunity = true;
  }
  
  // Armor penetration (Hỗn Độn Kinh)
  if (fx.armor_penetration) {
    fighter.armorPen = fx.armor_penetration;
  }
  
  // Invincible turns (Hỗn Độn Kinh)
  if (fx.invincible_turns) {
    fighter._invincibleTurns = fx.invincible_turns;
    turnLog.push(`  🌀 **${fighter.technique.name}** kích hoạt Bất Tử **${fx.invincible_turns}** lượt!`);
  }
  
  // HP regen per turn (Thái Âm Chân Kinh / Hỗn Độn Kinh)
  if (fx.hp_regen_percent) {
    fighter.statuses.push({ type: 'hot', healPercent: fx.hp_regen_percent, duration: 99, source: 'technique' });
    turnLog.push(`  🌙 **${fighter.technique.name}** hồi **${fx.hp_regen_percent}%** HP mỗi lượt!`);
  }
  
  // Revive flag (Cửu Chuyển Huyền Công)
  if (fx.revive) {
    fighter._canRevive = true;
    fighter._reviveHpPercent = fx.revive_hp_percent || 50;
  }
  
  // Enemy DEF reduction start of battle (Vạn Quỷ Kinh)
  if (fx.enemy_def_reduction) {
    opponent.statuses.push({ type: 'def_break', value: fx.enemy_def_reduction / 100, duration: 99 });
    turnLog.push(`  👻 **${fighter.technique.name}** giảm **${fx.enemy_def_reduction}%** phòng ngự địch!`);
  }
  
  // Transform (Cửu U Minh Vương Công)
  if (fx.transform_duration) {
    fighter._transformTurns = fx.transform_duration;
    if (fx.atk_bonus) {
      fighter.atk = Math.floor(fighter.atk * (1 + fx.atk_bonus / 100));
    }
    if (fx.life_steal) {
      fighter.lifeSteal += fx.life_steal;
    }
    if (fx.enemy_atk_reduction) {
      opponent.statuses.push({ type: 'atk_debuff', value: fx.enemy_atk_reduction / 100, duration: fx.transform_duration });
    }
    turnLog.push(`  💀 **${fighter.technique.name}** biến thân! +${fx.atk_bonus || 0}% ATK, +${fx.life_steal || 0}% hút máu!`);
  }
  
  // Dark immunity (Thuần Dương Công)
  if (fx.dark_immunity) {
    fighter._darkImmunity = true;
  }
  
  // Fire damage bonus (Liệt Hỏa Công)
  if (fx.fire_damage_bonus) {
    fighter._fireDamageBonus = fx.fire_damage_bonus;
  }
  
  // Heal bonus (Thái Âm Chân Kinh)
  if (fx.heal_bonus) {
    fighter._healBonus = fx.heal_bonus;
  }
  
  // Yang fire proc (Thuần Dương Công)
  if (fx.yang_fire_chance) {
    fighter._yangFireChance = fx.yang_fire_chance;
    fighter._yangFireDamage = fx.yang_fire_damage || 20;
  }
  
  // Summon damage bonus (Vạn Quỷ Kinh)
  if (fx.summon_damage_bonus) {
    fighter._damageBonus = (fighter._damageBonus || 0) + fx.summon_damage_bonus;
    turnLog.push(`  👻 **${fighter.technique.name}** triệu hồi quỷ hồn! +${fx.summon_damage_bonus}% sát thương!`);
  }
  
  // Stat bonus per 10 levels (Cửu Chuyển Huyền Công)
  if (fx.stat_bonus_per_10_levels) {
    const techniqueLevel = fighter.technique.max_level || 1;
    const bonusTiers = Math.floor(techniqueLevel / 10);
    const totalBonus = bonusTiers * fx.stat_bonus_per_10_levels;
    if (totalBonus > 0) {
      fighter.atk = Math.floor(fighter.atk * (1 + totalBonus / 100));
      fighter.def = Math.floor(fighter.def * (1 + totalBonus / 100));
      fighter.speed = Math.floor(fighter.speed * (1 + totalBonus / 100));
    }
  }
  
  // Life steal percent (Hấp Huyết Đại Pháp)
  if (fx.life_steal_percent) {
    fighter.lifeSteal += fx.life_steal_percent;
  }
  
  // AoE damage + self HP cost (Diệt Thế Ma Kinh)
  if (fx.self_hp_cost_percent) {
    const hpCost = Math.floor(fighter.maxHp * fx.self_hp_cost_percent / 100);
    fighter.hp -= hpCost;
    turnLog.push(`  🌑 **${fighter.technique.name}** tiêu hao **${hpCost}** HP để kích hoạt!`);
  }
}

/**
 *  Lấy special effects đạo pháp đang kích hoạt
 * @param {Object} fighter
 * @returns {Object} Tổng hợp các special effects
 */
function getActiveDaoEffects(fighter) {
  const effects = {};
  if (!fighter.daoLaws) return effects;

  for (const law of fighter.daoLaws) {
    const daoConfig = daoLawsConfig.getDaoById(law.law_id);
    if (!daoConfig || !daoConfig.special_effect) continue;

    // Lv5 effects
    if (law.level >= 5 && daoConfig.special_effect.level_5) {
      Object.assign(effects, daoConfig.special_effect.level_5);
    }
    // Lv10 effects
    if (law.level >= 10 && daoConfig.special_effect.level_10) {
      Object.assign(effects, daoConfig.special_effect.level_10);
    }
  }
  return effects;
}

// ═══════════════════════════════════════════
//  STATUS EFFECTS PROCESSING
// ═══════════════════════════════════════════

/**
 * Áp dụng hiệu ứng đầu lượt (DoT, HoT, tick-down)
 * @param {Object} fighter - Fighter bị ảnh hưởng
 * @param {Array} turnLog - Log chiến đấu
 */
function applyStartOfTurnEffects(fighter, turnLog) {
  const expiredStatuses = [];

  for (let i = 0; i < fighter.statuses.length; i++) {
    const status = fighter.statuses[i];

    switch (status.type) {
      case 'burn': {
        const burnDmg = status.damage || 0;
        fighter.hp -= burnDmg;
        turnLog.push(`  🔥 ${fighter.name} bị thiêu đốt, mất **${burnDmg}** HP!`);
        break;
      }
      case 'poison': {
        const poisonDmg = status.damage || 0;
        fighter.hp -= poisonDmg;
        turnLog.push(`  ☠️ ${fighter.name} bị trúng độc, mất **${poisonDmg}** HP!`);
        break;
      }
      case 'hot': {
        const healAmt = Math.floor(fighter.maxHp * (status.healPercent || 0) / 100);
        fighter.hp = Math.min(fighter.hp + healAmt, fighter.maxHp);
        turnLog.push(`  💚 ${fighter.name} hồi phục **${healAmt}** HP (hồi dần)!`);
        break;
      }
      case 'stun': {
        // Xử lý stun ở phần chọn action
        break;
      }
      default:
        break;
    }

    // Giảm duration
    status.duration -= 1;
    if (status.duration <= 0) {
      expiredStatuses.push(i);
    }
  }

  // Xóa status hết hạn (từ cuối lên để không lệch index)
  for (let i = expiredStatuses.length - 1; i >= 0; i--) {
    const removedStatus = fighter.statuses.splice(expiredStatuses[i], 1)[0];
    turnLog.push(`  ⏳ Hiệu ứng **${getStatusName(removedStatus.type)}** trên ${fighter.name} đã hết.`);
  }
}

/**
 * Lấy tên tiếng Việt của status effect
 */
function getStatusName(type) {
  const names = {
    burn: 'Thiêu Đốt',
    poison: 'Trúng Độc',
    stun: 'Choáng',
    hot: 'Hồi Máu',
    def_buff: 'Tăng Phòng',
    shield: 'Hộ Thuẫn',
    slow: 'Chậm',
    atk_buff: 'Tăng Công',
    speed_buff: 'Tăng Tốc',
    seal: 'Phong Ấn',
    confuse: 'Hoang Mang',
    def_break: 'Phá Phòng',
    atk_debuff: 'Giảm Công',
    damage_reduction: 'Giảm Thương',
    reflect: 'Phản Thương',
  };
  return names[type] || type;
}

/**
 * Kiểm tra fighter có bị stun không
 */
function isStunned(fighter) {
  return fighter.statuses.some(s => s.type === 'stun');
}

/**
 * Kiểm tra fighter có bị phong ấn kỹ năng không
 */
function isSealed(fighter) {
  return fighter.statuses.some(s => s.type === 'seal');
}

/**
 * Tính DEF hiệu dụng (có buff/debuff)
 */
function getEffectiveDef(fighter) {
  let def = fighter.def;
  for (const s of fighter.statuses) {
    if (s.type === 'def_buff') def = Math.floor(def * (1 + (s.value || 0)));
    if (s.type === 'def_break') def = Math.floor(def * (1 - (s.value || 0)));
  }
  return Math.max(0, def);
}

/**
 * Tính ATK hiệu dụng (có buff/debuff)
 */
function getEffectiveAtk(fighter) {
  let atk = fighter.atk;
  for (const s of fighter.statuses) {
    if (s.type === 'atk_buff') atk = Math.floor(atk * (1 + (s.value || 0)));
    if (s.type === 'atk_debuff') atk = Math.floor(atk * (1 - (s.value || 0)));
  }
  // Áp dụng poison ATK reduction
  for (const s of fighter.statuses) {
    if (s.type === 'poison' && s.atkReduction) {
      atk = Math.floor(atk * (1 - s.atkReduction));
    }
  }
  return Math.max(1, atk);
}

/**
 * Tính speed hiệu dụng
 */
function getEffectiveSpeed(fighter) {
  let speed = fighter.speed;
  for (const s of fighter.statuses) {
    if (s.type === 'speed_buff') speed = Math.floor(speed * (1 + (s.value || 0)));
    if (s.type === 'slow') speed = Math.floor(speed * (1 - (s.speedReduction || 0.25)));
  }
  return Math.max(1, speed);
}

/**
 * Lấy shield value còn lại
 */
function getShieldValue(fighter) {
  const shield = fighter.statuses.find(s => s.type === 'shield');
  return shield ? shield.value : 0;
}

/**
 * Áp dụng sát thương qua shield trước
 */
function applyDamageToFighter(fighter, damage, turnLog) {
  let remaining = damage;

  // Kiểm tra damage reduction
  for (const s of fighter.statuses) {
    if (s.type === 'damage_reduction') {
      const reduced = Math.floor(remaining * (s.value || 0));
      remaining -= reduced;
    }
  }
  remaining = Math.max(0, remaining);

  // Shield absorb
  const shieldStatus = fighter.statuses.find(s => s.type === 'shield');
  if (shieldStatus && shieldStatus.value > 0) {
    const absorbed = Math.min(shieldStatus.value, remaining);
    shieldStatus.value -= absorbed;
    remaining -= absorbed;
    if (absorbed > 0) {
      turnLog.push(`  🛡️ Hộ thuẫn hấp thụ **${absorbed}** sát thương!`);
    }
    if (shieldStatus.value <= 0) {
      // Xóa shield đã vỡ
      fighter.statuses = fighter.statuses.filter(s => s !== shieldStatus);
      turnLog.push(`  💥 Hộ thuẫn ${fighter.name} đã vỡ!`);
    }
  }

  fighter.hp -= remaining;

  // Kiểm tra reflect
  let reflectDmg = 0;
  for (const s of fighter.statuses) {
    if (s.type === 'reflect') {
      reflectDmg += Math.floor(damage * (s.value || 0));
    }
  }

  return { actualDamage: remaining, reflectDamage: reflectDmg };
}

// ═══════════════════════════════════════════
//  SKILL SELECTION AI
// ═══════════════════════════════════════════

/**
 * Chọn action cho player (AI auto-combat)
 * Ưu tiên: Heal nếu HP < 30% → Ultimate nếu off-cd → Attack skills → Basic attack
 * @param {Object} fighter - Fighter state
 * @returns {Object|null} Kỹ năng được chọn hoặc null (basic attack)
 */
function choosePlayerAction(fighter) {
  if (isSealed(fighter)) return null; // Bị phong ấn → đánh thường

  const availableSkills = fighter.skills.filter(skill => {
    const cd = fighter.cooldowns[skill.id] || 0;
    return cd <= 0 && fighter.mana >= (skill.mana_cost || 0);
  });

  if (availableSkills.length === 0) return null;

  const hpRatio = fighter.hp / fighter.maxHp;

  // 1. HP thấp → ưu tiên heal
  if (hpRatio < LOW_HP_THRESHOLD) {
    const healSkill = availableSkills.find(s => s.type === 'heal');
    if (healSkill) return healSkill;
  }

  // 2. Ultimate off-cd → dùng
  const ultimate = availableSkills.find(s => s.type === 'ultimate');
  if (ultimate) return ultimate;

  // 3. Buff/Defense nếu chưa có buff active
  const hasBuff = fighter.statuses.some(s =>
    ['atk_buff', 'speed_buff', 'def_buff', 'damage_reduction'].includes(s.type)
  );
  if (!hasBuff) {
    const buffSkill = availableSkills.find(s => s.type === 'buff' || s.type === 'defense');
    if (buffSkill) return buffSkill;
  }

  // 4. Debuff nếu chưa áp
  const debuffSkill = availableSkills.find(s => s.type === 'debuff');
  if (debuffSkill) return debuffSkill;

  // 5. Attack skill mạnh nhất
  const attackSkills = availableSkills
    .filter(s => s.type === 'attack')
    .sort((a, b) => (b.damage_multiplier || 0) - (a.damage_multiplier || 0));
  if (attackSkills.length > 0) return attackSkills[0];

  // 6. Heal nếu không full HP
  if (hpRatio < 1) {
    const healSkill = availableSkills.find(s => s.type === 'heal');
    if (healSkill) return healSkill;
  }

  return null; // Basic attack
}

/**
 * Chọn action cho enemy (random từ available skills hoặc basic attack)
 * @param {Object} fighter - Fighter state (enemy)
 * @returns {Object|null}
 */
function chooseEnemyAction(fighter) {
  if (isSealed(fighter)) return null;

  const availableSkills = fighter.skills.filter(skill => {
    const cd = fighter.cooldowns[skill.id] || 0;
    return cd <= 0 && fighter.mana >= (skill.mana_cost || 0);
  });

  if (availableSkills.length === 0) return null;

  // Enemy: HP thấp cũng ưu tiên heal
  const hpRatio = fighter.hp / fighter.maxHp;
  if (hpRatio < LOW_HP_THRESHOLD) {
    const healSkill = availableSkills.find(s => s.type === 'heal');
    if (healSkill) return healSkill;
  }

  // Random 1 skill từ danh sách khả dụng
  return availableSkills[randomInt(0, availableSkills.length - 1)];
}

// ═══════════════════════════════════════════
//  ACTION EXECUTION
// ═══════════════════════════════════════════

/**
 * Thực hiện action (skill hoặc basic attack)
 * @param {Object} attacker - Fighter tấn công
 * @param {Object} defender - Fighter bị tấn công
 * @param {Object|null} skill - Kỹ năng (null = basic attack)
 * @param {Array} turnLog - Log chiến đấu
 */
function executeAction(attacker, defender, skill, turnLog) {
  // Kiểm tra confuse: tự đánh bản thân
  const confuseStatus = attacker.statuses.find(s => s.type === 'confuse');
  if (confuseStatus && chance(confuseStatus.chance || 30)) {
    const selfDmg = Math.floor(getEffectiveAtk(attacker) * 0.5);
    attacker.hp -= selfDmg;
    turnLog.push(`  😵 ${attacker.name} bị hoang mang, tự đánh bản thân gây **${selfDmg}** sát thương!`);
    return;
  }

  if (!skill) {
    // Basic Attack
    executeBasicAttack(attacker, defender, turnLog);
    return;
  }

  // Trừ mana
  attacker.mana -= (skill.mana_cost || 0);

  // Đặt cooldown (Thời Gian Đạo Lv5: giảm 20% cooldown)
  if (skill.cooldown) {
    const daoEffects = getActiveDaoEffects(attacker);
    const cd = daoEffects.cooldown_reduction_percent
      ? Math.max(1, Math.ceil(skill.cooldown * (1 - daoEffects.cooldown_reduction_percent / 100)))
      : skill.cooldown;
    attacker.cooldowns[skill.id] = cd;
  }

  switch (skill.type) {
    case 'attack':
      executeAttackSkill(attacker, defender, skill, turnLog);
      break;
    case 'ultimate':
      executeUltimateSkill(attacker, defender, skill, turnLog);
      break;
    case 'defense':
      executeDefenseSkill(attacker, skill, turnLog);
      break;
    case 'buff':
      executeBuffSkill(attacker, skill, turnLog);
      break;
    case 'debuff':
      executeDebuffSkill(attacker, defender, skill, turnLog);
      break;
    case 'heal':
      executeHealSkill(attacker, skill, turnLog);
      break;
    default:
      executeBasicAttack(attacker, defender, turnLog);
      break;
  }
}

/**
 * Đánh thường
 */
function executeBasicAttack(attacker, defender, turnLog) {
  const atk = getEffectiveAtk(attacker);
  const def = getEffectiveDef(defender);
  // Armor penetration from technique
  const effectiveDef = attacker.armorPen > 0 ? Math.floor(def * (1 - attacker.armorPen / 100)) : def;
  
  let damage = Math.max(1, Math.floor(atk * BASIC_ATTACK_MULTIPLIER - effectiveDef * DEF_REDUCTION_FACTOR + randomInt(-DAMAGE_VARIANCE, DAMAGE_VARIANCE)));
  
  // Dodge check (Không Gian Đạo Lv5: +20 dodge)
  let dodgeBonus = 0;
  const defenderDaoFxBasic = getActiveDaoEffects(defender);
  if (defenderDaoFxBasic.dodge_bonus) dodgeBonus += defenderDaoFxBasic.dodge_bonus;
  const dodgeChance = Math.max(0, Math.min(40, Math.floor((getEffectiveSpeed(defender) - getEffectiveSpeed(attacker)) / 10) + dodgeBonus));
  if (dodgeChance > 0 && chance(dodgeChance)) {
    turnLog.push(`  💨 ${defender.name} né tránh thành công!`);
    applyDaoAttackEffects(attacker, defender, 0, turnLog);
    return;
  }
  
  // Crit check
  const critRate = (attacker.critRate || 5) + Math.floor(getEffectiveSpeed(attacker) / 50);
  const critDmgMult = 1.0 + (attacker.critDamage || 50) / 100;
  let isCrit = false;
  if (chance(critRate)) {
    damage = Math.floor(damage * critDmgMult);
    isCrit = true;
  }
  
  // Technique damage bonus
  if (attacker._damageBonus) {
    damage = Math.floor(damage * (1 + attacker._damageBonus / 100));
  }
  
  // Yang fire proc (Thuần Dương Công)
  let yangFireExtra = 0;
  if (attacker._yangFireChance && chance(attacker._yangFireChance)) {
    yangFireExtra = Math.floor(damage * attacker._yangFireDamage / 100);
    damage += yangFireExtra;
  }
  
  // Invincible check on defender
  if (defender._invincibleTurns > 0) {
    turnLog.push(`  🌀 ${defender.name} đang Bất Tử! Chỉ nhận **1** sát thương!`);
    damage = 1;
  }
  
  const { actualDamage, reflectDamage } = applyDamageToFighter(defender, damage, turnLog);
  const critText = isCrit ? ' 💥 **BẠO KÍCH!**' : '';
  turnLog.push(`  ⚔️ ${attacker.name} đánh thường → ${defender.name}, gây **${actualDamage}** sát thương!${critText}`);
  
  if (yangFireExtra > 0) {
    turnLog.push(`  ☀️ Dương Hỏa phát động! +**${yangFireExtra}** sát thương!`);
  }
  
  if (reflectDamage > 0) {
    attacker.hp -= reflectDamage;
    turnLog.push(`  🔄 ${attacker.name} nhận **${reflectDamage}** phản thương!`);
  }
  
  // Life steal from technique
  if (attacker.lifeSteal > 0 && actualDamage > 0) {
    const healAmt = Math.floor(actualDamage * attacker.lifeSteal / 100);
    if (healAmt > 0) {
      attacker.hp = Math.min(attacker.hp + healAmt, attacker.maxHp);
      turnLog.push(`  🩸 ${attacker.name} hút **${healAmt}** HP!`);
    }
  }
  
  applyDaoAttackEffects(attacker, defender, actualDamage, turnLog);
}

/**
 * Kỹ năng tấn công
 */
function executeAttackSkill(attacker, defender, skill, turnLog) {
  const atk = getEffectiveAtk(attacker);
  const def = getEffectiveDef(defender);
  const multiplier = skill.damage_multiplier || 1.0;

  let effectiveDef = def;
  if (skill.extra_effect && skill.extra_effect.ignore_def_percent) {
    effectiveDef = Math.floor(def * (1 - skill.extra_effect.ignore_def_percent / 100));
  }
  if (attacker.armorPen > 0) {
    effectiveDef = Math.floor(effectiveDef * (1 - attacker.armorPen / 100));
  }

  let damage = Math.max(1, Math.floor(atk * multiplier - effectiveDef * DEF_REDUCTION_FACTOR + randomInt(-DAMAGE_VARIANCE, DAMAGE_VARIANCE)));

  // Dodge check (Không Gian Đạo Lv5: +20 dodge)
  let atkDodgeBonus = 0;
  const defenderDaoFxAtk = getActiveDaoEffects(defender);
  if (defenderDaoFxAtk.dodge_bonus) atkDodgeBonus += defenderDaoFxAtk.dodge_bonus;
  const dodgeChance = Math.max(0, Math.min(40, Math.floor((getEffectiveSpeed(defender) - getEffectiveSpeed(attacker)) / 10) + atkDodgeBonus));
  if (dodgeChance > 0 && chance(dodgeChance)) {
    const skillEmoji = skill.emoji || '💥';
    turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển **${skill.name}** nhưng ${defender.name} 💨 né tránh!`);
    return;
  }

  // Element modifier
  const { mod: elMod, text: elText } = getElementModifier(skill.element, defender.element || 'neutral', attacker);
  damage = Math.floor(damage * elMod);
  
  // Technique fire damage bonus
  if (attacker._fireDamageBonus && skill.element === 'fire') {
    damage = Math.floor(damage * (1 + attacker._fireDamageBonus / 100));
  }

  // Crit check
  const critRate = (attacker.critRate || 5) + Math.floor(getEffectiveSpeed(attacker) / 50) + (skill.extra_effect?.crit_rate_bonus || 0);
  const critDmgMult = 1.0 + (attacker.critDamage || 50) / 100;
  let isCrit = false;
  if (chance(critRate)) {
    damage = Math.floor(damage * critDmgMult);
    isCrit = true;
  }

  // Technique damage bonus
  if (attacker._damageBonus) {
    damage = Math.floor(damage * (1 + attacker._damageBonus / 100));
  }
  
  // Yang fire proc
  let yangFireExtra = 0;
  if (attacker._yangFireChance && chance(attacker._yangFireChance)) {
    yangFireExtra = Math.floor(damage * attacker._yangFireDamage / 100);
    damage += yangFireExtra;
  }
  
  // Invincible check
  if (defender._invincibleTurns > 0) {
    damage = 1;
  }

  // Phase 3: Combo check
  damage = applyComboCheck(attacker, skill.element, damage, turnLog);

  const { actualDamage, reflectDamage } = applyDamageToFighter(defender, damage, turnLog);

  const skillEmoji = skill.emoji || '💥';
  const critText = isCrit ? ' 💥 **BẠO KÍCH!**' : '';
  turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển **${skill.name}** → ${defender.name}, gây **${actualDamage}** sát thương!${critText}${elText}`);

  if (yangFireExtra > 0) {
    turnLog.push(`  ☀️ Dương Hỏa phát động! +**${yangFireExtra}** sát thương!`);
  }

  if (skill.extra_effect) {
    applyExtraEffects(attacker, defender, skill, actualDamage, turnLog);
  }

  if (reflectDamage > 0) {
    attacker.hp -= reflectDamage;
    turnLog.push(`  🔄 ${attacker.name} nhận **${reflectDamage}** phản thương!`);
  }

  // Life steal
  if (attacker.lifeSteal > 0 && actualDamage > 0) {
    const healAmt = Math.floor(actualDamage * attacker.lifeSteal / 100);
    if (healAmt > 0) {
      attacker.hp = Math.min(attacker.hp + healAmt, attacker.maxHp);
      turnLog.push(`  🩸 ${attacker.name} hút **${healAmt}** HP!`);
    }
  }

  applyDaoAttackEffects(attacker, defender, actualDamage, turnLog);
}

/**
 * Tuyệt chiêu (Ultimate)
 */
function executeUltimateSkill(attacker, defender, skill, turnLog) {
  const atk = getEffectiveAtk(attacker);
  const def = getEffectiveDef(defender);
  const multiplier = skill.damage_multiplier || 3.0;

  let effectiveDef = def;
  if (skill.extra_effect && skill.extra_effect.ignore_def_percent) {
    effectiveDef = Math.floor(def * (1 - skill.extra_effect.ignore_def_percent / 100));
  }
  if (attacker.armorPen > 0) {
    effectiveDef = Math.floor(effectiveDef * (1 - attacker.armorPen / 100));
  }

  // Ignore shield (Vạn Pháp Quy Tông)
  if (skill.extra_effect && skill.extra_effect.ignore_shield) {
    defender.statuses = defender.statuses.filter(s => s.type !== 'shield');
  }

  // Dodge check (Không Gian Đạo Lv5: +20 dodge)
  let ultDodgeBonus = 0;
  const defenderDaoFxUlt = getActiveDaoEffects(defender);
  if (defenderDaoFxUlt.dodge_bonus) ultDodgeBonus += defenderDaoFxUlt.dodge_bonus;
  const dodgeChance = Math.max(0, Math.min(40, Math.floor((getEffectiveSpeed(defender) - getEffectiveSpeed(attacker)) / 10) + ultDodgeBonus));
  if (dodgeChance > 0 && chance(dodgeChance)) {
    const skillEmoji = skill.emoji || '🌟';
    turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển tuyệt chiêu **${skill.name}** nhưng ${defender.name} 💨 né tránh!`);
    return;
  }

  let damage = Math.max(1, Math.floor(atk * multiplier - effectiveDef * DEF_REDUCTION_FACTOR + randomInt(-DAMAGE_VARIANCE, DAMAGE_VARIANCE)));

  // Element modifier
  const { mod: elMod, text: elText } = getElementModifier(skill.element, defender.element || 'neutral', attacker);
  damage = Math.floor(damage * elMod);

  // Technique fire damage bonus
  if (attacker._fireDamageBonus && skill.element === 'fire') {
    damage = Math.floor(damage * (1 + attacker._fireDamageBonus / 100));
  }

  // Crit check
  const critRate = (attacker.critRate || 5) + Math.floor(getEffectiveSpeed(attacker) / 50) + (skill.extra_effect?.crit_rate_bonus || 0);
  const critDmgMult = 1.0 + (attacker.critDamage || 50) / 100;
  let isCrit = false;
  if (chance(critRate)) {
    damage = Math.floor(damage * critDmgMult);
    isCrit = true;
  }

  // Technique damage bonus
  if (attacker._damageBonus) {
    damage = Math.floor(damage * (1 + attacker._damageBonus / 100));
  }

  // Yang fire proc
  let yangFireExtra = 0;
  if (attacker._yangFireChance && chance(attacker._yangFireChance)) {
    yangFireExtra = Math.floor(damage * attacker._yangFireDamage / 100);
    damage += yangFireExtra;
  }

  // Invincible check
  if (defender._invincibleTurns > 0) {
    damage = 1;
  }

  // Phase 3: Combo check
  damage = applyComboCheck(attacker, skill.element, damage, turnLog);

  const { actualDamage, reflectDamage } = applyDamageToFighter(defender, damage, turnLog);

  const skillEmoji = skill.emoji || '🌟';
  const critText = isCrit ? ' 💥 **BẠO KÍCH!**' : '';
  turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển tuyệt chiêu **${skill.name}** → ${defender.name}, gây **${actualDamage}** sát thương kinh hoàng!${critText}${elText}`);

  if (yangFireExtra > 0) {
    turnLog.push(`  ☀️ Dương Hỏa phát động! +**${yangFireExtra}** sát thương!`);
  }

  // Extra effects
  if (skill.extra_effect) {
    applyExtraEffects(attacker, defender, skill, actualDamage, turnLog);
  }

  // Phản thương
  if (reflectDamage > 0) {
    attacker.hp -= reflectDamage;
    turnLog.push(`  🔄 ${attacker.name} nhận **${reflectDamage}** phản thương!`);
  }

  // Life steal
  if (attacker.lifeSteal > 0 && actualDamage > 0) {
    const healAmt = Math.floor(actualDamage * attacker.lifeSteal / 100);
    if (healAmt > 0) {
      attacker.hp = Math.min(attacker.hp + healAmt, attacker.maxHp);
      turnLog.push(`  🩸 ${attacker.name} hút **${healAmt}** HP!`);
    }
  }

  applyDaoAttackEffects(attacker, defender, actualDamage, turnLog);
}

/**
 * Kỹ năng phòng thủ
 */
function executeDefenseSkill(attacker, skill, turnLog) {
  const effect = skill.effect || {};
  const skillEmoji = skill.emoji || '🛡️';

  if (effect.def_bonus_percent) {
    attacker.statuses.push({
      type: 'def_buff',
      value: effect.def_bonus_percent / 100,
      duration: effect.duration || 3,
    });
    turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển **${skill.name}**, tăng **${effect.def_bonus_percent}%** phòng ngự!`);
  }

  if (effect.shield_flat) {
    attacker.statuses.push({
      type: 'shield',
      value: effect.shield_flat,
      duration: effect.duration || 2,
    });
    turnLog.push(`  🛡️ ${attacker.name} triệu hồi hộ thuẫn hấp thụ **${effect.shield_flat}** sát thương!`);
  }

  if (effect.damage_reduction_percent) {
    attacker.statuses.push({
      type: 'damage_reduction',
      value: effect.damage_reduction_percent / 100,
      duration: effect.duration || 2,
    });
    turnLog.push(`  🔮 ${attacker.name} kích hoạt kết giới, giảm **${effect.damage_reduction_percent}%** sát thương nhận vào!`);
  }

  if (effect.reflect_percent) {
    attacker.statuses.push({
      type: 'reflect',
      value: effect.reflect_percent / 100,
      duration: effect.duration || 2,
    });
    turnLog.push(`  🔄 Phản **${effect.reflect_percent}%** sát thương về kẻ tấn công!`);
  }
}

/**
 * Kỹ năng buff
 */
function executeBuffSkill(attacker, skill, turnLog) {
  const effect = skill.effect || {};
  const skillEmoji = skill.emoji || '✨';
  const parts = [];

  if (effect.speed_bonus_percent) {
    attacker.statuses.push({
      type: 'speed_buff',
      value: effect.speed_bonus_percent / 100,
      duration: effect.duration || 3,
    });
    parts.push(`+${effect.speed_bonus_percent}% tốc độ`);
  }

  if (effect.atk_bonus_percent) {
    attacker.statuses.push({
      type: 'atk_buff',
      value: effect.atk_bonus_percent / 100,
      duration: effect.duration || 3,
    });
    parts.push(`+${effect.atk_bonus_percent}% công kích`);
  }

  if (effect.all_stats_bonus_percent) {
    const bonus = effect.all_stats_bonus_percent / 100;
    attacker.statuses.push({ type: 'atk_buff', value: bonus, duration: effect.duration || 3 });
    attacker.statuses.push({ type: 'def_buff', value: bonus, duration: effect.duration || 3 });
    attacker.statuses.push({ type: 'speed_buff', value: bonus, duration: effect.duration || 3 });
    parts.push(`+${effect.all_stats_bonus_percent}% toàn chỉ số`);
  }

  // Buff mà giảm def (ví dụ: Cuồng Chiến)
  if (effect.def_reduction_percent) {
    attacker.statuses.push({
      type: 'def_break',
      value: effect.def_reduction_percent / 100,
      duration: effect.duration || 3,
    });
    parts.push(`-${effect.def_reduction_percent}% phòng ngự`);
  }

  turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển **${skill.name}**: ${parts.join(', ')}!`);
}

/**
 * Kỹ năng debuff
 */
function executeDebuffSkill(attacker, defender, skill, turnLog) {
  // Hỗn Độn Đạo Lv10: immune to all debuffs
  if (defender._chaosImmunity) {
    const skillEmoji = skill.emoji || '🔮';
    turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển **${skill.name}** nhưng ${defender.name} 🌀 miễn nhiễm (Hỗn Độn Đạo)!`);
    return;
  }
  const effect = skill.effect || {};
  const skillEmoji = skill.emoji || '🔮';
  const parts = [];

  if (effect.seal_skills) {
    defender.statuses.push({
      type: 'seal',
      duration: effect.duration || 2,
    });
    parts.push(`phong ấn kỹ năng ${effect.duration || 2} lượt`);
  }

  if (effect.poison_damage_percent) {
    const poisonDmg = Math.floor(getEffectiveAtk(attacker) * effect.poison_damage_percent / 100);
    defender.statuses.push({
      type: 'poison',
      damage: poisonDmg,
      duration: effect.poison_duration || 4,
      atkReduction: (effect.atk_reduction_percent || 0) / 100,
    });
    parts.push(`độc ${poisonDmg}/lượt trong ${effect.poison_duration || 4} lượt`);
  }

  if (effect.confuse_chance) {
    defender.statuses.push({
      type: 'confuse',
      chance: effect.confuse_chance,
      duration: effect.duration || 3,
    });
    parts.push(`${effect.confuse_chance}% hoang mang`);
  }

  if (effect.atk_reduction_percent && !effect.poison_damage_percent) {
    defender.statuses.push({
      type: 'atk_debuff',
      value: effect.atk_reduction_percent / 100,
      duration: effect.duration || 3,
    });
    parts.push(`-${effect.atk_reduction_percent}% công kích`);
  }

  turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển **${skill.name}** → ${defender.name}: ${parts.join(', ')}!`);
}

/**
 * Kỹ năng hồi phục
 */
function executeHealSkill(attacker, skill, turnLog) {
  const effect = skill.effect || {};
  const skillEmoji = skill.emoji || '💚';
  const parts = [];

  // Cleanse: xóa tất cả debuff
  if (effect.cleanse) {
    const debuffTypes = ['burn', 'poison', 'stun', 'slow', 'seal', 'confuse', 'atk_debuff', 'def_break'];
    const removed = attacker.statuses.filter(s => debuffTypes.includes(s.type));
    attacker.statuses = attacker.statuses.filter(s => !debuffTypes.includes(s.type));
    if (removed.length > 0) {
      parts.push(`tẩy sạch **${removed.length}** debuff`);
    }
  }

  // Heal percent
  if (effect.heal_percent) {
    let healAmt = Math.floor(attacker.maxHp * effect.heal_percent / 100);
    // Technique heal bonus (Thái Âm Chân Kinh)
    if (attacker._healBonus) {
      healAmt = Math.floor(healAmt * (1 + attacker._healBonus / 100));
    }
    attacker.hp = Math.min(attacker.hp + healAmt, attacker.maxHp);
    parts.push(`hồi **${healAmt}** HP (${effect.heal_percent}%)`);
  }

  // HoT (Heal over Time)
  if (effect.hot_percent) {
    attacker.statuses.push({
      type: 'hot',
      healPercent: effect.hot_percent,
      duration: effect.hot_duration || 3,
    });
    parts.push(`hồi ${effect.hot_percent}% HP/lượt trong ${effect.hot_duration || 3} lượt`);
  }

  turnLog.push(`  ${skillEmoji} ${attacker.name} thi triển **${skill.name}**: ${parts.join(', ')}!`);
}

// ═══════════════════════════════════════════
//  EXTRA EFFECTS (từ skill.extra_effect)
// ═══════════════════════════════════════════

/**
 * Áp dụng extra_effect của skill tấn công
 */
function applyExtraEffects(attacker, defender, skill, damage, turnLog) {
  const fx = skill.extra_effect;
  if (!fx) return;

  // Stun chance (Hỏa Đạo Lv10: immune to freeze/stun from ice)
  if (fx.stun_chance && chance(fx.stun_chance)) {
    // Check Hỏa Đạo Lv10 ice immunity (freeze = stun from ice skills)
    if (defender._fireIceImmunity && skill && skill.element === 'ice') {
      turnLog.push(`  🔥 ${defender.name} miễn nhiễm đóng băng (Hỏa Đạo)!`);
    } else if (defender._chaosImmunity) {
      turnLog.push(`  🌀 ${defender.name} miễn nhiễm choáng (Hỗn Độn Đạo)!`);
    } else {
      const stunDuration = fx.stun_duration || 1;
      defender.statuses.push({ type: 'stun', duration: stunDuration });
      turnLog.push(`  ⚡ ${defender.name} bị **CHOÁNG** ${stunDuration} lượt!`);
    }
  }

  // Slow chance
  if (fx.slow_chance && chance(fx.slow_chance)) {
    if (defender._chaosImmunity) {
      turnLog.push(`  🌀 ${defender.name} miễn nhiễm chậm (Hỗn Độn Đạo)!`);
    } else {
      defender.statuses.push({
        type: 'slow',
        speedReduction: 0.25,
        duration: fx.slow_duration || 2,
      });
      turnLog.push(`  🧊 ${defender.name} bị **CHẬM** ${fx.slow_duration || 2} lượt!`);
    }
  }

  // Life steal
  if (fx.life_steal_percent) {
    const healAmt = Math.floor(damage * fx.life_steal_percent / 100);
    attacker.hp = Math.min(attacker.hp + healAmt, attacker.maxHp);
    turnLog.push(`  🩸 ${attacker.name} hút **${healAmt}** HP từ kẻ địch!`);
  }

  // Burn DoT (Hỏa Đạo Lv10: immune to burn)
  if (fx.burn_damage_percent) {
    if (defender._fireIceImmunity) {
      turnLog.push(`  🔥 ${defender.name} miễn nhiễm thiêu đốt (Hỏa Đạo)!`);
    } else if (defender._chaosImmunity) {
      turnLog.push(`  🌀 ${defender.name} miễn nhiễm thiêu đốt (Hỗn Độn Đạo)!`);
    } else {
      const burnDmg = Math.floor(getEffectiveAtk(attacker) * fx.burn_damage_percent / 100);
      defender.statuses.push({
        type: 'burn',
        damage: burnDmg,
        duration: fx.burn_duration || 3,
        source: skill.id,
      });
      turnLog.push(`  🔥 ${defender.name} bị thiêu đốt, mất **${burnDmg}** HP/lượt trong **${fx.burn_duration || 3}** lượt!`);
    }
  }

  // Def break
  if (fx.def_break_percent) {
    defender.statuses.push({
      type: 'def_break',
      value: fx.def_break_percent / 100,
      duration: fx.duration || 2,
    });
    turnLog.push(`  💔 ${defender.name} bị phá phòng, giảm **${fx.def_break_percent}%** DEF!`);
  }
}

/**
 * Áp dụng đạo pháp special effects khi tấn công
 */
function applyDaoAttackEffects(attacker, defender, damage, turnLog) {
  const effects = getActiveDaoEffects(attacker);

  // Hỏa Đạo Lv5/Lv10: burn on hit (Lv10 upgrades to 6% and grants immunity)
  if (effects.burn_on_hit) {
    // Check defender immunity to burn
    if (defender._fireIceImmunity || defender._chaosImmunity) {
      // Defender is immune, don't apply burn
    } else {
      const burnPercent = effects.burn_percent || 3; // Lv10 overrides to 6
      const burnDmg = Math.floor(getEffectiveAtk(attacker) * burnPercent / 100);
      const hasDaoBurn = defender.statuses.find(s => s.type === 'burn' && s.source === 'hoa_dao');
      if (!hasDaoBurn) {
        defender.statuses.push({
          type: 'burn',
          damage: burnDmg,
          duration: effects.burn_duration || 3,
          source: 'hoa_dao',
        });
        turnLog.push(`  🔥 Hỏa Đạo Chân Ý! ${defender.name} bị Chân Hỏa thiêu đốt **${burnDmg}**/lượt!`);
      }
    }
  }

  // Lôi Đạo Lv5: chain lightning
  if (effects.chain_lightning_chance && chance(effects.chain_lightning_chance)) {
    const chainDmg = Math.floor(getEffectiveAtk(attacker) * (effects.chain_damage_percent || 50) / 100);
    defender.hp -= chainDmg;
    turnLog.push(`  ⚡ Lôi Đạo Chân Ý! Lôi Kích phụ gây thêm **${chainDmg}** sát thương!`);
  }

  // Hỗn Độn Đạo Lv5: chaos bonus damage (5% ATK on every attack)
  if (effects.chaos_bonus_damage_percent && damage > 0) {
    const chaosDmg = Math.floor(getEffectiveAtk(attacker) * effects.chaos_bonus_damage_percent / 100);
    if (chaosDmg > 0) {
      defender.hp -= chaosDmg;
      turnLog.push(`  🌀 Hỗn Độn Chân Ý! Gây thêm **${chaosDmg}** sát thương hỗn độn!`);
    }
  }
}

// ═══════════════════════════════════════════
//  PET AI & ACTIONS
// ═══════════════════════════════════════════

function choosePetAction(pet, owner, enemy) {
  if (!pet || !pet.skills || pet.skills.length === 0) return null;

  const available = pet.skills.filter(s => {
    const cd = pet.cooldowns[s.id] || 0;
    return cd <= 0;
  });
  if (available.length === 0) return null;

  // Heal owner if HP < 30%
  if (owner.hp / owner.maxHp < LOW_HP_THRESHOLD) {
    const healSkill = available.find(s => s.type === 'heal');
    if (healSkill) return healSkill;
  }

  // Defense/buff for owner if no active buff
  const hasBuff = owner.statuses.some(s => ['def_buff', 'shield', 'damage_reduction'].includes(s.type));
  if (!hasBuff) {
    const supportSkill = available.find(s => s.type === 'defense' || s.type === 'buff');
    if (supportSkill) return supportSkill;
  }

  // Debuff enemy
  const debuffSkill = available.find(s => s.type === 'debuff');
  if (debuffSkill) return debuffSkill;

  // Strongest attack
  const attacks = available.filter(s => s.damage_multiplier)
    .sort((a, b) => (b.damage_multiplier || 0) - (a.damage_multiplier || 0));
  if (attacks.length > 0) return attacks[0];

  return null;
}

function executePetAction(pet, owner, enemy, turnLog) {
  if (!pet || pet.hp <= 0) return;

  const skill = choosePetAction(pet, owner, enemy);
  const petName = pet.petName || pet.name || 'Linh Thú';
  const petEmoji = pet.petEmoji || '🐾';

  // Tick pet cooldowns
  for (const sid of Object.keys(pet.cooldowns)) {
    if (pet.cooldowns[sid] > 0) pet.cooldowns[sid] -= 1;
  }

  if (!skill) {
    // Basic pet attack
    const dmg = Math.max(1, Math.floor(pet.atk * PET_ATTACK_MULTIPLIER + randomInt(-2, 2)));
    const { mod: elMod, text: elText } = getElementModifier(pet.element, enemy.element || 'neutral');
    const finalDmg = Math.max(1, Math.floor(dmg * elMod));
    enemy.hp -= finalDmg;
    turnLog.push(`  ${petEmoji} ${petName} tấn công → ${enemy.name}, gây **${finalDmg}** sát thương!${elText}`);
    return;
  }

  // Set cooldown
  if (skill.cooldown) pet.cooldowns[skill.id] = skill.cooldown;

  if (skill.damage_multiplier) {
    const rawDmg = Math.max(1, Math.floor(pet.atk * skill.damage_multiplier));
    const { mod: elMod, text: elText } = getElementModifier(skill.element || pet.element, enemy.element || 'neutral');
    const finalDmg = Math.max(1, Math.floor(rawDmg * elMod));
    const { actualDamage } = applyDamageToFighter(enemy, finalDmg, turnLog);
    turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}** → ${enemy.name}, gây **${actualDamage}** sát thương!${elText}`);
  }

  if (skill.type === 'heal' && skill.effect) {
    const healAmt = Math.floor(owner.maxHp * (skill.effect.heal_percent || 10) / 100);
    owner.hp = Math.min(owner.hp + healAmt, owner.maxHp);
    turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}**, hồi **${healAmt}** HP cho chủ nhân!`);
  }

  if (skill.type === 'defense' && skill.effect) {
    if (skill.effect.shield_percent) {
      const shieldVal = Math.floor(owner.maxHp * skill.effect.shield_percent / 100);
      owner.statuses.push({ type: 'shield', value: shieldVal, duration: 3 });
      turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}**, tạo hộ thuẫn **${shieldVal}** cho chủ nhân!`);
    }
    if (skill.effect.damage_reduction) {
      owner.statuses.push({ type: 'damage_reduction', value: skill.effect.damage_reduction / 100, duration: skill.effect.duration || 3 });
      turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}**, giảm **${skill.effect.damage_reduction}%** sát thương!`);
    }
  }

  if (skill.type === 'buff' && skill.effect) {
    if (skill.effect.speed_percent) {
      owner.statuses.push({ type: 'speed_buff', value: skill.effect.speed_percent / 100, duration: 3 });
      turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}**, tăng **${skill.effect.speed_percent}%** tốc độ!`);
    }
    if (skill.effect.all_stats_percent) {
      const bonus = skill.effect.all_stats_percent / 100;
      owner.statuses.push({ type: 'atk_buff', value: bonus, duration: skill.effect.duration || 5 });
      owner.statuses.push({ type: 'def_buff', value: bonus, duration: skill.effect.duration || 5 });
      owner.statuses.push({ type: 'speed_buff', value: bonus, duration: skill.effect.duration || 5 });
      turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}**, tăng **${skill.effect.all_stats_percent}%** toàn chỉ số!`);
    }
  }

  if (skill.type === 'debuff' && skill.effect) {
    if (skill.effect.confuse_chance && chance(skill.effect.confuse_chance)) {
      enemy.statuses.push({ type: 'confuse', chance: skill.effect.confuse_chance, duration: skill.effect.duration || 2 });
      turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}**, địch bị hoang mang!`);
    }
    if (skill.effect.freeze_chance && chance(skill.effect.freeze_chance)) {
      enemy.statuses.push({ type: 'stun', duration: 1 });
      turnLog.push(`  ${petEmoji} ${petName} thi triển **${skill.name}**, địch bị đóng băng!`);
    }
  }
}

// ═══════════════════════════════════════════
//  DAO LAW PASSIVE CHECKS (mỗi lượt)
// ═══════════════════════════════════════════

/**
 * Kiểm tra passive đạo pháp mỗi lượt
 */
function checkDaoPassives(fighter, opponent, turnLog) {
  const effects = getActiveDaoEffects(fighter);

  // Thủy Đạo Lv5: hồi 2% HP/lượt
  if (effects.hp_regen_percent) {
    const regen = Math.floor(fighter.maxHp * effects.hp_regen_percent / 100);
    fighter.hp = Math.min(fighter.hp + regen, fighter.maxHp);
    turnLog.push(`  💧 Thủy Đạo hồi phục **${regen}** HP cho ${fighter.name}!`);
  }

  // Thủy Đạo Lv10: emergency heal khi HP dưới threshold
  if (effects.emergency_heal_percent && !fighter._emergencyHealUsed) {
    const threshold = (effects.emergency_heal_threshold || 10) / 100;
    if (fighter.hp > 0 && fighter.hp / fighter.maxHp <= threshold) {
      const healAmt = Math.floor(fighter.maxHp * effects.emergency_heal_percent / 100);
      fighter.hp = Math.min(fighter.hp + healAmt, fighter.maxHp);
      fighter._emergencyHealUsed = true;
      turnLog.push(`  🌊 **Thủy Đạo Bất Diệt!** ${fighter.name} hồi phục **${healAmt}** HP ở ranh giới sinh tử!`);
    }
  }

  // Tử Vong Đạo Lv10: xử tử kẻ địch HP < 15%
  if (effects.execute_threshold) {
    const executeHpRatio = effects.execute_threshold / 100;
    if (opponent.hp > 0 && opponent.hp / opponent.maxHp <= executeHpRatio) {
      opponent.hp = 0;
      turnLog.push(`  💀 **Tử Thần Giáng Lâm!** ${opponent.name} bị xử tử tức thì!`);
    }
  }

  // Không Gian Đạo Lv10: Space Prison — seal enemy skills 2 turns (bypasses CC immunity)
  if (effects.space_prison_duration && !fighter._spacePrisonUsed) {
    fighter._spacePrisonUsed = true;
    const sealDuration = effects.space_prison_duration;
    opponent.statuses.push({ type: 'seal', duration: sealDuration });
    turnLog.push(`  🔮 **Không Gian Tù Ngục!** ${opponent.name} bị phong ấn kỹ năng **${sealDuration}** lượt! (Xuyên miễn nhiễm)`);
  }

  // Thời Gian Đạo Lv10: Time Stop — skip enemy turn once when HP < 50%
  if (effects.time_stop_turns && !fighter._timeStopUsed) {
    if (fighter.hp > 0 && fighter.hp / fighter.maxHp < 0.5) {
      fighter._timeStopUsed = true;
      const stunTurns = effects.time_stop_turns;
      opponent.statuses.push({ type: 'stun', duration: stunTurns });
      turnLog.push(`  ⏰ **Thời Gian Đình Chỉ!** ${opponent.name} bị đóng băng thời gian **${stunTurns}** lượt! (Xuyên miễn nhiễm)`);
    }
  }
}

// ═══════════════════════════════════════════
//  COOLDOWN MANAGEMENT
// ═══════════════════════════════════════════

/**
 * Giảm cooldown tất cả skill xuống 1
 */
function tickCooldowns(fighter) {
  for (const skillId of Object.keys(fighter.cooldowns)) {
    if (fighter.cooldowns[skillId] > 0) {
      fighter.cooldowns[skillId] -= 1;
    }
  }
}

/**
 * Helper: Check and apply Tử Vong Đạo Lv5 kill heal
 */
function applyKillHeal(killer, turnLog) {
  const effects = getActiveDaoEffects(killer);
  if (effects.kill_heal_percent) {
    const healAmt = Math.floor(killer.maxHp * effects.kill_heal_percent / 100);
    killer.hp = Math.min(killer.hp + healAmt, killer.maxHp);
    turnLog.push(`  💀 Tử Vong Đạo! ${killer.name} hấp thụ sinh lực, hồi **${healAmt}** HP!`);
  }
}

// ═══════════════════════════════════════════
//  DEATH & REVIVE CHECK
// ═══════════════════════════════════════════

/**
 * Kiểm tra chết hoặc hồi sinh
 * @returns {boolean} true nếu fighter thật sự chết (không revive)
 */
function checkDeathOrRevive(fighter, turnLog) {
  if (fighter.hp > 0) return false; // Chưa chết

  // Kiểm tra hồi sinh từ công pháp (Bất Tử Kinh)
  if (!fighter._reviveUsed && fighter._revivePercent) {
    fighter._reviveUsed = true;
    const reviveHp = Math.floor(fighter.maxHp * fighter._revivePercent / 100);
    fighter.hp = reviveHp;
    turnLog.push(`  ✨ **HỒI SINH!** ${fighter.name} hồi sinh với **${reviveHp}** HP!`);
    return false; // Đã hồi sinh, chưa chết
  }

  return true; // Thật sự chết
}

// ═══════════════════════════════════════════
//  CORE SIMULATE COMBAT
// ═══════════════════════════════════════════

/**
 * Mô phỏng toàn bộ trận đấu
 * @param {Object} combatState - CombatState object
 * @returns {Object} CombatResult
 */
function simulateCombat(combatState) {
  const { player, enemy } = combatState;
  const turnLog = combatState.turnLog;

  // Áp dụng đạo pháp bonuses
  applyDaoLawBonuses(player);
  applyDaoLawBonuses(enemy);

  // Áp dụng công pháp bonuses
  applyTechniqueBonuses(player);
  applyTechniqueBonuses(enemy);

  // Áp dụng công pháp special effects
  applyTechniqueSpecialEffects(player, enemy, turnLog);
  applyTechniqueSpecialEffects(enemy, player, turnLog);

  // Hỏa Đạo Lv10: set fire/ice immunity flag
  const playerDaoFx = getActiveDaoEffects(player);
  const enemyDaoFx = getActiveDaoEffects(enemy);
  if (playerDaoFx.fire_immunity) player._fireIceImmunity = true;
  if (enemyDaoFx.fire_immunity) enemy._fireIceImmunity = true;

  // Hỗn Độn Đạo Lv10: set chaos immunity flag
  if (playerDaoFx.all_element_immunity) player._chaosImmunity = true;
  if (enemyDaoFx.all_element_immunity) enemy._chaosImmunity = true;

  // Lôi Đạo Lv10: thunder reflect + speed bonus at combat start
  if (playerDaoFx.thunder_reflect_percent) {
    player.statuses.push({ type: 'reflect', value: playerDaoFx.thunder_reflect_percent / 100, duration: 99 });
    turnLog.push(`  ⚡ Lôi Đạo Chân Ý! ${player.name} kích hoạt phản lôi **${playerDaoFx.thunder_reflect_percent}%**!`);
  }
  if (playerDaoFx.speed_bonus) {
    player.statuses.push({ type: 'speed_buff', value: playerDaoFx.speed_bonus / 100, duration: 99 });
    turnLog.push(`  ⚡ Lôi Đạo! ${player.name} tăng tốc **${playerDaoFx.speed_bonus}%**!`);
  }
  if (enemyDaoFx.thunder_reflect_percent) {
    enemy.statuses.push({ type: 'reflect', value: enemyDaoFx.thunder_reflect_percent / 100, duration: 99 });
  }
  if (enemyDaoFx.speed_bonus) {
    enemy.statuses.push({ type: 'speed_buff', value: enemyDaoFx.speed_bonus / 100, duration: 99 });
  }

  // Sáng Tạo Đạo Lv10: create domain — +30% all stats for 5 turns
  if (playerDaoFx.create_domain && !player._sangTaoDomainUsed) {
    player._sangTaoDomainUsed = true;
    const statsBonus = (playerDaoFx.all_stats_bonus || 30) / 100;
    player.statuses.push({ type: 'atk_buff', value: statsBonus, duration: 5 });
    player.statuses.push({ type: 'def_buff', value: statsBonus, duration: 5 });
    player.statuses.push({ type: 'speed_buff', value: statsBonus, duration: 5 });
    turnLog.push(`  🌟 **Sáng Tạo Lĩnh Vực!** ${player.name} kích hoạt lĩnh vực, tăng **${playerDaoFx.all_stats_bonus || 30}%** toàn chỉ số 5 lượt!`);
  }
  if (enemyDaoFx.create_domain && !enemy._sangTaoDomainUsed) {
    enemy._sangTaoDomainUsed = true;
    const statsBonus = (enemyDaoFx.all_stats_bonus || 30) / 100;
    enemy.statuses.push({ type: 'atk_buff', value: statsBonus, duration: 5 });
    enemy.statuses.push({ type: 'def_buff', value: statsBonus, duration: 5 });
    enemy.statuses.push({ type: 'speed_buff', value: statsBonus, duration: 5 });
    turnLog.push(`  🌟 **Sáng Tạo Lĩnh Vực!** ${enemy.name} kích hoạt lĩnh vực, tăng **${enemyDaoFx.all_stats_bonus || 30}%** toàn chỉ số 5 lượt!`);
  }

  const techName = player.technique ? `📜 ${player.technique.name}` : '';
  const petInfo = player.pet ? `🐾 ${player.pet.petName || 'Linh Thú'} (ATK:${player.pet.atk})` : '';
  turnLog.push(`⚔️ **TRẬN CHIẾN BẮT ĐẦU!**`);
  turnLog.push(`👤 ${player.name} — HP: ${player.hp}/${player.maxHp} | ATK: ${player.atk} | DEF: ${player.def} | SPD: ${player.speed}${techName ? ' | ' + techName : ''}`);
  turnLog.push(`👹 ${enemy.emoji || '👹'} ${enemy.name} — HP: ${enemy.hp}/${enemy.maxHp} | ATK: ${enemy.atk} | DEF: ${enemy.def} | SPD: ${enemy.speed}`);
  if (petInfo) turnLog.push(petInfo);
  turnLog.push('─'.repeat(40));

  while (combatState.turn < combatState.maxTurns) {
    combatState.turn += 1;
    turnLog.push(`\n📍 **Lượt ${combatState.turn}**`);

    // Mana regen
    player.mana = Math.min(player.maxMana, player.mana + Math.floor(player.maxMana * 0.02));
    enemy.mana = Math.min(enemy.maxMana, enemy.mana + Math.floor(enemy.maxMana * 0.02));

    // Boss phase transitions
    if (enemy.isBoss && enemy.phases && enemy.phases > 1) {
      if (!enemy._currentPhase) enemy._currentPhase = 1;
      const hpRatio = enemy.hp / enemy.maxHp;
      const thresholds = [0.7, 0.4]; // Phase 2 at 70% HP, Phase 3 at 40%

      for (let i = 0; i < thresholds.length && i + 1 < enemy.phases; i++) {
        if (hpRatio <= thresholds[i] && enemy._currentPhase <= i + 1) {
          enemy._currentPhase = i + 2;
          // Phase transition effects
          enemy.atk = Math.floor(enemy.atk * 1.2); // +20% ATK
          enemy.speed = Math.floor(enemy.speed * 1.1); // +10% speed
          enemy.statuses = enemy.statuses.filter(s => !['burn','poison','stun','slow','seal','confuse','atk_debuff','def_break'].includes(s.type)); // Clear debuffs
          const phaseHeal = Math.floor(enemy.maxHp * 0.1);
          enemy.hp = Math.min(enemy.hp + phaseHeal, enemy.maxHp);
          turnLog.push(`\n⚡ **${enemy.name}** chuyển sang **Giai Đoạn ${enemy._currentPhase}**!`);
          turnLog.push(`  💪 Sức mạnh bùng nổ! ATK tăng, tốc độ tăng!`);
          turnLog.push(`  💚 Hồi phục **${phaseHeal}** HP! Xóa sạch debuff!`);
        }
      }
    }

    // Invincible tick
    if (player._invincibleTurns > 0) player._invincibleTurns--;
    if (enemy._invincibleTurns > 0) enemy._invincibleTurns--;

    // Transform tick
    if (player._transformTurns > 0) player._transformTurns--;
    if (enemy._transformTurns > 0) enemy._transformTurns--;

    // Xác định thứ tự hành động theo speed
    const playerSpeed = getEffectiveSpeed(player);
    const enemySpeed = getEffectiveSpeed(enemy);
    const playerFirst = playerSpeed >= enemySpeed;

    const first = playerFirst ? player : enemy;
    const second = playerFirst ? enemy : player;
    const firstTarget = playerFirst ? enemy : player;
    const secondTarget = playerFirst ? player : enemy;

    // ── LƯỢT BÊN ĐI TRƯỚC ──
    // Start-of-turn effects
    applyStartOfTurnEffects(first, turnLog);
    if (first.hp <= 0) {
      if (checkDeathOrRevive(first, turnLog)) {
        first.hp = 0;
        turnLog.push(`💀 ${first.name} đã bị đánh bại bởi hiệu ứng!`);
        combatState.winner = first === player ? 'enemy' : 'player';
        break;
      }
    }

    // Kiểm tra đạo pháp passives
    checkDaoPassives(first, firstTarget, turnLog);
    if (firstTarget.hp <= 0) {
      if (checkDeathOrRevive(firstTarget, turnLog)) {
        firstTarget.hp = 0;
        turnLog.push(`💀 ${firstTarget.name} đã bị đánh bại!`);
        combatState.winner = firstTarget === player ? 'enemy' : 'player';
        break;
      }
    }

    // Chọn & thực hiện action
    if (isStunned(first)) {
      turnLog.push(`  😵 ${first.name} đang bị **CHOÁNG**, không thể hành động!`);
    } else {
      const action = first.isPlayer ? choosePlayerAction(first) : chooseEnemyAction(first);
      executeAction(first, firstTarget, action, turnLog);
    }

    // Kiểm tra chết
    if (firstTarget.hp <= 0) {
      if (checkDeathOrRevive(firstTarget, turnLog)) {
        firstTarget.hp = 0;
        turnLog.push(`💀 ${firstTarget.name} đã bị đánh bại!`);
        combatState.winner = firstTarget === player ? 'enemy' : 'player';
        // Tử Vong Đạo Lv5: kill heal
        applyKillHeal(first, turnLog);
        break;
      }
    }

    // Pet action (chỉ sau lượt player)
    if (first === player && player.pet) {
      executePetAction(player.pet, player, enemy, turnLog);
      if (enemy.hp <= 0) {
        if (checkDeathOrRevive(enemy, turnLog)) {
          enemy.hp = 0;
          turnLog.push(`💀 ${enemy.name} đã bị linh thú hạ gục!`);
          combatState.winner = 'player';
          applyKillHeal(player, turnLog);
          break;
        }
      }
    }

    // ── LƯỢT BÊN ĐI SAU ──
    applyStartOfTurnEffects(second, turnLog);
    if (second.hp <= 0) {
      if (checkDeathOrRevive(second, turnLog)) {
        second.hp = 0;
        turnLog.push(`💀 ${second.name} đã bị đánh bại bởi hiệu ứng!`);
        combatState.winner = second === player ? 'enemy' : 'player';
        break;
      }
    }

    checkDaoPassives(second, secondTarget, turnLog);
    if (secondTarget.hp <= 0) {
      if (checkDeathOrRevive(secondTarget, turnLog)) {
        secondTarget.hp = 0;
        turnLog.push(`💀 ${secondTarget.name} đã bị đánh bại!`);
        combatState.winner = secondTarget === player ? 'enemy' : 'player';
        applyKillHeal(second, turnLog);
        break;
      }
    }

    if (isStunned(second)) {
      turnLog.push(`  😵 ${second.name} đang bị **CHOÁNG**, không thể hành động!`);
    } else {
      const action = second.isPlayer ? choosePlayerAction(second) : chooseEnemyAction(second);
      executeAction(second, secondTarget, action, turnLog);
    }

    if (secondTarget.hp <= 0) {
      if (checkDeathOrRevive(secondTarget, turnLog)) {
        secondTarget.hp = 0;
        turnLog.push(`💀 ${secondTarget.name} đã bị đánh bại!`);
        combatState.winner = secondTarget === player ? 'enemy' : 'player';
        break;
      }
    }

    // Pet action (nếu player đi sau)
    if (second === player && player.pet) {
      executePetAction(player.pet, player, enemy, turnLog);
      if (enemy.hp <= 0) {
        if (checkDeathOrRevive(enemy, turnLog)) {
          enemy.hp = 0;
          turnLog.push(`💀 ${enemy.name} đã bị linh thú hạ gục!`);
          combatState.winner = 'player';
          applyKillHeal(player, turnLog);
          break;
        }
      }
    }

    // Tick cooldowns cả 2 bên
    tickCooldowns(player);
    tickCooldowns(enemy);
  }

  // Hết lượt → hòa (player sống sót)
  if (!combatState.winner) {
    combatState.winner = 'draw';
    turnLog.push(`\n⏳ Đã đạt giới hạn **${combatState.maxTurns}** lượt. Trận đấu hòa!`);
  }

  turnLog.push('─'.repeat(40));
  const winnerLabel = combatState.winner === 'player' ? `🏆 ${player.name} CHIẾN THẮNG!`
    : combatState.winner === 'enemy' ? `💀 ${enemy.name} CHIẾN THẮNG!`
    : '🤝 HÒA — Cả hai sống sót!';
  turnLog.push(winnerLabel);

  return {
    winner: combatState.winner,
    turnLog: turnLog,
    totalTurns: combatState.turn,
    playerHpRemaining: Math.max(0, player.hp),
    enemyHpRemaining: Math.max(0, enemy.hp),
    playerManaRemaining: Math.max(0, player.mana),
  };
}

// ═══════════════════════════════════════════
//  DATA LOADING FROM DB
// ═══════════════════════════════════════════

/**
 * Load kỹ năng đã trang bị của player từ DB
 * @param {number} playerId
 * @returns {Array} Danh sách skill config
 */
function loadPlayerSkills(playerId) {
  const equippedRows = db.prepare(
    'SELECT skill_id FROM player_skills WHERE player_id = ? ORDER BY slot ASC'
  ).all(playerId);

  const skills = [];
  for (const row of equippedRows) {
    const skillConfig = getSkillById(row.skill_id);
    if (skillConfig) {
      skills.push({ ...skillConfig }); // Copy để tránh mutate config gốc
    }
  }
  return skills;
}

/**
 * Load linh thú đang active của player
 * @param {number} playerId
 * @returns {Object|null}
 */
function loadActivePet(playerId) {
  const petRow = db.prepare(
    'SELECT * FROM player_pets WHERE player_id = ? AND is_active = 1'
  ).get(playerId);
  if (!petRow) return null;

  const petConfig = petsConfig.getPetById(petRow.pet_id);
  const levelStats = petsConfig.getStatsAtLevel(petRow.pet_id, petRow.level || 1);

  return {
    ...petRow,
    config: petConfig,
    skills: petConfig ? petConfig.skills : [],
    element: petConfig ? petConfig.element : 'neutral',
    hp: levelStats ? levelStats.hp : (petRow.atk || 5) * 2,
    maxHp: levelStats ? levelStats.hp : (petRow.atk || 5) * 2,
    atk: levelStats ? levelStats.atk : (petRow.atk || 5),
    def: levelStats ? levelStats.def : 0,
    cooldowns: {},
    petName: petRow.name || (petConfig ? petConfig.name : 'Linh Thú'),
    petEmoji: petConfig ? petConfig.emoji : '🐾',
  };
}

/**
 * Load đạo pháp của player
 * @param {number} playerId
 * @returns {Array}
 */
function loadPlayerDaoLaws(playerId) {
  return db.prepare(
    'SELECT law_id, level FROM player_dao_laws WHERE player_id = ?'
  ).all(playerId);
}

// ═══════════════════════════════════════════
//  PUBLIC API: createPvECombat
// ═══════════════════════════════════════════

/**
 * Tạo và mô phỏng trận PvE (Player vs Monster)
 * @param {Object} player - Dữ liệu player từ DB (bảng players)
 * @param {Object} monster - Dữ liệu monster từ config
 * @param {Object} dbInstance - Database instance (unused, dùng module-level db)
 * @returns {Object} CombatResult
 */
function createPvECombat(player, monster, dbInstance) {
  // Load dữ liệu player
  const skills = loadPlayerSkills(player.id);
  const pet = loadActivePet(player.id);
  const daoLaws = loadPlayerDaoLaws(player.id);
  const technique = techniquesConfig.getTechniqueById(player.technique_id);

  // Lấy chỉ số từ trang bị
  const { getEquippedStats } = require('./equipment');
  const eqStats = getEquippedStats(player.id);

  // Build player state
  const playerState = buildFighterState({
    id: player.id,
    name: player.name,
    emoji: '👤',
    hp: player.hp || player.max_hp,
    max_hp: player.max_hp + (eqStats.hp || 0),
    mana: player.mana || player.max_mana,
    max_mana: player.max_mana + (eqStats.mana || 0),
    atk: player.atk + (eqStats.atk || 0),
    def: player.def + (eqStats.def || 0),
    speed: player.speed + (eqStats.speed || 0),
    skills: skills,
    pet: pet,
    technique: technique || null,
    element: technique ? (technique.special?.effect?.element || 'neutral') : 'neutral',
    daoLaws: daoLaws,
    isPlayer: true,
  });

  // Build enemy state
  let enemySkills = (monster.skills || []).map(skillId => {
    const config = getSkillById(skillId);
    return config ? { ...config } : null;
  }).filter(Boolean);

  // Add boss skills
  if (monster.boss_skills) {
    const bossSkills = monster.boss_skills.map(skillId => {
      const config = bossSkillsConfig.getBossSkillById(skillId);
      return config ? { ...config } : null;
    }).filter(Boolean);
    enemySkills = [...enemySkills, ...bossSkills];
  }

  const enemyState = buildFighterState({
    id: monster.id || 'monster',
    name: monster.name,
    emoji: monster.emoji || '👹',
    hp: monster.hp || monster.max_hp,
    max_hp: monster.max_hp || monster.hp,
    mana: monster.mana || monster.max_mana || 100,
    max_mana: monster.max_mana || 100,
    atk: monster.atk,
    def: monster.def,
    speed: monster.speed || 10,
    skills: enemySkills,
    element: monster.element || 'neutral',
    isBoss: monster.isBoss || false,
    phases: monster.phases || 1,
    isPlayer: false,
  });

  const combatState = createCombatState(playerState, enemyState);
  return simulateCombat(combatState);
}

// ═══════════════════════════════════════════
//  PUBLIC API: createPvPCombat
// ═══════════════════════════════════════════

/**
 * Tạo và mô phỏng trận PvP (Player vs Player)
 * Không có pet trong PvP v1 để đơn giản hóa.
 * @param {Object} player1 - Dữ liệu player 1 từ DB
 * @param {Object} player2 - Dữ liệu player 2 từ DB
 * @param {Object} dbInstance - Database instance (unused)
 * @returns {Object} CombatResult
 */
function createPvPCombat(player1, player2, dbInstance) {
  const { getEquippedStats } = require('./equipment');
  
  // Load dữ liệu player 1
  const skills1 = loadPlayerSkills(player1.id);
  const daoLaws1 = loadPlayerDaoLaws(player1.id);
  const eqStats1 = getEquippedStats(player1.id);

  const p1State = buildFighterState({
    id: player1.id,
    name: player1.name,
    emoji: '🔵',
    hp: player1.hp || player1.max_hp,
    max_hp: player1.max_hp + (eqStats1.hp || 0),
    mana: player1.mana || player1.max_mana,
    max_mana: player1.max_mana + (eqStats1.mana || 0),
    atk: player1.atk + (eqStats1.atk || 0),
    def: player1.def + (eqStats1.def || 0),
    speed: player1.speed + (eqStats1.speed || 0),
    skills: skills1,
    pet: null, // Không pet trong PvP v1
    daoLaws: daoLaws1,
    isPlayer: true,
  });

  // Load dữ liệu player 2
  const skills2 = loadPlayerSkills(player2.id);
  const daoLaws2 = loadPlayerDaoLaws(player2.id);
  const eqStats2 = getEquippedStats(player2.id);

  const p2State = buildFighterState({
    id: player2.id,
    name: player2.name,
    emoji: '🔴',
    hp: player2.hp || player2.max_hp,
    max_hp: player2.max_hp + (eqStats2.hp || 0),
    mana: player2.mana || player2.max_mana,
    max_mana: player2.max_mana + (eqStats2.mana || 0),
    atk: player2.atk + (eqStats2.atk || 0),
    def: player2.def + (eqStats2.def || 0),
    speed: player2.speed + (eqStats2.speed || 0),
    skills: skills2,
    pet: null,
    daoLaws: daoLaws2,
    isPlayer: false, // P2 dùng enemy AI (random)
  });

  const combatState = createCombatState(p1State, p2State);
  return simulateCombat(combatState);
}

module.exports = {
  createPvECombat,
  createPvPCombat,
  simulateCombat,
};
