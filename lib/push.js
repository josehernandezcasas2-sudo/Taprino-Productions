import { getSupabase } from './supabase';
import { SITE } from './siteConfig';

// SERVER-ONLY. Push notifications for the app (migration 102
// push_tokens; Jose, 2026-10-24). The app registers its Expo push token
// through /api/push/register; every notifications row written by
// lib/notify.js also goes out as a push to that person's devices, with
// the row's href as data so a tap opens the right screen. Sent through
// Expo's push service (EXPO_PUSH_URL overrides it for a local run;
// EXPO_ACCESS_TOKEN is optional). A token Expo reports as
// DeviceNotRegistered is disabled, never deleted.

const PUSH_URL = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;
const isMissingTable = (error) => Boolean(error && /could not find the table|relation .* does not exist|PGRST205/i.test(error.message || ''));
const looksLikeExpoToken = (t) => /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(String(t || ''));

export async function registerPushToken({ userId, token, platform, deviceName, appVersion }) {
  if (!userId) throw Object.assign(new Error('Sign in first.'), { status: 401 });
  if (!looksLikeExpoToken(token)) throw Object.assign(new Error('That isn’t an Expo push token.'), { status: 400 });
  const now = new Date().toISOString();
  const { error } = await getSupabase().from('push_tokens').upsert({
    token,
    user_id: userId,
    platform: platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : null,
    device_name: String(deviceName || '').slice(0, 80) || null,
    app_version: String(appVersion || '').slice(0, 40) || null,
    last_seen_at: now,
    disabled_at: null,
    disabled_reason: null
  }, { onConflict: 'token' });
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

export async function pushTokensFor(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await getSupabase().from('push_tokens').select('token, user_id').in('user_id', ids).is('disabled_at', null).limit(2000);
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

// Send one message to many people. `items`: [{ userId, title?, body, href?, data? }].
// Returns { sent, failed, disabled }. Never throws: a push is a nicety on
// top of the notifications row.
export async function sendPushMany(items) {
  const out = { sent: 0, failed: 0, disabled: 0 };
  try {
    const list = (items || []).filter((i) => i && i.userId && i.body);
    if (!list.length) return out;
    const tokens = await pushTokensFor(list.map((i) => i.userId));
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
      out.disabled = dead.length;
    }
  } catch (err) {
    console.error('sendPushMany:', err.message);
  }
  return out;
}

export function sendPush({ userId, title, body, href, data }) {
  return sendPushMany([{ userId, title, body, href, data }]);
}
