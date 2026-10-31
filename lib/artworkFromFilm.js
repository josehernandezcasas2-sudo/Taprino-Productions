import { fetchCloudflareThumbnail } from './cloudflareUpload';
import { uploadArtworkImage } from './artworkUpload';
import { posterFromFrame } from './imageCap';

// SERVER-ONLY. A poster and a still cut from the film itself (the creator
// path, 2026-10-31: "skip them and we cut both from the film"): Cloudflare's
// frame grab, fetched once through a token and stored as ordinary JPGs in
// episode-art; the poster is the frame's 2:3 middle. Fills only what's
// missing. Best effort: null for anything that couldn't be cut (the video
// still processing, Cloudflare unconfigured), never a thrown error — a
// missing poster is the "Missing artwork" flag on Your work.
export async function cutArtworkFromVideo(uid, prefix, { poster = null, thumbnail = null } = {}) {
  if (!uid || (poster && thumbnail)) return { poster, thumbnail, cut: false };
  try {
    const frame = await fetchCloudflareThumbnail(uid);
    if (!frame) return { poster, thumbnail, cut: false };
    const still = thumbnail || await uploadArtworkImage({ base64: `data:image/jpeg;base64,${frame.toString('base64')}`, fileName: 'still.jpg', pathPrefix: `${prefix}-thumbnail` });
    const tall = poster || await uploadArtworkImage({ base64: `data:image/jpeg;base64,${(await posterFromFrame(frame)).toString('base64')}`, fileName: 'poster.jpg', pathPrefix: `${prefix}-poster` });
    return { poster: tall, thumbnail: still, cut: true };
  } catch (err) {
    console.error('cutArtworkFromVideo:', uid, err.message);
    return { poster, thumbnail, cut: false };
  }
}
