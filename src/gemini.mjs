// ブラウザから Google Gemini API へ直接送る。サーバーは経由しない。
import { mediaType } from './file-import.mjs';

export const GOOGLE = 'https://generativelanguage.googleapis.com';
export const MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite（速い・安い／推奨）' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash（高精度）' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（旧モデル）' },
];
export const DEFAULT_MODEL = MODELS[0].id;
export const normalizeModel = (m) => (MODELS.some((x) => x.id === m) ? m : DEFAULT_MODEL);
// 再開可能アップロードの分割サイズ（256KBの倍数であること）
export const CHUNK_SIZE = 8 * 1024 ** 2;
export const INPUT_LIMIT = 1000000;
export const OUTPUT_LIMIT = 32768;
export const FALLBACK_OUTPUT_LIMIT = 8192;
// 大きいファイルの転送中に通信が途切れたときの再試行回数（1つの分割ごと）
export const CHUNK_RETRIES = 3;

const abortError = () => new DOMException('中止', 'AbortError');
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const stop = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });

export function validKeyShape(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{30,60}$/.test(key.trim());
}

// Google のエラーを利用者向けの日本語にする
export async function explain(response, fallback) {
  let message = '';
  try {
    message = (await response.json())?.error?.message || '';
  } catch {}
  if (response.status === 400 && /API key/i.test(message))
    return 'APIキーが正しくありません。設定を確認してください。';
  if (response.status === 403)
    return 'このAPIキーでは利用できません（権限・APIの有効化を確認してください）。';
  if (response.status === 404)
    return '選択したモデルが見つかりません。設定でモデルを変更してください。';
  if (response.status === 429)
    return 'APIの利用上限に達しました。時間をおくか、Google側の利用枠・課金設定を確認してください。';
  if (response.status >= 500)
    return 'Google側で一時的なエラーが発生しました。少し待ってからお試しください。';
  return fallback + (message ? `（${message.slice(0, 200)}）` : '');
}

