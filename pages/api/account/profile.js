import { getAuth } from '@clerk/nextjs/server';
import { getOwnProfile, upsertOwnProfile, isDisplayNameTaken, normalizeHandle, handleError, isHandleTaken, isReservedHandle, BANNER_COLOR_PATTERN } from '../../../lib/userProfiles';
import { getRoleContext } from '../../../lib/roles';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeImagePosition, normalizeZoom } from '../../../lib/profileBanner';
import { applyCors } from '../../../lib/cors';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';

const VALID_GENDERS = ['female', 'male', 'nonbinary', 'prefer_not_to_say'];
const MAX_SOCIAL_LINKS = 6;

// Default Next.js API body limit is 1MB — a base64-encoded image (roughly
// 33% larger than the original file) plus the rest of the JSON payload
// blows past that for any normally-sized upload, failing with a 413
// before the handler below ever runs. This is exactly what was breaking
// avatar uploads: Vercel returns a plain-text 413 response body, and the
// client's res.json() call then threw "Unexpected token" trying to parse
// that plain text as JSON — which is what actually showed up as the
// error, obscuring the real 413 status underneath it.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  if (req.method === 'GET') {
    const profile = await getOwnProfile(userId);
    return res.status(200).json({
      userId,
      displayName: profile ? profile.display_name : null,
      handle: profile ? profile.handle || null : null,
      gender: profile ? profile.gender : null,
      age: profile ? profile.age : null,
      bio: profile ? profile.bio : null,
      avatarUrl: profile ? profile.avatar_url : null,
      avatarPosition: profile ? profile.avatar_position || null : null,
      avatarZoom: profile && profile.avatar_zoom ? Number(profile.avatar_zoom) : null,
      bannerUrl: profile ? profile.banner_url || null : null,
      bannerColor: profile ? profile.banner_color || null : null,
      bannerPosition: profile ? profile.banner_position || null : null,
      bannerZoom: profile && profile.banner_zoom ? Number(profile.banner_zoom) : null,
      socialLinks: profile && Array.isArray(profile.social_links) ? profile.social_links : [],
      stayInStream: profile ? Boolean(profile.stay_in_stream) : false,
      // Tips (migration 101): the creator's fiscal sponsor, if any.
      fiscalSponsorName: profile ? profile.fiscal_sponsor_name || null : null,
      fiscalSponsorUrl: profile ? profile.fiscal_sponsor_url || null : null,
      // The "Not for AI training" seal (migration 111): on unless switched off.
      aiSeal: profile ? profile.ai_seal !== false : true
    });
  }

  if (req.method === 'POST') {
    const { displayName, handle: rawHandle, gender, age, bio, socialLinks, avatarBase64, avatarFileName, removeAvatar, avatarPosition, avatarZoom, bannerBase64, bannerFileName, removeBanner, bannerColor, bannerPosition, bannerZoom, stayInStream, fiscalSponsorName, fiscalSponsorUrl, aiSeal } = req.body || {};
    // Every photo lands in public storage, so new avatars and banners are
    // capped per account (security round, 2026-10-26); the app's
    // switches save on every tap, so plain saves get a roomier ceiling.
    if (!(await checkRateLimit(`profile-save:${userId}`, 120, 3600))) {
      return res.status(429).json({ error: 'That’s a lot of saves — try again in a little while.' });
    }
    if ((avatarBase64 || bannerBase64) && !(await checkRateLimit(`profile-photo:${userId}`, 20, 3600))) {
      return res.status(429).json({ error: 'That’s a lot of new photos for one hour — try again later.' });
    }
    // Tips: a fiscal sponsor is a link (http(s)) with an optional name;
    // a name on its own means nothing, so it needs the link.
    if (fiscalSponsorUrl !== undefined && fiscalSponsorUrl !== null && String(fiscalSponsorUrl).trim() && !/^https?:\/\//i.test(String(fiscalSponsorUrl).trim())) {
      return res.status(400).json({ error: 'The fiscal sponsor link needs to start with http:// or https://.' });
    }
    if (fiscalSponsorName && String(fiscalSponsorName).trim().length > 80) {
      return res.status(400).json({ error: 'The fiscal sponsor name is limited to 80 characters.' });
    }
    if (fiscalSponsorName && String(fiscalSponsorName).trim() && !(fiscalSponsorUrl && String(fiscalSponsorUrl).trim())) {
      return res.status(400).json({ error: 'Add the fiscal sponsor’s link as well as the name.' });
    }
    if (bannerColor !== undefined && bannerColor !== null && bannerColor !== '' && !BANNER_COLOR_PATTERN.test(String(bannerColor))) {
      return res.status(400).json({ error: 'Banner color needs to be a hex color like #283c63.' });
    }
    if (displayName !== undefined && displayName !== null && String(displayName).trim().length > 60) {
      return res.status(400).json({ error: 'Display name is limited to 60 characters.' });
    }
    const handle = normalizeHandle(rawHandle);
    if (handle) {
      const current = await getOwnProfile(userId);
      const unchanged = current && current.handle && current.handle.toLowerCase() === handle.toLowerCase();
      // A reserved handle is the team's to take; someone who already has
      // one keeps it.
      const reservedOk = isReservedHandle(handle) && (unchanged || (await getRoleContext(req)).canAccessAdmin);
      const problem = reservedOk ? null : handleError(handle);
      if (problem) return res.status(400).json({ error: problem });
      if (!unchanged && await isHandleTaken(handle, userId)) {
        return res.status(409).json({ error: `@${handle} is already taken — try another.` });
      }
    }
    if (displayName && displayName.trim()) {
      const current = await getOwnProfile(userId);
      const unchanged = current && current.display_name && current.display_name.toLowerCase() === displayName.trim().toLowerCase();
      if (!unchanged && await isDisplayNameTaken(displayName, userId)) {
        return res.status(409).json({ error: 'That name is already taken — try another. Note that changing your name later won\u2019t guarantee you can get this one back if someone else claims it.' });
      }
    }
    if (gender !== undefined && gender !== null && gender !== '' && !VALID_GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender value.' });
    }
    if (age !== undefined && age !== null && age !== '' && (Number(age) < 13 || Number(age) > 120)) {
      return res.status(400).json({ error: 'Age must be between 13 and 120.' });
    }
    if (bio !== undefined && bio !== null && String(bio).length > 400) {
      return res.status(400).json({ error: 'Bio is limited to 400 characters.' });
    }
    if (socialLinks !== undefined) {
      if (!Array.isArray(socialLinks)) {
        return res.status(400).json({ error: 'socialLinks must be an array.' });
      }
      if (socialLinks.length > MAX_SOCIAL_LINKS) {
        return res.status(400).json({ error: `You can add up to ${MAX_SOCIAL_LINKS} links.` });
      }
      for (const link of socialLinks) {
        if (!link || typeof link.url !== 'string' || !link.url.trim()) {
          return res.status(400).json({ error: 'Every link needs a URL.' });
        }
        if (!/^https?:\/\//i.test(link.url.trim())) {
          return res.status(400).json({ error: `"${link.url}" needs to start with http:// or https://.` });
        }
      }
    }

    let avatarUrl;
    let bannerUrl;
    try {
      if (removeAvatar) {
        avatarUrl = null;
      } else if (avatarBase64) {
        avatarUrl = await uploadArtworkImage({ base64: avatarBase64, fileName: avatarFileName, pathPrefix: `avatar-${userId}` });
      }
      // Banner: a new photo replaces whatever was there; "remove" clears
      // the photo (the color, if any, shows instead). Sending a color
      // alongside a photo is fine — the photo wins on the page, and the
      // color is what shows if the photo is removed later.
      if (removeBanner) {
        bannerUrl = null;
      } else if (bannerBase64) {
        bannerUrl = await uploadArtworkImage({ base64: bannerBase64, fileName: bannerFileName, pathPrefix: `banner-${userId}` });
      }
    } catch (err) {
      // The image checks' own words ("that isn't an image", too big).
      return sendError(res, err, 'account/profile', 'Could not save your profile.', { plainStatus: 400 });
    }
    try {
      const cleanedLinks = socialLinks !== undefined
        ? socialLinks.map((l) => ({ platform: (l.platform || '').trim().slice(0, 30), url: l.url.trim() }))
        : undefined;
      await upsertOwnProfile(userId, {
        displayName, handle, gender, age, bio, socialLinks: cleanedLinks, avatarUrl, stayInStream,
        bannerUrl,
        bannerColor: bannerColor === undefined ? undefined : (bannerColor || null),
        // A removed photo takes its focal point with it.
        bannerPosition: removeBanner ? null : bannerPosition,
        avatarPosition: removeAvatar ? null : avatarPosition,
        bannerZoom: removeBanner ? null : bannerZoom,
        avatarZoom: removeAvatar ? null : avatarZoom,
        fiscalSponsorName,
        fiscalSponsorUrl,
        aiSeal: aiSeal === undefined ? undefined : Boolean(aiSeal)
      });
      // The focal points ride back so the page (and the header, via the
      // own-profile-updated event) show the saved crop without a reload.
      return res.status(200).json({
        ok: true, avatarUrl, bannerUrl, handle,
        ...(avatarPosition !== undefined || removeAvatar ? { avatarPosition: removeAvatar ? null : normalizeImagePosition(avatarPosition) } : {}),
        ...(bannerPosition !== undefined || removeBanner ? { bannerPosition: removeBanner ? null : normalizeImagePosition(bannerPosition) } : {}),
        ...(avatarZoom !== undefined || removeAvatar ? { avatarZoom: removeAvatar ? null : normalizeZoom(avatarZoom) } : {}),
        ...(bannerZoom !== undefined || removeBanner ? { bannerZoom: removeBanner ? null : normalizeZoom(bannerZoom) } : {})
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      // A database message names tables and columns; the person gets a
      // plain one and the log keeps the real one.
      console.error('account/profile save:', err.message);
      return res.status(500).json({ error: 'Could not save your profile. Try again in a moment.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
