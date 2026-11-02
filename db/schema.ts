import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const demoUsage = sqliteTable('demo_usage', {
  day: text('day').primaryKey(),
  used: integer('used').notNull().default(0),
});
export const apiSettings = sqliteTable('api_settings', {
  id: integer('id').primaryKey(),
  encryptedKey: text('encrypted_key'),
  iv: text('iv'),
  model: text('model').notNull(),
  enabled: integer('enabled').notNull(),
  paidTier: integer('paid_tier').notNull().default(0),
  // 全利用者合計の1日の上限回数
  dailyLimit: integer('daily_limit').notNull().default(5),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export const uploadJobs = sqliteTable('upload_jobs', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  state: text('state').notNull(),
  filesJson: text('files_json').notNull(),
  model: text('model').notNull(),
  day: text('day').notNull(),
  expiresAt: integer('expires_at').notNull(),
  codeId: text('code_id'),
});
// 招待コード（コード本体は保存せず、ハッシュのみ）
export const accessCodes = sqliteTable('access_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  label: text('label').notNull(),
  dailyLimit: integer('daily_limit').notNull(),
  enabled: integer('enabled').notNull(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
});
// 招待コードごとの1日の利用回数（日本時間の日付）
export const codeUsage = sqliteTable(
  'code_usage',
  {
    codeId: text('code_id').notNull(),
    day: text('day').notNull(),
    used: integer('used').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.codeId, t.day] })],
);
