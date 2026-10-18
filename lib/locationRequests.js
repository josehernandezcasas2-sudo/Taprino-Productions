import { getSupabase } from './supabase';
import { getStripe } from './stripe';
import { getPayoutAccount, isPayoutReady } from './creatorPayouts';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { sendMessage, getBlocksBetween, getUserEmail } from './messages';
import { notifyCreator, sendEmail } from './notify';
import { getPitchById } from './pitches';
import { checkRateLimit } from './rateLimit';
import { channelClock } from './channelEngine';
import { SITE } from './siteConfig';
import { toListing, publicListing, hostPerson, getHostRecords, isMissingLocationsTable, LocationError } from './locations';
import {
  quoteFor, splitBooking, dayCount, refundPercentFor, REQUEST_STATUS, MIN_BOOKING_CENTS, MAX_BOOKING_CENTS, MAX_DAYS, MAX_CREW, RESPOND_HOURS, MAX_ENDORSEMENT_CHARS, DEFAULT_CUT_PERCENT, dollars
} from './locationRules';

// Booking requests (migration 086, location_requests). The lifecycle:
//
//   requested ─┬─ accepted ── paid ── done (outcome set by the host)
//              ├─ countered ── accepted (producer takes the counter) ── …
//              ├─ declined / expired (48 h, RESPOND_HOURS)
//              └─ cancelled (either side; after paying, refunded per the
//                 listing's cancellation policy — the host refunds in full)
//
// Money: Stripe Checkout, destination charge to the host's Connect
// account (the same creator_payout_accounts row creators use), the
// platform cut (site_settings.location_platform_cut_percent, 10%) as the
// application fee plus the card fee the producer covers. The split is
// locked into the row when it's priced; a counter re-prices it.

const REQUESTS_PER_DAY = 20;
const fail = (message, status = 400) => { throw new LocationError(message, status); };
const str = (v, max) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const text = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const today = () => channelClock().date;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtRange(a, b) {
  const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return !b || b === a ? f(a) : `${f(a)}–${f(b)}`;
}

async function cutPercent() {
  const { data } = await getSupabase().from('site_settings').select('location_platform_cut_percent').eq('id', 1).maybeSingle();
  const n = data ? Number(data.location_platform_cut_percent) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_CUT_PERCENT;
}

/* ---------- shapes ---------- */

function toRequest(row, { listing = null, producer = null, host = null, viewerId = null, isAdmin = false } = {}) {
  const mineAsHost = Boolean(viewerId) && viewerId === row.host_id;
  const mineAsProducer = Boolean(viewerId) && viewerId === row.producer_id;
  const paid = ['paid', 'done', 'refunded'].includes(row.status);
  return {
    id: row.id,
    locationId: row.location_id,
    producerId: row.producer_id,
    hostId: row.host_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    days: dayCount(row.starts_on, row.ends_on),
    hoursFrom: row.hours_from || null,
    hoursTo: row.hours_to || null,
    hoursPerDay: row.hours_per_day,
    crewSize: row.crew_size,
    vehicles: row.vehicles,
    projectType: row.project_type || null,
    projectId: row.project_id || null,
    projectTitle: row.project_title || null,
    shooting: row.shooting || '',
    message: row.message || '',
    pricing: row.pricing,
    subtotalCents: row.subtotal_cents,
    cleaningCents: row.cleaning_cents,
    bookingCents: row.subtotal_cents + row.cleaning_cents,
    platformCutCents: row.platform_cut_cents,
    hostPayoutCents: row.host_payout_cents,
    feeCoverCents: row.fee_cover_cents,
    totalChargedCents: row.total_charged_cents,
    cutPercent: Number(row.cut_percent),
    counterCents: row.counter_cents,
    counterNote: row.counter_note || '',
    status: row.status,
    statusLabel: REQUEST_STATUS[row.status] || row.status,
    respondsBy: row.responds_by,
    threadId: row.thread_id,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    declineReason: row.decline_reason || '',
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    paidAt: row.paid_at,
    refundedAt: row.refunded_at,
    refundCents: row.refund_cents,
    refundReason: row.refund_reason || '',
    outcome: row.outcome,
    outcomeNote: row.outcome_note || '',
    outcomeAt: row.outcome_at,
    pastEnd: row.ends_on < today(),
    createdAt: row.created_at,
    mineAsHost,
    mineAsProducer,
    // The address rides along only once the booking is paid (or to the host/admin).
    listing: listing ? (mineAsHost || isAdmin || (mineAsProducer && paid) ? listing : publicListing(listing)) : null,
    producer,
    host
  };
}

async function peopleFor(rows) {
  const ids = [...new Set(rows.flatMap((r) => [r.producer_id, r.host_id]))];
  const [profiles, records] = await Promise.all([getPublicProfilesByIds(ids), getHostRecords(ids)]);
  const out = {};
  for (const id of ids) out[id] = hostPerson(profiles[id], records[id]);
  return out;
}

async function listingsFor(rows) {
  const ids = [...new Set(rows.map((r) => r.location_id))];
  const out = {};
  if (ids.length === 0) return out;
  const supabase = getSupabase();
  const [{ data: locs }, { data: photos }] = await Promise.all([
    supabase.from('locations').select('*').in('id', ids),
    supabase.from('location_photos').select('*').in('location_id', ids).order('sort_order', { ascending: true })
  ]);
  for (const l of locs || []) out[l.id] = toListing(l, (photos || []).filter((p) => p.location_id === l.id));
  return out;
}

/* ---------- expiry ---------- */

