/**
 * @file Interactive Combat Engine (Hệ Thống Chiến Đấu Tương Tác)
 * @description Turn-based interactive combat cho Boss fights.
 *
 * Thay vì auto-simulate 30 lượt, mỗi lượt người chơi chọn hành động:
 *   ⚔️ Đánh Thường | 🎯 Kỹ Năng | 🧪 Đan Dược (future) | 🏃 Bỏ Chạy
 *
 * State được lưu trong client._interactiveCombats Map (key = interaction.user.id).
 *
 * Exports:
 *   initInteractiveCombat, executePlayerTurn,
 *   buildInteractiveEmbed, buildActionButtons, buildSkillSelectMenu,
 *   createHpBar, createManaBar
 */

const db = require('../database/connection');
const { getSkillById } = require('../../config/skills');
const bossSkillsConfig = require('../../config/boss-skills');
const techniquesConfig = require('../../config/techniques');
const petsConfig = require('../../config/pets');
const { randomInt, chance, clamp } = require('../utils/helpers');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

// ═══════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════
const MAX_TURNS = 50;
const DEF_REDUCTION_FACTOR = 0.3;
const DAMAGE_VARIANCE = 5;
const LOW_HP_THRESHOLD = 0.3;
const MANA_REGEN_PERCENT = 3; // 3% max mana per turn

// ═══════════════════════════════════════════
//  DATA LOADERS (mirror from combat.js)
// ═══════════════════════════════════════════

function loadPlayerSkills(playerId) {
  const equippedRows = db.prepare(
    'SELECT skill_id FROM player_skills WHERE player_id = ? ORDER BY slot ASC'
  ).all(playerId);

  const skills = [];
  for (const row of equippedRows) {
    const skillConfig = getSkillById(row.skill_id);
    if (skillConfig) {
      skills.push({ ...skillConfig });
    }
  }
  return skills;
}

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

function loadPlayerDaoLaws(playerId) {
  return db.prepare(
    'SELECT law_id, level FROM player_dao_laws WHERE player_id = ?'
  ).all(playerId);
}

// ═══════════════════════════════════════════
//  FIGHTER STATE
// ═══════════════════════════════════════════

/**
 * Tạo fighter state cho interactive combat
 * @param {Object} data - Dữ liệu fighter
 * @returns {Object} Fighter state
 */
function createFighter(data) {
  return {
    id: data.id,
    name: data.name,
    emoji: data.emoji || '👤',
    hp: data.hp,
    maxHp: data.maxHp,
    mana: data.mana || 100,
    maxMana: data.maxMana || 100,
    atk: data.atk,
    def: data.def,
    speed: data.speed || 10,
    skills: data.skills || [],
    cooldowns: {},
    statuses: [],
    isPlayer: data.isPlayer || false,
    pet: data.pet || null,
    technique: data.technique || null,
    element: data.element || 'neutral',
    critRate: data.critRate || 5,
    critDamage: data.critDamage || 50,
    lifeSteal: data.lifeSteal || 0,
    armorPen: data.armorPen || 0,
  };
}

// ═══════════════════════════════════════════
//  EFFECTIVE STATS (buff/debuff aware)
// ═══════════════════════════════════════════

function getEffectiveAtk(fighter) {
  let atk = fighter.atk;
  for (const s of fighter.statuses) {
    if (s.type === 'atk_buff') atk = Math.floor(atk * (1 + (s.value || 0)));
    if (s.type === 'atk_debuff') atk = Math.floor(atk * (1 - (s.value || 0)));
  }
  return Math.max(1, atk);
}

function getEffectiveDef(fighter) {
  let def = fighter.def;
  for (const s of fighter.statuses) {
    if (s.type === 'def_buff') def = Math.floor(def * (1 + (s.value || 0)));
    if (s.type === 'def_break') def = Math.floor(def * (1 - (s.value || 0)));
  }
  return Math.max(0, def);
}

function getEffectiveSpeed(fighter) {
  let speed = fighter.speed;
  for (const s of fighter.statuses) {
    if (s.type === 'speed_buff') speed = Math.floor(speed * (1 + (s.value || 0)));
    if (s.type === 'slow') speed = Math.floor(speed * (1 - (s.value || 0.25)));
  }
  return Math.max(1, speed);
}

function isStunned(fighter) {
  return fighter.statuses.some(s => s.type === 'stun');
}

function isSealed(fighter) {
  return fighter.statuses.some(s => s.type === 'seal');
}

// ═══════════════════════════════════════════
//  DAMAGE & SHIELD
// ═══════════════════════════════════════════

/**
 * Áp dụng sát thương qua shield + damage reduction
 */
function applyDamageToFighter(fighter, damage, log) {
  let remaining = damage;

  // Damage reduction
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
      log.push(`  🛡️ Hộ thuẫn hấp thụ **${absorbed}** sát thương!`);
    }
    if (shieldStatus.value <= 0) {
      fighter.statuses = fighter.statuses.filter(s => s !== shieldStatus);
      log.push(`  💥 Hộ thuẫn ${fighter.name} đã vỡ!`);
    }
  }

  fighter.hp -= remaining;

  // Reflect
  let reflectDmg = 0;
  for (const s of fighter.statuses) {
    if (s.type === 'reflect') {
      reflectDmg += Math.floor(damage * (s.value || 0));
    }
  }

  return { actualDamage: remaining, reflectDamage: reflectDmg };
}

/**
 * Tính sát thương cơ bản
 */
