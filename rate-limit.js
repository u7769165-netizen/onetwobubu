// rate-limit.js — IP 滑动窗口限流（P1-6 从 server-auth.js 抽出）
// 内存实现，重启清零可接受；AUTH_RATE_LIMIT=0 关闭（仅测试环境用，账号锁定逻辑不受影响）。
const RL_ON = process.env.AUTH_RATE_LIMIT !== '0';
const rl = new Map(); // key -> [ts...]

/**
 * 判断某 key 在滑动窗口内是否未超限。
 * @param {string} key      限流键，建议 '<动作>:<IP>'（如 'log:1.2.3.4'）
 * @param {number} max      窗口内允许的最大请求数
 * @param {number} windowMs 窗口时长（毫秒）
 * @returns {boolean} true=放行；false=已超限（同时刷新窗口记录）
 */
function rateOk(key, max, windowMs) {
  if (!RL_ON) return true;
  const now = Date.now();
  const arr = (rl.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { rl.set(key, arr); return false; }
  arr.push(now); rl.set(key, arr); return true;
}

module.exports = { rateOk, RL_ON };