export function createClient(key, { fetchImpl = (...a) => fetch(...a), retryDelay = 1000 } = {}) {
  const apiKey = String(key || '').trim();
  const authHeaders = { 'x-goog-api-key': apiKey };

  async function modelInfo(model, signal) {
    const r = await fetchImpl(`${GOOGLE}/v1beta/models/${normalizeModel(model)}`, {
      headers: authHeaders,
      signal,
    });
    if (!r.ok) throw Error(await explain(r, 'APIキーを確認できませんでした。'));
    return r.json();
  }

  async function limits(model, signal) {
    try {
      const info = await modelInfo(model, signal);
      const input = Number(info.inputTokenLimit),
        output = Number(info.outputTokenLimit);
      return {
        input:
          Number.isSafeInteger(input) && input > 0 ? Math.min(input, INPUT_LIMIT) : INPUT_LIMIT,
        output:
          Number.isSafeInteger(output) && output > 0
            ? Math.min(output, OUTPUT_LIMIT)
            : FALLBACK_OUTPUT_LIMIT,
      };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return { input: INPUT_LIMIT, output: FALLBACK_OUTPUT_LIMIT };
    }
  }

  async function deleteFile(name, keepalive = false) {
    if (!/^files\/[\w-]+$/.test(name || '')) return true;
    try {
      const r = await fetchImpl(`${GOOGLE}/v1beta/${name}`, {
        method: 'DELETE',
        headers: authHeaders,
        keepalive,
      });
      return r.ok || r.status === 404;
    } catch {
      return false;
    }
  }

  // 再開可能アップロードで、Google に届いた位置を問い合わせる。分からなければ null。
  async function received(location, signal) {
    try {
      const r = await fetchImpl(location, {
        method: 'POST',
        headers: { 'X-Goog-Upload-Command': 'query' },
        signal,
      });
      if (!r.ok) return null;
      if (r.headers.get('x-goog-upload-status') === 'final') {
        const file = (await r.json())?.file;
        return file ? { file } : null;
      }
      const size = Number(r.headers.get('x-goog-upload-size-received'));
      return Number.isSafeInteger(size) && size >= 0 ? { offset: size } : null;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return null;
    }
  }

  async function uploadFile(file, index, { signal, onChunk }) {
    const mime = mediaType(file);
    if (!mime) throw Error(`${file.name}：未対応の形式です。`);
    const start = await fetchImpl(`${GOOGLE}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size),
        'X-Goog-Upload-Header-Content-Type': mime,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: `minutes-${Date.now()}-${index}` } }),
      signal,
    });
    if (!start.ok) throw Error(await explain(start, 'アップロードを開始できませんでした。'));
    const location = start.headers.get('x-goog-upload-url');
    if (!location || new URL(location).origin !== GOOGLE)
      throw Error(
        'アップロード先を取得できませんでした。ブラウザーの拡張機能などが通信を妨げていないか確認してください。',
      );
    let offset = 0,
      uploaded = null,
      attempts = 0;
    while (offset < file.size && !uploaded) {
      if (signal?.aborted) throw abortError();
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const final = end === file.size;
      let r = null;
      try {
        r = await fetchImpl(location, {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Offset': String(offset),
            'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload',
          },
          body: file.slice(offset, end),
          signal,
        });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
      if (r?.ok) {
        attempts = 0;
        if (final) uploaded = (await r.json())?.file;
        offset = end;
        onChunk(offset);
        continue;
      }
      // 通信切れ・Google側の一時エラーは、届いた位置を問い合わせて続きから送り直す
      const retryable = !r || r.status >= 500 || r.status === 408 || r.status === 429;
      if (!retryable || ++attempts > CHUNK_RETRIES)
        throw Error(
          r
            ? await explain(r, `${file.name} の転送に失敗しました。`)
            : `${file.name} の転送中に通信が途切れました。通信状況を確認してください。`,
        );
      await sleep(retryDelay * 2 ** (attempts - 1), signal);
      const resumed = await received(location, signal);
      if (!resumed)
        throw Error(`${file.name} の転送中に通信が途切れました。通信状況を確認してください。`);
      if (resumed.file) uploaded = resumed.file;
      else offset = resumed.offset;
      onChunk(uploaded ? file.size : offset);
    }
    if (!uploaded?.name || !uploaded?.uri)
      throw Error(`${file.name} の転送結果を確認できませんでした。`);
    return { name: uploaded.name, uri: uploaded.uri, mime, state: uploaded.state };
  }

  // 1GB 近い動画は Google 側の処理に時間がかかるため、最大30分待つ
  async function waitActive(uploaded, { signal, timeoutMs = 30 * 60 * 1000, interval = 2500 }) {
    const until = Date.now() + timeoutMs;
    for (const f of uploaded) {
      while (f.state !== 'ACTIVE') {
        if (f.state === 'FAILED')
          throw Error('AI側でファイルを処理できませんでした。資料の形式を確認してください。');
        if (Date.now() > until)
          throw Error('AI側のファイル処理が完了しませんでした。資料を分けてお試しください。');
        await sleep(interval, signal);
        const r = await fetchImpl(`${GOOGLE}/v1beta/${f.name}`, { headers: authHeaders, signal });
        if (!r.ok) throw Error(await explain(r, 'ファイルの処理状況を確認できませんでした。'));
        f.state = (await r.json()).state;
      }
    }
  }

  // 資料を送り、議事録本文を返す。終了時（失敗・中止を含む）に Google 側の一時ファイルを消す。
  async function generateMinutes({
    files = [],
    template = null,
    prompt,
    model,
    signal,
    onProgress = () => {},
    onFiles = () => {},
    pollInterval,
  }) {
    model = normalizeModel(model);
    const payload = [
      ...files.map((file) => ({ file, role: 'source' })),
      ...(template ? [{ file: template, role: 'template' }] : []),
    ];
    const total = payload.reduce((n, p) => n + p.file.size, 0);
    const uploaded = [];
    try {
      onProgress({ phase: 'start' });
      let done = 0;
      for (const [index, { file, role }] of payload.entries()) {
        onProgress({ phase: 'upload', index, totalFiles: payload.length, loaded: done, total });
        const u = await uploadFile(file, index, {
          signal,
          onChunk: (offset) =>
            onProgress({
              phase: 'upload',
              index,
              totalFiles: payload.length,
              loaded: done + offset,
              total,
            }),
        });
        u.role = role;
        uploaded.push(u);
        onFiles(uploaded.map((x) => x.name));
        done += file.size;
      }
      if (uploaded.length) {
        onProgress({ phase: 'processing' });
        await waitActive(uploaded, { signal, interval: pollInterval });
      }
      onProgress({ phase: 'generating' });
      const parts = [];
      for (const f of uploaded) {
        if (f.role === 'template')
          parts.push({
            text: '次のPDFは議事録の書式見本です。会議の事実には含めず、項目構成のみ参照してください。',
          });
        parts.push({ file_data: { mime_type: f.mime, file_uri: f.uri } });
      }
      parts.push({ text: prompt });
      const contents = [{ role: 'user', parts }];
      const base = `${GOOGLE}/v1beta/models/${model}`;
      const headers = { ...authHeaders, 'Content-Type': 'application/json' };
      const lim = await limits(model, signal);
      const count = await fetchImpl(`${base}:countTokens`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ contents }),
        signal,
      });
      if (!count.ok) throw Error(await explain(count, '資料の分量を確認できませんでした。'));
      const usage = await count.json();
      if (!Number.isFinite(usage.totalTokens) || usage.totalTokens > lim.input)
        throw Error('選択モデルの入力上限を超えています。資料を分けて作成してください。');
      const r = await fetchImpl(`${base}:generateContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: lim.output,
            ...(model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal,
      });
      if (!r.ok) throw Error(await explain(r, 'AIの作成に失敗しました。'));
      const data = await r.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts
        ?.filter((x) => !x.thought)
        .map((x) => x.text || '')
        .join('\n')
        .trim();
      if (!text)
        throw Error('本文を生成できませんでした。資料の内容やAPIの利用状態を確認してください。');
      return { text, truncated: candidate.finishReason === 'MAX_TOKENS' };
    } finally {
      const results = await Promise.all(uploaded.map((u) => deleteFile(u.name)));
      onFiles([]);
      if (!results.every(Boolean))
        onProgress({
          phase: 'cleanup-warning',
          message:
            'Google側の一時ファイルの削除を確認できませんでした（48時間で自動削除されます）。',
        });
    }
  }

  return { modelInfo, generateMinutes, deleteFile };
}
