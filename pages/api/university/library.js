import { getLibrary } from '../../../lib/university';

// Every downloadable file across every course, for the Library page and
// the app's Library screen.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const library = await getLibrary();
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json(library);
  } catch (err) {
    console.error('university library error:', err.message);
    return res.status(500).json({ error: 'Could not load the library.' });
  }
}
