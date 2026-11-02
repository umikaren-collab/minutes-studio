const extensions = {
  wav: 'audio/wav',
  wave: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  webm: 'audio/webm',
};
const types = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/x-aac': 'audio/aac',
  'audio/x-flac': 'audio/flac',
  'audio/x-aiff': 'audio/aiff',
  'application/ogg': 'audio/ogg',
};
const allowed = new Set([...Object.values(extensions), 'video/webm']);
export function mediaType(file) {
  const t = String(file.type || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  const normalized = types[t] || t;
  if (allowed.has(normalized)) return normalized;
  const ext = String(file.name || '')
    .trim()
    .split('.')
    .pop()
    .toLowerCase();
  return extensions[ext] || null;
}
export function collectFiles(existing, incoming) {
  const files = [...existing],
    errors = [];
  let added = 0,
    duplicates = 0;
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of Array.from(incoming || [])) {
    const name = f.name || '名前のないファイル';
    let reason = '';
    if (!mediaType(f))
      reason =
        '未対応の形式です。WAV・M4A・MP3・AAC・FLAC・OGG・AIFF・WebM・MP4・PDFを選んでください。';
    else if (!Number.isFinite(f.size) || f.size <= 0)
      reason = 'ファイルが空か、読み取れません。端末にダウンロードしてから選び直してください。';
    else if (f.size > 200 * 1024 ** 2) reason = '200MBを超えています。分割して選んでください。';
    else if (files.some((x) => x.name === f.name && x.size === f.size)) {
      duplicates++;
      continue;
    } else if (files.length >= 5) reason = '資料は最大5件です。不要な資料を削除してください。';
    else if (total + f.size > 500 * 1024 ** 2)
      reason = '合計500MBを超えています。不要な資料を削除してください。';
    if (reason) {
      errors.push(`${name}：${reason}`);
      continue;
    }
    files.push(f);
    total += f.size;
    added++;
  }
  return { files, errors, added, duplicates };
}
