import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import SignInHere from '../../components/SignInHere';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import CrewFilters from '../../components/crew/CrewFilters';
import {
  CallRowItem, PersonRowItem, CastRowItem, GearRowItem, EmptyList, FreeStrip, Nudge,
  IdCardIcon, PlusIcon, SearchIcon, PinIcon, CloseIcon
} from '../../components/crew/CrewDirectory';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getOwnCard, searchCards, searchGear } from '../../lib/crewCards';
import { listCalls, getTrackRecords } from '../../lib/crewCalls';
import { getRoleContext } from '../../lib/roles';
import { hasCapability } from '../../lib/capabilities';
import { GEAR_CATEGORIES } from '../../lib/crewOptions';
import {
  CREW_TABS, TAB_LABELS, CREW_WORDS, tabFromQuery, tabHref, filtersFromQuery, emptyFilters,
  searchPlaceholder, placeChip, filterCount, filtersLabel, clearedFilters, apiPathFor,
  withPlace, urgentBadgePath, urgentChip, productionChip, menuChip, REMOVE_FILTER_HINT
} from '../../lib/crewDirectoryRules';
import { SITE } from '../../lib/siteConfig';

// Crew Call, simpler (Jose, 2026-11-18, the canvas
// https://claude.ai/artifact/NAcrMSstXHTCP2HuysLCjp: "calls should be its
// own tab for now, make it the first page", then "I like both Bs"; the
// build agreement is mockups/crew-call-simpler-contract.md). One page with
// four tabs — Calls (first, the bare /crew), People, Cast, Gear — a title
// row with the card and + Post a call, the search, one row of chips and
// the list. The words, rows and API queries are lib/crewDirectoryRules.js
// (the app's mobile/src/lib/crewDirectoryRules.js is the same file); the
// rows are components/crew/CrewDirectory.js, Filters is
// components/crew/CrewFilters.js, styles are the .ccx-* block.

export async function getServerSideProps({ req, res, query }) {
  // Rates show to signed-in viewers only and the default place is the
  // viewer's own, so this never sits in a shared cache.
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);

  let own = null;
  if (account.isSignedIn) {
    try { own = await getOwnCard(account.userId); } catch (err) { console.error('crew own card:', err.message); }
  }
  const near = own && own.place ? { label: own.place.label, lat: own.place.lat, lng: own.place.lng } : null;
  const tab = tabFromQuery(query || {});
  const filters = filtersFromQuery(query || {}, near);

  // The first answer, for the tab the page opens on only, with the same
  // filters /api/crew/calls or /api/crew/people would apply.
  let initial = null;
  let loadError = false;
  try {
    initial = await firstAnswer(tab, filters, { req, account });
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
      availableNowUntil: own && own.availableNowUntil ? own.availableNowUntil : null,
      tab,
      filters,
      // Next leaves undefined out of props; JSON drops it the same way.
      initial: initial ? JSON.parse(JSON.stringify(initial)) : null,
      loadError,
      // A fresh server render (a real navigation to /crew?…) starts the
      // page over; a tab switch is a shallow replace and keeps it.
      serverKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }
  };
}

const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

async function firstAnswer(tab, f, { req, account }) {
  const viewerId = account.userId || null;
  const point = f.near ? { lat: f.near.lat, lng: f.near.lng, withinMiles: f.within } : {};
  if (tab === 'calls') {
    // One production's calls: a production that isn't public lists them
    // only for its owner, its crew and the team (as the API route).
    let isTeam = false;
    if (f.production && viewerId) {
      const rc = await getRoleContext(req).catch(() => null);
      isTeam = Boolean(rc && (rc.isAdmin || hasCapability(rc, 'handle_flags')));
    }
    return listCalls({
      q: f.q || '',
      role: f.callRole || null,
      payTypes: f.pay,
      remoteOnly: f.remote,
      ...point,
      matches: f.matches,
      production: f.production || null,
      urgentOnly: f.urgent,
      kind: f.kind || null
    }, { viewerId, isAdmin: isTeam });
  }
  if (tab === 'gear') return searchGear({ q: f.q || '', gearCategory: f.gear || null, ...point }, { viewerId });
  const cast = tab === 'cast';
  const result = await searchCards({
    q: f.q || '',
    roles: cast ? [] : f.roles,
    gearCategory: cast ? null : f.gear || null,
    ...point,
    openOnly: f.open,
    freeNow: f.free,
    verifiedOnly: f.verified,
    cast,
    ageMin: cast ? num(f.ageMin) : null,
    ageMax: cast ? num(f.ageMax) : null,
    union: cast ? f.union || null : null
  }, { showRates: account.isSignedIn, viewerId });
  // The track-record tier next to each name (as /api/crew/people).
  const records = await getTrackRecords(result.people.map((p) => p.userId)).catch(() => ({}));
  return {
    ...result,
    people: result.people.map((p) => {
      const r = records[p.userId];
      return r ? { ...p, tier: r.tier, tierLabel: r.tierLabel, done: r.done, jobs: r.jobs, titles: r.titles } : p;
    })
  };
}

