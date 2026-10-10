import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import PlaceSearch from '../../components/crew/PlaceSearch';
import { Avatar, Availability, RoleChips, rateLabel, flagClass, flagLabel } from '../../components/crew/CrewBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getOwnCard, searchCards } from '../../lib/crewCards';
import { CREW_ROLES, GEAR_CATEGORIES, WITHIN_CHOICES } from '../../lib/crewOptions';
import { SITE } from '../../lib/siteConfig';

// Crew Call — the Connect side's network (mockup signed off 2026-10-09).
// Find people by role, gear and distance; browse the gear itself; keep
// your own working card. Location-based: a signed-in viewer with a place
// on their card starts out searching near it; anyone can type a place
// or use their location. Calls and messages come in later steps.
const DEFAULT_WITHIN = 50;

export async function getServerSideProps({ req, res }) {
  // Rates show to signed-in viewers only and the default "near" is the
  // viewer's own place, so this never sits in a shared cache.
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);

  let own = null;
  if (account.isSignedIn) {
    try { own = await getOwnCard(account.userId); } catch (err) { console.error('crew own card:', err.message); }
  }
  const near = own && own.place ? { label: own.place.label, lat: own.place.lat, lng: own.place.lng } : null;

  let initial = { people: [], total: 0 };
  let loadError = false;
  try {
    initial = await searchCards(
      { lat: near ? near.lat : undefined, lng: near ? near.lng : undefined, withinMiles: near ? DEFAULT_WITHIN : 0 },
      { showRates: account.isSignedIn, viewerId: account.userId || null }
    );
  } catch (err) {
    console.error('crew directory:', err.message);
    loadError = true;
  }

  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      near,
      hasCard: Boolean(own),
      initial,
      loadError
    }
  };
}

