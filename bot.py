import discord
from discord.ext import commands
import datetime
import random
import aiohttp
import asyncio
from discord import app_commands
import os
import time
from collections import defaultdict

# ================= CẤU HÌNH TÔNG MÔN =================
TOKEN = os.getenv("TOKEN")
PREFIX = "!" 
MASTER_ID = 1398366739246612631
FREE_CHANNEL_ID = 1484866074146242661
TIME_WINDOW = 60 # Cửa sổ thời gian cho Auto-Ban (ví dụ: 60 giây)
SPAM_THRESHOLD = 4 # Số kênh rải CÙNG 1 tin nhắn để bị BAN

SUSPICION_WINDOW = 10 # Thời gian
SUSPICION_LIMIT = 5 # Số tin / Số kênh để kích hoạt cảnh báo
spam_tracker = defaultdict(list)
# Cấu hình dạng: { ID_Server : ID_Kênh_Báo_Cáo_Của_Server_Đó }
REPORT_CHANNELS = {
    1483390701096927313: 1489689538665250876, # ID Server 1 : ID Kênh báo SV 1
    1485134514299867189: 1489695537186865282 # ID Server 2 : ID Kênh báo SV 2

}
# Cấu hình Ngũ Chỉ Sơn / Diện Bích
NGU_CHI_SON_GUILD_ID = 1483390701096927313
NGU_CHI_SON_CHANNEL_ID = 1511686470195347507
ROLE_DIEN_BICH = "Diện Bích"
# ====================================================

# Khởi tạo Intents
intents = discord.Intents.default()
intents.message_content = True
intents.members = True 

# Khởi tạo Bot
bot = commands.Bot(command_prefix=PREFIX, intents=intents, case_insensitive=True)
bot.remove_command("help")

@bot.event
async def setup_hook():
    # Mở 1 luồng kết nối duy nhất xài chung cho toàn bộ quá trình chạy bot
    bot.session = aiohttp.ClientSession()
    
    try:
        await bot.load_extension("cat")
        await bot.load_extension("role_chon")
        await bot.load_extension("gemini")
        await bot.tree.sync()
        print("Đã đồng bộ Tàng Kinh Các (lệnh Slash) thành công!")
    except Exception as e:
        print(f"Bỏ qua Tàng Kinh Các: {e}")

@bot.event
async def on_ready():
    print(f"{bot.user} đã xuất quan và sẵn sàng chấp pháp!")
    
    print("Đang đả thông kinh mạch, kết nối trận pháp mạng...")
    
    async def ping_api(url):
        timeout = aiohttp.ClientTimeout(total=2)
        try:
            async with bot.session.get(url, timeout=timeout) as response:
                await response.read()
        except Exception as e:
            print(f"Lỗi nhẹ khi mồi mạng {url}: {e}")

    await asyncio.gather(
        ping_api("https://api.waifu.pics/sfw/slap"),
        ping_api("https://nekos.best/api/v2/slap")
    )

    print("Kinh mạch đã thông! Phát lệnh đầu tiên đảm bảo siêu tốc!")

# ================= CÁC LỆNH CHẤP PHÁP =================
IMG_QUYEN_LUC = "https://media.discordapp.net/attachments/1485504911029440522/1487179375513309327/EDIT_20260326_221838-ezgif.com-video-to-gif-converter_2.gif"

# ================= LỆNH LƯỠNG NGHI (Vừa ! vừa /) =================

@bot.hybrid_command(name="trucxuat", aliases=["bien", "cut"], description="Trục xuất (Kick) khỏi Ma Tông!")
@app_commands.describe(member="Kẻ xui xẻo bị chọn", reason="Lý do trục xuất")
@commands.has_permissions(kick_members=True)
async def trucxuat(ctx, member: discord.Member, *, reason: str = "Nhìn ngứa mắt"):
    if member.id == MASTER_ID:
        return await ctx.send("hỏi chấm?")
    try:
        await member.kick(reason=reason)
        embed = discord.Embed(
            title="TRỤC XUẤT",
            description=f"{member.mention} đã bị {ctx.author.mention} trục xuất khỏi Ma Tông!\n**Tội trạng:** {reason}",
            color=discord.Color.red()
        )
        embed.set_image(url=IMG_QUYEN_LUC)
        await ctx.send(embed=embed)
    except:
        await ctx.send("Tu vi không đủ, không thể thi triển trục xuất!")

@bot.hybrid_command(name="phongsat", aliases=["ban", "baymau"], description="Phong sát (Ban) vĩnh viễn khỏi bổn tông!")
@app_commands.describe(member="Kẻ dính án tử (Tag hoặc nhập ID)", reason="Lý do phong sát")
@commands.has_permissions(ban_members=True)
async def phongsat(ctx, member: discord.User, *, reason: str = "Bản tọa làm việc không cần lý do"):
    # Kiểm tra nếu là Master (Chủ nhân bot)
    if member.id == MASTER_ID:
        return await ctx.send("hỏi chấm?")
    
    try:
        # Sử dụng ctx.guild.ban để ban theo ID bất kể trong hay ngoài server
        await ctx.guild.ban(member, reason=reason)
        
        embed = discord.Embed(
            title="PHONG SÁT",
            description=f"**{member}** (ID: {member.id}) đã bị {ctx.author.mention} trục xuất khỏi Ma Tông, vĩnh viễn không được quay lại!\n**Tội trạng:** {reason}",
            color=discord.Color.dark_red()
        )
        embed.set_image(url=IMG_QUYEN_LUC)
        await ctx.send(embed=embed)
        
    except discord.Forbidden:
        await ctx.send("⚠ Bản tọa chưa đủ quyền hạn (Thiếu quyền Ban Members hoặc vai trò của đối phương quá cao).")
    except Exception as e:
        await ctx.send(f"Trận pháp gặp trục trặc: {e}")

@bot.hybrid_command(name="camngon", aliases=["khoamom", "cammom"], description="Phong ấn khẩu quyết (Timeout / Diện Bích)!")
@app_commands.describe(member="Kẻ ồn ào cần khóa mõm", minutes="Thời gian phong ấn (phút)", reason="Lý do cấm ngôn")
@commands.has_permissions(moderate_members=True)
async def camngon(ctx, member: discord.Member, minutes: int = 10, *, reason: str = "Nhiễu loạn tịnh tu, phạt bế quan diện bích"):
    if member.id == MASTER_ID:
        return await ctx.send("hỏi chấm?")
    
    if ctx.guild.id == NGU_CHI_SON_GUILD_ID:
        try:
            guild = ctx.guild
            role = discord.utils.get(guild.roles, name=ROLE_DIEN_BICH)
            if not role:
                role = await guild.create_role(
                    name=ROLE_DIEN_BICH,
                    color=discord.Color.dark_grey(),
                    reason="Hệ thống cấm chat tự động tạo role Diện Bích"
                )
            
            # Cấu hình quyền cho role Diện Bích ở kênh thụ hình
            channel = guild.get_channel(NGU_CHI_SON_CHANNEL_ID)
            if channel:
                await channel.set_permissions(role, read_messages=True, send_messages=True, reason="Cho phép role Diện Bích chat tại đây")

            await member.add_roles(role, reason=reason)
            
            embed = discord.Embed(
                title="Cấm Ngôn - DIỆN BÍCH",
                description=f"{member.mention} đã bị đày vào **Ngũ Chỉ Sơn** bế quan diện bích trong **{minutes} phút**!\n"
                            f"**Lý do:** {reason}\n"
                            f"**Nơi thụ hình:** <#{NGU_CHI_SON_CHANNEL_ID}> (Chỉ có thể chat ở đây)",
                color=discord.Color.dark_purple()
            )
            embed.set_image(url=IMG_QUYEN_LUC)
            await ctx.send(embed=embed)
            
            # Tạo task chạy ngầm tự gỡ role sau khi hết giờ
            async def self_unmute():
                await asyncio.sleep(minutes * 60)
                try:
                    fresh_member = await guild.fetch_member(member.id)
                    fresh_role = discord.utils.get(guild.roles, name=ROLE_DIEN_BICH)
                    if fresh_role and fresh_role in fresh_member.roles:
                        await fresh_member.remove_roles(fresh_role, reason="Hết thời gian Diện Bích")
                        if channel:
                            await channel.send(f"Đạo hữu {fresh_member.mention} đã mãn hạn Diện Bích và được thả khỏi Ngũ Chỉ Sơn!")
                except Exception as e:
                    print(f"Lỗi khi tự gỡ Diện Bích: {e}")
            
            asyncio.create_task(self_unmute())
            
        except discord.Forbidden:
            await ctx.send("⚠ Bản tọa chưa đủ quyền hạn để tạo/gán Role (Thiếu quyền Manage Roles).")
        except Exception as e:
            await ctx.send(f"Trận pháp gặp trục trặc: {e}")
    else:
        try:
            duration = datetime.timedelta(minutes=minutes)
            await member.timeout(discord.utils.utcnow() + duration, reason=reason)
            embed = discord.Embed(
                title="Cấm Ngôn",
                description=f"{member.mention} đã bị phong ấn khẩu quyết trong **{minutes} phút**!\n**Lý do:** {reason}",
                color=discord.Color.orange()
            )
            embed.set_image(url=IMG_QUYEN_LUC)
            await ctx.send(embed=embed)
        except:
            await ctx.send("Thiếu quyền hạn để thi triển cấm ngôn!")

