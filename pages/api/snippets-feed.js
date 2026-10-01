import { getSnippetsFeedData } from '../../lib/snippetsFeed';

// The mobile app's equivalent of pages/snippets/discover.js's
// getServerSideProps — same lib/snippetsFeed.js the website page itself
// now calls too.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const data = await getSnippetsFeedData(req);
  return res.status(200).json(data);
}
