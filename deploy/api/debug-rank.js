// ===== api/debug-rank.js =====
// 临时诊断：直接打印 zrange 与 get 的原始返回
function kvEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}
async function kvCall(command, args) {
  const { url, token } = kvEnv();
  const enc = encodeURIComponent;
  const path = '/' + [command, ...args.map(enc)].join('/');
  const r = await fetch(url + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  return { status: r.status, body: await r.text() };
}
export default async function handler(req, res) {
  const zr = await kvCall('zrange', ['eyetrack:scores', '0', '49', 'REV', 'WITHSCORES']);
  let detail = null;
  try {
    const arr = JSON.parse(zr.body).result || [];
    if (arr.length >= 1) {
      const firstId = arr[0];
      const g = await kvCall('get', ['eyetrack:score:' + firstId]);
      detail = { id: firstId, get_status: g.status, get_body: g.body };
    }
  } catch (e) {
    detail = { err: String(e) };
  }
  res.statusCode = 200;
  res.json({ zrange_status: zr.status, zrange_body: zr.body, detail });
}