// Requests nobody answered in RESPOND_HOURS expire. Three in a row on
// one host pause that host's listings until they check in (the Your
// places page tells them why).
async function expireStale() {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const { data } = await supabase.from('location_requests').select('id, host_id, producer_id, location_id').in('status', ['requested', 'countered']).lt('responds_by', nowIso).limit(100);
  if (!data || data.length === 0) return;
  await supabase.from('location_requests').update({ status: 'expired', updated_at: nowIso }).in('id', data.map((r) => r.id));
  const hosts = [...new Set(data.map((r) => r.host_id))];
  for (const r of data) {
    await notifyCreator({ userId: r.producer_id, type: 'location_expired', message: 'The host didn’t answer your location request in time — it expired. Try another place or ask them in Messages.', href: `/locations/requests/${r.id}` });
  }
  for (const hostId of hosts) {
    const { data: last } = await supabase.from('location_requests').select('status').eq('host_id', hostId).in('status', ['expired', 'accepted', 'declined', 'countered', 'paid', 'done', 'cancelled', 'refunded']).order('created_at', { ascending: false }).limit(3);
    if (last && last.length === 3 && last.every((x) => x.status === 'expired')) {
      await supabase.from('locations').update({ status: 'paused', updated_at: nowIso }).eq('host_id', hostId).eq('status', 'listed');
      await notifyCreator({ userId: hostId, type: 'location_paused', message: 'Three requests went unanswered, so your places are paused. Resume them from Your places when you’re back.', href: '/locations/mine' });
    }
  }
}

/* ---------- reads ---------- */

async function loadRow(id) {
  const { data, error } = await getSupabase().from('location_requests').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingLocationsTable(error)) fail('Locations aren’t set up yet — the admin needs to run migration 086.', 503);
    throw new Error(error.message);
  }
  if (!data) fail('That request isn’t here.', 404);
  return data;
}

export async function getRequest(id, { viewerId = null, isAdmin = false } = {}) {
  try { await expireStale(); } catch (err) { /* read anyway */ }
  const row = await loadRow(id);
  if (!isAdmin && viewerId !== row.producer_id && viewerId !== row.host_id) fail('That request isn’t yours.', 403);
  const [people, listings, endorsements] = await Promise.all([
    peopleFor([row]),
    listingsFor([row]),
    getSupabase().from('location_endorsements').select('from_user_id, to_user_id, line, would_again').eq('request_id', id)
  ]);
  const req = toRequest(row, { listing: listings[row.location_id] || null, producer: people[row.producer_id], host: people[row.host_id], viewerId, isAdmin });
  req.endorsements = (endorsements.data || []).map((e) => ({ fromUserId: e.from_user_id, toUserId: e.to_user_id, line: e.line, wouldAgain: e.would_again }));
  req.viewerEndorsed = Boolean(viewerId) && req.endorsements.some((e) => e.fromUserId === viewerId);
  const listing = listings[row.location_id];
  req.refundPreview = row.status === 'paid' ? refundFor(row, viewerId === row.host_id ? 'host' : 'producer', listing ? listing.cancellation : 'moderate') : null;
  return req;
}

// { asHost: [...], asProducer: [...] } for one person, newest first.
export async function listMyRequests(userId) {
  if (!userId) return { asHost: [], asProducer: [] };
  try { await expireStale(); } catch (err) { /* list anyway */ }
  const { data, error } = await getSupabase().from('location_requests').select('*').or(`host_id.eq.${userId},producer_id.eq.${userId}`).order('created_at', { ascending: false }).limit(200);
  if (error) {
    if (isMissingLocationsTable(error)) return { asHost: [], asProducer: [] };
    throw new Error(error.message);
  }
  const rows = data || [];
  const [people, listings, endorsements] = await Promise.all([
    peopleFor(rows),
    listingsFor(rows),
    rows.length ? getSupabase().from('location_endorsements').select('request_id, from_user_id, to_user_id, line, would_again').in('request_id', rows.map((r) => r.id)) : Promise.resolve({ data: [] })
  ]);
  // The same extras getRequest adds, so a request card in a list (Your
  // places, Your requests) can show the endorsement form only once and
  // the refund a cancel would give.
  const all = rows.map((r) => {
    const req = toRequest(r, { listing: listings[r.location_id] || null, producer: people[r.producer_id], host: people[r.host_id], viewerId: userId });
    req.endorsements = (endorsements.data || []).filter((e) => e.request_id === r.id).map((e) => ({ fromUserId: e.from_user_id, toUserId: e.to_user_id, line: e.line, wouldAgain: e.would_again }));
    req.viewerEndorsed = req.endorsements.some((e) => e.fromUserId === userId);
    const listing = listings[r.location_id];
    req.refundPreview = r.status === 'paid' ? refundFor(r, userId === r.host_id ? 'host' : 'producer', listing ? listing.cancellation : 'moderate') : null;
    return req;
  });
  return { asHost: all.filter((r) => r.hostId === userId), asProducer: all.filter((r) => r.producerId === userId) };
}

/* ---------- create ---------- */

async function projectInfo(project) {
  if (!project || typeof project !== 'object') return null;
  const type = project.type === 'pitch' || project.type === 'series' ? project.type : null;
  const id = str(project.id, 80);
  if (!type || !id) return null;
  if (type === 'pitch') {
    const p = await getPitchById(id);
    if (!p) fail('That Pitch Room project doesn’t exist.');
    return { type, id, title: p.title };
  }
  const { data } = await getSupabase().from('series').select('id, name').eq('id', id).maybeSingle();
  if (!data) fail('That series doesn’t exist.');
  return { type, id, title: data.name };
}

