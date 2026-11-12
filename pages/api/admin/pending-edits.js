import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { seenFor } from '../../../lib/stagedChanges';

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_episodes');
  if (!roleContext) return;
  const { isAdmin } = roleContext;

  const supabase = getSupabase();
  // Notes for a title's own page wait too since migration 122
  // (pending_page_notes; '' = clearing them waits): the read asks for them
  // and, on a database without the column, again without them.
  const episodesWithNotes = () => supabase
    .from('episodes')
    .select('id, title, description, page_notes, pending_title, pending_description, pending_page_notes')
    .or('pending_title.not.is.null,pending_description.not.is.null,pending_page_notes.not.is.null');
  const episodesWithout = () => supabase
    .from('episodes')
    .select('id, title, description, pending_title, pending_description')
    .or('pending_title.not.is.null,pending_description.not.is.null');
  const [firstEpisodes, seriesResult] = await Promise.all([
    episodesWithNotes(),
    supabase
      .from('series')
      .select('id, name, description, pending_name, pending_description')
      .or('pending_name.not.is.null,pending_description.not.is.null')
  ]);

  let episodesResult = firstEpisodes;
  if (episodesResult.error && isMissingColumn(episodesResult.error)) episodesResult = await episodesWithout();

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
      seen: seenFor('episode', e, 'text')
    })),
    series: (seriesResult.data || []).map((s) => ({
      id: s.id,
      currentName: s.name,
      currentDescription: s.description,
      pendingName: s.pending_name,
      pendingDescription: s.pending_description,
      seen: seenFor('series', s, 'text')
    }))
  });
}
