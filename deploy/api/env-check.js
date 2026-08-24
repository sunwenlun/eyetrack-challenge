// ===== api/env-check.js =====
// 临时诊断：列出函数运行时里所有 KV/Redis/Upstash 相关环境变量名（不暴露值）
export default async function handler(req, res) {
  const matched = Object.keys(process.env).filter((k) =>
    /^(KV_|UPSTASH_|REDIS_)/i.test(k)
  );
  res.statusCode = 200;
  return res.json({
    ok: true,
    matched_keys: matched.length ? matched : 'none',
    total_env_count: Object.keys(process.env).length,
  });
}
