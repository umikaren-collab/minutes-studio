'use client';
import { useState } from 'react';
type Settings = {
  configured: boolean;
  model: string;
  enabled: boolean;
  paidTier: boolean;
  updatedAt: string | null;
  dailyLimit: number;
  dailyLimitMax?: number;
};
export default function SettingsForm({ initial }: { initial: Settings | null }) {
  const [state, setState] = useState(initial);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(initial?.model || 'gemini-3.5-flash-lite');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [paidTier, setPaidTier] = useState(initial?.paidTier ?? false);
  const [dailyLimit, setDailyLimit] = useState(String(initial?.dailyLimit ?? 5));
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
        body: JSON.stringify({
          apiKey: key,
          model,
          enabled,
          paidTier,
          dailyLimit: Number(dailyLimit),
        }),
      });
      const data = (await response.json()) as Settings & { success?: boolean; error?: string };
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
            利用枠：{state.paidTier ? '有料枠（課金有効）' : '無料枠（このままでは利用できません）'}
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
        議事録作成に使うモデル
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
        利用を受け付ける（招待コードを持っている人が作成できる状態にする）
      </label>
      <label>
        全員合計の1日の上限回数
        <input
          className="admin-number"
          type="number"
          inputMode="numeric"
          min={1}
          max={state?.dailyLimitMax ?? 200}
          step={1}
          required
          value={dailyLimit}
          disabled={busy}
          onChange={(e) => setDailyLimit(e.target.value)}
        />
      </label>
      <p className="admin-note">
        招待コードごとの回数とは別に、全員の合計がこの回数に達するとその日は停止します。API料金の上限の目安として設定してください（日本時間0時にリセット）。
      </p>
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
        無料枠のキーでは、送信した録音・資料がGoogleの製品改善に利用される場合があるため、このアプリでは使用できません。AI
        Studioでプロジェクトの課金を有効にしてから、このチェックを入れてください。チェックがないと利用を受け付けられません。
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