@bot.hybrid_command(name="giaicam", aliases=["giaicamngon", "unmute", "mokhauquyet"], description="Giải trừ cấm ngôn / Diện Bích!")
@app_commands.describe(member="Kẻ được ân xá", reason="Lý do tha")
@commands.has_permissions(moderate_members=True)
async def giaicam(ctx, member: discord.Member, *, reason: str = "Cần lý do sao?"):
    if member.id == MASTER_ID:
        return await ctx.send("Hỏi chấm?")
    
    if ctx.guild.id == NGU_CHI_SON_GUILD_ID:
        try:
            guild = ctx.guild
            role = discord.utils.get(guild.roles, name=ROLE_DIEN_BICH)
            if role and role in member.roles:
                await member.remove_roles(role, reason=reason)
                embed = discord.Embed(
                    title="GIẢI PHONG ẤN NGŨ CHỈ SƠN",
                    description=f"**{member.mention}** đã được {ctx.author.mention} tháo bỏ cấm chế Diện Bích, liệu hồn mà ngậm miệng lại!\n**Lý do:** {reason}",
                    color=discord.Color.green()
                )
                await ctx.send(embed=embed)
            else:
                await ctx.send(f"Đạo hữu {member.mention} có đang bị giam cầm ở Ngũ Chỉ Sơn đâu?")
        except discord.Forbidden:
            await ctx.send("⚠ Bản tọa chưa đủ quyền hạn để gỡ Role (Thiếu quyền Manage Roles).")
        except Exception as e:
            await ctx.send(f"Lỗi hệ thống: {e}")
    else:
        try:
            await member.timeout(None, reason=reason)
            
            embed = discord.Embed(
                title="GIẢI PHONG ẤN",
                description=f"**{member.mention}** đã được {ctx.author.mention} tháo bỏ cấm chế, liệu hồn mà ngậm miệng lại!\n**Lý do:** {reason}",
                color=discord.Color.green()
            )
            
            if ctx.interaction:
                await ctx.send(embed=embed)
            else:
                await ctx.send(embed=embed)
                
        except discord.Forbidden:
            await ctx.send("⚠ thiếu quyền (Moderate Members) để giải trừ!", ephemeral=True if ctx.interaction else False)
        except Exception as e:
            await ctx.send(f"Lỗi hệ thống: {e}", ephemeral=True if ctx.interaction else False)

@bot.hybrid_command(name="spam", aliases=["clear", "xoa"], description="Dọn dẹp tiêu ký rác!")
@app_commands.describe(amount="Số lượng tiêu ký cần xóa (mặc định 10)", member="Chỉ xóa tiêu ký rác của (không bắt buộc)")
@commands.has_permissions(manage_messages=True)
async def spam(ctx, amount: int = 10, member: discord.Member = None):
    await ctx.defer() 
    
    try:
        def check_target(m):
            # Tuyệt đối không nhắm vào tin nhắn gọi lệnh (!spam)
            if ctx.message and m.id == ctx.message.id:
                return False
            
            # Bỏ qua tin nhắn của bot, hoặc xóa theo member chỉ định
            if member is None: 
                return m.author != bot.user 
            return m.author == member 

        # Xóa đúng số lượng amount (vì đã loại trừ lệnh !spam, nó sẽ quét đúng rác cần xóa)
        deleted = await ctx.channel.purge(limit=amount, check=check_target)
        
        # Xóa thủ công tin nhắn gọi lệnh để phi tang chứng cứ (nếu dùng lệnh prefix)
        if ctx.message:
            try:
                await ctx.message.delete()
            except discord.NotFound:
                pass

        # Lấy danh tính và tạo đúng 1 thông báo
        nguoi_ra_lenh = ctx.author.mention
        if member:
            thong_bao = f"**{nguoi_ra_lenh}** đã thi triển pháp thuật xóa bỏ **{len(deleted)}** tiêu ký của {member.mention}!"
        else:
            thong_bao = f"**{nguoi_ra_lenh}** đã thi triển pháp thuật xóa bỏ **{len(deleted)}** tiêu ký rác!"

        embed = discord.Embed(
            title="XÓA TIÊU KÝ",
            description=thong_bao,
            color=discord.Color.red()
        )
        embed.set_image(url=IMG_QUYEN_LUC)

        # Chốt hạ bằng 1 thông báo duy nhất
        await ctx.send(embed=embed)

    except discord.Forbidden:
        await ctx.send("Tu vi của ngươi chưa đủ (thiếu quyền Manage Messages) để thi triển pháp thuật này!", ephemeral=True)
    except Exception as e:
        await ctx.send(f"Trận pháp có biến: {e}", ephemeral=True)
# ================= HỆ THỐNG LẤY ẢNH ĐÃ TỐI ƯU =================
gif_history = {}
MAX_HISTORY = 50 

WAIFU_TAGS = [
    "bully", "cuddle", "cry", "hug", "kiss", "lick", "pat", "smug", 
    "bonk", "yeet", "blush", "smile", "wave", "highfive", "handhold", 
    "nom", "bite", "glomp", "slap", "kill", "kick", "happy", "wink", 
    "poke", "dance"
]

NEKOS_TAGS = [
    "angry", "baka", "bite", "bleh", "blowkiss", "blush", "bonk", "bored", 
    "carry", "clap", "confused", "cry", "cuddle", "dance", "facepalm", 
    "feed", "handhold", "handshake", "happy", "highfive", "hug", "kabedon", 
    "kick", "kiss", "lappillow", "laugh", "lurk", "nod", "nom", "nope", 
    "nya", "pat", "peck", "poke", "pout", "punch", "run", "salute", "shake", 
    "shoot", "shocked", "shrug", "sip", "slap", "sleep", "smile", "smug", 
    "spin", "stare", "tableflip", "teehee", "think", "thumbsup", "tickle", 
    "wag", "wave", "wink", "yawn", "yeet"
]

