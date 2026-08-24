// ===== api/rank.js =====
// EyeTrack 全球排行榜 —— 返回 Top N 榜单，并按玩家成绩计算全球百分位。
// 路由：GET /api/rank?mode=campaign&maxLevel=12&accuracy=85
//   mode: 可选，过滤模式；不传返回全模式混合榜
//   maxLevel / accuracy: 可选，传入则计算该成绩对应的百分位
// 出参：{ ok, total, top: [{rank, anonTag, mode, maxLevel, accuracy}], percentile }
//
// 实现说明：零第三方依赖。直接用 Vercel 注入的环境变量
// KV_REST_API_URL / KV_REST_API_TOKEN，通过 KV REST API（Node 内置 fetch）读写。
// 空榜时 total=0, top=[], percentile=null，前端诚实显示 "Be the first to rank!"。

const LIST_KEY = 'eyetrack:scores';
const META_PREFIX = 'eyetrack:score:';

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

function clampInt(n, min, max, dflt) {
  const x = parseInt(n, 10);
  if (isNaN(x)) return dflt;
  return Math.max(min, Math.min(max, x));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  const url = new URL(req.url, 'http://localhost');
  const mode = url.searchParams.get('mode');
  const maxLevel = url.searchParams.get('maxLevel');
  const accuracy = url.searchParams.get('accuracy');

  // KV 未绑定：返回空榜，前端诚实显示
  if (!kvEnv()) {
    return res.json({ ok: true, total: 0, top: [], percentile: null });
  }

  try {
    // 取 Top 50（ZSet 按 score 降序）—— withscores=1 返回 [member, score, ...]
    const zr = await kvGet('/zrange/' + LIST_KEY + '/0/49?rev=true&withscores=true');
    const zarr = await zr.json();
    const totalR = await kvGet('/zcard/' + LIST_KEY);
    const total = await totalR.json();

    const top = [];
    // zarr 形如 [member, score, member, score, ...]
    for (let i = 0; i < zarr.length - 1; i += 2) {
      const id = zarr[i];
      const metaR = await kvGet('/get/' + META_PREFIX + id);
      const meta = await metaR.json();
      if (!meta || typeof meta !== 'object') continue;
      if (mode && meta.mode !== mode) continue; // 模式过滤
      top.push({
        rank: top.length + 1,
        anonTag: meta.anonTag,
        mode: meta.mode,
        maxLevel: meta.maxLevel,
        accuracy: meta.accuracy,
      });
      if (top.length >= 50) break;
    }

    let percentile = null;
    if (maxLevel !== null && accuracy !== null && total > 0) {
      const lvl = clampInt(maxLevel, 1, 9999, 1);
      const acc = clampInt(accuracy, 0, 100, 0);
      const score = lvl * 1000 + acc;
      // 比当前 score 严格低的成员数：zcount key -inf (score-1)
      const zcR = await kvGet('/zcount/' + LIST_KEY + '/-inf/' + (score - 1));
      const lower = await zcR.json();
      percentile = Math.floor((Number(lower) / Number(total)) * 100);
    }

    return res.json({ ok: true, total, top, percentile });
  } catch (e) {
    // 存储不可用时返回空榜，前端诚实显示
    return res.json({ ok: true, total: 0, top: [], percentile: null });
  }
}
