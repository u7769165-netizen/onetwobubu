/* 生成 12 关 48×10 横版卷轴关卡 + 落地模拟/跳跃可达性校验。
   跳跃参数：JUMP=660, GRAVITY=2400 → 峰值 85px（2.1 格），满速滞空水平位移 143px。
   危险条带统一 1 列：安全窗口约 95px ≥ 40+20=60px，容错 35px，轻松跑跳越过。
   设计纪律：坑宽 ≤ 2 列（或有平台）、台阶高差 ≤ 1 格、W/L/T 条带必须可跑跳越过。
   约定：地面在 row9；水池W/岩浆L/毒液T/出口X/机关 放在 row8（贴地一层）。 */
const COLS = 48, ROWS = 10, TILE = 40, PW = 24, PH = 38;
const JUMP = 660, GRAVITY = 2400, SPEED = 260, DT = 1 / 60;

function mk() { return Array.from({ length: ROWS }, () => Array(COLS).fill('.')); }
function ground(g, c0, c1) { for (let c = Math.max(1, c0); c <= Math.min(COLS - 2, c1); c++) g[9][c] = '#'; }
function step(g, row, c0, c1, ch = '#') { for (let c = c0; c <= c1; c++) g[row][c] = ch; }
function put(g, row, col, ch) { g[row][col] = ch; }
function gap(g, c0, c1) { for (let c = c0; c <= c1; c++) g[9][c] = '.'; }
function pool(g, c0, c1) { for (let c = c0; c <= c1; c++) g[8][c] = 'W'; }   // 贴水：布布要跳
function lava(g, c0, c1) { for (let c = c0; c <= c1; c++) g[8][c] = 'L'; }   // 贴岩浆：一二要跳
function border(g) { for (let r = 0; r < ROWS; r++) { g[r][0] = '#'; g[r][COLS - 1] = '#'; } for (let c = 0; c < COLS; c++) if (g[0][c] !== ' ') g[0][c] = '#'; return g; }
function hole(g, c0, c1) { for (let c = c0; c <= c1; c++) g[0][c] = ' '; }   // 顶部天窗：协作跳冲出地图顶不撞头
function toRows(g) { return g.map(r => r.join('')); }
function exitAt(g) { put(g, 8, 44, 'X'); put(g, 8, 45, 'X'); }

/* ================= 标准垂直层模块（第 6 关起统一使用，保证层间距一致） =================
   统一几何：地面层(row9 顶360) → 二层实心台(row5 顶200，间距4格) → 三层云台(row2 顶96，间距2.5格)。
   上二层：地面弹跳台 pad（双人协作跳水平位移≈4.2~8格，落点须在 seg 段内）；
   上三层：二层弹跳台 pad2（协作跳水平≈4.5~8.9格，落点须在 cloud 段内）；pad2 上方开顶部天窗。
   二层缺口 gap 列由移动平台 m 渡过；l2/l3 = [列, 字符] 放在二层面/云台面上（陷阱与奖励）。
   不传 cloud/pad2 时为两层结构（地面+二层），第 6~7 关及限时层用两层降低挫败。 */
function vert(g, o) {
  put(g, 8, o.pad, 'H');                                   // 地面协作弹跳台①
  step(g, 5, o.seg[0], o.seg[1]);                          // 二层A段（实心顶200）
  if (o.gap) { for (let c = o.gap[0]; c <= o.gap[1]; c++) g[5][c] = '.'; put(g, 5, o.m, 'm'); }  // 二层掉落缺口+移动平台
  step(g, 5, o.seg2[0], o.seg2[1]);                        // 二层B段
  if (o.cloud) {
    put(g, 5, o.pad2, 'H');                                // 二层协作弹跳台②
    for (let c = o.cloud[0]; c <= o.cloud[1]; c++) put(g, 2, c, '=');  // 三层悬空云台（顶96）
    hole(g, o.pad2 - 1, o.cloud[1] + 2);                   // 顶部天窗：覆盖台②与云台，防弹跳撞头
  }
  for (const [c, ch] of o.l2 || []) put(g, 4, c, ch);      // 二层陷阱/奖励（贴台面）
  for (const [c, ch] of o.l3 || []) put(g, 1, c, ch);      // 三层高级陷阱/稀有奖励
  for (const [r, c] of o.h || []) put(g, r, c, 'h');       // 爱心水晶（情侣道具）
}

const LEVELS = [];

// 1 青草地：教学（跳水/跳岩浆 + 1 级台阶）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w'); pool(g, 8, 8);
  step(g, 8, 13, 15);
  put(g, 8, 19, 'l'); lava(g, 20, 20);
  step(g, 8, 25, 27); put(g, 7, 26, '*');
  pool(g, 31, 31); lava(g, 35, 35);
  put(g, 8, 29, 'h');                                      // 爱心水晶
  exitAt(g);
  LEVELS.push({ name: '青草地', diff: 1, par: 35, rows: toRows(border(g)) }); }

// 2 捉迷藏：按钮开门 + 高台星星 + 虚影门
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 8, 9, 11); put(g, 7, 10, '*');
  pool(g, 14, 14); put(g, 8, 15, 'w'); put(g, 8, 16, 'd');
  put(g, 8, 19, 'e'); lava(g, 20, 20); put(g, 8, 21, 'l');
  put(g, 8, 27, '1'); step(g, 8, 30, 31, 'D'); step(g, 8, 32, 33, 'D');
  pool(g, 37, 37);
  put(g, 8, 24, 'h');                                      // 爱心水晶
  exitAt(g);
  LEVELS.push({ name: '捉迷藏', diff: 1, par: 45, rows: toRows(border(g)) }); }

// 3 熔岩洞：推箱压按钮 + 火焰 + 尖刺
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 8, 'C'); put(g, 8, 11, '1'); step(g, 8, 13, 14, 'D');
  put(g, 8, 17, 'f'); put(g, 8, 18, '^'); put(g, 8, 19, 'w');
  lava(g, 22, 22); put(g, 8, 23, 'l');
  put(g, 8, 27, 'F'); put(g, 8, 30, 'f');
  step(g, 8, 33, 35); put(g, 7, 34, '*');
  pool(g, 38, 38);
  put(g, 8, 25, 'h');                                      // 爱心水晶
  exitAt(g);
  LEVELS.push({ name: '熔岩洞', diff: 2, par: 60, rows: toRows(border(g)) }); }

