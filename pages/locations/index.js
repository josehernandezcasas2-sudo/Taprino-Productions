import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import PlaceSearch from '../../components/crew/PlaceSearch';
import { Avatar } from '../../components/crew/CrewBits';
import { LocationShell, HostedChip, fmtRange } from '../../components/locations/LocationBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getOwnCard } from '../../lib/crewCards';
import { searchListings } from '../../lib/locations';
import { LOCATION_TYPES, FILTER_CHIPS } from '../../lib/locationRules';
import { WITHIN_CHOICES } from '../../lib/crewOptions';

// The Locations directory (mockups/locations-v1.html §1): place +
// radius + dates up top, type chips with counts, feature/budget chips,
// cards nearest first. Everything after the first render goes through
// /api/locations, debounced, like the Crew Call board.
const DEFAULT_WITHIN = 25;

export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let own = null;
  if (account.isSignedIn) {
    try { own = await getOwnCard(account.userId); } catch (err) { /* no card */ }
  }
  const near = own && own.place ? { label: own.place.label, lat: own.place.lat, lng: own.place.lng } : null;
  let result = { listings: [], total: 0, counts: {}, sort: 'new' };
  let loadError = null;
  try {
    result = JSON.parse(JSON.stringify(await searchListings({ lat: near ? near.lat : undefined, lng: near ? near.lng : undefined, withinMiles: near ? DEFAULT_WITHIN : 0, kind: query.kind || null }, { viewerId: account.userId || null })));
  } catch (err) {
    loadError = err.message;
  }
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      initial: result,
      near,
      initialKind: LOCATION_TYPES[query.kind] ? query.kind : '',
      loadError
    }
  };
}

const BUDGETS = [['100', 'Under $100/hr'], ['250', 'Under $250/hr']];
const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} miles`);

export default function LocationsDirectory({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, initial, near: initialNear, initialKind, loadError }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(initialKind);
  const [features, setFeatures] = useState([]);
  const [budget, setBudget] = useState('');
  const [deals, setDeals] = useState(false);
  const [verified, setVerified] = useState(false);
  const [near, setNear] = useState(initialNear);
  const [within, setWithin] = useState(initialNear ? DEFAULT_WITHIN : 0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState(initial.sort || (initialNear ? 'near' : 'new'));
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  const reqId = useRef(0);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (kind) p.set('kind', kind);
      if (features.length) p.set('features', features.join(','));
      if (budget) p.set('maxHourly', budget);
      if (deals) p.set('deals', '1');
      if (verified) p.set('verified', '1');
      if (near) { p.set('lat', String(near.lat)); p.set('lng', String(near.lng)); p.set('within', String(within)); }
      if (from) { p.set('from', from); p.set('to', to && to >= from ? to : from); }
      p.set('sort', sort);
      try {
        const res = await fetch(`/api/locations?${p.toString()}`);
        const d = await res.json();
        if (id === reqId.current && res.ok) setData(d);
      } catch (err) { /* keep what we have */ } finally { if (id === reqId.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, features, budget, deals, verified, near, within, from, to, sort]);

  const toggleFeature = (k) => setFeatures((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const hasFilters = Boolean(q.trim() || kind || features.length || budget || deals || verified || from);
  const counts = data.counts || {};
  const listings = data.listings || [];

  return (
    <LocationShell title="Find a place to shoot" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber}>
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Connect · Locations</span>
          <h1>Find a place to shoot</h1>
          <p>Homes, warehouses, cafés, studios and odd corners of the city, listed by the people who hold the keys. Ask about a date, make an offer, or book at the posted rate.</p>
        </div>
        {isSignedIn
          ? <div className="crew-actions"><Link href="/locations/mine" className="crew-btn">Your places</Link><Link href="/locations/new" className="crew-btn primary">+ List a place</Link></div>
          : <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in to list a place</button></SignInButton>}
      </div>

      <div className="loc-find">
        <div className="crew-field"><span>Near</span>
          <div className="loc-find-near">
            <PlaceSearch value={near} onChange={(p) => { setNear(p); if (p && within === 0) setWithin(DEFAULT_WITHIN); if (p) setSort('near'); }} placeholder="City or neighbourhood, or use your location" compact />
            {near && (
              <select className="crew-select" value={within} onChange={(e) => setWithin(Number(e.target.value))} aria-label="Distance" style={{ width: 'auto' }}>
                {WITHIN_CHOICES.map((n) => <option key={n} value={n}>{withinLabel(n)}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="crew-field"><span>Dates</span>
          <div className="loc-find-dates">
            <input type="date" className="crew-input" value={from} onChange={(e) => { setFrom(e.target.value); if (to && e.target.value > to) setTo(e.target.value); }} aria-label="First day" />
            <input type="date" className="crew-input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Last day" disabled={!from} />
            {from && <button type="button" className="crew-btn sm ghost" onClick={() => { setFrom(''); setTo(''); }} aria-label="Clear dates">✕</button>}
          </div>
        </div>
        <div className="crew-field"><span>Search</span>
          <input type="search" className="crew-input" placeholder="Terrazzo, loft, diner, yard…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search places" />
        </div>
      </div>

      <div className="loc-types" role="tablist" aria-label="Kind of place">
        <button type="button" className={`loc-type${kind === '' ? ' on' : ''}`} aria-pressed={kind === ''} onClick={() => setKind('')}>All <small>{counts.all || 0}</small></button>
        {Object.entries(LOCATION_TYPES).map(([k, v]) => (
          <button key={k} type="button" className={`loc-type${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)} disabled={!counts[k] && kind !== k}>{v} <small>{counts[k] || 0}</small></button>
        ))}
      </div>
      <div className="crew-chips crew-filterchips loc-filterchips">
        {BUDGETS.map(([v, label]) => <button key={v} type="button" aria-pressed={budget === v} onClick={() => setBudget(budget === v ? '' : v)}>{label}</button>)}
        <button type="button" aria-pressed={deals} onClick={() => setDeals((x) => !x)}>Make a deal</button>
        {FILTER_CHIPS.map(([k, label]) => <button key={k} type="button" aria-pressed={features.includes(k)} onClick={() => toggleFeature(k)}>{label}</button>)}
        <button type="button" aria-pressed={verified} onClick={() => setVerified((x) => !x)}>✓ Verified host</button>
        {hasFilters && <button type="button" className="loc-clear" onClick={() => { setQ(''); setKind(''); setFeatures([]); setBudget(''); setDeals(false); setVerified(false); setFrom(''); setTo(''); }}>Clear</button>}
      </div>

      <div className="crew-rhead loc-rhead">
        <span className="crew-mono">{data.total} {data.total === 1 ? 'place' : 'places'}{from ? ` open ${fmtRange(from, to && to >= from ? to : from)}` : ''}{loading ? ' · updating…' : ''}</span>
        <span className="crew-mono loc-sort">
          {[['near', near ? `closest to ${near.label.split(',')[0]}` : 'closest'], ['booked', 'most booked'], ['cheap', 'cheapest'], ['new', 'newest']].map(([k, label]) => (
            (k !== 'near' || near) && <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
          ))}
        </span>
      </div>

      {loadError && <div className="crew-panel crew-empty">Locations aren’t set up yet — the admin needs to run migration 086.</div>}
      {!loadError && listings.length === 0 && (
        <div className="crew-panel crew-empty">
          {hasFilters || near ? 'No places match. Clear a filter, widen the distance, or try other dates.' : <>No places listed yet. {isSignedIn ? <Link href="/locations/new">List the first one</Link> : 'Sign in to list the first one.'}</>}
        </div>
      )}
      <div className="loc-cards">
        {listings.map((l) => <ListingCard key={l.id} l={l} from={from} />)}
      </div>
    </LocationShell>
  );
}