function calcDamage(atk, def, multiplier = 1.0, armorPen = 0) {
  const effectiveDef = armorPen > 0 ? Math.floor(def * (1 - armorPen / 100)) : def;
  const variance = randomInt(-DAMAGE_VARIANCE, DAMAGE_VARIANCE);
  return Math.max(1, Math.floor(atk * multiplier - effectiveDef * DEF_REDUCTION_FACTOR + variance));
}

// ═══════════════════════════════════════════
//  STATUS EFFECT NAMES
// ═══════════════════════════════════════════

function getStatusName(type) {
  const names = {
    burn: 'Thiêu Đốt', poison: 'Trúng Độc', stun: 'Choáng', hot: 'Hồi Máu',
    def_buff: 'Tăng Phòng', shield: 'Hộ Thuẫn', slow: 'Chậm', atk_buff: 'Tăng Công',
    speed_buff: 'Tăng Tốc', seal: 'Phong Ấn', confuse: 'Hoang Mang',
    def_break: 'Phá Phòng', atk_debuff: 'Giảm Công', damage_reduction: 'Giảm Thương',
    reflect: 'Phản Thương',
  };
  return names[type] || type;
}

// ═══════════════════════════════════════════
//  INIT INTERACTIVE COMBAT
// ═══════════════════════════════════════════

/**
 * Khởi tạo trạng thái interactive combat
 * @param {Object} player - Dữ liệu player từ DB
 * @param {Object} monster - Dữ liệu monster từ config
 * @returns {Object} Interactive combat state
 */
function initInteractiveCombat(player, monster) {
  // Load player data
  const skills = loadPlayerSkills(player.id);
  const pet = loadActivePet(player.id);
  const technique = techniquesConfig.getTechniqueById(player.technique_id);

  // Equipment stats
  const { getEquippedStats } = require('./equipment');
  const eqStats = getEquippedStats(player.id);

  // Technique bonuses
  let bonusAtk = 0, bonusDef = 0, bonusHp = 0, bonusMana = 0, bonusSpeed = 0;
  let critRate = 5, critDamage = 50, lifeSteal = 0, armorPen = 0;
  if (technique && technique.stat_bonuses) {
    const b = technique.stat_bonuses;
    bonusAtk = b.atk || 0;
    bonusDef = b.def || 0;
    bonusHp = b.hp || 0;
    bonusMana = b.mana || 0;
    bonusSpeed = b.speed || 0;
    critRate += b.crit_rate || 0;
    critDamage += b.crit_damage || 0;
    lifeSteal += b.life_steal || 0;
  }
  if (technique && technique.special && technique.special.effect) {
    const fx = technique.special.effect;
    if (fx.armor_penetration) armorPen = fx.armor_penetration;
    if (fx.life_steal_percent) lifeSteal += fx.life_steal_percent;
  }

  const totalHp = (player.max_hp || 100) + (eqStats.hp || 0) + bonusHp;
  const totalMana = (player.max_mana || 50) + (eqStats.mana || 0) + bonusMana;

  const playerState = createFighter({
    id: player.id,
    name: player.name,
    emoji: '👤',
    hp: Math.min(player.hp || totalHp, totalHp),
    maxHp: totalHp,
    mana: totalMana,
    maxMana: totalMana,
    atk: (player.atk || 10) + (eqStats.atk || 0) + bonusAtk,
    def: (player.def || 5) + (eqStats.def || 0) + bonusDef,
    speed: (player.speed || 10) + (eqStats.speed || 0) + bonusSpeed,
    skills,
    isPlayer: true,
    pet,
    technique,
    element: technique ? (technique.special?.effect?.element || 'neutral') : 'neutral',
    critRate,
    critDamage,
    lifeSteal,
    armorPen,
  });

  // Apply technique special effects on player at start
  if (technique && technique.special && technique.special.effect) {
    const fx = technique.special.effect;
    if (fx.shield_percent) {
      const shieldVal = Math.floor(playerState.maxHp * fx.shield_percent / 100);
      playerState.statuses.push({ type: 'shield', value: shieldVal, duration: 99 });
    }
    if (fx.damage_reduction) {
      playerState.statuses.push({ type: 'damage_reduction', value: fx.damage_reduction / 100, duration: 99 });
    }
    if (fx.hp_regen_percent) {
      playerState.statuses.push({ type: 'hot', healPercent: fx.hp_regen_percent, duration: 99 });
    }
  }

  // Dao laws stat bonuses (simplified)
  const daoLaws = loadPlayerDaoLaws(player.id);
  if (daoLaws && daoLaws.length > 0) {
    try {
      const daoLawsConfig = require('../../config/dao-laws');
      for (const law of daoLaws) {
        const bonuses = daoLawsConfig.getBonusesAtLevel(law.law_id, law.level);
        if (bonuses) {
          if (bonuses.atk_percent) playerState.atk = Math.floor(playerState.atk * (1 + bonuses.atk_percent / 100));
          if (bonuses.hp_percent) {
            const hpBonus = Math.floor(playerState.maxHp * bonuses.hp_percent / 100);
            playerState.maxHp += hpBonus;
            playerState.hp = Math.min(playerState.hp + hpBonus, playerState.maxHp);
          }
          if (bonuses.def_percent) playerState.def = Math.floor(playerState.def * (1 + bonuses.def_percent / 100));
          if (bonuses.speed_percent) playerState.speed = Math.floor(playerState.speed * (1 + bonuses.speed_percent / 100));
        }
      }
    } catch (_err) { /* dao laws config missing */ }
  }

  // Build enemy skills
  let enemySkills = [];
  if (monster.boss_skills) {
    enemySkills = monster.boss_skills
      .map(id => bossSkillsConfig.getBossSkillById(id))
      .filter(Boolean)
      .map(s => ({ ...s }));
  }
  if (monster.skills) {
    const normalSkills = monster.skills
      .map(id => getSkillById(id))
      .filter(Boolean)
      .map(s => ({ ...s }));
    enemySkills = [...enemySkills, ...normalSkills];
  }

  const enemyState = createFighter({
    id: monster.id,
    name: monster.name,
    emoji: monster.emoji || '👹',
    hp: monster.hp,
    maxHp: monster.hp,
    mana: 200,
    maxMana: 200,
    atk: monster.atk,
    def: monster.def,
    speed: monster.speed || 10,
    skills: enemySkills,
    isPlayer: false,
    element: monster.element || 'neutral',
  });

  return {
    player: playerState,
    enemy: enemyState,
    turn: 0,
    maxTurns: MAX_TURNS,
    turnLog: [],
    startTime: Date.now(),
    monsterData: monster, // Keep reference for rewards
  };
}

