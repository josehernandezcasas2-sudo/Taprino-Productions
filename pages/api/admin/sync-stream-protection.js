import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import {
  cloudflareUidFromUrl,
  enableSignedUrlsForVideo,
  disableSignedUrlsForVideo
} from '../../../lib/cloudflareUpload';
import { recordAudit } from '../../../lib/auditLog';

// Brings Cloudflare's protection flags in line with the tier column in the
// database: every premium episode gets requireSignedURLs on, every free one
// gets it off.
//
// Both directions matter. Protecting premium video is the obvious half. The
// other half is just as important operationally — an episode moved back down
// to the free tier with protection still on plays as a black box for every
// free viewer, and that failure is silent.
//
// Safe to run as often as you like: Cloudflare treats setting a flag to the
// value it already has as a no-op. Run it after changing any episode's tier.
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
  const { data: episodes, error } = await supabase.from('episodes').select('id, title, tier, src');
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const protectedIds = [];
  const unprotectedIds = [];
  const skipped = [];
  const failures = [];

  for (const ep of episodes || []) {
    const uid = cloudflareUidFromUrl(ep.src);
    if (!uid) {
      // Self-hosted mp4, YouTube-backed, or no video attached yet — there's
      // nothing on Cloudflare to protect.
      skipped.push({ id: ep.id, title: ep.title, reason: 'not a Cloudflare Stream video' });
      continue;
    }
    try {
      if (ep.tier === 'premium') {
        await enableSignedUrlsForVideo(uid);
        protectedIds.push(ep.id);
      } else {
        await disableSignedUrlsForVideo(uid);
        unprotectedIds.push(ep.id);
      }
    } catch (err) {
      failures.push({ id: ep.id, title: ep.title, error: err.message });
    }
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'sync_stream_protection',
    targetType: 'episode',
    targetId: 'all',
    details: `Protected ${protectedIds.length} premium, unprotected ${unprotectedIds.length} free, ${failures.length} failed.`
  });

  return res.status(200).json({
    protected: protectedIds.length,
    unprotected: unprotectedIds.length,
    skipped: skipped.length,
    failures
  });
}
