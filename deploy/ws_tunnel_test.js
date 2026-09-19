// 零依赖 WebSocket 客户端：验证经 cloudflared 隧道的 wss 联机中继
// 用法: node deploy/ws_tunnel_test.js <host>   例: node deploy/ws_tunnel_test.js usage-weather-ferry-reduces.trycloudflare.com
const tls = require('tls');
const crypto = require('crypto');

function wsConnect(host) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = tls.connect({ servername: host, host, port: 443, rejectUnauthorized: false }, () => {
      sock.write('GET /ws HTTP/1.1\r\nHost: ' + host + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf = Buffer.alloc(0), up = false;
    const msgs = [];
    let onMsg = null;
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (!up) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.subarray(0, i).toString();
        if (!/ 101 /.test(head)) { sock.destroy(); return reject(new Error('handshake fail: ' + head.split('\r\n')[0])); }
        buf = buf.subarray(i + 4); up = true; resolve(api);
      }
      // 解析服务端帧（不掩码）
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f; let len = buf[1] & 0x7f, p = 2;
        if (len === 126) { if (buf.length < p + 2) return; len = buf.readUInt16BE(p); p += 2; }
        else if (len === 127) { if (buf.length < p + 8) return; len = Number(buf.readBigUInt64BE(p)); p += 8; }
        if (buf.length < p + len) return;
        const payload = buf.subarray(p, p + len); buf = buf.subarray(p + len);
        if (op === 0x1) { const m = JSON.parse(payload.toString('utf8')); msgs.push(m); if (onMsg) onMsg(m); }
      }
    });
    sock.on('error', reject);
    function send(obj) {
      const payload = Buffer.from(JSON.stringify(obj));
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
      let header;
      if (payload.length < 126) { header = Buffer.from([0x81, 0x80 | payload.length]); }
      else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
      sock.write(Buffer.concat([header, mask, masked]));
    }
    const api = { send, msgs, set onMsg(f) { onMsg = f; }, close: () => sock.destroy() };
  });
}

(async () => {
  const host = process.argv[2];
  if (!host) { console.log('用法: node deploy/ws_tunnel_test.js <host>'); process.exit(1); }
  const room = 'T' + Math.floor(Math.random() * 900 + 100);
  const hostC = await wsConnect(host);
  hostC.send({ t: 'create', room });
  const wel = await new Promise(r => { hostC.onMsg = m => { if (m.t === 'welcome') r(m); }; });
  console.log('host welcome:', JSON.stringify(wel));
  const guestC = await wsConnect(host);
  guestC.send({ t: 'join', room });
  const gwel = await new Promise(r => { guestC.onMsg = m => { if (m.t === 'welcome') r(m); }; });
  console.log('guest welcome:', JSON.stringify(gwel));
  hostC.send({ t: 'state', n: 42, hello: 'from-host' });
  const relayed = await new Promise(r => { guestC.onMsg = m => { if (m.t === 'state') r(m); }; });
  if (!hostC.msgs.some(m => m.t === 'peer' && m.online)) throw new Error('host 未收到 peer online');
  console.log('guest received relayed state:', JSON.stringify(relayed));
  console.log(relayed.n === 42 ? 'PASS: wss 隧道中继正常' : 'FAIL');
  hostC.close(); guestC.close();
  setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
