import { getSupabase } from './supabase';
import { SITE } from './siteConfig';
import { encryptPushMessage, vapidAuthorization } from './webPushCrypto';
import {
  webPushConfig, normalizeSubscription, allowedPushEndpoint, webPushPayload, pushGone, disableReason,
  MAX_LIVE_BROWSERS, WEB_PUSH_TTL_SECONDS, MIGRATION_LINE, NOT_SET_UP_LINE
} from './webPushRules';

// SERVER-ONLY. Notifications on the website (Jose, 2026-11-12; migration
// 122's web_push_subscriptions; the rules are lib/webPushRules.js). A
// browser that said yes on Account → Preferences is stored by its push
// endpoint; every notification lib/notify.js writes also goes to the
// person's live browsers through lib/push.js, with the same text and the
// bell's href. A push service answering 404 or 410 disables the row (never
// deleted); anything else is logged and never breaks the notification.
// Before migration 122 every route answers 503 { code: 'migration-122' };
// without the Vercel keys, 503 { code: 'not-set-up' } and nothing is sent.

export class WebPushError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

const TABLE = 'web_push_subscriptions';
const CONCURRENCY = 8;
const SEND_TIMEOUT_MS = 8000;

function isMissingTable(error) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|relation .* does not exist/i.test(String(error.message || ''));
}

export function webPushSettings() {
  return webPushConfig(process.env, { contactEmail: SITE.contactEmail });
}

// The rig's push-service stand-in (WEB_PUSH_TEST_ORIGIN), never in
// production.
export function pushTestOrigin() {
  if (process.env.NODE_ENV === 'production') return null;
  const origin = String(process.env.WEB_PUSH_TEST_ORIGIN || '').trim();
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch (e) {
    return null;
  }
}

// Whether migration 122 has run. Remembered once it has.
let tableReady = false;
export async function webPushTableReady() {
  if (tableReady) return true;
  const { error } = await getSupabase().from(TABLE).select('endpoint').limit(0);
  if (!error) {
    tableReady = true;
    return true;
  }
  if (isMissingTable(error)) return false;
  throw error;
}

function migrationError() {
  return new WebPushError(MIGRATION_LINE, 503, 'migration-122');
}

// What the Preferences row needs before it shows the switch.
export async function webPushStatus() {
  const cfg = webPushSettings();
  let migrationReady = true;
  try {
    migrationReady = await webPushTableReady();
  } catch (err) {
    console.error('webPush status:', err.message);
  }
  return { ready: cfg.ready, publicKey: cfg.publicKey, migrationReady };
}

// Save (or refresh) this browser for `userId`. The same endpoint signed in
// as someone else is re-bound to them: it is their browser now.
export async function subscribeBrowser({ userId, subscription, userAgent = '' }) {
  if (!userId) throw new WebPushError('Sign in first.', 401);
  const cfg = webPushSettings();
  if (!cfg.ready) throw new WebPushError(NOT_SET_UP_LINE, 503, 'not-set-up');
  const sub = normalizeSubscription(subscription, { testOrigin: pushTestOrigin() });
  if (sub.error) throw new WebPushError(sub.error, 400);
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase.from(TABLE).upsert({
    endpoint: sub.endpoint,
    user_id: userId,
    p256dh: sub.p256dh,
    auth: sub.auth,
    user_agent: String(userAgent || '').slice(0, 300) || null,
    last_seen_at: now,
    disabled_at: null,
    disabled_reason: null
  }, { onConflict: 'endpoint' });
  if (error) {
    if (isMissingTable(error)) throw migrationError();
    throw error;
  }
  // At most MAX_LIVE_BROWSERS live browsers per account: the least recently
  // seen beyond that stop receiving (this one was just seen).
  const { data: live, error: liveError } = await supabase.from(TABLE).select('endpoint, last_seen_at').eq('user_id', userId).is('disabled_at', null).order('last_seen_at', { ascending: false }).limit(200);
  if (liveError) {
    console.error('webPush cap:', liveError.message);
  } else if ((live || []).length > MAX_LIVE_BROWSERS) {
    const extra = live.slice(MAX_LIVE_BROWSERS).map((r) => r.endpoint).filter((e) => e !== sub.endpoint);
    if (extra.length) {
      const { error: capError } = await supabase.from(TABLE).update({ disabled_at: now, disabled_reason: disableReason('replaced') }).in('endpoint', extra);
      if (capError) console.error('webPush cap:', capError.message);
    }
  }
  return { ok: true };
}

