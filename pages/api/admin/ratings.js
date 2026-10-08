import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { getRatings, saveRating, deleteRating } from '../../../lib/ratings';

// Admin: the content ratings list (/admin/ratings).
//   GET                                       every rating, fresh
//   POST   { code, label?, minAge?, imageBase64?, imageFileName?, clearImage? }
//          adds a custom rating or updates one (standard ratings: image only)
//   DELETE { code }                           removes a custom rating
// Images arrive as base64 data URLs, like the icon uploads, so the body
// limit is raised the same way.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  const body = req.body || {};
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ratings: await getRatings({ fresh: true }) });
    }
    if (req.method === 'POST') {
      const saved = await saveRating(body);
      await recordAudit({ adminId: userId, adminEmail: email, action: 'save_content_rating', targetType: 'content_rating', targetId: saved.code, details: saved.imageUrl || (body.clearImage ? 'image cleared' : 'details') });
      return res.status(200).json({ rating: saved });
    }
    if (req.method === 'DELETE') {
      if (!body.code) return res.status(400).json({ error: 'code is required.' });
      await deleteRating(String(body.code));
      await recordAudit({ adminId: userId, adminEmail: email, action: 'delete_content_rating', targetType: 'content_rating', targetId: String(body.code), details: 'custom rating removed' });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' });
  }
}
