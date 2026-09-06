import { getAuth } from '@clerk/nextjs/server';
import { getOwnProfile, upsertOwnProfile, isDisplayNameTaken } from '../../../lib/userProfiles';
import { uploadArtworkImage } from '../../../lib/artworkUpload';

const VALID_GENDERS = ['female', 'male', 'nonbinary', 'prefer_not_to_say'];
const MAX_SOCIAL_LINKS = 6;

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  if (req.method === 'GET') {
    const profile = await getOwnProfile(userId);
    return res.status(200).json({
      displayName: profile ? profile.display_name : null,
      gender: profile ? profile.gender : null,
      age: profile ? profile.age : null,
      bio: profile ? profile.bio : null,
      avatarUrl: profile ? profile.avatar_url : null,
      socialLinks: profile && Array.isArray(profile.social_links) ? profile.social_links : []
    });
  }

  if (req.method === 'POST') {
    const { displayName, gender, age, bio, socialLinks, avatarBase64, avatarFileName, removeAvatar } = req.body || {};
    if (displayName !== undefined && displayName !== null && String(displayName).trim().length > 60) {
      return res.status(400).json({ error: 'Display name is limited to 60 characters.' });
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
        if (!link.url || !link.url.trim()) {
          return res.status(400).json({ error: 'Every link needs a URL.' });
        }
        if (!/^https?:\/\//i.test(link.url.trim())) {
          return res.status(400).json({ error: `"${link.url}" needs to start with http:// or https://.` });
        }
      }
    }

    try {
      let avatarUrl;
      if (removeAvatar) {
        avatarUrl = null;
      } else if (avatarBase64) {
        avatarUrl = await uploadArtworkImage({ base64: avatarBase64, fileName: avatarFileName, pathPrefix: `avatar-${userId}` });
      }
      const cleanedLinks = socialLinks !== undefined
        ? socialLinks.map((l) => ({ platform: (l.platform || '').trim().slice(0, 30), url: l.url.trim() }))
        : undefined;
      await upsertOwnProfile(userId, { displayName, gender, age, bio, socialLinks: cleanedLinks, avatarUrl });
      return res.status(200).json({ ok: true, avatarUrl });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
