import { getSupabase } from './supabase';

// Maps a DB row to the camelCase shape every caller works with.
function rowToGroup(row) {
  return {
    id: row.id,
    scope: row.scope,
    groupType: row.group_type,
    genreName: row.genre_name,
    title: row.group_type === 'genre' ? row.genre_name : row.title,
    position: row.position,
    active: row.active
  };
}

// Fetches every curated_groups row for a scope, ordered by position. Used
// by both the admin management page (which needs every row, active or
// not, to manage them) and indirectly by getCuratedRowsForPage below
// (which filters to active-only for the public-facing render).
export async function getAllGroupsForScope(scope) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('curated_groups')
    .select('*')
    .eq('scope', scope)
    .order('position', { ascending: true });
  if (error) {
    console.error('getAllGroupsForScope error:', error.message);
    return [];
  }
  return data.map(rowToGroup);
}

// Given the genre names actually present in a scope's content right now,
// makes sure each has a corresponding curated_groups row — auto-creating
// any missing ones at the end of the current order. Called on every page
// render (cheap: one query to check, inserts only happen the first time a
// genre is ever seen) so a brand-new genre automatically gets a stable,
// reorderable row without needing an admin to notice and add it first.
export async function ensureGenreGroupsExist(scope, genreNames) {
  if (!genreNames || genreNames.length === 0) return;
  const supabase = getSupabase();
  const { data: existing, error } = await supabase
    .from('curated_groups')
    .select('genre_name, position')
    .eq('scope', scope)
    .eq('group_type', 'genre');
  if (error) {
    console.error('ensureGenreGroupsExist read error:', error.message);
    return;
  }
  const existingNames = new Set((existing || []).map((r) => r.genre_name));
  const missing = genreNames.filter((g) => !existingNames.has(g));
  if (missing.length === 0) return;

  const maxPosition = (existing || []).reduce((max, r) => Math.max(max, r.position || 0), -1);
  const inserts = missing.map((g, i) => ({
    scope,
    group_type: 'genre',
    genre_name: g,
    title: null,
    position: maxPosition + 1 + i,
    active: true
  }));
  // Race-safe: two visitors hitting a brand-new genre at the same moment
  // could both try to insert it. onConflict matches the table's own
  // unique(scope, group_type, genre_name) constraint, so the second
  // insert quietly no-ops instead of erroring or creating a duplicate row.
  const { error: insertError } = await supabase
    .from('curated_groups')
    .upsert(inserts, { onConflict: 'scope,group_type,genre_name', ignoreDuplicates: true });
  if (insertError) {
    console.error('ensureGenreGroupsExist insert error:', insertError.message);
  }
}

// The actual public-facing fetch: active rows for a scope, in either
// admin-set order or shuffled, each resolved to its real episode list.
// `episodes` must already be filtered to whatever this scope means (e.g.
// only film-type episodes for the 'type:films' scope) — this function
// only ever narrows further (by genre, or by an explicit custom pick),
// never widens beyond what's passed in.
export async function getCuratedRowsForPage(scope, episodes, randomOrder) {
  await ensureGenreGroupsExist(scope, [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))]);

  const supabase = getSupabase();
  const { data: groupRows, error } = await supabase
    .from('curated_groups')
    .select('*')
    .eq('scope', scope)
    .eq('active', true)
    .order('position', { ascending: true });
  if (error) {
    console.error('getCuratedRowsForPage error:', error.message);
    return [];
  }

  const customGroupIds = groupRows.filter((g) => g.group_type === 'custom').map((g) => g.id);
  let itemsByGroup = {};
  if (customGroupIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from('curated_group_items')
      .select('group_id, episode_id, position')
      .in('group_id', customGroupIds)
      .order('position', { ascending: true });
    if (itemsError) {
      console.error('getCuratedRowsForPage items error:', itemsError.message);
    } else {
      itemsByGroup = items.reduce((acc, row) => {
        (acc[row.group_id] = acc[row.group_id] || []).push(row.episode_id);
        return acc;
      }, {});
    }
  }

  const episodesById = new Map(episodes.map((e) => [e.id, e]));
  let rows = groupRows.map((row) => {
    const group = rowToGroup(row);
    let rowEpisodes;
    if (group.groupType === 'genre') {
      rowEpisodes = episodes.filter((e) => e.mainGenre === group.genreName);
    } else {
      // Resolved against the live episode list, same reconciliation
      // pattern as the swipe-deck progress feature — an episode picked
      // into a custom group that's since been deleted, unapproved, or
      // outside this scope just quietly drops out rather than erroring.
      rowEpisodes = (itemsByGroup[group.id] || []).map((id) => episodesById.get(id)).filter(Boolean);
    }
    return { ...group, episodes: rowEpisodes };
  });

  // Rows that ended up with nothing to show (every episode in a custom
  // group got deleted, or a genre that no longer has any matching
  // content in this scope) are dropped rather than rendering an empty
  // row — same "don't show empty sections" rule already used everywhere
  // else in this codebase.
  rows = rows.filter((r) => r.episodes.length > 0);

  if (randomOrder) {
    rows = [...rows].sort(() => Math.random() - 0.5);
  }

  return rows;
}