function hoursBetween(from, to, fallback) {
  if (!from || !to) return fallback;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let h = (th + tm / 60) - (fh + fm / 60);
  if (h <= 0) h += 24;
  return Math.max(1, Math.round(h));
}

function priced(subtotalCents, listing, cut) {
  const s = splitBooking({ subtotalCents, cleaningCents: listing.cleaningCents || 0, cutPercent: cut });
  return {
    subtotal_cents: s.subtotalCents,
    cleaning_cents: s.cleaningCents,
    platform_cut_cents: s.platformCutCents,
    host_payout_cents: s.hostPayoutCents,
    fee_cover_cents: s.feeCoverCents,
    total_charged_cents: s.totalChargedCents,
    cut_percent: s.cutPercent
  };
}

export async function createRequest(userId, locationId, input) {
  if (!userId) fail('Sign in to request dates.', 401);
  const src = input && typeof input === 'object' ? input : {};
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('locations').select('*').eq('id', locationId).maybeSingle();
  if (error) {
    if (isMissingLocationsTable(error)) fail('Locations aren’t set up yet — the admin needs to run migration 086.', 503);
    throw new Error(error.message);
  }
  if (!row || row.status !== 'listed' || row.moderation_hold) fail('That place isn’t taking requests.', 404);
  if (row.host_id === userId) fail('That’s your own place.');
  const listing = toListing(row);

  const startsOn = String(src.startsOn || '').slice(0, 10);
  const endsOn = src.endsOn ? String(src.endsOn).slice(0, 10) : startsOn;
  if (!isDate(startsOn) || !isDate(endsOn)) fail('Pick the dates.');
  if (startsOn < today()) fail('The first day has already passed.');
  if (endsOn < startsOn) fail('The last day is before the first day.');
  const days = dayCount(startsOn, endsOn);
  if (days > MAX_DAYS) fail(`Up to ${MAX_DAYS} days per request.`);
  const hoursFrom = str(src.hoursFrom, 5);
  const hoursTo = str(src.hoursTo, 5);
  if ((hoursFrom && !isTime(hoursFrom)) || (hoursTo && !isTime(hoursTo))) fail('Hours need a time like 08:00.');
  const hoursPerDay = hoursBetween(hoursFrom, hoursTo, listing.dayHours);
  const crewSize = src.crewSize === '' || src.crewSize == null ? null : Math.min(MAX_CREW, Math.max(1, Math.round(Number(src.crewSize)) || 1));
  if (crewSize && listing.crewMax && crewSize > listing.crewMax) fail(`This place takes crews up to ${listing.crewMax}.`);
  const vehicles = src.vehicles === '' || src.vehicles == null ? null : Math.min(50, Math.max(0, Math.round(Number(src.vehicles)) || 0));
  const shooting = str(src.shooting, 200);
  if (shooting.length < 3) fail('Say what you’re shooting.');
  const message = text(src.message, 2000);
  const project = await projectInfo(src.project);

  // Dates must be free: no paid booking, no blocked day.
  const [booked, blocked] = await Promise.all([
    supabase.from('location_requests').select('id').eq('location_id', locationId).in('status', ['paid', 'done']).lte('starts_on', endsOn).gte('ends_on', startsOn),
    supabase.from('location_blocked_dates').select('day').eq('location_id', locationId).gte('day', startsOn).lte('day', endsOn)
  ]);
  if ((booked.data || []).length) fail('Those dates are already booked — pick others.');
  if ((blocked.data || []).length) fail('The host has blocked a day in that range — pick others.');

  const blocks = await getBlocksBetween(userId, row.host_id);
  if (blocks.iBlocked || blocks.blockedMe) fail('You can’t request this place.', 403);

  const hasRates = Boolean(listing.hourlyCents || listing.dayCents);
  let pricing = src.pricing === 'offer' ? 'offer' : 'posted';
  if (!hasRates) pricing = 'offer';
  if (pricing === 'offer' && !listing.dealsOk) fail('This host takes posted rates only.');
  let subtotal;
  if (pricing === 'posted') {
    const q = quoteFor(listing, { startsOn, endsOn, hoursPerDay });
    if (!q) fail('This place has no posted rate — make an offer.');
    subtotal = q.subtotalCents;
  } else {
    subtotal = Math.round(Number(src.offer) * 100);
    if (!Number.isFinite(subtotal) || subtotal < MIN_BOOKING_CENTS) fail(`Offer at least ${dollars(MIN_BOOKING_CENTS)}.`);
  }
  if (subtotal + (listing.cleaningCents || 0) > MAX_BOOKING_CENTS) fail(`Up to ${dollars(MAX_BOOKING_CENTS)} per request.`);
  if (!(await checkRateLimit(`location-request:${userId}`, REQUESTS_PER_DAY, 86400))) fail('That’s a lot of requests for one day.', 429);

  const cut = await cutPercent();
  const money = priced(subtotal, listing, cut);
  const when = fmtRange(startsOn, endsOn);
  const summary = `${pricing === 'offer' ? `Offer: ${dollars(subtotal)} for ` : 'Request: '}${when}${hoursFrom && hoursTo ? `, ${hoursFrom}–${hoursTo}` : ''}${crewSize ? ` · crew ${crewSize}` : ''}${project ? ` · ${project.title}` : ''} — ${shooting}${message ? `\n\n${message}` : ''}`;
  const sent = await sendMessage(userId, { toUserId: row.host_id, body: summary, context: { kind: 'location', label: row.title, id: row.id } });
  const respondsBy = new Date(Date.now() + RESPOND_HOURS * 3600000).toISOString();
  const { data: created, error: insError } = await supabase.from('location_requests').insert({
    location_id: locationId, producer_id: userId, host_id: row.host_id,
    starts_on: startsOn, ends_on: endsOn, hours_from: hoursFrom || null, hours_to: hoursTo || null, hours_per_day: hoursPerDay,
    crew_size: crewSize, vehicles,
    project_type: project ? project.type : null, project_id: project ? project.id : null, project_title: project ? project.title : null,
    shooting, message: message || null, pricing, ...money,
    status: 'requested', responds_by: respondsBy, thread_id: sent.threadId
  }).select('*').single();
  if (insError) throw new Error(insError.message);

  const profiles = await getPublicProfilesByIds([userId]);
  const who = profiles[userId].displayName;
  await notifyCreator({ userId: row.host_id, type: 'location_request', message: `${who} wants ${row.title} ${when}${pricing === 'offer' ? ` and offers ${dollars(subtotal)}` : ''}. You have ${RESPOND_HOURS} hours to answer.`, href: `/locations/requests/${created.id}` });
  const to = await getUserEmail(row.host_id);
  if (to) {
    await sendEmail({
      to,
      subject: `Request for ${row.title}: ${when}`,
      html: `<p><b>${esc(who)}</b> wants to shoot at <b>${esc(row.title)}</b> ${esc(when)}${crewSize ? ` with a crew of ${crewSize}` : ''}.</p><p>${esc(shooting)}</p><p>${pricing === 'offer' ? `Their offer: <b>${dollars(subtotal)}</b>` : `At your posted rate: <b>${dollars(subtotal)}</b>`}${listing.cleaningCents ? ` + ${dollars(listing.cleaningCents)} cleaning` : ''}. You’d receive <b>${dollars(money.host_payout_cents)}</b> after ${SITE.name}’s ${cut}% cut.</p><p><a href="${SITE.productionDomain}/locations/requests/${created.id}">Accept, counter or decline</a> — you have ${RESPOND_HOURS} hours.</p>`
    });
  }
  return getRequest(created.id, { viewerId: userId });
}

