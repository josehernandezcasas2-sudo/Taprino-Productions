import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import PlaceSearch from '../../components/crew/PlaceSearch';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getOwnCard } from '../../lib/crewCards';
import { listPartners } from '../../lib/partners';
import { PARTNER_KINDS, CODE_GATES, WITHIN_CHOICES } from '../../lib/partnerRules';
import { SITE } from '../../lib/siteConfig';

// Resources (Connect, migration 108): the partners a shoot leans on, near
// and far, with the deal each gives Studio Tapa productions and a code
// behind a gate. Admins keep the list on /admin/partners.
const DEFAULT_WITHIN = 50;

export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  // ?kind=paperwork opens one shelf (the production page links here).
  const initialKind = typeof query.kind === 'string' && PARTNER_KINDS[query.kind] ? query.kind : '';
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let near = null;
  if (account.isSignedIn) {
    try { const own = await getOwnCard(account.userId); if (own && own.place) near = { label: own.place.label, lat: own.place.lat, lng: own.place.lng }; } catch (err) { /* none */ }
  }
  let initial = { partners: [], total: 0, counts: {}, rank: 0 };
  try {
    initial = await listPartners({ kind: initialKind || undefined, lat: near ? near.lat : undefined, lng: near ? near.lng : undefined, withinMiles: near ? DEFAULT_WITHIN : 0 }, { viewerId: account.userId || null });
  } catch (err) {
    console.error('resources page:', err.message);
  }
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn, isSubscriber: account.isSubscriber, email: account.email, isAdmin: account.isAdmin, isCreator: account.isCreator,
      near, initial, initialKind
    }
  };
}

const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} miles`);

export default function ResourcesPage({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, near: initialNear, initial, initialKind = '' }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(initialKind);
  const [ships, setShips] = useState(false);
  const [near, setNear] = useState(initialNear);
  const [within, setWithin] = useState(initialNear ? DEFAULT_WITHIN : 0);
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  const reqId = useRef(0);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (kind) params.set('kind', kind);
      if (ships) params.set('ships', '1');
      if (near) { params.set('lat', String(near.lat)); params.set('lng', String(near.lng)); params.set('within', String(within)); }
      try {
        const res = await fetch(`/api/partners?${params.toString()}`);
        const json = await res.json();
        if (id === reqId.current && res.ok) setData(json);
      } catch (err) { /* keep what we have */ } finally { if (id === reqId.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, ships, near, within]);

  const hasFilters = Boolean(q.trim() || kind || ships);
  const kinds = Object.entries(PARTNER_KINDS).filter(([k]) => data.counts[k]);

  return (
    <>
      <Head>
        <title>Resources — {SITE.name}</title>
        <meta name="description" content="Rental houses, post, sound, insurance, permits, festivals and more — with the deal each gives Studio Tapa productions." />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <main id="main-content" className="stage stage-single crew-page">
        <div className="crew-head">
          <div>
            <span className="crew-eyebrow">Connect · Resources</span>
            <h1>Resources & partners</h1>
            <p>The shops and people a shoot leans on — near you and far away — and the deal each gives productions on Studio Tapa. Codes open as you build your record here: a working card, a production, Veteran.</p>
          </div>
          {isAdmin && <Link href="/admin/partners" className="crew-btn">Manage partners</Link>}
        </div>
        <div className="crew-subnav" role="tablist">
          <Link href="/crew" className="crew-tab">Find people</Link>
          <Link href="/locations" className="crew-tab">Locations</Link>
          <Link href="/productions" className="crew-tab">Productions</Link>
          <span className="crew-tab on" aria-current="page">Resources{data.total ? ` · ${data.total}` : ''}</span>
        </div>

        <div className="crew-find res-find">
          <aside className="crew-filters">
            <input type="search" className="crew-input" placeholder="Rental, color, insurance, a name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search resources" />
            <div className="crew-panel crew-filter-panel">
              <div className="crew-field"><span>Near</span>
                <PlaceSearch value={near} onChange={(p) => { setNear(p); if (p && within === 0) setWithin(DEFAULT_WITHIN); }} placeholder="City, or use your location" compact />
                {near && (
                  <select className="crew-select" value={within} onChange={(e) => setWithin(Number(e.target.value))} aria-label="Distance">
                    {WITHIN_CHOICES.map((n) => <option key={n} value={n}>{withinLabel(n)}</option>)}
                  </select>
                )}
              </div>
              <div className="crew-chips">
                <button type="button" className={`crew-btn sm${ships ? ' on' : ''}`} aria-pressed={ships} onClick={() => setShips((v) => !v)}>📦 Ships / remote</button>
                {hasFilters && <button type="button" className="crew-btn sm ghost" onClick={() => { setQ(''); setKind(''); setShips(false); }}>Clear</button>}
              </div>
            </div>
            <div className="crew-panel res-gates">
              <span className="crew-eyebrow">How codes open</span>
              <ul className="cc-rules">
                {Object.entries(CODE_GATES).map(([k, g]) => <li key={k} className={data.rank >= ['public', 'account', 'card', 'production', 'veteran'].indexOf(k) ? 'on' : ''}>{g.label}{data.rank >= ['public', 'account', 'card', 'production', 'veteran'].indexOf(k) ? ' ✓' : ''}</li>)}
              </ul>
              <span className="crew-mono">{!isSignedIn ? 'Sign in to open codes.' : data.rank >= 4 ? 'Everything here is open to you.' : data.rank === 3 ? 'Veteran codes open at three confirmed jobs or released titles.' : data.rank === 2 ? 'Production codes open once you own or join a live production.' : 'Set up your working card to open the next rung.'}</span>
            </div>
            <div className="crew-panel crew-muted">Know a shop that should be here, or run one? <a href={`mailto:${SITE.contactEmail}?subject=Resources%20partner`}>Tell us</a>.</div>
          </aside>

          <div className="crew-results">
            <div className="crew-chips res-kinds">
              <button type="button" className={`crew-tab${!kind ? ' on' : ''}`} onClick={() => setKind('')}>All</button>
              {kinds.map(([k, label]) => <button key={k} type="button" className={`crew-tab${kind === k ? ' on' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>{label} · {data.counts[k]}</button>)}
            </div>
            <div className="crew-rhead">
              <span className="crew-mono">{data.total} {data.total === 1 ? 'partner' : 'partners'}{loading ? ' · updating…' : ''}</span>
              <span className="crew-mono">{near ? `nearest to ${near.label} + ships` : 'featured first'}</span>
            </div>
            {data.partners.length === 0 && (
              <div className="crew-panel crew-empty">{hasFilters || near ? 'Nothing matches. Widen the distance or clear a filter.' : 'No partners listed yet.'}{isAdmin && <> <Link href="/admin/partners">Add the first one</Link>.</>}</div>
            )}
            <div className="res-grid">
              {data.partners.map((p) => <PartnerCard key={p.id} p={p} isSignedIn={isSignedIn} />)}
            </div>
          </div>
        </div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

