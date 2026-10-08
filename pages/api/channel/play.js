import { getChannelNow } from '../../../lib/channelEngine';
import { resolvePublicChannel } from '../../../lib/channelRequest';
import { getSupabase } from '../../../lib/supabase';
import { getAccountContext } from '../../../lib/accountContext';
import { getOwnProfile } from '../../../lib/userProfiles';
import { meetsAgeRequirement } from '../../../lib/ageGate';
import { getRatings } from '../../../lib/ratings';
import { signedSrcForStoredUrl } from '../../../lib/videoSigning';

// Hands one viewer a playable URL for whatever is airing on a channel right
// now — and only that. This is what lets premium titles air on channels
// (with ads) without opening them up anywhere else: the token is minted
// only for the program on air at this moment and expires shortly after it
// ends. The request only says WHICH channel; what to play is decided here.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const channel = await resolvePublicChannel((req.body || {}).channel);
  if (!channel) return res.status(404).json({ error: 'No such channel.' });

  const now = await getChannelNow(channel, new Date());
  if (now.live) return res.status(200).json({ kind: 'live', src: now.live.playbackUrl });
  if (!now.onAir || !now.program) return res.status(200).json({ kind: 'off_air' });
  const program = now.program;
  if (program.kind !== 'episode' && program.kind !== 'media') {
    return res.status(200).json({ kind: program.kind, key: program.key });
  }

  const supabase = getSupabase();
  let storedSrc = null;
  if (program.kind === 'episode') {
    const account = await getAccountContext(req);
    if (!account.isAdmin) {
      const profile = account.isSignedIn ? await getOwnProfile(account.userId) : null;
      const age = profile && profile.age != null ? profile.age : null;
      const ratings = await getRatings();
      if (age != null) {
        // An age on file is checked for real.
        if (!meetsAgeRequirement(age, program.rating, ratings)) {
          return res.status(200).json({ kind: 'age_restricted', key: program.key, rating: program.rating || 'Not Rated', signedIn: account.isSignedIn });
        }
      } else if (!meetsAgeRequirement(null, program.rating, ratings) && !(req.body || {}).liveTerms) {
        // No age on file (signed out, or never set): live TV is open to
        // everyone, ads included, once they take the live TV terms, which
        // say the ratings shown are theirs to honour. The player remembers
        // the acceptance and sends it as liveTerms.
        return res.status(200).json({ kind: 'terms_required', key: program.key, rating: program.rating || 'Not Rated', signedIn: account.isSignedIn });
      }
    }
    const { data } = await supabase.from('episodes').select('src').eq('id', program.episodeId).maybeSingle();
    storedSrc = data ? data.src : null;
  } else {
    const { data } = await supabase.from('channel_media').select('src').eq('id', program.mediaId).maybeSingle();
    storedSrc = data ? data.src : null;
  }
  if (!storedSrc) return res.status(200).json({ kind: 'unavailable', key: program.key });

  const remaining = Math.max(60, Math.ceil(program.durationSeconds - program.offsetSeconds));
  const signed = await signedSrcForStoredUrl(storedSrc, { expiresInSeconds: remaining + 15 * 60 });
  return res.status(200).json({
    kind: program.kind,
    key: program.key,
    src: signed ? signed.src : storedSrc,
    offsetSeconds: program.offsetSeconds,
    durationSeconds: program.durationSeconds,
    serverTime: now.serverTime
  });
}
