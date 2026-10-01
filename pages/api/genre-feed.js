import { getGenreFeedData } from '../../lib/genreFeed';

// The mobile app's equivalent of pages/genre/[genre].js — deliberately
// NOT sharing that page's own getServerSideProps (same reasoning as
// lib/streamFeed.js vs pages/stream.js): the website computes its rows
// from raw episodes via components/GenreRow.js's own client-side
// consolidation, while this returns pre-ranked cards via
// lib/libraryCards.js, matching the shape every other mobile feed route
// already uses.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  const { genre } = req.query;
  if (!genre) return res.status(400).json({ error: 'genre is required.' });

  const data = await getGenreFeedData(genre);
  return res.status(200).json(data);
}
