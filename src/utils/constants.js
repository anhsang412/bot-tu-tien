// ═══════════════════════════════════════════
// Màu sắc cho Embed
// ═══════════════════════════════════════════
const COLORS = {
    SUCCESS: 0x2ecc71,    // Xanh lá
    ERROR: 0xe74c3c,      // Đỏ
    INFO: 0x3498db,       // Xanh dương
    WARNING: 0xf39c12,    // Cam
    CULTIVATION: 0x9b59b6, // Tím
    COMBAT: 0xe74c3c,     // Đỏ
    PROFILE: 0x1abc9c,    // Cyan
    INVENTORY: 0xe67e22,  // Cam đậm
    SECT: 0xf1c40f,       // Vàng
    WORLD: 0x2ecc71,      // Xanh lá
    TRADE: 0xe67e22,      // Cam
    LEADERBOARD: 0xf1c40f, // Vàng
    PET: 0x9b59b6,        // Tím
    CREATION: 0x3498db,   // Xanh dương
    GOLD: 0xffd700,       // Vàng kim
    DIVINE: 0xff6b6b,     // Hồng thiên
    DEFAULT: 0x99aab5,    // Xám
};

// ═══════════════════════════════════════════
// Emoji thường dùng
// ═══════════════════════════════════════════
const EMOJIS = {
    // Chỉ số
    HP: '❤️',
    MANA: '🔮',
    ATK: '⚔️',
    DEF: '🛡️',
    SPEED: '💨',
    EXP: '✨',

    // Tiền tệ
    LINH_THACH: '💎',
    TIEN_THACH: '🌟',
    CONG_DUC: '☯️',

    // Tu luyện
    CULTIVATION: '🧘',
    REALM: '🏔️',
    SPIRITUAL_ROOT: '🌿',
    CONSTITUTION: '💪',
    DAO: '☯️',
    TECHNIQUE: '📜',
    BREAKTHROUGH: '⚡',

    // Chiến đấu
    SWORD: '🗡️',
    SHIELD: '🛡️',
    SKILL: '💫',
    CRITICAL: '💥',
    MISS: '💨',
    VICTORY: '🏆',
    DEFEAT: '💀',
    MONSTER: '👹',

    // Vật phẩm
    ITEM: '📦',
    POTION: '🧪',
    WEAPON: '⚔️',
    ARMOR: '🛡️',
    ACCESSORY: '💍',
    ARTIFACT: '🏺',
    SCROLL: '📜',

    // Menu & UI
    BACK: '◀️',
    NEXT: '▶️',
    HOME: '🏠',
    SETTINGS: '⚙️',
    STAR: '⭐',
    FIRE: '🔥',
    LOCK: '🔒',
    UNLOCK: '🔓',
    CHECK: '✅',
    CROSS: '❌',
    WARNING: '⚠️',
    INFO: 'ℹ️',
    LOADING: '⏳',
    RANK: '👑',

    // Thế giới
    MINE: '⛏️',
    SHOP: '🏪',
    SECT: '🏯',
    PET: '🐉',
    NPC: '👤',
    WORLD: '🌍',
    DUNGEON: '🏰',

    // Đạo
    CHINH_DAO: '☀️',
    MA_DAO: '🌙',

    // Cấp bậc / Phẩm chất
    GRADE_COMMON: '⚪',
    GRADE_UNCOMMON: '🟢',
    GRADE_RARE: '🔵',
    GRADE_EPIC: '🟣',
    GRADE_LEGENDARY: '🟡',
    GRADE_MYTHIC: '🔴',
    GRADE_DIVINE: '✨',
};

