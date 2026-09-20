// 本地静态服务器 + 零依赖 WebSocket 联机中继（一二 & 布布 双人模式）
// WebSocket 为手写 RFC6455 实现，无需 npm 安装任何依赖。
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const auth = require('./server-auth');

const ROOT = __dirname;
const PORT = 8765;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const httpServer = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) { auth.handleHTTP(req, res); return; }   // 账号/云存档 API
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    // ETag = 大小+mtime（弱校验即可）；命中 If-None-Match 直接 304，零字节传输
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const LONG_CACHE = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.m4a', '.wav', '.mp3'];
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ETag: etag,
      // 代码类（html/js/css）no-cache 每次重验证（开发期改动即时生效）；图片/音频长缓存（文件更新 mtime 变 → ETag 变，安全）
      'Cache-Control': LONG_CACHE.includes(ext)
        ? 'public, max-age=86400, must-revalidate' : 'no-cache',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    fs.readFile(file, (err2, buf) => {
      if (err2) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
});

/* ================================================================
   手写 WebSocket（RFC6455）：帧编解码 + 房间匹配中继
   ================================================================ */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* 服务端→客户端帧：不掩码。opcode 1=文本 8=关闭 9=ping 10=pong */
function encodeFrame(opcode, payloadBuf) {
  const len = payloadBuf.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payloadBuf]);
}

/* 解析客户端帧（客户端→服务端必须掩码）；返回可完整解析的帧与剩余字节 */
function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let maskKey = null;
    if (masked) { if (buf.length - p < 4) break; maskKey = buf.subarray(p, p + 4); p += 4; }
    if (buf.length - p < len) break;
    let payload = Buffer.from(buf.subarray(p, p + len));
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    frames.push({ opcode, payload });
    off = p + len;
  }
  return { frames, rest: Buffer.from(buf.subarray(off)) };
}

/* 连接集合与房间表 */
const conns = new Set();
const rooms = new Map(); // room -> { host, guest }

function sendJSON(conn, obj) {
  if (!conn || conn.dead) return;
  try { conn.socket.write(encodeFrame(1, Buffer.from(JSON.stringify(obj), 'utf8'))); } catch (e) { conn.dead = true; }
}
function sendCtrl(conn, opcode) {
  if (!conn || conn.dead) return;
  try { conn.socket.write(encodeFrame(opcode, Buffer.alloc(0))); } catch (e) {}
}

httpServer.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const conn = { socket, buf: Buffer.alloc(0), room: null, role: null, lastPong: Date.now(), dead: false, uid: auth.uidFromReq(req) };
  conns.add(conn);
  socket.on('data', d => onData(conn, d));
  socket.on('close', () => onLeave(conn));
  socket.on('error', () => onLeave(conn));
});

function onData(conn, data) {
  conn.buf = Buffer.concat([conn.buf, data]);
  const { frames, rest } = decodeFrames(conn.buf);
  conn.buf = rest;
  for (const f of frames) {
    if (f.opcode === 0x8) { sendCtrl(conn, 0x8); closeConn(conn); return; }   // close
    if (f.opcode === 0x9) { sendCtrl(conn, 0xA); continue; }                   // ping -> pong
    if (f.opcode === 0xA) { conn.lastPong = Date.now(); continue; }            // pong
    if (f.opcode === 0x1) {
      conn.lastPong = Date.now();
      let m;
      try { m = JSON.parse(f.payload.toString('utf8')); } catch (e) { continue; }
      handleMsg(conn, m);
    }
  }
}

function handleMsg(conn, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'auth') {   // APK 跨源场景：首条消息携带 Bearer 令牌（网页同源走 Cookie，无需此消息）
    const v = auth.verifyToken(m.token);
    if (v && !v.ticket) { conn.uid = v.uid; sendJSON(conn, { t: 'auth_ok' }); }
    else sendJSON(conn, { t: 'auth_error', msg: '登录凭证无效或已过期' });
    return;
  }
  if (m.t === 'create' || m.t === 'join') {
    if (auth.ENFORCE && !conn.uid) { sendJSON(conn, { t: 'needauth' }); return; }
  }
  if (m.t === 'create') {
    if (conn.room) return;
    const room = String(m.room || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(room)) return sendJSON(conn, { t: 'error', msg: '房间码需为4位字母数字' });
    if (rooms.has(room)) return sendJSON(conn, { t: 'error', msg: '房间已存在' });
    rooms.set(room, { host: conn, guest: null });
    conn.room = room; conn.role = 'host';
    sendJSON(conn, { t: 'welcome', role: 'host', room });
    return;
  }
  if (m.t === 'join') {
    if (conn.room) return;
    const room = String(m.room || '').trim().toUpperCase();
    const r = rooms.get(room);
    if (!r) return sendJSON(conn, { t: 'error', msg: '房间不存在' });
    if (r.guest) return sendJSON(conn, { t: 'error', msg: '房间已满' });
    r.guest = conn;
    conn.room = room; conn.role = 'guest';
    sendJSON(conn, { t: 'welcome', role: 'guest', room });
    sendJSON(r.host, { t: 'peer', online: true });
    return;
  }
  // 其余消息（state/input/lv/rs/pa/pong…）透传给同伴
  const r = conn.room && rooms.get(conn.room);
  if (!r) return sendJSON(conn, { t: 'error', msg: '尚未加入房间' });
  const peer = conn.role === 'host' ? r.guest : r.host;
  if (peer) sendJSON(peer, m);
}

function closeConn(conn) {
  try { conn.socket.destroy(); } catch (e) {}
  onLeave(conn);
}

function onLeave(conn) {
  if (conn.dead) return;
  conn.dead = true;
  conns.delete(conn);
  if (!conn.room) return;
  const room = conn.room;
  conn.room = null;
  const r = rooms.get(room);
  if (!r) return;
  if (conn.role === 'host') {
    rooms.delete(room);
    if (r.guest) { const g = r.guest; g.room = null; g.role = null; sendJSON(g, { t: 'peer', online: false, hostGone: true }); }
  } else {
    r.guest = null;
    sendJSON(r.host, { t: 'peer', online: false });
  }
}

/* 心跳：2s 一次 WS ping，10s 无 pong 判定掉线 */
setInterval(() => {
  const now = Date.now();
  for (const c of conns) {
    if (now - c.lastPong > 10000) { sendCtrl(c, 0x8); closeConn(c); continue; }
    sendCtrl(c, 0x9);
  }
}, 2000).unref();

/* ================= 启动 ================= */
function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

if (require.main === module) {
  httpServer.listen(PORT, '0.0.0.0', () => {
    const url = 'http://localhost:' + PORT;
    console.log('一二 & 布布 已启动：' + url);
    console.log('联机中继：ws://<本机IP>:' + PORT + '/ws');
    const ips = lanIPs();
    if (ips.length) console.log('局域网地址：' + ips.map(i => 'http://' + i + ':' + PORT).join('  '));
    console.log('提示：互联网联机需将本目录部署到公网服务器（或内网穿透 8765 端口），游戏内联机大厅填入对应地址。');
    console.log('关闭此窗口即可停止游戏。');
    // 启动成功后再打开浏览器，避免连不上
    require('child_process').exec('start "" "' + url + '"', { shell: true }, () => {});
  });
}

module.exports = { httpServer };
