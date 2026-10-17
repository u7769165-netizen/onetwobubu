# 游玩帧率优化：稳定 60 FPS 计划

## Context

用户反馈游玩可能卡顿，要求优化到标准游玩场景稳定 ≥60 FPS，且不明显牺牲画质。调研（Explore + 逐文件核实）确认现状：

- 主循环 [game.js L521-540](file:///d:/onetwobubu/game.js#L521-L540)：rAF + 固定步长；**菜单/暂停时仍每帧全量 render**（最大浪费）；`while (acc >= STEP)` 无步数上限，后台恢复瞬间会连跑多次 tick
- 渲染 [render.js](file:///d:/onetwobubu/render.js)：天空渐变已缓存（L25）、瓦片已有视口裁剪（L113）——无需重复优化；但远山/近丘每帧 2 次全宽大路径 fill（L86-99，8px 步长 ×320 点）；iPhone DPR=2 时画布 2560×800，移动端光栅化压力大
- GC 压力：`solidSet.has(s.x + ',' + (s.y - TILE))` 每帧为每个可见瓦片分配新字符串（[render.js L119](file:///d:/onetwobubu/render.js#L119)）
- 已排除：HUD 已有 diff 更新（ui.js L488）、musicTick 非 play 已停、persistSave 仅事件调用

## 实施方案（按优先级）

### P0 空闲跳帧 — game.js `loop()`
- `paused` 或 `screenMode !== 'play'` 时跳过 `render()`（画布保留最后一帧；暂停菜单/标题是 DOM 半透明层，底下正是冻结画面，视觉不变）
- `won` 状态仍需渲染（通关动画）；恢复游戏 / resize / `fitViewport` 重设画布后强制补渲一帧（新增 `needRender` 标志）
- 联机主机/客机分支同样受门控

### P1 tick 步数上限 — game.js `loop()`
- `while` 循环最多执行 5 步，超出丢弃 `acc`（防后台恢复 tick 风暴，dt 已 clamp 0.1s）

### P2 自适应 DPR — game.js（主循环附近新增监控）
- 帧时间 EMA（α≈0.05）：持续 >19ms → DPR 降到 1.5；持续 <13ms 且当前 1.5 → 回 2
- 切换时重设 `canvas.width/height` 与 ctx transform（复用 ui.js `fitViewport` 的既有重设逻辑，提取为可调用路径）
- 40px 瓦片在 DPR1.5 下视觉差异极小，满足"不明显牺牲画质"

### P3 solidSet 数值键 — game.js + render.js
- 建键/查键由 `"x,y"` 字符串改为数值 `x * 4096 + y`（坐标均为 TILE 倍数、界内，安全）
- 改动点：game.js `loadLevel` 建 Set 处、render.js L119 查询处；消除每帧数百次字符串分配

### P4 山丘步长微调 — render.js `hills()`
- 采样步长 8 → 12px（路径点数 -33%，正弦轮廓视觉无差）

## 不改的（已确认无需优化）
天空渐变缓存、瓦片视口裁剪、HUD diff 更新、musicTick 门控、drawPlayer（角色数量仅 2，arc 开销可控）

## 验证

1. **新增 `tests/cdp_perf_test.js`**（CDP headless，风格对齐 cdp_touch_test）：
   - game.js 顶层加 `perfStats = { renders, ticks }` 计数器（供测试与诊断）
   - 断言：游玩中 renders 持续增长；暂停 2s 后 renders 不增；恢复后立即补渲；菜单页不渲染；模拟 `acc=0.1` 单帧 tick ≤5 步；DPR 降级/回升函数手动触发后画布尺寸正确；无 JS 异常
2. 守护链全量：`node _extract_globals.js` → `npx eslint .` → 单跑 perf/touch/audio 三测试 → `npm test` 20 脚本回归 → 两笔提交（feat + chore 截图）→ RL1 → APK 重打包 + zip 抽查
3. 真机：iPhone Safari 游玩观察流畅度（Safari 开发菜单或体感），确认暂停/菜单不再发热

## 风险与回滚
- P0 若发现某界面依赖后台渲染（如封面动效）→ 该界面白名单放行
- P2 若 1.5 被嫌糊 → 阈值收紧或只保留 P0/P1/P3（预计 P0+P1 已解决大部分卡顿与耗电）
