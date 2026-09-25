// unit_pure.js — P2-C 纯函数单元测试（无浏览器/无网络）：WS 帧编解码、令牌校验、限流、云存档合并
// 与 cdp_*/auth_api 端到端测试互补：这些核心逻辑的边界条件在端到端里难构造。
// 用法：node unit_pure.js（run_all.js 自动发现 unit_ 前缀）
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');

// 隔离数据目录：必须在 require server-auth 之前设置，避免触碰生产 data/game.db
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owb_unit_'));
process.env.OWB_DATA_DIR = tmpDir;

const { encodeFrame, decodeFrames, MAX_FRAME } = require(path.join(__dirname, '..', 'server.js'));
const auth = require(path.join(__dirname, '..', 'server-auth.js'));
const { rateOk } = require(path.join(__dirname, '..', 'rate-limit.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

/* ---------- 1. WS 帧编解码 ---------- */
{
  // 编码→解码往返（服务端帧不掩码，decodeFrames 兼容）
  const f = decodeFrames(encodeFrame(1, Buffer.from('hi 一二', 'utf8')));
  ok(f.frames.length === 1 && f.frames[0].opcode === 1 && f.frames[0].payload.toString('utf8') === 'hi 一二' && f.rest.length === 0, 'WS1 短帧编码解码往返一致');

  // 长度边界：125（7bit）、126（16bit 扩展）、65535
  for (const n of [125, 126, 65535]) {
    const r = decodeFrames(encodeFrame(1, Buffer.alloc(n, 0x61)));
    ok(r.frames.length === 1 && r.frames[0].payload.length === n, `WS2 长度 ${n} 字节帧往返`);
  }

  // 超限帧：> MAX_FRAME 应置 tooBig
  const big = decodeFrames(encodeFrame(1, Buffer.alloc(MAX_FRAME + 1, 0x62)));
  ok(big.tooBig === true && big.frames.length === 0, 'WS3 超过单帧上限置 tooBig 断连标志');

  // 掩码客户端帧解码（XOR 还原）
  const payload = Buffer.from('{"t":"create","room":"AB12"}', 'utf8');
  const key = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ key[i % 4];
  const frameBuf = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), key, masked]);
  const m = decodeFrames(frameBuf);
  ok(m.frames.length === 1 && m.frames[0].payload.toString('utf8') === payload.toString('utf8'), 'WS4 掩码客户端帧正确解掩码');

  // 半包：截断帧返回 rest 待后续拼接
  const whole = encodeFrame(1, Buffer.alloc(200, 0x63));
  const cut = decodeFrames(whole.subarray(0, whole.length - 50));
  ok(cut.frames.length === 0 && cut.rest.length === whole.length - 50, 'WS5 半包不丢帧，剩余字节回传 rest');

  // 多帧粘连：两帧一次到达应全部解出
  const two = Buffer.concat([encodeFrame(1, Buffer.from('a')), encodeFrame(9, Buffer.alloc(0))]);
  const t2 = decodeFrames(two);
  ok(t2.frames.length === 2 && t2.frames[1].opcode === 9 && t2.rest.length === 0, 'WS6 粘包两帧全解出（含 ping 控制帧）');
}

/* ---------- 2. 令牌校验 ---------- */
{
  const t = auth.signToken(42, 0, 3600);
  ok(auth.verifyToken(t) === null, 'TK1 签名有效但用户不存在 → 拒绝（token_ver 吊销检查兜住）');
  ok(auth.verifyToken(t.slice(0, -2) + 'ff') === null, 'TK2 签名被篡改 → 拒绝');
  ok(auth.verifyToken('garbage') === null, 'TK3 非令牌串 → 拒绝');
  const expired = auth.signToken(42, 0, -10);
  ok(auth.verifyToken(expired) === null, 'TK4 已过期令牌 → 拒绝');
  const ticket = auth.signToken(7, 'R', 600);
  const v = auth.verifyToken(ticket);
  ok(v && v.uid === 7 && v.ticket === true, 'TK5 找回票据（R 版本）→ 通过且标记 ticket');
}

/* ---------- 3. 限流 ---------- */
{
  ok(rateOk('u3a', 2, 1000) && rateOk('u3a', 2, 1000), 'RL1 窗口内前 2 次放行');
  ok(rateOk('u3a', 2, 1000) === false, 'RL2 第 3 次超限拒绝');
  ok(rateOk('u3b', 2, 1000) === true, 'RL3 不同 key 独立计数');
  const t0 = Date.now();
  while (Date.now() - t0 < 60) { /* 等待窗口滑过（60ms） */ }
  ok(rateOk('u3c', 1, 50) === true && rateOk('u3c', 1, 50) === false && rateOk('u3c', 1, 50) === false, 'RL4 窗口内 1 次后拒绝');
  const t1 = Date.now();
  while (Date.now() - t1 < 80) { /* 等待窗口过期 */ }
  ok(rateOk('u3c', 1, 50) === true, 'RL5 窗口滑过后恢复放行');
}

/* ---------- 4. 云存档合并 authMergeSave（从 auth.js 源码提取纯函数在 vm 中执行） ---------- */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  const m = src.match(/function authMergeSave\(local, cloud\) \{[\s\S]*?\n\}/);
  ok(!!m, 'MS0 auth.js 中可提取 authMergeSave 函数');
  if (m) {
    const ctx = vm.createContext({ Math, JSON, Object, Array, Set });
    vm.runInContext(m[0] + '; this.merge = authMergeSave;', ctx);
    const merge = ctx.merge;

    const local = { unlocked: 5, bonusStars: 2, love: 30, best: { '3': 2 }, stars: { '3-1': 3 }, subs: { a: 1 }, heartLv: { h: 2 }, loveTiers: {}, loveStats: {}, photos: [2, 5], album: { v: 'local' }, settings: { skin: 'outing' } };
    const cloud = { unlocked: 8, bonusStars: 1, love: 20, best: { '3': 1, '5': 3 }, stars: {}, subs: { b: 2 }, heartLv: { h: 5 }, loveTiers: {}, loveStats: {}, photos: [1, 5], album: { v: 'cloud' }, settings: { skin: 'classic' } };
    const localSnap = JSON.stringify(local);
    const out = merge(local, cloud);

    ok(out.unlocked === 8 && out.bonusStars === 2 && out.love === 30, 'MS1 标量进度取 max');
    ok(out.best['3'] === 2 && out.best['5'] === 3, 'MS2 关卡通关记录逐键取 max');
    ok(!!out.subs.a && !!out.subs.b, 'MS3 子关卡进度取并集');
    ok(out.photos.length === 3 && out.photos[0] === 1 && out.photos[2] === 5, 'MS4 照片集合并去重排序');
    ok(out.settings.skin === 'classic', 'MS5 设置以云端为准（云覆盖本地）');
    ok(out.album.v === 'cloud', 'MS6 相册以云端为准');
    ok(JSON.stringify(local) === localSnap, 'MS7 合并不修改入参 local');
    ok(merge(local, null) === local, 'MS8 云端为空直接返回本地');
  }
}

console.log(`===== RESULT: ${pass} passed, ${fail} failed =====`);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* sqlite 句柄未关时忽略清理失败 */ }
process.exit(fail ? 1 : 0);
