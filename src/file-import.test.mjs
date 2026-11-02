import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaType, collectFiles } from './file-import.mjs';
const f = (name, type = '', size = 1024) => ({ name, type, size });
test('録音形式と拡張子のないDriveファイルを識別する', () => {
  for (const [name, type] of [
    ['録音.M4A', 'audio/mp4'],
    ['録音.mp3', 'audio/mpeg'],
    ['録音.WAV', 'audio/wav'],
    ['録音.aac', 'audio/aac'],
    ['録音.flac', 'audio/flac'],
    ['録音.ogg', 'audio/ogg'],
    ['動画.mp4', 'video/mp4'],
    ['資料.pdf', 'application/pdf'],
  ])
    assert.equal(mediaType(f(name)), type);
  assert.equal(mediaType(f('録音', 'audio/x-m4a')), 'audio/mp4');
  assert.equal(mediaType(f('録音', 'audio/x-wav')), 'audio/wav');
  assert.equal(mediaType(f('録音.webm', 'video/webm')), 'video/webm');
});
test('不対応ファイルが混ざっても対応ファイルを取り込む', () => {
  const r = collectFiles([], [f('メモ.txt'), f('録音.m4a'), f('録音.mp3')]);
  assert.equal(r.added, 2);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /メモ.txt/);
});
test('空・容量超過・重複を判別する', () => {
  const existing = [f('録音.wav')];
  const r = collectFiles(existing, [
    f('録音.wav'),
    f('空.wav', '', 0),
    f('大.wav', '', 201 * 1024 ** 2),
  ]);
  assert.equal(r.duplicates, 1);
  assert.equal(r.files.length, 1);
  assert.equal(r.errors.length, 2);
});
test('ファイル数・合計容量の上限で既存ファイルを保持する', () => {
  const r = collectFiles(
    [f('1.wav'), f('2.wav'), f('3.wav'), f('4.wav')],
    [f('5.wav'), f('6.wav')],
  );
  assert.equal(r.files.length, 5);
  assert.equal(r.errors.length, 1);
  const total = collectFiles(
    [f('1.wav', '', 200 * 1024 ** 2), f('2.wav', '', 200 * 1024 ** 2)],
    [f('3.wav', '', 101 * 1024 ** 2)],
  );
  assert.equal(total.files.length, 2);
  assert.match(total.errors[0], /合計500MB/);
});
