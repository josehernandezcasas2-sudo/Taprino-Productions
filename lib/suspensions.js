import { getSupabase } from './supabase';
import { getStripe } from './stripe';
import { notifyCreator, sendEmail } from './notify';
import { getUserEmail } from './messages';
import { getUserRole } from './roles';
import { getPublicIdentities, getPublicProfile } from './userProfiles';
import { getStripeCustomerIdForClerkUser } from './clerkStripeLink';
import { suspensionPayload, untilLabel, validateSuspension, SCOPES } from './suspensionRules';
import { forgetSuspension } from './suspensionGate';
import { SITE } from './siteConfig';

// SERVER-ONLY. Account suspensions (migration 102; Jose, 2026-10-24).
// The site's own suspension, not Clerk's: a row in account_suspensions
// bounces the person to /suspended on the web and the app's gate on
// every page load, and refuses every write, until it lifts or runs out
// (middleware.js through lib/suspensionGate.js). Sign-in keeps working so
// they can read why and how to appeal; nothing is deleted. Scope 'tips'
// only switches tipping off for them (lib/tips.js getTipping).

const isMissingTable = (error) => Boolean(error && /could not find the table|relation .* does not exist|PGRST205/i.test(error.message || ''));
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const siteUrl = () => SITE.productionDomain || 'https://www.studiotapatv.site';

export function rowToSuspension(row) {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope,
    publicReason: row.public_reason,
    note: row.note || null,
    untilAt: row.until_at || null,
    cancelMembership: Boolean(row.cancel_membership),
    createdBy: row.created_by,
    createdByEmail: row.created_by_email || null,
    createdAt: row.created_at,
    liftedAt: row.lifted_at || null,
    liftedBy: row.lifted_by || null,
    liftNote: row.lift_note || null
  };
}

async function rowsFor(userId) {
  const { data, error } = await getSupabase().from('account_suspensions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  return data || [];
}

// What's in force for this person: null, or { scope, reason, until,
// cancelMembership, since } (lib/suspensionRules.js suspensionPayload).
export async function getSuspensionFor(userId) {
  if (!userId) return null;
  try {
    return suspensionPayload(await rowsFor(userId));
  } catch (err) {
    console.error('getSuspensionFor:', err.message);
    return null;
  }
}

// Throws the message a refused write should carry. `scope` 'all' = any
// site action, 'tips' = tipping.
export async function assertNotSuspended(userId, scope = 'all') {
  const s = await getSuspensionFor(userId);
  if (!s) return null;
  if (s.scope === 'all' || s.scope === scope) {
    const err = new Error(s.scope === 'all'
      ? `Your account is suspended ${untilLabel(s.until)}. Write to ${SITE.contactEmail} to appeal.`
      : `Tipping is switched off for your account. Write to ${SITE.contactEmail} if you think that’s a mistake.`);
    err.status = 403;
    err.suspended = s;
    throw err;
  }
  return s;
}

// Stop the membership renewing (Stripe: cancel at period end). Best
// effort; the suspension stands either way.
async function cancelMembershipAtPeriodEnd(userId) {
  try {
    const customerId = await getStripeCustomerIdForClerkUser(userId);
    if (!customerId) return { changed: 0 };
    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10 });
    let changed = 0;
    for (const sub of subs.data || []) {
      if (!sub.cancel_at_period_end) {
        await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
        changed += 1;
      }
    }
    return { changed };
  } catch (err) {
    console.error('cancelMembershipAtPeriodEnd:', err.message);
    return { changed: 0, error: err.message };
  }
}

async function nameOf(userId) {
  const ids = await getPublicIdentities([userId]).catch(() => ({}));
  return ids[userId] ? ids[userId].displayName : 'there';
}

