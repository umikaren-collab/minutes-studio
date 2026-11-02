import { Buffer } from 'node:buffer';
import { DAILY_LIMIT } from './limits.mjs';
export const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash'];
export const normalizeModel = (model) => (MODELS.includes(model) ? model : 'gemini-3.5-flash-lite');
const aad = new TextEncoder().encode('minutes-studio:gemini-api-key:v1');
export function isOwner(user, env) {
  return !!(
    user?.userId &&
    user?.email &&
    env.ADMIN_OWNER_EMAIL &&
    user.email.trim().toLowerCase() === env.ADMIN_OWNER_EMAIL.trim().toLowerCase()
  );
}
async function wrappingKey(env) {
  const bytes = Buffer.from(env.API_KEY_ENCRYPTION_SECRET || '', 'base64url');
  if (bytes.byteLength !== 32) throw Error('Key protection unavailable');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function encryptApiKey(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    await wrappingKey(env),
    new TextEncoder().encode(value),
  );
  return {
    encrypted_key: Buffer.from(ciphertext).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
  };
}
export async function decryptApiKey(row, env) {
  if (!row?.encrypted_key || !row.iv) return '';
  const decoded = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(row.iv, 'base64'), additionalData: aad },
    await wrappingKey(env),
    Buffer.from(row.encrypted_key, 'base64'),
  );
  return new TextDecoder().decode(decoded);
}
export async function storedSettings(env) {
  if (!env.DB) return null;
  return await env.DB.prepare(
    'SELECT id, encrypted_key, iv, model, enabled, paid_tier, updated_at FROM api_settings WHERE id = 1',
  ).first();
}
export async function effectiveSettings(env) {
  const row = await storedSettings(env);
  return {
    key: row?.encrypted_key ? await decryptApiKey(row, env) : env.GEMINI_API_KEY || '',
    model: normalizeModel(row?.model || env.GEMINI_MODEL),
    enabled: row ? row.enabled === 1 : env.SHARED_DEMO_ENABLED === 'true',
    paidTier: paidTierOf(row, env),
  };
}
// 有料枠（課金を有効にしたGoogle Cloudプロジェクト）のキーかどうか。
// 無料枠では送信内容がGoogleの製品改善に使われる場合があるため、利用画面の警告に使う。
// Google側から自動判定できないので、オーナーが管理画面で申告する。
function paidTierOf(row, env) {
  return row?.encrypted_key ? row.paid_tier === 1 : env.GEMINI_PAID_TIER === 'true';
}
export async function settingsState(env) {
  const row = await storedSettings(env);
  return {
    configured: !!(row?.encrypted_key || env.GEMINI_API_KEY),
    model: normalizeModel(row?.model || env.GEMINI_MODEL),
    enabled: row ? row.enabled === 1 : env.SHARED_DEMO_ENABLED === 'true',
    paidTier: paidTierOf(row, env),
    updatedAt: row?.updated_at || null,
    dailyLimit: DAILY_LIMIT,
  };
}
export const privateJson = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
export async function ownerSettingsGet(user, env) {
  if (!isOwner(user, env))
    return privateJson({ error: '管理者としてのログインが必要です。' }, user ? 403 : 401);
  try {
    return privateJson(await settingsState(env));
  } catch {
    return privateJson({ error: '設定を読み込めません。' }, 503);
  }
}
export async function ownerSettingsPost(request, user, env, upstream = fetch) {
  if (!isOwner(user, env))
    return privateJson({ error: '管理者としてのログインが必要です。' }, user ? 403 : 401);
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(request.url).origin)
    return privateJson({ error: '管理画面から操作してください。' }, 403);
  if (!env.DB || !env.API_KEY_ENCRYPTION_SECRET)
    return privateJson({ error: '管理機能の準備が完了していません。' }, 503);
  if (
    !request.headers.get('Content-Type')?.startsWith('application/json') ||
    Number(request.headers.get('Content-Length') || 0) > 4096
  )
    return privateJson({ error: '入力形式を確認してください。' }, 400);
  let value;
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw Error();
    value = JSON.parse(raw);
  } catch {
    return privateJson({ error: '入力内容を確認してください。' }, 400);
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !MODELS.includes(value.model) ||
    typeof value.enabled !== 'boolean' ||
    (value.apiKey !== undefined && typeof value.apiKey !== 'string') ||
    (value.paidTier !== undefined && typeof value.paidTier !== 'boolean')
  )
    return privateJson({ error: 'モデルと利用設定を確認してください。' }, 400);
  const entered = (value.apiKey || '').trim();
  if (entered && !/^[A-Za-z0-9_-]{20,256}$/.test(entered))
    return privateJson({ error: 'APIキーの形式を確認してください。' }, 400);
  try {
    const old = await storedSettings(env);
    const currentKey =
      entered || (old?.encrypted_key ? await decryptApiKey(old, env) : env.GEMINI_API_KEY || '');
    if (!currentKey && value.enabled)
      return privateJson({ error: '共有試用を開始するにはAPIキーを入力してください。' }, 400);
    if (currentKey && (entered || value.model !== (old?.model || env.GEMINI_MODEL))) {
      const verified = await upstream(
        'https://generativelanguage.googleapis.com/v1beta/models/' + value.model,
        { headers: { 'x-goog-api-key': currentKey }, signal: AbortSignal.timeout(20000) },
      );
      if (!verified.ok)
        return privateJson(
          {
            error:
              'APIキー、または選択モデルの利用権限を確認してください。設定は変更していません。',
          },
          400,
        );
    }
    // キーを差し替えたときは、改めて申告がない限り無料枠として扱う。
    const paidTier =
      typeof value.paidTier === 'boolean' ? value.paidTier : entered ? false : old?.paid_tier === 1;
    const encrypted = entered
      ? await encryptApiKey(entered, env)
      : { encrypted_key: old?.encrypted_key || null, iv: old?.iv || null };
    await env.DB.prepare(
      'INSERT INTO api_settings (id, encrypted_key, iv, model, enabled, paid_tier, updated_at, updated_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key, iv=excluded.iv, model=excluded.model, enabled=excluded.enabled, paid_tier=excluded.paid_tier, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
    )
      .bind(
        encrypted.encrypted_key,
        encrypted.iv,
        value.model,
        value.enabled ? 1 : 0,
        paidTier ? 1 : 0,
        new Date().toISOString(),
        user.userId,
      )
      .run();
    return privateJson({ success: true, ...(await settingsState(env)) });
  } catch {
    return privateJson(
      { error: '設定を保存できませんでした。時間をおいて再度お試しください。' },
      503,
    );
  }
}
