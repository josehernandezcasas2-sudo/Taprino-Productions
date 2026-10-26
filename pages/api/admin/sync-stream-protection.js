import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl, enableSignedUrlsForVideo, fetchCloudflareThumbnail } from '../../../lib/cloudflareUpload';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordAudit } from '../../../lib/auditLog';

// Turns requireSignedURLs on for every Cloudflare Stream video attached
// to an episode, whatever its tier (lib/streamProtection.js has the
// reasoning; Jose, 2026-10-25), and since batch 3 for every Film
// University lesson and example video too. Run from the Protection card
// on /admin/settings after the change ships, and any time a video was
// attached while Cloudflare was unreachable. Safe to run as often as you
// like: setting a flag to the value it already has is a no-op.
//
// It also reports episodes whose poster or thumbnail still points at
// Cloudflare's own frame grab: once a video demands signed URLs, that
// image URL stops working, so those titles need a real poster uploaded.
// University rows with such a thumbnail are fixed here instead: the
// frame is fetched once through a signed token and stored as an ordinary
// JPG (the same thing saving a lesson does since batch 3).
const CLOUDFLARE_FRAME = /cloudflarestream\.com\/[^/]+\/thumbnails\//;

function isMissingTable(error) {
  return Boolean(error && (error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message || '')));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    return res.status(400).json({
      error: 'Cloudflare Stream is not configured — add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.'
    });
  }

  const supabase = getSupabase();
  const { data: episodes, error } = await supabase.from('episodes').select('id, title, tier, src, audio_description_src, poster, thumbnail');
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const protectedIds = [];
  const skipped = [];
  const failures = [];
  const cloudflarePosters = [];
  const seen = new Set();

  for (const ep of episodes || []) {
    const uids = [ep.src, ep.audio_description_src].map((u) => cloudflareUidFromUrl(u)).filter(Boolean);
    if (!uids.length) {
      // Self-hosted mp4, YouTube-backed, or no video attached yet — there's
      // nothing on Cloudflare to protect.
      skipped.push({ id: ep.id, title: ep.title, reason: 'not a Cloudflare Stream video' });
    }
    for (const uid of uids) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      try {
        await enableSignedUrlsForVideo(uid);
        if (!protectedIds.includes(ep.id)) protectedIds.push(ep.id);
      } catch (err) {
        failures.push({ id: ep.id, title: ep.title, error: err.message });
      }
    }
    if (CLOUDFLARE_FRAME.test(`${ep.poster || ''} ${ep.thumbnail || ''}`)) {
      cloudflarePosters.push({ id: ep.id, title: ep.title });
    }
  }

  // Film University: lessons and example clips (migrations 078/081).
  const university = { videos: 0, framesReplaced: 0, failures: [] };
  for (const table of ['uni_lessons', 'uni_files']) {
    const { data: rows, error: uniError } = await supabase.from(table).select('id, title, video_src, thumbnail_url').not('video_src', 'is', null);
    if (uniError) {
      if (!isMissingTable(uniError)) university.failures.push({ id: table, title: table, error: uniError.message });
      continue;
    }
    for (const row of rows || []) {
      const uid = cloudflareUidFromUrl(row.video_src);
      if (!uid) continue;
      if (!seen.has(uid)) {
        seen.add(uid);
        try {
          await enableSignedUrlsForVideo(uid);
          university.videos += 1;
        } catch (err) {
          university.failures.push({ id: row.id, title: row.title, error: err.message });
          continue;
        }
      }
      if (CLOUDFLARE_FRAME.test(row.thumbnail_url || '')) {
        try {
          const frame = await fetchCloudflareThumbnail(uid);
          if (!frame) throw new Error('no frame available yet');
          const stored = await uploadArtworkImage({ base64: frame.toString('base64'), fileName: 'frame.jpg', pathPrefix: `university-frame-${row.id}` });
          const { error: updateError } = await supabase.from(table).update({ thumbnail_url: stored }).eq('id', row.id);
          if (updateError) throw new Error(updateError.message);
          university.framesReplaced += 1;
        } catch (err) {
          university.failures.push({ id: row.id, title: row.title, error: `thumbnail: ${err.message}` });
        }
      }
    }
  }

  // Snippet videos (posts) and casting self-tapes (security round,
  // 2026-10-26): both were left out until now. A post with no thumbnail
  // of its own gets its frame stored, since the page no longer falls
  // back to Cloudflare's.
  const extra = { posts: 0, framesStored: 0, tapes: 0, failures: [] };
  const { data: postRows, error: postError } = await supabase.from('posts').select('id, caption, video_uid, thumbnail_url').eq('kind', 'video').not('video_uid', 'is', null);
  if (postError && !isMissingTable(postError)) extra.failures.push({ id: 'posts', title: 'posts', error: postError.message });
  for (const row of postRows || []) {
    const uid = row.video_uid;
    if (!seen.has(uid)) {
      seen.add(uid);
      try {
        await enableSignedUrlsForVideo(uid);
        extra.posts += 1;
      } catch (err) {
        extra.failures.push({ id: row.id, title: row.caption || row.id, error: err.message });
        continue;
      }
    }
    if (!row.thumbnail_url || CLOUDFLARE_FRAME.test(row.thumbnail_url)) {
      try {
        const frame = await fetchCloudflareThumbnail(uid);
        if (!frame) throw new Error('no frame available yet');
        const stored = await uploadArtworkImage({ base64: frame.toString('base64'), fileName: 'frame.jpg', pathPrefix: `post-frame-${row.id}` });
        const { error: updateError } = await supabase.from('posts').update({ thumbnail_url: stored }).eq('id', row.id);
        if (updateError) throw new Error(updateError.message);
        extra.framesStored += 1;
      } catch (err) {
        extra.failures.push({ id: row.id, title: row.caption || row.id, error: `thumbnail: ${err.message}` });
      }
    }
  }
  const { data: tapeRows, error: tapeError } = await supabase.from('crew_responses').select('id, self_tape_uid').not('self_tape_uid', 'is', null);
  if (tapeError && !isMissingTable(tapeError) && !/self_tape_uid/.test(tapeError.message || '')) extra.failures.push({ id: 'crew_responses', title: 'self-tapes', error: tapeError.message });
  for (const row of tapeRows || []) {
    if (seen.has(row.self_tape_uid)) continue;
    seen.add(row.self_tape_uid);
    try {
      await enableSignedUrlsForVideo(row.self_tape_uid);
      extra.tapes += 1;
    } catch (err) {
      extra.failures.push({ id: row.id, title: 'self-tape', error: err.message });
    }
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'sync_stream_protection',
    targetType: 'episode',
    targetId: 'all',
    details: `Protected ${protectedIds.length} episodes (${seen.size} videos incl. ${university.videos} University, ${extra.posts} snippets, ${extra.tapes} self-tapes), ${skipped.length} without Cloudflare video, ${failures.length + university.failures.length + extra.failures.length} failed, ${cloudflarePosters.length} with a Cloudflare frame as poster, ${university.framesReplaced + extra.framesStored} frames stored.`
  });

  return res.status(200).json({
    protected: protectedIds.length,
    videos: seen.size,
    skipped: skipped.length,
    failures,
    cloudflarePosters,
    university,
    extra
  });
}
