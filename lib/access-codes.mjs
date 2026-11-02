// 招待コード：オーナーが相手ごとに発行し、コードごとに1日の利用回数を制限する。
// コード本体は発行時に一度だけ表示し、DBにはSHA-256ハッシュだけを保存する。
import { Buffer } from 'node:buffer';
import { dayInJapan } from './limits.mjs';

// 読み間違えやすい文字（0/O、1/I/L）を除いた31文字 × 16桁（約79ビット）
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 16;
export const CODE_HEADER = 'X-Access-Code';
export const CODE_LIMIT_MAX = 50;
export const LABEL_MAX = 40;

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2));
  let raw = '';
  // 31で割り切れる範囲の値だけを使い、文字の偏りをなくす（248 = 31 × 8）
  for (const b of bytes) {
    if (b < 248) raw += ALPHABET[b % 31];
    if (raw.length === CODE_LENGTH) break;
  }
  if (raw.length < CODE_LENGTH) return generateCode();
  return raw.match(/.{4}/g).join('-');
}

// 入力のゆれ（小文字・ハイフン・空白）を吸収する。形式外ならnull。
export function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const raw = value.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const c of raw) if (!ALPHABET.includes(c)) return null;
  return raw;
}

export const hashCode = async (normalized) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('minutes-studio:' + normalized)),
  ).toString('hex');

// 有効なコードの行を返す。無効・停止中・形式外はnull。
export async function findCode(db, value) {
  const normalized = normalizeCode(value);
  if (!db || !normalized) return null;
  const row = await db
    .prepare('SELECT * FROM access_codes WHERE code_hash = ?')
    .bind(await hashCode(normalized))
    .first();
  return row && row.enabled === 1 ? row : null;
}

export async function codeUsed(db, codeId, day = dayInJapan()) {
  const row = await db
    .prepare('SELECT used FROM code_usage WHERE code_id = ? AND day = ?')
    .bind(codeId, day)
    .first();
  return row?.used || 0;
}

// コード別の1回分を確保する。上限に達していればnull。
export async function reserveCode(db, code, day) {
  return db
    .prepare(
      'INSERT INTO code_usage (code_id, day, used) VALUES (?, ?, 1) ON CONFLICT(code_id, day) DO UPDATE SET used=used+1 WHERE used < ? RETURNING used',
    )
    .bind(code.id, day, code.daily_limit)
    .first();
}

// 全体の上限に達したときなど、確保したコード別の1回分を戻す。
export async function releaseCode(db, code, day) {
  await db
    .prepare('UPDATE code_usage SET used = used - 1 WHERE code_id = ? AND day = ? AND used > 0')
    .bind(code.id, day)
    .run();
}

export async function touchCode(db, code) {
  await db
    .prepare('UPDATE access_codes SET last_used_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), code.id)
    .run();
}

// ---- 管理用 ----
export async function listCodes(db, day = dayInJapan()) {
  const rows = await db
    .prepare(
      'SELECT c.id, c.label, c.daily_limit, c.enabled, c.created_at, c.last_used_at, COALESCE(u.used, 0) AS used_today FROM access_codes c LEFT JOIN code_usage u ON u.code_id = c.id AND u.day = ? ORDER BY c.created_at DESC',
    )
    .bind(day)
    .all();
  return (rows.results || []).map((r) => ({
    id: r.id,
    label: r.label,
    dailyLimit: r.daily_limit,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at || null,
    usedToday: r.used_today,
  }));
}

export function validLabel(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= LABEL_MAX;
}
export function validCodeLimit(value) {
  return Number.isInteger(value) && value >= 1 && value <= CODE_LIMIT_MAX;
}

// 新しいコードを発行し、コード本体を一度だけ返す。
export async function createCode(db, { label, dailyLimit }) {
  const code = generateCode();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO access_codes (id, code_hash, label, daily_limit, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    )
    .bind(
      id,
      await hashCode(normalizeCode(code)),
      label.trim(),
      dailyLimit,
      new Date().toISOString(),
    )
    .run();
  return { id, code };
}

export async function updateCode(db, id, { label, dailyLimit, enabled }) {
  const row = await db.prepare('SELECT * FROM access_codes WHERE id = ?').bind(id).first();
  if (!row) return false;
  await db
    .prepare('UPDATE access_codes SET label = ?, daily_limit = ?, enabled = ? WHERE id = ?')
    .bind(
      label === undefined ? row.label : label.trim(),
      dailyLimit === undefined ? row.daily_limit : dailyLimit,
      enabled === undefined ? row.enabled : enabled ? 1 : 0,
      id,
    )
    .run();
  return true;
}

export async function deleteCode(db, id) {
  await db.prepare('DELETE FROM code_usage WHERE code_id = ?').bind(id).run();
  await db.prepare('DELETE FROM access_codes WHERE id = ?').bind(id).run();
}