// ═══════════════════════════════════════════
// Cooldown (mili giây)
// ═══════════════════════════════════════════
const COOLDOWNS = {
    CULTIVATE: 30 * 60 * 1000,      // 30 phút
    MINE: 60 * 60 * 1000,           // 60 phút
    HUNT: 15 * 60 * 1000,           // 15 phút
    DAILY: 24 * 60 * 60 * 1000,     // 24 giờ
    TRADE: 5 * 60 * 1000,           // 5 phút
    PVP: 10 * 60 * 1000,            // 10 phút
    DUNGEON: 2 * 60 * 60 * 1000,    // 2 giờ
    BREAKTHROUGH: 60 * 60 * 1000,   // 1 giờ
    SECT_DONATE: 6 * 60 * 60 * 1000, // 6 giờ
    PET_TRAIN: 30 * 60 * 1000,      // 30 phút
    REST: 5 * 60 * 1000,             // 5 phút
    TRIBULATION_RETRY: 60 * 60 * 1000, // 1 giờ
};

// ═══════════════════════════════════════════
// Phẩm chất (Grade)
// ═══════════════════════════════════════════
const GRADES = {
    COMMON:    { name: 'Phàm Phẩm',   color: 0x99aab5, emoji: '⚪', tier: 0 },
    UNCOMMON:  { name: 'Linh Phẩm',   color: 0x2ecc71, emoji: '🟢', tier: 1 },
    RARE:      { name: 'Huyền Phẩm',  color: 0x3498db, emoji: '🔵', tier: 2 },
    EPIC:      { name: 'Địa Phẩm',    color: 0x9b59b6, emoji: '🟣', tier: 3 },
    LEGENDARY: { name: 'Thiên Phẩm',  color: 0xf1c40f, emoji: '🟡', tier: 4 },
    MYTHIC:    { name: 'Thánh Phẩm',  color: 0xe74c3c, emoji: '🔴', tier: 5 },
    DIVINE:    { name: 'Thần Phẩm',   color: 0xff6b6b, emoji: '✨', tier: 6 },
};

// ═══════════════════════════════════════════
// Giới hạn
// ═══════════════════════════════════════════
const MAX_INVENTORY = 100;
const MAX_SKILL_SLOTS = 6;
const MAX_PET_SLOTS = 5;
const MAX_SECT_NAME_LENGTH = 20;
const INTERACTION_TIMEOUT = 300_000; // 5 phút

// ═══════════════════════════════════════════
// Lowercase aliases for cross-module compat
// ═══════════════════════════════════════════
COLORS.success = COLORS.SUCCESS;
COLORS.error = COLORS.ERROR;
COLORS.info = COLORS.INFO;
COLORS.warning = COLORS.WARNING;
COLORS.cultivation = COLORS.CULTIVATION;
COLORS.combat = COLORS.COMBAT;
COLORS.profile = COLORS.PROFILE;
COLORS.inventory = COLORS.INVENTORY;
COLORS.sect = COLORS.SECT;
COLORS.world = COLORS.WORLD;
COLORS.trade = COLORS.TRADE;
COLORS.leaderboard = COLORS.LEADERBOARD;
COLORS.pet = COLORS.PET;
COLORS.creation = COLORS.CREATION;
COLORS.gold = COLORS.GOLD;

COOLDOWNS.cultivate = COOLDOWNS.CULTIVATE;
COOLDOWNS.mine = COOLDOWNS.MINE;
COOLDOWNS.hunt = COOLDOWNS.HUNT;
COOLDOWNS.daily = COOLDOWNS.DAILY;
COOLDOWNS.trade = COOLDOWNS.TRADE;
COOLDOWNS.pvp = COOLDOWNS.PVP;
COOLDOWNS.rest = COOLDOWNS.REST;
COOLDOWNS.tribulation_retry = COOLDOWNS.TRIBULATION_RETRY;

module.exports = {
    COLORS,
    EMOJIS,
    COOLDOWNS,
    GRADES,
    MAX_INVENTORY,
    MAX_SKILL_SLOTS,
    MAX_PET_SLOTS,
    MAX_SECT_NAME_LENGTH,
    INTERACTION_TIMEOUT,
};