// 4 黄昏雪原：冰桥打滑 + 史莱姆 + 属性池
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 9, 7, 13, '~'); put(g, 8, 9, 's'); put(g, 8, 12, 'w');
  lava(g, 16, 16); put(g, 8, 17, 'l');
  step(g, 9, 20, 27, '~'); put(g, 8, 22, 's'); put(g, 8, 25, 's');
  step(g, 8, 31, 33); put(g, 7, 32, '*');
  pool(g, 36, 36); put(g, 8, 40, 'd'); put(g, 8, 41, 'e');
  put(g, 8, 30, 'h');                                      // 爱心水晶
  exitAt(g);
  LEVELS.push({ name: '黄昏雪原', diff: 2, par: 65, rows: toRows(border(g)) }); }

// 5 星夜浮桥：深渊 + 移动平台渡河
{ const g = mk();
  ground(g, 1, 10);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w');
  gap(g, 11, 14); put(g, 8, 12, 'm');
  ground(g, 15, 24);
  lava(g, 18, 18); put(g, 8, 19, 'l');
  put(g, 8, 22, 's');
  gap(g, 25, 28); put(g, 8, 26, 'm');
  ground(g, 29, 46);
  step(g, 8, 32, 34); put(g, 7, 33, '*');
  gap(g, 37, 39); put(g, 8, 38, 'm');
  pool(g, 41, 41);
  put(g, 8, 31, 'h');                                      // 爱心水晶
  exitAt(g);
  LEVELS.push({ name: '星夜浮桥', diff: 3, par: 80, rows: toRows(border(g)) }); }

// 6 颠倒之厅：重力柱吸顶取星 + 三层垂直结构（重力柱置于二层台未覆盖的右侧列，吸顶路径不被 row5 挡住）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 8, 'w'); pool(g, 9, 9);
  lava(g, 18, 18); put(g, 8, 19, 'l');
  put(g, 8, 28, 's'); put(g, 8, 31, 'f');
  step(g, 8, 34, 36); put(g, 7, 35, 'g'); put(g, 6, 35, 'g'); put(g, 5, 35, 'g'); put(g, 4, 35, '*');
  step(g, 8, 39, 41); put(g, 7, 40, 'g'); put(g, 6, 40, 'g'); put(g, 5, 40, 'g'); put(g, 4, 40, '*');
  put(g, 8, 16, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[15, '*'], [17, 's'], [25, '^'], [26, 'l'], [29, '*']] });   // 两层：地面 + 二层
  exitAt(g);
  LEVELS.push({ name: '颠倒之厅', diff: 3, par: 95, rows: toRows(border(g)) }); }

// 7 冰火双子：三层垂直结构（左侧通道）+ Boss 竞技场（右侧开阔）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 21, 's');
  pool(g, 33, 33); put(g, 8, 32, 'w');
  lava(g, 36, 36); put(g, 8, 37, 'l');
  put(g, 8, 31, 'F');
  put(g, 7, 39, 'G');
  put(g, 8, 14, 'h');
  vert(g, { pad: 8, seg: [11, 17], gap: [18, 19], m: 18, seg2: [21, 26], pad2: 24, cloud: [27, 30],
    l2: [[13, '*'], [15, 's'], [23, '^'], [25, 'l']], l3: [[28, '*'], [29, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '冰火双子', diff: 4, par: 120, rows: toRows(border(g)) }); }

// 8 水晶矿脉：冰桥 + 尖刺 + 史莱姆 + 平台渡坑
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 9, 6, 11, '~'); put(g, 8, 8, 's');
  put(g, 8, 13, '^'); put(g, 8, 14, 'w');
  pool(g, 18, 18); put(g, 8, 17, '*');
  step(g, 9, 21, 27, '~'); put(g, 8, 23, 's'); put(g, 8, 26, 's');
  put(g, 8, 28, '^'); lava(g, 30, 30); put(g, 8, 31, 'l');
  gap(g, 34, 36); put(g, 8, 35, 'm');
  step(g, 8, 39, 41); put(g, 7, 40, '*');
  put(g, 8, 19, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '*'], [17, 's'], [25, '^'], [26, 'l'], [29, '*']], l3: [[33, '*'], [35, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '水晶矿脉', diff: 4, par: 110, rows: toRows(border(g)) }); }

// 9 烈焰回廊：虚影门分路 + 交错火焰计时跑
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'f'); put(g, 8, 8, 'w'); put(g, 8, 9, 'd');
  put(g, 8, 13, 'F'); put(g, 8, 15, 'f');
  put(g, 8, 18, 'e'); lava(g, 19, 19); put(g, 8, 20, 'F'); put(g, 8, 21, 'l');
  step(g, 8, 24, 26); put(g, 8, 25, 'f'); put(g, 7, 24, '*');
  put(g, 8, 30, 'f'); put(g, 8, 32, 'f'); put(g, 8, 34, 'f');
  pool(g, 38, 38); put(g, 8, 37, '*');
  put(g, 8, 12, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '^'], [17, '*'], [25, 's'], [26, 'w'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '烈焰回廊', diff: 4, par: 115, rows: toRows(border(g)) }); }

// 10 玄机回廊：史莱姆阵 + 冰桥 + 属性池 + 平台渡坑
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 's'); put(g, 8, 8, 'w');
  step(g, 9, 11, 16, '~'); put(g, 8, 13, 's'); put(g, 8, 15, 's');
  pool(g, 20, 20); put(g, 8, 19, '*');
  lava(g, 23, 23); put(g, 8, 24, 'l');
  put(g, 8, 27, 'f'); put(g, 8, 28, 's');
  gap(g, 31, 33); put(g, 8, 32, 'm');
  step(g, 9, 35, 40, '~'); put(g, 8, 37, 's'); put(g, 8, 39, '*');
  put(g, 8, 21, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, 's'], [17, '*'], [25, '^'], [26, 'l'], [29, 's']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '玄机回廊', diff: 4, par: 120, rows: toRows(border(g)) }); }

// 11 颠倒回廊：重力柱 + 毒液 + 火焰阵 + 虚影门
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 8, 7, 8); put(g, 7, 7, 'g'); put(g, 6, 7, 'g'); put(g, 5, 7, '*');
  put(g, 8, 12, 'w'); put(g, 8, 13, 'd'); put(g, 8, 14, 'f');
  put(g, 8, 17, 'T'); put(g, 8, 19, 'T');
  step(g, 8, 22, 23); put(g, 7, 22, 'g'); put(g, 6, 22, 'g'); put(g, 5, 22, '*');
  lava(g, 27, 27); put(g, 8, 28, 'l'); put(g, 8, 26, 'e');
  put(g, 8, 32, 'F'); put(g, 8, 34, 'f'); put(g, 8, 36, 'F');
  gap(g, 39, 40);
  put(g, 8, 15, 'h');
  vert(g, { pad: 10, seg: [13, 19], gap: [20, 21], m: 20, seg2: [23, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '^'], [17, '*'], [25, 's'], [26, 'w'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '颠倒回廊', diff: 5, par: 135, rows: toRows(border(g)) }); }

