import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { sendEmail, notifyCreator } from './notify';
import { checkRateLimit } from './rateLimit';
import { submitReport } from './moderation';
import { SITE } from './siteConfig';

// Direct messages (migration 080). One thread per pair of people; every
// thread remembers the latest thing it was about (a card, gear, a call).
//
// Rules Jose set (2026-10-10):
//   - anyone signed in can start a conversation; daily limits + blocking
//     handle abuse
//   - email on a new message, at most one per thread every 30 minutes,
//     never when the thread is muted
//   - messages are private; a report snapshots the last messages for the
//     admin and files a profile report through lib/moderation.js
//   - the app shows a badge (no push until there's a real build)

import { MAX_MESSAGE_CHARS, CONTEXT_KINDS } from './messageRules';

export { MAX_MESSAGE_CHARS, CONTEXT_KINDS };
const INBOX_LIMIT = 100;
const PAGE_SIZE = 100;
const PREVIEW_CHARS = 120;
const EMAIL_EVERY_MS = 30 * 60 * 1000;
const NEW_THREADS_PER_DAY = 20;
const MESSAGES_PER_DAY = 200;
const SNAPSHOT_SIZE = 20;

export class MessageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new MessageError(message, status); };

export function isMissingMessagesTable(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation "?(dm_|user_blocks)/i.test(error.message || '');
}

const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const otherOf = (thread, me) => (thread.user_a === me ? thread.user_b : thread.user_a);
const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

function cleanContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const kind = CONTEXT_KINDS.includes(ctx.kind) ? ctx.kind : null;
  const label = str(ctx.label, 80);
  if (!kind || !label) return null;
  const out = { kind, label };
  const id = str(ctx.id, 80);
  if (id) out.id = id;
  return out;
}

/* ---------- blocks ---------- */

export async function getBlocksBetween(me, other) {
  const { data, error } = await getSupabase()
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(`and(blocker_id.eq.${me},blocked_id.eq.${other}),and(blocker_id.eq.${other},blocked_id.eq.${me})`);
  if (error) {
    if (isMissingMessagesTable(error)) return { iBlocked: false, blockedMe: false };
    throw new Error(error.message);
  }
  return {
    iBlocked: (data || []).some((r) => r.blocker_id === me),
    blockedMe: (data || []).some((r) => r.blocker_id === other)
  };
}

// Everyone this person has blocked or been blocked by — the directory
// leaves them out in both directions.
export async function blockedIdsFor(userId) {
  const out = new Set();
  if (!userId) return out;
  const supabase = getSupabase();
  const [mine, theirs] = await Promise.all([
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id', userId),
    supabase.from('user_blocks').select('blocker_id').eq('blocked_id', userId)
  ]);
  for (const r of mine.data || []) out.add(r.blocked_id);
  for (const r of theirs.data || []) out.add(r.blocker_id);
  return out;
}

export async function setBlock(me, other, blocked) {
  if (!other || other === me) fail('Pick a person.');
  const supabase = getSupabase();
  const { error } = blocked
    ? await supabase.from('user_blocks').upsert({ blocker_id: me, blocked_id: other }, { onConflict: 'blocker_id,blocked_id' })
    : await supabase.from('user_blocks').delete().eq('blocker_id', me).eq('blocked_id', other);
  if (error) throw new Error(error.message);
  return { blocked: Boolean(blocked) };
}

export async function listBlocked(me) {
  const { data, error } = await getSupabase().from('user_blocks').select('blocked_id, created_at').eq('blocker_id', me).order('created_at', { ascending: false });
  if (error) {
    if (isMissingMessagesTable(error)) return [];
    throw new Error(error.message);
  }
  const profiles = await getPublicProfilesByIds((data || []).map((r) => r.blocked_id));
  return (data || []).map((r) => ({ ...toPerson(profiles[r.blocked_id]), blockedAt: r.created_at }));
}

/* ---------- reads ---------- */