/* ---------- host answers ---------- */

// The dates must still be free when a host accepts, a producer takes a
// counter or pays, and when the payment lands: another request for the
// same place can be paid in the meantime, and a host can block days.
// Returns why they aren't, or null.
async function datesTaken(row) {
  const supabase = getSupabase();
  const [booked, blocked] = await Promise.all([
    supabase.from('location_requests').select('id').eq('location_id', row.location_id).neq('id', row.id).in('status', ['paid', 'done']).lte('starts_on', row.ends_on).gte('ends_on', row.starts_on).limit(1),
    supabase.from('location_blocked_dates').select('day').eq('location_id', row.location_id).gte('day', row.starts_on).lte('day', row.ends_on).limit(1)
  ]);
  if ((booked.data || []).length) return 'Those dates were booked by someone else in the meantime.';
  if ((blocked.data || []).length) return 'The host has blocked a day in that range.';
  return null;
}

// The place itself must still be bookable (not paused, removed or held).
async function placeUnavailable(locationId) {
  const { data: loc } = await getSupabase().from('locations').select('status, moderation_hold').eq('id', locationId).maybeSingle();
  if (!loc || loc.status !== 'listed' || loc.moderation_hold) return 'This place isn’t taking bookings right now.';
  return null;
}

// Closes a Checkout that's still open, so it can't be paid later. Best
// effort: an already-completed or expired session just stays as it is.
async function expireCheckout(sessionId) {
  if (!sessionId) return;
  try {
    const stripe = getStripe();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (s && s.status === 'open') await stripe.checkout.sessions.expire(sessionId);
  } catch (err) {
    console.error('expireCheckout error:', err.message);
  }
}

// Once a booking is paid, every other open request for overlapping dates
// at the same place can't happen: decline them and close their Checkouts.
async function closeOverlapping(row) {
  const supabase = getSupabase();
  const { data: others } = await supabase.from('location_requests').select('id, producer_id, stripe_checkout_session_id')
    .eq('location_id', row.location_id).neq('id', row.id).in('status', ['requested', 'countered', 'accepted'])
    .lte('starts_on', row.ends_on).gte('ends_on', row.starts_on);
  if (!others || others.length === 0) return;
  const nowIso = new Date().toISOString();
  await supabase.from('location_requests').update({ status: 'declined', declined_at: nowIso, decline_reason: 'Those dates were booked by someone else.', updated_at: nowIso })
    .in('id', others.map((o) => o.id)).in('status', ['requested', 'countered', 'accepted']);
  for (const o of others) {
    await expireCheckout(o.stripe_checkout_session_id);
    await notifyCreator({ userId: o.producer_id, type: 'location_declined', message: 'Those dates were just booked by someone else, so your request was closed. Try other dates.', href: `/locations/requests/${o.id}` });
  }
}

async function notifyBoth(row, { producer, host }) {
  if (producer) await notifyCreator({ userId: row.producer_id, type: producer.type, message: producer.message, href: `/locations/requests/${row.id}` });
  if (host) await notifyCreator({ userId: row.host_id, type: host.type, message: host.message, href: `/locations/requests/${row.id}` });
}

async function emailTo(userId, subject, html) {
  const to = await getUserEmail(userId);
  if (to) await sendEmail({ to, subject, html });
}

