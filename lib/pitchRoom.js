import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from './accountContext';
import { getApprovedPitches, getSavedPitchIds } from './pitches';
import { getSupabase } from './supabase';
import { getSiteSettings } from './siteSettings';
import { getPublicIdentities } from './userProfiles';

// Shared by pages/pitches.js's getServerSideProps and the mobile app's
// GET /api/pitch-room, so the Pitch Room list is the same on both: the
// same pitches, save counts ("Most saved" sort + "N people following"),
// live in-platform funding totals, and which ones this viewer has saved.
// Returns { disabled: true } when the Pitch Room is switched off in Site
// Settings and the viewer isn't an admin (the website 404s on that).
export async function getPitchRoomData(req) {
  const account = await getAccountContext(req);
  const siteSettings = await getSiteSettings();
  const bypassingDisabled = !siteSettings.elevatorPitchEnabled && account.isAdmin;
  if (!siteSettings.elevatorPitchEnabled && !account.isAdmin) {
    return { disabled: true, account };
  }

  const { userId } = getAuth(req);
  const supabase = getSupabase();
  const [pitches, savedIds, saveResult, donationResult] = await Promise.all([
    getApprovedPitches(),
    userId ? getSavedPitchIds(userId) : [],
    // Save count per pitch, for the "Most saved" sort option — a separate,
    // lightweight query (just pitch_id) rather than pulling full save rows.
    supabase.from('pitch_saves').select('pitch_id'),
    // Same lightweight-aggregate pattern, for the same reason
    // pages/pitches/[id].js uses it: a funding_enabled pitch's real
    // progress lives in pitch_donations, not the self-reported
    // funding_raised column, which never gets updated once a project is
    // on real in-platform funding.
    supabase.from('pitch_donations').select('pitch_id, amount_cents')
  ]);

  const saveCountsByPitchId = {};
  for (const row of saveResult.data || []) {
    saveCountsByPitchId[row.pitch_id] = (saveCountsByPitchId[row.pitch_id] || 0) + 1;
  }
  const raisedCentsByPitchId = {};
  for (const row of donationResult.data || []) {
    raisedCentsByPitchId[row.pitch_id] = (raisedCentsByPitchId[row.pitch_id] || 0) + row.amount_cents;
  }

  // The linked account's name, for pitches whose optional creator_name
  // was left blank (the app falls back to it for the "by …" line).
  const creatorIds = [...new Set(pitches.filter((p) => !p.creator_name && p.created_by).map((p) => p.created_by))];
  const creators = creatorIds.length > 0 ? await getPublicIdentities(creatorIds) : {};

  return {
    disabled: false,
    account,
    bypassingDisabled,
    savedIds,
    pitches: pitches.map((p) => ({
      ...p,
      savedCount: saveCountsByPitchId[p.id] || 0,
      creatorDisplayName: p.creator_name || (creators[p.created_by] ? creators[p.created_by].displayName : null),
      liveRaisedCents: p.funding_enabled ? (raisedCentsByPitchId[p.id] || 0) : null
    }))
  };
}