// 12 终极试炼：全机制 + Boss
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w'); put(g, 8, 8, 'd'); put(g, 8, 9, 'f');
  pool(g, 13, 13); put(g, 8, 12, '*');
  step(g, 9, 16, 20, '~'); put(g, 8, 18, 's');
  lava(g, 23, 23); put(g, 8, 24, 'l'); put(g, 8, 22, 'e'); put(g, 8, 25, 'F');
  put(g, 8, 28, '^'); put(g, 8, 30, 'T');
  gap(g, 32, 34); put(g, 8, 33, 'm');
  put(g, 8, 36, 's'); put(g, 8, 37, 'f');
  put(g, 7, 41, 'G');
  put(g, 8, 16, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '^'], [17, 's'], [25, '*'], [26, 'l'], [29, 's']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '终极试炼', diff: 5, par: 175, rows: toRows(border(g)) }); }

/* ================= 扩展包：5 大主关卡 · 13 子层级（多层级闯关机制） =================
   主关卡结构：每关 1~3 个子层级，逐层递进；高层级带每层时间限制（tls）。 */

// 13.1 双塔秘境·晶廊回环：冰桥史莱姆 + 推箱按钮 + 重力取星
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 9, 7, 12, '~'); put(g, 8, 8, 'w'); put(g, 8, 10, 's');
  step(g, 8, 15, 17); put(g, 7, 16, '*');
  pool(g, 20, 20);
  lava(g, 24, 24); put(g, 8, 25, 'l');
  put(g, 8, 28, 'C'); put(g, 8, 31, '1'); step(g, 8, 33, 34, 'D');
  put(g, 8, 38, 's');
  step(g, 8, 40, 41); put(g, 7, 40, 'g'); put(g, 6, 40, 'g'); put(g, 5, 40, '*');
  pool(g, 42, 42);
  put(g, 8, 21, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, 's'], [17, '*'], [24, '^'], [26, 'l'], [30, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '晶廊回环', diff: 4, par: 55, rows: toRows(border(g)) }); }

// 13.2 双塔秘境·晶核之心：虚影门分道 + 移动平台渡坑 + 火焰阵
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'f'); put(g, 8, 9, 'w'); put(g, 8, 10, 'd');
  put(g, 8, 13, '^'); put(g, 8, 15, 'F');
  put(g, 8, 18, 'e'); lava(g, 19, 19); put(g, 8, 20, 'l');
  gap(g, 23, 25); put(g, 8, 24, 'm');
  put(g, 8, 29, 'f'); put(g, 8, 31, 's');
  step(g, 8, 34, 36); put(g, 7, 35, '*');
  pool(g, 39, 39);
  put(g, 8, 27, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '^'], [17, '*'], [25, 's'], [26, 'w'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '晶核之心', diff: 4, par: 65, rows: toRows(border(g)) }); }

// 14.1 迷雾深渊·雾降层：属性池 + 推箱粉钮 + 史莱姆
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w'); pool(g, 8, 8);
  put(g, 8, 12, 's');
  put(g, 8, 15, 'C'); put(g, 8, 18, '2'); step(g, 8, 20, 21, 'E');
  put(g, 8, 24, 'l'); lava(g, 25, 25);
  pool(g, 29, 29); put(g, 8, 30, 'w');
  step(g, 8, 33, 35); put(g, 7, 34, '*');
  put(g, 8, 38, 's'); put(g, 8, 41, 'f');
  put(g, 8, 22, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, 's'], [17, '*'], [25, '^'], [26, 'w'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '雾降层', diff: 4, par: 50, rows: toRows(border(g)) }); }

// 14.2 迷雾深渊·渊中层：三连平台渡渊 + 火焰 + 重力星
{ const g = mk();
  ground(g, 1, 10);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B'); put(g, 8, 7, 'w');
  gap(g, 11, 13); put(g, 8, 12, 'm');
  ground(g, 14, 22);
  put(g, 8, 17, 'F'); lava(g, 20, 20); put(g, 8, 21, 'l');
  gap(g, 23, 25); put(g, 8, 24, 'm');
  ground(g, 26, 35);
  put(g, 8, 29, 's'); put(g, 8, 32, 'f');
  gap(g, 36, 38); put(g, 8, 37, 'm');
  ground(g, 39, 46);
  step(g, 8, 41, 43); put(g, 7, 42, 'g'); put(g, 6, 42, 'g'); put(g, 5, 42, '*');
  put(g, 8, 30, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '^'], [17, '*'], [25, 's'], [26, 'l'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '渊中层', diff: 4, par: 50, rows: toRows(border(g)) }); }

// 14.3 迷雾深渊·渊底：重力柱 + 毒液阵 + 虚影门
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 8, 7, 8); put(g, 7, 7, 'g'); put(g, 6, 7, 'g'); put(g, 5, 7, '*');
  put(g, 8, 12, 'w'); put(g, 8, 13, 'd'); put(g, 8, 14, '^');
  put(g, 8, 18, 'T'); put(g, 8, 21, 'T');
  put(g, 8, 24, 'e'); lava(g, 25, 25); put(g, 8, 26, 'l');
  put(g, 8, 30, 'F'); put(g, 8, 33, 's');
  pool(g, 37, 37);
  step(g, 8, 40, 41); put(g, 7, 40, '*');
  put(g, 8, 16, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '^'], [17, '*'], [25, 's'], [26, 'w'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  exitAt(g);
  LEVELS.push({ name: '渊底', diff: 4, par: 55, rows: toRows(border(g)) }); }

// 15.1 时之回廊·时钟齿轮（限时 55s）：火焰节奏跑 + 冰桥 + 推箱
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'f'); put(g, 8, 9, 'f'); put(g, 8, 11, 'f');
  step(g, 9, 14, 19, '~'); put(g, 8, 15, 'w'); put(g, 8, 17, 's');
  lava(g, 22, 22); put(g, 8, 23, 'l');
  put(g, 8, 26, 'F'); put(g, 8, 28, 'f'); put(g, 8, 30, 'F');
  put(g, 8, 33, 'C'); put(g, 8, 36, '2'); step(g, 8, 38, 39, 'E');
  step(g, 8, 40, 41); put(g, 7, 40, 'g'); put(g, 6, 40, 'g'); put(g, 5, 40, '*');
  pool(g, 42, 42);
  put(g, 8, 21, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[16, '*'], [18, 's'], [26, '^'], [28, 'l'], [30, '*']] });   // 限时层：两层结构
  exitAt(g);
  LEVELS.push({ name: '时钟齿轮', diff: 5, par: 65, rows: toRows(border(g)) }); }

