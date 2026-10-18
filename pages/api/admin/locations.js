import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';
import { getSupabase } from '../../../lib/supabase';
import { searchListings, setListingStatus, listPendingListings, isMissingLocationsTable } from '../../../lib/locations';
import { LOCATION_TYPES } from '../../../lib/locationRules';
import { listRequestsForAdmin, refundBooking, setOutcome, cancelRequest } from '../../../lib/locationRequests';

// Admin: Locations (/admin/locations).
//   GET  → { pendingCount, issues, settle, bookings, listings, totals }
//          issues   = paid bookings whose host reported damage / a no-show
//          settle   = paid bookings past their last day with no outcome (host gone quiet)
//          bookings = every paid / done / refunded booking, newest first
//          listings = every listed or paused place with its open report count
//   POST { op: 'refund', requestId, reason }        full refund, final
//        { op: 'outcome', requestId, outcome, note } settle a booking for a quiet host
//        { op: 'cancel', requestId }                 cancel an unpaid/paid request as admin
//        { op: 'pause' | 'remove', locationId }      hide a place
export default async function handler(req, res) {
  const account = await getRoleContext(req);
  if (!(account.isAdmin || hasCapability(account, 'handle_flags'))) return res.status(403).json({ error: 'Admin access required.' });
  return handleLocationsAdmin(req, res, account);
}

export async function handleLocationsAdmin(req, res, account) {
  const rc = { userId: account.userId, email: account.email, isAdmin: true };
  try {
    if (req.method === 'GET') {
      const supabase = getSupabase();
      const [pending, requests, listed, paused, reports] = await Promise.all([
        listPendingListings(),
        listRequestsForAdmin(),
        searchListings({ sort: 'new' }, { viewerId: null }),
        supabase.from('locations').select('id, title, kind, host_id, place_label, status, shoots_count, cover_url').eq('status', 'paused').order('updated_at', { ascending: false }).limit(100),
        supabase.from('content_reports').select('target_id').eq('target_type', 'location').eq('status', 'open')
      ]);
      const reportCounts = {};
      for (const r of reports.data || []) reportCounts[r.target_id] = (reportCounts[r.target_id] || 0) + 1;
      const listings = [
        ...listed.listings.map((l) => ({ id: l.id, title: l.title, kindLabel: l.kindLabel, place: l.place ? l.place.label : null, status: 'listed', shootsCount: l.shootsCount, coverUrl: l.coverUrl, host: l.host, verified: l.verified, reports: reportCounts[l.id] || 0 })),
        ...(paused.data || []).map((l) => ({ id: l.id, title: l.title, kindLabel: LOCATION_TYPES[l.kind] || l.kind, place: l.place_label, status: 'paused', shootsCount: l.shoots_count, coverUrl: l.cover_url, host: null, verified: null, reports: reportCounts[l.id] || 0 }))
      ].sort((a, b) => b.reports - a.reports);
      const paidCents = requests.filter((r) => r.status === 'paid' || r.status === 'done').reduce((n, r) => n + r.bookingCents, 0);
      const cutCents = requests.filter((r) => r.status === 'paid' || r.status === 'done').reduce((n, r) => n + r.platformCutCents, 0);
      return res.status(200).json({
        pendingCount: pending.length,
        issues: requests.filter((r) => r.outcome && r.outcome !== 'as_agreed' && !r.outcomeSettledByAdmin),
        settle: requests.filter((r) => r.status === 'paid' && !r.outcome && r.pastEnd),
        bookings: requests,
        listings,
        totals: { listed: listed.total, paused: (paused.data || []).length, paidCents, cutCents, refunded: requests.filter((r) => r.status === 'refunded').length }
      });
    }
    if (req.method === 'POST') {
      const { op, requestId, locationId, reason, outcome, note } = req.body || {};
      // These move money and can't be undone: full admins only, the same
      // as Pitch Room refunds. Sub-admins with handle_flags still see the
      // page, settle outcomes and pause or remove places.
      if ((op === 'refund' || op === 'cancel') && !account.isAdmin) {
        return res.status(403).json({ error: 'Only a full admin can refund or cancel a booking, since that moves money.' });
      }
      if (op === 'refund') {
        const result = await refundBooking(rc, requestId, reason);
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: 'location_booking_refunded', targetType: 'location_request', targetId: requestId, details: reason || null });
        return res.status(200).json({ request: result });
      }
      if (op === 'outcome') {
        const result = await setOutcome(account.userId, requestId, { outcome, note }, { isAdmin: true });
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: 'location_booking_outcome', targetType: 'location_request', targetId: requestId, details: outcome });
        return res.status(200).json({ request: result });
      }
      if (op === 'cancel') {
        const result = await cancelRequest(account.userId, requestId, { reason }, { isAdmin: true });
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: 'location_booking_cancelled', targetType: 'location_request', targetId: requestId, details: reason || null });
        return res.status(200).json({ request: result });
      }
      if (op === 'pause' || op === 'remove' || op === 'resume') {
        const next = { pause: 'paused', remove: 'removed', resume: 'listed' }[op];
        const result = await setListingStatus(account.userId, locationId, next, { isAdmin: true });
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: { pause: 'location_paused', remove: 'location_removed', resume: 'location_resumed' }[op], targetType: 'location', targetId: locationId });
        return res.status(200).json(result);
      }
      return res.status(400).json({ error: 'Unknown op.' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (isMissingLocationsTable(err)) return res.status(503).json({ error: 'Locations aren’t set up yet — run migration 086.' });
    console.error('admin/locations:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
