'use client';
import { useState } from 'react';
type Settings = {
  configured: boolean;
  model: string;
  enabled: boolean;
  paidTier: boolean;
  updatedAt: string | null;
  dailyLimit: number;
};
export default function SettingsForm({ initial }: { initial: Settings | null }) {
  const [state, setState] = useState(initial);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(initial?.model || 'gemini-3.5-flash-lite');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [paidTier, setPaidTier] = useState(initial?.paidTier ?? false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('APIキーの利用可否を確認して保存しています…');
    setError(false);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key, model, enabled, paidTier }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw Error(data.error || '保存できませんでした。');
      setState(data);
      setKey('');
      setMessage('設定を保存しました。公開の試用画面で利用できます。');
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : '保存できませんでした。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="admin-form" onSubmit={save}>
      <div className="admin-status">
        <b>APIキー：{state?.configured ? '登録済み（内容は非表示）' : '未登録'}</b>
        {state?.configured && (
          <small>
            利用枠：{state.paidTier ? '有料枠（課金有効）' : '無料枠（利用画面に注意を表示中）'}
          </small>
        )}
        {state?.updatedAt && (
          <small>
            最終更新：
            {new Date(state.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            （日本時間）
          </small>
        )}
      </div>
      <label>
        Gemini APIキー
        <input
          aria-label="Gemini APIキー"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          disabled={busy}
          onChange={(e) => {
            setKey(e.target.value);
            // 別のキーに差し替えるときは、そのキーの課金状態を改めて確認してもらう
            if (e.target.value) setPaidTier(false);
          }}
          placeholder={
            state?.configured
              ? '変更するときだけ新しいキーを入力'
              : 'Google AI StudioのAPIキーを入力'
          }
          maxLength={256}
        />
      </label>
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
        Google AI StudioでAPIキーを取得・確認 ↗
      </a>
      <label>
        共有試用で使うモデル
        <select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
          <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite</option>
          <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash（既存利用者向け）</option>
        </select>
      </label>
      <label className="admin-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        共有試用を有効にする（全員合計1日{state?.dailyLimit ?? 5}回）
      </label>
      <label className="admin-checkbox">
        <input
          type="checkbox"
          checked={paidTier}
          disabled={busy}
          onChange={(e) => setPaidTier(e.target.checked)}
        />
        このキーは、課金（Cloud Billing）を有効にしたGoogle Cloudプロジェクトのものです
      </label>
      <p className="admin-note">
        無料枠のキーでは、送信した録音・資料がGoogleの製品改善に利用される場合があります。社内会議や個人情報を含む資料を扱う場合は、AI
        Studioでプロジェクトの課金を有効にしてから、このチェックを入れてください。チェックがない間は、利用画面に「機密資料を送信しない」よう警告を表示します。
      </p>
      <p className="admin-note">
        このキーのAPI利用料金は、キーの所有者に適用されます。有料APIの利用枠・無料枠はGoogle側で別に管理されます。
      </p>
      <button type="submit" disabled={busy}>
        {busy ? '確認・保存中…' : '設定を保存'}
      </button>
      <p
        role="status"
        aria-live="polite"
        className={error ? 'admin-message admin-error' : 'admin-message'}
      >
        {message}
      </p>
    </form>
  );
}