// 15.2 时之回廊·时空裂隙（限时 50s）：平台渡渊 + 重力柱 + 虚影门
{ const g = mk();
  ground(g, 1, 10);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 8, 7, 8); put(g, 7, 7, 'g'); put(g, 6, 7, 'g'); put(g, 5, 7, '*');
  gap(g, 11, 13); put(g, 8, 12, 'm');
  ground(g, 14, 24);
  put(g, 8, 17, 'w'); pool(g, 18, 18);
  put(g, 8, 21, 'l'); lava(g, 22, 22);
  gap(g, 25, 27); put(g, 8, 26, 'm');
  ground(g, 28, 46);
  put(g, 8, 31, 's'); put(g, 8, 34, 'f');
  put(g, 8, 37, 'e'); put(g, 8, 38, 'd');
  put(g, 8, 41, '^');
  put(g, 8, 29, 'h');
  vert(g, { pad: 10, seg: [14, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[16, '*'], [18, 's'], [26, '^'], [28, 'l'], [30, '*']] });   // 限时层：两层结构
  exitAt(g);
  LEVELS.push({ name: '时空裂隙', diff: 5, par: 60, rows: toRows(border(g)) }); }

// 16.1 风暴穹顶·逆风阶地（限时 60s）：台阶尖刺 + 冰桥 + 推箱蓝钮
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  step(g, 8, 7, 9); put(g, 7, 8, '*');
  put(g, 8, 12, '^'); put(g, 8, 13, 'w');
  put(g, 8, 15, 's'); pool(g, 16, 16);
  put(g, 8, 19, 'l'); lava(g, 20, 20);
  step(g, 9, 23, 28, '~'); put(g, 8, 25, 's');
  put(g, 8, 31, 'f'); put(g, 8, 33, 'F'); put(g, 8, 35, 'f');
  put(g, 8, 38, 'C'); put(g, 8, 40, '1'); step(g, 8, 42, 43, 'D');
  put(g, 8, 18, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[16, '*'], [18, 's'], [26, '^'], [28, 'l'], [30, '*']] });   // 限时层：两层结构
  exitAt(g);
  LEVELS.push({ name: '逆风阶地', diff: 5, par: 65, rows: toRows(border(g)) }); }

// 16.2 风暴穹顶·雷暴云海（限时 55s）：四连平台跳 + 火焰 + 重力星
{ const g = mk();
  ground(g, 1, 8);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B'); put(g, 8, 6, 'w');
  gap(g, 9, 11); put(g, 8, 10, 'm');
  ground(g, 12, 16); put(g, 8, 14, 'F');
  gap(g, 17, 19); put(g, 8, 18, 'm');
  ground(g, 20, 26);
  put(g, 8, 22, 'l'); lava(g, 23, 23);
  gap(g, 27, 29); put(g, 8, 28, 'm');
  ground(g, 30, 46);
  put(g, 8, 33, 's'); put(g, 8, 36, 'f'); pool(g, 39, 39);
  step(g, 8, 41, 43); put(g, 7, 42, 'g'); put(g, 6, 42, 'g'); put(g, 5, 42, '*');
  put(g, 8, 31, 'h');
  vert(g, { pad: 7, seg: [10, 17], gap: [18, 19], m: 18, seg2: [21, 27],
    l2: [[14, 's'], [12, '*'], [23, '^'], [25, 'l'], [27, '*']] });   // 限时层：两层结构
  exitAt(g);
  LEVELS.push({ name: '雷暴云海', diff: 5, par: 65, rows: toRows(border(g)) }); }

// 16.3 风暴穹顶·穹顶之巅（限时 50s）：全机制高密度
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 's'); put(g, 8, 8, 'w');
  step(g, 9, 11, 16, '~'); put(g, 8, 13, 's'); put(g, 8, 15, '^');
  put(g, 8, 18, '*'); pool(g, 19, 19);
  lava(g, 22, 22); put(g, 8, 23, 'l');
  put(g, 8, 26, 'f'); put(g, 8, 28, 'T'); put(g, 8, 31, 'F');
  gap(g, 33, 35); put(g, 8, 34, 'm');
  step(g, 8, 38, 40); put(g, 7, 39, 'g'); put(g, 6, 39, 'g'); put(g, 5, 39, '*');
  put(g, 8, 42, 's');
  put(g, 8, 21, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[16, '*'], [18, 's'], [26, '^'], [28, 'l'], [30, '*']] });   // 限时层：两层结构
  exitAt(g);
  LEVELS.push({ name: '穹顶之巅', diff: 5, par: 65, rows: toRows(border(g)) }); }

// 17.1 最终圣殿·圣殿前庭（限时 70s）：双推箱双钮 + 分道虚影门
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w'); pool(g, 8, 8);
  put(g, 8, 11, 'C'); put(g, 8, 14, '1'); step(g, 8, 16, 17, 'D');
  put(g, 8, 20, 'd'); put(g, 8, 22, 'e');
  lava(g, 25, 25); put(g, 8, 26, 'l');
  put(g, 8, 29, 'f'); put(g, 8, 31, 's');
  step(g, 8, 34, 36); put(g, 7, 35, '*');
  put(g, 8, 39, 'C'); put(g, 8, 41, '2'); step(g, 8, 43, 43, 'E');
  put(g, 8, 19, 'h');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[16, '*'], [18, 's'], [26, '^'], [28, 'w'], [30, '*']] });   // 限时层：两层结构
  exitAt(g);
  LEVELS.push({ name: '圣殿前庭', diff: 5, par: 75, rows: toRows(border(g)) }); }

// 17.2 最终圣殿·元素回廊（限时 65s）：水火毒交错 + 冰桥双史莱姆
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  pool(g, 7, 7); put(g, 8, 9, 'w'); lava(g, 10, 10); put(g, 8, 12, 'l');
  step(g, 9, 15, 20, '~'); put(g, 8, 17, 's'); put(g, 8, 19, 's');
  put(g, 8, 23, 'T'); put(g, 8, 26, 'T'); put(g, 8, 29, 'T');
  put(g, 8, 32, 'f'); put(g, 8, 34, 'F'); put(g, 8, 36, 'f');
  gap(g, 38, 40); put(g, 8, 39, 'm');
  step(g, 8, 42, 43); put(g, 7, 42, 'g'); put(g, 6, 42, 'g'); put(g, 5, 42, '*');
  put(g, 8, 22, 'h');
  vert(g, { pad: 15, seg: [18, 25], gap: [26, 27], m: 26, seg2: [29, 35],
    l2: [[21, 's'], [23, '*'], [31, '^'], [33, 'l'], [35, '*']] });   // 限时层：两层结构
  exitAt(g);
  LEVELS.push({ name: '元素回廊', diff: 5, par: 75, rows: toRows(border(g)) }); }

