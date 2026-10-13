import Link from 'next/link';
import { SignInButton } from '@clerk/nextjs';
import { LocationShell } from '../../components/locations/LocationBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { searchListings } from '../../lib/locations';

// Locations home. Step 1 (2026-10-13) ships the host side; the directory
// with search, filters and cards (mockups/locations-v1.html §1) is step
// 2 and replaces this page.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let total = 0;
  try { total = (await searchListings({}, { viewerId: account.userId || null })).total; } catch (err) { /* not set up yet */ }
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      total
    }
  };
}

export default function LocationsHome({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, total }) {
  return (
    <LocationShell title="Find a place to shoot" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber}>
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Connect · Locations</span>
          <h1>Find a place to shoot</h1>
          <p>Homes, warehouses, cafés, studios and odd corners of the city, listed by the people who hold the keys. Ask about a date, make an offer, or book at the posted rate.</p>
        </div>
        {isSignedIn
          ? <Link href="/locations/new" className="crew-btn primary">+ List a place</Link>
          : <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in to list a place</button></SignInButton>}
      </div>
      <div className="crew-panel crew-empty">
        {total > 0 ? `${total} ${total === 1 ? 'place is' : 'places are'} listed. ` : 'The first places are being listed. '}
        The directory with search and filters opens next; hosts can already <Link href="/locations/new">list a place</Link> and manage it under <Link href="/locations/mine">Your places</Link>.
      </div>
    </LocationShell>
  );
}
