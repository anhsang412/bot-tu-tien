const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: 'clientReady',
    once: true,
    execute(client) {
        logger.success(`✦ Bot đã đăng nhập: ${client.user.tag}`);
        logger.info(`✦ Đang phục vụ ${client.guilds.cache.size} server(s)`);
        logger.info(`✦ Tổng ${client.users.cache.size} user(s) trong cache`);

        // Đặt trạng thái hoạt động
        client.user.setPresence({
            activities: [{
                name: '/tutien | Tu Tiên Giới',
                type: ActivityType.Playing,
            }],
            status: 'online',
        });

        // Khởi chạy scheduler nền (cần client để gửi DM và edit message)
        try {
            const { startScheduler } = require('../systems/scheduler');
            startScheduler(client);
            logger.success('✦ Scheduler nền đã khởi chạy');
        } catch (err) {
            logger.error('✗ Lỗi khởi chạy scheduler:', err.message);
        }

        logger.success('══════════════════════════════════');
        logger.success('  Tu Tiên Bot sẵn sàng hoạt động!');
        logger.success('══════════════════════════════════');
    },
};