// 17.3 最终圣殿·双子王座（限时 60s）：终局 Boss 战
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w'); pool(g, 8, 8);
  lava(g, 12, 12); put(g, 8, 13, 'l');
  put(g, 8, 16, 's'); put(g, 8, 19, 'f');
  put(g, 8, 23, '^'); put(g, 8, 25, 'T');
  step(g, 9, 28, 33, '~'); put(g, 8, 30, 's');
  gap(g, 34, 36); put(g, 8, 35, 'm');
  put(g, 7, 40, 'G');
  put(g, 8, 21, 'h');
  vert(g, { pad: 10, seg: [13, 19], gap: [20, 21], m: 20, seg2: [23, 28],
    l2: [[15, '*'], [17, 's'], [25, '^'], [27, 'l']] });   // 限时Boss层：左侧两层，右侧留竞技场
  exitAt(g);
  LEVELS.push({ name: '双子王座', diff: 5, par: 85, rows: toRows(border(g)) }); }

/* ================= 云梯圣殿：三层垂直结构 · 协作弹跳台（H）+ 悬空单向平台（=） =================
   垂直几何（TILE=40；实心块顶 = row*40；'='/m 平台顶 = row*40+16；离散物理：普通跳峰值85px、协作跳峰值192px）：
   - 地面(脚360)：普通跳最高落脚 row6 实心(280)；协作跳(从地面台脚320起)最高 row4 实心(160)。
   - 单人站台普通跳(脚320→235)够不到 row5(200) → 二层必须双人协作。
   - 二层台(脚160)普通跳→74.7 够不到 row1 云台(56)；协作跳→-32 可达 ✓。
   设计：地面层 →(双人协作跳)→ 二层(尖刺/史莱姆/移动平台/掉落 + 星星奖励) →(二层台协作跳)→ 三层(定时火焰高级陷阱 + 稀有星星)。 */

// 18.1 云梯圣殿·云阶试炼：教学三层（弹跳台→二层尖刺史莱姆+移动平台→三层云顶火柱）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'w'); pool(g, 7, 7);                     // 地面：水池教学
  put(g, 8, 10, 'H');                                    // 地面弹跳台①：协作跳(水平169px)落二层顶200
  step(g, 5, 13, 20);                                     // 二层A段（实心顶200：普通跳275/单人台跳235均够不到）
  put(g, 4, 14, '*'); put(g, 4, 16, '^');                // 二层奖励星 + 陷阱1：尖刺
  put(g, 4, 19, 's');                                    // 二层陷阱2：史莱姆巡逻
  put(g, 5, 22, 'm');                                    // 二层陷阱3：移动平台渡掉落缺口（A段末20→B段首24）
  step(g, 5, 24, 30);                                     // 二层B段
  put(g, 4, 26, 'l'); put(g, 4, 29, '*');                // 二层奖励：火宝石 + 星
  put(g, 5, 28, 'H');                                    // 二层弹跳台②（与主段同高顶200，脚200）：普通跳峰值114.7>96 上不了云；协作跳(水平178px)落列32.9 ✓
  hole(g, 27, 40);                                       // 顶部天窗：须覆盖台②所在列（弹跳峰值头顶 y=8 会穿过 row0 带）
  for (let c = 31; c <= 38; c++) put(g, 2, c, '=');     // 三层：云顶悬空平台（顶96，单人普通跳峰值74.7够不到）
  put(g, 1, 35, 'f'); put(g, 1, 37, '*');                // 三层高级陷阱：定时火柱 + 稀有奖励星
  lava(g, 42, 42); put(g, 8, 43, 'l');
  put(g, 8, 16, 'h');                                     // 爱心水晶
  exitAt(g);
  LEVELS.push({ name: '云阶试炼', diff: 4, par: 75, rows: toRows(border(g)) }); }

// 18.2 云梯圣殿·云顶观测：台阶式二层 + 云端火柱 + 双稀有星
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  lava(g, 5, 5); put(g, 8, 6, 'l');
  put(g, 8, 10, 'H');                                    // 地面弹跳台①
  step(g, 5, 13, 16);                                     // 二层入口段（实心顶200）
  put(g, 4, 16, 's'); put(g, 4, 14, '*');               // 入口段陷阱：史莱姆（列16，避开协作跳落点列14~15）+ 奖励星
  put(g, 5, 18, 'm');                                    // 掉落缺口移动平台（16→20）
  step(g, 5, 20, 27);                                      // 二层主段
  put(g, 4, 21, '^'); put(g, 4, 23, 'w');                // 陷阱：尖刺 + 水宝石
  put(g, 4, 24, 's'); put(g, 4, 25, '*');               // 陷阱：史莱姆 + 奖励星
  put(g, 5, 27, 'H');                                     // 二层弹跳台②（与主段同高顶200，脚200）：普通跳峰值114.7>100 上不了云(96)；协作跳(水平178px)→落点列31.6 ✓
  hole(g, 27, 40);                                        // 顶部天窗：覆盖台②列27（峰值头顶 y=8 穿过 row0 带）
  for (let c = 31; c <= 38; c++) put(g, 2, c, '=');     // 三层：云顶悬空平台（顶96）
  put(g, 1, 34, 'f'); put(g, 1, 36, '*'); put(g, 1, 38, '*');  // 高级陷阱：定时火柱 + 双稀有星
  put(g, 8, 40, 'T'); pool(g, 43, 43);
  put(g, 8, 15, 'h');                                     // 爱心水晶
  exitAt(g);
  LEVELS.push({ name: '云顶观测', diff: 5, par: 90, rows: toRows(border(g)) }); }

/* ================= 爱之圣殿：情侣主题终章 · 粉色浪漫场景 · 爱心水晶（h）富集 =================
   爱情元素：爱心水晶（收集 +5 好感）、属性池成对出现（一二布布互补过池）、
   三层云台放稀有爱心；本关游玩时自动切换浪漫 BGM（LOVE_TEMPLE_MAJOR）。 */

