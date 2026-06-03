/**
 * @file Quest System
 * @description Hệ thống nhiệm vụ — nhận nhiệm vụ, cập nhật tiến trình, nộp nhiệm vụ, nhận thưởng
 */

const db = require('../database/connection');
const npcsConfig = require('../../config/npcs');
const itemsConfig = require('../../config/items');
const { COLORS } = require('../utils/constants');
const { formatNumber } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Prepared SQL Statements
const stmtGetActiveQuest = db.prepare('SELECT * FROM player_quests WHERE player_id = ? AND quest_id = ?');
const stmtGetPlayerActiveQuests = db.prepare("SELECT * FROM player_quests WHERE player_id = ? AND status = 'active'");
const stmtGetPlayerCompletedQuests = db.prepare("SELECT * FROM player_quests WHERE player_id = ? AND status = 'completed'");
const stmtInsertQuest = db.prepare('INSERT INTO player_quests (player_id, quest_id, status, progress) VALUES (?, ?, ?, ?)');
const stmtUpdateQuestProgress = db.prepare('UPDATE player_quests SET progress = progress + ? WHERE player_id = ? AND quest_id = ?');
const stmtCompleteQuestInDb = db.prepare("UPDATE player_quests SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE player_id = ? AND quest_id = ?");
const stmtDeleteQuest = db.prepare('DELETE FROM player_quests WHERE player_id = ? AND quest_id = ?');
const stmtGetInventoryItem = db.prepare('SELECT quantity FROM inventory WHERE player_id = ? AND item_id = ?');
const stmtReduceInventoryItem = db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE player_id = ? AND item_id = ?');
const stmtDeleteInventoryItem = db.prepare('DELETE FROM inventory WHERE player_id = ? AND item_id = ? AND quantity <= 0');
const stmtAddInventoryItem = db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)');
const stmtUpdateInventoryItem = db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE player_id = ? AND item_id = ?');

const stmtAddExp = db.prepare('UPDATE players SET exp = exp + ? WHERE id = ?');
const stmtAddLinhThach = db.prepare('UPDATE players SET linh_thach = linh_thach + ? WHERE id = ?');
const stmtAddAffinity = db.prepare(`
  INSERT OR REPLACE INTO npc_affinity (player_id, npc_id, affinity) 
  VALUES (?, ?, COALESCE((SELECT affinity FROM npc_affinity WHERE player_id = ? AND npc_id = ?), 0) + ?)
`);

/**
 * Nhận nhiệm vụ
 */