async def get_neko_gif(action: str):

    if action not in WAIFU_TAGS and action not in NEKOS_TAGS:
        print(f"[BÁO ĐỘNG] Thẻ ma '{action}' không tồn tại. Đã chặn kết nối mạng!")
        return "https://media.giphy.com/media/xT9IgkKL1SJVxzJSEI/giphy.gif"

    available_apis = []
    if action in WAIFU_TAGS: available_apis.append("waifu")
    if action in NEKOS_TAGS: available_apis.append("nekos")

    if action not in gif_history:
        gif_history[action] = []

    timeout = aiohttp.ClientTimeout(total=2)
    random.shuffle(available_apis)

    for api in available_apis:
        try:
            if api == "waifu":
                url = f"https://api.waifu.pics/sfw/{action}"
                # FIX LỖI: Thử bốc thăm tối đa 4 lần nếu lấy phải ảnh đã dùng
                for _ in range(4):
                    async with bot.session.get(url, timeout=timeout) as response:
                        if response.status == 200:
                            chosen_url = (await response.json()).get("url")
                            if chosen_url and chosen_url not in gif_history[action]:
                                gif_history[action].append(chosen_url)
                                if len(gif_history[action]) > MAX_HISTORY: gif_history[action].pop(0)
                                return chosen_url
            else:
                url = f"https://nekos.best/api/v2/{action}?amount=20"
                async with bot.session.get(url, timeout=timeout) as response:
                    if response.status == 200:
                        results = (await response.json()).get("results", [])
                        if results:
                            available_gifs = [img["url"] for img in results if img["url"] not in gif_history[action]]
                            if available_gifs:
                                chosen_url = random.choice(available_gifs)
                                gif_history[action].append(chosen_url)
                                if len(gif_history[action]) > MAX_HISTORY: gif_history[action].pop(0)
                                return chosen_url
        except Exception as e:
            print(f"[LỖI KẾT NỐI {api}] {e}")
            continue # Lỗi
    
    gif_history[action] = [] 
    backup_url = "https://media.giphy.com/media/xT9IgkKL1SJVxzJSEI/giphy.gif"
    
    try:
        target_api = available_apis[0]
        if target_api == "waifu":
            async with bot.session.get(f"https://api.waifu.pics/sfw/{action}", timeout=timeout) as response:
                if response.status == 200:
                    data = await response.json()
                    final_url = data.get("url")
                    return final_url if final_url else backup_url
        else:
            async with bot.session.get(f"https://nekos.best/api/v2/{action}", timeout=timeout) as response:
                if response.status == 200:
                    data = await response.json()
                    final_url = data["results"][0]["url"]
                    return final_url if final_url else backup_url
    except Exception as e:
        print(f"[CẢNH BÁO]: {e}")

    return "https://media.giphy.com/media/xT9IgkKL1SJVxzJSEI/giphy.gif" 

# ================= CÁC LỆNH TƯƠNG TÁC (TÁT, ÔM, HÔN) =================

