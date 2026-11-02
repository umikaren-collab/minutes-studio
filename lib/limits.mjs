// 共有試用の上限と日付の基準。サーバー・管理画面・利用画面はすべてここを参照する。
export const DAILY_LIMIT = 5;

// 日本時間の日付（YYYY-MM-DD）。利用回数は日本時間0時にリセットする。
export const dayInJapan = (now = Date.now()) =>
  new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
