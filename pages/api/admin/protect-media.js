import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { moveCaptionsToPrivate, lockUniversityBucket, movePostMediaToPrivate } from '../../../lib/protectMedia';
import { sendError } from '../../../lib/apiErrors';

// The Protection card's other buttons (components/admin/SiteSettingsPanel.js):
// `what: 'captions'` moves every caption track still at a public URL into
// the private bucket; `what: 'university'` makes the Film University
// bucket private; `what: 'posts'` moves every Snippet photo and cover
// into the private bucket as a capped copy (2026-10-29). All are safe to
// press again (lib/protectMedia.js).
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
    if (what === 'posts') {
      const result = await movePostMediaToPrivate();
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: 'protect_post_media',
        targetType: 'post',
        targetId: 'all',
        details: `Moved ${result.moved} Snippet photos and covers to private storage (${result.resized} brought down to 1600px); ${result.alreadyPrivate} already private, ${result.skipped.length} not in our storage, ${result.failures.length} failed.`
      });
      return res.status(200).json({ what, ...result });
    }
    return res.status(400).json({ error: 'what must be captions, university or posts.' });
  } catch (err) {
    console.error('protect-media error:', err.message);
    return sendError(res, err, 'admin/protect-media', 'Could not finish.');
  }
}
