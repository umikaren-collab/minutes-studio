// 利用回数の上限と日付の基準。サーバー・管理画面・利用画面はすべてここを参照する。
// 全利用者合計の1日の上限回数の既定値（管理画面で1〜GLOBAL_LIMIT_MAXの範囲で変更できる）
export const DAILY_LIMIT = 5;
export const GLOBAL_LIMIT_MAX = 200;

// 日本時間の日付（YYYY-MM-DD）。利用回数は日本時間0時にリセットする。
export const dayInJapan = (now = Date.now()) =>
  new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
