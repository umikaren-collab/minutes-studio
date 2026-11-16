import test from 'node:test';
import assert from 'node:assert/strict';
import { countChars, parseTarget, adjustRequest, lengthRule } from './length.mjs';

test('空白・改行を除いて数える', () => {
  assert.equal(countChars('【議事内容】\n 本日は　晴れ。'), 12);
  assert.equal(countChars(''), 0);
});

test('入力欄、なければ追加指示から目安を読む', () => {
  assert.equal(parseTarget('2000'), 2000);
  assert.equal(parseTarget('２，０００'), 2000);
  assert.equal(parseTarget('', '全体で2000字程度にしてください'), 2000);
  assert.equal(parseTarget('', '2,500文字で'), 2500);
  assert.equal(parseTarget('', '３０００字'), 3000);
  // 入力欄が優先
  assert.equal(parseTarget('1500', '2000字で'), 1500);
  // 範囲外・指定なし
  assert.equal(parseTarget('50'), null);
  assert.equal(parseTarget('abc'), null);
  assert.equal(parseTarget('', '担当者と期限を明記'), null);
});

test('目安から外れたときだけ書き足し・削りを頼む', () => {
  const text = (n) => 'あ'.repeat(n);
  assert.match(adjustRequest(text(1000), 2000), /約1000字.*書き足した全文/);
  assert.equal(adjustRequest(text(1900), 2000), null);
  assert.equal(adjustRequest(text(2250), 2000), null);
  assert.match(adjustRequest(text(2400), 2000), /要約した全文/);
  assert.equal(adjustRequest(text(10), null), null);
  assert.match(lengthRule(2000), /約2000字（1800〜2300字）/);
});
