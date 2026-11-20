import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import AvatarPhoto from './AvatarPhoto';
import SignInHere, { SignUpHere } from './SignInHere';
import { keepScrollInside } from '../lib/menuScroll';
import { MENU_LIVE_LINES, MENU_WORDS, countsFresh, keptOpen, siteMenu } from '../lib/siteMenuRules';
import { TYPE_WORDS, makeMain, menuTypes, orderedTypes } from '../lib/accountTypeRules';
import { MainChips, announceAccountTypes, postAccountTypes } from './account/AccountTypeBits';

// The ☰ menu (Jose, 2026-11-18; the canvas
// https://claude.ai/artifact/RFSJUdzGefwe1v11cCJA6M): a full-screen sheet
// on a phone, a 440px drawer from the left on anything wider, over every
// page the header is on. What it holds is lib/siteMenuRules.js; this file
// only draws it. Rendered into <body> through a portal: the header has a
// backdrop-filter, which would make a fixed child fixed to the header
// instead of the screen.

const STORE_KEY = 'tapa_menu_open';
const svg = (children, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS = {
  crew: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14.6c2.3.2 4 1.6 4.8 4.4" /></>,
  'pitch-room': <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>,
  locations: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  productions: <><rect x="3.5" y="9" width="17" height="11" rx="1.5" /><path d="M3.5 9l2-5 15 3-1 2" /><path d="M8.5 5.2l2 3.3M13.5 6.2l2 3" /></>,
  university: <><path d="M2.5 9.5L12 5l9.5 4.5L12 14z" /><path d="M6.5 11.5v4.5c1.5 1.3 3.4 2 5.5 2s4-.7 5.5-2v-4.5" /><path d="M21.5 9.5v5" /></>,
  resources: <><path d="M3.5 12.5V4.5h8l9 9-8 8z" /><circle cx="8" cy="8.5" r="1.4" /></>,
  live: <><rect x="3.5" y="7" width="17" height="12" rx="1.5" /><path d="M8.5 3.5L12 7l3.5-3.5" /><circle cx="12" cy="13" r="1.6" /></>,
  swipe: <><rect x="8" y="4.5" width="11" height="15" rx="2" /><path d="M5 7.5v11a2 2 0 0 0 2 2h8" /></>,
  shop: <><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>,
  series: <><rect x="3.5" y="6" width="17" height="12" rx="1.5" /><path d="M10.5 9.5v5l4-2.5z" /></>,
  films: <><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M8 3.5v17M16 3.5v17M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" /></>,
  podcasts: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></>,
  'my-list': <path d="M12 20s-7.5-4.6-7.5-10a4.2 4.2 0 0 1 7.5-2.6A4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
  'my-recs': <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" />,
  continue: <><circle cx="12" cy="12" r="8.5" /><path d="M10.5 9v6l4.5-3z" /></>,
  vertical: <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10.5 9v5l4-2.5z" /></>,
  'vertical-discover': <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10.5 9v5l4-2.5z" /></>,
  downloads: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  yours: <><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v8" /></>,
  creator: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="5" rx="1" /><rect x="13" y="11" width="7" height="9" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /></>,
  team: <path d="M12 3.5l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9v-5z" />,
  account: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2L18 18M18 6l-1.8 1.8M7.8 16.2L6 18" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.7 9.5a2.4 2.4 0 0 1 4.6.8c0 1.6-2.3 2-2.3 3.5M12 16.8v.2" /></>,
  apply: <><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M8 3.5v17M16 3.5v17M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chev: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  person: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
  logout: <><path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4" /><path d="M10 8l-4 4 4 4M6 12h9" /></>
};
// The tint behind each tile's icon.
const TINT = {
  crew: 'brass', swipe: 'brass', films: 'brass', creator: 'brass',
  'pitch-room': 'gold', resources: 'gold', series: 'gold', 'my-list': 'gold',
  locations: 'mint', university: 'mint', podcasts: 'mint', team: 'mint', continue: 'mint',
  productions: 'sky', shop: 'sky', 'my-recs': 'sky', downloads: 'sky', vertical: 'sky', 'vertical-discover': 'sky',
  live: 'red'
};

// Read at most once per MENU_COUNTS_MAX_AGE_MS while the tab stays open.
let countsCache = { counts: null, at: NaN };
// "Running now" (/api/productions/running), the same two minutes; dropped
// when the menu opens signed out.
let runningCache = { running: null, at: NaN, who: null };
let genresCache = null;

function readOpen() {
  try { return JSON.parse(window.sessionStorage.getItem(STORE_KEY) || '[]'); } catch (err) { return []; }
}
function writeOpen(ids) {
  try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(ids)); } catch (err) { /* private mode */ }
}

