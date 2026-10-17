# 手机浏览器打开链接即玩 · 实施计划

## Context（背景与目标）

用户要求提供可通过手机浏览器访问的游戏链接，打开即玩，并满足：①主流手机浏览器兼容（Chrome/Safari/Firefox）②响应式适配③加载快④触屏操作指引直观⑤移动网络稳定。

勘察结论：项目已具备相当基础——PointerEvent 多指虚拟按键、竖屏 rotateHint、safe-area 适配、WS 指数退避重连（net.js）、服务端 2s ping 心跳、sw.js 网络优先写穿缓存、PWA manifest、隧道 bat 生成 https 链接。**真正缺口**：无扫码即开入口、静态服务无 gzip、触屏首启无引导、弱网无自适应、iOS 地址栏 100vh 偏差、小横屏视口溢出。本计划补齐这六项。

关键事实（已核实）：
- CSP `script-src 'self'` 禁内联脚本；`style-src 'self' 'unsafe-inline'` 允许内联 style 属性（server-auth.js L113-117）
- 快照率 `net.rate` 仅主机消费（net.js L146），客机侧设置无效 → 弱网自适应必须"客机发建议、主机执行"
- 服务器 handleMsg 对未知 `t` 原样透传 → 新增 `adv` 消息零改 server.js
- toast 复用 `authToast()`（auth.js L49-60）
- 首屏大头：preload.js 4 张角色图 ≈1.58MB（本轮不动，见风险节）

## 实施步骤（6 个提交，按序）

### C1 加载提速：gzip + 缓存策略
- `server.js` 静态段（L27-57）：`require('zlib')`；`.html/.js/.css/.webmanifest/.json/.svg/.txt` 且请求带 `Accept-Encoding: gzip` 时返回 gzip；`gzipCache = Map(path → {sig: size+'-'+mtimeMs, buf})`，mtime 变即重压；响应头 `Content-Encoding: gzip` + 覆盖 `Content-Length` + **`Vary: Accept-Encoding`**（SW 写穿缓存按 Vary 分桶，防污染）；无 gzip 头走原流式路径。
- 代码类维持 `no-cache`（改代码后手机立即拿新版，规避旧缓存风险）；图片/音频维持 86400 长缓存。
- `sw.js`：`CACHE` bump 至 `owb-pwa-v3` 整体换桶。

### C2 局域网二维码：/qr 扫码即开
- 新增 `qr.js`（~200 行零依赖）：UTF-8 Byte 模式、EC-M、Version 1-10 自适应、RS 纠错、掩码罚分选优；`qrEncode(text)` + `qrToSvg()`；页面装配段用 `location.origin`（或 `?u=` 覆盖）生成——经隧道打开 /qr 时二维码自动是公网地址，一码两用。
- 新增 `qr.html`：静态结构 + `<script src="qr.js">`，无内联事件；同时显示文本地址兜底。
- 新增 `tests/unit_qr.js`：`vm.runInNewContext` 加载 qr.js，断言 RS 余式为 0、定位/定时图形坐标、确定性、版本容量边界。
- 改动：`server.js` 启动日志追加 `/qr` 入口提示；`style.css` 加 `.qr-*` 小节；`sw.js` CORE 增 qr.html/qr.js；`deploy/make_www.js` FILES 增两项；`eslint.config.js` 仿 sw.js 给 qr.js 单开 block（**不进** _extract_globals BROWSER_FILES，独立页面独立作用域）。

### C3 隧道 bat 文案
- `deploy/启动互联网隧道.bat`：echo 突出「手机浏览器直接打开 https://xxx.trycloudflare.com 即玩，无需安装」「APK 填 wss://…/ws」「PC 打开同链接访问 /qr 可扫码」。

### C4 弱网自适应（仅改 net.js + 测试）
- `netConnect` 记录 `net.rateManual`；新增 `applyNetRate(hz, src)`（设 rate + 同步 #netRate 下拉 + authToast 提示）与 `netAdaptSample(now)`（挂在现有 2s ping 分支 L164/L278，不新增定时器）。
- 迟滞防抖：RTT(=net.ping*2) >300ms 连续 3 样本 → 主机降 10Hz / 客机发 `{t:'adv',hz:10}`；<180ms 连续 10 样本 → 恢复 rateManual；15s 最小调整间隔；手动下拉优先。
- `netOnMsg` 加 `case 'adv'`（仅主机执行）；`netReset` 清状态。
- 测试：扩展 `tests/cdp_net_test.js`——注入伪造 net.ping 驱动 netAdaptSample，断言 adv 收发、rate 同步、防抖窗。

