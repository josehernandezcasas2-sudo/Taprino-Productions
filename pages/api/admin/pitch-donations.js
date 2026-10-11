import { getRoleContext } from '../../../lib/roles';
import { getPitchBackings, refundDonation } from '../../../lib/pitchDonations';
import { getPublicIdentities } from '../../../lib/userProfiles';
import { recordAudit } from '../../../lib/auditLog';
import { dollars } from '../../../lib/donationMath';

// The backings on one pitch for the admin Pitch Room
// (GET ?pitchId=…) and the admin-only refund (POST { donationId, reason }).
// Full admins only — this moves money. components/admin/PitchBackings.js.
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      const pitchId = String(req.query.pitchId || '');
      if (!pitchId) return res.status(400).json({ error: 'pitchId is required.' });
      const { backings, pendingCount, failedCount } = await getPitchBackings(pitchId);
      const ids = backings.map((b) => b.donorUserId).filter(Boolean);
      const identities = ids.length > 0 ? await getPublicIdentities(ids).catch(() => ({})) : {};
      return res.status(200).json({
        backings: backings.map((b) => ({ ...b, backerName: identities[b.donorUserId] ? identities[b.donorUserId].displayName : null })),
        pendingCount,
        failedCount
      });
    }

    if (req.method === 'POST') {
      const { donationId, reason } = req.body || {};
      if (!donationId) return res.status(400).json({ error: 'donationId is required.' });
      const result = await refundDonation({ donationId, adminEmail: email, reason });
      if (!result.alreadyRefunded) {
        const d = result.donation;
        await recordAudit({
          adminId: userId,
          adminEmail: email,
          action: 'pitch_donation_refunded',
          targetType: 'pitch_donation',
          targetId: donationId,
          details: `${dollars(d.totalChargedCents || d.amountCents)} on pitch ${d.pitchId}${reason ? ` · ${String(reason).slice(0, 200)}` : ''}`
        });
      }
      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin pitch-donations error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
