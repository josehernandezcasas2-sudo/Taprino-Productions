import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../../lib/accountContext';
import { getAllSeries } from '../../lib/series';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { buildWorkList, copyLinkFor, runtimeWords, WORK_TABS, WORK_WORDS } from '../../lib/workListRules';
import { DASH_WORDS } from '../../lib/creatorDashboardRules';
import { REMOVAL_WORDS } from '../../lib/removalRules';
import HeaderNav from '../../components/HeaderNav';
import EditSubmissionModal from '../../components/EditSubmissionModal';
import AdminEditEpisodeModal from '../../components/AdminEditEpisodeModal';
import ArtworkModal from '../../components/ArtworkModal';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import RestoreRequestModal from '../../components/RestoreRequestModal';
import CaptionUploadModal from '../../components/CaptionUploadModal';
import ReplaceVideoModal from '../../components/ReplaceVideoModal';
import RequestEditModal from '../../components/RequestEditModal';
import { pageNotesBoxShows } from '../../components/PageNotesField';
import SellTitleModal from '../../components/creator/SellTitleModal';
import { PayeeModal } from '../../components/show/PayeeCard';
import { ChevronIcon } from '../../components/show/roomBits';
import WorkRow from '../../components/creator/work/WorkRow';
import WorkShowCard from '../../components/creator/work/WorkShowCard';
import Footer from '../../components/Footer';
import MobileTabBar from '../../components/MobileTabBar';
import DashboardTabs from '../../components/creator/DashboardTabs';
import { usePlayerIconOverrides } from '../../components/PlayerIcons';
import { SITE } from '../../lib/siteConfig';

// What the edit box needs about a title of its own: its words now, what
// waits for approval, and where it stands (components/RequestEditModal.js
// works out what each change does from it).
function editValuesFor(s) {
  return {
    id: s.id,
    title: s.title,
    description: s.description || '',
    pageNotes: s.pageNotes || '',
    notesShown: pageNotesBoxShows(s),
    status: s.status,
    held: Boolean(s.held),
    deletionRequested: Boolean(s.deletionRequested),
    withdrawnAt: s.withdrawnAt || null,
    pendingTitle: s.pendingTitle || null,
    pendingDescription: s.pendingDescription || null,
    pendingPageNotes: typeof s.pendingPageNotes === 'string' ? s.pendingPageNotes : null,
    pageNotesWaitReady: s.pageNotesWaitReady !== false,
    hasFlashingLights: s.hasFlashingLights === true,
    // "Allow downloads in the app" (not for a podcast; greyed before 123).
    contentType: s.contentType || null,
    downloadsAllowed: s.downloadsAllowed !== false,
    downloadsAllowedReady: s.downloadsAllowedReady !== false
  };
}

// Your work, revamped (2026-11-15; Jose on the canvas
// https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc: "lets seperat these,
// so they each have their own, films and shorts section", "have the
// sections a drop down so they can continue scrolling down their work",
// "show the series, then make a drop down to see the rest of the seasons
// then the rest of the episodes"; the agreement is
// mockups/work-revamp-contract.md). A tab of the creator Dashboard.
//
// Everything on the page — the tabs and their counts, the sections that
// fold (Shows, Films, Shorts, then Extras / Podcast episodes / Other /
// Vertical when there are any), a show's seasons and episodes, each row's
// pill, meta, need, waiting line, next step and ⋯ menu — is
// lib/workListRules.js buildWorkList; the page reads the three routes,
// draws the model and runs the actions.
//
// A title of its own opens its title dashboard (/creator/title/<id>); a
// show's episode opens its editor. The boxes are the ones the page always
// had: the edit boxes, artwork, replace the video, captions, Sell (with
// `blocked`), Who gets paid (a show's title opens its editor at that card
// instead), ask to remove it. Make it public is the show page's, through
// the same route the Dashboard uses.
//
// Deep links: ?status=pending → In review, ?status=approved → Live,
// ?status=rejected → Not this time, ?attention=1 → Needs you, ?tab=<key>.
// Which sections, shows and seasons are open is kept for the visit in
// sessionStorage (tapa_work_open); the page works without it.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeries(account.userId), getPublicEpisodes()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      allSeries
    }
  };
}

