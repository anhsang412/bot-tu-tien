# 🌸 Bot Discord Tu Tiên RPG — Xianxia Cultivation Game

Chào mừng đạo hữu đến với **Tu Tiên RPG**, một tựa game nhập vai tu tiên (Xianxia) tương tác trực tiếp trên nền tảng Discord. Hệ thống bao gồm đầy đủ các tính năng đột phá cảnh giới, chiến đấu PvE/PvP, nuôi linh thú, tông môn, bái kiến NPC và giao dịch/đấu giá vật phẩm.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/ceh51453-alt/bot-tu-tien)

---

## 🚀 Hướng Dẫn Triển Khai Nhanh (1-Click Deploy)

Đạo hữu hoặc bất kỳ ai muốn chạy một bản sao (clone) của bot này cho server của riêng mình chỉ cần làm theo các bước sau:

### Bước 1: Chuẩn bị trên Discord Developer Portal
1. Truy cập [Discord Developer Portal](https://discord.com/developers/applications) và tạo một ứng dụng mới (**New Application**).
2. Tại mục **Bot**:
   - Bấm **Reset Token** để lấy `DISCORD_TOKEN`.
   - Bật cả 3 quyền **Privileged Gateway Intents** (`Presence Intent`, `Server Members Intent`, `Message Content Intent`).
3. Tại mục **General Information**:
   - Sao chép **Application ID** (đây là `CLIENT_ID`).
4. Mời Bot vào Server của bạn:
   - Chọn mục **OAuth2** -> **URL Generator**.
   - Tích chọn scope: `bot` và `applications.commands`.
   - Tích chọn bot permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`, `View Channels`.
   - Sao chép liên kết được tạo ra ở cuối trang, dán vào trình duyệt để mời Bot vào server của bạn.

### Bước 2: Deploy lên Railway
1. Bấm vào nút **Deploy on Railway** ở đầu trang này.
2. Railway sẽ tự động tạo bản sao dự án này vào tài khoản GitHub của bạn và yêu cầu nhập các biến môi trường sau:
   - `DISCORD_TOKEN`: Token của Bot Discord (Bước 1).
   - `CLIENT_ID`: ID của ứng dụng Bot Discord (Bước 1).
   - `DATABASE_PATH`: Điền mặc định `./data/game.db`.
   - `GUILD_ID`: *(Tùy chọn)* ID Server Discord của bạn để đăng ký lệnh Slash Command tức thì khi thử nghiệm.
3. Bấm **Deploy**. Railway sẽ tự động cấu hình và chạy bot trực tuyến 24/7.

### Bước 3: Đăng ký Slash Command với Discord
Sau khi Bot đã chạy trên Railway, bạn cần kích hoạt lệnh `/tutien` xuất hiện trong thanh chat.

- **Chạy cục bộ (Local):**
  1. Tải code về máy tính cá nhân.
  2. Tạo file `.env` chứa `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` của bạn.
  3. Mở Terminal tại thư mục dự án và chạy:
     ```bash
     npm run deploy
     ```
  4. Lệnh `/tutien` sẽ lập tức xuất hiện trong server của bạn.

---

## 🛠️ Các Biến Môi Trường (Environment Variables)

| Tên Biến | Mô Tả | Ví Dụ |
|----------|-------|-------|
| `DISCORD_TOKEN` | Token bí mật của Bot Discord | `MTIzNDU2...` |
| `CLIENT_ID` | Application ID của Bot | `123456789...` |
| `GUILD_ID` | ID Server Discord của bạn (để test) | `987654321...` |
| `DATABASE_PATH` | Đường dẫn lưu tệp SQLite | `./data/game.db` |

---

## 📖 Tính Năng Nổi Bật

- **Tu Luyện & Đột Phá:** Cày cuốc tăng EXP, vượt Thiên Kiếp (Lôi Kiếp) để thăng đại cảnh giới (Luyện Khí -> Trúc Cơ -> Kim Đan...).
- **Chiến Đấu:** Săn Yêu Thú (PvE) nhặt vật phẩm rớt ngẫu nhiên hoặc PK tỷ thí (PvP) cướp EXP của tu sĩ Ma Đạo.
- **Linh Thú (Pet):** Bắt thú, cho ăn tăng cấp, tiến hóa tăng chỉ số hỗ trợ chiến đấu.
- **Tông Môn (Sect):** Lập bang hội, quyên góp Linh Thạch nâng cấp tông môn, bảng xếp hạng các tông môn mạnh nhất.
- **Thế Giới & Nhiệm Vụ:** Đối thoại với NPC, tặng quà tăng hảo cảm, nhận nhiệm vụ hàng ngày, khai thác mỏ Linh Thạch (tăng sản lượng nếu sở hữu Cuốc Khai Khoáng).
- **Kinh Tế & Xã Hội:** 
  - Tiệm Bách Bảo (NPC Shop) mua đan dược và bán lại phế liệu lấy 50% Linh Thạch.
  - Sàn Đấu Giá (Tụ Bảo Các) đăng bán vật phẩm tùy chọn mức giá bằng Linh Thạch.
  - Giao dịch trực tiếp (Direct Trade) an toàn tuyệt đối.
- **Tự động hóa:** Tự động hoàn trả đồ đấu giá quá 24h, tự động hủy và vô hiệu hóa nút giao dịch quá hạn sau 5 phút.

---

Chúc các đạo hữu tu luyện hanh thông, sớm ngày đắc đạo thành tiên!
