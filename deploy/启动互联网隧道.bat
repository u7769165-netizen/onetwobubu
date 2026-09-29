@echo off
rem 一二 & 布布 · 互联网联机隧道（cloudflared 快速隧道，免注册）
rem 前提：游戏服务器已在另一窗口运行（node server.js 或双击 启动游戏.bat）
cd /d %~dp0..
echo ============================================================
echo  正在建立互联网隧道…窗口内会出现形如
echo    https://xxxx.trycloudflare.com
echo  的公网地址。
echo.
echo  【手机浏览器直接打开该链接即可游玩，无需安装任何东西】
echo  把链接发给队友：Chrome / Safari / Firefox 打开即玩。
echo  电脑打开同链接后访问 /qr（如 https://xxxx…/qr）
echo  可显示二维码，手机相机扫一扫即开。
echo.
echo  用 APK 的队友在「双人联机-服务器地址」填
echo    wss://xxxx.trycloudflare.com/ws
echo  关闭本窗口即停止隧道。每次启动地址会变化。
echo ============================================================
"%~dp0cloudflared.exe" tunnel --url http://localhost:8765 --no-autoupdate
pause
