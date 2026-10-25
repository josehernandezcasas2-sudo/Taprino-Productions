import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl, enableSignedUrlsForVideo } from '../../../lib/cloudflareUpload';
import { recordAudit } from '../../../lib/auditLog';

// Turns requireSignedURLs on for every Cloudflare Stream video attached
// to an episode, whatever its tier (lib/streamProtection.js has the
// reasoning; Jose, 2026-10-25). Run from the Protection card on
// /admin/settings after the change ships, and any time a video was
// attached while Cloudflare was unreachable. Safe to run as often as you
// like: setting a flag to the value it already has is a no-op.
//
// It also reports episodes whose poster or thumbnail still points at
// Cloudflare's own frame grab: once a video demands signed URLs, that
// image URL stops working, so those titles need a real poster uploaded.
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
    if (/cloudflarestream\.com\/[^/]+\/thumbnails\//.test(`${ep.poster || ''} ${ep.thumbnail || ''}`)) {
      cloudflarePosters.push({ id: ep.id, title: ep.title });
    }
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'sync_stream_protection',
    targetType: 'episode',
    targetId: 'all',
    details: `Protected ${protectedIds.length} episodes (${seen.size} videos), ${skipped.length} without Cloudflare video, ${failures.length} failed, ${cloudflarePosters.length} with a Cloudflare frame as poster.`
  });

  return res.status(200).json({
    protected: protectedIds.length,
    videos: seen.size,
    skipped: skipped.length,
    failures,
    cloudflarePosters
  });
}