// Host: accept (as is, or the producer's offer), counter, decline.
export async function answerRequest(userId, id, { action, counter, note, reason }) {
  const row = await loadRow(id);
  if (row.host_id !== userId) fail('Only the host can answer this.', 403);
  if (!['requested', 'countered'].includes(row.status)) fail(`This request is ${REQUEST_STATUS[row.status].toLowerCase()}.`);
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const [{ data: loc }, people] = await Promise.all([supabase.from('locations').select('*').eq('id', row.location_id).maybeSingle(), getPublicProfilesByIds([row.host_id, row.producer_id])]);
  const listing = toListing(loc);
  const hostName = people[row.host_id].displayName;
  const when = fmtRange(row.starts_on, row.ends_on);
  const link = `${SITE.productionDomain}/locations/requests/${row.id}`;

  if (action === 'accept') {
    if (row.status !== 'requested') fail('You’ve countered — it’s the producer’s turn to accept or let it go.');
    const account = await getPayoutAccount(userId);
    if (!isPayoutReady(account)) fail('Set up payouts first (Your places → Payouts) so the booking can be paid to you.', 409);
    const taken = await datesTaken(row);
    if (taken) fail(`${taken} Decline this one, or counter with other dates in Messages.`, 409);
    // Only from 'requested': a second click (or a decline racing it)
    // finds nothing to update instead of accepting twice.
    const { data: updated, error } = await supabase.from('location_requests').update({ status: 'accepted', accepted_at: nowIso, updated_at: nowIso }).eq('id', id).eq('status', 'requested').select('id');
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) fail('This request just changed — reload to see where it stands.', 409);
    await notifyBoth(row, { producer: { type: 'location_accepted', message: `${hostName} accepted your request for ${listing.title} ${when}. Pay ${dollars(row.total_charged_cents)} to confirm the dates.` } });
    await emailTo(row.producer_id, `Accepted: ${listing.title}, ${when}`, `<p><b>${esc(hostName)}</b> accepted your request for <b>${esc(listing.title)}</b> ${esc(when)}.</p><p>Pay <b>${dollars(row.total_charged_cents)}</b> to confirm — the address and access notes unlock then.</p><p><a href="${link}">Pay to confirm</a></p>`);
  } else if (action === 'counter') {
    if (row.status !== 'requested') fail('You already countered.');
    const cents = Math.round(Number(counter) * 100);
    if (!Number.isFinite(cents) || cents < MIN_BOOKING_CENTS) fail(`Counter with at least ${dollars(MIN_BOOKING_CENTS)}.`);
    if (cents + row.cleaning_cents > MAX_BOOKING_CENTS) fail(`Up to ${dollars(MAX_BOOKING_CENTS)} per booking.`);
    const { error } = await supabase.from('location_requests').update({ status: 'countered', counter_cents: cents, counter_note: str(note, 300) || null, responds_by: new Date(Date.now() + RESPOND_HOURS * 3600000).toISOString(), updated_at: nowIso }).eq('id', id);
    if (error) throw new Error(error.message);
    await notifyBoth(row, { producer: { type: 'location_countered', message: `${hostName} countered: ${dollars(cents)} for ${listing.title} ${when}. Accept it or let it go.` } });
    await emailTo(row.producer_id, `Counter-offer: ${listing.title}, ${when}`, `<p><b>${esc(hostName)}</b> countered your request for <b>${esc(listing.title)}</b> ${esc(when)} with <b>${dollars(cents)}</b>${row.cleaning_cents ? ` + ${dollars(row.cleaning_cents)} cleaning` : ''}.${note ? `</p><p>“${esc(str(note, 300))}”` : ''}</p><p><a href="${link}">See the counter</a> — it stands for ${RESPOND_HOURS} hours.</p>`);
  } else if (action === 'decline') {
    const { error } = await supabase.from('location_requests').update({ status: 'declined', declined_at: nowIso, decline_reason: str(reason, 300) || null, updated_at: nowIso }).eq('id', id);
    if (error) throw new Error(error.message);
    await notifyBoth(row, { producer: { type: 'location_declined', message: `${hostName} can’t do ${listing.title} ${when}.${reason ? ` “${str(reason, 120)}”` : ''}` } });
  } else {
    fail('action must be accept, counter or decline.');
  }
  return getRequest(id, { viewerId: userId });
}

// Producer: take the host's counter (re-prices the booking) or cancel.
export async function acceptCounter(userId, id) {
  const row = await loadRow(id);
  if (row.producer_id !== userId) fail('Not your request.', 403);
  if (row.status !== 'countered' || !row.counter_cents) fail('There’s no counter to accept.');
  const account = await getPayoutAccount(row.host_id);
  if (!isPayoutReady(account)) fail('The host hasn’t finished setting up payouts yet — message them.', 409);
  const taken = await datesTaken(row);
  if (taken) fail(taken, 409);
  const { data: loc } = await getSupabase().from('locations').select('*').eq('id', row.location_id).maybeSingle();
  const listing = toListing(loc);
  const money = priced(row.counter_cents, { cleaningCents: row.cleaning_cents }, Number(row.cut_percent));
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await getSupabase().from('location_requests').update({ ...money, pricing: 'offer', status: 'accepted', accepted_at: nowIso, updated_at: nowIso }).eq('id', id).eq('status', 'countered').select('id');
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) fail('This request just changed — reload to see where it stands.', 409);
  const people = await getPublicProfilesByIds([userId]);
  await notifyBoth(row, { host: { type: 'location_accepted', message: `${people[userId].displayName} took your counter for ${listing.title} ${fmtRange(row.starts_on, row.ends_on)}. It’s confirmed once they pay.` } });
  return getRequest(id, { viewerId: userId });
}

