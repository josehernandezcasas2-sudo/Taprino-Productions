import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { apiPost, freshToken } from './api';

// Push notifications (Jose, 2026-10-24; canvas "Suspension, push and ad
// share", Push board; migration 102 push_tokens). The server sends every
// notifications row as a push through Expo (lib/push.js on the web side);
// this is the app's half: ask with our own card first (PushPrompt), then
// the system prompt, register the Expo push token with
// /api/push/register, keep it fresh on every signed-in start, and
// switch it off through /api/push/unregister. The preference lives in
// SecureStore: '' (never asked), 'on', 'off', 'later' (card dismissed).
//
// Where it works: a real device only. Expo Go on iOS delivers remote
// pushes; Expo Go on Android does not (since SDK 53), so there the Play
// build is where this runs.
const PREF_KEY = 'push_pref';
const TOKEN_KEY = 'push_token';

async function read(key) { try { return (await SecureStore.getItemAsync(key)) || ''; } catch { return ''; } }
async function write(key, value) { try { await SecureStore.setItemAsync(key, value || ''); } catch { /* ignore */ } }

export function readPushPref() { return read(PREF_KEY); }
export function dismissPushPrompt() { return write(PREF_KEY, 'later'); }

function projectId() {
  const c = Constants.expoConfig || Constants.manifest2 || {};
  return (c.extra && c.extra.eas && c.extra.eas.projectId) || (Constants.easConfig && Constants.easConfig.projectId) || null;
}

async function permission() {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted || (p.ios && p.ios.status === Notifications.IosAuthorizationStatus.PROVISIONAL) ? 'granted' : p.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

// { pref, permission, supported }: what the Account row shows.
export async function pushStatus() {
  return { pref: await readPushPref(), permission: await permission(), supported: Boolean(Device.isDevice) };
}

async function androidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Studio Tapa TV',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#ff8c42'
    });
  } catch { /* ignore */ }
}

async function register(getToken) {
  const id = projectId();
  const { data: token } = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
  const session = await freshToken(getToken);
  if (!session) throw new Error('Sign in first.');
  await apiPost('/api/push/register', {
    token,
    platform: Platform.OS,
    deviceName: Device.modelName || null,
    appVersion: (Constants.expoConfig && Constants.expoConfig.version) || null
  }, session);
  await write(TOKEN_KEY, token);
  return token;
}

// Turn on: the system prompt (only now), then the token. Returns
// { ok } or { ok: false, reason: 'simulator' | 'denied' | 'unsupported' | message }.
export async function enablePush(getToken) {
  if (!Device.isDevice) return { ok: false, reason: 'simulator' };
  await androidChannel();
  let status = await permission();
  if (status !== 'granted') {
    try {
      const p = await Notifications.requestPermissionsAsync();
      status = p.granted ? 'granted' : 'denied';
    } catch {
      status = 'denied';
    }
  }
  await write(PREF_KEY, 'on');
  if (status !== 'granted') return { ok: false, reason: 'denied' };
  try {
    await register(getToken);
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : 'Could not register.';
    return { ok: false, reason: /expo go|not supported|android/i.test(msg) ? 'unsupported' : msg };
  }
}

export async function disablePush(getToken) {
  await write(PREF_KEY, 'off');
  const token = await read(TOKEN_KEY);
  if (!token) return { ok: true };
  try {
    const session = await freshToken(getToken);
    if (session) await apiPost('/api/push/unregister', { token }, session);
  } catch { /* the server disables dead tokens on its own */ }
  await write(TOKEN_KEY, '');
  return { ok: true };
}

// On sign-out (lib/signOut.js): the token stops belonging to this account
// — the server row goes while the session still exists — and the
// preference returns to "never asked", so the next person on this phone
// gets the card rather than the last account's choice. Until 2026-10-28
// nothing did this, and a signed-out phone kept receiving the old
// account's pushes.
export async function forgetPushOnSignOut(getToken) {
  const token = await read(TOKEN_KEY);
  if (token) {
    try {
      const session = await freshToken(getToken);
      if (session) await apiPost('/api/push/unregister', { token }, session);
    } catch { /* the server disables dead tokens on its own */ }
  }
  await write(TOKEN_KEY, '');
  await write(PREF_KEY, '');
}

// On a signed-in start: keep the token fresh (tokens rotate; the row's
// last_seen_at moves). Quiet: nothing is asked.
export async function refreshPushRegistration(getToken) {
  if (!Device.isDevice) return;
  if ((await readPushPref()) !== 'on') return;
  if ((await permission()) !== 'granted') return;
  await androidChannel();
  try { await register(getToken); } catch { /* next start */ }
}
