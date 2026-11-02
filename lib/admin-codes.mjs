// オーナー専用：招待コードの一覧・発行・変更・停止・削除
import { isOwner, privateJson } from './api-settings.mjs';
import {
  CODE_LIMIT_MAX,
  createCode,
  deleteCode,
  listCodes,
  updateCode,
  validCodeLimit,
  validLabel,
} from './access-codes.mjs';

const CODE_COUNT_MAX = 100;
const denied = (user) =>
  privateJson({ error: '管理者としてのログインが必要です。' }, user ? 403 : 401);

export async function ownerCodesGet(user, env) {
  if (!isOwner(user, env)) return denied(user);
  if (!env.DB) return privateJson({ error: '管理機能の準備が完了していません。' }, 503);
  try {
    return privateJson({ codes: await listCodes(env.DB), codeLimitMax: CODE_LIMIT_MAX });
  } catch {
    return privateJson({ error: 'コードの一覧を読み込めません。' }, 503);
  }
}

export async function ownerCodesPost(request, user, env) {
  if (!isOwner(user, env)) return denied(user);
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(request.url).origin)
    return privateJson({ error: '管理画面から操作してください。' }, 403);
  if (!env.DB) return privateJson({ error: '管理機能の準備が完了していません。' }, 503);
  let value;
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw Error();
    value = JSON.parse(raw);
  } catch {
    return privateJson({ error: '入力内容を確認してください。' }, 400);
  }
  if (!value || typeof value !== 'object')
    return privateJson({ error: '入力内容を確認してください。' }, 400);
  try {
    if (value.action === 'create') {
      if (!validLabel(value.label))
        return privateJson({ error: '相手の名前（40文字まで）を入力してください。' }, 400);
      if (!validCodeLimit(value.dailyLimit))
        return privateJson({ error: `1日の回数は1〜${CODE_LIMIT_MAX}回で指定してください。` }, 400);
      if ((await listCodes(env.DB)).length >= CODE_COUNT_MAX)
        return privateJson(
          {
            error: `発行できるコードは${CODE_COUNT_MAX}件までです。不要なコードを削除してください。`,
          },
          400,
        );
      const created = await createCode(env.DB, value);
      // コード本体はこのレスポンスでだけ返す（再表示はできない）
      return privateJson({ success: true, created, codes: await listCodes(env.DB) });
    }
    if (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id))
      return privateJson({ error: '対象のコードを確認してください。' }, 400);
    if (value.action === 'update') {
      const changes = {};
      if (value.label !== undefined) {
        if (!validLabel(value.label))
          return privateJson({ error: '相手の名前（40文字まで）を入力してください。' }, 400);
        changes.label = value.label;
      }
      if (value.dailyLimit !== undefined) {
        if (!validCodeLimit(value.dailyLimit))
          return privateJson(
            { error: `1日の回数は1〜${CODE_LIMIT_MAX}回で指定してください。` },
            400,
          );
        changes.dailyLimit = value.dailyLimit;
      }
      if (value.enabled !== undefined) {
        if (typeof value.enabled !== 'boolean')
          return privateJson({ error: '入力内容を確認してください。' }, 400);
        changes.enabled = value.enabled;
      }
      if (!(await updateCode(env.DB, value.id, changes)))
        return privateJson({ error: '対象のコードが見つかりません。' }, 404);
      return privateJson({ success: true, codes: await listCodes(env.DB) });
    }
    if (value.action === 'delete') {
      await deleteCode(env.DB, value.id);
      return privateJson({ success: true, codes: await listCodes(env.DB) });
    }
    return privateJson({ error: '操作を確認してください。' }, 400);
  } catch {
    return privateJson({ error: '保存できませんでした。時間をおいて再度お試しください。' }, 503);
  }
}