/* ---------- paying ---------- */

// Stripe Checkout for an accepted request. Destination charge to the
// host's Connect account; the platform keeps the cut + fee cover.
export async function createBookingCheckout(userId, id, { origin }) {
  const row = await loadRow(id);
  if (row.producer_id !== userId) fail('Not your request.', 403);
  if (row.status !== 'accepted') fail(row.status === 'paid' ? 'Already paid.' : 'The host hasn’t accepted yet.');
  if (row.starts_on < today()) fail('The first day has passed — ask the host for new dates.');
  const account = await getPayoutAccount(row.host_id);
  if (!isPayoutReady(account)) fail('The host hasn’t finished setting up payouts yet.', 409);
  const blocked = (await placeUnavailable(row.location_id)) || (await datesTaken(row));
  if (blocked) fail(blocked, 409);
  const supabase = getSupabase();
  const stripe = getStripe();
  // One Checkout per request: clicking Pay again (or on another device)
  // reopens the same one instead of starting a second charge.
  if (row.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
      if (existing && existing.status === 'open' && existing.url) return { url: existing.url };
    } catch (err) {
      // Gone or unreadable: start a fresh one below.
    }
  }
  const { data: loc } = await supabase.from('locations').select('title').eq('id', row.location_id).maybeSingle();
  const metadata = { type: 'location_booking', request_id: row.id, location_id: row.location_id, producer_user_id: userId };
  const when = fmtRange(row.starts_on, row.ends_on);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    submit_type: 'book',
    customer_email: (await getUserEmail(userId)) || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: row.total_charged_cents,
        product_data: {
          name: `${loc ? loc.title : 'Location'} · ${when}`,
          description: `${dollars(row.subtotal_cents)} for the place${row.cleaning_cents ? ` + ${dollars(row.cleaning_cents)} cleaning` : ''} + ${dollars(row.fee_cover_cents)} card processing`
        }
      }
    }],
    payment_intent_data: {
      application_fee_amount: row.platform_cut_cents + row.fee_cover_cents,
      transfer_data: { destination: account.stripeAccountId },
      description: `Location booking on ${SITE.name}: ${loc ? loc.title : ''} ${when}`,
      metadata
    },
    metadata,
    success_url: `${origin}/locations/requests/${row.id}?paid=1`,
    cancel_url: `${origin}/locations/requests/${row.id}?paid=cancelled`
  });
  await supabase.from('location_requests').update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq('id', id);
  return { url: session.url };
}

// A payment that arrived for a request that can't become a booking any
// more (cancelled, declined, expired, already paid through another
// Checkout, or the dates went to someone else): give it all back,
// including the card fee and the platform's share, and tell the producer.
async function refundStrayPayment(session, row, why) {
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null;
  if (pi) {
    await getStripe().refunds.create(
      { payment_intent: pi, reverse_transfer: true, refund_application_fee: true, metadata: { type: 'location_booking', request_id: row.id, reason: why } },
      { idempotencyKey: `location-stray-${session.id}` }
    );
  }
  const amount = Number.isFinite(session.amount_total) ? dollars(session.amount_total) : 'Your payment';
  await notifyCreator({ userId: row.producer_id, type: 'location_refunded', message: `${amount} was refunded in full: ${why}`, href: `/locations/requests/${row.id}` });
  console.warn(`location booking ${row.id}: refunded stray payment ${pi} (${why})`);
  return { refunded: true, id: row.id };
}

// Webhook: the Checkout was paid. Idempotent.
export async function completeBookingFromSession(session) {
  const supabase = getSupabase();
  const meta = session.metadata || {};
  const { data: row } = await supabase.from('location_requests').select('*').eq('id', meta.request_id || '00000000-0000-0000-0000-000000000000').maybeSingle();
  if (!row) throw new Error('Paid location session has no request.');
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null;
  if (['paid', 'done', 'refunded'].includes(row.status)) {
    // The same payment delivered twice: nothing to do. A different
    // payment for a request that's already paid is a second charge.
    if (row.stripe_payment_intent_id && row.stripe_payment_intent_id === pi) return { duplicate: true, id: row.id };
    return refundStrayPayment(session, row, 'this booking was already paid.');
  }
  if (row.status !== 'accepted') return refundStrayPayment(session, row, `the request was ${(REQUEST_STATUS[row.status] || row.status).toLowerCase()} before the payment went through.`);
  const taken = await datesTaken(row);
  if (taken) return refundStrayPayment(session, row, taken.toLowerCase());
  const nowIso = new Date().toISOString();
  // Only from 'accepted': a cancel landing at the same moment wins, and
  // this payment is refunded rather than booking a cancelled request.
  const { data: updated, error } = await supabase.from('location_requests').update({
    status: 'paid', paid_at: nowIso, updated_at: nowIso,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: pi,
    total_charged_cents: Number.isFinite(session.amount_total) ? session.amount_total : row.total_charged_cents
  }).eq('id', row.id).eq('status', 'accepted').select('id');
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) return refundStrayPayment(session, row, 'the request changed before the payment went through.');
  await closeOverlapping(row);
  const [{ data: loc }, people] = await Promise.all([supabase.from('locations').select('title').eq('id', row.location_id).maybeSingle(), getPublicProfilesByIds([row.producer_id, row.host_id])]);
  const when = fmtRange(row.starts_on, row.ends_on);
  const title = loc ? loc.title : 'your place';
  await notifyBoth(row, {
    host: { type: 'location_paid', message: `${people[row.producer_id].displayName} paid for ${title} ${when}. ${dollars(row.host_payout_cents)} is on its way to your Stripe balance.` },
    producer: { type: 'location_paid', message: `${title} is booked ${when}. The address and access notes are on the request.` }
  });
  await emailTo(row.host_id, `Booked: ${title}, ${when}`, `<p><b>${esc(people[row.producer_id].displayName)}</b> paid for <b>${esc(title)}</b> ${esc(when)}. Your share, <b>${dollars(row.host_payout_cents)}</b>, goes to your Stripe balance.</p><p><a href="${SITE.productionDomain}/locations/requests/${row.id}">Open the booking</a></p>`);
  await emailTo(row.producer_id, `Confirmed: ${title}, ${when}`, `<p><b>${esc(title)}</b> is yours ${esc(when)}. The street address and access notes are on the request page.</p><p><a href="${SITE.productionDomain}/locations/requests/${row.id}">Open the booking</a></p>`);
  return { id: row.id };
}

