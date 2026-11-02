'use client';
import { useState } from 'react';

type Code = {
  id: string;
  label: string;
  dailyLimit: number;
  enabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  usedToday: number;
};

const jst = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function CodesPanel({
  initial,
  codeLimitMax,
}: {
  initial: Code[] | null;
  codeLimitMax: number;
}) {
  const [codes, setCodes] = useState<Code[]>(initial ?? []);
  const [label, setLabel] = useState('');
  const [dailyLimit, setDailyLimit] = useState('3');
  const [issued, setIssued] = useState<{ label: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initial ? '' : 'コードの一覧を読み込めませんでした。');
  const [error, setError] = useState(!initial);

  async function send(body: object) {
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      const response = await fetch('/api/admin/codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        codes: Code[];
        created?: { id: string; code: string };
      };
      if (!response.ok || !data.success) throw Error(data.error || '保存できませんでした。');
      setCodes(data.codes);
      return data;
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : '保存できませんでした。');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const data = await send({ action: 'create', label, dailyLimit: Number(dailyLimit) });
    if (data) {
      if (data.created) setIssued({ label: label.trim(), code: data.created.code });
      setCopied(false);
      setLabel('');
    }
  }

  async function copy() {
    if (!issued) return;
    const text = `議事録工房の利用コード：${issued.code}\n${location.origin}/`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setMessage('コピーできませんでした。コードを選択してコピーしてください。');
    }
  }

  return (
    <section className="admin-form codes-panel">
      <h2>招待コード</h2>
      <p className="admin-note">
        使ってもらう相手ごとにコードを発行します。コードを持っている人だけが議事録を作成できます。相手ごとに1日の回数を決められ、いつでも停止できます。
      </p>

      <form onSubmit={create} className="code-create">
        <label>
          相手の名前（管理用のメモ）
          <input
            className="admin-text"
            value={label}
            maxLength={40}
            required
            disabled={busy}
            placeholder="例：A社 山田さん"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label>
          1日の回数
          <input
            className="admin-number"
            type="number"
            inputMode="numeric"
            min={1}
            max={codeLimitMax}
            step={1}
            required
            disabled={busy}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '処理中…' : 'コードを発行'}
        </button>
      </form>

      {issued && (
        <div className="code-issued" role="status">
          <b>「{issued.label}」のコードを発行しました</b>
          <code>{issued.code}</code>
          <small>
            このコードは今だけ表示されます。閉じると再表示できません（忘れた場合は削除して発行し直してください）。
          </small>
          <div className="code-actions">
            <button type="button" onClick={copy}>
              {copied ? 'コピーしました' : 'コードとURLをコピー'}
            </button>
            <button type="button" className="quiet" onClick={() => setIssued(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      <p
        role="status"
        aria-live="polite"
        className={error ? 'admin-message admin-error' : 'admin-message'}
      >
        {message}
      </p>

      {codes.length === 0 ? (
        <p className="admin-note">まだコードはありません。</p>
      ) : (
        <ul className="code-list">
          {codes.map((c) => (
            <li key={c.id} className={c.enabled ? '' : 'is-off'}>
              <div className="code-head">
                <b>{c.label}</b>
                <span className={c.enabled ? 'code-state on' : 'code-state'}>
                  {c.enabled ? '利用中' : '停止中'}
                </span>
              </div>
              <div className="code-meta">
                本日 {c.usedToday} / {c.dailyLimit} 回
                {c.lastUsedAt ? ` ・ 最終利用 ${jst(c.lastUsedAt)}` : ' ・ 未使用'}
                {` ・ 発行 ${jst(c.createdAt)}`}
              </div>
              <div className="code-actions">
                <label className="code-limit">
                  1日
                  <select
                    value={c.dailyLimit}
                    disabled={busy}
                    onChange={(e) =>
                      send({ action: 'update', id: c.id, dailyLimit: Number(e.target.value) })
                    }
                  >
                    {Array.from(new Set([1, 2, 3, 5, 10, 20, codeLimitMax, c.dailyLimit]))
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n}回
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => send({ action: 'update', id: c.id, enabled: !c.enabled })}
                >
                  {c.enabled ? '停止' : '再開'}
                </button>
                <button
                  type="button"
                  className="quiet danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(`${c.label} のコードを削除します。元に戻せません。よろしいですか？`)
                    )
                      send({ action: 'delete', id: c.id });
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