// From 900px the page is the laptop layout (the switch on the title row,
// cards in a grid, Filters as a panel under the chips).
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 900px)');
    const set = () => setWide(mq.matches);
    set();
    if (mq.addEventListener) mq.addEventListener('change', set); else mq.addListener(set);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', set); else mq.removeListener(set); };
  }, []);
  return wide;
}

export default function CrewCallPage(props) {
  return <CrewCall key={props.serverKey} {...props} />;
}

function CrewCall({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, hasCard, availableNowUntil, tab: firstTab, filters: firstFilters, initial, loadError }) {
  const router = useRouter();
  const wide = useWide();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  const [tab, setTab] = useState(firstTab);
  // Filters belong to each tab (with its own search text); only the place
  // (near + within) is shared, so "Camera" on Gear never filters People.
  // The opening tab starts from the address (?free=1, ?urgent=1 …).
  const [byTab, setByTab] = useState(() => {
    const o = {};
    for (const t of CREW_TABS) o[t] = t === firstTab ? { ...firstFilters, q: '' } : withPlace(emptyFilters(), firstFilters.near, firstFilters.within);
    return o;
  });
  // Each tab keeps its last answer too.
  const [answers, setAnswers] = useState(() => ({ [firstTab]: initial }));
  const [errors, setErrors] = useState(() => ({ [firstTab]: loadError ? CREW_WORDS.couldNotLoad : null }));
  const [loading, setLoading] = useState({});
  // The red badge: urgent calls near the viewer's place, whatever the Calls
  // tab's search and filters are (one quiet read of urgentBadgePath).
  const firstBadge = urgentBadgePath(firstFilters.near, firstFilters.within);
  const firstIsBadge = firstTab === 'calls' && Boolean(initial) && apiPathFor('calls', firstFilters) === firstBadge;
  const [urgentCount, setUrgentCount] = useState(() => (firstIsBadge ? initial.urgentCount || 0 : 0));
  const [panel, setPanel] = useState(null); // { section, opener }
  const panelNow = useRef(null);
  panelNow.current = panel;
  const byTabRef = useRef(byTab);
  byTabRef.current = byTab;
  const [freeUntil, setFreeUntil] = useState(availableNowUntil);
  const [freeBusy, setFreeBusy] = useState(false);
  const [freeChoosing, setFreeChoosing] = useState(false);
  const [freeError, setFreeError] = useState(null);

  const tabFilters = byTab[tab];
  const path = apiPathFor(tab, tabFilters);
  const badgePath = urgentBadgePath(tabFilters.near, tabFilters.within);
  const badgeRef = useRef(badgePath);
  badgeRef.current = badgePath;
  const answer = answers[tab] || null;
  const total = answer ? answer.total : null;

  // A filter change drops the older links' query (?free=1, ?urgent=1,
  // ?production=…) from the address, so a reload shows what is on screen.
  const keepAddress = useCallback((t) => {
    const want = tabHref(t);
    if (router.asPath !== want) router.replace(want, undefined, { shallow: true, scroll: false });
  }, [router]);

  // A change on this tab; a new place goes to every tab (withPlace).
  const change = useCallback((patch) => {
    setByTab((prev) => {
      const next = { ...prev, [tab]: { ...prev[tab], ...patch } };
      if ('near' in patch || 'within' in patch) {
        const { near, within } = next[tab];
        for (const t of CREW_TABS) next[t] = withPlace(next[t], near, within);
      }
      return next;
    });
    keepAddress(tab);
  }, [keepAddress, tab]);
  const setQ = (v) => setByTab((prev) => ({ ...prev, [tab]: { ...prev[tab], q: v } }));

  // Each tab's list: the server's first answer, then a read 250 ms after
  // the last change (or on switching back to a tab: it draws at once from
  // the last answer and re-reads quietly). Newest answer wins per tab.
  const seq = useRef({ calls: 0, people: 0, cast: 0, gear: 0 });
  const firstRun = useRef(true);
  const lastTab = useRef(firstTab);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (answers[tab] && !errors[tab]) return undefined;
    }
    // A tab switch reads at once; typing and filters wait 250 ms.
    const switched = lastTab.current !== tab;
    lastTab.current = tab;
    const t = tab;
    const id = ++seq.current[t];
    // The list dims at once, so a chip that is already lit never sits over
    // the answer to the one before it.
    setLoading((l) => ({ ...l, [t]: true }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(path, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (id !== seq.current[t]) return;
        if (!res.ok) throw new Error(data.error || CREW_WORDS.couldNotLoad);
        setAnswers((a) => ({ ...a, [t]: data }));
        setErrors((e) => ({ ...e, [t]: null }));
        // Calls with nothing but the place is the badge's own read.
        if (t === 'calls' && path === badgeRef.current) setUrgentCount(data.urgentCount || 0);
      } catch (err) {
        if (id === seq.current[t]) setErrors((e) => ({ ...e, [t]: CREW_WORDS.couldNotLoad }));
      } finally {
        if (id === seq.current[t]) setLoading((l) => ({ ...l, [t]: false }));
      }
    }, switched ? 0 : 250);
    return () => clearTimeout(timer);
    // `answers`/`errors` are read only on the first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, path]);

  // The badge's quiet read: on load (unless the page came with it) and
  // whenever the place changes. When it is what Calls would read anyway,
  // it is kept as Calls' answer too.
  const badgeRun = useRef(false);
  useEffect(() => {
    const first = !badgeRun.current;
    badgeRun.current = true;
    if (first && firstIsBadge) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      fetch(badgePath, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!live || !d) return;
          setUrgentCount(d.urgentCount || 0);
          if (seq.current.calls === 0 && apiPathFor('calls', byTabRef.current.calls) === badgePath) setAnswers((a) => (a.calls ? a : { ...a, calls: d }));
        })
        .catch(() => {});
    }, first ? 0 : 250);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badgePath]);

  function switchTab(next) {
    if (next === tab) return;
    setTab(next);
    setPanel(null);
    setFreeChoosing(false);
    router.replace(tabHref(next), undefined, { shallow: true, scroll: false });
  }

  function onTabKey(e) {
    const i = CREW_TABS.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight') next = CREW_TABS[(i + 1) % CREW_TABS.length];
    else if (e.key === 'ArrowLeft') next = CREW_TABS[(i - 1 + CREW_TABS.length) % CREW_TABS.length];
    else if (e.key === 'Home') next = CREW_TABS[0];
    else if (e.key === 'End') next = CREW_TABS[CREW_TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    switchTab(next);
    const btn = document.getElementById(`ccx-tab-${next}`);
    if (btn) btn.focus();
  }

  // Filters: a chip opens it at its section; the same chip again closes it.
  function openFilters(section, e) {
    const opener = e && e.currentTarget ? e.currentTarget : null;
    if (panel && panel.opener === opener) { closeFilters(true); return; }
    setPanel({ section, opener });
  }
  const closeFilters = useCallback((restore) => {
    const p = panelNow.current;
    setPanel(null);
    if (p && restore && p.opener && typeof p.opener.focus === 'function') {
      const el = p.opener;
      setTimeout(() => el.focus({ preventScroll: true }), 0);
    }
  }, []);
  // Clear all: this tab's filters and its search; the place stays.
  function clearAll() {
    setByTab((prev) => ({ ...prev, [tab]: clearedFilters(tab, prev[tab]) }));
    keepAddress(tab);
  }

  async function setFree(hours) {
    setFreeBusy(true);
    setFreeError(null);
    try {
      const res = await fetch('/api/crew/available-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || CREW_WORDS.couldNotLoad);
      setFreeUntil(data.availableNowUntil || null);
      setFreeChoosing(false);
    } catch (err) {
      setFreeError(err.message);
    } finally {
      setFreeBusy(false);
    }
  }

  const place = placeChip(tabFilters.near, tabFilters.within);
  const count = filterCount(tab, tabFilters);
  const filtered = count > 0 || Boolean(String(tabFilters.q || '').trim()) || Boolean(tabFilters.near && tabFilters.within);
  const list = answer ? (tab === 'gear' ? answer.items : tab === 'calls' ? answer.calls : answer.people) || [] : null;
  const error = errors[tab];
  const busy = Boolean(loading[tab]);
  const firstCall = answers.calls && answers.calls.calls && answers.calls.calls[0];
  const productionLabel = byTab.calls.production ? productionChip(firstCall ? firstCall.productionTitle : '') : null;

  const PlaceChip = (
    <button type="button" className={`ccx-chip${place.on ? ' on' : ''}`} aria-haspopup="dialog" onClick={(e) => openFilters('near', e)}>
      <PinIcon />{place.label}
    </button>
  );
  const FiltersChip = (
    <button type="button" className={`ccx-chip${count ? ' on' : ''}`} aria-haspopup="dialog" onClick={(e) => openFilters(null, e)}>
      {filtersLabel(tab, tabFilters)}
    </button>
  );
  const opens = (label, section, on) => (
    <button type="button" className={`ccx-chip${on ? ' on' : ''}`} aria-haspopup="dialog" onClick={(e) => openFilters(section, e)}>
      {menuChip(label)}
    </button>
  );
  const toggle = (label, key, cls = '') => (
    <button type="button" className={`ccx-chip ${cls}`} aria-pressed={Boolean(tabFilters[key])} onClick={() => change({ [key]: !tabFilters[key] })}>
      {label}
    </button>
  );

  let chips;
  if (tab === 'calls') {
    chips = (
      <>
        {PlaceChip}
        {toggle(urgentChip(urgentCount), 'urgent', 'urgent')}
        {hasCard && toggle(CREW_WORDS.matches, 'matches')}
        {opens(CREW_WORDS.pay, 'pay', tabFilters.pay.length > 0)}
        {productionLabel && (
          <span className="ccx-chip on ccx-prodchip">
            <span className="ccx-prodchip-text">{productionLabel}</span>
            <button type="button" aria-label={REMOVE_FILTER_HINT} title={REMOVE_FILTER_HINT} onClick={() => change({ production: '' })}><CloseIcon size={12} /></button>
          </span>
        )}
        {FiltersChip}
      </>
    );
  } else if (tab === 'people') {
    chips = (
      <>
        {PlaceChip}
        {opens(CREW_WORDS.role, 'role', tabFilters.roles.length > 0)}
        {toggle(CREW_WORDS.freeNow, 'free')}
        {toggle(CREW_WORDS.openToWork, 'open')}
        {FiltersChip}
      </>
    );
  } else if (tab === 'cast') {
    chips = (
      <>
        {PlaceChip}
        {opens(CREW_WORDS.playingAge, 'age', Boolean(tabFilters.ageMin || tabFilters.ageMax))}
        {opens(CREW_WORDS.union, 'union', Boolean(tabFilters.union))}
        {toggle(CREW_WORDS.freeNow, 'free')}
        {FiltersChip}
      </>
    );
  } else {
    chips = (
      <>
        {PlaceChip}
        <span className="ccx-chip-rule" aria-hidden="true" />
        <span className="ccx-cats" role="group" aria-label={CREW_WORDS.category}>
          <button type="button" className="ccx-chip" aria-pressed={!tabFilters.gear} onClick={() => change({ gear: '' })}>{CREW_WORDS.allGear}</button>
          {GEAR_CATEGORIES.map((c) => (
            <button key={c} type="button" className="ccx-chip" aria-pressed={tabFilters.gear === c} onClick={() => change({ gear: c })}>{c}</button>
          ))}
        </span>
      </>
    );
  }

  const cardLabel = hasCard ? CREW_WORDS.yourCard : CREW_WORDS.setUpCard;
  const cardInner = (
    <>
      <IdCardIcon size={20} />
      <span className="ccx-act-label">{cardLabel}</span>
      {isSignedIn && !hasCard && <span className="ccx-act-dot" aria-hidden="true" />}
    </>
  );
  const postInner = (<><PlusIcon size={20} /><span className="ccx-act-label">{CREW_WORDS.postCall}</span></>);

  let side = null;
  if (tab === 'calls') {
    if (isSignedIn && hasCard) {
      side = <FreeStrip until={freeUntil} hydrated={hydrated} busy={freeBusy} choosing={freeChoosing} onChoose={() => setFreeChoosing(true)} onSet={setFree} error={freeError} />;
    } else {
      side = <Nudge signedIn={isSignedIn} />;
    }
  }

  let rows = null;
  if (list && list.length) {
    if (tab === 'calls') rows = list.map((c) => <CallRowItem key={c.id} c={c} />);
    else if (tab === 'people') rows = list.map((p) => <PersonRowItem key={p.userId} p={p} signedIn={isSignedIn} hydrated={hydrated} />);
    else if (tab === 'cast') rows = list.map((p) => <CastRowItem key={p.userId} p={p} signedIn={isSignedIn} hydrated={hydrated} />);
    else rows = list.map((g) => <GearRowItem key={g.id} g={g} signedIn={isSignedIn} />);
  }

  return (
    <>
      <Head>
        <title>{`Crew Call — ${SITE.name}`}</title>
        <meta name="description" content={`Crew calls, people, performers and gear for your next shoot on ${SITE.name}, all near you.`} />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="ccx">
        <div className="ccx-top">
          <h1 className="ccx-title">{CREW_WORDS.title}</h1>
          <div className="ccx-tabs" role="tablist" aria-label={CREW_WORDS.tabsLabel} onKeyDown={onTabKey}>
            {CREW_TABS.map((t) => (
              <button
                key={t}
                id={`ccx-tab-${t}`}
                type="button"
                role="tab"
                className="ccx-tab"
                aria-selected={tab === t}
                aria-controls="ccx-panel"
                tabIndex={tab === t ? 0 : -1}
                aria-label={t === 'calls' && urgentCount ? `${TAB_LABELS.calls}, ${urgentCount} urgent` : undefined}
                onClick={() => switchTab(t)}
              >
                {TAB_LABELS[t]}
                {t === 'calls' && urgentCount > 0 && <span className="ccx-badge" aria-hidden="true">{urgentCount}</span>}
              </button>
            ))}
          </div>
          <div className="ccx-acts">
            {isSignedIn
              ? <Link href="/crew/card" className={`ccx-act card${hasCard ? '' : ' setup'}`} aria-label={cardLabel}>{cardInner}</Link>
              : <SignInHere><button type="button" className="ccx-act card" aria-label={cardLabel}>{cardInner}</button></SignInHere>}
            {isSignedIn
              ? <Link href="/crew/calls/new" className="ccx-act post" aria-label={CREW_WORDS.postCall}>{postInner}</Link>
              : <SignInHere><button type="button" className="ccx-act post" aria-label={CREW_WORDS.postCall}>{postInner}</button></SignInHere>}
          </div>
        </div>

        <div className="ccx-tools">
          <label className="ccx-search">
            <SearchIcon />
            <input
              type="search"
              value={tabFilters.q || ''}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder(tab, total)}
              aria-label={`Search ${TAB_LABELS[tab].toLowerCase()}`}
              autoComplete="off"
            />
            {tabFilters.q && <button type="button" className="ccx-search-clear" onClick={() => setQ('')} aria-label="Clear the search"><CloseIcon size={12} /></button>}
          </label>
          <div className="ccx-chips">{chips}</div>
          {panel && (
            <CrewFilters
              tab={tab}
              f={tabFilters}
              hasCard={hasCard}
              total={total}
              section={panel.section}
              wide={wide}
              opener={panel.opener}
              onChange={change}
              onClear={clearAll}
              onClose={closeFilters}
            />
          )}
        </div>

        <div id="ccx-panel" role="tabpanel" aria-labelledby={`ccx-tab-${tab}`} className={`ccx-body ccx-body-${tab}${side ? ' has-side' : ''}`}>
          {side && <div className="ccx-side">{side}</div>}
          <div className="ccx-main" aria-busy={busy}>
            {error && !list && <div className="ccx-note error" role="alert">{error}</div>}
            {!list && !error && <div className="ccx-loading">{CREW_WORDS.loading}</div>}
            {list && list.length === 0 && (error
              ? <div className="ccx-note error" role="alert">{error}</div>
              : <EmptyList tab={tab} filtered={filtered} signedIn={isSignedIn} hasCard={hasCard} />)}
            {list && list.length > 0 && (
              <>
                {error && <div className="ccx-note error" role="alert">{error}</div>}
                <div className={`ccx-list ccx-list-${tab}${busy ? ' updating' : ''}`}>{rows}</div>
              </>
            )}
            {busy && <span className="ccx-sr" role="status">{CREW_WORDS.updating}</span>}
          </div>
        </div>
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}
