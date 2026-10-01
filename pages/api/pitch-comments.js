import { getPitchComments } from '../../lib/pitches';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { pitchId } = req.query;
  if (!pitchId) {
    return res.status(400).json({ error: 'pitchId is required.' });
  }
  const comments = await getPitchComments(pitchId);
  return res.status(200).json({ comments });
}
