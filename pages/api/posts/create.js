import { getRoleContext } from '../../../lib/roles';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { cloudflarePlaybackUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { createPost } from '../../../lib/posts';

// Small photo, same as episode poster/thumbnail uploads — this rides in
// the JSON body as a base64 data URL rather than a real multipart upload.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

const MAX_VIDEO_SECONDS = 5 * 60;
const MAX_CAPTION_LENGTH = 2200;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isAdmin } = await getRoleContext(req);
  // Admin-only while this is still being tried out — see the "+" button's
  // own admin gate in components/MobileTabBar.js.
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'create-post'), 30, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many posts — please wait a bit and try again.' });
  }

  const body = req.body || {};
  const kind = body.kind === 'video' ? 'video' : 'post';
  const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, MAX_CAPTION_LENGTH) : '';

  if (kind === 'post') {
    if (!caption && !body.imageBase64) {
      return res.status(400).json({ error: 'Add a caption or a photo.' });
    }
    let imageUrl = null;
    try {
      imageUrl = await uploadArtworkImage({
        base64: body.imageBase64,
        fileName: body.imageFileName,
        pathPrefix: `post-${userId}-${Date.now().toString(36)}`
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const id = await createPost({ userId, kind: 'post', caption, imageUrl });
    return res.status(200).json({ ok: true, id, kind: 'post' });
  }

  // kind === 'video'
  if (!body.videoUid) {
    return res.status(400).json({ error: 'No video was uploaded.' });
  }
  const src = cloudflarePlaybackUrl(body.videoUid);
  if (!src) {
    return res.status(500).json({ error: 'Could not resolve the uploaded video — is Cloudflare Stream fully configured?' });
  }

  // Optional — without one, lib/posts.js falls back to whichever frame
  // Cloudflare happened to grab from the video itself, same as before
  // this existed.
  let thumbnailUrl = null;
  if (body.thumbnailBase64) {
    try {
      thumbnailUrl = await uploadArtworkImage({
        base64: body.thumbnailBase64,
        fileName: body.thumbnailFileName,
        pathPrefix: `post-thumb-${userId}-${Date.now().toString(36)}`
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // The client already measured duration before starting the upload (see
  // CreatePostModal), but that's a value from the browser, not proof. When
  // Cloudflare has already finished processing enough to report its own
  // duration, that number wins over the client's.
  let durationSeconds = typeof body.durationSeconds === 'number' ? body.durationSeconds : null;
  const status = await getCloudflareVideoStatus(body.videoUid);
  if (status && typeof status.duration === 'number') {
    durationSeconds = status.duration;
  }
  if (durationSeconds && durationSeconds > MAX_VIDEO_SECONDS) {
    return res.status(400).json({ error: 'Videos are limited to 5 minutes.' });
  }

  const id = await createPost({
    userId,
    kind: 'video',
    caption,
    videoUid: body.videoUid,
    videoSrc: src,
    thumbnailUrl,
    durationSeconds
  });
  return res.status(200).json({ ok: true, id, kind: 'video' });
}
