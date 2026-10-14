import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import PayoutsCard from '../../components/creator/PayoutsCard';
import { LocationShell, Crumbs, StatusPill, MonthCalendar, thisMonth, todayIso } from '../../components/locations/LocationBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { RequestCard } from '../../components/locations/RequestBits';
import { getOwnListings } from '../../lib/locations';
import { listMyRequests } from '../../lib/locationRequests';
import { CANCELLATION } from '../../lib/locationRules';

// Your locations (/locations/mine): every place you've listed with its
// status, pause / resume / remove, the days you've blocked, and the
// Payouts card bookings pay into. Requests land here in step 3.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let listings = [];
  let requests = [];
  let loadError = null;
  if (account.isSignedIn) {
    try {
      const [own, mine] = await Promise.all([getOwnListings(account.userId), listMyRequests(account.userId)]);
      listings = JSON.parse(JSON.stringify(own));
      requests = JSON.parse(JSON.stringify(mine.asHost));
    } catch (err) {
      loadError = err.message;
    }
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
      listings,
      requests,
      loadError
    }
  };
}

export default function MyLocations({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, listings: initial, requests: initialRequests, loadError }) {
  const router = useRouter();
  const [listings, setListings] = useState(initial);
  const [requests, setRequests] = useState(initialRequests || []);
  const updateRequest = (r) => setRequests((list) => list.map((x) => (x.id === r.id ? r : x)));
  const waiting = requests.filter((r) => r.status === 'requested').length;
  const openRequests = requests.filter((r) => ['requested', 'countered', 'accepted', 'paid'].includes(r.status));
  const pastRequests = requests.filter((r) => !openRequests.includes(r));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(loadError);
  const [note, setNote] = useState(null);
  const [blocking, setBlocking] = useState(null); // listing id with the calendar open

  useEffect(() => {
    if (router.query.submitted) setNote('Submitted — an admin will look at it and you’ll get a notification when it’s listed.');
    else if (router.query.saved) setNote('Saved.');
  }, [router.query.submitted, router.query.saved]);

  async function setStatus(l, status) {
    if (status === 'removed' && !window.confirm(`Remove “${l.title}”? Confirmed bookings stay in your records; the listing goes.`)) return;
    setBusy(l.id);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${l.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not change that.');
      setListings((list) => (status === 'removed' ? list.filter((x) => x.id !== l.id) : list.map((x) => (x.id === l.id ? { ...x, ...data.listing } : x))));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const shell = { mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber };
  const listed = listings.filter((l) => l.status === 'listed').length;
  const inReview = listings.filter((l) => l.status === 'pending').length;

  if (!isSignedIn) {
    return (
      <LocationShell title="Your places" {...shell}>
        <Crumbs items={[{ href: '/locations', label: 'Locations' }, { label: 'Your places' }]} />
        <div className="crew-panel crew-signin">
          <span className="crew-eyebrow">Connect · Locations</span>
          <h1>Your places</h1>
          <p>List a place, answer requests, see what you’ve earned. Sign in to start.</p>
          <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in or create an account</button></SignInButton>
        </div>
      </LocationShell>
    );
  }

  return (
    <LocationShell title="Your places" {...shell}>
      <Crumbs items={[{ href: '/locations', label: 'Locations' }, { label: 'Your places' }]} />
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Locations</span>
          <h1>Your places</h1>
          <p>{listings.length === 0 ? 'Nothing listed yet. If you hold the keys to somewhere a crew could shoot, list it.' : `${listed} listed${inReview ? ` · ${inReview} in review` : ''}${waiting ? ` · ${waiting} ${waiting === 1 ? 'request' : 'requests'} waiting on you` : ' · no requests waiting'}.`}</p>
        </div>
        <Link href="/locations/new" className="crew-btn primary">+ List a place</Link>
      </div>
      {note && <div className="crew-status ok loc-topstatus" role="status">{note}</div>}
      {error && <div className="crew-status error loc-topstatus" role="alert">{error}</div>}

      <div className="crew-card-grid">
        <div className="crew-wc">
          <section className="crew-panel">
            <h3>Requests <small>{waiting ? `${waiting} waiting · 48 hours to answer` : 'newest first'}</small></h3>
            {requests.length === 0 && <div className="crew-muted">When a producer asks for dates, the request lands here and in your Messages, with 48 hours to accept, counter or decline. Nothing yet.</div>}
            {openRequests.map((r) => <RequestCard key={r.id} r={r} side="host" viewerId={viewerId} onChange={updateRequest} />)}
            {pastRequests.length > 0 && <details className="loc-past"><summary className="crew-mono">{pastRequests.length} past {pastRequests.length === 1 ? 'request' : 'requests'}</summary>{pastRequests.map((r) => <RequestCard key={r.id} r={r} side="host" viewerId={viewerId} onChange={updateRequest} />)}</details>}
          </section>

          <section className="crew-panel">
            <h3>Your places <small>{listings.length} of 10</small></h3>
            {listings.length === 0 && <div className="crew-empty">No places yet. <Link href="/locations/new">List the first one</Link>.</div>}
            {listings.map((l) => (
              <div key={l.id} className="loc-row">
                <Link href={`/locations/${l.id}`} className="loc-row-thumb" style={l.coverUrl ? { backgroundImage: `url(${l.coverUrl})` } : undefined} aria-label={l.title} />
                <div style={{ minWidth: 0 }}>
                  <div className="loc-row-title"><Link href={`/locations/${l.id}`}>{l.title}</Link><StatusPill status={l.status} />{l.verified && <span className="crew-chip ok">✓ verified</span>}</div>
                  <div className="crew-mono">{l.kindLabel} · {l.place ? l.place.label : 'no place'} · {l.rateLine}{l.cleaningCents ? ` · ${(l.cleaningCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} cleaning` : ''} · {CANCELLATION[l.cancellation].label} cancellation · {l.photos.length} {l.photos.length === 1 ? 'photo' : 'photos'}{l.shootsCount ? ` · hosted ${l.shootsCount}` : ''}</div>
                  {l.status === 'rejected' && <div className="crew-status error" style={{ marginTop: '0.4rem' }}>Not approved{l.rejectionReason ? `: ${l.rejectionReason}` : ''}. Edit and save to resubmit.</div>}
                  {l.status === 'pending' && <div className="crew-mono" style={{ marginTop: '0.3rem' }}>Waiting on an admin — they check your proof, then it’s public.</div>}
                  <div className="crew-actions" style={{ marginTop: '0.5rem' }}>
                    <Link href={`/locations/new?edit=${l.id}`} className="crew-btn sm">Edit</Link>
                    {l.status === 'listed' && <button type="button" className="crew-btn sm" disabled={busy === l.id} onClick={() => setStatus(l, 'paused')}>Pause</button>}
                    {l.status === 'paused' && <button type="button" className="crew-btn sm" disabled={busy === l.id} onClick={() => setStatus(l, 'listed')}>Resume</button>}
                    {(l.status === 'listed' || l.status === 'paused') && <button type="button" className={`crew-btn sm${blocking === l.id ? ' on' : ''}`} onClick={() => setBlocking(blocking === l.id ? null : l.id)}>{blocking === l.id ? 'Close calendar' : 'Block days'}</button>}
                    <button type="button" className="crew-btn sm ghost crew-remove" disabled={busy === l.id} onClick={() => setStatus(l, 'removed')}>Remove</button>
                  </div>
                  {blocking === l.id && <BlockDays listing={l} onSaved={(days) => setListings((list) => list.map((x) => (x.id === l.id ? { ...x, blockedDays: days } : x)))} />}
                </div>
              </div>
            ))}
          </section>
        </div>

        <aside className="crew-aside">
          {listings.length > 0 && <PayoutsCard returnTo="/locations/mine" />}
          <section className="crew-panel crew-wc-side">
            <h3>The rules</h3>
            <ul className="cl-rules">
              <li>A place is public once an admin has checked you can let a crew in. The street address stays private until a booking is paid.</li>
              <li>You have 48 hours to answer a request. Three unanswered in a row pause the listing until you check in.</li>
              <li>Studio Tapa keeps 10% of a booking; the producer covers the card fee. Your share goes to the bank account on your Payouts card.</li>
              <li>After the last day you say how it went. Damage or a no-show goes to an admin.</li>
            </ul>
          </section>
        </aside>
      </div>
    </LocationShell>
  );
}

// The host's blocked days for one place, a month at a time; saved as a
// whole when they click Save.
function BlockDays({ listing, onSaved }) {
  const [month, setMonth] = useState(thisMonth());
  const [days, setDays] = useState(() => new Set(listing.blockedDays || []));
  const [loaded, setLoaded] = useState(Boolean(listing.blockedDays));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (loaded) return;
    fetch(`/api/locations/${listing.id}`).then((r) => r.json()).then((d) => {
      if (d.listing) setDays(new Set(d.listing.blockedDays || []));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [listing.id, loaded]);

  const marks = {};
  for (const d of days) marks[d] = 'blocked';
  const pick = (iso) => setDays((s) => { const n = new Set(s); if (n.has(iso)) n.delete(iso); else n.add(iso); return n; });

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/locations/${listing.id}/blocked-days`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: [...days] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      onSaved(data.blockedDays);
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loc-block">
      <span className="crew-mono">Tap a day to block or unblock it. Paid bookings block days on their own.</span>
      <MonthCalendar month={month} onMonth={setMonth} marks={marks} min={todayIso()} onPick={pick} legend={false} />
      <div className="crew-actions">
        <button type="button" className="crew-btn sm primary" onClick={save} disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save blocked days'}</button>
        <span className="crew-mono">{days.size} {days.size === 1 ? 'day' : 'days'} blocked</span>
        {status && <span className={`crew-status ${status.kind}`}>{status.text}</span>}
      </div>
    </div>
  );
}
