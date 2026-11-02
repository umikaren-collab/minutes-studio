import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerCodesGet, ownerCodesPost } from './admin-codes.mjs';
import { findCode } from './access-codes.mjs';
import { testDatabase } from './test-db.mjs';
const owner = { userId: 'owner-id', email: 'owner@example.test' };
const setup = () => {
  const { DB, sql } = testDatabase();
  return { sql, env: { DB, ADMIN_OWNER_EMAIL: 'owner@example.test' } };
};
const req = (value, origin = 'https://app.example.test') =>
  new Request('https://app.example.test/api/admin/codes', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
test('オーナー以外・別サイトからは操作できない', async () => {
  const { env, sql } = setup();
  assert.equal((await ownerCodesGet(null, env)).status, 401);
  const other = { userId: 'x', email: 'other@example.test' };
  assert.equal(
    (await ownerCodesPost(req({ action: 'create', label: 'A', dailyLimit: 3 }), other, env)).status,
    403,
  );
  assert.equal(
    (
      await ownerCodesPost(
        req({ action: 'create', label: 'A', dailyLimit: 3 }, 'https://evil.test'),
        owner,
        env,
      )
    ).status,
    403,
  );
  assert.equal(sql.prepare('SELECT count(*) AS n FROM access_codes').get().n, 0);
});
test('発行したコードは一度だけ返り、一覧には出ない', async () => {
  const { env } = setup();
  const response = await ownerCodesPost(
    req({ action: 'create', label: 'A社 山田さん', dailyLimit: 3 }),
    owner,
    env,
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.match(data.created.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal((await findCode(env.DB, data.created.code)).label, 'A社 山田さん');
  const list = await (await ownerCodesGet(owner, env)).text();
  assert(!list.includes(data.created.code));
  assert.match(list, /A社 山田さん/);
});
test('入力チェックと停止・削除', async () => {
  const { env } = setup();
  for (const bad of [
    { action: 'create', label: '', dailyLimit: 3 },
    { action: 'create', label: 'x'.repeat(41), dailyLimit: 3 },
    { action: 'create', label: 'A', dailyLimit: 0 },
    { action: 'create', label: 'A', dailyLimit: 51 },
    { action: 'create', label: 'A', dailyLimit: 1.5 },
    { action: 'update', id: 'bad', enabled: false },
    { action: 'unknown' },
  ])
    assert.equal((await ownerCodesPost(req(bad), owner, env)).status, 400, JSON.stringify(bad));
  const { created } = await (
    await ownerCodesPost(req({ action: 'create', label: 'A', dailyLimit: 3 }), owner, env)
  ).json();
  let data = await (
    await ownerCodesPost(req({ action: 'update', id: created.id, enabled: false }), owner, env)
  ).json();
  assert.equal(data.codes[0].enabled, false);
  assert.equal(await findCode(env.DB, created.code), null);
  data = await (await ownerCodesPost(req({ action: 'delete', id: created.id }), owner, env)).json();
  assert.equal(data.codes.length, 0);
});
