import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { requireChatGPTUser, chatGPTSignOutPath } from '../chatgpt-auth';
import { isOwner, settingsState } from '../../lib/api-settings.mjs';
import SettingsForm from './settings-form';
import CodesPanel from './codes-panel';
import { listCodes, CODE_LIMIT_MAX } from '../../lib/access-codes.mjs';
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
  let codes = null;
  try {
    initial = await settingsState(env);
  } catch {}
  try {
    if (env.DB) codes = await listCodes(env.DB);
  } catch {}
  return (
    <main className="admin-shell">
      <Link href="/">← 議事録工房へ戻る</Link>
      <span className="admin-badge">オーナー専用</span>
      <h1>共有APIの管理</h1>
      <p>
        APIキー・利用モデル・共有の開始／停止・招待コードを管理します。一般の利用者は、この画面や設定保存APIを利用できません。
      </p>
      <SettingsForm initial={initial} />
      <CodesPanel initial={codes} codeLimitMax={CODE_LIMIT_MAX} />
      <p className="admin-note">
        APIキーは送信時にGoogleのモデル情報APIで利用可否を確認し、暗号化して保存します。保存済みのキーの全文は表示しません。利用回数は日本時間0時にリセットします。利用者には、発行した招待コードとこのサイトのURLを伝えてください。
      </p>
      <a href={chatGPTSignOutPath('/')} target="_top">
        管理用ログインを終了
      </a>
    </main>
  );
}
