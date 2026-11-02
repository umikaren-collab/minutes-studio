import { effectiveSettings, normalizeModel } from './api-settings.mjs';
import { DAILY_LIMIT, dayInJapan } from './limits.mjs';
export { DAILY_LIMIT, dayInJapan };
export function demoModel(env) {
  return normalizeModel(env.GEMINI_MODEL);
}
export async function reserveUsage(db, day) {
  return db
    .prepare(
      'INSERT INTO demo_usage (day, used) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used < ? RETURNING used',
    )
    .bind(day, DAILY_LIMIT)
    .first();
}
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function demoStatus(env) {
  const day = dayInJapan();
  if (!env.DB)
    return json({
      ready: false,
      remaining: 0,
      limit: DAILY_LIMIT,
      day,
      reason: '共有機能の準備中です。',
    });
  const row = await env.DB.prepare('SELECT used FROM demo_usage WHERE day = ?').bind(day).first();
  const runtime = await effectiveSettings(env);
  return json({
    ready: !!runtime.key && runtime.enabled,
    remaining: Math.max(0, DAILY_LIMIT - (row?.used || 0)),
    limit: DAILY_LIMIT,
    day,
    model: runtime.model,
    paidTier: runtime.paidTier,
  });
}