function PartnerCard({ p, isSignedIn }) {
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/partners/${p.id}/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open that.');
      setCode(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  function copy() {
    navigator.clipboard.writeText(code.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  return (
    <article className={`crew-panel res-card${p.featured ? ' featured' : ''}`}>
      <div className="res-card-top">
        {p.logoUrl ? <img src={p.logoUrl} alt="" className="res-logo" loading="lazy" /> : <span className="res-logo res-logo-ph">{p.name.slice(0, 2).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="res-name">{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name} ↗</a> : p.name}{p.featured && <span className="crew-chip pink">featured</span>}</div>
          <div className="crew-pmeta">
            <span className="crew-chip">{p.kindLabel}</span>
            {p.place && <span>{p.place.label}{p.miles != null ? ` · ${p.miles} mi` : ''}</span>}
            {p.ships && <span>📦 ships / remote</span>}
          </div>
        </div>
      </div>
      {p.blurb && <p className="crew-muted res-blurb">{p.blurb}</p>}
      {p.deal && <div className="res-deal"><span className="crew-eyebrow">The deal</span><b>{p.deal}</b></div>}
      {p.hasCode && (
        <div className="res-code">
          {code ? (
            <>
              <code className="res-code-val">{code.code}</code>
              <button type="button" className="crew-btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              {code.note && <span className="crew-mono">{code.note}</span>}
            </>
          ) : p.canReveal ? (
            <button type="button" className="crew-btn sm primary" disabled={busy} onClick={reveal}>{busy ? 'Opening…' : 'Show the code'}</button>
          ) : !isSignedIn && p.codeGate !== 'public' ? (
            <SignInButton mode="modal"><button type="button" className="crew-btn sm">Sign in for the code</button></SignInButton>
          ) : (
            <span className="res-locked"><span className="crew-chip mute">🔒 {p.gateLabel}</span><span className="crew-mono">{p.gateHint}{p.codeGate === 'card' ? <> <Link href="/crew/card">Set up your card</Link>.</> : p.codeGate === 'production' ? <> <Link href="/productions/new">Start one</Link>.</> : null}</span></span>
          )}
          {err && <span className="crew-status error">{err}</span>}
        </div>
      )}
      {!p.hasCode && p.url && <span className="crew-mono">Mention Studio Tapa when you reach out.</span>}
    </article>
  );
}
