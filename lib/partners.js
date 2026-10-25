import { getSupabase } from './supabase';
import { milesBetween, coarsePoint } from './crewOptions';
import { getOwnCard } from './crewCards';
import { getTrackRecords } from './crewCalls';
import { uploadArtworkImage } from './artworkUpload';
import { checkRateLimit } from './rateLimit';
import { PARTNER_KINDS, CODE_GATES, GATE_RANK, MAX_BLURB_CHARS, MAX_DEAL_CHARS, MAX_NOTE_CHARS } from './partnerRules';

// Partners & resources (migration 108). See the migration's header.

export class PartnerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new PartnerError(message, status); };
const str = (v, max) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const text = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

export function isMissingPartnersTable(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation "?partner/i.test(error.message || '');
}

function cleanUrl(v) {
  const s = String(v || '').trim().slice(0, 500);
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch (err) {
    return null;
  }
}

/* ---------- shapes ---------- */

function toPartner(row, { near = null, admin = false } = {}) {
  const miles = near && row.lat != null ? Math.round(milesBetween(near.lat, near.lng, row.lat, row.lng)) : null;
  const out = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    kindLabel: PARTNER_KINDS[row.kind] || row.kind,
    blurb: row.blurb || '',
    url: row.url || null,
    logoUrl: row.logo_url || null,
    place: row.place_label ? { label: row.place_label, city: row.city || '', region: row.region || '', country: row.country || '' } : null,
    miles,
    ships: Boolean(row.ships),
    deal: row.deal || '',
    hasCode: Boolean(row.code),
    codeGate: CODE_GATES[row.code_gate] ? row.code_gate : 'account',
    gateLabel: (CODE_GATES[row.code_gate] || CODE_GATES.account).label,
    gateHint: (CODE_GATES[row.code_gate] || CODE_GATES.account).hint,
    codeNote: row.code_note || '',
    featured: Boolean(row.featured),
    status: row.status,
    createdAt: row.created_at
  };
  if (admin) {
    out.code = row.code || '';
    out.contactName = row.contact_name || '';
    out.contactEmail = row.contact_email || '';
    out.sortOrder = row.sort_order || 0;
    out.lat = row.lat;
    out.lng = row.lng;
  }
  return out;
}

/* ---------- who can see a code ---------- */

// The viewer's standing on the gate ladder: 0 anyone … 4 Veteran.
export async function viewerGateRank(viewerId) {
  if (!viewerId) return 0;
  const supabase = getSupabase();
  const [card, prodOwn, prodCrew, records] = await Promise.all([
    getOwnCard(viewerId).catch(() => null),
    supabase.from('productions').select('id').eq('owner_id', viewerId).in('status', ['prep', 'shooting', 'post', 'released']).limit(1),
    supabase.from('production_members').select('id, productions!inner(status)').eq('user_id', viewerId).eq('hidden', false).in('productions.status', ['prep', 'shooting', 'post', 'released']).limit(1),
    getTrackRecords([viewerId]).catch(() => ({}))
  ]);
  const onProduction = Boolean((prodOwn.data || []).length || (prodCrew.data || []).length);
  const veteran = records[viewerId] && records[viewerId].tier === 'veteran';
  if (veteran) return 4;
  if (onProduction) return 3;
  if (card) return 2;
  return 1;
}

/* ---------- reads ---------- */

