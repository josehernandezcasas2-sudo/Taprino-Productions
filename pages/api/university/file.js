import { getFileLink } from '../../../lib/university';
import { limitPublicRead } from '../../../lib/rateLimit';

// Opens one Film University file: a reading lesson's PDF (?lesson=<id>)
// or a course file (?file=<id>), by sending the browser to a signed link
// that lasts an hour (lib/universityDocs.js; the bucket is private since
// 2026-10-25). `download=1` asks for a save rather than a view. Lessons
// are free, so the only gate is that the row exists and is published,
// plus the ceiling that separates a student from a script collecting the
// whole library.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const lessonId = typeof req.query.lesson === 'string' ? req.query.lesson : null;
  const fileId = typeof req.query.file === 'string' ? req.query.file : null;
  if (!lessonId && !fileId) return res.status(400).json({ error: 'lesson or file is required' });
  if (!(await limitPublicRead(req, res, 'uni-file', { max: 60, windowSeconds: 60 }))) return undefined;

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  try {
    const url = await getFileLink({ lessonId, fileId, download: req.query.download === '1' });
    if (!url) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Location', url);
    return res.status(302).end();
  } catch (err) {
    console.error('university file error:', err.message);
    return res.status(500).json({ error: 'Could not open the file.' });
  }
}
