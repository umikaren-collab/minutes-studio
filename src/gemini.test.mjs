import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, GOOGLE, CHUNK_SIZE, normalizeModel, validKeyShape } from './gemini.mjs';
import { loadKeySettings, saveKeySettings, clearKeySettings } from './key-store.mjs';

const KEY = 'AIza' + 'x'.repeat(35);
const json = (v, status = 200, headers = {}) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const fakeFile = (name, size, type) => new File([new Uint8Array(size)], name, { type });

// Google の Files API と生成APIを真似る
function fakeGoogle({ failGenerate = false, processing = 0 } = {}) {
  const calls = [];
  let n = 0;
  const files = new Map();
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url),
      method = opt.method || 'GET';
    calls.push({ url: u, method, headers: opt.headers || {} });
    if (u === GOOGLE + '/upload/v1beta/files') {
      const id = 'f' + ++n;
      files.set(id, {
        size: Number(opt.headers['X-Goog-Upload-Header-Content-Length']),
        got: 0,
        polls: processing,
      });
      return json({}, 200, {
        'x-goog-upload-url': `${GOOGLE}/upload/v1beta/files?upload_id=${id}`,
      });
    }
    if (u.includes('upload_id=')) {
      const id = new URL(u).searchParams.get('upload_id'),
        f = files.get(id);
      assert.equal(Number(opt.headers['X-Goog-Upload-Offset']), f.got);
      f.got += opt.body.size;
      if (opt.headers['X-Goog-Upload-Command'].includes('finalize')) {
        assert.equal(f.got, f.size);
        return json({
          file: {
            name: 'files/' + id,
            uri: `${GOOGLE}/v1beta/files/${id}`,
            state: f.polls ? 'PROCESSING' : 'ACTIVE',
          },
        });
      }
      return json({});
    }
    if (/\/v1beta\/files\/f\d+$/.test(u)) {
      const id = u.split('/').pop();
      if (method === 'DELETE') {
        files.delete(id);
        return json({});
      }
      const f = files.get(id);
      return json({ state: --f.polls > 0 ? 'PROCESSING' : 'ACTIVE' });
    }
    if (u.endsWith(':countTokens')) return json({ totalTokens: 1000 });
    if (u.endsWith(':generateContent')) {
      if (failGenerate) return json({ error: { message: 'boom' } }, 500);
      return json({
        candidates: [
          {
            content: { parts: [{ text: '思考', thought: true }, { text: '【議事内容】\n本文' }] },
            finishReason: 'STOP',
          },
        ],
      });
    }
    if (/\/v1beta\/models\/[\w.-]+$/.test(u))
      return json({ inputTokenLimit: 1048576, outputTokenLimit: 65536 });
    throw Error('unexpected ' + u);
  };
  return { fetchImpl, calls, files };
}

test('キーの形式とモデル名を確認する', () => {
  assert.equal(validKeyShape(KEY), true);
  assert.equal(validKeyShape('abc'), false);
  assert.equal(normalizeModel('unknown'), 'gemini-3.5-flash-lite');
  assert.equal(normalizeModel('gemini-3.8-flash'), 'gemini-3.8-flash');
});

test('分割アップロード→処理待ち→生成→一時ファイル削除まで行う', async () => {
  const g = fakeGoogle({ processing: 2 });
  const client = createClient(KEY, { fetchImpl: g.fetchImpl });
  const big = fakeFile('録音.m4a', CHUNK_SIZE * 2 + 10, 'audio/mp4');
  const pdf = fakeFile('資料.pdf', 100, 'application/pdf');
  const phases = [];
  const r = await client.generateMinutes({
    files: [big, pdf],
    prompt: '議事録を作って',
    model: 'gemini-3.5-flash-lite',
    pollInterval: 1,
    onProgress: (p) => phases.push(p.phase),
  });
  assert.equal(r.text, '【議事内容】\n本文');
  assert.equal(r.truncated, false);
  assert.equal(g.files.size, 0, 'Google側のファイルが残っていない');
  assert.equal(g.calls.filter((c) => c.url.includes('upload_id=f1')).length, 3);
  assert.ok(phases.includes('processing') && phases.includes('generating'));
  // キーは Google への通信だけに付く
  for (const c of g.calls) assert.ok(c.url.startsWith(GOOGLE));
  const gen = g.calls.find((c) => c.url.endsWith(':generateContent'));
  assert.equal(gen.headers['x-goog-api-key'], KEY);
});

test('生成に失敗しても一時ファイルを削除する', async () => {
  const g = fakeGoogle({ failGenerate: true });
  const client = createClient(KEY, { fetchImpl: g.fetchImpl });
  await assert.rejects(
    client.generateMinutes({
      files: [fakeFile('a.mp3', 50, 'audio/mpeg')],
      prompt: 'x',
      pollInterval: 1,
    }),
    /Google側で一時的なエラー/,
  );
  assert.equal(g.files.size, 0);
});

test('中止したら転送を止めて削除する', async () => {
  const g = fakeGoogle();
  const controller = new AbortController();
  const fetchImpl = async (url, opt) => {
    if (String(url).endsWith(':countTokens')) controller.abort();
    if (opt?.signal?.aborted) throw new DOMException('中止', 'AbortError');
    return g.fetchImpl(url, opt);
  };
  const client = createClient(KEY, { fetchImpl });
  await assert.rejects(
    client.generateMinutes({
      files: [fakeFile('a.mp3', 50, 'audio/mpeg')],
      prompt: 'x',
      signal: controller.signal,
      pollInterval: 1,
    }),
    { name: 'AbortError' },
  );
  assert.equal(g.files.size, 0);
});

test('資料なし（メモのみ）でも作成できる', async () => {
  const g = fakeGoogle();
  const r = await createClient(KEY, { fetchImpl: g.fetchImpl }).generateMinutes({
    files: [],
    prompt: 'メモ',
  });
  assert.match(r.text, /本文/);
  assert.ok(!g.calls.some((c) => c.url.includes('/upload/')));
});

test('キーは「この端末に保存」のときだけ永続保存する', () => {
  const mem = () => {
    const m = new Map();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => m.set(k, v),
      removeItem: (k) => m.delete(k),
      m,
    };
  };
  const env = { localStorage: mem(), sessionStorage: mem() };
  saveKeySettings({ key: KEY, model: 'gemini-3.8-flash', paidTier: true, remember: false }, env);
  assert.equal(env.localStorage.m.size, 0);
  assert.equal(loadKeySettings(env).remember, false);
  saveKeySettings({ key: KEY, model: 'gemini-3.8-flash', paidTier: true, remember: true }, env);
  assert.equal(env.sessionStorage.m.size, 0);
  assert.deepEqual(loadKeySettings(env), {
    key: KEY,
    model: 'gemini-3.8-flash',
    paidTier: true,
    remember: true,
  });
  clearKeySettings(env);
  assert.equal(loadKeySettings(env).key, '');
});
