import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl, cloudflarePlaybackUrl } from '../../../lib/cloudflareUpload';
import { recordAudit } from '../../../lib/auditLog';

// Repairs playback URLs that were written to the database while
// CLOUDFLARE_STREAM_CUSTOMER_CODE held the wrong value (the full subdomain
// instead of just the code), producing doubled URLs like:
//
//   customer-customer-CODE.cloudflarestream.com.cloudflarestream.com/UID/...
//
// Fixing the environment variable alone does NOT fix these — the malformed
// string is already baked into each row's `src` column, and only affects
// rows written during that window. This walks every episode, pulls the
// video UID back out of whatever URL is stored (the UID survives the
// malformation intact, which is what makes automatic repair possible at
// all), and rewrites the URL correctly using the current env var.
//
// Safe to run repeatedly: a row whose URL is already correct rebuilds to
// the identical string and is skipped rather than rewritten.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const code = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  if (!code) {
    return res.status(400).json({ error: 'CLOUDFLARE_STREAM_CUSTOMER_CODE is not set.' });
  }
  // Guard against running this while the env var is STILL wrong — otherwise
  // it would cheerfully rewrite every row to a different flavour of broken.
  if (code.includes('.') || code.includes('customer-') || code.includes('http')) {
    return res.status(400).json({
      error: `CLOUDFLARE_STREAM_CUSTOMER_CODE looks wrong — it should be just the code (e.g. "6lw3ib81r72mjyar"), not a full subdomain or URL. Fix it in Vercel and redeploy before running this.`
    });
  }

  const supabase = getSupabase();
  const { data: episodes, error } = await supabase
    .from('episodes')
    .select('id, title, src, audio_description_src, trailer_src');
  if (error) return res.status(500).json({ error: error.message });

  const repaired = [];
  const skipped = [];
  const unrecoverable = [];

  for (const ep of episodes || []) {
    // Only Cloudflare Stream URLs are in scope — a self-hosted mp4 or a
    // YouTube-backed episode has nothing to repair.
    if (!ep.src || !ep.src.includes('cloudflarestream.com')) {
      skipped.push(ep.id);
      continue;
    }

    const uid = cloudflareUidFromUrl(ep.src);
    if (!uid) {
      unrecoverable.push({ id: ep.id, title: ep.title, src: ep.src });
      continue;
    }

    const correct = cloudflarePlaybackUrl(uid);
    if (!correct || correct === ep.src) {
      skipped.push(ep.id);
      continue;
    }

    const update = { src: correct };

    // The described-audio and trailer URLs were built by the same helper,
    // so they'd have been malformed in exactly the same way.
    if (ep.audio_description_src && ep.audio_description_src.includes('cloudflarestream.com')) {
      const adUid = cloudflareUidFromUrl(ep.audio_description_src);
      if (adUid) update.audio_description_src = cloudflarePlaybackUrl(adUid);
    }
    if (ep.trailer_src && ep.trailer_src.includes('cloudflarestream.com')) {
      const trUid = cloudflareUidFromUrl(ep.trailer_src);
      if (trUid) update.trailer_src = cloudflarePlaybackUrl(trUid);
    }

    const { error: updateError } = await supabase.from('episodes').update(update).eq('id', ep.id);
    if (updateError) {
      unrecoverable.push({ id: ep.id, title: ep.title, error: updateError.message });
    } else {
      repaired.push({ id: ep.id, title: ep.title, from: ep.src, to: correct });
    }
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'repair_playback_urls',
    targetType: 'episode',
    targetId: 'all',
    details: `Repaired ${repaired.length}, skipped ${skipped.length}, failed ${unrecoverable.length}.`
  });

  return res.status(200).json({
    repaired: repaired.length,
    skipped: skipped.length,
    unrecoverable,
    details: repaired
  });
}
