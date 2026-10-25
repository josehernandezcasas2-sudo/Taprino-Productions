import { getSupabase } from './supabase';
import { notifyCreator } from './notify';
import { MAX_DAYS } from './productionRules';

// The small bits of Productions (migration 104) that Crew Call and
// Locations call into. Kept apart from lib/productions.js so those two
// modules and this one don't import each other in a circle.

export function isMissingProductionsTable(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation "?production/i.test(error.message || '');
}

// A call or a location request can name the production it's for — one
// of the poster's own, still live. Returns { id, title } or null; throws
// through `fail` when it isn't theirs. `keep` is the production the
// record already has, which an edit may leave as it is.
export async function ownProductionInfo(productionId, ownerId, fail, { keep = null } = {}) {
  const id = productionId == null ? '' : String(typeof productionId === 'object' ? productionId.id : productionId).trim().slice(0, 80);
  if (!id) return null;
  const { data: p, error } = await getSupabase().from('productions').select('id, title, owner_id, status, moderation_hold').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingProductionsTable(error)) fail('Productions aren’t set up yet — the admin needs to run migration 104.', 503);
    throw new Error(error.message);
  }
  if (!p) fail('That production doesn’t exist.');
  const unchanged = Boolean(keep) && keep === id;
  if (!unchanged && (p.owner_id !== ownerId || p.status === 'removed' || p.status === 'archived')) fail('You can only link one of your own live productions.', 403);
  return { id: p.id, title: p.title };
}

// Days are numbered by date; called after any add or remove.
export async function renumberDays(productionId) {
  const supabase = getSupabase();
  const { data } = await supabase.from('production_days').select('id, day_no').eq('production_id', productionId).order('shoot_on', { ascending: true }).order('created_at', { ascending: true });
  const rows = data || [];
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].day_no !== i + 1) await supabase.from('production_days').update({ day_no: i + 1 }).eq('id', rows[i].id);
  }
  return rows.length;
}

// A booking on a linked Crew Call post keeps the production's crew list
// in step: booked → on the list (worked = false), unbooked / declined →
// off it again (unless the owner already confirmed the work), worked →
// confirmed, no-show / cancelled → off it. Best effort: the call's own
// booking never fails because of this.
export async function syncMemberFromResponse(callRow, response, event) {
  if (!callRow || !callRow.production_id || !response) return;
  const supabase = getSupabase();
  const base = { production_id: callRow.production_id, user_id: response.user_id, role: callRow.role };
  try {
    if (event === 'booked' || event === 'worked') {
      const { data: existing } = await supabase.from('production_members').select('id, worked').eq('production_id', base.production_id).eq('user_id', base.user_id).eq('role', base.role).maybeSingle();
      const patch = { response_id: response.id, hidden: false };
      if (event === 'worked') Object.assign(patch, { worked: true, worked_at: new Date().toISOString(), worked_by: callRow.poster_id });
      if (existing) await supabase.from('production_members').update(patch).eq('id', existing.id);
      else await supabase.from('production_members').insert({ ...base, ...patch, added_by: callRow.poster_id });
    } else {
      // unbooked, declined, no_show, cancelled
      const q = supabase.from('production_members').delete().eq('production_id', base.production_id).eq('user_id', base.user_id).eq('role', base.role).eq('response_id', response.id);
      if (event === 'unbooked' || event === 'declined') q.eq('worked', false);
      await q;
    }
  } catch (err) {
    console.error('production member sync:', err.message);
  }
}

// A paid location booking for a production puts its dates on the call
// sheet: one day per date, with the place attached, unless that date
// already has a day. Best effort, called from the payment webhook.
export async function attachBookingToProduction(requestRow) {
  if (!requestRow || !requestRow.production_id) return;
  const supabase = getSupabase();
  try {
    const [{ data: prod }, { data: loc }, { data: existing }] = await Promise.all([
      supabase.from('productions').select('id, owner_id, title').eq('id', requestRow.production_id).maybeSingle(),
      supabase.from('locations').select('id, title, city, region').eq('id', requestRow.location_id).maybeSingle(),
      supabase.from('production_days').select('shoot_on').eq('production_id', requestRow.production_id)
    ]);
    if (!prod || prod.owner_id !== requestRow.producer_id) return;
    const taken = new Set((existing || []).map((d) => d.shoot_on));
    const start = Date.parse(`${requestRow.starts_on}T12:00:00Z`);
    const end = Date.parse(`${requestRow.ends_on}T12:00:00Z`);
    const n = Math.min(MAX_DAYS, Math.max(1, Math.round((end - start) / 86400000) + 1));
    const label = loc ? `${loc.title}${loc.city ? ` · ${loc.city}` : ''}` : null;
    const inserts = [];
    for (let i = 0; i < n && taken.size + inserts.length < MAX_DAYS; i += 1) {
      const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
      if (taken.has(day)) continue;
      inserts.push({
        production_id: prod.id, shoot_on: day, call_time: requestRow.hours_from || null, wrap_time: requestRow.hours_to || null,
        location_id: requestRow.location_id, location_request_id: requestRow.id, place_label: label
      });
    }
    if (inserts.length === 0) return;
    const { error } = await supabase.from('production_days').insert(inserts);
    if (error) throw new Error(error.message);
    await renumberDays(prod.id);
    await notifyCreator({ userId: prod.owner_id, type: 'production_days', message: `${label || 'The place'} is on the call sheet for ${prod.title} — ${inserts.length} shoot ${inserts.length === 1 ? 'day' : 'days'} added. Fill in call times and notes.`, href: `/productions/${prod.id}` });
  } catch (err) {
    console.error('attachBookingToProduction:', err.message);
  }
}

// Title changes ride along to the calls and requests that copied it.
export async function propagateProductionTitle(productionId, title) {
  const supabase = getSupabase();
  await Promise.all([
    supabase.from('crew_calls').update({ production_title: title }).eq('production_id', productionId),
    supabase.from('location_requests').update({ production_title: title }).eq('production_id', productionId)
  ]);
}