// Suspend. The person gets an email (and a notification they'll see
// once it lifts, or straight away for a tips-only block). Returns the row.
export async function suspendAccount({ userId, scope, publicReason, note, untilAt, cancelMembership = false, actorId, actorEmail }) {
  if (!userId) throw new Error('Who?');
  if (userId === actorId) throw new Error('You can’t suspend yourself.');
  const check = validateSuspension({ scope, publicReason, untilAt });
  if (!check.ok) throw new Error(check.error);
  const role = await getUserRole(userId).catch(() => null);
  if (role === 'admin') throw new Error('Full admins can’t be suspended from here; change their role first.');
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('account_suspensions').insert({
    user_id: userId,
    scope: check.scope,
    public_reason: check.publicReason,
    note: String(note || '').trim().slice(0, 1000) || null,
    until_at: check.untilAt,
    cancel_membership: check.scope === 'all' && Boolean(cancelMembership),
    created_by: actorId || 'admin',
    created_by_email: actorEmail || null
  }).select('*').single();
  if (error) {
    if (isMissingTable(error)) throw new Error('Run migration 102 (suspensions) in Supabase first.');
    throw new Error(error.message);
  }
  forgetSuspension(userId);

  let membership = null;
  if (row.cancel_membership) membership = await cancelMembershipAtPeriodEnd(userId);

  const name = await nameOf(userId);
  const until = untilLabel(row.until_at);
  const to = await getUserEmail(userId).catch(() => null);
  if (to) {
    const subject = check.scope === 'all' ? `Your ${SITE.name} account is suspended` : `Tipping is switched off on your ${SITE.name} account`;
    const html = check.scope === 'all'
      ? `<p>Hi ${esc(name)},</p><p>Your ${esc(SITE.name)} account is suspended ${esc(until)}.</p><blockquote>${esc(check.publicReason)}</blockquote><p>While it lasts you can’t watch, tip, back, buy, message or post. Nothing is deleted.${row.cancel_membership ? ' Your membership won’t renew while this lasts.' : ''}</p><p>To appeal, reply to this email from the address on your account and tell us what happened. A person reads every one; we answer within a few days.</p><p><a href="${siteUrl()}/suspended">${siteUrl()}/suspended</a></p>`
      : `<p>Hi ${esc(name)},</p><p>Tipping is switched off on your ${esc(SITE.name)} account ${esc(until)}.</p><blockquote>${esc(check.publicReason)}</blockquote><p>Everything else works as usual. If you think this is a mistake, reply to this email.</p>`;
    await sendEmail({ to, subject, html }).catch((err) => console.error('suspend email:', err.message));
  }
  await notifyCreator({
    userId,
    type: check.scope === 'all' ? 'suspended' : 'tips_blocked',
    href: '/account',
    message: check.scope === 'all' ? `Your account is suspended ${until}. ${check.publicReason}` : `Tipping is switched off on your account ${until}. ${check.publicReason}`
  }).catch(() => {});
  return { suspension: rowToSuspension(row), membership };
}

// /admin/tips "Block from tipping": a tips-only suspension for the fan
// who sent this tip, with the line they'll read.
export async function blockTipperFromTip({ tipId, publicReason, actorId, actorEmail }) {
  const { data: tip, error } = await getSupabase().from('creator_tips').select('id, tipper_id').eq('id', tipId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!tip) throw new Error('No such tip.');
  const out = await suspendAccount({ userId: tip.tipper_id, scope: 'tips', publicReason, note: `From tip ${tipId} on /admin/tips`, actorId, actorEmail });
  return { ...out, tipperId: tip.tipper_id };
}

// Lift every row in force for this person.
export async function liftSuspension({ userId, actorId, actorEmail, note }) {
  if (!userId) throw new Error('Who?');
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('account_suspensions')
    .update({ lifted_at: now, lifted_by: actorEmail || actorId || 'admin', lift_note: String(note || '').trim().slice(0, 500) || null })
    .eq('user_id', userId).is('lifted_at', null).select('*');
  if (error) throw new Error(error.message);
  forgetSuspension(userId);
  const lifted = (data || []).map(rowToSuspension);
  if (lifted.length) {
    const name = await nameOf(userId);
    const to = await getUserEmail(userId).catch(() => null);
    if (to) {
      await sendEmail({ to, subject: `Your ${SITE.name} account is back`, html: `<p>Hi ${esc(name)},</p><p>The suspension on your ${esc(SITE.name)} account has been lifted. Everything is where you left it.</p><p><a href="${siteUrl()}/account">${siteUrl()}/account</a></p>` }).catch(() => {});
    }
    await notifyCreator({ userId, type: 'suspension_lifted', href: '/account', message: 'The suspension on your account has been lifted. Everything is where you left it.' }).catch(() => {});
  }
  return { lifted };
}