// ═══════════════════════════════════════════
//  EXECUTE PLAYER TURN
// ═══════════════════════════════════════════

/**
 * Thực thi một lượt đầy đủ: Player action → Pet → Enemy action → Tick effects
 * @param {Object} state - Interactive combat state
 * @param {string} actionType - 'basic' | 'skill' | 'flee'
 * @param {string|null} skillId - Skill ID nếu actionType = 'skill'
 * @returns {{ log: string[], playerDead: boolean, enemyDead: boolean, fled: boolean }}
 */
function executePlayerTurn(state, actionType, skillId = null) {
  state.turn += 1;
  const { player, enemy } = state;
  const log = [`\n═══ Lượt ${state.turn} ═══`];

  // Mana regen
  player.mana = Math.min(player.maxMana, player.mana + Math.floor(player.maxMana * MANA_REGEN_PERCENT / 100));
  enemy.mana = Math.min(enemy.maxMana, enemy.mana + Math.floor(enemy.maxMana * MANA_REGEN_PERCENT / 100));

  // Tick cooldowns
  for (const sk of player.skills) {
    if (player.cooldowns[sk.id] > 0) player.cooldowns[sk.id]--;
  }
  for (const sk of enemy.skills) {
    if (enemy.cooldowns[sk.id] > 0) enemy.cooldowns[sk.id]--;
  }

  let fled = false;
  let playerDead = false;
  let enemyDead = false;

  // Apply DoT/HoT at start of turn
  _applyStartOfTurnEffects(player, log);
  _applyStartOfTurnEffects(enemy, log);

  // Check player death from DoT
  if (player.hp <= 0) {
    player.hp = 0;
    playerDead = true;
    log.push(`\n💀 **${player.name} đã bị đánh bại bởi hiệu ứng trạng thái!**`);
    state.turnLog.push(...log);
    return { log, playerDead, enemyDead, fled };
  }
  // Check enemy death from DoT
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemyDead = true;
    log.push(`\n💀 **${enemy.name} đã bị tiêu diệt bởi hiệu ứng trạng thái!**`);
    state.turnLog.push(...log);
    return { log, playerDead, enemyDead, fled };
  }

  // Check player stun
  const playerStunned = isStunned(player);
  if (playerStunned) {
    log.push(`💫 ${player.name} bị choáng, không thể hành động!`);
  } else {
    // ═══ PLAYER ACTION ═══
    if (actionType === 'flee') {
      const fleeChance = 30 + Math.max(0, getEffectiveSpeed(player) - getEffectiveSpeed(enemy));
      if (chance(fleeChance)) {
        log.push(`🏃 ${player.name} bỏ chạy thành công!`);
        fled = true;
        state.turnLog.push(...log);
        return { log, playerDead, enemyDead, fled };
      } else {
        log.push(`🏃 ${player.name} cố bỏ chạy nhưng thất bại!`);
      }
    } else if (actionType === 'basic') {
      _executeBasicAttack(player, enemy, log);
    } else if (actionType === 'skill' && skillId) {
      _executeSkillAction(player, enemy, skillId, log);
    }
  }

  // Pet action
  if (player.pet && player.pet.atk && !playerStunned) {
    const petAtk = player.pet.atk;
    const petDmg = Math.max(1, Math.floor(petAtk * 0.8 + randomInt(-3, 3)));
    const { actualDamage } = applyDamageToFighter(enemy, petDmg, log);
    log.push(`${player.pet.petEmoji} ${player.pet.petName} tấn công gây **${actualDamage}** sát thương!`);
  }

  // Check enemy death after player action
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemyDead = true;
    log.push(`\n💀 **${enemy.name} đã bị tiêu diệt!**`);
    state.turnLog.push(...log);
    return { log, playerDead, enemyDead, fled };
  }

  // ═══ ENEMY ACTION ═══
  const enemyStunned = isStunned(enemy);
  if (enemyStunned) {
    log.push(`💫 ${enemy.name} bị choáng, không thể hành động!`);
  } else {
    _executeEnemyAction(player, enemy, log);
  }

  // Check player death
  if (player.hp <= 0) {
    player.hp = 0;
    playerDead = true;
    log.push(`\n💀 **${player.name} đã bị đánh bại!**`);
  }
  // Check enemy death (from reflect etc)
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemyDead = true;
    log.push(`\n💀 **${enemy.name} đã bị tiêu diệt!**`);
  }

  // Tick status durations
  player.statuses = player.statuses.filter(s => {
    if (s.duration === 99) return true; // permanent (technique)
    s.duration--;
    if (s.duration <= 0) {
      log.push(`  ⏳ **${getStatusName(s.type)}** trên ${player.name} đã hết.`);
      return false;
    }
    return true;
  });
  enemy.statuses = enemy.statuses.filter(s => {
    if (s.duration === 99) return true;
    s.duration--;
    if (s.duration <= 0) {
      log.push(`  ⏳ **${getStatusName(s.type)}** trên ${enemy.name} đã hết.`);
      return false;
    }
    return true;
  });

  // Max turns check
  if (state.turn >= state.maxTurns && !playerDead && !enemyDead) {
    log.push(`\n⏰ **Hết thời gian! Trận chiến bất phân thắng bại!**`);
  }

  state.turnLog.push(...log);
  return { log, playerDead, enemyDead, fled };
}