// 19.1 爱之圣殿·誓约回廊：属性互补水池/岩浆 + 爱心水晶 ×3（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'w'); pool(g, 7, 7);                        // 水池：只有布布要跳、一二可走（互补教学）
  put(g, 8, 11, 'h');                                      // 地面爱心水晶①
  lava(g, 13, 13); put(g, 8, 14, 'l');                     // 岩浆：只有一二要跳、布布可走
  step(g, 8, 17, 19); put(g, 7, 18, '*');
  put(g, 8, 22, 's');
  pool(g, 25, 25);
  step(g, 8, 33, 35); put(g, 7, 34, 'h');                  // 台阶爱心水晶：站台阶上可拾
  exitAt(g);
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[15, '*'], [25, '^'], [26, 'w'], [29, '*']],
    h: [[4, 17], [8, 27]] });                              // 二层爱心水晶 + 地面补给爱心
  LEVELS.push({ name: '誓约回廊', diff: 4, par: 80, rows: toRows(border(g)) }); }

// 19.2 爱之圣殿·同心祭坛：三层垂直 + 爱心水晶 ×4（含三层稀有）+ 火焰守护
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  lava(g, 6, 6); put(g, 8, 7, 'l');
  put(g, 8, 12, 'h');                                      // 地面爱心水晶
  step(g, 8, 15, 17); put(g, 7, 16, 'h');                  // 台阶爱心水晶
  put(g, 8, 20, 'f'); put(g, 8, 23, 's');
  pool(g, 26, 26); put(g, 8, 27, 'w');
  step(g, 8, 33, 35); put(g, 7, 34, '*');
  lava(g, 39, 39); put(g, 8, 40, 'l');
  exitAt(g);
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, 's'], [17, '*'], [25, '^'], [26, 'l'], [29, 'h']],   // 二层爱心水晶
    l3: [[33, 'f'], [35, '*'], [36, 'f']],
    h: [[1, 37]] });                                       // 三层稀有爱心水晶（双人协作跳终点奖励）
  LEVELS.push({ name: '同心祭坛', diff: 5, par: 95, rows: toRows(border(g)) }); }

/* ================= 恋爱终章「心之试炼」：4 大主关 · 11 层（第 20~23 章） =================
   新机关：J 同心连压板（成对+K 门）/ b 心之桥（牵手实体化）/ z 平衡升降台（双人同站上升）/ r 节奏火墙（全局同相位）。
   好感度门票章节（MAJORS.loveNeed），首通额外好感 +15；每层 ≥1 颗爱心水晶（避开机关列）。 */

// 20.1 心之回廊·初见回廊：J/K 连压板教学（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'w'); pool(g, 7, 7);
  put(g, 8, 10, 'h');                                      // 爱心水晶（地面，避开机关列）
  put(g, 8, 13, 'J'); put(g, 8, 16, 'J'); step(g, 8, 19, 19, 'K');   // 教学：双人各踩一块开金门
  lava(g, 21, 21); put(g, 8, 22, 'l');
  vert(g, { pad: 24, seg: [27, 34], gap: [35, 36], m: 35, seg2: [38, 42],
    l2: [[29, '*'], [31, 's'], [40, '^']] });
  exitAt(g);
  LEVELS.push({ name: '初见回廊', diff: 4, par: 60, rows: toRows(border(g)) }); }

// 20.2 心之回廊·心桥暮色：b 心之桥教学——深渊须牵手同行（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'w');
  put(g, 8, 9, 'J'); put(g, 8, 12, 'J'); step(g, 8, 15, 15, 'K');
  lava(g, 18, 18); put(g, 8, 19, 'l');
  put(g, 8, 20, 'h');                                      // 桥上可顺拾
  gap(g, 22, 25); for (let c = 22; c <= 25; c++) put(g, 9, c, 'b');   // 心之桥：牵手才实体化
  put(g, 8, 28, 's');
  vert(g, { pad: 31, seg: [34, 38], seg2: [41, 43], l2: [[36, '*'], [37, 's']] });
  exitAt(g);
  LEVELS.push({ name: '心桥暮色', diff: 4, par: 70, rows: toRows(border(g)) }); }

// 21.1 默契圣殿·平衡回廊（限时 75s）：z 平衡升降台——双人同站载上二层（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w'); pool(g, 8, 8);
  vert(g, { pad: 10, seg: [13, 20], seg2: [24, 30],
    l2: [[15, '*'], [17, 's'], [26, '^'], [28, 'l'], [29, '*']] });
  put(g, 8, 23, 'z');                                      // 升降台：立于二层缺口旁，双人同站升至台顶 200 右踏 seg2
  put(g, 8, 33, 'f'); put(g, 8, 35, 's');
  step(g, 8, 38, 40); put(g, 7, 39, '*');
  pool(g, 42, 42);
  put(g, 8, 18, 'h');
  exitAt(g);
  LEVELS.push({ name: '平衡回廊', diff: 5, par: 65, rows: toRows(border(g)) }); }

// 21.2 默契圣殿·节奏火墙（限时 70s）：r 全局同相位火墙，两人同拍穿越（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'r'); put(g, 8, 8, 'r');                    // 节奏火墙①②
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30],
    l2: [[15, '*'], [17, 's'], [26, '^'], [28, 'l'], [29, '*']] });
  put(g, 8, 33, 'r'); put(g, 8, 35, 'r');                  // 节奏火墙③④
  put(g, 8, 38, 'w'); pool(g, 39, 39);
  put(g, 8, 41, 'l'); lava(g, 42, 42);
  put(g, 8, 18, 'h');
  exitAt(g);
  LEVELS.push({ name: '节奏火墙', diff: 5, par: 65, rows: toRows(border(g)) }); }

// 21.3 默契圣殿·双心领域（限时 65s）：J+b+r 复合（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'J'); put(g, 8, 10, 'J'); step(g, 8, 13, 13, 'K');
  lava(g, 15, 15); put(g, 8, 16, 'l');
  put(g, 8, 17, 'h');
  gap(g, 19, 22); for (let c = 19; c <= 22; c++) put(g, 9, c, 'b');
  put(g, 8, 25, 'r');
  vert(g, { pad: 28, seg: [31, 38], seg2: [40, 43], l2: [[33, '*'], [35, 's'], [41, '^']] });
  exitAt(g);
  LEVELS.push({ name: '双心领域', diff: 5, par: 70, rows: toRows(border(g)) }); }

// 22.1 双生之塔·连压之塔（限时 85s）：双对 J/K + 三层垂直
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'w'); pool(g, 7, 7);
  put(g, 8, 13, 'J'); put(g, 8, 16, 'J'); step(g, 8, 19, 19, 'K');
  lava(g, 22, 22); put(g, 8, 23, 'l');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '*'], [17, 's'], [25, '^'], [26, 'l'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  put(g, 8, 34, 'J'); put(g, 8, 37, 'J'); step(g, 8, 39, 39, 'K');   // 第二对：三层云台正下方
  pool(g, 42, 42);
  put(g, 8, 18, 'h');
  exitAt(g);
  LEVELS.push({ name: '连压之塔', diff: 5, par: 70, rows: toRows(border(g)) }); }

