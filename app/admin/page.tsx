import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { requireChatGPTUser, chatGPTSignOutPath } from '../chatgpt-auth';
import { isOwner, settingsState } from '../../lib/api-settings.mjs';
import { DAILY_LIMIT } from '../../lib/limits.mjs';
import SettingsForm from './settings-form';
import './admin.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'API管理 | 議事録工房' };
export default async function Admin() {
  const user = await requireChatGPTUser('/admin');
  if (!isOwner(user, env))
    return (
      <main className="admin-shell">
        <h1>このアカウントには管理権限がありません</h1>
        <p>サイトのオーナーだけがAPI設定を変更できます。</p>
        <a href={chatGPTSignOutPath('/admin')} target="_top">
          別のChatGPTアカウントでログインする
        </a>
        <Link href="/">議事録工房へ戻る</Link>
      </main>
    );
  let initial = null;
  try {
    initial = await settingsState(env);
  } catch {}
  return (
    <main className="admin-shell">
      <Link href="/">← 議事録工房へ戻る</Link>
      <span className="admin-badge">オーナー専用</span>
      <h1>共有APIの管理</h1>
      <p>
        APIキー・利用モデル・共有試用の開始／停止を設定します。一般の利用者は、この画面や設定保存APIを利用できません。
      </p>
      <SettingsForm initial={initial} />
      <p className="admin-note">
        APIキーは送信時にGoogleのモデル情報APIで利用可否を確認し、暗号化して保存します。保存済みのキーの全文は表示しません。全利用者合計で1日
        {DAILY_LIMIT}
        回、日本時間0時にリセットします。キー登録後は、公開の試用画面からご利用ください。
      </p>
      <a href={chatGPTSignOutPath('/')} target="_top">
        管理用ログインを終了
      </a>
    </main>
  );
}