// ═══════════════════════════════════════════
//  ACTION IMPLEMENTATIONS
// ═══════════════════════════════════════════

function _executeBasicAttack(attacker, defender, log) {
  const atk = getEffectiveAtk(attacker);
  const def = getEffectiveDef(defender);
  let dmg = calcDamage(atk, def, 1.0, attacker.armorPen);

  // Crit
  const critRate = (attacker.critRate || 5) + Math.floor(getEffectiveSpeed(attacker) / 50);
  let isCrit = false;
  if (chance(critRate)) {
    dmg = Math.floor(dmg * (1 + (attacker.critDamage || 50) / 100));
    isCrit = true;
  }

  const { actualDamage, reflectDamage } = applyDamageToFighter(defender, dmg, log);
  const critText = isCrit ? ' 💥 **BẠO KÍCH!**' : '';
  log.push(`⚔️ ${attacker.name} đánh thường → ${defender.name}, gây **${actualDamage}** sát thương!${critText}`);

  // Reflect
  if (reflectDamage > 0) {
    attacker.hp -= reflectDamage;
    log.push(`  🔄 ${attacker.name} nhận **${reflectDamage}** phản thương!`);
  }

  // Life steal
  if (attacker.lifeSteal > 0 && actualDamage > 0) {
    const heal = Math.floor(actualDamage * attacker.lifeSteal / 100);
    if (heal > 0) {
      attacker.hp = Math.min(attacker.hp + heal, attacker.maxHp);
      log.push(`  🩸 Hút **${heal}** HP!`);
    }
  }
}

