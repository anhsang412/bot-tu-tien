const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

const IMAGE_DIR = path.join(__dirname, '../../data/images');

/**
 * Lấy attachment cho menu embed
 * @param {string} menuName - Tên menu (cultivation, combat, profile, etc.)
 * @returns {{ attachment: AttachmentBuilder, imageName: string } | null}
 */
function getMenuImage(menuName) {
  const fileName = `${menuName}.png`;
  const filePath = path.join(IMAGE_DIR, fileName);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  return {
    attachment: new AttachmentBuilder(filePath),
    imageName: fileName,
  };
}

module.exports = { getMenuImage };
