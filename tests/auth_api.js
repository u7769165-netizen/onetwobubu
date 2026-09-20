// 账号系统 API 级测试：注册/登录/找回/云存档 rev/WS 门禁（含 Cookie 通道）
// 用法: node tests/auth_api.js   （需服务器已在 8765 运行）
const crypto = require('crypto');
const http = require('http');

const BASE = 'http://127.0.0.1:8765';
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}
function api(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(r => r.json().then(j => ({ code: r.status, j })).catch(() => ({ code: r.status, j: {} })));
}

/* ---- 极简 WS 客户端（明文 ws，掩码帧） ---- */
function wsConnect(cookieHeader) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: '127.0.0.1', port: 8765, path: '/ws', method: 'GET',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', Cookie: cookieHeader || '' } });
    req.on('upgrade', (res, socket) => {
      const api = {
        send(obj) {
          const p = Buffer.from(JSON.stringify(obj));
          const mask = crypto.randomBytes(4);
          const m = Buffer.alloc(p.length);
          for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4];
          socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | p.length]), mask, m]));
        },
        next() {   // 等下一条文本帧
          return new Promise(r => {
            let buf = Buffer.alloc(0);
            const onData = d => {
              buf = Buffer.concat([buf, d]);
              if (buf.length >= 2) {
                const len = buf[1] & 0x7f;
                if (buf.length >= 2 + len) {
                  socket.removeListener('data', onData);
                  r(JSON.parse(buf.subarray(2, 2 + len).toString('utf8')));
                }
              }
            };
            socket.on('data', onData);
          });
        },
        close() { socket.destroy(); },
      };
      resolve(api);
    });
    req.on('response', res => reject(new Error('no upgrade: ' + res.statusCode)));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const name = 'qa' + Date.now().toString(36).slice(-7);
  const pass1 = 'abcd123456', pass2 = 'efgh876543';

  // 1 注册
  let r = await api('/api/register', 'POST', { name, pass: pass1 });
  ok(r.j.ok && Array.isArray(r.j.codes) && r.j.codes.length === 10 && r.j.token, 'register 返回 codes+token');
  const token = r.j.token, codes = r.j.codes;

  // 2 me（Bearer）
  r = await api('/api/me', undefined, undefined, token);
  ok(r.j.ok && r.j.name === name, 'me 经 Bearer 识别');

  // 3 弱密码与重名
  r = await api('/api/register', 'POST', { name: name + 'x', pass: 'short' });
  ok(!r.j.ok, '拒绝 <8 位密码');
  r = await api('/api/register', 'POST', { name, pass: pass1 });
  ok(!r.j.ok, '拒绝重名');

  // 4 错误密码 401
  r = await api('/api/login', 'POST', { name, pass: 'wrongpass999' });
  ok(r.code === 401 && !r.j.ok, '错误密码 401');

  // 5 云存档往返 + rev 乐观锁
  r = await api('/api/save', 'PUT', { data: { unlocked: 7, best: { '3': 2 } }, rev: 0 }, token);
  ok(r.j.ok && r.j.rev === 1, 'save PUT rev0→1');
  r = await api('/api/save', 'PUT', { data: { unlocked: 9 }, rev: 0 }, token);
  ok(r.code === 409 && r.j.conflict && r.j.rev === 1, 'rev 冲突 409 返回云端版');
  r = await api('/api/save', undefined, undefined, token);
  ok(r.j.ok && r.j.data.unlocked === 7, 'save GET 一致');

  // 6 恢复码找回 → 重置 → 新密码登录 → 旧令牌吊销
  r = await api('/api/recover', 'POST', { name, code: codes[0] });
  ok(r.j.ok && r.j.ticket, '恢复码换 ticket');
  r = await api('/api/recover', 'POST', { name, code: codes[0] });
  ok(!r.j.ok, '恢复码一次性消耗');
  const rec = await api('/api/recover', 'POST', { name, code: codes[1] });
  r = await api('/api/reset', 'POST', { ticket: rec.j.ticket, new_pass: pass2 });
  ok(r.j.ok && r.j.codes.length === 10, 'ticket 重置密码 + 恢复码换新');
  r = await api('/api/login', 'POST', { name, pass: pass2 });
  ok(r.j.ok, '新密码登录成功');
  r = await api('/api/me', undefined, undefined, token);
  ok(r.code === 401, 'token_ver 递增吊销旧令牌');

  // 7 WS 门禁：无凭证 create → needauth
  const w1 = await wsConnect(null);
  w1.send({ t: 'create', room: 'QA11' });
  let m = await w1.next();
  ok(m.t === 'needauth', '未登录 create → needauth');
  w1.close();

  // 8 WS 带 Cookie 通道：登录响应 Cookie 建房成功
  const loginRaw = await new Promise(resolve => {
    const body = JSON.stringify({ name, pass: pass2 });
    const req = http.request(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(res.headers['set-cookie'] || []));
    });
    req.end(body);
  });
  const cookie = loginRaw.map(c => c.split(';')[0]).join('; ');
  ok(loginRaw.length > 0 && /owb_token=/.test(cookie), 'login 下发 httpOnly Cookie');
  const w2 = await wsConnect(cookie);
  w2.send({ t: 'create', room: 'QA22' });
  m = await w2.next();
  ok(m.t === 'welcome' && m.role === 'host', 'Cookie 通道 create → welcome');

  // 9 第二连接无凭证 join → needauth；带凭证 join → welcome + 主机收到 peer
  const w3 = await wsConnect(null);
  w3.send({ t: 'join', room: 'QA22' });
  m = await w3.next();
  ok(m.t === 'needauth', '未登录 join → needauth');
  w3.close();
  const w4 = await wsConnect(cookie);
  w4.send({ t: 'join', room: 'QA22' });
  const gw = await w4.next();
  const hostMsg = await w2.next();
  ok(gw.t === 'welcome' && gw.role === 'guest' && hostMsg.t === 'peer' && hostMsg.online, '双端登录联机握手完成');
  w2.close(); w4.close();

  console.log('----');
  console.log(fail === 0 ? 'ALL PASS (' + pass + ')' : 'FAILED ' + fail + ' / ' + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
