import { getAuth } from '@clerk/nextjs/server';
import { getOwnProfile, upsertOwnProfile } from '../../../lib/userProfiles';

const VALID_GENDERS = ['female', 'male', 'nonbinary', 'prefer_not_to_say'];

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
      age: profile ? profile.age : null
    });
  }

  if (req.method === 'POST') {
    const { displayName, gender, age } = req.body || {};
    if (displayName !== undefined && displayName !== null && String(displayName).trim().length > 60) {
      return res.status(400).json({ error: 'Display name is limited to 60 characters.' });
    }
    if (gender !== undefined && gender !== null && gender !== '' && !VALID_GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender value.' });
    }
    if (age !== undefined && age !== null && age !== '' && (Number(age) < 13 || Number(age) > 120)) {
      return res.status(400).json({ error: 'Age must be between 13 and 120.' });
    }

    try {
      await upsertOwnProfile(userId, { displayName, gender, age });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
