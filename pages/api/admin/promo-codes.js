import { requireCapability } from '../../../lib/adminAuth';
import { generatePromoCodes, listPromoCodes, setPromoCodeNoted } from '../../../lib/promoCodes';
import { recordAudit } from '../../../lib/auditLog';
import { securityAlert } from '../../../lib/securityAlerts';
import { consumeRateBudget } from '../../../lib/rateLimit';

const MAX_QUANTITY = 100;
const MAX_DURATION_DAYS = 3650; // 10 years — generous ceiling, not a real-world expectation
// A sub-admin with manage_comped_access (security fixes, 2026-11-15): a
// year of Premium per code at most, and 100 codes a day. Full admins keep
// the limits above. Every batch is audited and mailed as a security alert.
const SUB_ADMIN_MAX_DURATION_DAYS = 365;
const SUB_ADMIN_CODES_PER_DAY = 100;

export default async function handler(req, res) {
  // Full admins pass; a sub-admin needs the same capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_comped_access');
  if (!roleContext) return;
  const { isAdmin, email, userId } = roleContext;

  if (req.method === 'GET') {
    const codes = await listPromoCodes();
    return res.status(200).json({ codes });
  }

  if (req.method === 'POST') {
    const { quantity, durationDays, note } = req.body || {};
    const q = parseInt(quantity, 10);
    const d = parseInt(durationDays, 10);

    if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be between 1 and ${MAX_QUANTITY}.` });
    }
    if (!Number.isInteger(d) || d < 1 || d > MAX_DURATION_DAYS) {
      return res.status(400).json({ error: `durationDays must be between 1 and ${MAX_DURATION_DAYS}.` });
    }
    if (!isAdmin) {
      if (d > SUB_ADMIN_MAX_DURATION_DAYS) {
        return res.status(403).json({ error: `Codes you make can give up to ${SUB_ADMIN_MAX_DURATION_DAYS} days. A full admin can make longer ones.` });
      }
      if (!(await consumeRateBudget(`promo-codes:${userId}`, q, SUB_ADMIN_CODES_PER_DAY, 86400))) {
        res.setHeader('Retry-After', '3600');
        return res.status(429).json({ error: `That’s more than ${SUB_ADMIN_CODES_PER_DAY} codes for one day. Ask a full admin, or try again tomorrow.` });
      }
    }

    // Every batch on the record and in the studio's inbox (security fixes,
    // 2026-11-15), a part-made one too.
    const told = async (count) => {
      if (!(count > 0)) return;
      const who = email || userId || 'unknown';
      const cleanNote = typeof note === 'string' ? note.trim().slice(0, 120) : '';
      const line = `${count} code${count === 1 ? '' : 's'} of ${d} day${d === 1 ? '' : 's'}`;
      await recordAudit({
        adminId: userId,
        adminEmail: email || null,
        action: 'promo_codes_created',
        targetType: 'promo_codes',
        targetId: null,
        // Read as it stands on Admin → Audit log.
        details: `${line} · ${isAdmin ? 'full admin' : 'sub-admin'}${cleanNote ? ` · “${cleanNote}”` : ''}`
      });
      await securityAlert(`Promo codes made: ${line}`, [
        `By: ${who}${isAdmin ? ' (full admin)' : ' (sub-admin)'}`,
        `Codes: ${count}, each ${d} day${d === 1 ? '' : 's'} of access`,
        cleanNote ? `Note: ${cleanNote}` : null,
        'Admin → Promo codes lists every code and who redeemed it.'
      ]);
    };
    try {
      const codes = await generatePromoCodes({ quantity: q, durationDays: d, note, createdBy: email });
      await told(codes.length);
      return res.status(200).json({ codes });
    } catch (err) {
      console.error('generatePromoCodes error:', err.message);
      await told(Array.isArray(err.created) ? err.created.length : 0);
      return res.status(500).json({ error: 'Could not generate codes. Try again.' });
    }
  }

  if (req.method === 'PATCH') {
    const { id, noted } = req.body || {};
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'id is required.' });
    }
    try {
      const code = await setPromoCodeNoted(id, noted);
      return res.status(200).json({ code });
    } catch (err) {
      console.error('setPromoCodeNoted error:', err.message);
      return res.status(500).json({ error: 'Could not update that code. Try again.' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}