function _executeSkillAction(player, enemy, skillId, log) {
  const skill = player.skills.find(s => s.id === skillId || s.id === parseInt(skillId));
  if (!skill) {
    log.push(`❌ Kỹ năng không tìm thấy!`);
    return;
  }
  if ((player.cooldowns[skill.id] || 0) > 0) {
    log.push(`❌ **${skill.name}** đang hồi chiêu! (còn ${player.cooldowns[skill.id]} lượt)`);
    return;
  }
  if (skill.mana_cost && player.mana < skill.mana_cost) {
    log.push(`❌ Không đủ linh lực! Cần ${skill.mana_cost}, hiện có ${player.mana}`);
    return;
  }

  // Use mana + set cooldown
  if (skill.mana_cost) player.mana -= skill.mana_cost;
  if (skill.cooldown) player.cooldowns[skill.id] = skill.cooldown;

  const multiplier = skill.damage_multiplier || 1.0;
  const emoji = skill.emoji || '💥';

  switch (skill.type) {
    case 'attack':
    case 'ultimate': {
      const atk = getEffectiveAtk(player);
      let def = getEffectiveDef(enemy);
      if (skill.extra_effect && skill.extra_effect.ignore_def_percent) {
        def = Math.floor(def * (1 - skill.extra_effect.ignore_def_percent / 100));
      }
      let dmg = calcDamage(atk, def, multiplier, player.armorPen);

      // Crit
      const critRate = (player.critRate || 5) + Math.floor(getEffectiveSpeed(player) / 50) + (skill.extra_effect?.crit_rate_bonus || 0);
      let isCrit = false;
      if (chance(critRate)) {
        dmg = Math.floor(dmg * (1 + (player.critDamage || 50) / 100));
        isCrit = true;
      }

      // Ignore shield (Vạn Pháp Quy Tông)
      if (skill.extra_effect && skill.extra_effect.ignore_shield) {
        enemy.statuses = enemy.statuses.filter(s => s.type !== 'shield');
      }

      const { actualDamage, reflectDamage } = applyDamageToFighter(enemy, dmg, log);
      const critText = isCrit ? ' 💥 **BẠO KÍCH!**' : '';
      const prefix = skill.type === 'ultimate' ? 'thi triển tuyệt chiêu' : 'thi triển';
      log.push(`${emoji} ${player.name} ${prefix} **${skill.name}** → ${enemy.name}, gây **${actualDamage}** sát thương!${critText}`);

      // Reflect
      if (reflectDamage > 0) {
        player.hp -= reflectDamage;
        log.push(`  🔄 ${player.name} nhận **${reflectDamage}** phản thương!`);
      }

      // Life steal
      if (player.lifeSteal > 0 && actualDamage > 0) {
        const heal = Math.floor(actualDamage * player.lifeSteal / 100);
        if (heal > 0) {
          player.hp = Math.min(player.hp + heal, player.maxHp);
          log.push(`  🩸 Hút **${heal}** HP!`);
        }
      }

      // Extra effects from skill
      if (skill.extra_effect) {
        _applySkillExtraEffects(player, enemy, skill, actualDamage, log);
      }
      break;
    }

    case 'heal': {
      const effect = skill.effect || {};
      const healPercent = effect.heal_percent || 15;
      const healAmt = Math.floor(player.maxHp * healPercent / 100);
      player.hp = Math.min(player.hp + healAmt, player.maxHp);
      log.push(`💚 ${player.name} thi triển **${skill.name}**, hồi **${healAmt}** HP!`);

      // HoT
      if (effect.hot_percent) {
        player.statuses.push({ type: 'hot', healPercent: effect.hot_percent, duration: effect.hot_duration || 3 });
        log.push(`  🌿 Hồi thêm ${effect.hot_percent}% HP mỗi lượt trong ${effect.hot_duration || 3} lượt!`);
      }

      // Cleanse
      if (effect.cleanse) {
        const removed = player.statuses.filter(s =>
          ['burn', 'poison', 'stun', 'seal', 'confuse', 'slow', 'atk_debuff', 'def_break'].includes(s.type)
        );
        player.statuses = player.statuses.filter(s =>
          !['burn', 'poison', 'stun', 'seal', 'confuse', 'slow', 'atk_debuff', 'def_break'].includes(s.type)
        );
        if (removed.length > 0) {
          log.push(`  ✨ Tẩy sạch **${removed.length}** hiệu ứng bất lợi!`);
        }
      }
      break;
    }

    case 'defense': {
      const effect = skill.effect || {};
      if (effect.def_bonus_percent) {
        player.statuses.push({ type: 'def_buff', value: effect.def_bonus_percent / 100, duration: effect.duration || 3 });
        log.push(`${emoji} ${player.name} thi triển **${skill.name}**, tăng **${effect.def_bonus_percent}%** phòng ngự!`);
      }
      if (effect.shield_flat) {
        player.statuses.push({ type: 'shield', value: effect.shield_flat, duration: effect.duration || 2 });
        log.push(`  🛡️ Tạo hộ thuẫn **${effect.shield_flat}** HP!`);
      }
      if (effect.damage_reduction_percent) {
        player.statuses.push({ type: 'damage_reduction', value: effect.damage_reduction_percent / 100, duration: effect.duration || 2 });
        log.push(`  🌊 Giảm **${effect.damage_reduction_percent}%** sát thương nhận vào!`);
      }
      if (effect.reflect_percent) {
        player.statuses.push({ type: 'reflect', value: effect.reflect_percent / 100, duration: effect.duration || 2 });
        log.push(`  🔄 Phản **${effect.reflect_percent}%** sát thương!`);
      }
      break;
    }

    case 'buff': {
      const effect = skill.effect || {};
      log.push(`✨ ${player.name} thi triển **${skill.name}**!`);
      if (effect.atk_bonus_percent) {
        player.statuses.push({ type: 'atk_buff', value: effect.atk_bonus_percent / 100, duration: effect.duration || 3 });
        log.push(`  ⚔️ ATK tăng ${effect.atk_bonus_percent}%!`);
      }
      if (effect.def_reduction_percent) {
        player.statuses.push({ type: 'def_break', value: effect.def_reduction_percent / 100, duration: effect.duration || 3 });
        log.push(`  ⚠️ DEF giảm ${effect.def_reduction_percent}% (đánh đổi)!`);
      }
      if (effect.speed_bonus_percent) {
        player.statuses.push({ type: 'speed_buff', value: effect.speed_bonus_percent / 100, duration: effect.duration || 3 });
        log.push(`  💨 Tốc độ tăng ${effect.speed_bonus_percent}%!`);
      }
      if (effect.all_stats_bonus_percent) {
        const val = effect.all_stats_bonus_percent / 100;
        const dur = effect.duration || 5;
        player.statuses.push({ type: 'atk_buff', value: val, duration: dur });
        player.statuses.push({ type: 'def_buff', value: val, duration: dur });
        player.statuses.push({ type: 'speed_buff', value: val, duration: dur });
        log.push(`  🌟 Toàn bộ chỉ số tăng ${effect.all_stats_bonus_percent}%!`);
      }
      if (effect.def_bonus_percent) {
        player.statuses.push({ type: 'def_buff', value: effect.def_bonus_percent / 100, duration: effect.duration || 3 });
        log.push(`  🛡️ DEF tăng ${effect.def_bonus_percent}%!`);
      }
      break;
    }

    case 'debuff': {
      const effect = skill.effect || {};
      log.push(`🌀 ${player.name} thi triển **${skill.name}** lên ${enemy.name}!`);
      if (effect.seal_skills) {
        enemy.statuses.push({ type: 'seal', duration: effect.duration || 2 });
        log.push(`  🔒 ${enemy.name} bị phong ấn kỹ năng ${effect.duration || 2} lượt!`);
      }
      if (effect.atk_reduction_percent) {
        enemy.statuses.push({ type: 'atk_debuff', value: effect.atk_reduction_percent / 100, duration: effect.duration || 3 });
        log.push(`  ⚔️ ${enemy.name} ATK giảm ${effect.atk_reduction_percent}%!`);
      }
      if (effect.poison_damage_percent) {
        const poisonDmg = Math.floor(getEffectiveAtk(player) * effect.poison_damage_percent / 100);
        enemy.statuses.push({ type: 'poison', damage: poisonDmg, duration: effect.poison_duration || 4 });
        log.push(`  ☠️ ${enemy.name} bị trúng độc! (${poisonDmg} dmg/lượt)`);
      }
      if (effect.confuse_chance) {
        if (chance(effect.confuse_chance)) {
          enemy.statuses.push({ type: 'confuse', chance: effect.confuse_chance, duration: effect.duration || 3 });
          log.push(`  😵 ${enemy.name} bị hoang mang!`);
        } else {
          log.push(`  😵 ${enemy.name} kháng cự hoang mang!`);
        }
      }
      break;
    }

    default:
      // Unknown skill type, do basic attack
      _executeBasicAttack(player, enemy, log);
      break;
  }
}