/* ---------- cancelling + refunds ---------- */

// What a cancellation refunds: the producer gets the policy's share of
// the place + cleaning (the card fee is never refunded — Stripe keeps
// it); a host cancelling refunds everything including the card fee.
export function refundFor(row, by, policy = 'moderate') {
  const booking = row.subtotal_cents + row.cleaning_cents;
  if (by === 'host') return { percent: 100, cents: row.total_charged_cents, daysBefore: null };
  const daysBefore = Math.floor((Date.parse(`${row.starts_on}T12:00:00Z`) - Date.now()) / 86400000);
  const percent = refundPercentFor(policy || 'moderate', daysBefore);
  return { percent, cents: Math.floor((booking * percent) / 100), daysBefore };
}

async function stripeRefund(row, cents, reason) {
  if (!row.stripe_payment_intent_id || cents <= 0) return null;
  const stripe = getStripe();
  return stripe.refunds.create(
    { payment_intent: row.stripe_payment_intent_id, amount: cents, reverse_transfer: true, refund_application_fee: true, metadata: { type: 'location_booking', request_id: row.id, reason } },
    { idempotencyKey: `location-refund-${row.id}-${cents}` }
  );
}

export async function cancelRequest(userId, id, { reason } = {}, { isAdmin = false } = {}) {
  const row = await loadRow(id);
  const by = row.host_id === userId ? 'host' : row.producer_id === userId ? 'producer' : isAdmin ? 'admin' : null;
  if (!by) fail('Not your request.', 403);
  if (!['requested', 'countered', 'accepted', 'paid'].includes(row.status)) fail(`This request is ${REQUEST_STATUS[row.status].toLowerCase()}.`);
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const patch = { status: 'cancelled', cancelled_at: nowIso, cancelled_by: by === 'admin' ? 'admin' : userId, updated_at: nowIso };
  let refund = null;
  if (row.status === 'paid') {
    const { data: loc } = await supabase.from('locations').select('cancellation').eq('id', row.location_id).maybeSingle();
    const r = refundFor(row, by === 'producer' ? 'producer' : 'host', loc ? loc.cancellation : 'moderate');
    refund = r;
    if (r.cents > 0) {
      await stripeRefund(row, r.cents, `cancelled by ${by}`);
      patch.status = 'refunded';
      patch.refunded_at = nowIso;
      patch.refund_cents = r.cents;
      patch.refund_reason = `Cancelled by the ${by}${by === 'producer' ? ` (${r.percent}% under the cancellation policy)` : ''}`;
      patch.refunded_by = userId;
    } else {
      patch.refund_cents = 0;
      patch.refund_reason = `Cancelled by the ${by} inside the no-refund window`;
    }
  }
  const { error } = await supabase.from('location_requests').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  // An accepted request may have a Checkout open in the producer's tab:
  // close it so it can't be paid after the cancel.
  if (row.status === 'accepted') await expireCheckout(row.stripe_checkout_session_id);
  const [{ data: loc }, people] = await Promise.all([supabase.from('locations').select('title').eq('id', row.location_id).maybeSingle(), getPublicProfilesByIds([userId])]);
  const title = loc ? loc.title : 'the place';
  const when = fmtRange(row.starts_on, row.ends_on);
  const who = by === 'admin' ? 'An admin' : people[userId].displayName;
  const refundLine = refund ? (refund.cents > 0 ? ` ${dollars(refund.cents)} goes back to the card.` : ' No refund under the cancellation policy.') : '';
  await notifyBoth(row, {
    producer: by !== 'producer' ? { type: 'location_cancelled', message: `${who} cancelled ${title} ${when}.${refundLine}` } : null,
    host: by !== 'host' ? { type: 'location_cancelled', message: `${who} cancelled ${title} ${when}.${row.status === 'paid' ? ' The payout is reversed.' : ''}` } : null
  });
  return getRequest(id, { viewerId: userId, isAdmin });
}