const OPEN_KEY = 'tapa_work_open';
const STATUS_TAB = { pending: 'review', approved: 'live', rejected: 'declined' };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function tabFromQuery(q) {
  const asked = q && typeof q.tab === 'string' ? q.tab : '';
  if (WORK_TABS.some((t) => t.key === asked)) return asked;
  if (q && q.attention === '1') return 'needs';
  if (q && typeof q.status === 'string' && STATUS_TAB[q.status]) return STATUS_TAB[q.status];
  return 'all';
}

function readOpen() {
  try {
    const raw = window.sessionStorage.getItem(OPEN_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const [k, b] of Object.entries(v)) if (typeof b === 'boolean') out[k] = b;
    return out;
  } catch (err) {
    return {};
  }
}

function writeOpen(map) {
  try {
    window.sessionStorage.setItem(OPEN_KEY, JSON.stringify(map));
  } catch (err) {
    // Private windows and blocked storage: the page just forgets.
  }
}

const offline = (err) => err instanceof TypeError;

export default function MyWork({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, allSeries }) {
  const router = useRouter();
  const iconOverrides = usePlayerIconOverrides();

  // --- the three reads ---------------------------------------------------------
  const [submissions, setSubmissions] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ok | failed
  // The viewer's shows (GET /api/show?mine=1): art, kind, where each stands,
  // its count line and season names. null = not answered; the episodes
  // still sit under their show without it.
  const [shows, setShows] = useState(null);
  // Buy to own: this creator's prices keyed "episode:<id>" / "series:<id>"
  // (/api/creator/pricing) and the title the Sell modal is open for.
  const [pricing, setPricing] = useState({ prices: {}, settings: {} });

  async function loadSubmissions() {
    try {
      const res = await fetch('/api/creator/my-submissions');
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.submissions)) {
        setSubmissions(data.submissions);
        setLoadState('ok');
      } else {
        // A failed refresh keeps what is already showing.
        setLoadState((was) => (was === 'ok' ? 'ok' : 'failed'));
      }
    } catch (err) {
      setLoadState((was) => (was === 'ok' ? 'ok' : 'failed'));
    }
  }

  async function loadShows() {
    try {
      const res = await fetch('/api/show?mine=1');
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.shows)) setShows(data.shows);
    } catch (err) {
      // The show cards fall back to what the rows say.
    }
  }

  async function loadPricing() {
    try {
      const res = await fetch('/api/creator/pricing');
      if (res.ok) setPricing(await res.json());
    } catch (err) {
      // The rows just show no price.
    }
  }

  useEffect(() => {
    loadSubmissions();
    loadShows();
    loadPricing();
  }, []);

  function tryAgain() {
    setLoadState('loading');
    loadSubmissions();
    loadShows();
    loadPricing();
  }

  // --- the tab, the search and what is open ------------------------------------
  const [tab, setTab] = useState(() => tabFromQuery(router.query));
  const [query, setQuery] = useState('');
  const [openMap, setOpenMap] = useState({});
  // While a tab or a search is on, everything that matches is open; what
  // the creator folds then is forgotten when the filter changes.
  const [filterOpen, setFilterOpen] = useState({});
  const [openMenu, setOpenMenu] = useState(null); // a row's key

  useEffect(() => { setOpenMap(readOpen()); }, []);

  // A link to the page with another ?tab / ?status / ?attention (the
  // Dashboard's Needs you, the tab row) while it is already open.
  const qTab = router.query.tab;
  const qStatus = router.query.status;
  const qAttention = router.query.attention;
  useEffect(() => {
    setTab(tabFromQuery({ tab: qTab, status: qStatus, attention: qAttention }));
  }, [qTab, qStatus, qAttention]);

  useEffect(() => {
    setFilterOpen({});
    setOpenMenu(null);
  }, [tab, query]);

  function chooseTab(key) {
    setTab(key);
    // In the address too, so Back from a title lands on the same tab.
    const nextQuery = key === 'all' ? {} : { tab: key };
    router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true, scroll: false }).catch(() => {});
  }

  function showEverything() {
    setQuery('');
    chooseTab('all');
  }

  const model = useMemo(
    () => buildWorkList({ submissions, shows, prices: pricing && pricing.prices, tab, query, canEditAll: Boolean(isAdmin) }),
    [submissions, shows, pricing, tab, query, isAdmin]
  );
  const filtering = model.filtering;

  function isOpen(key, dflt, dfltFiltering) {
    if (filtering) return own(filterOpen, key) ? filterOpen[key] : dfltFiltering;
    return own(openMap, key) ? openMap[key] : dflt;
  }

  function flip(key, now) {
    setOpenMenu(null);
    if (filtering) {
      setFilterOpen((m) => ({ ...m, [key]: !now }));
      return;
    }
    setOpenMap((m) => {
      const next = { ...m, [key]: !now };
      writeOpen(next);
      return next;
    });
  }

  // --- what happens on a row ---------------------------------------------------
  const [rowNotes, setRowNotes] = useState({}); // id → { ok, text }
  const [showNotes, setShowNotes] = useState({}); // show id → { ok, text }
  const [copiedId, setCopiedId] = useState(null);
  const [channelBusy, setChannelBusy] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(null);
  const [publishBusy, setPublishBusy] = useState(null);
  const [extractingId, setExtractingId] = useState(null);
  const [extractProgress, setExtractProgress] = useState(null);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const noteRow = (id, note) => setRowNotes((m) => ({ ...m, [id]: note }));

  const [editingSubmission, setEditingSubmission] = useState(null);
  const [fullEditSubmission, setFullEditSubmission] = useState(null);
  const [artworkSubmission, setArtworkSubmission] = useState(null);
  const [deletingSubmission, setDeletingSubmission] = useState(null);
  const [restoringSubmission, setRestoringSubmission] = useState(null); // { s, line }: Ask to bring it back
  const [captionSubmission, setCaptionSubmission] = useState(null);
  const [replacingVideoSubmission, setReplacingVideoSubmission] = useState(null);
  const [editRequestTarget, setEditRequestTarget] = useState(null); // { type, currentValues }
  const [sellTarget, setSellTarget] = useState(null); // { type, id, title, sub }
  // Who gets paid for a title of its own (a show's title opens its editor).
  const [payeeTarget, setPayeeTarget] = useState(null); // { id, title }

  // When a box closes, the focus goes back to what opened it.
  const anyBox = Boolean(editingSubmission || fullEditSubmission || artworkSubmission || deletingSubmission || restoringSubmission || captionSubmission || replacingVideoSubmission || editRequestTarget || sellTarget || payeeTarget);
  const opener = useRef(null);
  const boxWasOpen = useRef(false);
  useEffect(() => {
    if (boxWasOpen.current && !anyBox) {
      const el = opener.current;
      opener.current = null;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    }
    boxWasOpen.current = anyBox;
  }, [anyBox]);
  const openBox = (fn) => {
    // The ⋯ (the menu is closing) or the row's next-step button.
    opener.current = typeof document !== 'undefined' ? document.activeElement : null;
    if (opener.current && opener.current.closest && opener.current.closest('.wk-menu')) {
      const wrap = opener.current.closest('.wk-more-wrap');
      opener.current = wrap ? wrap.querySelector('.wk-more') : null;
    }
    fn();
  };

  async function extractAudio(episodeId) {
    setExtractingId(episodeId);
    setExtractProgress(null);
    noteRow(episodeId, null);
    // Polls every 3s, same cadence as the Cloudflare processing polls
    // used elsewhere (CloudflareHouseAdImport, etc.) — audio extraction
    // runs on Cloudflare's side and this just checks in on it.
    const poll = async () => {
      try {
        const res = await fetch('/api/creator/extract-podcast-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not extract audio.');
        if (data.status === 'ready') {
          setExtractingId(null);
          setExtractProgress(null);
          loadSubmissions();
          return;
        }
        setExtractProgress(data.percentComplete);
        setTimeout(poll, 3000);
      } catch (err) {
        noteRow(episodeId, { ok: false, text: offline(err) ? DASH_WORDS.offline : err.message });
        setExtractingId(null);
        setExtractProgress(null);
      }
    };
    poll();
  }

  async function copyLink(row) {
    const url = copyLinkFor(row, SITE.productionDomain);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      clearTimeout(copyTimer.current);
      // "Link copied" for two seconds, then the menu closes.
      copyTimer.current = setTimeout(() => {
        setCopiedId(null);
        setOpenMenu((k) => (k === row.key ? null : k));
      }, 2000);
    } catch (err) {
      setOpenMenu(null);
      noteRow(row.id, { ok: false, text: `Couldn’t copy the link. It is ${url}` });
    }
  }

  // "Channels can air it" — per title of its own (a show's channels are
  // set on its show page).
  async function setChannelOptIn(type, id, optIn) {
    setChannelBusy(`${type}:${id}`);
    noteRow(id, null);
    try {
      const res = await fetch('/api/creator/channel-opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, optIn })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not change that.');
      setSubmissions((list) => (list || []).map((x) => (x.id === id ? { ...x, channelOptIn: optIn } : x)));
    } catch (err) {
      noteRow(id, { ok: false, text: offline(err) ? DASH_WORDS.offline : err.message });
    } finally {
      setChannelBusy(null);
    }
  }

  // `keep` (migration 124): "Keep the files so I can bring it back later".
  async function requestEpisodeDeletion(reason, { keep = false } = {}) {
    const res = await fetch('/api/creator/request-episode-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId: deletingSubmission.id, action: 'request', reason, ...(keep ? { keep: true } : {}) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit the request.');
    setDeletingSubmission(null);
    loadSubmissions();
  }

  // Ask to bring a removed title back (migration 124): the box's confirm,
  // which shows a thrown line itself; and taking the request back.
  async function askToBringBack(reason) {
    const id = restoringSubmission.s.id;
    const res = await fetch(`/api/show/episode/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', reason })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send the request.');
    setRestoringSubmission(null);
    noteRow(id, { ok: true, text: REMOVAL_WORDS.askBackSent });
    loadSubmissions();
  }

  async function cancelAskBack(episodeId) {
    setCancelBusy(episodeId);
    noteRow(episodeId, null);
    try {
      const res = await fetch(`/api/show/episode/${encodeURIComponent(episodeId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not take the request back.');
      await loadSubmissions();
    } catch (err) {
      noteRow(episodeId, { ok: false, text: offline(err) ? DASH_WORDS.offline : err.message });
    } finally {
      setCancelBusy(null);
    }
  }

  async function cancelEpisodeDeletion(episodeId) {
    setCancelBusy(episodeId);
    noteRow(episodeId, null);
    try {
      const res = await fetch('/api/creator/request-episode-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, action: 'cancel' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel the request.');
      await loadSubmissions();
    } catch (err) {
      noteRow(episodeId, { ok: false, text: offline(err) ? DASH_WORDS.offline : err.message });
    } finally {
      setCancelBusy(null);
    }
  }

  async function makePublic(card) {
    const name = card.makePublic ? card.makePublic.name : card.name;
    if (!window.confirm(DASH_WORDS.makePublicAsk(name))) return;
    setPublishBusy(card.id);
    setShowNotes((m) => ({ ...m, [card.id]: null }));
    try {
      const res = await fetch(`/api/show/${encodeURIComponent(card.id)}/public`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make it public.');
      setShowNotes((m) => ({ ...m, [card.id]: { ok: true, text: `${name} is public. Its approved episodes are on the site; the next ones go live as they’re approved.` } }));
      loadSubmissions();
      loadShows();
    } catch (err) {
      setShowNotes((m) => ({ ...m, [card.id]: { ok: false, text: offline(err) ? DASH_WORDS.offline : err.message } }));
    } finally {
      setPublishBusy(null);
    }
  }

  // A row's next step and its menu items, by key (lib/workListRules.js).
  function onAction(key, row) {
    const s = row.raw;
    switch (key) {
      case 'edit_full': openBox(() => setFullEditSubmission(s)); break;
      case 'edit_submission': openBox(() => setEditingSubmission(s)); break;
      case 'edit_words': openBox(() => setEditRequestTarget({ type: 'episode', currentValues: editValuesFor(s) })); break;
      case 'copy': copyLink(row); break;
      case 'sell':
        openBox(() => setSellTarget({ type: 'episode', id: s.id, title: row.title, sub: [row.code, runtimeWords(s.runtime), row.showName || s.seriesName].filter(Boolean).join(' · ') }));
        break;
      case 'payee': openBox(() => setPayeeTarget({ id: s.id, title: row.title })); break;
      case 'artwork': openBox(() => setArtworkSubmission(s)); break;
      case 'video':
      case 'replace_file': openBox(() => setReplacingVideoSubmission(s)); break;
      case 'captions': openBox(() => setCaptionSubmission(s)); break;
      case 'extract_audio': extractAudio(s.id); break;
      case 'channels': setChannelOptIn('episode', s.id, !s.channelOptIn); break;
      case 'cancel_removal': cancelEpisodeDeletion(s.id); break;
      case 'remove': openBox(() => setDeletingSubmission(s)); break;
      case 'restore': openBox(() => setRestoringSubmission({ s, line: row.pill.label })); break;
      case 'cancel_restore': cancelAskBack(s.id); break;
      default: break;
    }
  }

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  function renderRow(row) {
    return (
      <WorkRow
        key={row.key}
        row={row}
        icons={iconOverrides}
        menuOpen={openMenu === row.key}
        onToggleMenu={() => setOpenMenu((k) => (k === row.key ? null : row.key))}
        onCloseMenu={closeMenu}
        onAction={onAction}
        copied={copiedId === row.id}
        note={rowNotes[row.id] || null}
        busy={{
          channels: channelBusy === `episode:${row.id}`,
          cancelling: cancelBusy === row.id,
          extracting: extractingId === row.id,
          extractPercent: extractingId === row.id ? extractProgress : null
        }}
      />
    );
  }

  function renderSection(sec) {
    const key = `sec:${sec.key}`;
    const open = isOpen(key, sec.openByDefault, true);
    const bodyId = `wk-sec-${sec.key}`;
    const headId = `wk-sec-h-${sec.key}`;
    return (
      <section key={sec.key} className="wk-sec" aria-labelledby={headId}>
        <h2 className="wk-sec-h" id={headId}>
          <button type="button" className="wk-sec-btn" aria-expanded={open ? 'true' : 'false'} aria-controls={bodyId} onClick={() => flip(key, open)}>
            <span className={`wk-chev${open ? ' open' : ''}`}><ChevronIcon size={16} /></span>
            <span>{sec.label}</span>
            <span className="wk-sec-n">{sec.count}</span>
          </button>
          <span className="wk-sec-rule" aria-hidden="true" />
        </h2>
        <div id={bodyId} className="wk-sec-body" hidden={!open}>
          {open && sec.note && <p className="wk-sec-note">{sec.note}</p>}
          {open && sec.shows && sec.shows.map((card) => {
            const showKey = card.key;
            const showOpen = isOpen(showKey, false, card.openByFilter);
            return (
              <WorkShowCard
                key={card.key}
                card={card}
                open={showOpen}
                onToggle={() => flip(showKey, showOpen)}
                seasonOpen={(season) => isOpen(`season:${season.key}`, false, season.rows.length > 0)}
                onToggleSeason={(season, now) => flip(`season:${season.key}`, now)}
                renderRow={renderRow}
                onMakePublic={makePublic}
                publishing={publishBusy === card.id}
                note={showNotes[card.id] || null}
              />
            );
          })}
          {open && sec.rows && <div className="wk-card wk-list">{sec.rows.map(renderRow)}</div>}
        </div>
      </section>
    );
  }

  const loaded = loadState === 'ok' && Array.isArray(submissions);

  let body;
  if (!loaded && loadState === 'loading') {
    body = <p className="wk-card wk-state" role="status">{WORK_WORDS.loading}</p>;
  } else if (!loaded) {
    body = (
      <div className="wk-card wk-state" role="alert">
        <p>{WORK_WORDS.failed}</p>
        <button type="button" className="wk-btn outline" onClick={tryAgain}>{WORK_WORDS.tryAgain}</button>
      </div>
    );
  } else if (model.empty) {
    body = (
      <div className="wk-card wk-state">
        <p>{WORK_WORDS.nothing}</p>
        <Link href="/creator/submit" className="apl-btn wk-head-btn">+ {WORK_WORDS.submit}</Link>
      </div>
    );
  } else if (model.nothingMatches) {
    body = (
      <div className="wk-card wk-state">
        <p>{WORK_WORDS.nothingMatches}</p>
        <button type="button" className="wk-btn outline" onClick={showEverything}>{WORK_WORDS.showEverything}</button>
      </div>
    );
  } else {
    body = model.sections.map(renderSection);
  }

  return (
    <>
      <Head>
        <title>{`Your work — ${SITE.name}`}</title>
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <main id="main-content" className="stage stage-single wk">
        <div className="wk-head">
          <div className="wk-head-text">
            <div className="eyebrow wk-kicker">{WORK_WORDS.kicker}</div>
            <h1 className="wk-h1">{WORK_WORDS.heading}</h1>
            <p className="wk-lede">{WORK_WORDS.lede}</p>
          </div>
          <div className="wk-head-acts">
            <Link href="/creator/show/new" className="apl-btn-secondary wk-head-btn">{WORK_WORDS.newShow}</Link>
            <Link href="/creator/submit" className="apl-btn wk-head-btn">+ {WORK_WORDS.submit}</Link>
          </div>
        </div>

        <DashboardTabs current="work" isCreator={isCreator} isAdmin={isAdmin} />

        <div className="wk-bar">
          <div className="wk-tabs" role="group" aria-label="Which titles">
            {model.tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`wk-tab${tab === t.key ? ' on' : ''}`}
                aria-pressed={tab === t.key ? 'true' : 'false'}
                onClick={() => chooseTab(t.key)}
              >
                {t.label}
                {loaded && <span className="wk-tab-n">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="wk-search">
            <label htmlFor="wk-search" className="visually-hidden">{WORK_WORDS.search}</label>
            <input
              id="wk-search"
              type="search"
              placeholder={WORK_WORDS.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="wk-body">{body}</div>
      </main>
      <Footer />
      <MobileTabBar />

      {editingSubmission && (
        <EditSubmissionModal
          submission={editingSubmission}
          onClose={() => setEditingSubmission(null)}
          onSaved={() => { setEditingSubmission(null); loadSubmissions(); }}
        />
      )}

      {fullEditSubmission && (
        <AdminEditEpisodeModal
          episode={fullEditSubmission}
          allSeries={allSeries}
          // Scoped to this creator's own work rather than the whole site's
          // library (which is what admin.js itself passes in) — bonus
          // content here is meant to extend one of the creator's own
          // standalone pieces, not anyone else's.
          standaloneEpisodes={(submissions || []).filter((sub) => ['movie', 'short'].includes(sub.contentType) && sub.id !== fullEditSubmission.id)}
          onClose={() => setFullEditSubmission(null)}
          onSaved={() => { setFullEditSubmission(null); loadSubmissions(); }}
        />
      )}

      {artworkSubmission && (
        <ArtworkModal
          submission={artworkSubmission}
          onClose={() => setArtworkSubmission(null)}
          onSaved={() => { setArtworkSubmission(null); loadSubmissions(); }}
        />
      )}

      {deletingSubmission && (
        <DeleteRequestModal
          itemLabel={deletingSubmission.title}
          onClose={() => setDeletingSubmission(null)}
          onConfirm={requestEpisodeDeletion}
          keepChoice={deletingSubmission.removalReady === true}
          bought={deletingSubmission.bought === true}
        />
      )}

      {restoringSubmission && (
        <RestoreRequestModal
          itemLabel={restoringSubmission.s.title || 'This title'}
          line={restoringSubmission.line}
          onClose={() => setRestoringSubmission(null)}
          onConfirm={askToBringBack}
        />
      )}

      {replacingVideoSubmission && (
        <ReplaceVideoModal
          submission={replacingVideoSubmission}
          onClose={() => { setReplacingVideoSubmission(null); loadSubmissions(); }}
        />
      )}

      {captionSubmission && (
        <CaptionUploadModal
          submission={captionSubmission}
          onClose={() => setCaptionSubmission(null)}
          onSaved={loadSubmissions}
        />
      )}

      {editRequestTarget && (
        <RequestEditModal
          type={editRequestTarget.type}
          currentValues={editRequestTarget.currentValues}
          onClose={() => setEditRequestTarget(null)}
          onSubmitted={loadSubmissions}
        />
      )}

      {payeeTarget && (
        <PayeeModal
          type="episode"
          id={payeeTarget.id}
          title={payeeTarget.title}
          onClose={() => setPayeeTarget(null)}
          onChanged={() => { loadSubmissions(); loadPricing(); }}
        />
      )}

      {sellTarget && (
        <SellTitleModal
          target={sellTarget}
          price={(pricing.prices || {})[`${sellTarget.type}:${sellTarget.id}`] || null}
          settings={pricing.settings}
          blocked={pricing.blocked ? pricing.blocked[`${sellTarget.type}:${sellTarget.id}`] || null : null}
          isAdmin={isAdmin}
          onClose={() => setSellTarget(null)}
          onSaved={loadPricing}
        />
      )}
    </>
  );
}
