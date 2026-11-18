import { getSupabase } from './supabase';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { getFollowedUserIds } from './follows';
import { blockedIdsFor } from './messages';
import { likeLiteral, hasLikeStar } from './likeLiteral';
import { peopleQuery } from './messageRules';

// New message's people (2026-11-18, Jose: "add the small search by name or
// handle / do both"). Two answers, for a signed-in person only:
//   - suggested(): the people on their productions (as owner or crew) and
//     the people they follow, so the usual someone is one tap away;
//   - search(q): public profiles by display name (anywhere in it) or by
//     @handle (from its start), at least two letters, at most 20.
// Never the person themselves, never anyone either of them blocked. Only
// what a public profile already shows: name, @handle, photo.

const LIMIT = 20;
const SUGGEST = 12;

function toPerson(p, why = '') {
  return {
    userId: p.userId,
    displayName: p.displayName,
    handle: p.handle || null,
    avatarUrl: p.avatarUrl || null,
    avatarPosition: p.avatarPosition || null,
    avatarZoom: p.avatarZoom || null,
    profilePath: profilePath(p),
    why
  };
}

export async function searchPeople(me, raw) {
  const { q, handle, ready } = peopleQuery(raw);
  if (!ready || hasLikeStar(q)) return { people: [] };
  const supabase = getSupabase();
  const pattern = likeLiteral(q);
  const [byHandle, byName, blocked] = await Promise.all([
    supabase.from('user_profiles').select('user_id').ilike('handle', `${pattern}%`).limit(LIMIT),
    handle ? Promise.resolve({ data: [] }) : supabase.from('user_profiles').select('user_id').ilike('display_name', `%${pattern}%`).limit(LIMIT),
    blockedIdsFor(me)
  ]);
  if (byHandle.error) throw new Error(`people search: ${byHandle.error.message}`);
  if (byName.error) throw new Error(`people search: ${byName.error.message}`);
  const ids = [];
  for (const r of [...(byHandle.data || []), ...(byName.data || [])]) {
    if (r.user_id && r.user_id !== me && !blocked.has(r.user_id) && !ids.includes(r.user_id)) ids.push(r.user_id);
  }
  const top = ids.slice(0, LIMIT);
  const profiles = await getPublicProfilesByIds(top);
  return { people: top.map((id) => toPerson(profiles[id])).filter((p) => p.displayName) };
}

export async function suggestedPeople(me) {
  const supabase = getSupabase();
  const [owned, joined, followed, blocked] = await Promise.all([
    supabase.from('productions').select('id, title, owner_id').eq('owner_id', me).neq('status', 'removed').order('created_at', { ascending: false }).limit(20),
    supabase.from('production_members').select('production_id').eq('user_id', me).limit(40),
    getFollowedUserIds(me),
    blockedIdsFor(me)
  ]);
  if (owned.error) throw new Error(`suggested: ${owned.error.message}`);
  if (joined.error) throw new Error(`suggested: ${joined.error.message}`);
  const joinedIds = [...new Set((joined.data || []).map((r) => r.production_id))].filter((id) => !(owned.data || []).some((p) => p.id === id));
  let productions = owned.data || [];
  if (joinedIds.length) {
    const { data, error } = await supabase.from('productions').select('id, title, owner_id').in('id', joinedIds.slice(0, 40)).neq('status', 'removed').eq('moderation_hold', false);
    if (error) throw new Error(`suggested: ${error.message}`);
    productions = [...productions, ...(data || [])];
  }
  const why = new Map();
  const add = (id, title) => { if (id && id !== me && !blocked.has(id) && !why.has(id)) why.set(id, title); };
  for (const p of productions) add(p.owner_id, p.title);
  if (productions.length) {
    const { data, error } = await supabase.from('production_members').select('user_id, production_id').in('production_id', productions.map((p) => p.id)).limit(200);
    if (error) throw new Error(`suggested: ${error.message}`);
    const title = new Map(productions.map((p) => [p.id, p.title]));
    for (const m of data || []) add(m.user_id, title.get(m.production_id));
  }
  const productionIds = [...why.keys()].slice(0, SUGGEST);
  const followIds = (followed || []).filter((id) => id !== me && !blocked.has(id) && !productionIds.includes(id)).slice(0, SUGGEST);
  const profiles = await getPublicProfilesByIds([...productionIds, ...followIds]);
  return {
    productions: productionIds.map((id) => toPerson(profiles[id], why.get(id) || '')).filter((p) => p.displayName),
    following: followIds.map((id) => toPerson(profiles[id])).filter((p) => p.displayName)
  };
}
