/**
 * @file Monster Image Mapping
 * @description Maps monster IDs to their image filenames in assets/monsters/
 */

const path = require('path');
const fs = require('fs');

const MONSTERS_DIR = path.join(__dirname, '..', 'assets', 'monsters');

const monsterImageMap = {
  // Bosses
  thuong_co_tao_thien_khuynh: 'thao_thiet.png',
  thuong_co_tien_long: 'tien_long.png',
  thuong_co_phuong_hoang: 'phuong_hoang.png',
  thien_ma: 'thien_ma.png',
  // Normal monsters with images
  linh_tho: 'linh_tho.png',
  hoa_mieu: 'hoa_mieu.png',
  thanh_lang: 'thanh_lang.png',
  doc_xa: 'doc_xa.png',
  bang_ho: 'bang_ho.png',
  hoa_mang: 'hoa_mang.png',
  huyet_quy: 'huyet_quy.png',
  loi_long: 'loi_long.png',
  cuu_vi_ho: 'cuu_vi_ho.png',
  ma_ton: 'ma_ton.png',
};


/**
 * Lấy đường dẫn ảnh quái vật
 * @param {string} monsterId - ID quái vật
 * @returns {string|null} Đường dẫn tuyệt đối hoặc null
 */
function getMonsterImagePath(monsterId) {
  const filename = monsterImageMap[monsterId];
  if (!filename) return null;
  const fullPath = path.join(MONSTERS_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

module.exports = { monsterImageMap, getMonsterImagePath, MONSTERS_DIR };
