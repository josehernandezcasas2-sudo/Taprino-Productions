import { getEpisodePageData } from '../../lib/episodePage';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

// Trim an episode record down to what a card/sidebar needs — and never a
// playable URL. The app gets the real src from POST /api/stream-token,
// which re-checks entitlement (and the age gate) on every call.
// Who uploaded it (submitted_by) stays on the server too (slice 4's
// contract, section 3): the answer names people through `credits`.
function stripPlayable(e) {
  if (!e) return e;
  const { src, audioDescriptionSrc, audioUrl, captionsUrl, captionsRef, transcriptUrl, submittedBy, ...rest } = e;
  return rest;
}

// The episode being viewed keeps its podcast audio URL, captions and
// transcript only when the viewer is entitled to it (same rule as
// pages/episode/[id].js) — the dialogue of a title is not for the lock
// screen, and the stored caption reference never leaves the server.
function stripForViewer(e, entitled) {
  if (!e) return e;
  const out = stripPlayable(e);
  if (entitled && e.audioUrl) out.audioUrl = e.audioUrl;
  if (entitled && e.captionsUrl) out.captionsUrl = e.captionsUrl;
  if (entitled && e.transcriptUrl) out.transcriptUrl = e.transcriptUrl;
  return out;
}

// The mobile app's equivalent of pages/episode/[id].js's getServerSideProps
// — same lib/episodePage.js, so loading this records the view and applies
// the age gate exactly like opening the episode on the website.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await limitPublicRead(req, res, 'episode-page'))) return undefined;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { id } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id is required' });

  // ?preview=1: the owner's private preview of an episode that isn't live
  // (slice 4). Strangers get the same 404 as a missing id.
  const data = await getEpisodePageData(id, req, { preview: req.query.preview === '1' });
  if (data.notFound) return res.status(404).json({ error: 'Not found' });
  if (data.ageRestricted) {
    return res.status(200).json({ ageRestricted: true, termsRequired: Boolean(data.termsRequired), requiredRating: data.requiredRating, requiredAge: data.requiredAge ?? null, isSignedIn: data.isSignedIn });
  }

  // An early screening still locked for this viewer keeps its captions
  // and transcript too, as the web page does (security round, 2026-10-26).
  const earlyLocked = Boolean(data.earlyAccess && data.earlyAccess.locked);
  // A preview is the title's own people: they may watch it unless it is
  // pulled and they aren't the team (preview.canPlay).
  const entitled = data.preview
    ? data.preview.canPlay === true
    : !earlyLocked && (data.episode.tier === 'free' || data.account.isSubscriber || data.account.isAdmin || Boolean(data.purchase && data.purchase.owned));
  return res.status(200).json({
    episode: stripForViewer(data.episode, entitled),
    isSignedIn: data.account.isSignedIn,
    isSubscriber: data.account.isSubscriber,
    adFree: data.account.adFree,
    // Buy to own: the price (or ownership) of this title and its series.
    purchase: data.purchase,
    bundle: data.bundle,
    withdrawn: Boolean(data.withdrawn),
    // Early screenings (lib/earlyAccess.js): { early, locked, opensAt }.
    // /api/stream-token refuses a locked one with earlyAccess: true.
    earlyAccess: data.earlyAccess || null,
    // Tips (lib/tips.js): { enabled, creatorId, creatorName, cutPercent,
    // maxCents, minCents, presets, fiscalSponsor } when the maker can be
    // tipped; { enabled: false } otherwise.
    tipping: data.tipping || null,
    // The maker's "Not for AI training" seal (lib/aiPolicyRules.js).
    aiSeal: data.aiSeal !== false,
    // Where to pick up (seconds), from the same Stripe-held progress the
    // website resumes from; 0 when there's nothing worth resuming.
    resumeSeconds: (data.account.watchProgress && Number(data.account.watchProgress[data.episode.id])) || 0,
    parentSeriesName: data.parentSeriesName,
    nextEpisode: stripPlayable(data.nextEpisode),
    previousEpisode: stripPlayable(data.previousEpisode),
    previousEpisodeWatched: data.previousEpisodeWatched,
    // The season strip (the "After Play" page, 2026-10-29): every episode
    // of this season with watched / resumeSeconds / current for the viewer.
    seasonEpisodes: data.seasonEpisodes || [],
    // How many episodes the show has for this viewer: with one in this
    // season and others elsewhere, the strip's line names the season.
    // (In a preview, the strip, Up next, previous and the extras also
    // carry `canOpen`: false = a title this viewer may not open.)
    showEpisodeCount: data.showEpisodeCount || 0,
    watchNext: data.watchNext.map(stripPlayable),
    // The end card's pick once the show is over or a film ends
    // (lib/endCardRules.js): one title, already trimmed to card fields.
    afterShow: data.afterShow || null,
    bonusContent: data.bonusContent.map(stripPlayable),
    // Slice 4: the credit lines (decision 20), whose notes an episode's own
    // page shows ("Notes from Mara"), and the preview bar (null unless
    // ?preview=1 opened an episode that isn't live). episode.hasPage and
    // episode.pageNotes ride on the episode.
    credits: data.credits || [],
    notesFrom: data.notesFrom || null,
    preview: data.preview || null
  });
}
