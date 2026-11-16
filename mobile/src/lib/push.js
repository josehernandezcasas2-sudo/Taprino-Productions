import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { apiPost, freshToken } from './api';
import { afterForget, registersAgain } from './pushRules';

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
    // In turn with a sign-out's forgetting still under way (inTurn below).
    await inTurn(() => register(getToken));
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

// One step at a time (2026-11-16): a phone that flips from signed out to
// signed in at once must not have its fresh registration undone by the
// forgetting still under way (the device unregistered, the new token
// cleared), nor the other way round.
let pushChain = Promise.resolve();
function inTurn(step) {
  const run = pushChain.then(step, step);
  pushChain = run.catch(() => {});
  return run;
}

// Tells the server this phone's token is no longer the account's: with
// the session when there is one, else by the token alone (the server takes
// that too: pages/api/push/unregister.js). → whether the server said yes.
async function tellServerToForget(token, session) {
  try {
    await apiPost('/api/push/unregister', { token }, session || null);
    return true;
  } catch {
    return false;
  }
}

// The phone stops being a push address at Expo too, so even a row the
// server still holds is answered DeviceNotRegistered on its next send and
// disabled there (lib/push.js). Registering again (refreshPushRegistration
// on the next sign-in) makes it one again.
async function unregisterDevice() {
  try { await Notifications.unregisterForNotificationsAsync(); } catch { /* not on this device */ }
}

// The server forgets the stored token (with the session when there is
// one), the phone unregisters, and the token is kept until the server said
// yes (lib/pushRules.js afterForget). → whether it was told.
async function forgetStoredToken(session, { explicit }) {
  const token = await read(TOKEN_KEY);
  let told = false;
  if (token) {
    told = await tellServerToForget(token, session);
    await unregisterDevice();
  }
  const keep = afterForget({ explicit, told });
  if (token && keep.clearToken) await write(TOKEN_KEY, '');
  if (keep.resetPref) await write(PREF_KEY, '');
  return told;
}

// On Log out (lib/signOut.js): the token stops belonging to this account
// — the server row goes while the session still exists — and the
// preference returns to "never asked", so the next person on this phone
// gets the card rather than the last account's choice. Until 2026-10-28
// nothing did this, and a signed-out phone kept receiving the old
// account's pushes. Since 2026-11-16 the token is kept when the server
// couldn't be told, so the next start tries again (forgetPushWhenSignedOut,
// by the token alone), and the phone unregisters from pushes itself.
export function forgetPushOnSignOut(getToken) {
  return inTurn(async () => {
    let session = null;
    if (await read(TOKEN_KEY)) {
      try { session = await freshToken(getToken); } catch { /* by the token alone */ }
    }
    await forgetStoredToken(session, { explicit: true });
  });
}

// Clerk says this phone is signed out without the person pressing Log
// out: signed out from somewhere else (Account → Security's devices, a
// password reset), a sign-in that ran out, or a Log out whose server call
// failed (2026-11-16). The server is told by the token alone and the
// phone unregisters; the token is kept until the server says yes, so the
// next start tries again. The preference stays as it was: when the phone
// is signed in again, refreshPushRegistration registers it by itself.
let forgetQueued = null;
export function forgetPushWhenSignedOut() {
  if (!forgetQueued) {
    forgetQueued = inTurn(() => forgetStoredToken(null, { explicit: false }))
      .catch(() => {})
      .finally(() => { forgetQueued = null; });
  }
  return forgetQueued;
}

// Signed in — on a cold start and every time the phone goes from signed
// out to signed in (components/PushListener.js): register (again) when
// push is on and the system allows it, which also keeps the token fresh
// (tokens rotate; the row's last_seen_at moves) and puts back a phone that
// was unregistered while signed out. Quiet: nothing is asked.
export function refreshPushRegistration(getToken) {
  return inTurn(async () => {
    if (!registersAgain({ isDevice: Boolean(Device.isDevice), pref: await readPushPref(), permission: await permission() })) return;
    await androidChannel();
    try { await register(getToken); } catch { /* next sign-in or start */ }
  });
}
