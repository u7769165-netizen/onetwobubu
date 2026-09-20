/* auth.js — 账号系统客户端：登录/注册/找回界面、联机门禁、云存档同步
   加载顺序：… → net.js → auth.js → game.js（本文件只依赖前序全局，game.js 绑定段调用 authEnsureNet） */
const AUTH_APK = !!window.Capacitor;          // APK 跨源：走 Bearer；网页同源：走 httpOnly Cookie
let authName = null;                          // 当前登录用户名，null=游客
let authToken = '';                           // APK 端令牌（网页端恒空，Cookie 自动携带）
let authAfter = 'title';                      // 登录成功后回跳界面
let authRev = 0;                              // 云存档修订号（乐观锁）
let authTicket = '';                          // 找回流程的一次性票据
let authUploadTimer = 0, authBusy = false;

/* ---------- API 封装 ---------- */
function authApi(path, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_APK && authToken) headers.Authorization = 'Bearer ' + authToken;
  return fetch(path, {
    method: method || 'GET', headers, credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(r => r.json().then(j => ({ code: r.status, j })).catch(() => ({ code: r.status, j: { ok: false, msg: '服务器响应异常' } })));
}
function authWsToken() { return (AUTH_APK && authToken) ? authToken : ''; }

/* ---------- 登录态与门禁 ---------- */
function authEnsureNet() {
  if (authName) showScreen('net');
  else authOpen('login', 'net');
}
function authOpen(tab, after) {
  authAfter = after || 'title';
  showScreen('auth');
  authShowTab(tab || 'login');
}
function authShowTab(tab) {
  document.getElementById('auPCode').classList.add('hidden');
  document.getElementById('auPReset').classList.add('hidden');
  ['login', 'reg', 'rec', 'acct'].forEach(t => {
    const panel = document.getElementById('auP' + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.classList.toggle('hidden', t !== tab);
    const btn = document.getElementById('auT' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('primary', t === tab);
  });
  authErr('');
}
function authErr(msg) {
  const e = document.getElementById('auErr');
  e.textContent = msg || '';
  e.classList.toggle('hidden', !msg);
}
function authApplyLogin(j) {
  authName = j.name;
  if (AUTH_APK && j.token) { authToken = j.token; try { localStorage.setItem('onetwobubu_token', j.token); } catch (e) {} }
  authUpdateChip();
  authSyncOnLogin();
}
function authLogout() {
  authApi('/api/logout', 'POST', {});
  authName = null; authToken = '';
  try { localStorage.removeItem('onetwobubu_token'); } catch (e) {}
  authRev = 0;
  authUpdateChip();
  authErr(''); authShowTab('login');
}
function authUpdateChip() {
  const chip = document.getElementById('authChip');
  if (chip) chip.textContent = authName ? ('👤 ' + authName) : '👤 登录账号';
  if (chip) chip.classList.toggle('logged', !!authName);
  const who = document.getElementById('auWhoName');
  if (who) who.textContent = authName || '游客（未登录）';
}
function authShowReset() {
  document.getElementById('auPRec').classList.add('hidden');
  document.getElementById('auPReset').classList.remove('hidden');
  authErr('验证通过，请设置新密码（至少 8 位）');
}
function authOnNeedAuth(msg) {   // WS 中继拒绝未登录建房/加入
  if (net.ws) { try { net.ws.onclose = null; net.ws.close(); } catch (e) {} net.ws = null; }
  net.connected = false;
  showScreen('net');
  document.getElementById('netStatus').textContent = '请先登录账号（' + (msg || '联机需要登录') + '）';
  authOpen('login', 'net');
}

/* ---------- 云存档：合并 + 防抖上传（进度只进不退） ---------- */
function authMergeSave(local, cloud) {
  if (!cloud || typeof cloud !== 'object') return local;
  const out = JSON.parse(JSON.stringify(cloud));
  out.unlocked = Math.max(local.unlocked | 0, cloud.unlocked | 0);
  out.bonusStars = Math.max(local.bonusStars | 0, cloud.bonusStars | 0);
  out.love = Math.max(local.love | 0, cloud.love | 0);
  out.best = Object.assign({}, cloud.best || {});
  for (const k in local.best) out.best[k] = Math.max(out.best[k] | 0, local.best[k] | 0);
  out.stars = Object.assign({}, cloud.stars || {});
  for (const k in local.stars) out.stars[k] = Math.max(out.stars[k] | 0, local.stars[k] | 0);
  out.subs = Object.assign({}, cloud.subs || {});
  for (const k in local.subs) out.subs[k] = out.subs[k] || local.subs[k];
  out.heartLv = Object.assign({}, cloud.heartLv || {});
  for (const k in local.heartLv) out.heartLv[k] = Math.max(out.heartLv[k] | 0, local.heartLv[k] | 0);
  out.loveTiers = Object.assign({}, cloud.loveTiers || {});
  for (const k in local.loveTiers) out.loveTiers[k] = Math.max(out.loveTiers[k] | 0, local.loveTiers[k] | 0);
  out.loveStats = Object.assign({}, cloud.loveStats || {}, local.loveStats || {});
  for (const k in out.loveStats) out.loveStats[k] = Math.max(local.loveStats?.[k] | 0, cloud.loveStats?.[k] | 0);
  const ps = new Set((cloud.photos || []).concat(local.photos || []));
  out.photos = Array.from(ps).sort((a, b) => a - b);
  out.album = cloud.album || local.album;
  out.settings = Object.assign({}, local.settings, cloud.settings || {});
  return out;
}
function authSyncOnLogin() {
  authApi('/api/save').then(({ j }) => {
    if (!j.ok) return;
    if (j.data) {
      save = authMergeSave(save, j.data);
      persistSave();
      authRev = j.rev;
    }
    authUpload();
  });
}
function authQueueUpload() {
  if (!authName) return;
  clearTimeout(authUploadTimer);
  authUploadTimer = setTimeout(authUpload, 2000);
}
function authUpload() {
  if (!authName || authBusy) return;
  authBusy = true;
  authApi('/api/save', 'PUT', { data: save, rev: authRev }).then(({ j }) => {
    authBusy = false;
    if (j.ok) { authRev = j.rev; }
    else if (j.conflict) {
      save = authMergeSave(save, j.data);
      persistSave();
      authRev = j.rev;
      authQueueUpload();
    }
  }).catch(() => { authBusy = false; });
}

/* ---------- 界面事件绑定（DOM 就绪：本文件在 body 末尾脚本区加载） ---------- */
(function () {
  const $ = id => document.getElementById(id);
  ['auTLogin', 'auTReg', 'auTRec', 'auTAcct'].forEach((id, i) => {
    const el = $(id); if (el) el.addEventListener('click', () => authShowTab(['login', 'reg', 'rec', 'acct'][i]));
  });
  $('authBackBtn').addEventListener('click', () => showScreen('title'));
  $('auLoginBtn').addEventListener('click', () => {
    const name = $('auName').value.trim(), pass = $('auPass').value;
    if (!name || !pass) return authErr('请输入用户名和密码');
    $('auLoginBtn').disabled = true;
    authApi('/api/login', 'POST', { name, pass }).then(({ j }) => {
      $('auLoginBtn').disabled = false;
      if (!j.ok) return authErr(j.msg);
      authApplyLogin(j);
      if (authAfter === 'net') showScreen('net'); else showScreen('title');
    });
  });
  $('auRegBtn').addEventListener('click', () => {
    const name = $('rgName').value.trim(), pass = $('rgPass').value;
    if (pass !== $('rgPass2').value) return authErr('两次输入的密码不一致');
    $('auRegBtn').disabled = true;
    authApi('/api/register', 'POST', { name, pass, sec_q: $('rgQ').value.trim() || null, sec_a: $('rgA').value.trim() || null }).then(({ j }) => {
      $('auRegBtn').disabled = false;
      if (!j.ok) return authErr(j.msg);
      const box = $('auCodesList');
      box.innerHTML = '';
      j.codes.forEach(c => { const s = document.createElement('span'); s.className = 'au-code'; s.textContent = c; box.appendChild(s); });
      $('auPReg').classList.add('hidden');
      $('auPCode').classList.remove('hidden');
      authApplyLogin(j);
    });
  });
  $('auCodesOkBtn').addEventListener('click', () => {
    $('auPCode').classList.add('hidden');
    showScreen(authAfter === 'net' ? 'net' : 'title');
  });
  $('auRecCodeBtn').addEventListener('click', () => {
    authApi('/api/recover', 'POST', { name: $('rcName').value.trim(), code: $('rcCode').value.trim() }).then(({ j }) => {
      if (!j.ok) return authErr(j.msg);
      authTicket = j.ticket; authShowReset();
    });
  });
  $('auRecQBtn').addEventListener('click', () => {
    authApi('/api/recover_q', 'POST', { name: $('rcName').value.trim(), answer: $('rcAns').value }).then(({ j }) => {
      if (!j.ok) return authErr(j.msg);
      authTicket = j.ticket; authShowReset();
    });
  });
  $('auResetBtn').addEventListener('click', () => {
    const p1 = $('rsPass').value;
    if (p1 !== $('rsPass2').value) return authErr('两次输入的密码不一致');
    authApi('/api/reset', 'POST', { ticket: authTicket, new_pass: p1 }).then(({ j }) => {
      if (!j.ok) return authErr(j.msg);
      authTicket = '';
      $('auPReset').classList.add('hidden');
      const box = $('auCodesList');   // 展示换新的恢复码（与注册同款面板，仅此次可见）
      box.innerHTML = '';
      (j.codes || []).forEach(c => { const s = document.createElement('span'); s.className = 'au-code'; s.textContent = c; box.appendChild(s); });
      $('auPCode').classList.remove('hidden');
      authErr('');
    });
  });
  $('auLogoutBtn').addEventListener('click', authLogout);
  $('auChangeBtn').addEventListener('click', () => {
    authApi('/api/password', 'POST', { old_pass: $('cpOld').value, new_pass: $('cpNew').value }).then(({ j }) => {
      if (!j.ok) return authErr(j.msg);
      authErr('密码已修改，所有设备需重新登录');
      authName = null; authToken = ''; authUpdateChip();
      authShowTab('login');
    });
  });
  const chip = $('authChip');
  if (chip) chip.addEventListener('click', () => authOpen(authName ? 'acct' : 'login', 'title'));
})();

/* ---------- 启动：恢复登录态（Cookie 或 APK 本地令牌） ---------- */
(function () {
  if (AUTH_APK) { try { authToken = localStorage.getItem('onetwobubu_token') || ''; } catch (e) {} }
  authApi('/api/me').then(({ j }) => {
    if (j.ok) { authName = j.name; authUpdateChip(); authSyncOnLogin(); }
    else if (AUTH_APK) { authToken = ''; try { localStorage.removeItem('onetwobubu_token'); } catch (e) {} }
  });
  authUpdateChip();
})();

/* 包装 persistSave：任何本地存档写入后，登录态下防抖同步云端 */
(function () {
  const _origPersistSave = persistSave;
  persistSave = function () { _origPersistSave(); authQueueUpload(); };
})();
