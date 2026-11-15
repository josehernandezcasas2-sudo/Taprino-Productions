import { getRoleContext } from '../../../lib/roles';
import { getAllSeriesForCreator } from '../../../lib/series';
import { isTitleTeam } from '../../../lib/titleTeam';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Creators get their own shows; the title team (a full admin, or a
  // sub-admin holding review_submissions or manage_episodes: the Library
  // page's series picker) gets every show. Any team account used to
  // (2026-11-15).
  const rc = await getRoleContext(req);
  const team = isTitleTeam(rc);
  if (!rc.isCreator && !team) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const series = await getAllSeriesForCreator(rc.userId, { isAdmin: team });
  return res.status(200).json({ series });
}
