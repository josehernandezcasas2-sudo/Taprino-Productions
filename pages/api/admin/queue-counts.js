import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { getSupabase } from '../../../lib/supabase';
import { listReviewQueue } from '../../../lib/reviewQueue';
import { getModerationState } from '../../../lib/moderation';

// Badge numbers for the admin nav (components/AdminShell.js) and the
// mobile admin home. Cheap-ish; everything fails soft to 0.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');

  const rc = await getRoleContext(req);
  if (!rc.canAccessAdmin) return res.status(403).json({ error: 'Admin access required.' });

  const supabase = getSupabase();
  const canLibrary = rc.isAdmin || hasCapability(rc, 'manage_artwork') || hasCapability(rc, 'manage_deletions');
  const canFlags = rc.isAdmin || hasCapability(rc, 'handle_flags');

  const [queue, artworkEp, artworkSe, deletionsEp, deletionsSe, moderation, comments] = await Promise.all([
    listReviewQueue(rc).catch(() => ({ counts: { total: 0, channel: 0 } })),
    canLibrary ? supabase.from('episodes').select('id', { count: 'exact', head: true }).or('pending_poster.not.is.null,pending_thumbnail.not.is.null') : null,
    canLibrary ? supabase.from('series').select('id', { count: 'exact', head: true }).or('pending_poster.not.is.null,pending_thumbnail.not.is.null,pending_hero_image.not.is.null,pending_trailer_src.not.is.null') : null,
    canLibrary ? supabase.from('episodes').select('id', { count: 'exact', head: true }).eq('deletion_requested', true) : null,
    canLibrary ? supabase.from('series').select('id', { count: 'exact', head: true }).eq('deletion_requested', true) : null,
    canFlags ? getModerationState().catch(() => null) : null,
    rc.isAdmin ? supabase.from('pitch_comments').select('id', { count: 'exact', head: true }).eq('reported', true) : null
  ]);

  const n = (r) => (r && !r.error && typeof r.count === 'number' ? r.count : 0);
  // Open flags plus titles with uncounted open reports (ignored ones
  // don't need attention).
  const openFlags = moderation
    ? (moderation.flags || []).length
      + Object.values(moderation.reportsByTarget || {}).filter((t) => t.counted > 0 && !t.ignored).length
    : 0;

  return res.status(200).json({
    review: queue.counts.total,
    channel: queue.counts.channel,
    library: n(artworkEp) + n(artworkSe) + n(deletionsEp) + n(deletionsSe),
    flags: openFlags,
    pitch: n(comments)
  });
}
