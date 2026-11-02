import { Buffer } from 'node:buffer';
import { effectiveSettings } from './api-settings.mjs';
import { mediaType } from '../src/file-import.mjs';
import { DAILY_LIMIT, dayInJapan } from './limits.mjs';
import { globalUsed, reserveUsage } from './shared-demo.mjs';
import {
  CODE_HEADER,
  codeUsed,
  findCode,
  releaseCode,
  reserveCode,
  touchCode,
} from './access-codes.mjs';
export { DAILY_LIMIT };
export const FILE_LIMIT = 200 * 1024 ** 2,
  TOTAL_LIMIT = 500 * 1024 ** 2,
  CHUNK_SIZE = 4 * 1024 ** 2,
  INPUT_LIMIT = 1000000,
  // 長時間の会議でも途中で切れないよう、モデルの出力上限まで使う（ただし上限値は32,768）
  OUTPUT_LIMIT = 32768,
  FALLBACK_OUTPUT_LIMIT = 8192;
// モデル情報APIから入力・出力の上限を取得する。取得できない場合は従来の安全側の値を使う。
export async function modelLimits(base, headers, upstream) {
  try {
    const response = await upstream(base, {
      headers: { 'x-goog-api-key': headers['x-goog-api-key'] },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error('model');
    const info = await response.json();
    const input = Number(info.inputTokenLimit),
      output = Number(info.outputTokenLimit);
    return {
      input: Number.isSafeInteger(input) && input > 0 ? Math.min(input, INPUT_LIMIT) : INPUT_LIMIT,
      output:
        Number.isSafeInteger(output) && output > 0
          ? Math.min(output, OUTPUT_LIMIT)
          : FALLBACK_OUTPUT_LIMIT,
    };
  } catch {
    return { input: INPUT_LIMIT, output: FALLBACK_OUTPUT_LIMIT };
  }
}
const GOOGLE = 'https://generativelanguage.googleapis.com';
const json = (value, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
const day = () => dayInJapan();
const hash = async (text) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString(
    'hex',
  );
const validJob = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const sameOrigin = (r) => r.headers.get('Origin') === new URL(r.url).origin;
export function validateManifest(files) {
  if (!Array.isArray(files) || files.length > 6) return '資料数を確認してください。';
  let source = 0,
    template = 0,
    total = 0;
  for (const f of files) {
    if (
      !f ||
      !Number.isSafeInteger(f.size) ||
      f.size <= 0 ||
      !['source', 'template'].includes(f.role) ||
      !mediaType({ name: '', type: f.mime })
    )
      return '資料の形式・サイズを確認してください。';
    if (f.role === 'source') {
      source++;
      if (f.size > FILE_LIMIT) return '1ファイル200MBまでです。';
    } else {
      template++;
      if (f.mime !== 'application/pdf' || f.size > 15 * 1024 ** 2) return 'PDF書式は15MBまでです。';
    }
    total += f.size;
  }
  if (source > 5 || template > 1) return '会議資料は最大5件、PDF書式は1件までです。';
  if (total > TOTAL_LIMIT) return '資料の合計は500MBまでです。';
  return null;
}
async function readJson(request, max = 260000) {
  if (Number(request.headers.get('Content-Length') || 0) > max) throw Error('body');
  const bytes = await readChunk(request, max);
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function readChunk(request, max) {
  const reader = request.body?.getReader();
  if (!reader) throw Error('empty');
  const chunks = [];
  let size = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw Error('large');
    }
    chunks.push(item.value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const bytes of chunks) {
    all.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return all;
}
async function runtimeFor(env) {
  const runtime = await effectiveSettings(env);
  if (!env.DB || !runtime.enabled || !runtime.key) throw Error('disabled');
  // 無料枠では送信内容がGoogleの製品改善に使われる場合があるため、有料枠のキー以外では動かさない
  if (!runtime.paidTier) throw Error('free-tier');
  return runtime;
}
async function authorizedJob(request, env, id) {
  if (!env.DB || !validJob(id)) return null;
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) return null;
  const job = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ?').bind(id).first();
  if (!job || job.token_hash !== (await hash(auth.slice(7)))) return null;
  return job;
}
// 生成後に利用画面へ返す残り回数（コード別と全体の少ないほう）
async function remaining(env, job, limit) {
  const today = day();
  const globalLeft = Math.max(0, limit - (await globalUsed(env.DB, today)));
  if (!job.code_id) return globalLeft;
  const code = await env.DB.prepare('SELECT daily_limit FROM access_codes WHERE id = ?')
    .bind(job.code_id)
    .first();
  if (!code) return 0;
  return Math.min(
    globalLeft,
    Math.max(0, code.daily_limit - (await codeUsed(env.DB, job.code_id, today))),
  );
}
async function cleanupFiles(files, key, upstream) {
  const results = await Promise.allSettled(
    files.map(async (f) => {
      if (f.name && /^files\/[\w-]+$/.test(f.name)) {
        const r = await upstream(GOOGLE + '/v1beta/' + f.name, {
          method: 'DELETE',
          headers: { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(10000),
        });
        return r.ok || r.status === 404;
      }
      if (f.url) {
        try {
          await upstream(f.url, {
            method: 'POST',
            headers: { 'X-Goog-Upload-Command': 'cancel', 'Content-Length': '0' },
            signal: AbortSignal.timeout(10000),
          });
        } catch {}
      }
      return true;
    }),
  );
  return results.every((r) => r.status === 'fulfilled' && r.value === true);
}
async function expiredCleanup(env, key, upstream) {
  const rows = await env.DB.prepare(
    'SELECT id, files_json FROM upload_jobs WHERE expires_at < ? LIMIT 5',
  )
    .bind(Date.now())
    .all();
  for (const row of rows.results || []) {
    let files = [];
    try {
      files = JSON.parse(row.files_json);
    } catch {}
    await cleanupFiles(files, key, upstream);
    await env.DB.prepare('DELETE FROM upload_jobs WHERE id = ? AND expires_at < ?')
      .bind(row.id, Date.now())
      .run();
  }
}
export async function startUploadJob(request, env, upstream = fetch) {
  if (!sameOrigin(request) || request.method !== 'POST')
    return json({ error: 'このアプリから送信してください。' }, 403);
  let runtime;
  try {
    runtime = await runtimeFor(env);
  } catch (e) {
    return json(
      {
        error:
          e?.message === 'free-tier'
            ? '無料枠のAPIキーでは利用できません。管理者が有料枠（課金を有効にしたプロジェクト）のキーを設定するまでお待ちください。'
            : '共有APIは準備中です。管理者設定をご確認ください。',
      },
      503,
    );
  }
  let value;
  try {
    value = await readJson(request, 8192);
  } catch {
    return json({ error: '資料情報を読み込めませんでした。' }, 400);
  }
  const error = validateManifest(value.files);
  if (error) return json({ error }, 400);
  // 招待コードの確認（コードがない・停止中なら回数を消費せずに拒否）
  const code = await findCode(env.DB, request.headers.get(CODE_HEADER));
  if (!code)
    return json(
      { error: '利用コードが正しくないか、停止されています。管理者にお問い合わせください。' },
      401,
    );
  const today = day();
  if (!(await reserveCode(env.DB, code, today)))
    return json(
      {
        error: `このコードの本日の利用回数（${code.daily_limit}回）を使い切りました。翌日0時（日本時間）に再開します。`,
      },
      429,
    );
  const reserved = await reserveUsage(env.DB, today, runtime.dailyLimit);
  if (!reserved) {
    await releaseCode(env.DB, code, today);
    return json(
      {
        error: `本日は全体の利用上限（${runtime.dailyLimit}回）に達しました。翌日0時（日本時間）に再開します。`,
      },
      429,
    );
  }
  await touchCode(env.DB, code);
  const id = crypto.randomUUID(),
    token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const files = value.files.map((f) => ({
    size: f.size,
    mime: mediaType({ name: '', type: f.mime }),
    role: f.role,
    offset: 0,
    status: 'UPLOADING',
    url: null,
    name: null,
    uri: null,
  }));
  await env.DB.prepare(
    'INSERT INTO upload_jobs (id, token_hash, state, files_json, model, day, expires_at, code_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      await hash(token),
      'creating',
      JSON.stringify(files),
      runtime.model,
      today,
      Date.now() + 2 * 60 * 60 * 1000,
      code.id,
    )
    .run();
  try {
    await expiredCleanup(env, runtime.key, upstream);
    for (const [index, file] of files.entries()) {
      const response = await upstream(GOOGLE + '/upload/v1beta/files', {
        method: 'POST',
        headers: {
          'x-goog-api-key': runtime.key,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(file.size),
          'X-Goog-Upload-Header-Content-Type': file.mime,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: 'minutes-' + id + '-' + index } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error('start');
      const location = response.headers.get('x-goog-upload-url');
      if (!location) throw Error('url');
      const url = new URL(location);
      if (
        url.origin !== GOOGLE ||
        !url.pathname.startsWith('/upload/') ||
        url.username ||
        url.password ||
        url.searchParams.has('key') ||
        url.href.includes(runtime.key)
      )
        throw Error('url');
      file.url = url.href;
      await env.DB.prepare('UPDATE upload_jobs SET files_json = ? WHERE id = ?')
        .bind(JSON.stringify(files), id)
        .run();
    }
    await env.DB.prepare('UPDATE upload_jobs SET state = ? WHERE id = ?')
      .bind(files.length ? 'uploading' : 'ready', id)
      .run();
    return json({
      jobId: id,
      token,
      chunkSize: CHUNK_SIZE,
      remaining: Math.min(
        code.daily_limit - (await codeUsed(env.DB, code.id, today)),
        runtime.dailyLimit - reserved.used,
      ),
    });
  } catch {
    await cleanupFiles(files, runtime.key, upstream);
    await env.DB.prepare('UPDATE upload_jobs SET state = ?, files_json = ? WHERE id = ?')
      .bind('failed', '[]', id)
      .run();
    return json(
      {
        error:
          'アップロードを開始できませんでした。APIキー・利用枠を確認してください。この試行は1回に数えます。',
      },
      502,
    );
  }
}
export async function uploadChunk(request, env, upstream = fetch) {
  if (!sameOrigin(request) || request.method !== 'POST')
    return json({ error: 'このアプリから送信してください。' }, 403);
  const url = new URL(request.url),
    index = Number(url.searchParams.get('index')),
    offset = Number(url.searchParams.get('offset'));
  const job = await authorizedJob(request, env, url.searchParams.get('job'));
  if (!job) return json({ error: 'アップロードの確認情報が無効です。' }, 403);
  if (job.expires_at < Date.now())
    return json({ error: 'アップロードの有効時間を過ぎました。作成をやり直してください。' }, 410);
  if (job.state !== 'uploading')
    return json({ error: 'アップロードの状態を確認してください。' }, 409);
  const files = JSON.parse(job.files_json),
    file = files[index];
  if (
    !Number.isInteger(index) ||
    !Number.isSafeInteger(offset) ||
    !file ||
    file.offset !== offset ||
    offset >= file.size
  )
    return json({ error: 'アップロードの順番が一致しません。作成をやり直してください。' }, 409);
  const expected = Math.min(CHUNK_SIZE, file.size - offset);
  if (Number(request.headers.get('Content-Length') || 0) > expected)
    return json({ error: '送信するデータが大きすぎます。' }, 413);
  let bytes;
  try {
    bytes = await readChunk(request, expected);
  } catch {
    return json({ error: '分割データを受信できませんでした。' }, 400);
  }
  if (bytes.byteLength !== expected)
    return json({ error: '分割データのサイズが一致しません。' }, 400);
  const locked = await env.DB.prepare(
    'UPDATE upload_jobs SET state = ? WHERE id = ? AND state = ? RETURNING id',
  )
    .bind('uploading_chunk', job.id, 'uploading')
    .first();
  if (!locked) return json({ error: '別のデータを転送中です。' }, 409);
  let runtime;
  try {
    runtime = await runtimeFor(env);
    const final = offset + bytes.byteLength === file.size;
    const response = await upstream(file.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'X-Goog-Upload-Offset': String(offset),
        'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload',
      },
      body: bytes,
      redirect: 'manual',
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok && response.status !== 308) throw Error('chunk');
    file.offset += bytes.byteLength;
    if (final) {
      const data = await response.json(),
        uploaded = data.file;
      if (
        !uploaded?.name ||
        !/^files\/[\w-]+$/.test(uploaded.name) ||
        !uploaded.uri ||
        new URL(uploaded.uri).origin !== GOOGLE
      )
        throw Error('metadata');
      file.name = uploaded.name;
      file.uri = uploaded.uri;
      file.status =
        uploaded.state === 'ACTIVE'
          ? 'ACTIVE'
          : uploaded.state === 'FAILED'
            ? 'FAILED'
            : 'PROCESSING';
      file.url = null;
    }
    const updated = await env.DB.prepare(
      'UPDATE upload_jobs SET state = ?, files_json = ? WHERE id = ? AND state = ? RETURNING id',
    )
      .bind('uploading', JSON.stringify(files), job.id, 'uploading_chunk')
      .first();
    if (!updated) {
      await cleanupFiles(files, runtime.key, upstream);
      return json({ error: 'アップロードを中止しました。' }, 409);
    }
    return json({ offset: file.offset, complete: file.offset === file.size });
  } catch {
    if (runtime) await cleanupFiles(files, runtime.key, upstream);
    await env.DB.prepare('UPDATE upload_jobs SET state = ?, files_json = ? WHERE id = ?')
      .bind('failed', '[]', job.id)
      .run();
    return json(
      { error: 'ファイルの転送に失敗しました。通信状態を確認し、作成をやり直してください。' },
      502,
    );
  }
}
export async function uploadStatus(request, env, upstream = fetch) {
  const job = await authorizedJob(request, env, new URL(request.url).searchParams.get('job'));
  if (!job) return json({ error: 'アップロードの確認情報が無効です。' }, 403);
  if (job.expires_at < Date.now())
    return json({ error: 'アップロードの有効時間を過ぎました。' }, 410);
  if (job.state === 'ready') return json({ state: 'ready' });
  if (!['uploading', 'processing'].includes(job.state)) return json({ state: job.state });
  const files = JSON.parse(job.files_json);
  if (files.some((f) => f.offset !== f.size)) return json({ state: 'uploading' });
  try {
    const runtime = await runtimeFor(env);
    for (const file of files) {
      if (file.status === 'FAILED') throw Error('file');
      if (file.status !== 'ACTIVE') {
        const response = await upstream(GOOGLE + '/v1beta/' + file.name, {
          headers: { 'x-goog-api-key': runtime.key },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw Error('file');
        const data = await response.json();
        if (data.state === 'FAILED') throw Error('file');
        file.status = data.state === 'ACTIVE' ? 'ACTIVE' : 'PROCESSING';
      }
    }
    const state = files.every((f) => f.status === 'ACTIVE') ? 'ready' : 'processing';
    await env.DB.prepare(
      'UPDATE upload_jobs SET state = ?, files_json = ? WHERE id = ? AND state IN (?, ?)',
    )
      .bind(state, JSON.stringify(files), job.id, 'uploading', 'processing')
      .run();
    return json({ state });
  } catch {
    return json(
      { error: 'AI側でファイルを処理できませんでした。資料の形式を確認してください。' },
      502,
    );
  }
}
export async function cancelUpload(request, env, upstream = fetch) {
  if (!sameOrigin(request)) return json({ error: 'このアプリから送信してください。' }, 403);
  let value;
  try {
    value = await readJson(request, 1024);
  } catch {
    return json({ error: '入力を確認してください。' }, 400);
  }
  const job = await authorizedJob(request, env, value.jobId);
  if (!job) return json({ error: 'アップロードの確認情報が無効です。' }, 403);
  if (['done', 'cancelled'].includes(job.state)) return json({ cancelled: true });
  await env.DB.prepare('UPDATE upload_jobs SET state = ? WHERE id = ?')
    .bind('cancelled', job.id)
    .run();
  let clean = false;
  try {
    const runtime = await effectiveSettings(env);
    clean = await cleanupFiles(JSON.parse(job.files_json), runtime.key, upstream);
  } catch {}
  await env.DB.prepare('UPDATE upload_jobs SET files_json = ? WHERE id = ?')
    .bind('[]', job.id)
    .run();
  return json({ cancelled: true, cleanupConfirmed: clean });
}
export async function finishUploadJob(request, env, upstream = fetch) {
  if (!sameOrigin(request) || request.method !== 'POST')
    return json({ error: 'このアプリから送信してください。' }, 403);
  let value;
  try {
    value = await readJson(request);
  } catch {
    return json({ error: '入力内容を読み込めませんでした。' }, 400);
  }
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 60000)
    return json({ error: '作成指示を確認してください。' }, 400);
  const job = await authorizedJob(request, env, value.jobId);
  if (!job) return json({ error: 'アップロードの確認情報が無効です。' }, 403);
  if (job.expires_at < Date.now())
    return json({ error: 'アップロードの有効時間を過ぎました。' }, 410);
  const locked = await env.DB.prepare(
    'UPDATE upload_jobs SET state = ? WHERE id = ? AND state = ? RETURNING id',
  )
    .bind('generating', job.id, 'ready')
    .first();
  if (!locked)
    return json({ error: 'ファイルの処理が完了していないか、すでに作成済みです。' }, 409);
  const files = JSON.parse(job.files_json);
  let runtime;
  let result,
    status = 200;
  try {
    runtime = await runtimeFor(env);
    const parts = [];
    for (const file of files) {
      if (file.role === 'template')
        parts.push({
          text: '次のPDFは議事録の書式見本です。会議の事実には含めず、項目構成のみ参照してください。',
        });
      parts.push({ file_data: { mime_type: file.mime, file_uri: file.uri } });
    }
    parts.push({ text: value.prompt });
    const contents = [{ role: 'user', parts }],
      headers = { 'Content-Type': 'application/json', 'x-goog-api-key': runtime.key },
      base = GOOGLE + '/v1beta/models/' + job.model;
    const limits = await modelLimits(base, headers, upstream);
    const count = await upstream(base + ':countTokens', {
      method: 'POST',
      headers,
      body: JSON.stringify({ contents }),
      signal: AbortSignal.timeout(90000),
    });
    if (!count.ok) throw Error('count');
    const usage = await count.json();
    if (!Number.isFinite(usage.totalTokens) || usage.totalTokens > limits.input) {
      result = { error: '選択モデルの入力上限を超えています。資料を分けて作成してください。' };
      status = 413;
    } else {
      const response = await upstream(base + ':generateContent', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: limits.output,
            ...(job.model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        // 出力が長くなる分、生成の待ち時間を5分まで延ばす
        signal: AbortSignal.timeout(300000),
      });
      if (!response.ok) throw Error('generate');
      result = {
        ...(await response.json()),
        demo: { remaining: await remaining(env, job, runtime.dailyLimit), day: job.day },
      };
    }
  } catch {
    result = { error: 'AIの作成に失敗しました。APIの利用枠・モデル・通信状態をご確認ください。' };
    status = 502;
  }
  let clean = true;
  if (runtime) clean = await cleanupFiles(files, runtime.key, upstream);
  await env.DB.prepare(
    'UPDATE upload_jobs SET state = ?, files_json = ? WHERE id = ? AND state = ?',
  )
    .bind('done', '[]', job.id, 'generating')
    .run();
  if (!clean)
    result.cleanupWarning =
      'Google側の一時ファイルの削除を確認できませんでした。Files APIの自動削除期限まで残る場合があります。';
  return json(result, status);
}
