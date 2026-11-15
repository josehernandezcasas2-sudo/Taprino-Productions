import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { seenFor } from '../../../lib/stagedChanges';
import { waitingDetailWords } from '../../../lib/liveReviewRules';

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

// The Library's "Pending edits": a live title's waiting words — its title
// (a show's name), its description, its page notes (migration 122) — and
// since migration 124 (Jose, 2026-11-15: "make sure any caption change or
// anything to change the series/live titles needs review") its waiting
// details and captions (pending_fields), each with what is live now and
// what is proposed, in words (lib/liveReviewRules.js). Each row carries
// `seen` (lib/stagedChanges.js) so a change replaced since the list was
// read is refused rather than put live unseen. Each read is tried with the
// newest columns first and again without them on an older database.
const EPISODE_LIVE = 'genre, main_genre, artist, release_year, runtime, funding_url, ad_break_seconds, ads_enabled, extra_kind, credits, captions_url, captions_label, captions_language, series_id';
const SERIES_LIVE = 'release_year, funding_url, seasons, credits, kind, defaults';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_episodes');
  if (!roleContext) return;

  const supabase = getSupabase();
  const episodes124 = () => supabase
    .from('episodes')
    .select(`id, title, description, page_notes, pending_title, pending_description, pending_page_notes, pending_fields, ${EPISODE_LIVE}`)
    .or('pending_title.not.is.null,pending_description.not.is.null,pending_page_notes.not.is.null,pending_fields.not.is.null');
  // Notes for a title's own page wait too since migration 122
  // (pending_page_notes; '' = clearing them waits).
  const episodesWithNotes = () => supabase
    .from('episodes')
    .select('id, title, description, page_notes, pending_title, pending_description, pending_page_notes')
    .or('pending_title.not.is.null,pending_description.not.is.null,pending_page_notes.not.is.null');
  const episodesWithout = () => supabase
    .from('episodes')
    .select('id, title, description, pending_title, pending_description')
    .or('pending_title.not.is.null,pending_description.not.is.null');
  const series124 = () => supabase
    .from('series')
    .select(`id, name, description, pending_name, pending_description, pending_fields, ${SERIES_LIVE}`)
    .or('pending_name.not.is.null,pending_description.not.is.null,pending_fields.not.is.null');
  const seriesWithout = () => supabase
    .from('series')
    .select('id, name, description, pending_name, pending_description')
    .or('pending_name.not.is.null,pending_description.not.is.null');

  const [firstEpisodes, firstSeries] = await Promise.all([episodes124(), series124()]);
  let episodesResult = firstEpisodes;
  if (episodesResult.error && isMissingColumn(episodesResult.error)) episodesResult = await episodesWithNotes();
  if (episodesResult.error && isMissingColumn(episodesResult.error)) episodesResult = await episodesWithout();
  let seriesResult = firstSeries;
  if (seriesResult.error && isMissingColumn(seriesResult.error)) seriesResult = await seriesWithout();

  if (episodesResult.error || seriesResult.error) {
    console.error('pending-edits error:', (episodesResult.error || seriesResult.error).message);
    return res.status(500).json({ error: 'Could not load pending edit requests.' });
  }

  return res.status(200).json({
    episodes: (episodesResult.data || []).map((e) => ({
      id: e.id,
      currentTitle: e.title,
      currentDescription: e.description,
      pendingTitle: e.pending_title,
      pendingDescription: e.pending_description,
      currentPageNotes: e.page_notes ?? null,
      pendingPageNotes: typeof e.pending_page_notes === 'string' ? e.pending_page_notes : null,
      // [{ field, label, live, proposed }] — words, never a stored file address.
      details: waitingDetailWords(e, 'episode', { inShow: Boolean(e.series_id) }),
      seen: seenFor('episode', e, 'text')
    })),
    series: (seriesResult.data || []).map((s) => ({
      id: s.id,
      currentName: s.name,
      currentDescription: s.description,
      pendingName: s.pending_name,
      pendingDescription: s.pending_description,
      details: waitingDetailWords(s, 'series'),
      seen: seenFor('series', s, 'text')
    }))
  });
}
