import { getRoleContext } from '../../../lib/roles';
import { getAllSeriesForCreator } from '../../../lib/series';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Creators get their own shows; anyone in the admin area (the Library
  // page's series picker) gets every show.
  const { userId, isCreator, canAccessAdmin } = await getRoleContext(req);
  if (!isCreator && !canAccessAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const series = await getAllSeriesForCreator(userId, { isAdmin: canAccessAdmin });
  return res.status(200).json({ series });
}