// The admin page: who is suspended now, and the recent history.
export async function listSuspensions({ limit = 100 } = {}) {
  const { data, error } = await getSupabase().from('account_suspensions').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) {
    if (isMissingTable(error)) return { available: false, active: [], recent: [] };
    throw new Error(error.message);
  }
  const rows = data || [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const names = ids.length ? await getPublicIdentities(ids).catch(() => ({})) : {};
  const decorate = (r) => ({ ...rowToSuspension(r), displayName: names[r.user_id] ? names[r.user_id].displayName : 'Someone', handle: names[r.user_id] ? names[r.user_id].handle || null : null });
  const now = new Date();
  const active = rows.filter((r) => suspensionPayload([r], now)).map(decorate);
  return { available: true, active, recent: rows.map(decorate), scopes: SCOPES };
}

// Search by name or @handle (user_profiles), or a Clerk user id typed in.
export async function searchAccounts(q, { limit = 12 } = {}) {
  const needle = String(q || '').trim();
  if (!needle) return [];
  const supabase = getSupabase();
  const handle = needle.replace(/^@/, '');
  const [byName, byHandle, byId] = await Promise.all([
    supabase.from('user_profiles').select('user_id, display_name, handle, created_at').ilike('display_name', `%${needle}%`).limit(limit),
    supabase.from('user_profiles').select('user_id, display_name, handle, created_at').ilike('handle', `${handle}%`).limit(limit),
    /^user_[A-Za-z0-9]+$/.test(needle) ? supabase.from('user_profiles').select('user_id, display_name, handle, created_at').eq('user_id', needle).limit(1) : Promise.resolve({ data: [] })
  ]);
  const seen = new Map();
  for (const r of [...(byId.data || []), ...(byHandle.data || []), ...(byName.data || [])]) if (!seen.has(r.user_id)) seen.set(r.user_id, r);
  if (/^user_[A-Za-z0-9]+$/.test(needle) && !seen.has(needle)) seen.set(needle, { user_id: needle, display_name: null, handle: null, created_at: null });
  return [...seen.values()].slice(0, limit).map((r) => ({ userId: r.user_id, displayName: r.display_name || 'No profile yet', handle: r.handle || null, joinedAt: r.created_at || null }));
}

// One account, with what an admin weighs before suspending.
export async function getAccountCard(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const [profile, role, rows, tipsSent, tipsGot, profileReports, noteReports, dmReports, payout] = await Promise.all([
    getPublicProfile(userId).catch(() => null),
    getUserRole(userId).catch(() => null),
    rowsFor(userId).catch(() => []),
    supabase.from('creator_tips').select('id', { count: 'exact', head: true }).eq('tipper_id', userId).eq('status', 'completed'),
    supabase.from('creator_tips').select('id', { count: 'exact', head: true }).eq('creator_id', userId).eq('status', 'completed'),
    supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('target_type', 'profile').eq('target_id', userId),
    supabase.from('creator_tips').select('id').eq('tipper_id', userId).not('note', 'is', null),
    supabase.from('dm_reports').select('id', { count: 'exact', head: true }).eq('reported_id', userId),
    supabase.from('creator_payout_accounts').select('charges_enabled').eq('user_id', userId).maybeSingle()
  ]);
  const tipIds = (noteReports.data || []).map((t) => t.id);
  const reportedNotes = tipIds.length ? await supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('target_type', 'tip').in('target_id', tipIds) : { count: 0 };
  const email = await getUserEmail(userId).catch(() => null);
  return {
    userId,
    displayName: profile ? profile.displayName : 'No profile yet',
    handle: profile ? profile.handle || null : null,
    joinedAt: profile ? profile.joinedAt || null : null,
    email,
    role,
    isAdmin: role === 'admin',
    counts: {
      tipsSent: tipsSent.count || 0,
      tipsReceived: tipsGot.count || 0,
      profileReports: profileReports.count || 0,
      noteReports: reportedNotes.count || 0,
      messageReports: dmReports.count || 0
    },
    payoutsReady: Boolean(payout.data && payout.data.charges_enabled),
    current: suspensionPayload(rows),
    history: rows.map(rowToSuspension)
  };
}