/**
 * Áp dụng hiệu ứng phụ từ extra_effect
 */
function _applySkillExtraEffects(attacker, defender, skill, damage, log) {
  const fx = skill.extra_effect;
  if (!fx) return;

  if (fx.burn_damage_percent && chance(70)) {
    const burnDmg = Math.floor(getEffectiveAtk(attacker) * fx.burn_damage_percent / 100);
    defender.statuses.push({ type: 'burn', damage: burnDmg, duration: fx.burn_duration || 3 });
    log.push(`  🔥 ${defender.name} bị thiêu đốt! (${burnDmg} dmg/lượt)`);
  }
  // Alternate burn format
  if (fx.burn_percent && chance(70)) {
    const burnDmg = Math.floor(defender.maxHp * fx.burn_percent / 100);
    defender.statuses.push({ type: 'burn', damage: burnDmg, duration: fx.burn_duration || 3 });
    log.push(`  🔥 ${defender.name} bị thiêu đốt!`);
  }
  if (fx.stun_chance && chance(fx.stun_chance)) {
    defender.statuses.push({ type: 'stun', duration: fx.stun_duration || 1 });
    log.push(`  💫 ${defender.name} bị choáng!`);
  }
  if (fx.slow_chance && chance(fx.slow_chance)) {
    defender.statuses.push({ type: 'slow', value: 0.25, duration: fx.slow_duration || 2 });
    log.push(`  🐌 ${defender.name} bị giảm tốc!`);
  }
  if (fx.def_break_percent) {
    defender.statuses.push({ type: 'def_break', value: fx.def_break_percent / 100, duration: fx.duration || 2 });
    log.push(`  🔨 ${defender.name} phòng ngự giảm ${fx.def_break_percent}%!`);
  }
  if (fx.life_steal_percent) {
    const heal = Math.floor(damage * fx.life_steal_percent / 100);
    if (heal > 0) {
      attacker.hp = Math.min(attacker.hp + heal, attacker.maxHp);
      log.push(`  🩸 ${attacker.name} hút **${heal}** HP!`);
    }
  }
}

/**
 * Enemy AI action
 */
