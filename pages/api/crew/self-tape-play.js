import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl, signedSrcForStoredUrl } from '../../../lib/cloudflareUpload';
import { applyCors } from '../../../lib/cors';
import { checkVideoOwnership } from '../../../lib/videoOwnership';

// A signed playback URL for an uploaded self-tape (migration 106). Only
// the call's poster, the performer who sent it, or an admin can open it.
//   GET ?callId=&responseId= → { url, expiresAt }
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
  if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
  const callId = String(req.query.callId || '');
  const responseId = String(req.query.responseId || '');
  if (!/^[0-9a-f-]{36}$/i.test(callId) || !/^[0-9a-f-]{36}$/i.test(responseId)) return res.status(404).json({ error: 'Not found.' });
  const { data: r } = await getSupabase().from('crew_responses').select('id, user_id, self_tape_uid, crew_calls!inner(poster_id)').eq('id', responseId).eq('call_id', callId).maybeSingle();
  if (!r || !r.self_tape_uid) return res.status(404).json({ error: 'No uploaded tape on that response.' });
  if (!account.isAdmin && account.userId !== r.user_id && account.userId !== r.crew_calls.poster_id) return res.status(403).json({ error: 'The tape is for the poster.' });
  // Belt and braces (security round, 2026-10-26): sign only a video the
  // performer uploaded themselves. lib/crewCalls.js refuses anything else
  // on the way in; this keeps a row written before that check harmless.
  const owned = await checkVideoOwnership(r.self_tape_uid, { userId: r.user_id, allowUntagged: false });
  if (!owned.ok) return res.status(404).json({ error: 'No uploaded tape on that response.' });
  const signed = await signedSrcForStoredUrl(cloudflarePlaybackUrl(r.self_tape_uid), { expiresInSeconds: 2 * 3600 });
  const url = signed ? signed.src : cloudflarePlaybackUrl(r.self_tape_uid);
  if (!url) return res.status(503).json({ error: 'Video playback isn’t configured.' });
  return res.status(200).json({ url, expiresAt: signed ? signed.expiresAt : null });
}
