import { playbackGate } from '../../../lib/playbackGate';
import { downloadPrivate, isPrivateRef } from '../../../lib/privateStorage';
import { limitPublicRead } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';

// Serves an episode's caption track to a viewer who may watch the title
// (Jose, 2026-10-25). The full dialogue of a film is the most useful text
// a model could take, and it used to sit at a permanent public URL that
// was in the page even on the lock screen. Now the file lives in the
// private bucket (lib/captionUpload.js) and only this route hands it out,
// behind the same gate as the video (lib/playbackGate.js). A track
// uploaded before the private bucket existed is still a public URL on
// the row; the Protection card moves those.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (!(await limitPublicRead(req, res, 'captions', { max: 120, windowSeconds: 3600 }))) return undefined;

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const gate = await playbackGate(req, id);
  if (gate.denied) return res.status(gate.denied.status).json(gate.denied.body);
  const { episode } = gate;
  if (!episode.captionsRef) return res.status(404).json({ error: 'No captions for this title.' });

  if (!isPrivateRef(episode.captionsRef)) {
    // Still at its public address; send the viewer there.
    res.setHeader('Location', episode.captionsRef);
    return res.status(302).end();
  }
  const bytes = await downloadPrivate(episode.captionsRef);
  if (!bytes) return res.status(404).json({ error: 'Captions could not be read.' });
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Content-Length', String(bytes.length));
  return res.status(200).send(bytes);
}
