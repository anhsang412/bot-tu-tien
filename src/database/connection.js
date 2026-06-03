const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/game.db');
const absolutePath = path.resolve(dbPath);

// Tạo thư mục data nếu chưa tồn tại
const dir = path.dirname(absolutePath);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(absolutePath);

// Bật WAL mode để tăng hiệu suất
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tối ưu hiệu suất
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache

module.exports = db;
