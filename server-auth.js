// 账号系统内核：注册/登录/找回（恢复码+安全问题）/云存档 API + 无状态令牌 + 限流
// 零依赖：node:sqlite + node:crypto。被 server.js require，导出 handleHTTP / verifyToken / uidFromReq。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();

const ENFORCE = process.env.AUTH_ENFORCE !== '0';   // 0=只记日志不拦截（灰度/回滚）
const TOKEN_TTL = 7 * 24 * 3600;                    // 令牌 7 天
const TICKET_TTL = 10 * 60;                         // 找回票据 10 分钟
const COOKIE = 'owb_token';

const db = new DatabaseSync(path.join(DATA_DIR, 'game.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL, hash TEXT NOT NULL,
  sec_q TEXT, sec_a_hash TEXT,
  token_ver INTEGER NOT NULL DEFAULT 0,
  fail_cnt INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recover(
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL,
  code_hash TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS saves(
  uid INTEGER PRIMARY KEY, data TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saves_updated ON saves(updated);
`);

/* ---------- 密码 / 令牌 / 哈希 ---------- */
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function hashPass(pass, salt) { return crypto.scryptSync(pass, salt, 64).toString('hex'); }
function safeEq(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function signToken(uid, tokenVer, ttl) {
  const payload = uid + '.' + Math.floor(Date.now() / 1000 + ttl) + '.' + tokenVer;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

/* ---------- P0-2 性能优化：token_ver 内存缓存 ---------- */
const tokenVerCache = new Map(); // uid -> { ver, expires }
const CACHE_TTL = 60 * 1000;   // 缓存 60 秒
function getCachedTokenVer(uid) {
  const entry = tokenVerCache.get(uid);
  if (entry && entry.expires > Date.now()) return entry.ver;
  tokenVerCache.delete(uid);
  return null;
}
function setCachedTokenVer(uid, ver) {
  tokenVerCache.set(uid, { ver, expires: Date.now() + CACHE_TTL });
}
function invalidateTokenVerCache(uid) {
  tokenVerCache.delete(uid);
}

/**
 * 校验并解析无状态令牌（格式 uid.exp.tokenver.HMAC-SHA256签名）。
 * 普通令牌额外核对 users.token_ver（带 60s 内存缓存）确认未被吊销；找回票据（tokenver='R'）不查库。
 * @param {string} token 原始令牌串（来自 Cookie 或 Bearer 头）
 * @returns {{uid:number, ver:number}|{uid:number, ticket:true}|null} 通过返回身份对象，无效/过期/被吊销返回 null
 */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const sig = crypto.createHmac('sha256', SECRET).update(parts.slice(0, 3).join('.')).digest('hex');
  if (!safeEq(sig, parts[3])) return null;
  const uid = +parts[0], exp = +parts[1], ver = +parts[2];
  if (!(uid > 0) || exp < Math.floor(Date.now() / 1000)) return null;
  if (parts[2] === 'R') return { uid, ticket: true };
  // P0-2 性能优化：先查缓存，命中则跳过 DB 查询
  let tokenVer = getCachedTokenVer(uid);
  if (tokenVer === null) {
    const row = db.prepare('SELECT token_ver FROM users WHERE id=?').get(uid);
    tokenVer = row ? row.token_ver : -1;
    setCachedTokenVer(uid, tokenVer);
  }
  if (tokenVer === -1 || tokenVer !== ver) return null;
  return { uid, ver };
}
function genCodes() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去易混字符
  const out = [];
  for (let i = 0; i < 10; i++) {
    let s = '';
    for (const b of crypto.randomBytes(8)) s += alphabet[b % alphabet.length];
    out.push(s.slice(0, 4) + '-' + s.slice(4));
  }
  return out;
}

/* ---------- 限流（P1-6 抽至独立模块 rate-limit.js） ---------- */
const { rateOk } = require('./rate-limit');

/* ---------- P1-4 安全响应头（静态与 API 共用，server.js 也引用） ----------
   CSP 定稿依据：
   - script-src 'self'：index.html 两处内联脚本已外置（preload.js / game.js 尾部），无 eval/内联事件
   - style-src 'unsafe-inline'：index.html 大量 style="..." 属性，样式注入风险低，保留
   - img-src data:：favicon 用 data:image/svg+xml
   - connect-src ws: wss:：联机大厅允许用户手填任意 ws:// 地址
   - frame-ancestors 'self'：兼容同源 iframe 页面（不用 DENY） */
const SEC_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "media-src 'self'; connect-src 'self' ws: wss:; worker-src 'self'; frame-ancestors 'self'; " +
    "base-uri 'self'; object-src 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
};

/* ---------- HTTP 工具 ---------- */
function json(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({}, SEC_HEADERS, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, headers || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 256 * 1024) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function cookieToken(req) {
  const h = req.headers.cookie || '';
  const m = h.match(/(?:^|;\s*)owb_token=([0-9a-zA-Z.]+)/);
  return m ? m[1] : null;
}
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function uidFromReq(req) {
  const t = cookieToken(req) || bearer(req);
  const v = t && verifyToken(t);
  return v && !v.ticket ? v.uid : null;
}
function setCookie(req, res, token, maxAge) {
  return { 'Set-Cookie': COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (req_secure(req) ? '; Secure' : '') };
}
function req_secure(req) { return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted; }
function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const h = {};
  if (origin === 'null' || /^https?:\/\/localhost(:\d+)?$/.test(origin) || /^capacitor:\/\//.test(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    h['Access-Control-Allow-Methods'] = 'GET,POST,PUT,OPTIONS';
  }
  return h;
}

/* ---------- 业务 ---------- */
function userByName(name) { return db.prepare('SELECT * FROM users WHERE name=?').get(name); }
function cookieOkName(name) { return typeof name === 'string' && /^[\w\u4e00-\u9fa5-]{2,20}$/.test(name); }

async function handleHTTP(req, res) {
  const p = req.url.split('?')[0];
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, Object.assign({}, SEC_HEADERS, cors)); return res.end(); }
  if (!p.startsWith('/api/')) return false;   // 非 API 交回静态服务
  const ip = (req.socket.remoteAddress || '?').replace(/^::f{4}:/, '');
  const me = uidFromReq(req);
  try {
    const b = (req.method === 'GET') ? {} : await readBody(req);

    if (p === '/api/register' && req.method === 'POST') {
      if (!rateOk('reg:' + ip, 3, 3600 * 1000)) return json(res, 429, { ok: false, msg: '注册过于频繁，请稍后再试' }, cors);
      const { name, pass, sec_q, sec_a } = b;
      if (!cookieOkName(name)) return json(res, 400, { ok: false, msg: '用户名需 2-20 位文字/字母/数字/下划线' }, cors);
      if (typeof pass !== 'string' || pass.length < 8) return json(res, 400, { ok: false, msg: '密码至少 8 位' }, cors);
      if (userByName(name)) return json(res, 400, { ok: false, msg: '该用户名不可用' }, cors);
      const salt = crypto.randomBytes(16).toString('hex');
      const r = db.prepare('INSERT INTO users(name,salt,hash,sec_q,sec_a_hash,created) VALUES(?,?,?,?,?,?)')
        .run(name, salt, hashPass(pass, salt), sec_q || null, sec_a ? sha256(String(sec_a).trim().toLowerCase()) : null, Date.now());
      const uid = Number(r.lastInsertRowid);
      const codes = genCodes();
      for (const c of codes) db.prepare('INSERT INTO recover(uid,code_hash) VALUES(?,?)').run(uid, sha256(c.toUpperCase()));
      const token = signToken(uid, 0, TOKEN_TTL);
      return json(res, 200, { ok: true, name, codes, token }, Object.assign(cors, setCookie(req, res, token, TOKEN_TTL)));
    }

    if (p === '/api/login' && req.method === 'POST') {
      if (!rateOk('log:' + ip, 10, 60 * 1000)) return json(res, 429, { ok: false, msg: '尝试过于频繁，请 1 分钟后再试' }, cors);
      const u = b.name && userByName(String(b.name));
      // 统一失败消息，不泄露账号是否存在
      const fail = () => json(res, 401, { ok: false, msg: '用户名或密码错误' }, cors);
      if (!u) { return fail(); }
      if (u.lock_until > Date.now()) return json(res, 423, { ok: false, msg: '账号已锁定，' + Math.ceil((u.lock_until - Date.now()) / 60000) + ' 分钟后重试' }, cors);
      if (!safeEq(hashPass(String(b.pass || ''), u.salt), u.hash)) {
        const fc = u.fail_cnt + 1;
        const lock = fc >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
        db.prepare('UPDATE users SET fail_cnt=?, lock_until=? WHERE id=?').run(fc >= 5 ? 0 : fc, lock, u.id);
        return lock ? json(res, 423, { ok: false, msg: '密码错误次数过多，账号锁定 15 分钟' }, cors) : fail();
      }
      db.prepare('UPDATE users SET fail_cnt=0, lock_until=0 WHERE id=?').run(u.id);
      const token = signToken(u.id, u.token_ver, TOKEN_TTL);
      return json(res, 200, { ok: true, name: u.name, token }, Object.assign(cors, setCookie(req, res, token, TOKEN_TTL)));
    }

    if (p === '/api/logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, Object.assign(cors, setCookie(req, res, '', 0)));
    }

    if (p === '/api/me') {
      if (!me) return json(res, 401, { ok: false, msg: '未登录' }, cors);
      const u = db.prepare('SELECT name FROM users WHERE id=?').get(me);
      return u ? json(res, 200, { ok: true, name: u.name }, cors) : json(res, 401, { ok: false, msg: '未登录' }, cors);
    }

    if (p === '/api/recover' && req.method === 'POST') {   // 恢复码找回
      if (!rateOk('rec:' + ip, 10, 60 * 1000)) return json(res, 429, { ok: false, msg: '尝试过于频繁' }, cors);
      const u = b.name && userByName(String(b.name));
      if (!u) return json(res, 400, { ok: false, msg: '恢复码无效' }, cors);
      const code = String(b.code || '').toUpperCase().trim();
      const rows = db.prepare('SELECT * FROM recover WHERE uid=? AND used=0').all(u.id);
      const hit = rows.find(r => safeEq(r.code_hash, sha256(code)));
      if (!hit) return json(res, 400, { ok: false, msg: '恢复码无效' }, cors);
      db.prepare('UPDATE recover SET used=1 WHERE id=?').run(hit.id);
      return json(res, 200, { ok: true, ticket: signToken(u.id, 'R', TICKET_TTL) }, cors);
    }

    if (p === '/api/recover_q' && req.method === 'POST') { // 安全问题找回
      if (!rateOk('rec:' + ip, 10, 60 * 1000)) return json(res, 429, { ok: false, msg: '尝试过于频繁' }, cors);
      const u = b.name && userByName(String(b.name));
      if (!u || !u.sec_a_hash || !safeEq(u.sec_a_hash, sha256(String(b.answer || '').trim().toLowerCase()))) {
        return json(res, 400, { ok: false, msg: '答案不正确' }, cors);
      }
      return json(res, 200, { ok: true, ticket: signToken(u.id, 'R', TICKET_TTL) }, cors);
    }

    if (p === '/api/reset' && req.method === 'POST') {     // 票据 → 重置密码（消耗全部剩余恢复码）
      const v = verifyToken(String(b.ticket || ''));
      if (!v || !v.ticket) return json(res, 400, { ok: false, msg: '找回凭证无效或已过期' }, cors);
      if (typeof b.new_pass !== 'string' || b.new_pass.length < 8) return json(res, 400, { ok: false, msg: '新密码至少 8 位' }, cors);
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(v.uid);
      if (!u) return json(res, 400, { ok: false, msg: '账号不存在' }, cors);
      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET salt=?, hash=?, token_ver=token_ver+1, fail_cnt=0, lock_until=0 WHERE id=?').run(salt, hashPass(b.new_pass, salt), u.id);
      invalidateTokenVerCache(u.id);  // P0-2 缓存失效
      const codes = genCodes();
      db.prepare('DELETE FROM recover WHERE uid=?').run(u.id);
      for (const c of codes) db.prepare('INSERT INTO recover(uid,code_hash) VALUES(?,?)').run(u.id, sha256(c.toUpperCase()));
      return json(res, 200, { ok: true, codes }, cors);
    }

    if (p === '/api/password' && req.method === 'POST') {  // 已登录改密（全端吊销）
      if (!me) return json(res, 401, { ok: false, msg: '未登录' }, cors);
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(me);
      if (!safeEq(hashPass(String(b.old_pass || ''), u.salt), u.hash)) return json(res, 401, { ok: false, msg: '原密码错误' }, cors);
      if (typeof b.new_pass !== 'string' || b.new_pass.length < 8) return json(res, 400, { ok: false, msg: '新密码至少 8 位' }, cors);
      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET salt=?, hash=?, token_ver=token_ver+1 WHERE id=?').run(salt, hashPass(b.new_pass, salt), u.id);
      invalidateTokenVerCache(u.id);  // P0-2 缓存失效
      return json(res, 200, { ok: true }, Object.assign(cors, setCookie(req, res, '', 0)));
    }

    if (p === '/api/save' && req.method === 'GET') {
      if (!me) return json(res, 401, { ok: false, msg: '未登录' }, cors);
      const s = db.prepare('SELECT data, rev FROM saves WHERE uid=?').get(me);
      return json(res, 200, { ok: true, data: s ? JSON.parse(s.data) : null, rev: s ? s.rev : 0 }, cors);
    }

    if (p === '/api/save' && req.method === 'PUT') {
      if (!me) return json(res, 401, { ok: false, msg: '未登录' }, cors);
      const cur = db.prepare('SELECT rev, data FROM saves WHERE uid=?').get(me);
      const curRev = cur ? cur.rev : 0;
      if (Number(b.rev) !== curRev) {
        return json(res, 409, { ok: false, conflict: true, data: cur ? JSON.parse(cur.data) : null, rev: curRev }, cors);
      }
      const data = JSON.stringify(b.data || {});
      if (data.length > 200 * 1024) return json(res, 400, { ok: false, msg: '存档过大' }, cors);
      const next = curRev + 1;
      if (cur) db.prepare('UPDATE saves SET data=?, rev=?, updated=? WHERE uid=?').run(data, next, Date.now(), me);
      else db.prepare('INSERT INTO saves(uid,data,rev,updated) VALUES(?,?,?,?)').run(me, data, next, Date.now());
      return json(res, 200, { ok: true, rev: next }, cors);
    }

    return json(res, 404, { ok: false, msg: 'not found' }, cors);
  } catch (e) {
    return json(res, 400, { ok: false, msg: e.message || 'bad request' }, cors);
  }
}

module.exports = { handleHTTP, verifyToken, uidFromReq, ENFORCE, COOKIE, SEC_HEADERS };
