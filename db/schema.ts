import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
});