function toPerson(profile) {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    handle: profile.handle,
    avatarUrl: profile.avatarUrl,
    profilePath: profilePath(profile)
  };
}

async function statesFor(me, threadIds) {
  const map = new Map();
  if (threadIds.length === 0) return map;
  const { data } = await getSupabase().from('dm_thread_state').select('*').eq('user_id', me).in('thread_id', threadIds);
  for (const s of data || []) map.set(s.thread_id, s);
  return map;
}

function isUnread(thread, state, me) {
  if (!thread.last_message_at || thread.last_sender_id === me) return false;
  return !state || !state.last_read_at || state.last_read_at < thread.last_message_at;
}

async function threadsOf(me, limit) {
  const { data, error } = await getSupabase()
    .from('dm_threads')
    .select('*')
    .or(`user_a.eq.${me},user_b.eq.${me}`)
    .not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingMessagesTable(error)) return [];
    throw new Error(error.message);
  }
  return data || [];
}

// The inbox: newest conversation first, with who it's with and whether
// there's something new.
export async function listThreads(me) {
  const rows = await threadsOf(me, INBOX_LIMIT);
  const [states, profiles] = await Promise.all([
    statesFor(me, rows.map((t) => t.id)),
    getPublicProfilesByIds(rows.map((t) => otherOf(t, me)))
  ]);
  const threads = rows.map((t) => {
    const s = states.get(t.id);
    return {
      id: t.id,
      other: toPerson(profiles[otherOf(t, me)]),
      context: t.context || null,
      lastMessageAt: t.last_message_at,
      preview: t.last_message_preview || '',
      lastSenderId: t.last_sender_id,
      unread: isUnread(t, s, me),
      muted: Boolean(s && s.muted)
    };
  });
  return { threads, unread: threads.filter((t) => t.unread).length };
}

// For the header badge: how many conversations have something new.
export async function countUnread(me) {
  if (!me) return 0;
  const rows = await threadsOf(me, 200);
  const states = await statesFor(me, rows.map((t) => t.id));
  return rows.filter((t) => isUnread(t, states.get(t.id), me)).length;
}

async function loadThread(me, threadId) {
  const { data, error } = await getSupabase().from('dm_threads').select('*').eq('id', threadId).maybeSingle();
  if (error) {
    if (isMissingMessagesTable(error)) fail('Messages aren’t set up yet — the admin needs to run migration 080.', 503);
    throw new Error(error.message);
  }
  if (!data || (data.user_a !== me && data.user_b !== me)) fail('Not found.', 404);
  return data;
}

async function markRead(me, threadId) {
  await getSupabase().from('dm_thread_state').upsert({ thread_id: threadId, user_id: me, last_read_at: new Date().toISOString() }, { onConflict: 'thread_id,user_id' });
}

const toMessage = (m) => ({ id: m.id, senderId: m.sender_id, body: m.body, createdAt: m.created_at });

