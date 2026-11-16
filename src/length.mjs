// 文字数の指定と確認。日本語の「○○字」は、空白・改行を除いた文字数で数える。
export const MIN_TARGET = 200;
export const MAX_TARGET = 20000;
// 目安からのずれの許容範囲（これを外れたら書き足し・削りを頼む）
export const LOWER = 0.9;
export const UPPER = 1.15;
// 書き足し・削りを頼む回数の上限
export const MAX_ADJUST = 2;

export const countChars = (text) => Array.from(String(text || '').replace(/\s/g, '')).length;

// 入力欄の値、なければ追加指示の「2000字」「2,000文字」などから目安を読む。範囲外・指定なしは null。
export function parseTarget(field, instruction = '') {
  const pick = (v) => {
    const n = Number(String(v ?? '').replace(/[,，]/g, ''));
    return Number.isInteger(n) && n >= MIN_TARGET && n <= MAX_TARGET ? n : null;
  };
  const fromField = String(field ?? '').trim();
  if (fromField) return pick(toHalfWidth(fromField));
  const m = toHalfWidth(String(instruction)).match(/(\d[\d,]*)\s*(?:字|文字)/);
  return m ? pick(m[1]) : null;
}
const toHalfWidth = (s) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// AIへの文字数の指示（最初の依頼に付ける）
export const lengthRule = (target) =>
  `文字数：本文全体を、空白・改行を除いて約${target}字（${Math.round(target * LOWER)}〜${Math.round(target * UPPER)}字）で書くこと。` +
  '足りない場合は、資料にある経緯・論点・理由・数値・発言の要旨を具体的に書いて補う。資料にない事実を創作して水増ししないこと。';

// 目安から外れていれば、書き足し・削りの依頼文を返す。範囲内なら null。
export function adjustRequest(text, target) {
  if (!target) return null;
  const n = countChars(text);
  if (n < target * LOWER)
    return (
      `現在の議事録は約${n}字で、目安の${target}字に足りません。` +
      `同じ見出し構成のまま、約${target}字（${Math.round(target * LOWER)}字以上）になるよう書き足した全文を出力してください。` +
      '添付資料にある経緯・論点・理由・数値・発言の要旨を具体的に補い、資料にない事実は創作しないこと。' +
      '資料の情報がこれ以上ない場合は、無理に水増しせず、その時点の全文を出力すること。全文以外の説明は書かない。'
    );
  if (n > target * UPPER)
    return (
      `現在の議事録は約${n}字で、目安の${target}字を超えています。` +
      `同じ見出し構成のまま、約${target}字（${Math.round(target * UPPER)}字以下）に要約した全文を出力してください。` +
      '決定事項・今後の対応・要確認事項は削らないこと。全文以外の説明は書かない。'
    );
  return null;
}
