import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCode,
  normalizeCode,
  createCode,
  findCode,
  listCodes,
  reserveCode,
  releaseCode,
  updateCode,
  deleteCode,
  codeUsed,
} from './access-codes.mjs';
import { testDatabase } from './test-db.mjs';
const DAY = '2026-11-02';
test('コードは16桁・読み間違えやすい文字なし・毎回異なる', () => {
  const codes = new Set(Array.from({ length: 200 }, generateCode));
  assert.equal(codes.size, 200);
  for (const c of codes) {
    assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert(!/[01OIL]/.test(c));
  }
  assert.equal(normalizeCode(' abcd-efgh jkmn-pqrs '), 'ABCDEFGHJKMNPQRS');
  for (const bad of ['', 'ABCD', 'ABCD-EFGH-JKMN-PQR0', null, 'x'.repeat(100)])
    assert.equal(normalizeCode(bad), null);
});
test('コード本体はDBに保存しない', async () => {
  const { DB, sql } = testDatabase();
  const { code } = await createCode(DB, { label: 'A社', dailyLimit: 3 });
  const dump = JSON.stringify(sql.prepare('SELECT * FROM access_codes').all());
  assert(!dump.includes(code));
  assert(!dump.includes(normalizeCode(code)));
  assert.equal((await findCode(DB, code)).label, 'A社');
});
test('コード別の上限は同時アクセスでも超えず、戻せる', async () => {
  const { DB } = testDatabase();
  const { code } = await createCode(DB, { label: 'A社', dailyLimit: 3 });
  const row = await findCode(DB, code);
  const results = await Promise.all(Array.from({ length: 10 }, () => reserveCode(DB, row, DAY)));
  assert.equal(results.filter(Boolean).length, 3);
  await releaseCode(DB, row, DAY);
  assert.equal(await codeUsed(DB, row.id, DAY), 2);
});
test('一覧・変更・停止・削除', async () => {
  const { DB, sql } = testDatabase();
  const { id, code } = await createCode(DB, { label: ' A社 ', dailyLimit: 3 });
  await reserveCode(DB, await findCode(DB, code), DAY);
  let [item] = await listCodes(DB, DAY);
  assert.deepEqual(
    { label: item.label, dailyLimit: item.dailyLimit, enabled: item.enabled, used: item.usedToday },
    { label: 'A社', dailyLimit: 3, enabled: true, used: 1 },
  );
  assert(!JSON.stringify(item).includes(code));
  await updateCode(DB, id, { dailyLimit: 10, enabled: false });
  [item] = await listCodes(DB, DAY);
  assert.equal(item.dailyLimit, 10);
  assert.equal(item.enabled, false);
  assert.equal(await findCode(DB, code), null);
  assert.equal(await updateCode(DB, 'missing', { enabled: true }), false);
  await deleteCode(DB, id);
  assert.equal((await listCodes(DB, DAY)).length, 0);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM code_usage').get().n, 0);
});
