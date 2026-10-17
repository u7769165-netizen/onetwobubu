# 触屏横屏无黑边全屏 · 实施计划

## Context（背景与目标）

用户反馈 iPhone Safari 画面太小。上一提交（914721d）已通过隐藏按钮行+HUD 悬浮把画布从 171→419px 宽，但 iPhone 横屏视口比例 ~2.16:1 与游戏固定 16:10 逻辑分辨率不符，左右仍有黑边。本计划实现：**触屏横屏游玩时画面铺满整屏、无黑边、不拉伸**，虚拟按键悬浮在游戏画面上（已具备按下反馈/尺寸/透明度）。桌面与竖屏行为完全不变。

已核实关键事实（Explore+Plan 评审确认）：
- `ui.js` L421-427：`const LOGICAL_W=640, LOGICAL_H=400`，canvas 缓冲=逻辑×DPR(2)，`ctx.setTransform(DPR,…)`；canvas 赋值 width 会清 transform，必须重做
- **全部 40 个子关恒为 48 列×10 行 = 1536×320px**——LOGICAL_W 上限 1280 < 1536，任何关卡都够铺满，不存在露出地图外天空的问题
- 项目当前**没有任何 resize/orientationchange 监听**，本计划新增
- **联机相机主机权威**：net.js L194 快照携带 `cam: camX`，客机 L307 直接插值覆盖，客机本地 cameraTarget 联机中不执行 → 主机 640/客机 866 时客机右缘会越界 226px，需修
- 渲染层对 LOGICAL_W 的引用几乎全用变量（剪裁/居中/取模自适应）；仅 drawBackground 三处硬编码：月亮 548（L36-40）、ember 320（L57）、sun 540
- #wrap `aspect-ratio:16/10`、canvas CSS 100%×100%；#touchLayer/.tpad/#touchGuide 全 fixed 独立于 #wrap；#overlay/#subTrans/#netBar 在 #wrap 内 absolute inset:0，随 wrap 全屏
- tests 无 canvas 缓冲区断言；cdp_full_qa G 段为精指针桌面（fitViewport 恒 640 不受影响）；audit 不进 play
- www/ 是 APK 独立拷贝，dev 服务器服务根目录

## 设计核心

1. **可变逻辑视口**：`fitViewport()` —— 门控条件与 CSS 逐字等价：`matchMedia('(pointer:coarse)') && matchMedia('(orientation:landscape)') && body.classList.contains('touch') && body.classList.contains('play')`。满足时 `LOGICAL_W = clamp(round(400 * innerWidth/innerHeight), 640, 1280)`，否则 640。变化时重设 `canvas.width/height` + `setTransform(DPR…)` + imageSmoothing。滞回：|next−当前|<2 且两端都非 640 时跳过（防 iOS 地址栏动画抖动）。
2. **无拉伸 CSS（含 iPad 4:3）**：#wrap 全屏容器 + canvas `width:auto;height:auto;max-width:100%;max-height:100%`（替换元素固有比例=contain 效果）。手机比例≥1.6 铺满无黑边；iPad 钳 640 后上下留 #bfe9ff 天空色条（数学上唯一不拉伸不裁切的选择，LOGICAL_H 不动——地图高仅 320，H 变会露底/裁月亮）。
3. **联机相机重映射**：快照加 `vw: LOGICAL_W`；客机按「主机视口中心 → 本端视口中心」重映射 camX 并 clamp 到本端 [0, cols*TILE−LOGICAL_W]；`vw||640` 兼容旧客户端。
4. **调用点**：定义在 ui.js（L428 后，遵守"顶层只声明"惯例的例外——canvas 初始化段本就在此）；`showScreen` 末尾、`applyTouchVisibility` 末尾各调 `fitViewport()`；监听注册（resize/orientationchange/visualViewport.resize → 150ms 防抖 `scheduleFit`）放 game.js 启动段。

## 实施步骤（2 笔源码提交）

### F1 离线全屏闭环（ui.js + style.css + render.js + mechanics.js + game.js + 测试）
- `ui.js`：`const LOGICAL_W`→`let`；新增 `fitViewport()`/`scheduleFit()`；`showScreen` 末尾调 fitViewport
- `style.css` L369 后新增块：`@media (pointer: coarse) and (orientation: landscape) { body.touch.play { padding-bottom:0 } body.touch.play #wrap { width:100vw; height:100vh; height:100dvh; aspect-ratio:auto; border-radius:0; box-shadow:none; display:flex; align-items:center; justify-content:center } body.touch.play #wrap canvas { width:auto; height:auto; max-width:100%; max-height:100% } }`（同选择器靠后覆盖旧宽度公式）
- `render.js` drawBackground：月亮 548→`W-92`、538→`W-102`；ember 320→`W/2`；sun 540→`W-100`（640 视口下数值不变，桌面零影响）
- `mechanics.js` cameraTarget：开头加防御 `const mapW = cols*TILE; if (mapW <= LOGICAL_W) return (mapW - LOGICAL_W)/2;`（当前关卡用不到，防未来小关卡）
- `game.js`：`applyTouchVisibility` 末尾调 fitViewport；启动段注册三路 resize 监听→scheduleFit
- 测试 `cdp_touch_test.js` A12 重写：844×390 coarse 横屏 play 下断言 wrap rect≈844×390、`canvas.width===866*2`、`canvas.height===800`、`ctx.getTransform().a===2`、canvas CSS 无拉伸（rect 宽高比≈buffer 比）、回 title 后 `LOGICAL_W===640`；新截图 touch_play_fullscreen.png
- 守护链：`node _extract_globals.js`（+2 名 fitViewport/scheduleFit）→ `npx eslint .` → `_restart_server.ps1 -RateLimit 0` → 单跑 cdp_touch_test → 全量 `npm test` 20/20 → 恢复 `-RateLimit 1`
- 提交：源码一笔 + 截图产物一笔（既有惯例）

### F2 联机视口同步（net.js + 测试）
- `net.js` L194 快照加 `vw: LOGICAL_W`；`guestFrame` L307 改中心重映射+本端 clamp
- `cdp_coop_test.js` 增断言：伪造双视口（主机 640/客机 866）快照下客机 camX 不越界 [0, 1536−866]
- 回归 + 提交一笔

### F3 真机验证与 APK
- 隧道链接真机 iPhone Safari 横屏实测（无黑边、按键悬浮、引导层正常）
- `npx cap copy android` + `deploy\build_apk.ps1` 重打 APK

## 风险与缓解

1. **JS/CSS 门控不一致 → 拉伸**：fitViewport 条件与 @media 选择器逐字对齐，单一事实源为 body 两个 class + 两个 matchMedia；A12 断言 buffer 比≈CSS 比兜底。
2. **iOS 地址栏收放抖动**：150ms 防抖 + 滞回 <2px；dvh 实时响应。PWA 主屏启动无地址栏。
3. **低端机填充率**（866 缓冲 1732×800，+35%）：真机观察，掉帧再启用后备方案（LOGICAL_W>800 时 DPR 降 1.5），本轮不做。
4. **canvas.width 重设清状态**：transform 重做已覆盖；font/textAlign 每次绘制前显式设置；skyGrad 缓存不依赖视口宽，无需失效。
5. **旧客户端联机兼容**：`vw||640` 回退；F2 可独立回滚。

## 关键文件

ui.js、style.css、render.js、mechanics.js、game.js、net.js、tests/cdp_touch_test.js、tests/cdp_coop_test.js