async function handleAcceptQuest(interaction, player, questId) {
  const questData = npcsConfig.getQuestById(questId);
  if (!questData) return interaction.reply({ content: 'Nhiệm vụ không tồn tại.', ephemeral: true });

  const { quest, npc_id } = questData;

  // Kiểm tra xem đã nhận chưa
  const existing = stmtGetActiveQuest.get(player.id, questId);
  if (existing) {
    if (existing.status === 'active') {
      return interaction.reply({ content: 'Đạo hữu đã nhận nhiệm vụ này rồi.', ephemeral: true });
    } else {
      // Đã hoàn thành, nếu không lặp lại được thì báo lỗi
      if (!quest.repeatable) {
        return interaction.reply({ content: 'Nhiệm vụ này chỉ có thể hoàn thành một lần.', ephemeral: true });
      }
      // Nếu lặp lại được, kiểm tra giới hạn hằng ngày (nếu có)
      if (quest.daily_limit && existing.completed_at) {
        const compDate = new Date(existing.completed_at);
        const today = new Date();
        if (compDate.toDateString() === today.toDateString()) {
          return interaction.reply({ content: 'Nhiệm vụ này đã đạt giới hạn hoàn thành trong ngày hôm nay.', ephemeral: true });
        }
      }
    }
  }

  // Check limits on active quests (tối đa 5 nhiệm vụ cùng lúc)
  const activeQuests = stmtGetPlayerActiveQuests.all(player.id);
  if (activeQuests.length >= 5) {
    return interaction.reply({ content: 'Đạo hữu chỉ có thể nhận tối đa 5 nhiệm vụ cùng lúc.', ephemeral: true });
  }

  // Nhận nhiệm vụ
  if (existing) {
    // Reset status của nhiệm vụ có thể lặp lại
    db.prepare("UPDATE player_quests SET status = 'active', progress = 0, completed_at = NULL WHERE player_id = ? AND quest_id = ?").run(player.id, questId);
  } else {
    stmtInsertQuest.run(player.id, questId, 'active', 0);
  }

  const npc = npcsConfig.getNpcById(npc_id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('📜 Nhận Nhiệm Vụ Thành Công!')
    .setDescription(
      `Đạo hữu nhận nhiệm vụ từ **${npc ? npc.name : 'NPC'}**:\n\n` +
      `📌 **${quest.name}**\n` +
      `📝 _${quest.description}_\n\n` +
      `⚠️ **Yêu Cầu**: ${getQuestRequirementText(quest)}`
    )
    .setTimestamp();

  // Show button back to NPC
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`npc:talk:${npc_id}`).setLabel(`🔙 Trở lại NPC`).setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Nộp và hoàn thành nhiệm vụ
 */
async function handleCompleteQuest(interaction, player, questId) {
  const questData = npcsConfig.getQuestById(questId);
  if (!questData) return interaction.reply({ content: 'Nhiệm vụ không tồn tại.', ephemeral: true });

  const { quest, npc_id } = questData;
  const active = stmtGetActiveQuest.get(player.id, questId);

  if (!active || active.status !== 'active') {
    return interaction.reply({ content: 'Bạn không có nhiệm vụ này trong danh sách đang làm.', ephemeral: true });
  }

  // Kiểm tra yêu cầu
  const isFulfilled = checkQuestRequirements(player.id, player, quest, active.progress);
  if (!isFulfilled) {
    return interaction.reply({ content: 'Đạo hữu chưa hoàn thành đủ yêu cầu của nhiệm vụ.', ephemeral: true });
  }

  // Hoàn thành nhiệm vụ (Deduct items if collect type)
  const completeTx = db.transaction(() => {
    if (quest.type === 'collect' && quest.requirements.collect) {
      const { item_id, count } = quest.requirements.collect;
      stmtReduceInventoryItem.run(count, player.id, item_id);
      stmtDeleteInventoryItem.run(player.id, item_id);
    }

    // Đánh dấu hoàn thành
    stmtCompleteQuestInDb.run(player.id, questId);

    // Phát thưởng
    if (quest.rewards.exp) {
      stmtAddExp.run(quest.rewards.exp, player.id);
    }
    if (quest.rewards.spirit_stones) {
      stmtAddLinhThach.run(quest.rewards.spirit_stones, player.id);
    }
    // Tăng Hảo cảm (mặc định +5 khi xong quest)
    stmtAddAffinity.run(player.id, npc_id, player.id, npc_id, 5);

    // Phát thưởng vật phẩm
    if (quest.rewards.items) {
      for (const gift of quest.rewards.items) {
        const existing = stmtGetInventoryItem.get(player.id, gift.id);
        if (existing) {
          stmtUpdateInventoryItem.run(gift.count, player.id, gift.id);
        } else {
          stmtAddInventoryItem.run(player.id, gift.id, gift.count);
        }
      }
    }
  });

  try {
    completeTx();
  } catch (err) {
    return interaction.reply({ content: `Lỗi nộp nhiệm vụ: ${err.message}`, ephemeral: true });
  }

  const npc = npcsConfig.getNpcById(npc_id);
  const rewardItemsText = quest.rewards.items
    ? quest.rewards.items.map(it => {
        const itemCfg = itemsConfig.getItemById(it.id) || require('../../config/equipment').getEquipmentById(it.id) || require('../../config/equipment').getById(it.id);
        return `🎁 ${itemCfg ? itemCfg.name : it.id} ×${it.count}`;
      }).join('\n')
    : '';

  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('🎉 HOÀN THÀNH NHIỆM VỤ! 🎉')
    .setDescription(
      `Đạo hữu đã hoàn thành **${quest.name}**!\n\n` +
      `🧙 **${npc ? npc.name : 'NPC'}**: _"${npc?.dialogue?.quest_complete ? npc.dialogue.quest_complete[Math.floor(Math.random() * npc.dialogue.quest_complete.length)] : 'Rất tốt!'}"_\n\n` +
      `🎁 **Phần Thưởng Đã Nhận:**\n` +
      `✨ EXP: **+${formatNumber(quest.rewards.exp || 0)}**\n` +
      `💎 Linh Thạch: **+${formatNumber(quest.rewards.spirit_stones || 0)}**\n` +
      `❤️ Hảo Cảm với ${npc?.name || 'NPC'}: **+5**\n` +
      (rewardItemsText ? `${rewardItemsText}\n` : '')
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`npc:talk:${npc_id}`).setLabel(`Trở lại NPC`).setStyle(ButtonStyle.Primary)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Kiểm tra yêu cầu nhiệm vụ có đạt không
 */
function checkQuestRequirements(playerId, player, quest, progress) {
  if (quest.type === 'hunt' && quest.requirements.kill) {
    return progress >= quest.requirements.kill.count;
  }
  if (quest.type === 'collect' && quest.requirements.collect) {
    const { item_id, count } = quest.requirements.collect;
    const invItem = stmtGetInventoryItem.get(playerId, item_id);
    return invItem && invItem.quantity >= count;
  }
  if (quest.type === 'cultivation' && quest.requirements) {
    const reqRealm = quest.requirements.realm || 0;
    const reqSubRealm = quest.requirements.sub_realm || 0;
    if (player.realm_index > reqRealm) return true;
    if (player.realm_index === reqRealm) {
      return player.sub_realm >= reqSubRealm;
    }
    return false;
  }
  return false;
}

/**
 * Sinh chuỗi text hiển thị yêu cầu nhiệm vụ
 */
function getQuestRequirementText(quest) {
  if (quest.type === 'hunt' && quest.requirements.kill) {
    const target = quest.requirements.kill.target;
    // Look up monster name
    const monsterConfig = require('../../config/monsters').list.find(m => m.id === target);
    const name = monsterConfig ? monsterConfig.name : target;
    return `Đánh bại **${quest.requirements.kill.count}** con **${name}**`;
  }
  if (quest.type === 'collect' && quest.requirements.collect) {
    const item_id = quest.requirements.collect.item_id;
    const itemConfig = itemsConfig.getItemById(item_id) || require('../../config/equipment').getEquipmentById(item_id) || require('../../config/equipment').getById(item_id);
    const name = itemConfig ? itemConfig.name : item_id;
    return `Thu thập **${quest.requirements.collect.count}** cái **${name}**`;
  }
  if (quest.type === 'cultivation' && quest.requirements) {
    const realms = require('../../config/realms');
    const realmCfg = realms.list[quest.requirements.realm];
    const realmName = realmCfg ? realmCfg.name : `Cảnh Giới ${quest.requirements.realm}`;
    return `Đạt đến **${realmName}** — Tầng **${quest.requirements.sub_realm}**`;
  }
  return 'Không rõ yêu cầu';
}

/**
 * Cập nhật tiến trình nhiệm vụ (Ví dụ khi đi săn đánh bại quái)
 */
function updateQuestProgress(playerId, type, target, amount) {
  // Tìm tất cả nhiệm vụ đang làm của player
  const activeQuests = stmtGetPlayerActiveQuests.all(playerId);
  for (const act of activeQuests) {
    const questData = npcsConfig.getQuestById(act.quest_id);
    if (!questData) continue;
    const { quest } = questData;

    if (quest.type === type) {
      if (type === 'hunt' && quest.requirements.kill && quest.requirements.kill.target === target) {
        if (act.progress < quest.requirements.kill.count) {
          stmtUpdateQuestProgress.run(amount, playerId, act.quest_id);
        }
      }
    }
  }
}

module.exports = {
  handleAcceptQuest,
  handleCompleteQuest,
  updateQuestProgress,
  checkQuestRequirements,
  getQuestRequirementText,
  showPlayerQuests,
};

// ═══════════════════════════════════════════
//  showPlayerQuests — Hiển thị nhiệm vụ đang làm
// ═══════════════════════════════════════════

/**
 * Hiển thị danh sách nhiệm vụ đang hoạt động của người chơi
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} player - Dữ liệu người chơi từ DB
 */
async function showPlayerQuests(interaction, player) {
  const activeQuests = stmtGetPlayerActiveQuests.all(player.id);

  if (activeQuests.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('📜 Nhiệm Vụ')
      .setDescription(
        `**${player.name}** chưa nhận nhiệm vụ nào.\n\n` +
        `_Hãy đến gặp NPC trong Thế Giới để nhận nhiệm vụ!_`
      )
      .setTimestamp();
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('world:npc').setLabel('👤 Gặp NPC').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('sect:menu').setLabel('🏯 Tông Môn').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  let questLines = '';
  for (const aq of activeQuests) {
    const questData = npcsConfig.getQuestById(aq.quest_id);
    if (!questData) {
      questLines += `❓ **Nhiệm vụ không xác định** (${aq.quest_id})\n\n`;
      continue;
    }

    const { quest, npc_id } = questData;
    const npc = npcsConfig.getNpcById(npc_id);
    const npcName = npc ? npc.name : 'NPC';
    const reqText = getQuestRequirementText(quest);

    // Tiến trình
    let progressText = '';
    if (quest.type === 'hunt' && quest.requirements.kill) {
      const current = Math.min(aq.progress, quest.requirements.kill.count);
      progressText = `📊 Tiến trình: **${current}**/${quest.requirements.kill.count}`;
    } else if (quest.type === 'collect' && quest.requirements.collect) {
      const invItem = stmtGetInventoryItem.get(player.id, quest.requirements.collect.item_id);
      const current = invItem ? Math.min(invItem.quantity, quest.requirements.collect.count) : 0;
      progressText = `📊 Tiến trình: **${current}**/${quest.requirements.collect.count}`;
    } else if (quest.type === 'cultivation') {
      progressText = `📊 Tiến trình: Kiểm tra khi nộp`;
    }

    questLines += `📌 **${quest.name}**\n` +
      `🧙 NPC: ${npcName}\n` +
      `📝 _${quest.description}_\n` +
      `⚠️ Yêu Cầu: ${reqText}\n` +
      `${progressText}\n\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📜 Nhiệm Vụ Đang Làm')
    .setDescription(
      `**${player.name}** — **${activeQuests.length}**/5 nhiệm vụ\n\n` +
      questLines.trim()
    )
    .setFooter({ text: 'Gặp NPC tương ứng để nộp nhiệm vụ đã hoàn thành' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('world:npc').setLabel('👤 Gặp NPC').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('sect:menu').setLabel('🏯 Tông Môn').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}
