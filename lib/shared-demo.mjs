import { effectiveSettings, normalizeModel } from './api-settings.mjs';
import { DAILY_LIMIT, dayInJapan } from './limits.mjs';
import { CODE_HEADER, codeUsed, findCode } from './access-codes.mjs';
export { DAILY_LIMIT, dayInJapan };
export function demoModel(env) {
  return normalizeModel(env.GEMINI_MODEL);
}
// 全利用者合計の1回分を確保する。上限に達していればnull。
export async function reserveUsage(db, day, limit = DAILY_LIMIT) {
  return db
    .prepare(
      'INSERT INTO demo_usage (day, used) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used < ? RETURNING used',
    )
    .bind(day, limit)
    .first();
}
export async function globalUsed(db, day) {
  const row = await db.prepare('SELECT used FROM demo_usage WHERE day = ?').bind(day).first();
  return row?.used || 0;
}
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const FREE_TIER =
  '無料枠のAPIキーでは利用できません。管理者が有料枠（課金を有効にしたプロジェクト）のキーを設定するまでお待ちください。';

// 利用画面向けの状態。招待コード（ヘッダー）があれば、そのコードの残り回数も返す。
export async function demoStatus(env, request) {
  const day = dayInJapan();
  if (!env.DB)
    return json({
      ready: false,
      remaining: 0,
      limit: DAILY_LIMIT,
      day,
      reason: '共有機能の準備中です。',
    });
  const runtime = await effectiveSettings(env);
  const limit = runtime.dailyLimit;
  const globalRemaining = Math.max(0, limit - (await globalUsed(env.DB, day)));
  const base = { limit, day, model: runtime.model, paidTier: runtime.paidTier };
  if (!runtime.key || !runtime.enabled)
    return json({ ...base, ready: false, remaining: 0, reason: '共有機能の準備中です。' });
  // 無料枠のキーでは利用不可（有料枠の申告があるときだけ利用できる）
  if (!runtime.paidTier) return json({ ...base, ready: false, remaining: 0, reason: FREE_TIER });
  const raw = request?.headers.get(CODE_HEADER);
  if (!raw)
    return json({
      ...base,
      ready: false,
      needsCode: true,
      remaining: 0,
      reason: '利用コードを入力してください。コードは管理者からお知らせします。',
    });
  const code = await findCode(env.DB, raw);
  if (!code)
    return json({
      ...base,
      ready: false,
      needsCode: true,
      codeInvalid: true,
      remaining: 0,
      reason: '利用コードが正しくないか、停止されています。管理者にお問い合わせください。',
    });
  const codeRemaining = Math.max(0, code.daily_limit - (await codeUsed(env.DB, code.id, day)));
  return json({
    ...base,
    ready: true,
    codeLimit: code.daily_limit,
    codeRemaining,
    globalRemaining,
    // 実際に使える回数は、コード別と全体の少ないほう
    remaining: Math.min(codeRemaining, globalRemaining),
  });
}