function nearPoint(f) {
  const lat = Number(f.lat);
  const lng = Number(f.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// filters: { q, kind, lat, lng, withinMiles (0 = anywhere), shipsOnly }
export async function listPartners(filters = {}, { viewerId = null } = {}) {
  const { data, error } = await getSupabase().from('partners').select('*').eq('status', 'listed').order('featured', { ascending: false }).order('sort_order', { ascending: true }).order('name', { ascending: true }).limit(500);
  if (error) {
    if (isMissingPartnersTable(error)) return { partners: [], total: 0, counts: {}, rank: 0 };
    throw new Error(error.message);
  }
  const near = nearPoint(filters);
  const within = Math.max(0, Number(filters.withinMiles) || 0);
  const needle = str(filters.q, 80).toLowerCase();
  const kind = PARTNER_KINDS[filters.kind] ? filters.kind : null;
  const rank = await viewerGateRank(viewerId);
  let list = (data || []).map((r) => toPartner(r, { near }));
  const counts = {};
  for (const p of list) counts[p.kind] = (counts[p.kind] || 0) + 1;
  list = list.filter((p) => {
    if (kind && p.kind !== kind) return false;
    if (filters.shipsOnly && !p.ships) return false;
    // Near: within the radius, or ships / works remotely.
    if (near && within > 0 && !p.ships && !(p.miles != null && p.miles <= within)) return false;
    if (needle) {
      const hay = [p.name, p.kindLabel, p.blurb, p.deal, p.place && p.place.label].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  if (near) list.sort((a, b) => (a.featured === b.featured ? 0 : a.featured ? -1 : 1) || ((a.miles == null ? 1e9 : a.miles) - (b.miles == null ? 1e9 : b.miles)));
  return { partners: list.map((p) => ({ ...p, canReveal: p.hasCode && GATE_RANK[p.codeGate] <= rank })), total: list.length, counts, rank };
}

// Reveal a code: checks the gate, logs the first reveal per person.
export async function revealCode(userId, partnerId, { productionId = null } = {}) {
  const { data: row, error } = await getSupabase().from('partners').select('*').eq('id', partnerId).maybeSingle();
  if (error) {
    if (isMissingPartnersTable(error)) fail('Resources aren’t set up yet — the admin needs to run migration 108.', 503);
    throw new Error(error.message);
  }
  if (!row || row.status !== 'listed') fail('That partner isn’t listed.', 404);
  if (!row.code) fail('This partner has no code — use the link and mention Studio Tapa.');
  const gate = CODE_GATES[row.code_gate] ? row.code_gate : 'account';
  if (gate !== 'public' && !userId) fail('Sign in to see the code.', 401);
  const rank = await viewerGateRank(userId);
  if (GATE_RANK[gate] > rank) fail(CODE_GATES[gate].hint, 403);
  if (userId) {
    if (!(await checkRateLimit(`partner-reveal:${userId}`, 60, 3600))) fail('That’s a lot of codes at once — give it a minute.', 429);
    const pid = productionId && /^[0-9a-f-]{36}$/i.test(String(productionId)) ? String(productionId) : null;
    await getSupabase().from('partner_redemptions').upsert({ partner_id: partnerId, user_id: userId, production_id: pid }, { onConflict: 'partner_id,user_id', ignoreDuplicates: true });
  }
  return { code: row.code, note: row.code_note || '', url: row.url || null, deal: row.deal || '' };
}

/* ---------- admin ---------- */

export async function listPartnersForAdmin() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('partners').select('*').order('featured', { ascending: false }).order('sort_order', { ascending: true }).order('name', { ascending: true });
  if (error) {
    if (isMissingPartnersTable(error)) return { partners: [], setup: false };
    throw new Error(error.message);
  }
  const rows = data || [];
  const counts = {};
  if (rows.length) {
    const { data: reds } = await supabase.from('partner_redemptions').select('partner_id').in('partner_id', rows.map((r) => r.id));
    for (const r of reds || []) counts[r.partner_id] = (counts[r.partner_id] || 0) + 1;
  }
  return { partners: rows.map((r) => ({ ...toPartner(r, { admin: true }), redemptions: counts[r.id] || 0 })), setup: true };
}

export function cleanPartnerInput(input) {
  const src = input && typeof input === 'object' ? input : {};
  const name = str(src.name, 80);
  if (name.length < 2) fail('Give the partner a name.');
  const kind = PARTNER_KINDS[src.kind] ? src.kind : null;
  if (!kind) fail('Pick what kind of partner it is.');
  const url = cleanUrl(src.url);
  if (src.url && !url) fail('The link doesn’t look like a web address.');
  let place = null;
  const p = src.place && typeof src.place === 'object' ? src.place : null;
  if (p && str(p.label, 80)) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    place = { label: str(p.label, 80), city: str(p.city, 60), region: str(p.region, 60), country: str(p.country, 2).toUpperCase(), lat: Number.isFinite(lat) ? coarsePoint(lat) : null, lng: Number.isFinite(lng) ? coarsePoint(lng) : null };
  }
  const gate = CODE_GATES[src.codeGate] ? src.codeGate : 'account';
  const status = ['draft', 'listed', 'paused'].includes(src.status) ? src.status : 'listed';
  return {
    name, kind, url, place,
    blurb: text(src.blurb, MAX_BLURB_CHARS) || null,
    ships: Boolean(src.ships),
    deal: str(src.deal, MAX_DEAL_CHARS) || null,
    code: str(src.code, 60) || null,
    codeGate: gate,
    codeNote: text(src.codeNote, MAX_NOTE_CHARS) || null,
    contactName: str(src.contactName, 80) || null,
    contactEmail: str(src.contactEmail, 120) || null,
    status,
    featured: Boolean(src.featured),
    sortOrder: Math.max(0, Math.min(999, Math.round(Number(src.sortOrder) || 0)))
  };
}

function rowFrom(c) {
  return {
    name: c.name, kind: c.kind, blurb: c.blurb, url: c.url,
    place_label: c.place ? c.place.label : null, city: c.place ? c.place.city || null : null, region: c.place ? c.place.region || null : null, country: c.place ? c.place.country || null : null,
    lat: c.place ? c.place.lat : null, lng: c.place ? c.place.lng : null,
    ships: c.ships, deal: c.deal, code: c.code, code_gate: c.codeGate, code_note: c.codeNote,
    contact_name: c.contactName, contact_email: c.contactEmail, status: c.status, featured: c.featured, sort_order: c.sortOrder,
    updated_at: new Date().toISOString()
  };
}

// Create or update (id present). `logoBase64` uploads a new logo.
export async function savePartner(input, { logoBase64 = null, fileName = null } = {}) {
  const clean = cleanPartnerInput(input);
  const supabase = getSupabase();
  const row = rowFrom(clean);
  if (logoBase64) row.logo_url = await uploadArtworkImage({ base64: logoBase64, fileName: fileName || 'logo.png', pathPrefix: `partner-logo-${Date.now()}` });
  else if (input && input.logoUrl === null) row.logo_url = null;
  let res;
  if (input && input.id) res = await supabase.from('partners').update(row).eq('id', String(input.id)).select('*').single();
  else res = await supabase.from('partners').insert(row).select('*').single();
  if (res.error) {
    if (isMissingPartnersTable(res.error)) fail('Resources aren’t set up yet — run migration 108.', 503);
    throw new Error(res.error.message);
  }
  return toPartner(res.data, { admin: true });
}

export async function deletePartner(id) {
  const { error } = await getSupabase().from('partners').delete().eq('id', String(id));
  if (error) throw new Error(error.message);
  return { ok: true };
}
