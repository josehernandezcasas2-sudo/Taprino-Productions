import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { sendError } from '../../../lib/apiErrors';
import { ShowError, makeShowPublic } from '../../../lib/showPage';

// Caller-less since the merged review queue (kept, like the other orphaned
// admin routes CLAUDE.md lists). Its "approved" goes through
// lib/showPage.js makeShowPublic, the review queue's Make it public
// (decision 2 of the series revamp): only a private show with an approved
// episode, with public_at, the release clock, the trailers' protection,
// the audit line and the owner's notification. It used to set any show's
// status straight to approved, an empty one included. "rejected" answers
// 409 like the queue's retired 'series' kind (slice 3a): a show isn't
// declined any more, it is taken down from Admin → Shows.
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('series')
      .select('id, name, description, poster, thumbnail, submitted_by, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) return sendError(res, error, 'admin/pending-series');
    return res.status(200).json({ series: data || [] });
  }

  if (req.method === 'POST') {
    const { seriesId, decision } = req.body || {};
    if (!seriesId || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'seriesId and a valid decision (approved/rejected) are required.' });
    }
    if (decision === 'approved') {
      try {
        const result = await makeShowPublic(String(seriesId), { userId, email, isAdmin });
        return res.status(200).json({ ok: true, publicAt: result.publicAt, released: result.released });
      } catch (err) {
        if (err instanceof ShowError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
        return sendError(res, err, 'admin/pending-series');
      }
    }
    // A show isn't declined any more (the series revamp, slice 3a): the
    // queue's own answer.
    return res.status(409).json({ error: 'Shows aren’t declined any more — take one down from Admin → Shows if it has to come off.', code: 'retired' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