export async function createCustomGroup(scope, title) {
  const supabase = getSupabase();
  const { data: existing } = await supabase.from('curated_groups').select('position').eq('scope', scope);
  const maxPosition = (existing || []).reduce((max, r) => Math.max(max, r.position || 0), -1);
  const { data, error } = await supabase
    .from('curated_groups')
    .insert({ scope, group_type: 'custom', title, position: maxPosition + 1, active: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToGroup(data);
}

export async function renameCustomGroup(groupId, title) {
  const supabase = getSupabase();
  const { error } = await supabase.from('curated_groups').update({ title, updated_at: new Date().toISOString() }).eq('id', groupId).eq('group_type', 'custom');
  if (error) throw new Error(error.message);
}

export async function setGroupActive(groupId, active) {
  const supabase = getSupabase();
  const { error } = await supabase.from('curated_groups').update({ active, updated_at: new Date().toISOString() }).eq('id', groupId);
  if (error) throw new Error(error.message);
}

export async function deleteCustomGroup(groupId) {
  const supabase = getSupabase();
  // Genre rows are auto-managed and re-created the moment their genre
  // reappears in content, so deleting one would be meaningless — the
  // group_type filter here means this only ever removes a genuinely
  // admin-created row, never one this system would just recreate anyway.
  const { error } = await supabase.from('curated_groups').delete().eq('id', groupId).eq('group_type', 'custom');
  if (error) throw new Error(error.message);
}

// Replaces a custom group's full episode list — simpler and less
// error-prone than diffing adds/removes for what's realistically always a
// small, admin-curated list.
export async function setCustomGroupItems(groupId, episodeIds) {
  const supabase = getSupabase();
  const { error: deleteError } = await supabase.from('curated_group_items').delete().eq('group_id', groupId);
  if (deleteError) throw new Error(deleteError.message);
  if (episodeIds.length === 0) return;
  const rows = episodeIds.map((episodeId, i) => ({ group_id: groupId, episode_id: episodeId, position: i }));
  const { error: insertError } = await supabase.from('curated_group_items').insert(rows);
  if (insertError) throw new Error(insertError.message);
}

export async function getCustomGroupItemIds(groupId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('curated_group_items')
    .select('episode_id')
    .eq('group_id', groupId)
    .order('position', { ascending: true });
  if (error) {
    console.error('getCustomGroupItemIds error:', error.message);
    return [];
  }
  return data.map((r) => r.episode_id);
}

// Bulk position update for reordering — orderedGroupIds is the complete
// new top-to-bottom order for a scope, genre and custom rows mixed
// together freely, matching "move the lists up or down" applying to both
// kinds equally.
export async function reorderGroups(orderedGroupIds) {
  const supabase = getSupabase();
  const updates = orderedGroupIds.map((id, position) =>
    supabase.from('curated_groups').update({ position, updated_at: new Date().toISOString() }).eq('id', id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(failed.error.message);
}
