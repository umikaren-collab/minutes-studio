import { mediaType } from './file-import.mjs';
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('中止', 'AbortError'));
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException('中止', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
export async function uploadForMinutes(
  files,
  template,
  prompt,
  { signal, accessCode = '', onProgress = () => {}, onJob = () => {}, fetchImpl = fetch } = {},
) {
  const payload = [
    ...files.map((f) => ({ file: f, role: 'source' })),
    ...(template ? [{ file: template, role: 'template' }] : []),
  ];
  let job = null,
    finished = false;
  const call = async (path, options = {}) => {
    const response = await fetchImpl(path, { ...options, signal });
    let value;
    try {
      value = await response.json();
    } catch {
      throw Error('サーバーから応答を読み込めませんでした。ページを再読み込みしてお試しください。');
    }
    if (!response.ok) throw Error(value.error || '資料の転送に失敗しました。');
    return value;
  };
  try {
    onProgress({ phase: 'start' });
    job = await call('/api/uploads/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': accessCode },
      body: JSON.stringify({
        files: payload.map(({ file, role }) => ({ size: file.size, mime: mediaType(file), role })),
      }),
    });
    onJob(job);
    const headers = { Authorization: 'Bearer ' + job.token };
    const total = payload.reduce((n, p) => n + p.file.size, 0);
    let completed = 0;
    for (const [index, { file }] of payload.entries()) {
      let offset = 0;
      while (offset < file.size) {
        if (signal?.aborted) throw new DOMException('中止', 'AbortError');
        const end = Math.min(offset + job.chunkSize, file.size);
        onProgress({
          phase: 'upload',
          index,
          totalFiles: payload.length,
          name: file.name,
          loaded: completed + offset,
          total,
        });
        const uploaded = await call(
          `/api/uploads/chunk?job=${encodeURIComponent(job.jobId)}&index=${index}&offset=${offset}`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/octet-stream' },
            body: file.slice(offset, end),
          },
        );
        if (uploaded.offset !== end)
          throw Error('転送の確認位置が一致しません。作成をやり直してください。');
        offset = end;
      }
      completed += file.size;
      onProgress({
        phase: 'upload',
        index,
        totalFiles: payload.length,
        name: file.name,
        loaded: completed,
        total,
      });
    }
    const until = Date.now() + 12 * 60 * 1000;
    for (;;) {
      onProgress({ phase: 'processing' });
      const state = await call('/api/uploads/status?job=' + encodeURIComponent(job.jobId), {
        headers,
      });
      if (state.state === 'ready') break;
      if (!['processing', 'uploading'].includes(state.state) || Date.now() > until)
        throw Error('AI側のファイル処理が完了しませんでした。資料を分けてお試しください。');
      await sleep(2500, signal);
    }
    onProgress({ phase: 'generating' });
    const result = await call('/api/shared-generate', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.jobId, prompt }),
    });
    finished = true;
    return result;
  } finally {
    if (job && !finished) {
      try {
        await fetchImpl('/api/uploads/cancel', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + job.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.jobId }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {}
    }
    onJob(null);
  }
}
