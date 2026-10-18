import * as SecureStore from 'expo-secure-store';

// The creator link that brought someone into the app — a profile opened
// with ?via=<handle> (the website's /@handle link sends the same
// parameter) — kept on the device for 30 days, last link wins, like the
// website's tapa_via cookie (middleware.js). The account screen prefills
// "Did a creator send you?" with it and checkout sends it as `via`.
const KEY = 'tapa_via';
const DAYS = 30;

export function cleanVia(raw) {
  const v = typeof raw === 'string' ? raw.trim().replace(/^@+/, '').slice(0, 64) : '';
  return /^[A-Za-z0-9_.-]+$/.test(v) ? v : '';
}

export async function rememberVia(raw) {
  const via = cleanVia(raw);
  if (!via) return;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ via, at: Date.now() }));
  } catch {
    // Device storage refused; the member can still type the handle.
  }
}

export async function readVia() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return '';
    const { via, at } = JSON.parse(raw);
    if (!via || !at || Date.now() - at > DAYS * 86400000) return '';
    return cleanVia(via);
  } catch {
    return '';
  }
}
