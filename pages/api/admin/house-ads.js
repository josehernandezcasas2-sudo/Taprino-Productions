import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadHouseAdVideo } from '../../../lib/houseAdUpload';
import { getCloudflareVideoStatus, ensureCloudflareDownloadUrl } from '../../../lib/cloudflareUpload';
import { recordAudit } from '../../../lib/auditLog';

export const config = {
  api: { bodyParser: { sizeLimit: '11mb' } } // 8MB direct-upload video cap, plus base64/JSON overhead
};

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('house_ads').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ads: data || [] });
  }

  if (req.method === 'POST') {
    const { title, advertiser, clickUrl, durationSeconds, width, height, videoBase64, videoFileName, cloudflareUid } = req.body || {};

    if (!title || !title.trim()) return res.status(400).json({ error: 'Give the ad a title.' });
    if (!clickUrl || !clickUrl.trim()) return res.status(400).json({ error: 'Where should a click send people?' });
    try {
      // eslint-disable-next-line no-new
      new URL(clickUrl.trim());
    } catch (err) {
      return res.status(400).json({ error: 'That click-through link doesn\u2019t look like a valid URL.' });
    }
    if (!videoBase64 && !cloudflareUid) {
      return res.status(400).json({ error: 'Choose a video for this ad.' });
    }

    let videoUrl;
    let resolvedDuration = durationSeconds ? Number(durationSeconds) : null;

    if (cloudflareUid) {
      // SECURITY: re-verify against Cloudflare directly rather than
      // trusting a client-supplied URL. The browser only ever learned a
      // uid and polled a status endpoint for it — the actual playable URL
      // is looked up fresh here, so there's no way a crafted request could
      // point a house ad at an arbitrary external file.
      const videoStatus = await getCloudflareVideoStatus(cloudflareUid);
      if (!videoStatus || !videoStatus.readyToStream) {
        return res.status(400).json({ error: 'That video isn\u2019t finished processing yet — wait for it to say "ready" before submitting.' });
      }
      const download = await ensureCloudflareDownloadUrl(cloudflareUid);
      if (download.status !== 'ready' || !download.url) {
        return res.status(400).json({ error: 'The downloadable version of that video isn\u2019t ready yet — give it another moment.' });
      }
      videoUrl = download.url;
      if (!resolvedDuration && videoStatus.duration) resolvedDuration = videoStatus.duration;
    } else {
      try {
        const uploaded = await uploadHouseAdVideo({ base64: videoBase64, fileName: videoFileName });
        videoUrl = uploaded.url;
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (!resolvedDuration || resolvedDuration <= 0) {
      return res.status(400).json({ error: 'Enter the clip\u2019s real duration in seconds — this has to match the actual video or players will cut it off or leave it hanging.' });
    }

    const { data, error } = await supabase
      .from('house_ads')
      .insert({
        title: title.trim(),
        advertiser: advertiser ? advertiser.trim() : null,
        video_url: videoUrl,
        cloudflare_uid: cloudflareUid || null,
        click_url: clickUrl.trim(),
        duration_seconds: resolvedDuration,
        width: width ? Number(width) : 1280,
        height: height ? Number(height) : 720,
        created_by: userId
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'create_house_ad',
      targetType: 'house_ad',
      targetId: data.id,
      details: data.title
    });

    return res.status(200).json({ ad: data });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