function ListingCard({ l, from }) {
  const facts = [
    l.sqFt ? `${l.sqFt.toLocaleString('en-US')} sq ft` : null,
    l.rooms ? `${l.rooms.split('·').length} ${l.rooms.split('·').length === 1 ? 'room' : 'rooms'}` : null,
    l.crewMax ? `crew up to ${l.crewMax}` : null,
    l.features.includes('quiet') ? 'quiet' : null,
    l.features.includes('driveway') ? 'driveway' : l.features.includes('truck_access') ? 'truck access' : null
  ].filter(Boolean).slice(0, 4);
  const cover = l.coverUrl || (l.photos[0] && l.photos[0].url);
  return (
    <Link href={`/locations/${l.id}`} className="loc-card">
      <span className="loc-card-ph" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
        <span className="loc-card-k">{l.photoCount} {l.photoCount === 1 ? 'photo' : 'photos'}</span>
        {from && l.openOnDates && <span className="loc-card-pin">Open {fmtRange(from)}</span>}
      </span>
      <span className="loc-card-body">
        <span className="crew-eyebrow loc-card-eye">{l.kindLabel} · {l.place ? l.place.label.split(',')[0] : ''}{l.miles != null ? ` · ${l.miles} mi` : ''}</span>
        <span className="loc-card-t">{l.title}</span>
        {facts.length > 0 && <span className="crew-mono">{facts.join(' · ')}</span>}
        <span className="loc-card-rate"><b>{l.rateLine}</b>{l.hourlyCents ? ` · ${l.minHours} hr min` : ''}{!l.hourlyCents && !l.dayCents && l.dealsOk ? ' · send an offer' : ''}{l.studioRateLine ? <> · <span className="loc-studio-line">{l.studioRateLine}</span></> : null}</span>
        {l.titlesShotHere > 0 && <span className="crew-mono">🎬 {l.titlesShotHere} {l.titlesShotHere === 1 ? 'title' : 'titles'} shot here</span>}
        <span className="loc-card-foot">
          <span className="loc-card-host"><Avatar userId={l.host.userId} name={l.host.displayName} src={l.host.avatarUrl} position={l.host.avatarPosition} zoom={l.host.avatarZoom} size="sm" />{l.host.displayName} <HostedChip host={l.host} />{l.verified && <span className="crew-chip ok">✓</span>}</span>
          <span className="crew-btn sm">View</span>
        </span>
      </span>
    </Link>
  );
}
