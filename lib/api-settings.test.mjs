import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import {
  isOwner,
  encryptApiKey,
  decryptApiKey,
  ownerSettingsGet,
  ownerSettingsPost,
  effectiveSettings,
} from './api-settings.mjs';
const owner = { userId: 'signed-owner-id', email: 'owner@example.test' };
const apiKey = 'test_key_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(
    'CREATE TABLE api_settings(id INTEGER PRIMARY KEY, encrypted_key TEXT, iv TEXT, model TEXT NOT NULL, enabled INTEGER NOT NULL, paid_tier INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)',
  );
  const DB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              return sql.prepare(query).get(...args) || null;
            },
            async run() {
              sql.prepare(query).run(...args);
              return { success: true };
            },
          };
        },
        async first() {
          return sql.prepare(query).get() || null;
        },
      };
    },
  };
  return {
    sql,
    env: {
      DB,
      ADMIN_OWNER_EMAIL: 'owner@example.test',
      API_KEY_ENCRYPTION_SECRET: randomBytes(32).toString('base64url'),
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      SHARED_DEMO_ENABLED: 'true',
    },
  };
}
const req = (value, origin = 'https://app.example.test') =>
  new Request('https://app.example.test/api/admin/settings', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
const values = { apiKey, enabled: true, model: 'gemini-3.5-flash-lite' };
const verify = async (url, options) => {
  assert.equal(options.headers['x-goog-api-key'], apiKey);
  assert.match(url, /models\/gemini-3.5-flash-lite$/);
  return Response.json({ name: 'models/gemini-3.5-flash-lite' });
};
test('管理者未設定・未ログイン・他アカウントを拒否する', async () => {
  const { env } = fixture();
  assert(!isOwner(owner, {}));
  assert(!isOwner({ email: owner.email }, env));
  assert(isOwner({ userId: 'signed-owner-id', email: 'OWNER@example.test' }, env));
  for (const [user, status] of [
    [null, 401],
    [{ userId: 'attacker', email: 'other@example.test' }, 403],
  ]) {
    assert.equal((await ownerSettingsGet(user, env)).status, status);
    let called = false;
    assert.equal(
      (
        await ownerSettingsPost(req(values), user, env, async () => {
          called = true;
        })
      ).status,
      status,
    );
    assert(!called);
  }
});
test('管理者でも別サイトからの設定変更を拒否する', async () => {
  const { env, sql } = fixture();
  const response = await ownerSettingsPost(
    req(values, 'https://evil.example.test'),
    owner,
    env,
    verify,
  );
  assert.equal(response.status, 403);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM api_settings').get().n, 0);
});
test('暗号化して保存し、管理用・公開用のレスポンスにキーを返さない', async () => {
  const { env, sql } = fixture();
  const response = await ownerSettingsPost(
    req({ ...values, ownerEmail: 'attacker@example.test' }),
    owner,
    env,
    verify,
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.configured, true);
  assert(!JSON.stringify(data).includes(apiKey));
  const row = sql.prepare('SELECT * FROM api_settings').get();
  assert(row.encrypted_key && !row.encrypted_key.includes(apiKey));
  assert.equal(row.updated_by, owner.userId);
  assert.equal(await decryptApiKey(row, env), apiKey);
  assert.equal((await effectiveSettings(env)).key, apiKey);
  const getText = await (await ownerSettingsGet(owner, env)).text();
  assert(!getText.includes(apiKey));
  assert(!getText.includes(row.encrypted_key));
});
test('キー欄を空にして停止しても保存済みキーを消さない', async () => {
  const { env } = fixture();
  await ownerSettingsPost(req(values), owner, env, verify);
  const response = await ownerSettingsPost(
    req({ apiKey: '', model: values.model, enabled: false }),
    owner,
    env,
    verify,
  );
  assert.equal(response.status, 200);
  const runtime = await effectiveSettings(env);
  assert.equal(runtime.key, apiKey);
  assert.equal(runtime.enabled, false);
});
test('不正なキーや未対応モデルを保存しない', async () => {
  const { env, sql } = fixture();
  assert.equal(
    (await ownerSettingsPost(req({ ...values, model: 'unapproved' }), owner, env, verify)).status,
    400,
  );
  assert.equal(
    (
      await ownerSettingsPost(
        req(values),
        owner,
        env,
        async () => new Response('', { status: 403 }),
      )
    ).status,
    400,
  );
  assert.equal(sql.prepare('SELECT count(*) AS n FROM api_settings').get().n, 0);
});
test('暗号文の改ざん・別の暗号鍵では復号できない', async () => {
  const { env } = fixture();
  const encrypted = await encryptApiKey(apiKey, env);
  assert.equal(await decryptApiKey(encrypted, env), apiKey);
  await assert.rejects(
    decryptApiKey({ ...encrypted, iv: randomBytes(12).toString('base64') }, env),
  );
  await assert.rejects(
    decryptApiKey(encrypted, {
      ...env,
      API_KEY_ENCRYPTION_SECRET: randomBytes(32).toString('base64url'),
    }),
  );
});
test('有料枠の申告を保存し、キーを差し替えたら申告し直すまで無料枠に戻す', async () => {
  const { env } = fixture();
  let response = await ownerSettingsPost(req({ ...values, paidTier: true }), owner, env, verify);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paidTier, true);
  assert.equal((await effectiveSettings(env)).paidTier, true);
  // キー欄が空（モデル・有効設定のみ変更）なら申告を維持する
  response = await ownerSettingsPost(
    req({ apiKey: '', model: values.model, enabled: false }),
    owner,
    env,
    verify,
  );
  assert.equal((await response.json()).paidTier, true);
  // 新しいキーを入れて申告がなければ無料枠扱い
  response = await ownerSettingsPost(req(values), owner, env, verify);
  assert.equal((await response.json()).paidTier, false);
  assert.equal(
    (await ownerSettingsPost(req({ ...values, paidTier: 'yes' }), owner, env, verify)).status,
    400,
  );
});
