import { getSupabase } from './supabase';
import { SITE } from './siteConfig';
import { sendWebPushMany } from './webPush';
import { selectCompat, upsertCompat } from './dbCompat';
import { endedPushSessions } from './pushSessions';
import { SESSION_ENDED_REASON, cleanSessionId, splitBySession } from './pushSessionRules';

// SERVER-ONLY. Push notifications for the app (migration 102
// push_tokens; Jose, 2026-10-24). The app registers its Expo push token
// through /api/push/register; every notifications row written by
// lib/notify.js also goes out as a push to that person's devices, with
// the row's href as data so a tap opens the right screen. Sent through
// Expo's push service (EXPO_PUSH_URL overrides it for a local run;
// EXPO_ACCESS_TOKEN is optional). A token Expo reports as
// DeviceNotRegistered is disabled, never deleted.
//
// Since 2026-11-12 the same message also goes to the person's browsers
// that turned notifications on (lib/webPush.js, migration 122), in
// parallel with the app's: same text, same href, same `push: false` rule
// (lib/notify.js never calls in here then).
//
// Since 2026-11-16 (migration 125) a token remembers the Clerk sign-in it
// was registered under (clerk_session_id), and a send skips and disables a
// token whose sign-in has ended, been revoked or been removed — a phone
// signed out from elsewhere never ran its own sign-out
// (lib/pushSessionRules.js). The app also forgets its token when it finds
// itself signed out, by the token alone (unregisterPushTokenByToken).
// Before 125 the column is left out and every token behaves as before.

const PUSH_URL = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;
const isMissingTable = (error) => Boolean(error && /could not find the table|relation .* does not exist|PGRST205/i.test(error.message || ''));
const looksLikeExpoToken = (t) => /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(String(t || ''));

export async function registerPushToken({ userId, token, platform, deviceName, appVersion, sessionId = null }) {
  if (!userId) throw Object.assign(new Error('Sign in first.'), { status: 401 });
  if (!looksLikeExpoToken(token)) throw Object.assign(new Error('That isn’t an Expo push token.'), { status: 400 });
  const now = new Date().toISOString();
  const { error } = await upsertCompat(getSupabase(), 'push_tokens', {
    token,
    user_id: userId,
    platform: platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : null,
    device_name: String(deviceName || '').slice(0, 80) || null,
    app_version: String(appVersion || '').slice(0, 40) || null,
    last_seen_at: now,
    disabled_at: null,
    disabled_reason: null,
    // The sign-in this phone registered under (migration 125).
    clerk_session_id: cleanSessionId(sessionId)
  }, ['clerk_session_id'], { onConflict: 'token' });
  if (error) {
    if (isMissingTable(error)) throw new Error('Run migration 102 (push tokens) in Supabase first.');
    throw new Error(error.message);
  }
  return { ok: true };
}

export async function unregisterPushToken({ userId, token }) {
  if (!userId || !token) return { ok: true };
  const { error } = await getSupabase().from('push_tokens').update({ disabled_at: new Date().toISOString(), disabled_reason: 'switched off in the app' }).eq('token', token).eq('user_id', userId);
  if (error && !isMissingTable(error)) throw new Error(error.message);
  return { ok: true };
}

// The app found itself signed out (signed out from elsewhere, or its own
// sign-out couldn't reach us): it has no session to send, only the token,
// which is the secret here — only this phone and Expo know it. Disables
// that one row, whoever's it is; nothing else.
export async function unregisterPushTokenByToken({ token }) {
  if (!looksLikeExpoToken(token)) return { ok: true };
  const { error } = await getSupabase().from('push_tokens').update({ disabled_at: new Date().toISOString(), disabled_reason: 'signed out on the phone' }).eq('token', token).is('disabled_at', null);
  if (error && !isMissingTable(error)) throw new Error(error.message);
  return { ok: true };
}

export async function pushTokensFor(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await selectCompat(
    (columns) => getSupabase().from('push_tokens').select(columns).in('user_id', ids).is('disabled_at', null).limit(2000),
    'token, user_id',
    ['clerk_session_id']
  );
  if (error) {
    if (!isMissingTable(error)) console.error('pushTokensFor:', error.message);
    return [];
  }
  return data || [];
}

async function disableTokens(tokens, reason) {
  if (!tokens.length) return;
  const { error } = await getSupabase().from('push_tokens').update({ disabled_at: new Date().toISOString(), disabled_reason: reason }).in('token', tokens);
  if (error) console.error('disableTokens:', error.message);
}

// Send one message to many people, on their phones (the app) and their
// browsers. `items`: [{ userId, title?, body, href?, data? }]. Returns the
// app's { sent, failed, disabled } with the browsers' as `web`. Never
// throws: a push is a nicety on top of the notifications row.
export async function sendPushMany(items) {
  const [app, web] = await Promise.all([sendExpoPushMany(items), sendWebPushMany(items)]);
  return { ...app, web };
}

async function sendExpoPushMany(items) {
  const out = { sent: 0, failed: 0, disabled: 0 };
  try {
    const list = (items || []).filter((i) => i && i.userId && i.body);
    if (!list.length) return out;
    const rows = await pushTokensFor(list.map((i) => i.userId));
    if (!rows.length) return out;
    // A token whose sign-in has ended is disabled, not sent to.
    const ended = await endedPushSessions(rows.map((r) => r.clerk_session_id));
    const { send: tokens, stop } = splitBySession(rows, ended);
    if (stop.length) {
      await disableTokens(stop.map((r) => r.token), SESSION_ENDED_REASON);
      out.disabled += stop.length;
    }
    if (!tokens.length) return out;
    const byUser = new Map();
    for (const t of tokens) byUser.set(t.user_id, [...(byUser.get(t.user_id) || []), t.token]);
    const messages = [];
    for (const i of list) {
      for (const token of byUser.get(i.userId) || []) {
        messages.push({ to: token, title: i.title || SITE.name, body: String(i.body).slice(0, 180), data: { href: i.href || null, ...(i.data || {}) }, sound: 'default', channelId: 'default' });
      }
    }
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    const dead = [];
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      const res = await fetch(PUSH_URL(), { method: 'POST', headers, body: JSON.stringify(chunk) });
      if (!res.ok) {
        out.failed += chunk.length;
        console.error('sendPushMany: Expo answered', res.status);
        continue;
      }
      const body = await res.json().catch(() => ({}));
      const tickets = Array.isArray(body.data) ? body.data : [];
      tickets.forEach((t, idx) => {
        if (t && t.status === 'ok') out.sent += 1;
        else {
          out.failed += 1;
          const code = t && t.details && t.details.error;
          if (code === 'DeviceNotRegistered' && chunk[idx]) dead.push(chunk[idx].to);
        }
      });
    }
    if (dead.length) {
      await disableTokens(dead, 'DeviceNotRegistered');
      out.disabled += dead.length;
    }
  } catch (err) {
    console.error('sendPushMany:', err.message);
  }
  return out;
}

export function sendPush({ userId, title, body, href, data }) {
  return sendPushMany([{ userId, title, body, href, data }]);
}
