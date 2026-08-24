// ===== api/submit.js =====
// EyeTrack 全球排行榜 —— 接收一次游戏成绩并写入 Vercel KV。
// 路由：POST /api/submit
// 入参（JSON body）：{ mode, maxLevel, accuracy }
//   mode: 'practice' | 'campaign' | 'daily'
//   maxLevel: 到达的关卡（整数，>=1）
//   accuracy: 准确率百分比（0~100，整数）
// 出参：{ ok: true, id: string }
//
// 实现说明：零第三方依赖。直接用 Vercel 注入的环境变量
// KV_REST_API_URL / KV_REST_API_TOKEN，通过 KV REST API（Node 内置 fetch）读写，
// 避免 @vercel/kv 包未安装导致 FUNCTION_INVOCATION_FAILED。

const LIST_KEY = 'eyetrack:scores';          // ZSet 结构：score = maxLevel*1000 + accuracy
const META_PREFIX = 'eyetrack:score:';        // 存每条明细（mode / accuracy / createdAt / anonTag）

function kvEnv() {
  // Vercel 原生 KV 与 Upstash for Redis 两种集成注入的变量名不同，二选一即可
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}
async function kvGet(path, opts) {
  const { url, token } = kvEnv();
  const r = await fetch(url + path, {
    ...opts,
    headers: { ...(opts && opts.headers), Authorization: 'Bearer ' + token },
  });
  if (!r.ok) throw new Error('KV ' + r.status);
  return r;
}

// 单实例简单速率限制（防止刷榜）：同一 IP 60 秒内最多 10 次提交
const _rate = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const w = _rate.get(ip) || [];
  const recent = w.filter((t) => now - t < 60000);
  recent.push(now);
  _rate.set(ip, recent);
  return recent.length > 10;
}

function validBody(b) {
  if (!b || typeof b !== 'object') return null;
  const mode = String(b.mode || '').toLowerCase();
  if (!['practice', 'campaign', 'daily'].includes(mode)) return null;
  const maxLevel = Math.max(1, Math.min(9999, Math.floor(Number(b.maxLevel) || 1)));
  const accuracy = Math.max(0, Math.min(100, Math.floor(Number(b.accuracy) || 0)));
  return { mode, maxLevel, accuracy };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    res.statusCode = 429;
    return res.json({ ok: false, error: 'rate_limited' });
  }
  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (e) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'bad_json' });
  }
  const v = validBody(body);
  if (!v) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'invalid_params' });
  }

  // KV 未绑定：优雅降级，不阻断游戏
  if (!kvEnv()) {
    res.statusCode = 200;
    // 调试：列出可用的 KV/Redis/Upstash 环境变量名（不暴露值），便于排查注入问题
    const availableKeys = Object.keys(process.env).filter((k) =>
      /^(KV_|UPSTASH_|REDIS_)/i.test(k)
    );
    return res.json({
      ok: false,
      error: 'storage_unavailable',
      debug_keys: availableKeys.length ? availableKeys : 'none',
    });
  }

  try {
    const id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const score = v.maxLevel * 1000 + v.accuracy;
    const createdAt = new Date().toISOString();
    const anonTag = 'Player#' + String(Math.floor(1000 + Math.random() * 9000));

    // ZSet 写入
    await kvGet('/zadd/' + LIST_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, member: id }),
    });
    // 明细写入（KV 的 set 接受任意 JSON 字符串值）
    await kvGet('/set/' + META_PREFIX + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: v.mode,
        maxLevel: v.maxLevel,
        accuracy: v.accuracy,
        createdAt,
        anonTag,
      }),
    });
    return res.json({ ok: true, id });
  } catch (e) {
    res.statusCode = 200;
    return res.json({ ok: false, error: 'storage_unavailable' });
  }
}
