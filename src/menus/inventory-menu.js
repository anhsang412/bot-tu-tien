const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { COLORS } = require('../utils/constants');
const { formatNumber, progressBar } = require('../utils/helpers');
const { getMenuImage } = require('../utils/image-helper');

// Tên grade tiếng Việt
const GRADE_NAME = {
  pham: 'Phàm',
  linh: 'Linh',
  bao: 'Bảo',
  thanh: 'Thánh',
  tien: 'Tiên',
  than: 'Thần',
};

/**
 * Inventory Menu — Đan Dược, Trang Bị, Nguyên Liệu, Công Pháp
 * Hiển thị tổng quan túi đồ với các nút phân loại
 */
async function showInventoryMenu(interaction, player) {
  const db = require('../database/connection');

  // Đếm vật phẩm theo loại
  const allItems = db.prepare('SELECT * FROM inventory WHERE player_id = ? AND quantity > 0').all(player.id);
  const itemsConfig = require('../../config/items');
  const equipConfig = require('../../config/equipment');

  let pillCount = 0, equipCount = 0, materialCount = 0, skillBookCount = 0;
  for (const item of allItems) {
    let config = itemsConfig.list.find(i => i.id === item.item_id);
    if (config) {
      if (config.type === 'pill') pillCount += item.quantity;
      else if (config.type === 'material') materialCount += item.quantity;
      else if (config.type === 'skill_book') skillBookCount += item.quantity;
    } else {
      const eqConfig = equipConfig.getEquipmentById(item.item_id) || equipConfig.getById(item.item_id);
      if (eqConfig) {
        equipCount += item.quantity;
      }
    }
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.INVENTORY)
    .setTitle('🎒 Túi Đồ')
    .setDescription(
      `**${player.name}** — ${allItems.length} vật phẩm\n\n` +
      `💊 Đan Dược: **${pillCount}** vật phẩm\n` +
      `⚔️ Trang Bị: **${equipCount}** vật phẩm\n` +
      `🌿 Nguyên Liệu: **${materialCount}** vật phẩm\n` +
      `📜 Công Pháp/Sách Kỹ Năng: **${skillBookCount}** vật phẩm`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('inventory:pills')
      .setLabel('💊 Đan Dược')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('inventory:equipment')
      .setLabel('⚔️ Trang Bị')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('inventory:materials')
      .setLabel('🌿 Nguyên Liệu')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('inventory:skillbooks')
      .setLabel('📜 Công Pháp')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('menu:main')
      .setLabel('🔙 Quay Lại')
      .setStyle(ButtonStyle.Secondary),
  );

  const imgData = getMenuImage('inventory');
  const updatePayload = { embeds: [embed], components: [row] };
  if (imgData) {
    embed.setImage(`attachment://${imgData.imageName}`);
    updatePayload.files = [imgData.attachment];
  }
  await interaction.update(updatePayload);
}

/**
 * Hiển thị vật phẩm theo loại, kèm SELECT MENU để chọn vật phẩm
 * và nút hành động tương ứng (Sử Dụng / Trang Bị / Học)
 */