function _executeEnemyAction(player, enemy, log) {
  const sealed = isSealed(enemy);

  // Confuse check
  const confuseStatus = enemy.statuses.find(s => s.type === 'confuse');
  if (confuseStatus && chance(confuseStatus.chance || 30)) {
    const selfDmg = Math.floor(getEffectiveAtk(enemy) * 0.5);
    enemy.hp -= selfDmg;
    log.push(`😵 ${enemy.name} bị hoang mang, tự đánh bản thân gây **${selfDmg}** sát thương!`);
    return;
  }

  // Choose skill or basic attack
  let chosen = null;
  if (!sealed) {
    const available = enemy.skills.filter(s => {
      const cd = enemy.cooldowns[s.id] || 0;
      return cd <= 0 && (!s.mana_cost || enemy.mana >= s.mana_cost);
    });

    // HP thấp → ưu tiên heal
    const hpRatio = enemy.hp / enemy.maxHp;
    if (hpRatio < LOW_HP_THRESHOLD) {
      const healSkill = available.find(s => s.type === 'heal');
      if (healSkill) chosen = healSkill;
    }

    // Otherwise: 70% chance to use a skill
    if (!chosen && available.length > 0 && chance(70)) {
      chosen = available[randomInt(0, available.length - 1)];
    }
  }

  if (!chosen) {
    // Basic attack
    _executeBasicAttack(enemy, player, log);
    return;
  }

  // Use skill
  if (chosen.mana_cost) enemy.mana -= chosen.mana_cost;
  if (chosen.cooldown) enemy.cooldowns[chosen.id] = chosen.cooldown;

  const emoji = chosen.emoji || '💥';

  switch (chosen.type) {
    case 'attack':
    case 'ultimate': {
      const atk = getEffectiveAtk(enemy);
      let def = getEffectiveDef(player);
      if (chosen.extra_effect && chosen.extra_effect.ignore_def_percent) {
        def = Math.floor(def * (1 - chosen.extra_effect.ignore_def_percent / 100));
      }
      if (chosen.extra_effect && chosen.extra_effect.ignore_shield) {
        player.statuses = player.statuses.filter(s => s.type !== 'shield');
      }
      const mult = chosen.damage_multiplier || 1.5;
      let dmg = calcDamage(atk, def, mult);

      // Boss crit (10%)
      let isCrit = false;
      if (chance(10)) {
        dmg = Math.floor(dmg * 1.5);
        isCrit = true;
      }

      const { actualDamage, reflectDamage } = applyDamageToFighter(player, dmg, log);
      const critText = isCrit ? ' 💥 **BẠO KÍCH!**' : '';
      log.push(`${emoji} ${enemy.name} thi triển **${chosen.name}** → ${player.name}, gây **${actualDamage}** sát thương!${critText}`);

      // Reflect
      if (reflectDamage > 0) {
        enemy.hp -= reflectDamage;
        log.push(`  🔄 ${enemy.name} nhận **${reflectDamage}** phản thương!`);
      }

      // Extra effects
      if (chosen.extra_effect) {
        _applySkillExtraEffects(enemy, player, chosen, actualDamage, log);
      }
      break;
    }

    case 'heal': {
      const effect = chosen.effect || {};
      const healAmt = Math.floor(enemy.maxHp * (effect.heal_percent || 20) / 100);
      enemy.hp = Math.min(enemy.hp + healAmt, enemy.maxHp);
      log.push(`💚 ${enemy.name} thi triển **${chosen.name}**, hồi **${healAmt}** HP!`);

      if (effect.cleanse) {
        enemy.statuses = enemy.statuses.filter(s =>
          !['burn', 'poison', 'stun', 'seal', 'confuse', 'slow', 'atk_debuff', 'def_break'].includes(s.type)
        );
        log.push(`  ✨ ${enemy.name} tẩy sạch debuff!`);
      }
      break;
    }

    case 'buff': {
      const effect = chosen.effect || {};
      log.push(`✨ ${enemy.name} thi triển **${chosen.name}**!`);
      if (effect.atk_bonus_percent) {
        enemy.statuses.push({ type: 'atk_buff', value: effect.atk_bonus_percent / 100, duration: effect.duration || 3 });
        log.push(`  ⚔️ ATK tăng ${effect.atk_bonus_percent}%!`);
      }
      if (effect.def_bonus_percent) {
        enemy.statuses.push({ type: 'def_buff', value: effect.def_bonus_percent / 100, duration: effect.duration || 3 });
        log.push(`  🛡️ DEF tăng ${effect.def_bonus_percent}%!`);
      }
      break;
    }

    case 'debuff': {
      const effect = chosen.effect || {};
      log.push(`🌀 ${enemy.name} thi triển **${chosen.name}** lên ${player.name}!`);
      if (effect.atk_reduction_percent) {
        player.statuses.push({ type: 'atk_debuff', value: effect.atk_reduction_percent / 100, duration: effect.duration || 3 });
        log.push(`  ⚔️ ${player.name} ATK giảm ${effect.atk_reduction_percent}%!`);
      }
      if (effect.seal_skills || effect.seal_duration) {
        player.statuses.push({ type: 'seal', duration: effect.seal_duration || effect.duration || 2 });
        log.push(`  🔒 ${player.name} bị phong ấn kỹ năng ${effect.seal_duration || effect.duration || 2} lượt!`);
      }
      if (effect.stun_chance && chance(effect.stun_chance)) {
        player.statuses.push({ type: 'stun', duration: 1 });
        log.push(`  💫 ${player.name} bị choáng!`);
      }
      if (effect.all_stats_reduction_percent) {
        const val = effect.all_stats_reduction_percent / 100;
        const dur = effect.duration || 3;
        player.statuses.push({ type: 'atk_debuff', value: val, duration: dur });
        player.statuses.push({ type: 'def_break', value: val, duration: dur });
        player.statuses.push({ type: 'slow', value: val, duration: dur });
        log.push(`  📉 Toàn bộ chỉ số giảm ${effect.all_stats_reduction_percent}%!`);
      }
      if (effect.confuse_chance) {
        if (chance(effect.confuse_chance)) {
          player.statuses.push({ type: 'confuse', chance: effect.confuse_chance, duration: effect.confuse_duration || 2 });
          log.push(`  😵 ${player.name} bị hoang mang!`);
        }
      }
      break;
    }

    default: {
      _executeBasicAttack(enemy, player, log);
      break;
    }
  }
}

/**
 * Áp dụng hiệu ứng đầu lượt (DoT, HoT)
 */
function _applyStartOfTurnEffects(fighter, log) {
  for (const status of fighter.statuses) {
    switch (status.type) {
      case 'burn': {
        const burnDmg = status.damage || 0;
        if (burnDmg > 0) {
          fighter.hp -= burnDmg;
          log.push(`  🔥 ${fighter.name} bị thiêu đốt, mất **${burnDmg}** HP!`);
        }
        break;
      }
      case 'poison': {
        const poisonDmg = status.damage || 0;
        if (poisonDmg > 0) {
          fighter.hp -= poisonDmg;
          log.push(`  ☠️ ${fighter.name} bị trúng độc, mất **${poisonDmg}** HP!`);
        }
        break;
      }
      case 'hot': {
        const healAmt = Math.floor(fighter.maxHp * (status.healPercent || 0) / 100);
        if (healAmt > 0) {
          fighter.hp = Math.min(fighter.hp + healAmt, fighter.maxHp);
          log.push(`  💚 ${fighter.name} hồi phục **${healAmt}** HP!`);
        }
        break;
      }
    }
  }
}

// ═══════════════════════════════════════════
//  UI BUILDERS
// ═══════════════════════════════════════════

/**
 * Tạo thanh HP
 */
function createHpBar(current, max, length = 15) {
  const ratio = Math.max(0, Math.min(1, current / max));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  const color = ratio > 0.5 ? '🟩' : ratio > 0.2 ? '🟨' : '🟥';
  return color.repeat(filled) + '⬛'.repeat(empty);
}

/**
 * Tạo thanh Mana
 */
function createManaBar(current, max, length = 10) {
  const ratio = Math.max(0, Math.min(1, current / max));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return '🟦'.repeat(filled) + '⬛'.repeat(empty);
}

/**
 * Format active statuses
 */
