import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { hasBuyersIncludingSeries } from '../../../lib/purchases';
import { CONFIRM_LABEL, confirmOutcome, has124, removedState } from '../../../lib/removalRules';

// The deletion queue (Admin → Library → Pending deletions): removals asked
// for and not yet confirmed, and — since migration 124 — removals off the
// site whose files we still keep (held 30 days, or kept for later), each
// with what confirming does (outcome, confirmLabel) and whether a full
// admin may delete it now (canDeleteNow: never on anything bought).
const HELD_MAX = 100;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the same capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_deletions');
  if (!roleContext) return;
  const isAdmin = roleContext.isAdmin === true;

  const supabase = getSupabase();
  const [episodesResult, seriesResult] = await Promise.all([
    supabase
      .from('episodes')
      .select('*')
      .eq('deletion_requested', true)
      .is('withdrawn_at', null)
      .order('deletion_requested_at', { ascending: true }),
    supabase
      .from('series')
      .select('*')
      .eq('deletion_requested', true)
      .is('withdrawn_at', null)
      .order('deletion_requested_at', { ascending: true })
  ]);

  if (episodesResult.error || seriesResult.error) {
    console.error('pending-deletions error:', (episodesResult.error || seriesResult.error).message);
    return res.status(500).json({ error: 'Could not load pending deletions.' });
  }
  const episodes = episodesResult.data || [];
  const series = seriesResult.data || [];

  // Whether the database has migration 124 (removals held a month), off
  // any row read with select('*'); with no request open, one small read.
  let holdReady = episodes.length ? has124(episodes[0]) : series.length ? has124(series[0]) : null;
  let held = [];
  if (holdReady !== false) {
    const [heldEps, heldShows] = await Promise.all([
      supabase.from('episodes').select('id, title, artist, deletion_reason, withdrawn_at, purge_after, keep_after_removal, restore_requested_at').not('withdrawn_at', 'is', null)
        .or('purge_after.not.is.null,keep_after_removal.eq.true').order('withdrawn_at', { ascending: false }).limit(HELD_MAX),
      supabase.from('series').select('id, name, deletion_reason, withdrawn_at, purge_after, keep_after_removal, restore_requested_at').not('withdrawn_at', 'is', null)
        .or('purge_after.not.is.null,keep_after_removal.eq.true').order('withdrawn_at', { ascending: false }).limit(HELD_MAX)
    ]);
    if (heldEps.error || heldShows.error) {
      holdReady = false;
    } else {
      holdReady = true;
      held = [
        ...(heldEps.data || []).map((e) => ({ type: 'episode', id: e.id, title: e.title, artist: e.artist || null, reason: e.deletion_reason, ...heldWords(e, isAdmin) })),
        ...(heldShows.data || []).map((s) => ({ type: 'series', id: s.id, title: s.name, artist: null, reason: s.deletion_reason, href: `/admin/shows/${encodeURIComponent(s.id)}#removal`, ...heldWords(s, isAdmin) }))
      ].sort((a, b) => String(b.removedAt || '').localeCompare(String(a.removedAt || '')));
    }
  }

  // Whether each open request's title was bought (the Confirm button's
  // words only: the confirmation reads the buyers strictly itself).
  const bought = await Promise.all(episodes.map((e) => hasBuyersIncludingSeries('episode', e.id).catch(() => false)));

  return res.status(200).json({
    holdReady: holdReady === true,
    episodes: episodes.map((e, i) => {
      const outcome = confirmOutcome({ bought: bought[i], keep: e.keep_after_removal === true, ready: has124(e) });
      return {
        id: e.id,
        title: e.title,
        artist: e.artist,
        reason: e.deletion_reason,
        requestedAt: e.deletion_requested_at,
        outcome,
        confirmLabel: CONFIRM_LABEL[outcome],
        keep: e.keep_after_removal === true,
        canDeleteNow: isAdmin && has124(e) && !bought[i]
      };
    }),
    series: series.map((s) => ({
      id: s.id,
      name: s.name,
      reason: s.deletion_reason,
      requestedAt: s.deletion_requested_at,
      keep: s.keep_after_removal === true,
      // A show is removed from its page on Admin → Shows, where its card
      // says what goes with it (the series revamp, slice 3a).
      href: `/admin/shows/${encodeURIComponent(s.id)}#removal`
    })),
    held
  });
}

function heldWords(row, isAdmin) {
  const st = removedState(row);
  return {
    state: st ? st.key : null,
    label: st ? st.label : null,
    removedAt: row.withdrawn_at || null,
    purgeAfter: row.purge_after || null,
    asked: Boolean(row.restore_requested_at),
    // Delete now on a held title: a full admin (the route reads the buyers
    // again and refuses anything bought).
    canDeleteNow: isAdmin
  };
}
