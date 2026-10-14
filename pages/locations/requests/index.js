import Link from 'next/link';
import { useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import { LocationShell, Crumbs } from '../../../components/locations/LocationBits';
import { RequestCard } from '../../../components/locations/RequestBits';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { listMyRequests } from '../../../lib/locationRequests';

// Your requests (/locations/requests): the places you've asked for, as
// a producer. Hosts answer theirs on /locations/mine.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let mine = { asHost: [], asProducer: [] };
  if (account.isSignedIn) {
    try { mine = JSON.parse(JSON.stringify(await listMyRequests(account.userId))); } catch (err) { console.error('requests page:', err.message); }
  }
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      viewerId: account.userId || null,
      requests: mine.asProducer,
      hostCount: mine.asHost.filter((r) => ['requested', 'countered'].includes(r.status)).length
    }
  };
}

export default function MyRequests({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, requests: initial, hostCount }) {
  const [requests, setRequests] = useState(initial);
  const shell = { mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber };
  const update = (r) => setRequests((list) => list.map((x) => (x.id === r.id ? r : x)));
  const open = requests.filter((r) => ['requested', 'countered', 'accepted', 'paid'].includes(r.status));
  const past = requests.filter((r) => !open.includes(r));

  return (
    <LocationShell title="Your requests" {...shell}>
      <Crumbs items={[{ href: '/locations', label: 'Locations' }, { label: 'Your requests' }]} />
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Locations</span>
          <h1>Your requests</h1>
          <p>Places you’ve asked for. A host has 48 hours to answer; once they accept, pay to confirm and the address unlocks.</p>
        </div>
        <div className="crew-actions">
          {hostCount > 0 && <Link href="/locations/mine" className="crew-btn">{hostCount} waiting on you as a host</Link>}
          <Link href="/locations" className="crew-btn primary">Find a place</Link>
        </div>
      </div>
      {!isSignedIn ? (
        <div className="crew-panel crew-signin"><p>Sign in to see your requests.</p><SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in</button></SignInButton></div>
      ) : (
        <div className="loc-narrowcol">
          {requests.length === 0 && <div className="crew-panel crew-empty">No requests yet. <Link href="/locations">Find a place</Link> and ask for dates.</div>}
          {open.map((r) => <RequestCard key={r.id} r={r} side="producer" viewerId={viewerId} onChange={update} />)}
          {past.length > 0 && <div className="crew-field" style={{ marginTop: '1rem' }}><span>Past</span></div>}
          {past.map((r) => <RequestCard key={r.id} r={r} side="producer" viewerId={viewerId} onChange={update} />)}
        </div>
      )}
    </LocationShell>
  );
}
