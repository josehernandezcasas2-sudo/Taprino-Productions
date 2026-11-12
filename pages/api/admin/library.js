import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { listPlanStates } from '../../../lib/adPlans';
import { isTitleId } from '../../../lib/titleIds';
import { episodeHasPage } from '../../../lib/showRules';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  // Same capabilities as the /admin/library page itself, so a sub-admin
  // the page lets in isn't met by an empty, locked list.
  const roleContext = await requireCapability(req, res, ['manage_episodes', 'manage_artwork', 'manage_deletions']);
  if (!roleContext) return;

  // ?id=<titleId>: exactly that row (the Library's ?edit=<id> opens the
  // edit modal for it, the admin show page's "Open in Library modal").
  const { q, id } = req.query || {};
  const one = typeof id === 'string' && id !== '' ? id : null;
  if (one !== null && !isTitleId(one)) return res.status(404).json({ error: 'That title isn’t there.' });

  const supabase = getSupabase();
  // Every column the edit modal (components/AdminEditEpisodeModal.js)
  // starts its form from. It sends only what the admin changed, so a
  // column left out here would read as blank in the form and the field as
  // "not set" (discover_curated, title_image_url and the bonus parent were
  // missing until 2026-11-03: the curated switch and the title image showed
  // off, and a bonus row could not be saved until its parent was picked
  // again).
  let query = supabase
    .from('episodes')
    .select('id, title, description, tier, status, content_type, genre, main_genre, series_id, season, series_order, artist, runtime, rating, poster, thumbnail, title_image_url, src, featured, discover_curated, is_original, has_flashing_lights, funding_url, bonus_parent_type, bonus_parent_id, deletion_requested, created_at, available_from, available_until, ads_enabled, ad_break_seconds, release_year')
    .order('created_at', { ascending: false })
    .limit(200);

  // Simple free-text match on title or artist — good enough at the scale
  // of one studio's library; worth a real search index if this ever grows
  // into the thousands of episodes.
  if (one !== null) {
    query = query.eq('id', one);
  } else if (q && String(q).trim() !== '') {
    // The term goes into a PostgREST filter string: commas and parens would
    // rewrite it, and LIKE wildcards would match everything.
    const term = String(q).trim().slice(0, 80).replace(/[,()"]/g, ' ').replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.or(`title.ilike.%${term}%,artist.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('admin library error:', error.message);
    return res.status(500).json({ error: 'Could not load the library.' });
  }
  if (one !== null && (!data || data.length === 0)) return res.status(404).json({ error: 'That title isn’t there.' });

  // Episode Ad Curator state per row (lib/adPlans.js): default / draft / ready,
  // and the names of what the bonus rows hang under (below).
  const [plans, parentNames, pageNotes] = await Promise.all([
    listPlanStates((data || []).map((e) => e.id)),
    bonusParentNames(supabase, data || []),
    pageNotesFor(supabase, data || [])
  ]);

  // `?? null` throughout: a row from a database without a column, or a
  // stand-in, mustn't hand the modal an undefined.
  return res.status(200).json({
    episodes: (data || []).map((e) => ({
      adPlan: plans[e.id] || null,
      id: e.id,
      title: e.title ?? null,
      description: e.description ?? null,
      tier: e.tier ?? null,
      status: e.status ?? null,
      contentType: e.content_type ?? null,
      genre: e.genre ?? null,
      mainGenre: e.main_genre ?? null,
      seriesId: e.series_id ?? null,
      season: e.season ?? null,
      seriesOrder: e.series_order ?? null,
      artist: e.artist ?? null,
      runtime: e.runtime ?? null,
      rating: e.rating ?? null,
      releaseYear: e.release_year || null,
      isOriginal: Boolean(e.is_original),
      // The flashing-lights warning (migration 010's column; 2026-11-12:
      // the page's chip and the card before Play read it).
      hasFlashingLights: Boolean(e.has_flashing_lights),
      fundingUrl: e.funding_url ?? null,
      poster: e.poster ?? null,
      thumbnail: e.thumbnail ?? null,
      titleImageUrl: e.title_image_url ?? null,
      // This was the bug behind "I saved a Cloudflare ID, came back, and it
      // said there was no video." The query above always fetched `src`, but
      // this mapping dropped it — so the edit modal received `undefined` and
      // correctly reported "no video attached," even for episodes that had
      // one saved perfectly well. The save path was never broken; the read
      // path just never returned the field.
      src: e.src ?? null,
      featured: Boolean(e.featured),
      discoverCurated: Boolean(e.discover_curated),
      // What bonus content belongs under ('series' | 'episode' + its id),
      // and that title's name for the modal's picker, which lists only the
      // shows and this page's films and shorts.
      bonusParentType: e.bonus_parent_type ?? null,
      bonusParentId: e.bonus_parent_id ?? null,
      bonusParentTitle: e.bonus_parent_type && e.bonus_parent_id ? parentNames[`${e.bonus_parent_type}:${e.bonus_parent_id}`] ?? null : null,
      availableFrom: e.available_from ?? null,
      availableUntil: e.available_until ?? null,
      adsEnabled: e.ads_enabled !== false,
      adBreakSeconds: Array.isArray(e.ad_break_seconds) && e.ad_break_seconds.length > 0 ? e.ad_break_seconds : [0],
      deletionRequested: Boolean(e.deletion_requested),
      createdAt: e.created_at ?? null,
      // The notes for the title's own page and its page switch (migration
      // 118; pageNotesFor below): the modal's Notes box shows while the
      // title has its own page, and not at all before 118 (pageNotesReady).
      pageNotes: pageNotes.ready && pageNotes.rows[e.id] ? pageNotes.rows[e.id].page_notes ?? null : null,
      pageNotesReady: pageNotes.ready,
      hasPageChoice: pageNotes.ready && pageNotes.rows[e.id] && typeof pageNotes.rows[e.id].has_page === 'boolean' ? pageNotes.rows[e.id].has_page : null,
      hasPage: episodeHasPage({ ...e, has_page: pageNotes.ready && pageNotes.rows[e.id] ? pageNotes.rows[e.id].has_page : null })
    }))
  });
}

// The rows' page notes and page switches (migration 118's
// episodes.page_notes / has_page), in a read of their own so the library
// still loads on a database before 118: there the columns are missing,
// `ready` is false and the edit modal hides its Notes box. Any other
// failure is logged and also reads as not ready (the box hidden, so a save
// can't send notes it never saw).
function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

async function pageNotesFor(supabase, rows) {
  const ids = rows.map((e) => e.id).filter(Boolean);
  if (ids.length === 0) return { ready: true, rows: {} };
  const { data, error } = await supabase.from('episodes').select('id, page_notes, has_page').in('id', ids);
  if (error) {
    if (!isMissingColumn(error)) console.error('admin library page notes:', error.message);
    return { ready: false, rows: {} };
  }
  return { ready: true, rows: Object.fromEntries((data || []).filter((r) => r && r.id).map((r) => [r.id, r])) };
}

// The names of the shows and titles this page's bonus rows hang under,
// keyed "series:<id>" / "episode:<id>". Two small reads, only when there
// are bonus rows; a failed read leaves the names out (the modal then shows
// the id), never the library.
async function bonusParentNames(supabase, rows) {
  const ids = { series: new Set(), episode: new Set() };
  for (const e of rows) {
    const kind = e.bonus_parent_type === 'series' || e.bonus_parent_type === 'episode' ? e.bonus_parent_type : null;
    if (e.content_type === 'bonus' && kind && e.bonus_parent_id) ids[kind].add(String(e.bonus_parent_id));
  }
  const names = {};
  const [series, episodes] = await Promise.all([
    ids.series.size ? supabase.from('series').select('id, name').in('id', [...ids.series]) : { data: [] },
    ids.episode.size ? supabase.from('episodes').select('id, title').in('id', [...ids.episode]) : { data: [] }
  ]);
  if (series.error) console.error('admin library bonus shows:', series.error.message);
  if (episodes.error) console.error('admin library bonus titles:', episodes.error.message);
  for (const s of series.data || []) names[`series:${s.id}`] = s.name ?? null;
  for (const t of episodes.data || []) names[`episode:${t.id}`] = t.title ?? null;
  return names;
}