function formatStatuses(fighter) {
  if (fighter.statuses.length === 0) return '';
  const icons = {
    burn: '🔥', poison: '☠️', stun: '💫', hot: '💚', shield: '🛡️',
    def_buff: '🛡️', atk_buff: '⚔️', speed_buff: '💨', seal: '🔒',
    confuse: '😵', slow: '🐌', def_break: '🔨', atk_debuff: '📉',
    damage_reduction: '🌊', reflect: '🔄',
  };
  const parts = [];
  for (const s of fighter.statuses) {
    if (s.duration === 99) continue; // permanent effects hidden
    const icon = icons[s.type] || '❓';
    parts.push(`${icon}${s.duration > 0 ? s.duration : ''}`);
  }
  return parts.length > 0 ? `\n  Trạng thái: ${parts.join(' ')}` : '';
}

/**
 * Tạo embed chiến đấu interactive
 */
function buildInteractiveEmbed(state) {
  const { player, enemy, turn, turnLog } = state;

  const playerHpBar = createHpBar(player.hp, player.maxHp);
  const enemyHpBar = createHpBar(enemy.hp, enemy.maxHp);
  const manaBar = createManaBar(player.mana, player.maxMana);

  const playerStatuses = formatStatuses(player);
  const enemyStatuses = formatStatuses(enemy);

  // Show last 8 log lines
  const recentLog = turnLog.slice(-8).join('\n') || '_Trận chiến bắt đầu... Chọn hành động!_';

  const embed = new EmbedBuilder()
    .setColor(turn === 0 ? '#FFD700' : (player.hp / player.maxHp > 0.5 ? '#2ECC71' : player.hp / player.maxHp > 0.2 ? '#F1C40F' : '#E74C3C'))
    .setTitle(`⚔️ BOSS FIGHT — Lượt ${turn}/${state.maxTurns}`)
    .setDescription(
      `**${player.emoji} ${player.name}** vs **${enemy.emoji} ${enemy.name}**\n\n` +
      `👤 **${player.name}**\n` +
      `❤️ ${playerHpBar} \`${player.hp}/${player.maxHp}\`\n` +
      `💎 ${manaBar} \`${player.mana}/${player.maxMana}\`` +
      `${playerStatuses}\n\n` +
      `${enemy.emoji} **${enemy.name}**\n` +
      `❤️ ${enemyHpBar} \`${enemy.hp}/${enemy.maxHp}\`` +
      `${enemyStatuses}\n\n` +
      `╔══════ 📜 Nhật Ký Chiến Đấu ══════╗\n${recentLog}\n╚══════════════════════════════════╝`
    )
    .setTimestamp();

  // Pet info
  if (player.pet) {
    embed.setFooter({ text: `🐾 ${player.pet.petName} (ATK: ${player.pet.atk}) đang hỗ trợ chiến đấu` });
  }

  return embed;
}

/**
 * Tạo nút hành động
 */
function buildActionButtons(state) {
  const { player } = state;
  const sealed = isSealed(player);
  const stunned = isStunned(player);
  const hasActiveSkills = player.skills.filter(s => s.type !== 'passive').length > 0;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('icombat:basic')
      .setLabel('⚔️ Đánh Thường')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(stunned),
    new ButtonBuilder()
      .setCustomId('icombat:skills')
      .setLabel('🎯 Kỹ Năng')
      .setStyle(ButtonStyle.Success)
      .setDisabled(sealed || stunned || !hasActiveSkills),
    new ButtonBuilder()
      .setCustomId('icombat:potion')
      .setLabel('🧪 Đan Dược')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true), // Future feature
    new ButtonBuilder()
      .setCustomId('icombat:flee')
      .setLabel('🏃 Bỏ Chạy')
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Tạo menu chọn kỹ năng
 */
function buildSkillSelectMenu(state) {
  const { player } = state;
  const activeSkills = player.skills.filter(s => s.type !== 'passive');

  const options = activeSkills.map(s => {
    const cd = player.cooldowns[s.id] || 0;
    const canUse = cd <= 0 && (!s.mana_cost || player.mana >= s.mana_cost);
    const cdText = cd > 0 ? `⏱${cd}T` : '✅';
    const manaText = s.mana_cost ? `${s.mana_cost}MP` : '0MP';
    const multText = s.damage_multiplier ? `x${s.damage_multiplier}` : s.type;

    let label = `${s.name} [${cdText}] (${manaText})`;
    if (label.length > 100) label = label.substring(0, 97) + '...';

    let desc = `${s.type} | ${multText}`;
    if (!canUse) desc = `⛔ Không khả dụng — ${cd > 0 ? 'Đang hồi chiêu' : 'Thiếu MP'}`;
    if (desc.length > 100) desc = desc.substring(0, 97) + '...';

    return {
      label,
      value: String(s.id),
      emoji: s.emoji || '💥',
      description: desc,
    };
  }).slice(0, 25);

  if (options.length === 0) {
    options.push({
      label: 'Không có kỹ năng',
      value: 'none',
      description: 'Hãy trang bị kỹ năng trước khi chiến đấu',
    });
  }

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('icombat:back')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('icombat:skill_select')
      .setPlaceholder('🎯 Chọn kỹ năng thi triển...')
      .addOptions(options)
  );

  return { selectRow, backRow };
}

module.exports = {
  initInteractiveCombat,
  executePlayerTurn,
  buildInteractiveEmbed,
  buildActionButtons,
  buildSkillSelectMenu,
  createHpBar,
  createManaBar,
};