async function showItemsByType(interaction, player, type) {
  const db = require('../database/connection');
  const itemsConfig = require('../../config/items');
  const equipConfig = require('../../config/equipment');

  const allItems = db.prepare('SELECT * FROM inventory WHERE player_id = ? AND quantity > 0').all(player.id);

  const typeNames = {
    pills: { label: '💊 Đan Dược', type: 'pill', action: 'Sử Dụng', actionId: 'inventory:use', selectId: 'select:use_item' },
    equipment: { label: '⚔️ Trang Bị', type: 'equipment', action: 'Trang Bị', actionId: 'inventory:equip', selectId: 'select:equip_item' },
    materials: { label: '🌿 Nguyên Liệu', type: 'material', action: null, actionId: null, selectId: null },
    skillbooks: { label: '📜 Sách Kỹ Năng', type: 'skill_book', action: 'Học', actionId: 'inventory:learn', selectId: 'select:learn_skill' },
  };

  const category = typeNames[type];
  const items = allItems
    .map(item => {
      let config = itemsConfig.list.find(i => i.id === item.item_id);
      if (!config && category.type === 'equipment') {
        const eqConfig = equipConfig.getEquipmentById(item.item_id) || equipConfig.getById(item.item_id);
        if (eqConfig) {
          config = { ...eqConfig, type: 'equipment' };
        }
      }
      return config && config.type === category.type ? { ...config, quantity: item.quantity } : null;
    })
    .filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(COLORS.INVENTORY)
    .setTitle(`🎒 ${category.label}`);

  if (items.length === 0) {
    embed.setDescription('_Không có vật phẩm nào._');
  } else {
    const gradeLabel = (g) => GRADE_NAME[g] || g;
    embed.setDescription(
      items
        .map(item => `${item.emoji || '📦'} **${item.name}** ×${item.quantity} — ${gradeLabel(item.grade)} Phẩm\n  _${item.description || ''}_`)
        .join('\n\n')
    );
  }

  // ═══ Xây dựng components ═══
  const components = [];

  // Select menu để chọn vật phẩm (nếu có vật phẩm và loại hỗ trợ hành động)
  if (items.length > 0 && category.selectId) {
    const selectOptions = items.slice(0, 25).map(item => ({
      label: `${item.name} (×${item.quantity})`,
      description: `${GRADE_NAME[item.grade] || item.grade} Phẩm — ${(item.description || '').slice(0, 50)}`,
      value: item.id,
      emoji: item.emoji || '📦',
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(category.selectId)
      .setPlaceholder(`Chọn vật phẩm để ${category.action}...`)
      .addOptions(selectOptions);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Nút hành động + quay lại
  const buttonRow = new ActionRowBuilder();

  // Nút hành động tương ứng loại vật phẩm
  if (category.actionId && items.length > 0) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId(category.actionId)
        .setLabel(`${category.action === 'Sử Dụng' ? '💊' : category.action === 'Trang Bị' ? '⚔️' : '📖'} ${category.action}`)
        .setStyle(ButtonStyle.Success),
    );
  }

  buttonRow.addComponents(
    new ButtonBuilder()
      .setCustomId('inventory:menu')
      .setLabel('🔙 Quay Lại Túi Đồ')
      .setStyle(ButtonStyle.Secondary),
  );

  components.push(buttonRow);

  await interaction.update({ embeds: [embed], components });
}

/**
 * Sử dụng vật phẩm tiêu hao (đan dược)
 * Áp dụng hiệu ứng: hồi HP, hồi mana, tăng stats tạm thời, cung cấp EXP
 * Giảm số lượng, xóa nếu hết
 */
async function handleUseItem(interaction, player, itemId) {
  const db = require('../database/connection');
  const itemsConfig = require('../../config/items');

  // Lấy thông tin item từ config
  const itemConfig = itemsConfig.getItemById(itemId);
  if (!itemConfig) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Vật phẩm không tồn tại')
      .setDescription('Không tìm thấy vật phẩm này trong hệ thống.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('inventory:menu').setLabel('🔙 Túi Đồ').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Kiểm tra loại — chỉ cho phép dùng pill và consumable
  if (itemConfig.type !== 'pill' && itemConfig.type !== 'consumable') {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Không thể sử dụng')
      .setDescription('Vật phẩm này không phải đan dược hoặc vật phẩm tiêu hao.');
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('inventory:menu').setLabel('🔙 Túi Đồ').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // Kiểm tra có trong kho không
  const invItem = db.prepare('SELECT quantity FROM inventory WHERE player_id = ? AND item_id = ?').get(player.id, itemId);
  if (!invItem || invItem.quantity <= 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ Không có vật phẩm')
      .setDescription(`Bạn không có **${itemConfig.name}** trong túi đồ.`);
    return interaction.update({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('inventory:menu').setLabel('🔙 Túi Đồ').setStyle(ButtonStyle.Secondary)
      )
    ]});
  }

  // ═══ Áp dụng hiệu ứng ═══
  const effect = itemConfig.effect || {};
  const results = [];

  // Hồi HP theo phần trăm
  if (effect.hp_percent) {
    const healAmount = Math.floor((player.max_hp || player.hp) * effect.hp_percent / 100);
    const newHp = Math.min((player.hp || 0) + healAmount, player.max_hp || player.hp + healAmount);
    db.prepare('UPDATE players SET hp = ? WHERE id = ?').run(newHp, player.id);
    results.push(`❤️ Hồi phục **${formatNumber(healAmount)}** HP (${effect.hp_percent}%)`);
  }

  // Hồi Mana theo phần trăm
  if (effect.mana_percent) {
    const manaAmount = Math.floor((player.max_mana || player.mana || 100) * effect.mana_percent / 100);
    const newMana = Math.min((player.mana || 0) + manaAmount, player.max_mana || player.mana + manaAmount);
    db.prepare('UPDATE players SET mana = ? WHERE id = ?').run(newMana, player.id);
    results.push(`🔮 Hồi phục **${formatNumber(manaAmount)}** Mana (${effect.mana_percent}%)`);
  }

  // Cung cấp EXP tu luyện
  if (effect.exp) {
    db.prepare('UPDATE players SET exp = exp + ? WHERE id = ?').run(effect.exp, player.id);
    results.push(`✨ Nhận được **${formatNumber(effect.exp)}** EXP tu luyện`);
  }

  // Tăng stats tạm thời (ghi nhận thời gian hết hạn)
  if (effect.atk_temp) {
    const duration = effect.duration || 1800; // mặc định 30 phút
    const expiresAt = Date.now() + duration * 1000;
    // Lưu buff tạm thời vào bảng buffs (nếu có)
    try {
      db.prepare(
        'INSERT OR REPLACE INTO player_buffs (player_id, buff_type, value, expires_at) VALUES (?, ?, ?, ?)'
      ).run(player.id, 'atk_temp', effect.atk_temp, expiresAt);
    } catch (_) { /* Bảng chưa tồn tại — bỏ qua */ }
    results.push(`⚔️ Tăng **${effect.atk_temp}%** ATK trong ${Math.floor(duration / 60)} phút`);
  }

  if (effect.def_temp) {
    const duration = effect.duration || 1800;
    const expiresAt = Date.now() + duration * 1000;
    try {
      db.prepare(
        'INSERT OR REPLACE INTO player_buffs (player_id, buff_type, value, expires_at) VALUES (?, ?, ?, ?)'
      ).run(player.id, 'def_temp', effect.def_temp, expiresAt);
    } catch (_) { /* Bảng chưa tồn tại — bỏ qua */ }
    results.push(`🛡️ Tăng **${effect.def_temp}%** DEF trong ${Math.floor(duration / 60)} phút`);
  }

  if (effect.all_stats_temp) {
    const duration = effect.duration || 3600;
    const expiresAt = Date.now() + duration * 1000;
    try {
      db.prepare(
        'INSERT OR REPLACE INTO player_buffs (player_id, buff_type, value, expires_at) VALUES (?, ?, ?, ?)'
      ).run(player.id, 'all_stats_temp', effect.all_stats_temp, expiresAt);
    } catch (_) { /* Bảng chưa tồn tại — bỏ qua */ }
    results.push(`💪 Tăng **${effect.all_stats_temp}%** toàn chỉ số trong ${Math.floor(duration / 60)} phút`);
  }

  // Tăng stats vĩnh viễn (Tiên Đan trở lên)
  if (effect.all_stats_permanent) {
    // Tăng % vĩnh viễn — lưu vào bảng bonus
    try {
      db.prepare(
        'UPDATE players SET bonus_all_stats = COALESCE(bonus_all_stats, 0) + ? WHERE id = ?'
      ).run(effect.all_stats_permanent, player.id);
    } catch (_) { /* Cột chưa tồn tại */ }
    results.push(`🌟 Vĩnh viễn tăng **${effect.all_stats_permanent}%** toàn chỉ số!`);
  }

  // Tẩy debuff
  if (effect.cleanse) {
    try {
      db.prepare('DELETE FROM player_buffs WHERE player_id = ? AND value < 0').run(player.id);
    } catch (_) { /* Bảng chưa tồn tại */ }
    results.push(`🌸 Tẩy sạch mọi **debuff** hiện tại`);
  }

  // Bonus đột phá (ghi nhận, dùng khi đột phá)
  if (effect.breakthrough_bonus) {
    results.push(`⚡ Tăng **${effect.breakthrough_bonus}%** tỉ lệ đột phá (áp dụng tự động)`);
  }

  // ═══ Giảm số lượng item ═══
  db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE player_id = ? AND item_id = ?').run(player.id, itemId);
  db.prepare('DELETE FROM inventory WHERE player_id = ? AND item_id = ? AND quantity <= 0').run(player.id, itemId);

  // ═══ Hiển thị kết quả ═══
  const remainingQty = (invItem.quantity - 1) > 0 ? invItem.quantity - 1 : 0;
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${itemConfig.emoji || '💊'} Sử Dụng Thành Công!`)
    .setDescription(
      `Bạn đã sử dụng **${itemConfig.name}**\n\n` +
      `╔══════════════════════════════════╗\n` +
      `║ 📋 **Hiệu Ứng**\n` +
      `╠══════════════════════════════════╣\n` +
      (results.length > 0 ? results.join('\n') : '_Không có hiệu ứng_') +
      `\n╚══════════════════════════════════╝\n\n` +
      `📦 Còn lại: **${remainingQty}** ${itemConfig.name}`
    )
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('inventory:pills').setLabel('💊 Đan Dược').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('inventory:menu').setLabel('🎒 Túi Đồ').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:main').setLabel('🏠 Menu Chính').setStyle(ButtonStyle.Secondary),
    )
  ]});
}

module.exports = {
  showInventoryMenu,
  showItemsByType,
  handleUseItem,
};
