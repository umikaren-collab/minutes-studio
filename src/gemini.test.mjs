import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createClient,
  GOOGLE,
  CHUNK_SIZE,
  CHUNK_RETRIES,
  normalizeModel,
  validKeyShape,
} from './gemini.mjs';
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

// 再開可能アップロードの「途中で失敗→届いた位置を問い合わせ→続きから送る」を真似る
function flakyUpload(failures) {
  // failures: 何回目の分割送信で、どう失敗させるか（kind: throw | 503 | 400、commit: 失敗前に届いたバイト数）
  let got = 0,
    size = 0,
    sends = 0,
    finished = null,
    queries = 0;
  const offsets = [];
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url),
      cmd = opt.headers?.['X-Goog-Upload-Command'];
    if (u === GOOGLE + '/upload/v1beta/files') {
      size = Number(opt.headers['X-Goog-Upload-Header-Content-Length']);
      return json({}, 200, { 'x-goog-upload-url': `${GOOGLE}/upload/v1beta/files?upload_id=x` });
    }
    if (u.includes('upload_id=') && cmd === 'query') {
      queries++;
      if (finished) return json({ file: finished }, 200, { 'x-goog-upload-status': 'final' });
      return json({}, 200, {
        'x-goog-upload-status': 'active',
        'x-goog-upload-size-received': String(got),
      });
    }
    if (u.includes('upload_id=')) {
      const offset = Number(opt.headers['X-Goog-Upload-Offset']);
      offsets.push(offset);
      assert.equal(offset, got, '届いた位置から送り直している');
      const fail = failures[sends++];
      if (fail) {
        got += fail.commit || 0;
        if (fail.finalize) {
          got = size;
          finished = { name: 'files/x', uri: GOOGLE + '/v1beta/files/x', state: 'ACTIVE' };
        }
        if (fail.kind === 'throw') throw new TypeError('Failed to fetch');
        return json({ error: { message: 'x' } }, fail.kind === '503' ? 503 : 400);
      }
      got += opt.body.size;
      if (cmd.includes('finalize')) {
        assert.equal(got, size);
        finished = { name: 'files/x', uri: GOOGLE + '/v1beta/files/x', state: 'ACTIVE' };
        return json({ file: finished });
      }
      return json({});
    }
    if (u.endsWith('/v1beta/files/x')) return json({});
    if (u.endsWith(':countTokens')) return json({ totalTokens: 10 });
    if (u.endsWith(':generateContent'))
      return json({
        candidates: [{ content: { parts: [{ text: '本文' }] }, finishReason: 'STOP' }],
      });
    if (/\/v1beta\/models\/[\w.-]+$/.test(u)) return json({});
    throw Error('unexpected ' + u);
  };
  return { fetchImpl, offsets, stats: () => ({ queries, got }) };
}
const run = (g, size = CHUNK_SIZE * 3) =>
  createClient(KEY, { fetchImpl: g.fetchImpl, retryDelay: 1 }).generateMinutes({
    files: [fakeFile('会議.mp4', size, 'video/mp4')],
    prompt: 'x',
    pollInterval: 1,
  });

test('通信が途切れても、届いた位置から送り直して完了する', async () => {
  // 2回目の送信で半分だけ届いて切断、3回目はGoogle側の一時エラー
  const g = flakyUpload([null, { kind: 'throw', commit: CHUNK_SIZE / 2 }, { kind: '503' }]);
  const r = await run(g);
  assert.equal(r.text, '本文');
  assert.deepEqual(g.offsets, [
    0,
    CHUNK_SIZE,
    CHUNK_SIZE * 1.5,
    CHUNK_SIZE * 1.5,
    CHUNK_SIZE * 2.5,
  ]);
  assert.equal(g.stats().queries, 2);
});

test('最後の送信で完了していたら、送り直さずに完了扱いにする', async () => {
  const g = flakyUpload([null, null, { kind: 'throw', finalize: true }]);
  assert.equal((await run(g)).text, '本文');
  assert.equal(g.offsets.length, 3);
});

test('再試行の上限を超えたら止め、一時エラー以外はすぐに止める', async () => {
  const many = flakyUpload(Array.from({ length: CHUNK_RETRIES + 1 }, () => ({ kind: '503' })));
  await assert.rejects(run(many), /Google側で一時的なエラー/);
  assert.equal(many.offsets.length, CHUNK_RETRIES + 1);
  const bad = flakyUpload([{ kind: '400' }]);
  await assert.rejects(run(bad), /転送に失敗しました/);
  assert.equal(bad.offsets.length, 1);
  assert.equal(bad.stats().queries, 0);
});

// 文字数の調整：短い→書き足し依頼→目安に届く
function lengthGoogle(lengths) {
  const bodies = [];
  let i = 0;
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url);
    if (u.endsWith(':countTokens')) return json({ totalTokens: 10 });
    if (u.endsWith(':generateContent')) {
      bodies.push(JSON.parse(opt.body));
      const n = lengths[Math.min(i++, lengths.length - 1)];
      return json({
        candidates: [{ content: { parts: [{ text: 'あ'.repeat(n) }] }, finishReason: 'STOP' }],
      });
    }
    if (/\/v1beta\/models\/[\w.-]+$/.test(u)) return json({});
    throw Error('unexpected ' + u);
  };
  return { fetchImpl, bodies };
}
const gen = (g, targetChars, onProgress) =>
  createClient(KEY, { fetchImpl: g.fetchImpl }).generateMinutes({
    prompt: 'x',
    targetChars,
    onProgress,
  });

test('文字数が足りなければ、前の版を渡して書き足しを頼む', async () => {
  const g = lengthGoogle([1000, 1950]);
  const phases = [];
  const r = await gen(g, 2000, (p) => phases.push(p));
  assert.equal(r.chars, 1950);
  assert.equal(r.adjusted, 1);
  assert.equal(g.bodies.length, 2);
  const second = g.bodies[1].contents;
  assert.equal(second.length, 3);
  assert.equal(second[1].role, 'model');
  assert.equal(second[1].parts[0].text.length, 1000);
  assert.match(second[2].parts[0].text, /約1000字/);
  assert.ok(phases.some((p) => p.phase === 'adjusting' && p.chars === 1000 && p.target === 2000));
});

test('目安なし・範囲内なら1回だけ、調整は最大2回、崩れた版は使わない', async () => {
  assert.equal((await gen(lengthGoogle([500]), null)).adjusted, 0);
  assert.equal((await gen(lengthGoogle([1900]), 2000)).adjusted, 0);
  const many = lengthGoogle([800, 1200, 1500, 1900]);
  const r = await gen(many, 2000);
  assert.equal(many.bodies.length, 3);
  assert.equal(r.chars, 1500);
  const broken = await gen(lengthGoogle([1000, 100]), 2000);
  assert.equal(broken.chars, 1000);
});