// One conversation. `since` (ISO) returns only newer messages, for the
// poll while the thread is open; either way opening it marks it read.
export async function getConversation(me, threadId, { since } = {}) {
  const thread = await loadThread(me, threadId);
  const other = otherOf(thread, me);
  let q = getSupabase().from('dm_messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true });
  if (since) q = q.gt('created_at', since);
  else q = q.limit(PAGE_SIZE);
  const [{ data: msgs, error }, profiles, blocks, states] = await Promise.all([
    q,
    since ? Promise.resolve(null) : getPublicProfilesByIds([other]),
    since ? Promise.resolve(null) : getBlocksBetween(me, other),
    since ? Promise.resolve(null) : statesFor(me, [threadId])
  ]);
  if (error) throw new Error(error.message);
  if ((msgs || []).length > 0 || !since) await markRead(me, threadId);
  const messages = (msgs || []).map(toMessage);
  if (since) return { messages };
  const s = states.get(threadId);
  return {
    thread: { id: thread.id, other: toPerson(profiles[other]), context: thread.context || null, muted: Boolean(s && s.muted), ...blocks },
    messages
  };
}

/* ---------- writes ---------- */

async function recipientEmail(userId) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    return primary ? primary.emailAddress : (user.emailAddresses[0] ? user.emailAddresses[0].emailAddress : null);
  } catch (err) {
    console.error('messages recipientEmail:', err.message);
    return null;
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Best effort, never blocks the send: the in-app notification (which
// feeds the header bell and the app badge) and the throttled email.
async function notifyRecipient({ thread, recipient, senderName, body }) {
  const supabase = getSupabase();
  const { data: state } = await supabase.from('dm_thread_state').select('muted, last_emailed_at').eq('thread_id', thread.id).eq('user_id', recipient).maybeSingle();
  if (state && state.muted) return;
  await notifyCreator({ userId: recipient, type: 'message', message: `${senderName} sent you a message${thread.context ? ` about ${thread.context.label}` : ''}.` });

  const lastEmailed = state && state.last_emailed_at ? new Date(state.last_emailed_at).getTime() : 0;
  if (Date.now() - lastEmailed < EMAIL_EVERY_MS) return;
  const to = await recipientEmail(recipient);
  if (!to) return;
  const link = `${SITE.productionDomain}/messages/${thread.id}`;
  const about = thread.context ? ` about ${thread.context.label}` : '';
  const result = await sendEmail({
    to,
    subject: `${senderName} wrote to you on ${SITE.name}`,
    html: `<p>${esc(senderName)} sent you a message${esc(about)}:</p><blockquote style="border-left:3px solid #f85f73;margin:0;padding:6px 12px;color:#444">${esc(body.slice(0, 400))}${body.length > 400 ? '…' : ''}</blockquote><p><a href="${link}">Reply on ${esc(SITE.name)}</a></p><p style="color:#888;font-size:12px">You get at most one email per conversation every 30 minutes. Mute the conversation to stop these.</p>`
  });
  if (result && (result.sent || result.skipped)) {
    await supabase.from('dm_thread_state').upsert({ thread_id: thread.id, user_id: recipient, last_emailed_at: new Date().toISOString() }, { onConflict: 'thread_id,user_id' });
  }
}

// Send in an existing thread (threadId) or start one (toUserId). The
// thread is created on the first message, never empty.
export async function sendMessage(me, { threadId, toUserId, body, context }) {
  if (!me) fail('Sign in to send messages.', 401);
  const text = str(body, MAX_MESSAGE_CHARS + 1);
  if (!text) fail('Write something first.');
  if (text.length > MAX_MESSAGE_CHARS) fail(`Keep it under ${MAX_MESSAGE_CHARS} characters.`);
  const ctx = cleanContext(context);
  const supabase = getSupabase();

  let thread = null;
  if (threadId) {
    thread = await loadThread(me, threadId);
  } else {
    const other = str(toUserId, 80);
    if (!other) fail('Pick a person to write to.');
    if (other === me) fail('That’s you.');
    const [a, b] = pair(me, other);
    const { data, error } = await supabase.from('dm_threads').select('*').eq('user_a', a).eq('user_b', b).maybeSingle();
    if (error) {
      if (isMissingMessagesTable(error)) fail('Messages aren’t set up yet — the admin needs to run migration 080.', 503);
      throw new Error(error.message);
    }
    thread = data;
  }
  const other = thread ? otherOf(thread, me) : str(toUserId, 80);

  const blocks = await getBlocksBetween(me, other);
  if (blocks.iBlocked) fail('You blocked this person. Unblock them to write.');
  if (blocks.blockedMe) fail('This person isn’t taking messages right now.', 403);

  if (!(await checkRateLimit(`dm-msg:${me}`, MESSAGES_PER_DAY, 86400))) fail('That’s a lot of messages for one day — try again tomorrow.', 429);
  if (!thread) {
    if (!(await checkRateLimit(`dm-new:${me}`, NEW_THREADS_PER_DAY, 86400))) fail('You’ve started a lot of conversations today — try again tomorrow.', 429);
    const [a, b] = pair(me, other);
    const { data, error } = await supabase.from('dm_threads').insert({ user_a: a, user_b: b, context: ctx }).select('*').single();
    if (error) {
      // Lost a race with the other person starting the same thread.
      if (error.code === '23505') {
        const { data: existing } = await supabase.from('dm_threads').select('*').eq('user_a', a).eq('user_b', b).single();
        thread = existing;
      } else {
        throw new Error(error.message);
      }
    } else {
      thread = data;
    }
  }

  const { data: msg, error: msgError } = await supabase.from('dm_messages').insert({ thread_id: thread.id, sender_id: me, body: text }).select('*').single();
  if (msgError) throw new Error(msgError.message);

  const patch = { last_message_at: msg.created_at, last_message_preview: text.slice(0, PREVIEW_CHARS), last_sender_id: me };
  if (ctx) patch.context = ctx;
  await Promise.all([
    supabase.from('dm_threads').update(patch).eq('id', thread.id),
    markRead(me, thread.id)
  ]);
  thread = { ...thread, ...patch };

  try {
    const profiles = await getPublicProfilesByIds([me]);
    await notifyRecipient({ thread, recipient: other, senderName: profiles[me].displayName, body: text });
  } catch (err) {
    console.error('messages notify:', err.message);
  }

  return { threadId: thread.id, message: toMessage(msg) };
}

export async function setMuted(me, threadId, muted) {
  await loadThread(me, threadId);
  const { error } = await getSupabase().from('dm_thread_state').upsert({ thread_id: threadId, user_id: me, muted: Boolean(muted) }, { onConflict: 'thread_id,user_id' });
  if (error) throw new Error(error.message);
  return { muted: Boolean(muted) };
}

// Snapshot the last messages for the admin, then file a profile report
// on the other person through the normal moderation flow (duplicates and
// a missing profile row don't stop the snapshot).
export async function reportThread(me, threadId, reason) {
  const thread = await loadThread(me, threadId);
  const other = otherOf(thread, me);
  const supabase = getSupabase();
  const { data: msgs } = await supabase.from('dm_messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: false }).limit(SNAPSHOT_SIZE);
  const snapshot = (msgs || []).reverse().map(toMessage);
  const { error } = await supabase.from('dm_reports').insert({ thread_id: threadId, reporter_id: me, reported_id: other, reason: str(reason, 40) || 'other', messages: snapshot });
  if (error) throw new Error(error.message);
  try {
    await submitReport({ reporterId: me, targetType: 'profile', targetId: other, reason });
  } catch (err) {
    if (!(err.status === 409 || err.status === 404)) console.error('messages report:', err.message);
  }
  return { ok: true };
}

/* ---------- admin ---------- */

export async function listMessageReports({ status = 'open' } = {}) {
  const { data, error } = await getSupabase().from('dm_reports').select('*').eq('status', status).order('created_at', { ascending: false }).limit(100);
  if (error) {
    if (isMissingMessagesTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  const ids = rows.flatMap((r) => [r.reporter_id, r.reported_id]);
  const profiles = await getPublicProfilesByIds(ids);
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    reporter: toPerson(profiles[r.reporter_id]),
    reported: toPerson(profiles[r.reported_id]),
    reason: r.reason,
    messages: Array.isArray(r.messages) ? r.messages : [],
    status: r.status,
    createdAt: r.created_at
  }));
}

export async function resolveMessageReport(adminId, reportId, status) {
  if (!['dismissed', 'upheld'].includes(status)) fail('status must be dismissed or upheld.');
  const { error } = await getSupabase().from('dm_reports').update({ status, resolved_at: new Date().toISOString(), resolved_by: adminId }).eq('id', reportId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
