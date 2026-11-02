'use client';
import { useState } from 'react';
type Settings = {
  configured: boolean;
  model: string;
  enabled: boolean;
  updatedAt: string | null;
  dailyLimit: number;
};
export default function SettingsForm({ initial }: { initial: Settings | null }) {
  const [state, setState] = useState(initial);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(initial?.model || 'gemini-3.5-flash-lite');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
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
        body: JSON.stringify({ apiKey: key, model, enabled }),
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
          onChange={(e) => setKey(e.target.value)}
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
        共有試用を有効にする（全員合計1日5回）
      </label>
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
