// APIキーの保存先。「この端末に保存」なら localStorage、それ以外はタブを閉じると消える sessionStorage。
import { normalizeModel } from './gemini.mjs';

export const STORAGE_KEY = 'minutes-studio.gemini';
const empty = () => ({ key: '', model: normalizeModel(), paidTier: false, remember: false });

function stores(env = globalThis) {
  const pick = (name) => {
    try {
      return env[name] || null;
    } catch {
      return null;
    }
  };
  return { local: pick('localStorage'), session: pick('sessionStorage') };
}

function read(store) {
  try {
    const v = JSON.parse(store?.getItem(STORAGE_KEY) || 'null');
    if (v && typeof v.key === 'string') return v;
  } catch {}
  return null;
}

export function loadKeySettings(env) {
  const { local, session } = stores(env);
  const saved = read(local),
    temp = read(session);
  const v = saved ? { ...saved, remember: true } : temp ? { ...temp, remember: false } : null;
  if (!v) return empty();
  return {
    key: v.key,
    model: normalizeModel(v.model),
    paidTier: v.paidTier === true,
    remember: v.remember,
  };
}

export function saveKeySettings(settings, env) {
  const { local, session } = stores(env);
  const value = JSON.stringify({
    key: settings.key,
    model: normalizeModel(settings.model),
    paidTier: settings.paidTier === true,
  });
  try {
    if (settings.remember) {
      local?.setItem(STORAGE_KEY, value);
      session?.removeItem(STORAGE_KEY);
    } else {
      session?.setItem(STORAGE_KEY, value);
      local?.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export function clearKeySettings(env) {
  const { local, session } = stores(env);
  for (const s of [local, session])
    try {
      s?.removeItem(STORAGE_KEY);
    } catch {}
}