const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} miles`);

export default function CrewCall({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, near: initialNear, hasCard, initial, loadError }) {
  const [tab, setTab] = useState('people');
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState([]);
  const [gearCat, setGearCat] = useState('');
  const [near, setNear] = useState(initialNear);
  const [within, setWithin] = useState(initialNear ? DEFAULT_WITHIN : 0);
  const [openOnly, setOpenOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [people, setPeople] = useState(initial);
  const [gear, setGear] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const first = useRef(true);
  const reqId = useRef(0);

  const hasFilters = Boolean(q.trim() || roles.length || gearCat || openOnly || verifiedOnly || (near && within));

  useEffect(() => {
    // The first people list came with the page.
    if (first.current) { first.current = false; return; }
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (roles.length) params.set('roles', roles.join(','));
      if (gearCat) params.set('gear', gearCat);
      if (near) { params.set('lat', String(near.lat)); params.set('lng', String(near.lng)); params.set('within', String(within)); }
      if (openOnly) params.set('open', '1');
      if (verifiedOnly) params.set('verified', '1');
      if (tab === 'gear') params.set('view', 'gear');
      try {
        const res = await fetch(`/api/crew/people?${params.toString()}`);
        const data = await res.json();
        if (id !== reqId.current) return;
        if (!res.ok) throw new Error(data.error || 'Could not load Crew Call.');
        if (tab === 'gear') setGear(data); else setPeople(data);
        setError(null);
      } catch (err) {
        if (id === reqId.current) setError(err.message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [tab, q, roles, gearCat, near, within, openOnly, verifiedOnly]);

  function toggleRole(r) {
    setRoles((list) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]));
  }
  function clearFilters() {
    setQ(''); setRoles([]); setGearCat(''); setOpenOnly(false); setVerifiedOnly(false);
    if (!initialNear) setNear(null);
  }
  function changeNear(p) {
    setNear(p);
    if (p && within === 0) setWithin(DEFAULT_WITHIN);
  }

  const sortNote = near ? `nearest to ${near.label}` : 'newest first';

  return (
    <>
      <Head>
        <title>Crew Call — {SITE.name}</title>
        <meta name="description" content={`Find the people and the gear for your next shoot on ${SITE.name}: crew by role, gear by category, all near you.`} />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="stage stage-single crew-page">
        <div className="crew-head">
          <div>
            <span className="crew-eyebrow">Connect</span>
            <h1>Crew Call</h1>
            <p>Find the people and the gear for the next shoot. Everyone with an account gets a working card — what you do, what you have, where you are.</p>
          </div>
          {isSignedIn ? (
            <Link href="/crew/card" className="crew-btn primary">{hasCard ? 'Your card' : '+ Set up your card'}</Link>
          ) : (
            <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in to make your card</button></SignInButton>
          )}
        </div>

        <div className="crew-subnav" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>Find people{people.total ? ` · ${people.total}` : ''}</button>
          <button type="button" role="tab" aria-selected={tab === 'gear'} onClick={() => setTab('gear')}>Gear{gear && gear.total ? ` · ${gear.total}` : ''}</button>
        </div>

        <div className="crew-find">
          <aside className="crew-filters">
            <input
              type="search"
              className="crew-input"
              placeholder={tab === 'gear' ? 'Camera, light, lens, van…' : 'Name, role, gear, city…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={tab === 'gear' ? 'Search gear' : 'Search people'}
            />
            <div className="crew-panel crew-filter-panel">
              {tab === 'people' && (
                <div className="crew-field">
                  <span>Role</span>
                  <div className="crew-chips crew-filterchips crew-rolebox">
                    {CREW_ROLES.map((r) => (
                      <button key={r} type="button" aria-pressed={roles.includes(r)} onClick={() => toggleRole(r)}>{r}</button>
                    ))}
                  </div>
                </div>
              )}
              <label className="crew-field">
                <span>{tab === 'gear' ? 'Category' : 'Has gear'}</span>
                <select className="crew-select" value={gearCat} onChange={(e) => setGearCat(e.target.value)}>
                  <option value="">{tab === 'gear' ? 'All gear' : 'Any gear'}</option>
                  {GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <div className="crew-field">
                <span>Near</span>
                <PlaceSearch value={near} onChange={changeNear} placeholder="City, or use your location" compact />
                {near && (
                  <select className="crew-select" value={within} onChange={(e) => setWithin(Number(e.target.value))} aria-label="Distance">
                    {WITHIN_CHOICES.map((n) => <option key={n} value={n}>{withinLabel(n)}</option>)}
                  </select>
                )}
              </div>
              {tab === 'people' && (
                <div className="crew-chips">
                  <button type="button" className={`crew-btn sm${openOnly ? ' on' : ''}`} onClick={() => setOpenOnly((v) => !v)} aria-pressed={openOnly}>● Open to work</button>
                  <button type="button" className={`crew-btn sm${verifiedOnly ? ' on' : ''}`} onClick={() => setVerifiedOnly((v) => !v)} aria-pressed={verifiedOnly}>✓ Verified creators</button>
                </div>
              )}
              {hasFilters && <button type="button" className="crew-btn sm ghost" onClick={clearFilters}>Clear filters</button>}
            </div>
            <div className="crew-panel crew-muted">
              Gear here is a <b>“just have it”</b> deal — no money moves through the site. The ✓ creator badge comes from an approved creator application.
            </div>
          </aside>

          <div className="crew-results">
            {error && <div className="crew-empty">{error}</div>}
            {loadError && !error && <div className="crew-empty">Crew Call couldn’t load just now. Try again in a moment.</div>}

            {tab === 'people' ? (
              <>
                <div className="crew-rhead">
                  <span className="crew-mono">{people.total} {people.total === 1 ? 'person' : 'people'}{roles.length ? ` · ${roles.join(', ')}` : ''}{loading ? ' · updating…' : ''}</span>
                  <span className="crew-mono">{sortNote}</span>
                </div>
                {people.people.length === 0 && !error && (
                  <div className="crew-panel crew-empty">
                    {hasFilters
                      ? 'Nobody matches yet. Widen the distance or clear a filter.'
                      : isSignedIn
                        ? <>No cards yet — be the first. <Link href="/crew/card">Set up your working card</Link> and you’ll show up here.</>
                        : 'No cards yet. Sign in to set up yours and be the first on the board.'}
                  </div>
                )}
                {people.people.map((p) => <PersonCard key={p.userId} p={p} signedIn={isSignedIn} />)}
              </>
            ) : (
              <>
                <div className="crew-rhead">
                  <span className="crew-mono">{gear ? `${gear.total} ${gear.total === 1 ? 'item' : 'items'}` : 'Loading…'}{loading ? ' · updating…' : ''}</span>
                  <span className="crew-mono">{sortNote}</span>
                </div>
                {gear && gear.items.length === 0 && !error && (
                  <div className="crew-panel crew-empty">{hasFilters ? 'No gear matches. Try another category or widen the distance.' : 'No gear listed yet. Add yours on your working card.'}</div>
                )}
                {gear && gear.items.length > 0 && (
                  <div className="crew-gear-grid">
                    {gear.items.map((g) => <GearItem key={g.id} g={g} signedIn={isSignedIn} />)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}

function PersonCard({ p, signedIn }) {
  const gearTop = p.gear.slice(0, 3).map((g) => g.name).join(' · ');
  const where = [p.place, p.miles != null ? `${p.miles} mi` : null].filter(Boolean).join(' · ');
  return (
    <article className="crew-panel crew-person">
      <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} />
      <div style={{ minWidth: 0 }}>
        <div className="crew-pname">
          <Link href={p.profilePath}>{p.displayName}</Link>
          {p.verified && <span className="crew-ver">✓ creator</span>}
          {p.handle && <span className="crew-handle">@{p.handle}</span>}
        </div>
        <div className="crew-pmeta">
          <Availability card={p} />
          {where && <span>{where}{p.travelMiles ? ` · travels ${p.travelMiles} mi` : ''}</span>}
          {p.remoteOk && <span>Remote OK</span>}
          <span>{rateLabel(p)}</span>
          <span>{p.creditCount} {p.creditCount === 1 ? 'credit' : 'credits'} on Studio Tapa</span>
        </div>
        <RoleChips roles={p.roles} />
        {gearTop && <p className="crew-gearline"><b>Gear</b> {gearTop}{p.gear.length > 3 ? ` +${p.gear.length - 3}` : ''}</p>}
        {p.bio && <p className="crew-muted crew-bio">{p.bio}</p>}
      </div>
      <div className="crew-pacts">
        <Link href={p.profilePath} className="crew-btn sm">View profile</Link>
        <MessageLink signedIn={signedIn} userId={p.userId} kind="card" label={`${p.displayName}’s card`} className="crew-btn sm primary">Message</MessageLink>
      </div>
    </article>
  );
}

// "Message" / "Ask about it": opens (or starts) the conversation with the
// person, with what it's about attached. Signed out → the sign-in modal.
function MessageLink({ signedIn, userId, kind, label, className, children }) {
  if (!signedIn) return <SignInButton mode="modal"><button type="button" className={className}>{children}</button></SignInButton>;
  return <Link href={`/messages?to=${encodeURIComponent(userId)}&kind=${kind}&label=${encodeURIComponent(label)}`} className={className}>{children}</Link>;
}

function GearItem({ g, signedIn }) {
  const o = g.owner;
  return (
    <article className="crew-panel crew-gitem">
      <div className="crew-gitem-top"><b>{g.name}</b><span className={`crew-chip ${flagClass(g.flag)}`}>{flagLabel(g.flag)}</span></div>
      <span className="crew-mono">{g.category}</span>
      <div className="crew-owner">
        <Avatar userId={o.userId} name={o.displayName} src={o.avatarUrl} size="sm" />
        <span>{o.displayName}{o.miles != null ? ` · ${o.miles} mi` : o.place ? ` · ${o.place}` : ''}{o.verified ? ' · ✓' : ''}</span>
      </div>
      <div className="crew-actions">
        <MessageLink signedIn={signedIn} userId={o.userId} kind="gear" label={g.name} className="crew-btn sm primary">Ask about it</MessageLink>
        <Link href={o.profilePath} className="crew-btn sm">View profile</Link>
      </div>
    </article>
  );
}
