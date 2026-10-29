import { getAuth } from '@clerk/nextjs/server';
import { findPost } from '../../../../lib/posts';
import { downloadPrivate, isPrivateRef } from '../../../../lib/privateStorage';
import { IMAGE_TYPES } from '../../../../lib/imageCap';
import { limitPublicRead } from '../../../../lib/rateLimit';
import { assertNotSuspended } from '../../../../lib/suspensions';
import { sendError } from '../../../../lib/apiErrors';

// A Snippet's photo (?kind=photo) or a video post's cover (?kind=cover),
// the way every page and the app load them since 2026-10-29: the file
// lives in the private bucket (lib/privateStorage.js) as a copy capped
// to 1600px with no EXIF (lib/imageCap.js), and this route hands the
// bytes out itself, so the image never sits at a permanent public
// address, every answer carries the site's no-AI headers (middleware.js),
// and a visitor has a ceiling on how many they can pull. A post's media
// never changes (edits are caption-only), so the viewer's own browser may
// keep it a day; `private` keeps it out of shared caches. An image still
// at a public URL (uploaded before the move on the Protection card) is
// sent on to where it is.
const MAX_PER_HOUR = 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const kind = req.query.kind === 'cover' || req.query.kind === 'photo' ? req.query.kind : null;
  if (!id || !kind) return res.status(400).json({ error: 'kind must be photo or cover.' });

  const { userId } = getAuth(req);
  if (!(await limitPublicRead(req, res, 'post-media', { max: MAX_PER_HOUR, windowSeconds: 3600, userId }))) return undefined;

  try {
    // Free to look at, except for a suspended account asking with its own
    // session (the same rule as the playback gate).
    if (userId) await assertNotSuspended(userId, 'all');
    const post = await findPost(id);
    const stored = post ? (kind === 'cover' ? post.thumbnailRef : post.imageRef) : null;
    if (!stored) return res.status(404).json({ error: 'Not found.' });
    if (!isPrivateRef(stored)) {
      if (!/^https?:\/\//.test(stored)) return res.status(404).json({ error: 'Not found.' });
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Location', stored);
      return res.status(302).end();
    }
    const buffer = await downloadPrivate(stored);
    if (!buffer) return res.status(404).json({ error: 'Not found.' });
    const ext = (stored.split('.').pop() || '').toLowerCase();
    res.setHeader('Content-Type', IMAGE_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(buffer);
  } catch (err) {
    // The flag the app's gate looks for on every 403 (mobile/src/lib/api.js).
    if (err && err.suspended) return res.status(403).json({ error: err.message, suspended: true });
    return sendError(res, err, 'posts/media', 'Could not open the image.');
  }
}
