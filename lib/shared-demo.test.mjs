import test from 'node:test';
import assert from 'node:assert/strict';
import { dayInJapan, demoModel, demoStatus } from './shared-demo.mjs';
import { createCode, reserveCode, findCode, updateCode } from './access-codes.mjs';
import { testDatabase } from './test-db.mjs';
const paidEnv = (DB) => ({
  DB,
  GEMINI_API_KEY: 'k',
  SHARED_DEMO_ENABLED: 'true',
  GEMINI_PAID_TIER: 'true',
});
const status = async (env, code) =>
  (
    await demoStatus(
      env,
      new Request('https://app.example.test/api/demo-status', {
        headers: code ? { 'X-Access-Code': code } : {},
      }),
    )
  ).json();
test('日本時間0時のリセット境界', () => {
  assert.equal(dayInJapan(Date.parse('2026-11-02T14:59:59Z')), '2026-11-02');
  assert.equal(dayInJapan(Date.parse('2026-11-02T15:00:00Z')), '2026-11-03');
});
test('共有モデルはサーバーの許可済み設定のみ使用', () => {
  assert.equal(demoModel({ GEMINI_MODEL: 'other' }), 'gemini-3.5-flash-lite');
  assert.equal(demoModel({ GEMINI_MODEL: 'gemini-3.8-flash' }), 'gemini-3.8-flash');
});
test('無料枠のキーでは、コードがあっても利用不可', async () => {
  const { DB } = testDatabase();
  const { code } = await createCode(DB, { label: 'A社 山田さん', dailyLimit: 3 });
  const free = await status({ ...paidEnv(DB), GEMINI_PAID_TIER: 'false' }, code);
  assert.equal(free.ready, false);
  assert.match(free.reason, /無料枠/);
});
test('コードなし・誤ったコード・停止中のコードでは利用不可', async () => {
  const { DB } = testDatabase();
  const env = paidEnv(DB);
  const none = await status(env);
  assert.equal(none.ready, false);
  assert.equal(none.needsCode, true);
  const wrong = await status(env, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  assert.equal(wrong.codeInvalid, true);
  const { id, code } = await createCode(DB, { label: 'A社', dailyLimit: 3 });
  await updateCode(DB, id, { enabled: false });
  assert.equal((await status(env, code)).codeInvalid, true);
});
test('残り回数はコード別と全体の少ないほう', async () => {
  const { DB } = testDatabase();
  const env = paidEnv(DB);
  const { code } = await createCode(DB, { label: 'A社', dailyLimit: 3 });
  // 小文字・ハイフンなしでも受け付ける
  let s = await status(env, code.toLowerCase().replaceAll('-', ''));
  assert.equal(s.ready, true);
  // 管理用メモ（相手の名前）は利用者に返さない
  assert.equal(s.label, undefined);
  assert.equal(s.limit, 5);
  assert.equal(s.remaining, 3);
  const row = await findCode(DB, code);
  await reserveCode(DB, row, dayInJapan());
  s = await status(env, code);
  assert.equal(s.codeRemaining, 2);
  assert.equal(s.remaining, 2);
  DB.prepare('INSERT INTO demo_usage (day, used) VALUES (?, 4)').bind(dayInJapan()).run();
  s = await status(env, code);
  assert.equal(s.globalRemaining, 1);
  assert.equal(s.remaining, 1);
});
