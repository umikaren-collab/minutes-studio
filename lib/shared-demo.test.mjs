import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dayInJapan, demoModel, demoStatus, DAILY_LIMIT } from './shared-demo.mjs';
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(
    'CREATE TABLE demo_usage(day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0); CREATE TABLE api_settings(id INTEGER PRIMARY KEY, encrypted_key TEXT, iv TEXT, model TEXT NOT NULL, enabled INTEGER NOT NULL, paid_tier INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)',
  );
  return {
    prepare(query) {
      return {
        async first() {
          return sql.prepare(query).get() || null;
        },
        bind(...args) {
          return {
            async first() {
              return sql.prepare(query).get(...args) || null;
            },
          };
        },
      };
    },
  };
}
test('日本時間0時のリセット境界', () => {
  assert.equal(dayInJapan(Date.parse('2026-11-02T14:59:59Z')), '2026-11-02');
  assert.equal(dayInJapan(Date.parse('2026-11-02T15:00:00Z')), '2026-11-03');
});
test('共有モデルはサーバーの許可済み設定のみ使用', () => {
  assert.equal(demoModel({ GEMINI_MODEL: 'other' }), 'gemini-3.5-flash-lite');
  assert.equal(demoModel({ GEMINI_MODEL: 'gemini-3.8-flash' }), 'gemini-3.8-flash');
});
test('利用状況に上限回数と有料枠の申告を含める', async () => {
  const DB = database();
  const free = await (
    await demoStatus({ DB, GEMINI_API_KEY: 'k', SHARED_DEMO_ENABLED: 'true' })
  ).json();
  assert.equal(free.limit, DAILY_LIMIT);
  assert.equal(free.remaining, DAILY_LIMIT);
  assert.equal(free.paidTier, false);
  const paid = await (
    await demoStatus({
      DB,
      GEMINI_API_KEY: 'k',
      SHARED_DEMO_ENABLED: 'true',
      GEMINI_PAID_TIER: 'true',
    })
  ).json();
  assert.equal(paid.ready, true);
  assert.equal(paid.paidTier, true);
});