// 22.2 双生之塔·升降之塔（限时 80s）：z 升降台直达三层云顶（三层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w');
  put(g, 8, 12, 'h');
  lava(g, 15, 15); put(g, 8, 14, 'l');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '*'], [17, 's'], [26, '^'], [27, 'l']], l3: [[34, '*'], [36, 'f']] });
  put(g, 8, 39, 'z');                                      // 升降台：双人同站直上三层，左踏云台末端
  put(g, 8, 42, 'r');
  pool(g, 43, 43);
  exitAt(g);
  LEVELS.push({ name: '升降之塔', diff: 5, par: 80, rows: toRows(border(g)) }); }

// 22.3 双生之塔·双子之巅（限时 75s）：r+b+J 全混合三层垂直
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'r'); put(g, 8, 8, 'r');
  put(g, 8, 12, 'h');
  lava(g, 18, 18); put(g, 8, 19, 'l');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 30], pad2: 28, cloud: [31, 38],
    l2: [[15, '*'], [17, 's'], [25, '^'], [26, 'w'], [29, '*']], l3: [[33, 'f'], [35, '*'], [36, 'f']] });
  put(g, 8, 24, 'J'); put(g, 8, 27, 'J'); step(g, 8, 30, 30, 'K');
  gap(g, 40, 43); for (let c = 40; c <= 43; c++) put(g, 9, c, 'b');
  exitAt(g);
  LEVELS.push({ name: '双子之巅', diff: 5, par: 85, rows: toRows(border(g)) }); }

// 23.1 永恒之约·回忆小径：J+b 温习（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'J'); put(g, 8, 10, 'J'); step(g, 8, 13, 13, 'K');
  pool(g, 15, 15); put(g, 8, 16, 'w');
  put(g, 8, 17, 'h');
  gap(g, 19, 22); for (let c = 19; c <= 22; c++) put(g, 9, c, 'b');
  lava(g, 24, 24); put(g, 8, 25, 'l');
  vert(g, { pad: 28, seg: [31, 38], seg2: [40, 43], l2: [[33, '*'], [35, 's'], [36, 'h']] });
  exitAt(g);
  LEVELS.push({ name: '回忆小径', diff: 5, par: 75, rows: toRows(border(g)) }); }

// 23.2 永恒之约·试炼回廊：r+J+z 复合（两层）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 6, 'r'); put(g, 8, 9, 'r');
  put(g, 8, 12, 'J'); put(g, 8, 15, 'J'); step(g, 8, 17, 17, 'K');
  put(g, 8, 14, 'h');
  vert(g, { pad: 20, seg: [23, 30], seg2: [33, 39], l2: [[25, '*'], [27, 's'], [35, '^'], [37, 'l']] });
  put(g, 8, 32, 'z');                                      // 二层缺口旁升降台直上 seg2
  pool(g, 42, 42); put(g, 8, 41, 'w');
  exitAt(g);
  LEVELS.push({ name: '试炼回廊', diff: 5, par: 85, rows: toRows(border(g)) }); }

// 23.3 永恒之约·永恒之主：终章 Boss 层（全机关综合考核）
{ const g = mk();
  ground(g, 1, 46);
  put(g, 8, 2, 'P'); put(g, 8, 4, 'B');
  put(g, 8, 7, 'w'); pool(g, 8, 8);
  put(g, 8, 11, 'J'); put(g, 8, 14, 'J'); step(g, 8, 16, 16, 'K');
  lava(g, 19, 19); put(g, 8, 20, 'l');
  vert(g, { pad: 10, seg: [13, 20], gap: [21, 22], m: 21, seg2: [24, 28],
    l2: [[15, '*'], [17, 's'], [26, '^']] });
  put(g, 8, 25, 'h');
  gap(g, 31, 34); for (let c = 31; c <= 34; c++) put(g, 9, c, 'b');
  put(g, 8, 37, 'r');
  put(g, 7, 40, 'G');                                      // 终章 Boss 竞技场
  exitAt(g);
  LEVELS.push({ name: '永恒之主', diff: 5, par: 105, rows: toRows(border(g)) }); }


/* 跑跳模拟：角色从条带左侧满速助跑，求是否存在起跳时机使脚全程高于危险条带。
   返回 true 表示该宽度的贴地危险条带可被跑跳越过。 */
function jumpableStrip(widthPx) {
  const feetStart = 360, dangerTop = 320;   // row9 顶 / row8 顶
  const footW = PW - 4;                     // 脚盒宽 20
  // 起跳点：脚盒右缘在条带左缘前 0~60px 内；落地时脚盒左缘必须越过条带右缘才算成功
  for (let d = -footW - 60; d <= -footW; d += 1) {
    // d = 起跳瞬间脚盒左缘相对条带左缘的位置；脚盒 [d, d+footW]
    let feet = feetStart, vy = -JUMP, x = d;
    let ok = true, landed = false;
    for (let i = 0; i < 200; i++) {
      vy += GRAVITY * DT;
      feet += vy * DT;
      x += SPEED * DT;
      const left = x, right = x + footW;
      const overlap = right > 0 && left < widthPx;   // 脚盒与条带有水平重叠
      if (overlap && feet > dangerTop + 1e-6) { ok = false; break; }
      if (feet >= feetStart && i > 2) { landed = true; break; }   // 落地
    }
    if (ok && landed && x >= widthPx) return true;
  }
  return false;
}