@bot.command(name="tat", aliases=["slap", "vamom", "battai"])
async def tat(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Ngươi không có tư cách dùng lệnh với Bản tọa!")
    if member == ctx.author: return await ctx.send("Ngươi định tự vả để thức tỉnh bản thân à?")

    gif_url = await get_neko_gif("slap")

    if member.id == MASTER_ID:
        embed = discord.Embed(
            title="hỏi chấm?",
            description=f"**{member.mention}** đã né được và vả ngược lại **{ctx.author.mention}**. Quá bố láo!",
            color=discord.Color.dark_purple()
        )
        embed.set_image(url=gif_url)
        embed.set_footer(text="bỏ cái ý nghĩ đó đi!")
        await ctx.send(embed=embed)
        return

    embed = discord.Embed(description=f"**{ctx.author.mention}** đã tát vào mặt **{member.mention}** tên đần này!", color=discord.Color.red())
    embed.set_image(url=gif_url)
    await ctx.send(embed=embed)

@bot.command(name="om", aliases=["hug", "cuddle"])
async def om(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự ôm chính mình... cô độc đến mức này rồi sao 🥀")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã ôm chầm lấy **{member.mention}** thật ấm áp! (っ´▽｀)っ", color=discord.Color.pink())
    embed.set_image(url=await get_neko_gif("hug"))
    await ctx.send(embed=embed)

@bot.command(name="hon", aliases=["kiss", "chu"])
async def hon(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("To gan! Bản tọa tu đạo vô tình, kẻ phàm trần như ngươi cũng đòi vấy bẩn?")
    if member == ctx.author: return await ctx.send("Tự luyến đến mức tẩu hỏa nhập ma rồi sao? Mau đi bế quan tịnh tâm lại!")
    embed = discord.Embed(description=f"Chụt! **{ctx.author.mention}** vừa trao một nụ hôn thật ngọt ngào cho **{member.mention}**! 💋", color=discord.Color.magenta())
    embed.set_image(url=await get_neko_gif("kiss"))
    await ctx.send(embed=embed)

@bot.command(name="xoadau", aliases=["pat", "xoatoc"])
async def xoadau(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự xoa đầu mình an ủi à? Ngoan ngoan...")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang xoa đầu **{member.mention}**! Trông thật đáng yêu!", color=discord.Color.gold())
    embed.set_image(url=await get_neko_gif("pat"))
    await ctx.send(embed=embed)
    
@bot.command(name="can", aliases=["bite"])
async def can(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Ngươi không có tư cách dùng lệnh với Bản tọa!")
    if member == ctx.author: return await ctx.send("Tự cắn mình? Ngươi bị tẩu hỏa nhập ma rồi à?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã ngoạm **{member.mention}** một phát đau điếng!", color=discord.Color.dark_red())
    embed.set_image(url=await get_neko_gif("bite"))
    await ctx.send(embed=embed)

@bot.command(name="godau", aliases=["bonk"])
async def godau(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Ngươi không có tư cách dùng lệnh với Bản tọa!")
    if member == ctx.author: return await ctx.send("Tự gõ đầu cho tỉnh ra à? Tốt!")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã gõ cái boong vào đầu **{member.mention}**! Hư này!", color=discord.Color.orange())
    embed.set_image(url=await get_neko_gif("bonk"))
    await ctx.send(embed=embed)

@bot.command(name="da", aliases=["sut"])
async def da(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Ngươi không có tư cách dùng lệnh với Bản tọa!")
    if member == ctx.author: return await ctx.send("Tự đá vào mông mình kiểu gì đấy? Dạy ta với!")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã tung cước đá bay **{member.mention}**!", color=discord.Color.brand_green())
    embed.set_image(url=await get_neko_gif("kick"))
    await ctx.send(embed=embed)

@bot.command(name="dam", aliases=["punch"])
async def dam(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Ngươi không có tư cách dùng lệnh với Bản tọa!")
    if member == ctx.author: return await ctx.send("Luyện Thiết Sa Chưởng bằng cách tự đấm mình à?")
        
    if member.id == 665146360063852554:
        return await ctx.send(f"Hỗn xược! {member.mention} là Tông Chủ mang Hộ Thể Cương Khí, {ctx.author.mention} đừng đấm hãy tát đi!")

    embed = discord.Embed(description=f"**{ctx.author.mention}** đã đấm vỡ mồm **{member.mention}**!", color=discord.Color.dark_theme())
    embed.set_image(url=await get_neko_gif("punch"))
    await ctx.send(embed=embed)

@bot.command(name="bansung", aliases=["shoot"])
async def ban(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Ngươi không có tư cách dùng lệnh với Bản tọa!")
    if member == ctx.author: return await ctx.send("Đừng để tâm ma dẫn lối!")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã rút súng nã đạn vào **{member.mention}**! Đoàng đoàng!", color=discord.Color.light_grey())
    embed.set_image(url=await get_neko_gif("shoot"))
    await ctx.send(embed=embed)

@bot.command(name="quang", aliases=["yeet", "nem", "phi"])
async def quang(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Ngươi không có tư cách dùng lệnh với Bản tọa!")
    if member == ctx.author: return await ctx.send("Tự nhấc mình lên rồi ném đi? Ngươi là thần tiên phương nào?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã tóm lấy **{member.mention}** và ném bay sang thế giới bên kia!", color=discord.Color.teal())
    embed.set_image(url=await get_neko_gif("yeet"))
    await ctx.send(embed=embed)

@bot.command(name="baka", aliases=["ngu", "ngoc"])
async def ngu(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự chửi mình ngu? Đạo tâm của ngươi có vấn đề à?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang mắng **{member.mention}** là đồ ngốc nghếch! Baka! 💢", color=discord.Color.dark_orange())
    embed.set_image(url=await get_neko_gif("baka"))
    await ctx.send(embed=embed)

@bot.command(name="canloi", aliases=["facepalm", "batluc"])
async def canloi(ctx, member: discord.Member = None):
    desc = f"**{ctx.author.mention}** đang cạn lời và bất lực toàn tập với **{member.mention}**..." if member else f"**{ctx.author.mention}** đang cạn lời, chán chả buồn nói..."
    embed = discord.Embed(description=desc, color=discord.Color.dark_grey())
    embed.set_image(url=await get_neko_gif("facepalm"))
    await ctx.send(embed=embed)

@bot.command(name="latban", aliases=["tableflip", "caycu"])
async def latban(ctx):
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang vô cùng cay cú và lật tung cái bàn! (╯°□°）╯", color=discord.Color.red())
    embed.set_image(url=await get_neko_gif("tableflip"))
    await ctx.send(embed=embed)

@bot.command(name="choc", aliases=["poke", "kheu"])
async def choc(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự chọc mình? Đỉnh cao của sự cô đơn là đây sao?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang chọc chọc **{member.mention}**. Định gạ kèo gì đây?", color=discord.Color.blue())
    embed.set_image(url=await get_neko_gif("poke"))
    await ctx.send(embed=embed)

@bot.command(name="culet", aliases=["tickle", "nhot"])
async def culet(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự cù lét bản thân? Tẩu hỏa nhập ma rồi à?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang đè **{member.mention}** ra cù lét không trượt phát nào!", color=discord.Color.green())
    embed.set_image(url=await get_neko_gif("tickle"))
    await ctx.send(embed=embed)

@bot.command(name="khoc", aliases=["cry"])
async def khoc(ctx, member: discord.Member = None):
    # Phản damage: Kẻ nào dám tag Chấp Pháp sẽ bị phạt đến khóc
    if member == bot.user: 
        embed = discord.Embed(
            description=f"Hỗn xược! **{ctx.author.mention}** to gan dám vu khống Bản Chấp Pháp, lập tức lôi ra xử phạt theo môn quy! Đánh cho **{ctx.author.mention}** khóc lóc van xin thảm thiết mới thôi! Thật là đáng đời!", 
            color=discord.Color.red()
        )
        embed.set_image(url=await get_neko_gif("cry"))
        return await ctx.send(embed=embed)
        
    target = member if member else ctx.author
    embed = discord.Embed(description=f"**{target.mention}** đang khóc thút thít... Ai đó dỗ đi kìa!", color=discord.Color.dark_blue())
    embed.set_image(url=await get_neko_gif("cry"))
    await ctx.send(embed=embed)

@bot.command(name="nhay", aliases=["dance", "quay"])
async def nhay(ctx):
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang quẩy cực sung! Lên là lên là lên!", color=discord.Color.purple())
    embed.set_image(url=await get_neko_gif("dance"))
    await ctx.send(embed=embed)

@bot.command(name="daptay", aliases=["highfive"])
async def daptay(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự đập tay với chính mình? Thật đáng thương!")
    embed = discord.Embed(description=f"**{ctx.author.mention}** và **{member.mention}** vừa đập tay cái bốp! Đồng đội tốt!", color=discord.Color.gold())
    embed.set_image(url=await get_neko_gif("highfive"))
    await ctx.send(embed=embed)

@bot.command(name="eptuong", aliases=["kabedon"])
async def eptuong(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự úp mặt vào tường sám hối thì đúng hơn. Ngôn tình gì tầm này!")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã chống tay ép **{member.mention}** vào tường! Ánh mắt ta chạm nhau...", color=discord.Color.dark_magenta())
    embed.set_image(url=await get_neko_gif("kabedon"))
    await ctx.send(embed=embed)

@bot.command(name="dac_y", aliases=["smug", "dacy"])
async def dac_y(ctx):
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang nở một nụ cười đắc ý đầy ngạo mạn...", color=discord.Color.dark_theme())
    embed.set_image(url=await get_neko_gif("smug"))
    await ctx.send(embed=embed)

@bot.command(name="leuleu", aliases=["bleh"])
async def leuleu(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự thè lưỡi lêu lêu trước gương à? Rảnh rỗi sinh nông nổi thật sự.")
    embed = discord.Embed(description=f"**{ctx.author.mention}** lè lưỡi lêu lêu trêu tức **{member.mention}**!", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("bleh"))
    await ctx.send(embed=embed)

@bot.command(name="hongio", aliases=["blowkiss"])
async def hongio(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự hôn gió mình qua gương à? Cô đơn đến mức này rồi sao 🥀")
    embed = discord.Embed(description=f"**{ctx.author.mention}** gửi một nụ hôn gió bay cái vèo tới **{member.mention}**!", color=discord.Color.pink())
    embed.set_image(url=await get_neko_gif("blowkiss"))
    await ctx.send(embed=embed)

@bot.command(name="be", aliases=["carry"])
async def be_nguoi(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự túm tóc nhấc mình lên khỏi mặt đất thử xem? Định biểu diễn ảo thuật à?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã nhấc bổng **{member.mention}** lên tay kiểu công chúa!", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("carry"))
    await ctx.send(embed=embed)

@bot.command(name="nung", aliases=["nungniu"])
async def nung(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Ngoan, ngoan, tự nựng xíu cho đỡ tủi thân.")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang ôm ấp nựng nịu **{member.mention}** cưng xỉu! 🤗", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("cuddle")) 
    await ctx.send(embed=embed)

@bot.command(name="dutan", aliases=["feed"])
async def dutan(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự cầm thìa xúc ăn đi cha nội, lớn già đầu rồi còn đòi bản chấp pháp đút à?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang ân cần đút đồ ăn cho **{member.mention}**. Há miệng ra nàoooo!", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("feed"))
    await ctx.send(embed=embed)

@bot.command(name="namtay", aliases=["handhold"])
async def namtay(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tay trái đan vào tay phải, nhắm mắt tưởng tượng đang nắm tay crush? Tỉnh mộng đi!")
    embed = discord.Embed(description=f"**{ctx.author.mention}** bẽn lẽn nắm lấy tay của **{member.mention}**...", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("handhold"))
    await ctx.send(embed=embed)

@bot.command(name="battay", aliases=["handshake"])
async def battay(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự tay trái bắt tay phải à? Ở một mình lâu quá sinh hoang tưởng rồi hả?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** và **{member.mention}** vừa bắt tay nhau một phát!\nTình anh em chắc có bền lâu, hay bắt tay xong quay lưng nói xấu đây?", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("handshake"))
    await ctx.send(embed=embed)

@bot.command(name="goidui", aliases=["lappillow"])
async def goidui(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Uốn dẻo kiểu gì để tự gối lên đùi mình thế?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** cho **{member.mention}** gối đầu lên đùi thư giãn. Sướng nhất nhé!", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("lappillow"))
    await ctx.send(embed=embed)

@bot.command(name="honma", aliases=["peck"])
async def honphot(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự thơm má mình kiểu gì hay vậy? Quay clip lại gửi Bản tọa học hỏi với?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** vừa thơm chụt một cái lên má **{member.mention}**!", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("peck"))
    await ctx.send(embed=embed)

@bot.command(name="nhin", aliases=["stare"])
async def nhin(ctx, member: discord.Member = None):
    if member == bot.user: return await ctx.send("Có tin Bản tọa móc mắt ngươi ra không?")
    if member is None:
        description = f"**{ctx.author.mention}** đang nhìn chằm chằm vào tất cả mọi người không chớp mắt... 👀"
    elif member == ctx.author: 
        return await ctx.send("Nhìn vào gương đi!")
    else:
        description = f"**{ctx.author.mention}** đang nhìn **{member.mention}** chằm chằm không chớp mắt..."
        
    embed = discord.Embed(description=description, color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("stare"))
    await ctx.send(embed=embed)

@bot.command(name="batnat", aliases=["bully"])
async def batnat(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự bắt nạt bản thân? Ngươi có máu M à?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang ức hiếp, bắt nạt **{member.mention}** kìa! Ai ra cứu đi!", color=discord.Color.dark_purple())
    embed.set_image(url=await get_neko_gif("bully"))
    await ctx.send(embed=embed)

@bot.command(name="liem", aliases=["lick"])
async def liem(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Biến thái! Tránh xa Bản tọa ra!")
    if member == ctx.author: return await ctx.send("Tự liếm mình... Ngươi là mèo chuyển sinh à?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đang liếm **{member.mention}** nước miếng tùm lum! Biến thái quá!", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif("lick"))
    await ctx.send(embed=embed)

@bot.command(name="volay", aliases=["glomp", "voom"])
async def volay(ctx, member: discord.Member):
    if member == ctx.author: return await ctx.send("Tự vồ lấy mình? Logic ở đâu?")
    embed = discord.Embed(description=f"**{ctx.author.mention}** đã lao tới vồ lấy và ôm chầm **{member.mention}**!", color=discord.Color.orange())
    embed.set_image(url=await get_neko_gif("glomp"))
    await ctx.send(embed=embed)

@bot.command(name="giet", aliases=["kill", "kethlieu"])
async def giet(ctx, member: discord.Member):
    if member == bot.user: return await ctx.send("Tạo phản à? Dám mưu sát Bản tọa?")
    if member == ctx.author: return await ctx.send("Bình tĩnh! Đừng để tâm ma nuốt chửng lý trí!")
    embed = discord.Embed(description=f"**{ctx.author.mention}** tung ra tuyệt sát chiêu, tiễn **{member.mention}** xuống Hoàng Tuyền gặp diêm vương, chết không kịp ngáp!", color=discord.Color.dark_red())
    embed.set_image(url=await get_neko_gif("kill"))
    await ctx.send(embed=embed)


# ================= LỆNH THẮP NHANG (TỰ TẠO) =================

NHANG_GIFS = [
    "https://media.discordapp.net/attachments/1485504911029440522/1491454475808804919/0.gif?ex=6a0493b8&is=6a034238&hm=758a3fa01fe9644ce669141b3ee7dcbe5a436aa384c9c39f50221ea2f8674deb&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1491454527143018507/84e009b0137eb6390d06398a80c9c3ba.gif?ex=6a0493c5&is=6a034245&hm=3ebbd7c2ea28b979862de369484a2735e78fd7d7c4fe986365cc518849961951&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1491454527424167977/UIhGrdU.gif?ex=6a0493c5&is=6a034245&hm=6ad4f556acd2165f486bfcb5b9ab96c111576abec698656a476a60f6e400c7d6&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1491454527688413194/-.gif?ex=6a0493c5&is=6a034245&hm=ed65465448f60e6586ad2abd5e0cfbbe7ff6bf1cb4f759b3223644b7d96ab2b5&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1491454528057249842/1479033126-2511231408.gif?ex=6a0493c5&is=6a034245&hm=ac9e733c80bb5ad6e63abc256bfb0a628202ab673c229f4a2635eaf8970e2a2a&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1491454528459898950/5699ac867b784923613776b8a65b9859.gif?ex=6a0493c5&is=6a034245&hm=5602594cc0437510a2035bf58b18941270373eafd6c0dd7ba3648aa3ad365d03&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838063065956443/500_225304_1446637780.gif?ex=6a04cdd6&is=6a037c56&hm=f053f9ada0526c819fdbaf1dae883dd0195c8253b991d6ac9c1ceb2cbdf71823&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838259183095808/20180628_4f555865b15d80fda543qWYUA3LU2bMo.gif?ex=6a04ce04&is=6a037c84&hm=cfe6f65b0f1d94bb0348667cb95473aabe9b31455d8a17328a79041e6de7b6df&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838968960123180/d8353d04b3864580bd5344c71cf1afc0.gif?ex=6a04ceae&is=6a037d2e&hm=d39187ce97aa3e849f073fa7ac8d078770d49a0467f982e51ec2ec361ebf5a66&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838969274826856/0bda59771fa64914886a4fb006b81f71.gif?ex=6a04ceae&is=6a037d2e&hm=a69149207593944b3bdd1430cb4b3cf11fb5ceaf3dc1d9ce8f6c05aebace14cd&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838969652052128/3e2abee8e8ca4d57b271ea92e285b718.gif?ex=6a04ceae&is=6a037d2e&hm=ec18b6f51ed8f5772c8117097285a078d093ec191990c171cb1fdc96fe733e7b&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838970017087730/a812fffbc39646abaff1fa8e2f2e5b01.gif?ex=6a04ceae&is=6a037d2e&hm=ef80c5570f54391fa5e8aceeb9dfb8e5ea353b9821eb91a057e263946617454b&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838970315014144/01f0ae9238b444ebb2a8f07b0b294f75.gif?ex=6a04ceae&is=6a037d2e&hm=7f7b39a7d8259ea2a284df6b86a3240bbf1e58e121c0de5c576f2a04b35468fa&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503838970663145634/21d3f5da03104ad7b7a6b62d4a642f15.gif?ex=6a04ceae&is=6a037d2e&hm=5d1a5b1a8af506f96acae85b2062b7d6865325ea18a2d0b6d54208da808e2d47&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503840236646437018/c93e0c0d7918b460fff542f967d863dc.gif?ex=6a04cfdc&is=6a037e5c&hm=3a64034d3aea9e0f5dccb408a7f477e4b6af3def5cfc5b5797bd78ba6e4bdd1c&=",
    "https://media.discordapp.net/attachments/1485504911029440522/1503841419037769768/4760334e-4090-4052-b694-05c177104447-v2_1.gif?ex=6a04d0f6&is=6a037f76&hm=4d64c70b8843afb7da8bfcd52b040b3ed91f7bd59206f1ac28926b2d6bbf6bf"
]

recent_nhang_gifs = []

def get_nhang_gif():
    available = [g for g in NHANG_GIFS if g not in recent_nhang_gifs]
    if not available: 
        available = NHANG_GIFS
        recent_nhang_gifs.clear()
        
    chosen = random.choice(available)
    recent_nhang_gifs.append(chosen)
    if len(recent_nhang_gifs) > 10:
        recent_nhang_gifs.pop(0)
        
    return chosen

@bot.command(name="thapnhang", aliases=["nhang", "vieng", "cung"])
async def thapnhang(ctx, member: discord.Member = None):
    gif_url = get_nhang_gif()

    if member == bot.user: 
        return await ctx.send("Bản tọa tu đạo trường sinh bất lão, không tu hương hỏa chi lực.")
    if member == ctx.author: 
        return await ctx.send("Tự thắp nhang cho chính mình? Ngươi tẩu hỏa nhập ma đến mức tự chuẩn bị sẵn hậu sự rồi sao?")
    if member is None:
        description = f"**{ctx.author.mention}** đang thành tâm thắp nén nhang... Khói hương nghi ngút, không biết là cúng cho vong hồn phương nào đây. 🙏"
    else:
        description = f"**{ctx.author.mention}** đang thành kính thắp 3 nén nhang tiễn đưa **{member.mention}** về nơi Hoàng Tuyền. Mong đạo hữu sớm siêu thoát!"
        
    embed = discord.Embed(description=description, color=discord.Color.dark_grey())
    embed.set_thumbnail(url=gif_url)  # FIX: set_thumbnail thay vì set_image
    await ctx.send(embed=embed)


# ================= CÁC LỆNH BIỂU CẢM (KHÔNG CẦN TAG) =================

async def send_action(ctx, action: str, self_text: str, target_text: str = None, member: discord.Member = None):
    if member is None or member == ctx.author:
        description = f"**{ctx.author.mention}** {self_text}"
    else:
        description = f"**{ctx.author.mention}** {target_text} **{member.mention}**!"
        
    embed = discord.Embed(description=description, color=discord.Color.random())
    embed.set_image(url=await get_neko_gif(action))
    await ctx.send(embed=embed)

async def send_self_action(ctx, action: str, description: str, member: discord.Member = None):
    target = member if member else ctx.author
    embed = discord.Embed(description=f"**{target.mention}** {description}", color=discord.Color.random())
    embed.set_image(url=await get_neko_gif(action))
    await ctx.send(embed=embed)


@bot.command(name="tucgian", aliases=["angry"])
async def tucgian(ctx, member: discord.Member = None): 
    await send_action(ctx, "angry", "đang cực kỳ phẫn nộ! Cẩn thận củi lửa! 🤬", "muốn combat khô máu với", member)

@bot.command(name="domat", aliases=["blush"])
async def domat(ctx, member: discord.Member = None): await send_self_action(ctx, "blush", "đang đỏ mặt ngại ngùng kìa! Kute quá!", member)

@bot.command(name="chan", aliases=["bored"])
async def chan(ctx): await send_self_action(ctx, "bored", "đang chán muốn chết... Ai bày trò gì chơi đi!")

@bot.command(name="votay", aliases=["clap"])
async def votay(ctx, member: discord.Member = None): 
    await send_action(ctx, "clap", "đang vỗ tay tán thưởng nhiệt liệt! 👏", "đang vỗ tay tán thưởng nhiệt liệt cho", member)

@bot.command(name="boiroi", aliases=["confused"])
async def boiroi(ctx, member: discord.Member = None): await send_self_action(ctx, "confused", "đang bối rối không hiểu chuyện gì xảy ra...", member)

@bot.command(name="vui", aliases=["happy"])
async def vui(ctx, member: discord.Member = None): await send_self_action(ctx, "happy", "đang vui như mở hội! Tưng bừng lên!", member)

@bot.command(name="cuoi", aliases=["laugh"])
async def cuoi(ctx, member: discord.Member = None): await send_self_action(ctx, "laugh", "đang cười lăn cười bò, cười nắc nẻ!", member)

@bot.command(name="nup", aliases=["lurk"])
async def nup(ctx, member: discord.Member = None): await send_self_action(ctx, "lurk", "đang lén lút núp lùm theo dõi mọi người... thật biến thái!", member)

@bot.command(name="gatdau", aliases=["nod"])
async def gatdau(ctx): await send_self_action(ctx, "nod", "gật gù đồng ý lia lịa.")

@bot.command(name="nhai", aliases=["nom"])
async def nhai(ctx): await send_self_action(ctx, "nom", "đang nhóp nhép ăn gì đó ngon lành lắm!")

@bot.command(name="tuchoi", aliases=["nope"])
async def tuchoi(ctx): await send_self_action(ctx, "nope", "kiên quyết say NO! Không là không!")

@bot.command(name="meomeo", aliases=["nya"])
async def meomeo(ctx, member: discord.Member = None): await send_self_action(ctx, "nya", "hóa thành mèo kêu Nya nya~", member)

@bot.command(name="biumoi", aliases=["pout"])
async def biumoi(ctx): await send_self_action(ctx, "pout", "đang dỗi bĩu môi kìa. Dỗ đi!")

@bot.command(name="chay", aliases=["run"])
async def chay(ctx): await send_self_action(ctx, "run", "đã quay xe, co giò chạy thục mạng! Vút!️")

@bot.command(name="chaonghiem", aliases=["salute"])
async def chaonghiem(ctx): await send_self_action(ctx, "salute", "đứng nghiêm chào báo cáo! Rõ!")

@bot.command(name="lac", aliases=["shake"])
async def lac(ctx): await send_self_action(ctx, "shake", "lắc đầu quầy quậy. Lắc lư!")

@bot.command(name="soc", aliases=["shocked"])
async def soc(ctx): await send_self_action(ctx, "shocked", "đang bị sốc nặng, không tin vào mắt mình!")

@bot.command(name="nhunvai", aliases=["shrug"])
async def nhunvai(ctx): await send_self_action(ctx, "shrug", "nhún vai tỏ vẻ 'Biết chết liền'.")

@bot.command(name="uongtra", aliases=["sip"])
async def uongtra(ctx): await send_self_action(ctx, "sip", "đang tao nhã nhâm nhi Ngộ Đạo Trà. Hảo trà!")

@bot.command(name="dingu", aliases=["sleep", "ngungon"])
async def dingu(ctx, member: discord.Member = None): await send_self_action(ctx, "sleep", "đã chìm vào giấc ngủ khò khò... Zzz", member)

@bot.command(name="cuoimim", aliases=["smile"])
async def cuoimim(ctx): await send_self_action(ctx, "smile", "đang mỉm cười thật rạng rỡ.")

@bot.command(name="xoay", aliases=["spin"])
async def xoay(ctx): await send_self_action(ctx, "spin", "đang tự xoay vòng vòng chóng cả mặt!")

@bot.command(name="cuoihihi", aliases=["teehee"])
async def cuoihihi(ctx, member: discord.Member = None): await send_self_action(ctx, "teehee", "đang cười khúc khích hì hì. Có mưu đồ gì đây?", member)

@bot.command(name="suynghi", aliases=["think"])
async def suynghi(ctx): await send_self_action(ctx, "think", "đang nhăn trán suy nghĩ cực kỳ tập trung...")

@bot.command(name="like", aliases=["thumbsup"])
async def like(ctx, member: discord.Member = None): 
    await send_action(ctx, "thumbsup", "giơ ngón cái lên thả một Like uy tín! 👍", "giơ ngón cái lên thả một Like uy tín cho", member)

@bot.command(name="vayduoi", aliases=["wag"])
async def vayduoi(ctx): await send_self_action(ctx, "wag", "đang vẫy đuôi mừng rỡ (nếu có đuôi)!")

@bot.command(name="vaytay", aliases=["wave"])
async def vaytay(ctx): await send_self_action(ctx, "wave", "vẫy tay chào mọi người thân thiện!")

@bot.command(name="nhaymat", aliases=["wink"])
async def nhaymat(ctx): await send_self_action(ctx, "wink", "nháy mắt đầy ẩn ý!")

@bot.command(name="ngap", aliases=["yawn"])
async def ngap(ctx): await send_self_action(ctx, "yawn", "ngáp một cái rõ to. Buồn ngủ quá rồi!")


# ================= LỆNH HƯỚNG DẪN (HELP MENU) =================

@bot.hybrid_command(name="huongdan", aliases=["help"], description="Mở Bí Kíp Ma Tông Lệnh (Menu Hướng Dẫn)")
async def huongdan(ctx):
    embed = discord.Embed(
        title="📜 BÍ KÍP MA TÔNG LỆNH",
        description=(
            "Tổng hợp toàn bộ chiêu thức của bổn tông.\n"
            "**Mẹo:** Các lệnh đều có lệnh viết tắt (ví dụ: `!trucxuat` = `!kick`).\n"
        ),
        color=discord.Color.dark_red()
    )
    
    embed.add_field(
        name="1. Lệnh Chấp Pháp (Mod/Admin)", 
        value="`!trucxuat`, `!phongsat`, `!camngon`, `!spam`", 
        inline=False
    )
    
    embed.add_field(
        name="2. Bạo Lực & Cà Khịa (Bắt buộc tag @user)", 
        value="`!tat`, `!dam`, `!da`, `!godau`, `!can`, `!quang`, `!bansung`, `!baka`, `!leuleu`, `!choc`, `!culet`, **`!batnat`**, **`!liem`**, **`!volay`**, **`!giet`**", 
        inline=False
    )
    
    embed.add_field(
        name="3. Tình Cảm & Thân Thiện (Bắt buộc tag @user)", 
        value="`!om`, `!hon`, `!honma`, `!hongio`, `!xoadau`, `!nung`, `!be`, `!dutan`, `!namtay`, `!battay`, `!goidui`, `!eptuong`, `!daptay`", 
        inline=False
    )
    
    embed.add_field(
        name="4. Linh Hoạt (Tag @user hoặc không đều được)", 
        value="`!nhin`, `!khoc`, `!tucgian`, `!votay`, `!like`, `!canloi`", 
        inline=False
    )
    
    embed.add_field(
        name="5. Tự Biểu Cảm (Không cần tag)", 
        value=(
            "**Cảm xúc:** `!vui`, `!chan`, `!soc`, `!suynghi`, `!domat`, `!boiroi`\n"
            "**Hành động:** `!latban`, `!nhay`, `!dac_y`, `!cuoimim`, `!cuoi`, `!cuoihihi`, `!uongtra`, `!nhai`, `!chay`, `!chaonghiem`, `!lac`, `!nhunvai`, `!gatdau`, `!xoay`, `!nhaymat`, `!vaytay`, `!vayduoi`, `!ngap`, `!tuchoi`, `!nup`, `!dingu`, `!meomeo`"
        ), 
        inline=False
    )
    
    # Đã đổi interaction.user thành ctx.author để tương thích với Hybrid Command
    embed.set_footer(
        text=f"Kẻ đang tham khảo bí kíp: {ctx.author.display_name}", 
        icon_url=ctx.author.avatar.url if ctx.author.avatar else None
    )
    
    # Gửi tin nhắn phản hồi
    await ctx.send(embed=embed)

# ================= SỰ KIỆN GỘP (CHỐNG LỖI ĐÈ HÀM) =================

mention_counts = {}

@bot.event
async def on_message(message):
    
    # ================= BẮT ĐẦU: HỘ TÔNG ĐẠI TRẬN (AUTO BAN SPAM) =================

    if message.author.bot or message.guild is None: # Thêm check guild để bỏ qua tin nhắn DM
        return

    # Kiểm tra cấm chat Diện Bích tại Ngũ Chỉ Sơn
    if message.guild.id == NGU_CHI_SON_GUILD_ID:
        has_dien_bich = any(r.name == ROLE_DIEN_BICH for r in message.author.roles)
        if has_dien_bich and message.channel.id != NGU_CHI_SON_CHANNEL_ID:
            try:
                await message.delete()
                try:
                    await message.author.send(
                        f"Đạo hữu đang bị phạt Diện Bích bế quan tại Ngũ Chỉ Sơn (<#{NGU_CHI_SON_CHANNEL_ID}>) của server **{message.guild.name}**, không được phép ngôn luận tại các kênh khác!"
                    )
                except discord.Forbidden:
                    pass  # Bỏ qua nếu người dùng khóa DM
            except Exception as e:
                print(f"Lỗi khi chặn tin nhắn Diện Bích: {e}")
            return
    
    # ================= BẮT ĐẦU: HỘ TÔNG ĐẠI TRẬN =================
    user_id = message.author.id
    now = time.time()
    guild_id = message.guild.id # Lấy ID của Server hiện tại
    
    # 1. Dọn dẹp bộ nhớ: Lấy mốc thời gian lớn nhất giữa TIME_WINDOW và SUSPICION_WINDOW
    max_window = max(TIME_WINDOW, SUSPICION_WINDOW)
    spam_tracker[user_id] = [m for m in spam_tracker[user_id] if now - m['time'] <= max_window]
    
    # 2. Tạo chữ ký tin nhắn
    content_signature = message.content
    if message.attachments:
        content_signature += "".join([a.filename for a in message.attachments])
        
    if content_signature.strip() == "":
        return
        
    # Lưu vết tin nhắn
    spam_tracker[user_id].append({'content': content_signature, 'channel_id': message.channel.id, 'time': now})
    
    # ----------------------------------------------------------------
    # TẦNG 1: AUTO-BAN (Rải CÙNG MỘT nội dung trên nhiều kênh)
    # ----------------------------------------------------------------
    channels_with_same_msg = set()
    for m in spam_tracker[user_id]:
        if m['content'] == content_signature:
            channels_with_same_msg.add(m['channel_id'])
            
    if len(channels_with_same_msg) >= SPAM_THRESHOLD:
        try:
            # KIỂM TRA THÂN PHẬN (Tránh bot đánh nhầm hoặc báo lỗi thiếu quyền)
            is_immune = False
            
            # 1. Là Tông chủ (Owner)
            if message.guild.owner_id == user_id:
                is_immune = True
            # 2. Có role cao hơn hoặc bằng Bot (Bot không thể ban)
            elif message.author.top_role >= message.guild.me.top_role:
                is_immune = True
            # 3. Là Trưởng lão (Có quyền Administrator)
            elif message.author.guild_permissions.administrator:
                is_immune = True

            report_channel = bot.get_channel(REPORT_CHANNELS.get(guild_id))

            if is_immune:
                # XỬ LÝ DÀNH CHO VIP BỊ HACK (Không ban được)
                if report_channel:
                    embed = discord.Embed(
                        title="🆘 BÁO ĐỘNG ĐỎ - ĐẠI NĂNG BỊ ĐOẠT XÁ 🆘",
                        description=f"**CẢNH BÁO:** Thân xác của đại năng {message.author.mention} có dấu hiệu bị đoạt xá đang rải link độc/spam!\n"
                                    f"Do người này có chức vụ cao/quyền quản trị, bản chấp pháp **KHÔNG THỂ** xử lý!",
                        color=discord.Color.dark_red()
                    )
                    embed.add_field(name="Hành vi", value=f"Spam cùng 1 nội dung trên {len(channels_with_same_msg)} kênh.", inline=False)
                    spam_content = message.clean_content[:1000] if message.content else "[Chỉ chứa hình ảnh/tệp tin]"
                    embed.add_field(name="Nội dung rác", value=f"```{spam_content}```", inline=False)
                    embed.set_footer(text="Yêu cầu Tông chủ hoặc các Trưởng lão khác can thiệp thủ công!")
                    
                    await report_channel.send(content="<@665146360063852554> Yêu cầu Tông chủ ra tọa trấn!!!", embed=embed)
            else:
                # XỬ LÝ ĐỆ TỬ BÌNH THƯỜNG (Ban thẳng tay)
                reason = f"Hệ thống tự động: Rải spam cùng 1 nội dung trên {len(channels_with_same_msg)} kênh."
                await message.author.ban(reason=reason, delete_message_seconds=3600)
                purge_tasks = []
                for channel_id in channels_with_same_msg:
                    channel = bot.get_channel(channel_id)
                    if channel:
                        # Gom các chiêu thức lại
                        task = channel.purge(limit=12, check=lambda m: m.author.id == user_id)
                        purge_tasks.append(task)
                if purge_tasks:
                    try:
                        await asyncio.gather(*purge_tasks, return_exceptions=True)
                    except Exception as e:
                        print(f"Lỗi khi dọn dẹp tàn dư: {e}")
                
                # Thông báo lên kênh báo cáo
                if report_channel:
                    embed = discord.Embed(
                        title="🚨 HỘ TÔNG ĐẠI TRẬN - KÍCH HOẠT",
                        description=f"Đã tự động **PHONG SÁT** (Ban) vĩnh viễn {message.author.mention}.",
                        color=discord.Color.red()
                    )
                    embed.add_field(name="Tội trạng", value=f"Nghi ngờ bị tà tu *đoạt xá*. Dám cả gan phá hoại tông môn.", inline=False)
                    spam_content = message.clean_content[:1000] if message.content else "[Chỉ chứa hình ảnh/tệp tin]"
                    embed.add_field(name="Nội dung rác", value=f"```{spam_content}```", inline=False)
                    
                    await report_channel.send(embed=embed)
            
            spam_tracker[user_id] = [] # Reset sau khi xử lý
            return # Dừng xử lý
            
        except discord.Forbidden:
            print(f"Không đủ quyền hạn để ban {message.author}.")
        except Exception as e:
            print(f"Lỗi hệ thống chống spam Tầng 1: {e}")

    # ----------------------------------------------------------------
    # TẦNG 2: CẢNH BÁO
    # ----------------------------------------------------------------
    # Lọc ra các tin nhắn chỉ trong vòng 8 giây qua
    recent_8s_msgs = [m for m in spam_tracker[user_id] if now - m['time'] <= SUSPICION_WINDOW]
    
    if len(recent_8s_msgs) >= SUSPICION_LIMIT:
        # Đếm số kênh ĐỘC LẬP trong 8 giây này
        recent_channels = set(m['channel_id'] for m in recent_8s_msgs)
        
        if len(recent_channels) >= SUSPICION_LIMIT:
            try:
                # --- ĐÃ SỬA: CHỈ GỬI BÁO CÁO VÀO KÊNH CỦA SERVER TƯƠNG ỨNG ---
                if guild_id in REPORT_CHANNELS:
                    report_channel = bot.get_channel(REPORT_CHANNELS[guild_id])
                    if report_channel:
                        embed = discord.Embed(
                            title="⚠️ HỘ TÔNG ĐẠI TRẬN - CẢNH BÁO ĐÁNG NGHI",
                            description=f"Phát hiện dấu hiệu spam bất thường từ {message.author.mention}.",
                            color=discord.Color.yellow()
                        )
                        embed.add_field(name="Hành vi", value=f"Gửi **{len(recent_8s_msgs)} tin nhắn** trên **{len(recent_channels)} kênh khác nhau** chỉ trong vòng **{SUSPICION_WINDOW} giây**.", inline=False)
                        
                        sample_content = message.clean_content[:1000] if message.content else "[Chỉ chứa hình ảnh/tệp tin]"
                        embed.add_field(name="Tin nhắn mẫu gần nhất", value=f"```{sample_content}```", inline=False)
                        
                        await report_channel.send(embed=embed)
                
                # Xóa lịch sử 8s của user này để bot không bị "kẹt"
                spam_tracker[user_id] = [m for m in spam_tracker[user_id] if now - m['time'] > SUSPICION_WINDOW]
                
            except Exception as e:
                print(f"Lỗi hệ thống chống spam Tầng 2: {e}")
    # ================= KẾT THÚC: HỘ TÔNG ĐẠI TRẬN =================
    


    content = message.content.lower()


    if "!masoi" in content or "!ma_soi" in content:
        embed = discord.Embed(
            description="Ma sói đã chết 💀\n*Cát về với cát, bụi về với bụi...*\nThắp 1 nén nhang tiễn đưa 1 huyền thoại! 🙏", 
            color=discord.Color.dark_grey()
        )
        embed.set_thumbnail(url=get_nhang_gif())  # FIX: set_thumbnail thay vì set_image
        
        # Đã đổi từ message.channel.send sang message.reply
        await message.reply(embed=embed)

    # 2. TRẢ LỜI KHI BỊ TAG (Chỉ chạy khi KHÔNG phải là lệnh)
    if bot.user in message.mentions and not message.content.startswith(PREFIX):
        gemini_cog = bot.get_cog("Gemini")
        
        is_immune = False
        if message.author.id == MASTER_ID:
            is_immune = True
        elif message.guild and message.author.top_role > message.guild.me.top_role:
            is_immune = True

        if gemini_cog and (is_immune or message.channel.id == FREE_CHANNEL_ID or gemini_cog.is_authorized(message.author.id)):
            async with message.channel.typing():
                image_parts = await gemini_cog.extract_images(message)
                
                clean_prompt, mentioned_users = gemini_cog.clean_prompt_mentions(
                    message.content, message.mentions, bot.user
                )
                if not clean_prompt and not image_parts:
                    await message.reply("Ngươi gọi Bản tọa mà không hỏi câu nào? Rảnh rỗi quá sao?")
                else:
                    if not clean_prompt and image_parts:
                        clean_prompt = "Hãy nhìn hình ảnh này."
                    response = await gemini_cog.call_gemini_api(clean_prompt, message.author, mentions=mentioned_users, image_parts=image_parts, channel_id=message.channel.id, trigger_msg=message)
                    await gemini_cog.process_and_reply(message, response, message.author)
            return

        if message.author.id == MASTER_ID:
            await message.reply("Kẻ nào to gan dám gọi Bản tọa? Có việc gì mau tấu lên, không có thì bấm nút biến!")
        else:
            user_id = message.author.id
            member = message.author
            now = discord.utils.utcnow()
            
            if user_id in mention_counts:
                last_time = mention_counts[user_id]['last_time']
                if (now - last_time).total_seconds() <= 300:
                    mention_counts[user_id]['count'] += 1
                else:
                    mention_counts[user_id]['count'] = 1
            else:
                mention_counts[user_id] = {'count': 1}
            
            mention_counts[user_id]['last_time'] = now
            count = mention_counts[user_id]['count']

            if count == 1:
                await message.reply("Kẻ nào to gan dám gọi Bản tọa? Có việc gì mau tấu lên, không có thì lui ra!")
            elif count == 2:
                await message.reply(f"{member.mention} Bản tọa đã nhớ tên ngươi, đừng chọc giận Bản tọa!")
            elif count == 3:
                await message.reply(f"{member.mention} Rượu mời không uống muốn uống rượu phạt? Ngươi đang chạm vào vảy ngược của Bản tọa rồi đấy, thử gọi thêm lần nữa xem!")
            elif count >= 4:
                try:
                    duration = datetime.timedelta(seconds=60)
                    until = discord.utils.utcnow() + duration
                    await member.timeout(until, reason="Dám chọc giận Bản tọa")
                    
                    await message.reply(f"Hỗn xược! **{member.display_name}** dám năm lần bảy lượt quấy nhiễu, nay ban cho hình phạt Bế Quan Tỏa Cảng 60 giây!")
                    mention_counts[user_id]['count'] = 0 
                except discord.Forbidden:
                    await message.reply("Hừ, coi như mạng ngươi lớn.")

    await bot.process_commands(message)


# ================= XỬ LÝ LỖI =================
@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        role_name = ctx.author.top_role.name
        if role_name == "@everyone":
            role_name = "Tạp Dịch"
            
        command_name = ctx.invoked_with 
        await ctx.send(f"Ngươi chỉ mang thân phận **{role_name}** nhỏ nhoi, làm gì có tư cách sử dụng lệnh `{ctx.prefix}{command_name}`!")
        
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send("Ngu ngốc! Xuất chiêu mà không nhắm vào ai thì định đánh vào hư không à? (Thiếu mục tiêu hoặc tham số cần thiết!)")
bot.run(TOKEN)