### C5 触屏首启引导层
- `index.html`：#touchLayer 内追加 `#touchGuide.hidden`（遮罩 + 4 个键位标注 .tg-item：◀▶移动/⬆跳跃/⏸暂停/🔄换角色 + 「点击任意处开始」）。
- `style.css`：引导层样式复用 .tpad 同一套 safe-area 定位公式；**显式补 `#touchGuide.hidden{display:none}`**（吸取 .hidden 缺规则教训）；`@media (max-height:420px)` 压缩。
- `game.js`：`maybeShowTouchGuide()`（coarse 触屏 + play 界面 + localStorage 未标记时显示）/`dismissTouchGuide()`（写标记、首击不穿透触发开始）；initTouchLayer 末尾绑定点击关闭。`ui.js` showScreen 切 play 后调用。联机模式隐藏换角色标注（updateTouchMode 内 toggle）。
- 测试：`cdp_touch_test.js` 清档段预置 localStorage 标记（防真实触摸段被拦截）+ 新断言（弹出/关闭/不再弹/off 模式不弹）。重跑 `npm run globals`（+2 名）。

### C6 兼容与响应式收口
- `style.css`：`100vh` 公式处（body、#wrap、body.touch #wrap）追加 `100dvh` 双声明回退（iOS Safari 15.4+/Chrome 108+/Firefox 101+ 支持，旧版落回）；滚动容器（.lv-grid/.help-body/.au-panel/.map-list）显式 `touch-action: pan-y`（Firefox 忽略 user-scalable=no 的兜底）；新增 `@media (max-height:420px)` 小横屏段：.screen 改 flex-start+overflow-y:auto 防居中溢出顶裁切，标题/菜单压缩。
- 新增 `tests/cdp_mobile_audit.js`：4 视口（640×360/844×390/360×640/1080×2400）×逐 .screen 断言无溢出/按钮在视口内/无 JS 异常，截图存 tests/。

## 验证

- 每步守护链：前端改动 → `node _extract_globals.js` → `npx eslint .` → `tests\_restart_server.ps1 -RateLimit 0` → `npm test`（18→20 脚本）→ 测完恢复 `-RateLimit 1`。
- gzip：`curl -H "Accept-Encoding: gzip" -sI http://127.0.0.1:8765/game.js` 看 Content-Encoding/Vary。
- QR：unit_qr 性质断言 + 真机扫码（Android Chrome / iOS 相机）。
- 端到端：隧道起公网链接 → 手机 Chrome/Safari/Firefox 打开 → 首屏引导 → 单人玩 → 联机弱网 toast 观察。
- 前端定稿后重打 APK：`deploy\build_apk.ps1` + 解包校验新文件（qr.html/qr.js 入 make_www 清单）。

## 提交切分与惯例

C1→C2(含C3)→C4→C5→C6，每笔源码 + 回归截图产物分两笔（既有惯例）；git 用 `-c user.name="onetwobubu-dev" -c user.email="dev@localhost"`。

## 风险与缓解

1. **QR 编码正确性**：单测性质断言 + 真机双端扫码 + 页面文本地址兜底。
2. **手机旧缓存**：代码类保持 no-cache；gzipCache 按 mtime 失效；SW 换桶 v3；Vary 必带。
3. **降频抖动**：300/180 双阈值 + 3/10 样本进出 + 15s 间隔；实测仍抖再调宽死区。
4. **引导层拦截测试**：cdp_touch_test 预置标记，同提交内完成。
5. **首屏 1.58MB 图片**：本轮不动（降采样会破坏 sprites.js 抠图阈值，需另立任务验证）；gzip+隧道下 JS/CSS 传输 ~250KB→~70KB 已显著提速。

## 关键文件

server.js、net.js、game.js、ui.js、style.css、index.html、sw.js、qr.js(新)、qr.html(新)、tests/unit_qr.js(新)、tests/cdp_mobile_audit.js(新)、tests/cdp_net_test.js、tests/cdp_touch_test.js、deploy/make_www.js、deploy/启动互联网隧道.bat、eslint.config.js