function checkLevel(lv, i) {
  const errs = [];
  const rows = lv.rows;
  if (new Set(rows.map(r => r.length)).size !== 1) errs.push('行宽不一');
  rows.forEach((r, ri) => { if (r[0] !== '#' || r[COLS - 1] !== '#') errs.push('边界破洞'); if (ri === 0) { for (let c = 1; c < COLS - 1; c++) if (r[c] !== '#' && r[c] !== ' ') errs.push('顶界非法字符'); } else if (r !== undefined) { /* 其余行由列边界保证 */ } });
  const at = (r, c) => (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? rows[r][c] : '#';
  const isSolid = ch => '#~CDEHK'.includes(ch);   // K=连压板门：最坏按关闭(实心)校验
  const hazard = (px, py, idx) => {
    const scan = (x0, y0, x1, y1, fn) => {
      for (let r = Math.floor(y0 / TILE); r <= Math.floor((y1 - 1) / TILE); r++)
        for (let c = Math.floor(x0 / TILE); c <= Math.floor((x1 - 1) / TILE); c++) {
          const msg = fn(at(r, c), idx); if (msg) return msg + `@(${r},${c})`;
        }
      return null;
    };
    return scan(px + 2, py + PH - 6, px + PW - 2, py + PH, (t, id) =>
        (t === 'W' && id !== 0) ? '水池' : (t === 'L' && id !== 1) ? '岩浆' : (t === '^') ? '地刺' : null)
      || scan(px, py, px + PW, py + PH, t =>
        t === 'T' ? '毒液' : t === 's' ? '史莱姆' : t === 'f' || t === 'F' || t === 'r' ? '火焰(最坏)' : t === 'v' ? '顶刺' : null);
  };
  let nP = 0, nB = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = at(r, c);
    if (ch !== 'P' && ch !== 'B') continue;
    const idx = ch === 'P' ? 0 : 1;
    if (idx === 0) nP++; else nB++;
    let py = (r + 1) * TILE, landed = false;
    for (let s = 0; s < ROWS * TILE + 100; s++) {
      const rr = Math.floor((py + PH) / TILE);
      const c0 = Math.floor((c * TILE + (TILE - PW) / 2 + 2) / TILE), c1 = Math.floor((c * TILE + (TILE + PW) / 2 - 2) / TILE);
      if (isSolid(at(rr, c0)) || isSolid(at(rr, c1))) { py = rr * TILE - PH; landed = true; break; }  // 吸附到支撑面顶（与游戏一致）
      py += 1;
      if (py > ROWS * TILE) break;
    }
    if (!landed) errs.push(`${ch}(${r},${c})掉出地图`);
    else { const h = hazard(c * TILE + (TILE - PW) / 2, py, idx); if (h) errs.push(`${ch}(${r},${c})落地即死:${h}`); }
  }
  if (!nP || !nB) errs.push('缺出生点');
  if (!rows.join('').includes('X')) errs.push('无出口');
  // 台阶高差：相邻列地面表面高度差 ≤ 1 格（峰值 2 格，留容错）
  // 含协作弹跳台 H 的关卡：高台靠双人弹跳到达，豁免台阶高差检查
  const hasPad = rows.some(r => r.includes('H'));
  if (!hasPad) {
    const surf = c => { for (let r = 1; r < ROWS; r++) if (isSolid(at(r, c))) return r; return ROWS; };
    for (let c = 1; c < COLS - 2; c++) {
      const a = surf(c), b = surf(c + 1);
      if (a - b >= 2) errs.push(`列${c}→${c + 1}台阶${a - b}格过高`);
    }
  }
  // 逐玩家危险条带可越性：一二(0)怕 L/T/^，布布(1)怕 W/T/^；火焰 f/F 为计时障碍不计
  const dangerFor = (ch, idx) => ch === 'T' || ch === '^' || (ch === 'W' && idx !== 0) || (ch === 'L' && idx !== 1);
  for (const idx of [0, 1]) {
    let run = 0;
    for (let c = 1; c <= COLS - 2; c++) {
      const inStrip = dangerFor(at(8, c), idx) || dangerFor(at(9, c), idx);
      if (inStrip) { run++; continue; }
      if (run === 0) continue;
      const start = c - run;
      const grounded = isSolid(at(9, start)) || isSolid(at(9, start - 1));
      if (grounded) {
        if (!jumpableStrip(run * TILE)) errs.push(`玩家${idx}危险带列${start}~${c - 1}宽${run}跑跳不可越`);
      } else {
        const H = SPEED * (2 * JUMP / GRAVITY);
        if (run * TILE + 20 > H) errs.push(`玩家${idx}危险带列${start}~${c - 1}宽${run}架空不可越`);
      }
      run = 0;
    }
  }
  // 坑宽 ≤ 2 或坑内有平台
  let run = 0;
  for (let c = 1; c < COLS - 1; c++) {
    const hasFloor = isSolid(at(8, c)) || isSolid(at(9, c)) || at(8, c) === 'b' || at(9, c) === 'b';
    if (!hasFloor) run++;
    else { if (run > 2) { let hasPlat = false; for (let k = c - run; k < c; k++) if ('mM'.includes(at(7, k)) || 'mM'.includes(at(8, k))) hasPlat = true;
        if (!hasPlat) errs.push(`坑列${c - run}~${c - 1}宽${run}无平台`); } run = 0; }
  }
  // === 恋爱终章新机关校验（J/K 配对、b 桥两端落脚、z 上升通道无遮挡） ===
  let nJ = 0, nK = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = at(r, c);
    if (ch === 'J') nJ++;
    if (ch === 'K') nK++;
    if (ch === 'z') { for (let rr = 1; rr < r; rr++) if (isSolid(at(rr, c))) errs.push(`升降台z(${r},${c})上升通道被${at(rr, c)}@(${rr},${c})遮挡`); }
  }
  if (nJ % 2) errs.push(`J板数${nJ}为奇数`);
  if (nK !== nJ / 2) errs.push(`K门数${nK}≠J板数一半(${nJ / 2})`);
  for (let c = 1; c < COLS - 1; c++) {
    if (at(9, c) === 'b' && at(9, c - 1) !== 'b') {
      let e = c; while (e + 1 < COLS && at(9, e + 1) === 'b') e++;
      if (!isSolid(at(9, c - 1)) && !isSolid(at(8, c - 1))) errs.push(`心之桥列${c}~${e}左端无落脚`);
      if (!isSolid(at(9, e + 1)) && !isSolid(at(8, e + 1))) errs.push(`心之桥列${c}~${e}右端无落脚`);
      c = e;
    }
  }
  return errs;
}

let allOk = true;
LEVELS.forEach((lv, i) => {
  const errs = checkLevel(lv, i);
  console.log(`${errs.length ? '❌' : '✅'} 关${String(i + 1).padStart(2)} ${lv.name} ${errs.join(' | ')}`);
  if (errs.length) allOk = false;
});

if (allOk) {
  const out = LEVELS.map(lv =>
    `  // ${lv.name}\n  [\n${lv.rows.map(r => '    ' + JSON.stringify(r)).join(',\n')},\n  ],`).join('\n');
  require('fs').writeFileSync('d:/onetwobubu/_levels_out.txt', out, 'utf8');
  console.log('\nOK 已写出 _levels_out.txt');
  console.log('NAMES:', JSON.stringify(LEVELS.map(l => l.name)));
  console.log('DIFF:', JSON.stringify(LEVELS.map(l => l.diff)));
  console.log('PAR:', JSON.stringify(LEVELS.map(l => l.par)));
}