// Stop sending to this browser. The endpoint alone is enough (sign-out
// sends it after the session is gone); it is a long secret address only
// that browser and its push service know.
export async function unsubscribeBrowser({ endpoint, reason = 'switched-off' }) {
  const e = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (!e || e.length > 1024) return { ok: true };
  const { error } = await getSupabase().from(TABLE).update({ disabled_at: new Date().toISOString(), disabled_reason: disableReason(reason) }).eq('endpoint', e).is('disabled_at', null);
  if (error) {
    if (isMissingTable(error)) throw migrationError();
    throw error;
  }
  return { ok: true };
}

async function liveRowsFor(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await getSupabase().from(TABLE).select('endpoint, user_id, p256dh, auth').in('user_id', ids.slice(i, i + 200)).is('disabled_at', null).limit(2000);
    if (error) {
      if (!isMissingTable(error)) console.error('webPush rows:', error.message);
      return rows;
    }
    rows.push(...(data || []));
  }
  return rows;
}

async function disableRows(endpoints, reason) {
  if (!endpoints.length) return;
  const { error } = await getSupabase().from(TABLE).update({ disabled_at: new Date().toISOString(), disabled_reason: reason }).in('endpoint', endpoints);
  if (error) console.error('webPush disable:', error.message);
}

const hostOf = (endpoint) => {
  try {
    return new URL(endpoint).host;
  } catch (e) {
    return 'unknown';
  }
};

// One POST to one browser's push service. Returns the status (0 = no
// answer). The endpoint is checked again here: only a push service's.
async function sendOne(row, payload, cfg, tokens, testOrigin) {
  if (!allowedPushEndpoint(row.endpoint, { testOrigin })) return { status: 0, refused: true };
  let body;
  try {
    body = await encryptPushMessage(payload, row);
  } catch (err) {
    return { status: 0, badKeys: true };
  }
  // One VAPID token per push service per send (they last 12 hours).
  const aud = new URL(row.endpoint).origin;
  if (!tokens.has(aud)) tokens.set(aud, vapidAuthorization(row.endpoint, cfg));
  try {
    const authorization = await tokens.get(aud);
    const res = await fetch(row.endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: authorization,
        TTL: String(WEB_PUSH_TTL_SECONDS),
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream'
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    return { status: res.status };
  } catch (err) {
    return { status: 0, error: err.name === 'TimeoutError' ? 'timed out' : err.message };
  }
}

// `items`: [{ userId, title?, body, href?, data? }] — what lib/push.js
// sends to the app. Returns { sent, failed, disabled, skipped? }. Never
// throws: a notification on the website is a nicety on top of the row.
export async function sendWebPushMany(items) {
  const out = { sent: 0, failed: 0, disabled: 0 };
  try {
    const cfg = webPushSettings();
    if (!cfg.ready) return { ...out, skipped: 'not-set-up' };
    const list = (items || []).filter((i) => i && i.userId && i.body);
    if (!list.length) return out;
    const rows = await liveRowsFor(list.map((i) => i.userId));
    if (!rows.length) return out;
    const byUser = new Map();
    for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r]);
    const jobs = [];
    for (const i of list) {
      const payload = JSON.stringify(webPushPayload({ title: i.title, body: i.body, href: i.href, type: i.data && i.data.type }, { siteName: SITE.name }));
      for (const row of byUser.get(i.userId) || []) jobs.push({ row, payload });
    }
    const tokens = new Map();
    const testOrigin = pushTestOrigin();
    const gone = [];
    const badKeys = [];
    let next = 0;
    async function worker() {
      while (next < jobs.length) {
        const job = jobs[next];
        next += 1;
        const result = await sendOne(job.row, job.payload, cfg, tokens, testOrigin);
        if (result.status >= 200 && result.status < 300) {
          out.sent += 1;
        } else {
          out.failed += 1;
          if (pushGone(result.status)) gone.push(job.row.endpoint);
          else if (result.badKeys) badKeys.push(job.row.endpoint);
          else if (!result.refused) console.error(`webPush: ${hostOf(job.row.endpoint)} answered ${result.status || result.error || 'nothing'}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    const goneSet = [...new Set(gone)];
    if (goneSet.length) {
      await disableRows(goneSet, 'the push service says this browser is gone');
      out.disabled += goneSet.length;
    }
    const badSet = [...new Set(badKeys)].filter((e) => !goneSet.includes(e));
    if (badSet.length) {
      await disableRows(badSet, 'the browser’s keys can’t be used');
      out.disabled += badSet.length;
    }
  } catch (err) {
    console.error('sendWebPushMany:', err.message);
  }
  return out;
}
