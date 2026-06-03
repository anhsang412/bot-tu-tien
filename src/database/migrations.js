const db = require('./connection');
const logger = require('../utils/logger');

// Danh sách migration theo thứ tự
const migrations = [
    {
        version: 1,
        name: 'initial_schema',
        up: () => {
            // Schema ban đầu đã được tạo trong schema.js
            // Migration này chỉ đánh dấu version
        }
    },
    // Thêm migration mới ở đây:
    {
        version: 2,
        name: 'add_trade_message_tracking',
        up: () => {
            try {
                db.exec(`ALTER TABLE player_trades ADD COLUMN channel_id TEXT;`);
            } catch (err) {
                if (!err.message.includes('duplicate column name')) throw err;
            }
            try {
                db.exec(`ALTER TABLE player_trades ADD COLUMN message_id TEXT;`);
            } catch (err) {
                if (!err.message.includes('duplicate column name')) throw err;
            }
        }
    },
    // Migration v3: World Boss Raid tables
    {
        version: 3,
        name: 'add_world_boss_tables',
        up: () => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS world_boss_raids (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    boss_id TEXT NOT NULL,
                    boss_name TEXT NOT NULL,
                    max_hp INTEGER NOT NULL,
                    current_hp INTEGER NOT NULL,
                    channel_id TEXT,
                    status TEXT DEFAULT 'active',
                    spawned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    ended_at DATETIME
                );

                CREATE TABLE IF NOT EXISTS world_boss_contributions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    raid_id INTEGER NOT NULL,
                    player_id INTEGER NOT NULL,
                    damage_dealt INTEGER DEFAULT 0,
                    contribution_percent INTEGER DEFAULT 0,
                    exp_reward INTEGER DEFAULT 0,
                    gold_reward INTEGER DEFAULT 0,
                    FOREIGN KEY (raid_id) REFERENCES world_boss_raids(id),
                    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_wb_contributions_raid ON world_boss_contributions(raid_id);
                CREATE INDEX IF NOT EXISTS idx_wb_contributions_player ON world_boss_contributions(player_id);
            `);
        }
    },
];

function runMigrations() {
    // Tạo bảng theo dõi migration
    db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const getCurrentVersion = db.prepare('SELECT MAX(version) as version FROM migrations');
    const insertMigration = db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)');

    const current = getCurrentVersion.get();
    const currentVersion = current?.version || 0;

    const pending = migrations.filter(m => m.version > currentVersion);

    if (pending.length === 0) {
        logger.info('Database đã cập nhật, không có migration mới.');
        return;
    }

    // Chạy migration trong transaction
    const runAll = db.transaction(() => {
        for (const migration of pending) {
            logger.info(`Đang chạy migration v${migration.version}: ${migration.name}`);
            try {
                migration.up();
                insertMigration.run(migration.version, migration.name);
                logger.info(`✓ Migration v${migration.version} thành công`);
            } catch (err) {
                logger.error(`✗ Migration v${migration.version} thất bại: ${err.message}`);
                throw err; // Rollback toàn bộ transaction
            }
        }
    });

    runAll();
    logger.info(`Đã chạy ${pending.length} migration thành công.`);
}

module.exports = { runMigrations };
