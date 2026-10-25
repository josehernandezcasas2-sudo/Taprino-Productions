import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { moveCaptionsToPrivate, lockUniversityBucket } from '../../../lib/protectMedia';

// The Protection card's other two buttons (components/admin/SiteSettingsPanel.js):
// `what: 'captions'` moves every caption track still at a public URL into
// the private bucket; `what: 'university'` makes the Film University
// bucket private. Both are safe to press again (lib/protectMedia.js).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  const what = req.body && req.body.what;
  try {
    if (what === 'captions') {
      const result = await moveCaptionsToPrivate();
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: 'protect_captions',
        targetType: 'episode',
        targetId: 'all',
        details: `Moved ${result.moved} caption tracks to private storage; ${result.alreadyPrivate} already private, ${result.skipped.length} not in our storage, ${result.failures.length} failed.`
      });
      return res.status(200).json({ what, ...result });
    }
    if (what === 'university') {
      const result = await lockUniversityBucket();
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: 'protect_university_files',
        targetType: 'storage',
        targetId: 'university-docs',
        details: result.wasPublic ? 'The University bucket was public and is now private.' : result.existed ? 'The University bucket was already private.' : 'Created the University bucket private.'
      });
      return res.status(200).json({ what, ...result });
    }
    return res.status(400).json({ error: 'what must be captions or university.' });
  } catch (err) {
    console.error('protect-media error:', err.message);
    return res.status(500).json({ error: err.message || 'Could not finish.' });
  }
}
