// テスト用：drizzleのマイグレーションをそのまま適用したD1互換のインメモリDB
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function testDatabase() {
  const sql = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../drizzle/', import.meta.url))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    sql.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  const DB = {
    prepare(query) {
      const bind = (args) => ({
        async first() {
          return sql.prepare(query).get(...args) || null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          const result = sql.prepare(query).run(...args);
          return { success: true, meta: { changes: result.changes } };
        },
      });
      return { ...bind([]), bind: (...args) => bind(args) };
    },
  };
  return { sql, DB };
}
