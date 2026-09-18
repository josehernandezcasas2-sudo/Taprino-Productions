import { getRoleContext } from '../../../lib/roles';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordAudit } from '../../../lib/auditLog';
import { getAllAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement } from '../../../lib/announcements';

// Same 10mb bump as every other image-upload endpoint in this app —
// default Next.js body limit (1mb) is smaller than a base64-encoded
// image on its own for any normally-sized upload.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    const announcements = await getAllAnnouncements();
    return res.status(200).json({ announcements });
  }

  if (req.method === 'POST') {
    const { title, body, imageBase64, imageFileName, linkUrl } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }

    let imageUrl = null;
    try {
      imageUrl = await uploadArtworkImage({
        base64: imageBase64,
        fileName: imageFileName,
        pathPrefix: `announcement-${Date.now().toString(36)}`
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const announcement = await createAnnouncement({ title, body, imageUrl, linkUrl, createdBy: email || userId });
      await recordAudit({ adminId: userId, adminEmail: email, action: 'create_announcement', targetType: 'announcement', targetId: announcement.id, details: title });
      return res.status(200).json({ announcement });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id, title, body, imageBase64, imageFileName, removeImage, linkUrl, isActive, sortOrder } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });

    let imageUrl;
    if (removeImage) {
      // Orphans the old file in storage rather than deleting it outright —
      // same "log, don't hard-delete" pattern used elsewhere for artwork,
      // so a mistaken removal is recoverable by an admin who notices.
      imageUrl = null;
    } else if (imageBase64) {
      try {
        imageUrl = await uploadArtworkImage({
          base64: imageBase64,
          fileName: imageFileName,
          pathPrefix: `announcement-${id}-${Date.now().toString(36)}`
        });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    try {
      const announcement = await updateAnnouncement(id, { title, body, imageUrl, linkUrl, isActive, sortOrder });
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: isActive === false ? 'deactivate_announcement' : isActive === true ? 'activate_announcement' : 'update_announcement',
        targetType: 'announcement',
        targetId: id,
        details: title || undefined
      });
      return res.status(200).json({ announcement });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });

    try {
      await deleteAnnouncement(id);
      await recordAudit({ adminId: userId, adminEmail: email, action: 'delete_announcement', targetType: 'announcement', targetId: id });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
