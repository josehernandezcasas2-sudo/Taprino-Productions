import { getRoleContext } from '../../../../lib/roles';
import { getSupabase } from '../../../../lib/supabase';
import { createLiveInput } from '../../../../lib/cloudflareLive';
import { recordAudit } from '../../../../lib/auditLog';

// Creates the Cloudflare live input and the corresponding live_streams row
// in status 'idle'. Nothing is visible to viewers yet — that only happens
// once the admin explicitly hits "go live" after confirming their encoder
// is actually connected. See pages/api/admin/live/go-live.js.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { title, description, genre, adsEnabled, adBreakSeconds } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Give the stream a title.' });
  }

  let liveInput;
  try {
    liveInput = await createLiveInput({ name: title.trim() });
  } catch (err) {
    console.error('live/create error:', err.message);
    return res.status(502).json({ error: err.message });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('live_streams')
    .insert({
      title: title.trim(),
      description: description ? description.trim() : null,
      genre: genre || null,
      cloudflare_uid: liveInput.uid,
      ads_enabled: adsEnabled !== false,
      ad_break_seconds: adBreakSeconds ? Math.max(120, Number(adBreakSeconds)) : 600,
      created_by: userId
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'create_live_stream',
    targetType: 'live_stream',
    targetId: data.id,
    details: data.title
  });

  return res.status(200).json({
    stream: data,
    rtmpsUrl: liveInput.rtmpsUrl,
    rtmpsStreamKey: liveInput.rtmpsStreamKey
  });
}
