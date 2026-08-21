import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../../lib/supabase';
import { postPitchUpdate } from '../../../lib/pitches';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const { pitchId, title, body } = req.body || {};
  if (!pitchId || !title || !body) {
    return res.status(400).json({ error: 'pitchId, title, and body are required.' });
  }

  const supabase = getSupabase();
  const { data: pitch, error: fetchError } = await supabase.from('pitches').select('created_by, status').eq('id', pitchId).maybeSingle();
  if (fetchError || !pitch) {
    return res.status(404).json({ error: 'Pitch not found.' });
  }
  if (pitch.created_by !== userId) {
    return res.status(403).json({ error: 'You can only post updates on your own pitches.' });
  }
  if (pitch.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved, live pitches can post updates.' });
  }

  const result = await postPitchUpdate(pitchId, title, body);
  if (!result.ok) {
    return res.status(500).json({ error: `Could not post update: ${result.error}` });
  }
  return res.status(200).json({ ok: true });
}
