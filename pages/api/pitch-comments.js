import { getPitchComments, getPitchById } from '../../lib/pitches';

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
  // Same gate as the pitch page: a pending or rejected project has no
  // public discussion.
  const pitch = await getPitchById(String(pitchId));
  if (!pitch || pitch.status !== 'approved') return res.status(404).json({ error: 'Project not found.' });
  const comments = await getPitchComments(pitchId);
  return res.status(200).json({ comments });
}
