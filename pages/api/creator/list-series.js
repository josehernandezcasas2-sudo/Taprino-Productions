import { getRoleContext } from '../../../lib/roles';
import { getAllSeriesForCreator } from '../../../lib/series';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const series = await getAllSeriesForCreator();
  return res.status(200).json({ series });
}
