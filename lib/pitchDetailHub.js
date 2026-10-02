import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from './accountContext';
import { getSiteSettings } from './siteSettings';
import { getPitchById, getSimilarPitches, getPitchUpdates, getPitchComments, isPitchSaved, toPublicPitch } from './pitches';
import { getDonationsForPitch } from './pitchDonations';
import { getPublicIdentities } from './userProfiles';
import { getPublicEpisodes } from './publicEpisodes';

// Shared by pages/pitches/[id].js and the mobile app's GET
// /api/pitch-detail — same gate (elevatorPitchEnabled, admin bypass),
// same pitch lookup, same donation-totals/recent-backers computation.
// Returns null when the gate blocks this viewer or the pitch doesn't
// exist/isn't approved, which both callers turn into their own "not
// found" response.
export async function getPitchDetailData(pitchId, req) {
  const account = await getAccountContext(req);
  const siteSettings = await getSiteSettings();
  const bypassingDisabled = !siteSettings.elevatorPitchEnabled && account.isAdmin;

  if (!siteSettings.elevatorPitchEnabled && !account.isAdmin) return null;

  const pitch = await getPitchById(pitchId);
  if (!pitch || pitch.status !== 'approved') return null;

  const { userId } = getAuth(req);
  const [similar, updates, comments, episodes, saved, donations] = await Promise.all([
    getSimilarPitches(pitch.tag, pitch.id),
    getPitchUpdates(pitch.id),
    getPitchComments(pitch.id),
    getPublicEpisodes(),
    userId ? isPitchSaved(userId, pitch.id) : false,
    pitch.funding_enabled ? getDonationsForPitch(pitch.id) : Promise.resolve([])
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const totalRaisedCents = pitch.funding_enabled ? donations.reduce((sum, d) => sum + d.amountCents, 0) : null;
  const backerCount = pitch.funding_enabled ? new Set(donations.map((d) => d.donorUserId)).size : null;

  const seenDonors = new Set();
  const recentBackerIds = [];
  for (const d of donations) {
    if (seenDonors.has(d.donorUserId)) continue;
    seenDonors.add(d.donorUserId);
    recentBackerIds.push(d.donorUserId);
    if (recentBackerIds.length >= 8) break;
  }
  // One lookup for the backers' and the creator's photos (the app's pitch
  // page shows the creator's avatar beside "By …").
  const identityIds = [...recentBackerIds, pitch.created_by].filter(Boolean);
  const identities = identityIds.length > 0 ? await getPublicIdentities(identityIds) : {};
  const recentBackers = recentBackerIds.map((id) => ({ userId: id, displayName: identities[id].displayName, avatarUrl: identities[id].avatarUrl }));
  const creatorIdentity = pitch.created_by ? identities[pitch.created_by] : null;
  const creatorAvatarUrl = creatorIdentity ? creatorIdentity.avatarUrl : null;
  // Fallback for pitches whose optional creator_name was left blank but
  // that are linked to a real account.
  const creatorDisplayName = creatorIdentity ? creatorIdentity.displayName : null;

  return {
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    bypassingDisabled,
    isCreator: account.isCreator,
    userId: userId || null,
    mainGenres,
    pitch: toPublicPitch(pitch),
    similar,
    updates,
    comments,
    initialSaved: saved,
    totalRaisedCents,
    backerCount,
    recentBackers,
    creatorAvatarUrl,
    creatorDisplayName
  };
}