export default function SiteMenu({ onClose, onSearch, onSignOut, initialSide, isSignedIn, isSubscriber, roles, settings, ownProfile, profileHref, mainGenres, activeGenre, returnFocus, accountTypes = null }) {
  const [side, setSide] = useState(initialSide);
  const [counts, setCounts] = useState(countsCache.counts);
  const runningWho = isSignedIn && ownProfile && ownProfile.userId ? ownProfile.userId : null;
  const [running, setRunning] = useState(isSignedIn && runningCache.who === runningWho ? runningCache.running : null);
  const [genres, setGenres] = useState(mainGenres && mainGenres.length ? mainGenres : genresCache);
  const [showMore, setShowMore] = useState(false);
  const menu = siteMenu({
    side,
    signedIn: Boolean(isSignedIn),
    roles: roles || {},
    isSubscriber: Boolean(isSubscriber),
    settings,
    counts,
    displayName: ownProfile ? ownProfile.displayName : null,
    profileHref,
    running
  });
  const [openIds, setOpenIds] = useState([]);

  // Account types (migration 126; lib/accountTypeRules.js menuTypes): the
  // line under the name, the main as chips to switch, "+ Add a type". A
  // switch shows at once and is saved a moment later (arrow keys move
  // through the chips the way radio buttons do, so only where they stop is
  // sent); a failed save puts the last saved main back and says so.
  const [types, setTypes] = useState(accountTypes);
  const [typesError, setTypesError] = useState(null);
  const savedTypes = useRef(accountTypes);
  const typesTimer = useRef(null);
  const typesPending = useRef(null);
  const typesInFlight = useRef(false);
  const typesQueued = useRef(null);
  const typesBusy = useRef(false);
  useEffect(() => {
    if (typesBusy.current) return;
    savedTypes.current = accountTypes;
    setTypes(accountTypes);
  }, [accountTypes]);
  // One save at a time, the latest choice next (2026-11-20 review: two in
  // flight could land in either order, and the screen then said one main
  // while the database kept the other). Every answer that saved moves the
  // last-saved copy, so a failure puts back what the database really has.
  const sendTypes = (want) => {
    typesInFlight.current = true;
    postAccountTypes({ types: orderedTypes(want.types, want.main), main: want.main }).then((r) => {
      typesInFlight.current = false;
      if (r.ok) {
        const st = r.state || {};
        savedTypes.current = { types: orderedTypes(st.types, st.main), main: st.main || null, asked: true };
      }
      const next = typesQueued.current;
      if (next) {
        typesQueued.current = null;
        sendTypes(next);
        return;
      }
      typesBusy.current = false;
      if (r.ok) {
        announceAccountTypes(savedTypes.current);
      } else {
        setTypes(savedTypes.current);
        setTypesError(TYPE_WORDS.failed);
      }
    });
  };
  const saveTypes = (want) => {
    if (typesInFlight.current) typesQueued.current = want;
    else sendTypes(want);
  };
  const pickMain = (type) => {
    if (!types) return;
    const want = { ...types, ...makeMain(types, type) };
    setTypes(want);
    setTypesError(null);
    typesBusy.current = true;
    clearTimeout(typesTimer.current);
    typesPending.current = want;
    typesTimer.current = setTimeout(() => { typesTimer.current = null; typesPending.current = null; saveTypes(want); }, 350);
  };
  // Closing the menu with a switch still waiting sends it at once.
  useEffect(() => () => {
    clearTimeout(typesTimer.current);
    const p = typesPending.current;
    if (p) { typesPending.current = null; saveTypes(p); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mt = isSignedIn && types ? menuTypes(types) : null;
  useEffect(() => { setOpenIds(keptOpen(readOpen(), menu.sections)); }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const backdropRef = useRef(null);
  const closeRef = useRef(null);

  // The live lines: one cached public read as the menu opens.
  useEffect(() => {
    if (!MENU_LIVE_LINES || countsFresh(countsCache.at)) return undefined;
    let live = true;
    fetch('/api/menu-counts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.counts) return;
        countsCache = { counts: d.counts, at: Date.now() };
        if (live) setCounts(d.counts);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // "Running now": the productions this person runs, read as the menu
  // opens (signed in), at most every two minutes.
  useEffect(() => {
    if (!isSignedIn) { runningCache = { running: null, at: NaN, who: null }; setRunning(null); return undefined; }
    // Kept for the same account only (another sign-in in this tab reads again).
    if (runningCache.who === runningWho && countsFresh(runningCache.at)) { setRunning(runningCache.running); return undefined; }
    let live = true;
    fetch('/api/productions/running', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.items)) return;
        runningCache = { running: d, at: Date.now(), who: runningWho };
        if (live) setRunning(d);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [isSignedIn, runningWho]);

  // The genres for the Stream side: the page's own list when it has one
  // (the Stream pages pass it), else the public list once per tab.
  useEffect(() => {
    if (side !== 'stream' || (genres && genres.length)) return undefined;
    let live = true;
    fetch('/api/genres')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d && Array.isArray(d.genres) ? d.genres.filter((g) => typeof g === 'string' && g) : [];
        genresCache = list;
        if (live) setGenres(list);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus moves into the menu and stays there (Tab wraps), and goes back
  // to the ☰ when it closes. A wheel or a drag over the backdrop, or past
  // either end of the list, never moves the page behind.
  useEffect(() => {
    const panel = panelRef.current;
    if (closeRef.current) closeRef.current.focus();
    const onKey = (e) => {
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll('a[href], button:not([disabled])')].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const releaseBody = keepScrollInside(bodyRef.current);
    const releaseBack = keepScrollInside(backdropRef.current);
    const back = returnFocus;
    return () => {
      document.removeEventListener('keydown', onKey);
      releaseBody();
      releaseBack();
      if (back && back.current && typeof back.current.focus === 'function') back.current.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id) {
    setOpenIds((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      writeOpen(next);
      return next;
    });
  }

  const go = () => onClose();
  const tileEl = (t) => {
    const inner = (
      <>
        <span className={`sm-tile-icon tint-${TINT[t.id] || 'brass'}`}>{svg(ICONS[t.id] || ICONS.series, 19)}</span>
        <span className="sm-tile-text">
          <span className="sm-tile-label">{t.label}</span>
          <span className={`sm-tile-line${t.live ? ' live' : ''}`}>{t.dot && <i className="sm-dot" aria-hidden="true" />}{t.line}</span>
        </span>
      </>
    );
    return t.external
      ? <a key={t.id} href={t.href} target="_blank" rel="noopener noreferrer" className="sm-tile" data-tile={t.id} onClick={go}>{inner}</a>
      : <Link key={t.id} href={t.href} className="sm-tile" data-tile={t.id} onClick={go}>{inner}</Link>;
  };

  const p = menu.profile;
  const node = (
    <div className="site-menu-root">
      <div ref={backdropRef} className="site-menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="site-menu" role="dialog" aria-modal="true" aria-label={MENU_WORDS.title}>
        <div className="sm-top">
          <h2 className="sm-title">{MENU_WORDS.title}</h2>
          <div className="sm-top-actions">
            <button type="button" className="sm-round" aria-label={MENU_WORDS.search} onClick={onSearch}>{svg(ICONS.search, 17)}</button>
            <button ref={closeRef} type="button" className="sm-round" aria-label={MENU_WORDS.close} onClick={onClose}>{svg(ICONS.close, 17)}</button>
          </div>
        </div>
        <div ref={bodyRef} className="sm-body">
          {p ? (
            <div className="sm-card sm-you">
              <Link href={p.href} className="sm-you-row" onClick={go}>
                <AvatarPhoto
                  url={ownProfile ? ownProfile.avatarUrl : null}
                  position={ownProfile ? ownProfile.avatarPosition : null}
                  zoom={ownProfile ? ownProfile.avatarZoom : null}
                  className="sm-you-photo"
                >
                  {(p.name[0] || '?').toUpperCase()}
                </AvatarPhoto>
                <span className="sm-you-text">
                  <span className="sm-you-name">{p.name}</span>
                  <span className="sm-you-sub">{p.sub}</span>
                </span>
                <span className="sm-chev">{svg(ICONS.chev, 18)}</span>
              </Link>
              {mt && (mt.line || mt.chips.length > 0 || mt.add) && (
                <div className="sm-you-types">
                  {mt.line && <div className="sm-you-typeline">{mt.line}</div>}
                  {mt.chips.length > 0 && <span id="sm-you-main-label" className="sm-you-main-label">{mt.label}</span>}
                  {(mt.chips.length > 0 || mt.add) && (
                    <div className="sm-you-chips">
                      {mt.chips.length > 0 && <MainChips items={mt.chips} labelledBy="sm-you-main-label" className="sm-you-radios" chipClass="sm-type-chip" onPick={pickMain} />}
                      {mt.add && <Link href={mt.add.href} className="sm-type-add" onClick={go}>{mt.add.label}</Link>}
                    </div>
                  )}
                  {mt.note && <p className="sm-you-note">{mt.note}</p>}
                  {typesError && <p className="sm-you-err" role="alert">{typesError}</p>}
                </div>
              )}
              <div className="sm-you-plan">
                <span className={isSubscriber ? 'member' : ''}>{p.plan}</span>
                {p.join && <Link href={p.join.href} className="sm-join" onClick={go}>{p.join.label}</Link>}
              </div>
            </div>
          ) : (
            <div className="sm-card sm-out">
              <div className="sm-out-row">
                <span className="sm-out-photo">{svg(ICONS.person, 22)}</span>
                <span className="sm-you-text">
                  <span className="sm-you-name">{MENU_WORDS.signedOutTitle}</span>
                  <span className="sm-you-sub">{MENU_WORDS.signedOutLine}</span>
                </span>
              </div>
              <div className="sm-out-buttons">
                <SignInHere><button type="button" className="sm-btn primary" onClick={onClose}>{MENU_WORDS.signIn}</button></SignInHere>
                <SignUpHere><button type="button" className="sm-btn" onClick={onClose}>{MENU_WORDS.createAccount}</button></SignUpHere>
              </div>
            </div>
          )}

          {menu.running && (
            <section className="sm-card sm-running" aria-label={menu.running.title}>
              <div className="sm-running-head"><span className="sm-running-title">{menu.running.title}</span><span className="sm-running-count">{menu.running.count}</span></div>
              {menu.running.items.map((r) => (
                <div key={r.id} className="sm-running-row">
                  <span className="sm-running-text">
                    <span className="sm-running-name">{r.title}</span>
                    <span className="sm-running-line">{r.line}{r.needs && <>{r.line ? ' · ' : ''}<b>{r.needs}</b></>}</span>
                  </span>
                  <Link href={r.href} className={`sm-running-open${r.primary ? ' primary' : ''}`} onClick={go} aria-label={`${r.open} ${r.title}`}>{r.open}</Link>
                </div>
              ))}
              <Link href={menu.running.all.href} className="sm-running-all" onClick={go}>{menu.running.all.label} ›</Link>
            </section>
          )}

          <div className="sm-sides" role="group" aria-label={MENU_WORDS.sides}>
            <button type="button" className={`sm-side connect${side === 'connect' ? ' on' : ''}`} aria-pressed={side === 'connect'} onClick={() => { setSide('connect'); setShowMore(false); }}>{MENU_WORDS.connect}</button>
            <button type="button" className={`sm-side stream${side === 'stream' ? ' on' : ''}`} aria-pressed={side === 'stream'} onClick={() => { setSide('stream'); setShowMore(false); }}>{MENU_WORDS.stream}</button>
          </div>
          <Link href={menu.home.href} className="sm-home" onClick={go}>{menu.home.label} <span aria-hidden="true">→</span></Link>

          <div className="sm-grid">
            {menu.tiles.map(tileEl)}
            {showMore && menu.more.map(tileEl)}
          </div>
          {menu.more.length > 0 && (
            <button type="button" className="sm-more" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
              {showMore ? MENU_WORDS.seeLess : MENU_WORDS.seeMore}
            </button>
          )}

          {menu.genres && genres && genres.length > 0 && (
            <div className="sm-card sm-genres">
              <div className="sm-genres-title">{MENU_WORDS.genres}</div>
              <div className="sm-chips">
                {genres.map((g) => (
                  <Link key={g} href={`/genre/${encodeURIComponent(g)}`} className={`sm-chip${activeGenre === g ? ' on' : ''}`} onClick={go}>{g}</Link>
                ))}
              </div>
            </div>
          )}

          {menu.apply && (
            <Link href={menu.apply.href} className="sm-card sm-apply" onClick={go}>
              <span className="sm-section-icon tint-brass">{svg(ICONS.apply, 18)}</span>
              <span className="sm-you-text">
                <span className="sm-section-title">{menu.apply.title}</span>
                <span className="sm-section-summary">{menu.apply.line}</span>
              </span>
              <span className="sm-chev">{svg(ICONS.chev, 16)}</span>
            </Link>
          )}

          {menu.sections.map((s) => {
            const open = openIds.includes(s.id);
            return (
              <div key={s.id} className={`sm-card sm-section${open ? ' open' : ''}`} data-section={s.id}>
                <button type="button" className="sm-section-head" aria-expanded={open} aria-controls={`sm-rows-${s.id}`} onClick={() => toggle(s.id)}>
                  <span className={`sm-section-icon tint-${TINT[s.id] || 'plain'}`}>{svg(ICONS[s.id], 18)}</span>
                  <span className="sm-you-text">
                    <span className="sm-section-title">{s.title}</span>
                    {!open && <span className="sm-section-summary">{s.summary}</span>}
                  </span>
                  <span className="sm-caret">{svg(ICONS.down, 18)}</span>
                </button>
                {open && (
                  <div id={`sm-rows-${s.id}`} className="sm-rows">
                    {s.rows.map((r) => (
                      <Link key={r.href} href={r.href} className="sm-row" onClick={go}>
                        <span>{r.label}</span>
                        <span className="sm-chev">{svg(ICONS.chev, 15)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {menu.logout && (
            <button type="button" className="sm-logout" onClick={onSignOut}>{svg(ICONS.logout, 17)}{MENU_WORDS.logout}</button>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(node, document.body);
}