// Admin: full refund of a paid booking, final (like Pitch Room).
export async function refundBooking(rc, id, reason) {
  const row = await loadRow(id);
  if (!['paid', 'done'].includes(row.status)) fail(`Only a paid booking can be refunded (this one is ${row.status}).`);
  if (!row.stripe_payment_intent_id) fail('This booking has no Stripe payment attached.');
  const refund = await stripeRefund(row, row.total_charged_cents, str(reason, 300) || 'admin refund');
  const nowIso = new Date().toISOString();
  const { error } = await getSupabase().from('location_requests').update({ status: 'refunded', refunded_at: nowIso, refund_cents: row.total_charged_cents, refund_reason: str(reason, 300) || null, refunded_by: rc.email || rc.userId, updated_at: nowIso }).eq('id', id);
  if (error) throw new Error(`Stripe refunded it (${refund && refund.id}) but the record didn’t update: ${error.message}`);
  await notifyBoth(row, {
    producer: { type: 'location_refunded', message: `Your booking was refunded in full: ${dollars(row.total_charged_cents)} goes back to the card.` },
    host: { type: 'location_refunded', message: 'A booking was refunded by an admin; the payout is reversed.' }
  });
  return getRequest(id, { isAdmin: true });
}

// Webhook charge.refunded for a refund made in the Stripe dashboard.
export async function refundBookingFromCharge(charge) {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent && charge.payment_intent.id) || null;
  if (!pi || !charge.refunded) return { ignored: true };
  const supabase = getSupabase();
  const { data: row } = await supabase.from('location_requests').select('id, status, total_charged_cents').eq('stripe_payment_intent_id', pi).maybeSingle();
  if (!row) return { ignored: true };
  if (row.status === 'refunded') return { duplicate: true, id: row.id };
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('location_requests').update({ status: 'refunded', refunded_at: nowIso, refund_cents: row.total_charged_cents, refund_reason: 'refunded in Stripe', refunded_by: 'stripe', updated_at: nowIso }).eq('id', row.id);
  if (error) throw new Error(error.message);
  return { id: row.id };
}

/* ---------- after the shoot ---------- */

// Host (or an admin when the host goes quiet): how did it go? as_agreed
// is the confirmed shoot — it counts on the host's record and adds the
// production's "Shot here" credit.
export async function setOutcome(actorId, id, { outcome, note }, { isAdmin = false } = {}) {
  const row = await loadRow(id);
  if (row.host_id !== actorId && !isAdmin) fail('Only the host can say how it went.', 403);
  if (row.status !== 'paid' && row.status !== 'done') fail('Only a paid booking has an outcome.');
  if (row.outcome) fail('Already answered.');
  if (!['as_agreed', 'damage', 'no_show', 'cancelled'].includes(outcome)) fail('outcome must be as_agreed, damage, no_show or cancelled.');
  if (!isAdmin && row.ends_on >= today()) fail('You can answer this after the last day.');
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('location_requests').update({ status: 'done', outcome, outcome_note: text(note, 1000) || null, outcome_at: nowIso, outcome_by: actorId, updated_at: nowIso }).eq('id', id);
  if (error) throw new Error(error.message);
  const { data: loc } = await supabase.from('locations').select('title, shoots_count').eq('id', row.location_id).maybeSingle();
  if (outcome === 'as_agreed') {
    await supabase.from('locations').update({ shoots_count: ((loc && loc.shoots_count) || 0) + 1 }).eq('id', row.location_id);
    await notifyBoth(row, { producer: { type: 'location_done', message: `The host confirmed your shoot at ${loc ? loc.title : 'the place'} went as agreed — it’s a credit on the listing. Leave them a line?` } });
  } else {
    // Damage and no-shows go to an admin (step 6's page lists them).
    await notifyBoth(row, { producer: { type: 'location_issue', message: `The host reported a problem with your shoot at ${loc ? loc.title : 'the place'} (${outcome.replace('_', ' ')}). An admin will look at it.` } });
  }
  return getRequest(id, { viewerId: actorId, isAdmin });
}

// One line each way after a shoot that went as agreed.
export async function endorse(userId, id, { line, wouldAgain = true }) {
  const row = await loadRow(id);
  if (row.outcome !== 'as_agreed') fail('Only a shoot that went as agreed can be endorsed.');
  let to = null;
  if (userId === row.host_id) to = row.producer_id;
  else if (userId === row.producer_id) to = row.host_id;
  else fail('Not your booking.', 403);
  const clean = str(line, MAX_ENDORSEMENT_CHARS);
  if (!clean) fail('Write a line.');
  const { data: existing } = await getSupabase().from('location_endorsements').select('id').eq('request_id', id).eq('from_user_id', userId).maybeSingle();
  if (existing) fail('You already left a line for this booking.', 409);
  const ins = await getSupabase().from('location_endorsements').insert({ request_id: id, from_user_id: userId, to_user_id: to, line: clean, would_again: wouldAgain !== false });
  if (ins.error) {
    if (ins.error.code === '23505') fail('You already left a line for this booking.', 409);
    throw new Error(ins.error.message);
  }
  const profiles = await getPublicProfilesByIds([userId]);
  await notifyCreator({ userId: to, type: 'endorsement', message: `${profiles[userId].displayName} left you a line: “${clean}”`, href: profilePath(profiles[userId]) });
  return getRequest(id, { viewerId: userId });
}

/* ---------- admin ---------- */

// Paid bookings past their last day with no outcome, and reported
// problems — what /admin/locations (step 6) shows.
export async function listRequestsForAdmin() {
  try { await expireStale(); } catch (err) { /* list anyway */ }
  const { data, error } = await getSupabase().from('location_requests').select('*').in('status', ['paid', 'done', 'refunded']).order('created_at', { ascending: false }).limit(200);
  if (error) {
    if (isMissingLocationsTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  const [people, listings] = await Promise.all([peopleFor(rows), listingsFor(rows)]);
  return rows.map((r) => toRequest(r, { listing: listings[r.location_id] || null, producer: people[r.producer_id], host: people[r.host_id], isAdmin: true }));
}
