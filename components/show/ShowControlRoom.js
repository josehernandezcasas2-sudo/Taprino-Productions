import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useUpload } from '../../contexts/UploadContext';
import { readVideoMetadata } from '../../lib/videoMetadata';
import {
  compareEpisodes, fileMatches, nextFreeNumber, planMove, positionsFor, renumberFromOne, reorderBody, seasonLabel, undoMoveSteps
} from '../../lib/showRules';
import { SITE } from '../../lib/siteConfig';
import SellTitleModal from '../creator/SellTitleModal';
import EpisodeEditor from './EpisodeEditor';
import ShowEditor from './ShowEditor';
import MoveSheet from './MoveSheet';
import SeasonSection from './SeasonSection';
import AddEpisodesBar, { AddSeveralSheet, DropZone, LinkSheet, QueuePanel, RoomSheet, RssSheet, uploadsFor } from './AddEpisodesBar';
import { ChannelsCard, ExtrasShelf, PREMIUM_WORD, RemoveShowCard, SellCard, ShowCard, ShowStatusCard, countLine } from './ShowCards';
import useSortableRows from './useSortableRows';
import { callApi } from './EditorBits';
import { isWideNow, roomPaths, useWide } from './roomBits';
import { BackArrowIcon, CheckIcon, CloseIcon, InfoIcon, PlusIcon, UndoIcon, WarningIcon } from '../PlayerIcons';
import FactsCard from './admin/FactsCard';
import OwnerCard from './admin/OwnerCard';
import AdminStatusCard from './admin/AdminStatusCard';
import DecisionsCard from './admin/DecisionsCard';
import StagedChangesCard from './admin/StagedChangesCard';
import RemovalCard from './admin/RemovalCard';
import HistoryCard from './admin/HistoryCard';
import PayeeCard from './PayeeCard';
import { extraKindLabel } from '../../lib/extraKinds';

// The show page — one control room for a series or a podcast (the series
// revamp, slice 2; spec Screens "Show page (the control room, creator
// mode)", the Principles, decisions 9, 10, 16, 17 and amendments 1, 6, 8,
// 10, 11, 12, 21, 22; boards Main, ShowStates, ShowLaptop, ShowLaptopDrag,
// AddSeveral). Everything is read from GET /api/show/[id] (lib/showPage.js
// getShowPage) and changed through the /api/show routes
// (mockups/series-slice2-api.md); the rules are lib/showRules.js.
//
// On a phone: one column (the show card, the status card, the Add bar and
// its uploads, the seasons, + Add season, Extras, Sell, the channels
// switch, Remove). From 1024px the stage is 1080px in two columns — left
// 360px sticky (show card, status, sell, channels, remove), right (the Add
// bar, the seasons, Extras) — and a row opens its editor as the 420px
// panel over the right of the stage: the route changes shallowly
// (/creator/show/<id>/episode/<eid>), so a reload or a shared link opens
// the same thing (pages/creator/show/[id]/episode/[episodeId].js renders
// this room with the panel open).
//
// Order: ↑/↓ on a phone, the grip on a mouse (useSortableRows: drag, Alt to
// swap), the E-badge to type a number, the Move sheet; every change is
// planned on the page with planMove, sent once (/reorder inside a season,
// /move across), and answered with a toast that says what moved and offers
// Undo for 8 s. Files dropped on a season become drafts (POST
// /api/show/[id]/episodes) and upload one after another through the queue
// in contexts/UploadContext.js, which keeps going while the creator moves
// around the site.
//
// Props: { showId, mode: 'creator' | 'admin', openEpisodeId, openIsDraft,
// openShowEditor: 'details' | 'art' | null, created }.
//
// mode 'admin' (Admin → Shows, slice 3a: mockups/series-slice3a-contract.md
// §5.2) is the same room inside the admin shell for the team: it also
// reads GET /api/admin/show/[id] (on load, and with every read of the
// show, so after every action, editor save, move and poll) and draws the
// admin cards (components/show/admin/*: About this show, Who runs it,
// Where it stands, Decisions, Waiting for approval, Remove this show,
// History) in place of the creator's status card; rows in review get
// Approve / Reject… inline. The Add bar, drop zones, the upload queue,
// + Add season, Sell and the creator's Remove card are the owner's and
// stay hidden.

const POLL_MS = 20000;
const TOAST_MS = 8000;
const READ_AT_ONCE = 3;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Each file's length, read in the browser (a few at a time).
async function readRuntimes(files) {
  const out = new Array(files.length).fill(null);
  for (let i = 0; i < files.length; i += READ_AT_ONCE) {
    const chunk = files.slice(i, i + READ_AT_ONCE);
    const metas = await Promise.all(chunk.map((f) => withTimeout(readVideoMetadata(f).catch(() => null), 8000)));
    metas.forEach((m, j) => { out[i + j] = m && m.duration ? Math.round(m.duration) : null; });
  }
  return out;
}

function gapRow(season, gap) {
  return { kind: 'gap', id: `gap-${season}-${gap.from}`, season, from: gap.from, to: gap.to, words: gap.from === gap.to ? `E${gap.from} is missing` : `E${gap.from}–E${gap.to} are missing` };
}

// The seasons as the server builds them (lib/showPage.js getShowPage): the
// rows in play order with a gap row where numbers are missing. Used to
// show a move at once, before the server answers.
function rebuildSeasons(view, flat) {
  const kind = view.show.kind;
  const nums = [...new Set(flat.map((r) => Number(r.season) || 1))].sort((a, b) => a - b);
  return nums.map((n) => {
    const inSeason = flat.filter((r) => (Number(r.season) || 1) === n).sort(compareEpisodes);
    const gaps = positionsFor(flat, n, { kind }).gaps;
    const rows = [];
    let g = 0;
    for (const r of inSeason) {
      const num = Number(r.seriesOrder) || null;
      while (g < gaps.length && num !== null && num > gaps[g].to) {
        rows.push(gapRow(n, gaps[g]));
        g += 1;
      }
      rows.push(r);
    }
    while (g < gaps.length) {
      rows.push(gapRow(n, gaps[g]));
      g += 1;
    }
    return { number: n, label: seasonLabel({ seasons: view.show.seasonLabels || [] }, n), rows };
  });
}

function applyWrites(view, writes) {
  const byId = new Map((writes || []).map((w) => [String(w.id), w]));
  const flat = (view.seasons || []).flatMap((s) => s.rows || []).filter((r) => r.kind !== 'gap').map((r) => {
    const w = byId.get(String(r.id));
    if (!w || (w.seriesId && w.seriesId !== view.show.id)) return r;
    const title = typeof r.title === 'string' && r.title.trim() ? r.title : null;
    return { ...r, season: w.season, seriesOrder: w.number, code: `S${w.season} E${w.number}`, displayTitle: title || `Episode ${w.number}` };
  });
  return { ...view, seasons: rebuildSeasons(view, flat) };
}

export default function ShowControlRoom({ showId, mode = 'creator', openEpisodeId = null, openIsDraft = false, openShowEditor = null, created = false }) {
  const router = useRouter();
  const wide = useWide();
  const paths = useMemo(() => roomPaths(mode, showId), [mode, showId]);
  const upload = useUpload();
  const { queue, queuePaused, activeUpload, setQueueHost, enqueueUploads, cancelQueueItem, retryQueueItems } = upload;

  const [phase, setPhase] = useState({ state: 'loading' });
  const [view, setView] = useState(null);
  const viewRef = useRef(null);
  viewRef.current = view;
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [conflicts, setConflicts] = useState({});
  const [rowNotes, setRowNotes] = useState({});
  const [busyRow, setBusyRow] = useState(null);
  const [busy, setBusy] = useState(null);
  const [sending, setSending] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [dropSeason, setDropSeason] = useState(null);
  const [extraSeasons, setExtraSeasons] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [draftInfo, setDraftInfo] = useState({});
  const [myShows, setMyShows] = useState(null);
  const [pricing, setPricing] = useState(null);
  // The Sell modal's title: the whole series (the Sell card) or one of its
  // episodes (a row's "Sell…", slice 3b) — { type, id, title, sub }.
  const [sellTarget, setSellTarget] = useState(null);
  const [createdNote, setCreatedNote] = useState(Boolean(created));
  const dirtyRef = useRef(false);
  const loadingRef = useRef(null);
  const sideRef = useRef(null);
  const isAdminMode = mode === 'admin';
  const [admin, setAdmin] = useState(null);
  const [adminError, setAdminError] = useState(null);
  const adminSeq = useRef(0);

  // --- the admin cards' data (mode 'admin') --------------------------------------
  // The newest answer wins: a slow read never overwrites a later one.
  const loadAdmin = useCallback(async () => {
    if (!isAdminMode) return null;
    adminSeq.current += 1;
    const seq = adminSeq.current;
    const r = await callApi('GET', `/api/admin/show/${encodeURIComponent(showId)}`);
    if (seq !== adminSeq.current) return r;
    if (r.ok) {
      setAdmin(r.data);
      setAdminError(null);
    } else {
      setAdminError(r.error);
    }
    return r;
  }, [isAdminMode, showId]);

  // --- reading the show -------------------------------------------------------
  const load = useCallback(async ({ quiet = false, drafts = false, withAdmin = true } = {}) => {
    // A read already on its way may have left before the change this caller
    // just made: the caller waits for one more read after it (shared by
    // everyone who asks meanwhile), so `await load()` always sees the change.
    const cur = loadingRef.current;
    if (cur) {
      cur.followDrafts = cur.followDrafts || drafts;
      cur.followAdmin = cur.followAdmin || withAdmin;
      if (!cur.follow) cur.follow = cur.promise.catch(() => null).then(() => load({ quiet: true, drafts: cur.followDrafts, withAdmin: cur.followAdmin }));
      return cur.follow;
    }
    const run = { follow: null, followDrafts: false, followAdmin: false, promise: null };
    loadingRef.current = run;
    run.promise = (async () => {
      try {
        // Drafts still processing: their state comes fresh from Cloudflare
        // (the drafts route writes it back) before the show page is read.
        if (drafts) {
          const d = await callApi('GET', `/api/creator/drafts?seriesId=${encodeURIComponent(showId)}`);
          if (d.ok && Array.isArray(d.data.drafts)) {
            setDraftInfo((info) => {
              const next = { ...info };
              for (const x of d.data.drafts) if (x.form && x.form.runtime) next[x.id] = { ...(next[x.id] || {}), runtime: x.form.runtime };
              return next;
            });
          }
        }
        const [r] = await Promise.all([
          callApi('GET', `/api/show/${encodeURIComponent(showId)}`),
          // The admin cards read alongside on the first load and after an
          // action, a save or a move — not on the poll or a return to the
          // tab: each read signs the reviewers' players afresh, which would
          // restart a clip someone is watching.
          isAdminMode && withAdmin ? loadAdmin() : null
        ]);
        if (r.ok) {
          setView(r.data);
          setPhase({ state: 'ready' });
        } else if (!quiet || !viewRef.current) {
          setPhase({ state: 'error', status: r.status, error: r.error });
        }
        return r;
      } finally {
        loadingRef.current = null;
      }
    })();
    return run.promise;
  }, [showId, isAdminMode, loadAdmin]);

  useEffect(() => {
    setPhase({ state: 'loading' });
    setView(null);
    load({ drafts: true });
  }, [load]);

  // This page draws its own uploads: the corner widget stays out of the way.
  useEffect(() => {
    setQueueHost(showId);
    return () => setQueueHost(null);
  }, [showId, setQueueHost]);

  const show = view ? view.show : null;
  const viewer = view ? view.viewer || {} : {};
  const flat = useMemo(() => (view ? (view.seasons || []).flatMap((s) => s.rows || []).filter((r) => r.kind !== 'gap') : []), [view]);
  const planRows = useMemo(() => flat.map((r) => ({ ...r, seriesId: showId })), [flat, showId]);
  const myQueue = useMemo(() => (queue || []).filter((it) => it.showId === showId), [queue, showId]);
  const uploads = useMemo(() => uploadsFor(queue, activeUpload, showId), [queue, activeUpload, showId]);
  const queueLive = myQueue.some((it) => ['queued', 'starting', 'uploading'].includes(it.status));

  // A file finished: the rows catch up (its draft reads Processing, then ready).
  const uploadedCount = myQueue.filter((it) => it.status === 'uploaded').length;
  const lastUploaded = useRef(uploadedCount);
  useEffect(() => {
    if (uploadedCount > lastUploaded.current) {
      const t = setTimeout(() => load({ quiet: true, drafts: true }), 1200);
      lastUploaded.current = uploadedCount;
      return () => clearTimeout(t);
    }
    lastUploaded.current = uploadedCount;
    return undefined;
  }, [uploadedCount, load]);

  // Polled while something is in flux (files processing, an upload running),
  // at most every 20 s and only while the tab is in front.
  const inFlux = useMemo(() => queueLive || flat.some((r) => (r.kind === 'draft' && r.video && ['processing', 'unknown'].includes(r.master)) || (r.kind === 'episode' && r.status === 'pending' && r.master === 'processing')), [flat, queueLive]);
  useEffect(() => {
    if (!inFlux) return undefined;
    const t = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load({ quiet: true, drafts: true, withAdmin: false });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [inFlux, load]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && viewRef.current) load({ quiet: true, withAdmin: false }); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  // The laptop's left column sticks under the header while it fits; a taller
  // one sticks by its foot, so its last card can always be reached.
  const ready = phase.state === 'ready';
  useEffect(() => {
    const el = sideRef.current;
    if (!ready || !el || typeof window === 'undefined') return undefined;
    const header = document.querySelector('header.channel-bar') || document.querySelector('.channel-bar');
    const place = () => {
      if (!window.matchMedia('(min-width: 1024px)').matches) {
        el.style.top = '';
        return;
      }
      const top = (header ? Math.round(header.getBoundingClientRect().height) : 72) + 16;
      el.style.top = `${Math.min(top, window.innerHeight - el.offsetHeight - 16)}px`;
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [ready]);

  // --- the toast --------------------------------------------------------------
  const say = useCallback((next, ms = 6000) => {
    clearTimeout(toastTimer.current);
    setToast(next ? { ...next, id: Date.now(), ms } : null);
    if (next && ms) toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // --- arriving at a row (#ep-<id>, #draft-<id>, a problem line) ---------------
  const flash = useCallback((domId, rowId) => {
    const el = typeof document !== 'undefined' ? document.getElementById(domId) : null;
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // The keyboard goes where the eye goes: a problem line or a link to a
    // row puts the focus on that row (its link, else its first control).
    const target = el.querySelector('a.show-row-main') || [...el.querySelectorAll('a[href], button:not([disabled])')].find((n) => n.getClientRects().length > 0);
    if (target) target.focus({ preventScroll: true });
    setFlashId(rowId);
    setTimeout(() => setFlashId((x) => (x === rowId ? null : x)), 2600);
    return true;
  }, []);
  const arrived = useRef(false);
  useEffect(() => {
    if (!view || arrived.current || typeof window === 'undefined') return;
    arrived.current = true;
    const hash = window.location.hash || '';
    // "Who gets paid" (the Owner card's link, Edit show's line): the card.
    if (hash === '#show-payee') {
      setTimeout(() => {
        const el = document.getElementById('show-payee');
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const btn = el.querySelector('button:not([disabled]), a[href]');
        if (btn) btn.focus({ preventScroll: true });
      }, 120);
      return;
    }
    const m = /^#(ep|draft|gap)-(.+)$/.exec(hash);
    if (m) setTimeout(() => flash(`${m[1]}-${m[2]}`, m[1] === 'gap' ? null : decodeURIComponent(m[2])), 120);
  }, [view, flash]);

  // ?created=1 (New show): say so once, open the drop zone of an empty show.
  useEffect(() => {
    if (!created || !view) return;
    if (!flat.length && !isAdminMode) setDropSeason(1);
    const q = { ...router.query };
    delete q.created;
    router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true, scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, Boolean(view)]);

  // The Sell card: the series' price row and the episodes' prices.
  const isOwner = Boolean(viewer.isOwner);
  const team = Boolean(viewer.teamEdits);
  const canRun = isOwner || team;
  useEffect(() => {
    if (!show || !show.isPublic || !canRun || pricing) return;
    callApi('GET', `/api/creator/pricing?show=${encodeURIComponent(showId)}`).then((r) => { if (r.ok) setPricing(r.data); });
  }, [show, canRun, pricing]);

  // --- routing: the panel on a laptop, the page on a phone -----------------------
  const confirmLeave = () => !dirtyRef.current || window.confirm('Leave without saving your changes?');
  const go = useCallback((target) => {
    const ep = target && target.ep ? target.ep : null;
    const edit = target && target.edit ? target.edit : null;
    const url = ep ? paths.episode(ep, target.draft) : edit ? paths.edit(edit) : paths.base;
    const roomRoute = mode === 'admin' ? '/admin/shows/[id]' : '/creator/show/[id]';
    const routeOf = ep ? `${roomRoute}/episode/[episodeId]` : edit ? `${roomRoute}/edit` : roomRoute;
    if (router.pathname === roomRoute) {
      const query = { id: showId, ...(ep ? { ep, ...(target.draft ? { draft: '1' } : {}) } : {}), ...(edit ? { edit } : {}) };
      router.push({ pathname: roomRoute, query }, url, { shallow: true, scroll: false });
    } else if (router.pathname === routeOf && ep) {
      router.push({ pathname: routeOf, query: { id: showId, episodeId: ep, ...(target.draft ? { draft: '1' } : {}) } }, url, { shallow: true, scroll: false });
    } else {
      router.push(url, undefined, { scroll: false });
    }
  }, [router, paths, mode, showId]);

  const openRow = useCallback((row) => {
    if (!confirmLeave()) return;
    dirtyRef.current = false;
    const draft = row.kind === 'draft';
    if (isWideNow()) go({ ep: row.id, draft });
    else router.push(paths.episode(row.id, draft));
  }, [go, router, paths]);
  const openShow = useCallback((tab) => {
    if (!confirmLeave()) return;
    dirtyRef.current = false;
    if (isWideNow()) go({ edit: tab === 'art' ? 'art' : 'details' });
    else router.push(paths.edit(tab));
  }, [go, router, paths]);
  const closePanel = useCallback(() => {
    dirtyRef.current = false;
    go(null);
  }, [go]);

  const onEditorSaved = useCallback((ep, info = {}) => {
    if (info.movedTo || info.discarded) {
      if (info.discarded && ep && ep.id) cancelQueueItem(ep.id);
      dirtyRef.current = false;
      go(null);
    } else if (info.sentFromDraft && ep && ep.id) {
      go({ ep: ep.id, draft: false });
    }
    load({ quiet: true });
  }, [go, load, cancelQueueItem]);

  // --- rows: who may do what ------------------------------------------------------
  const shows118 = Boolean(view && view.migration && view.migration.shows118);
  const drafts116 = Boolean(view && view.addBar && view.addBar.drafts116);
  const held = Boolean(show && show.held);
  const removal = Boolean(show && show.deletion && show.deletion.requested);
  const declined = Boolean(show && show.status === 'rejected' && !held);
  const vertical = Boolean(show && show.kind === 'vertical');
  const locked = held || removal || (declined && !team) || (vertical && !team);
  const contributor = Boolean(viewer.isContributor && !isOwner && !team);
  const canReorder = canRun && !locked;
  const reorderOpen = canReorder && shows118;
  const closedLine = !show ? null
    : vertical && !team ? 'Vertical series are set up by the studio.'
      : held ? 'Nothing can be added while an admin looks at it.'
        : removal ? 'Its removal is requested — it takes nothing new.'
          : declined && !team ? 'An admin declined this show — resubmit it before adding to it.'
            : null;
  // The team adds nothing from the admin page (drafts made there would be
  // the admin's own); hand entry stays in Library & queues.
  const canAdd = canRun && !locked && !isAdminMode;
  const kind = show ? show.kind : 'series';
  const seasonsShown = useMemo(() => {
    if (!view) return [];
    const list = [...(view.seasons || [])];
    const have = new Set(list.map((s) => s.number));
    for (const n of extraSeasons) if (!have.has(n)) list.push({ number: n, label: seasonLabel({ seasons: view.show.seasonLabels || [] }, n), rows: [], empty: true });
    if (!list.length) list.push({ number: 1, label: seasonLabel({ seasons: view.show.seasonLabels || [] }, 1), rows: [], empty: true });
    return list.sort((a, b) => a.number - b.number);
  }, [view, extraSeasons]);
  const lastSeason = seasonsShown.length ? seasonsShown[seasonsShown.length - 1].number : 1;
  const submitHref = useCallback(({ season, number }) => `/creator/submit?type=${kind === 'podcast' ? 'podcast' : 'series'}&series=${encodeURIComponent(showId)}&season=${season || 1}${number ? `&number=${number}` : ''}`, [kind, showId]);
  const nextFree = useCallback((season) => nextFreeNumber(planRows, season), [planRows]);

  // --- moving rows -------------------------------------------------------------------
  const setNote = (id, note) => setRowNotes((n) => {
    const next = { ...n };
    if (note) next[id] = note;
    else delete next[id];
    return next;
  });
  const clearConflict = (id) => setConflicts((c) => {
    const next = { ...c };
    delete next[id];
    return next;
  });

  const runSteps = useCallback(async (steps) => {
    for (const s of steps) {
      const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/${s.route}`, s.body);
      if (!r.ok) {
        say({ tone: 'warn', title: 'Couldn’t undo that', lines: [r.error] });
        await load({ quiet: true });
        return false;
      }
    }
    // "Undone" once the rows are back where they were, not before.
    await load({ quiet: true });
    say({ tone: 'ok', title: 'Undone' }, 4000);
    return true;
  }, [showId, load, say]);

  const moveToast = useCallback((words, undo, lines = []) => {
    say({ tone: 'ok', title: words || 'Moved', lines: lines.filter(Boolean), undo: undo || null }, TOAST_MS);
  }, [say]);

  const commitPlan = useCallback(async (plan, row) => {
    if (!plan) return;
    if (!plan.ok) {
      setNote(row.id, { tone: 'warn', text: plan.reason });
      return;
    }
    if (plan.code === 'same' || !plan.writes || plan.writes.length === 0) return;
    setNote(row.id, null);
    clearConflict(row.id);
    const body = plan.season !== undefined ? reorderBody(plan.writes) : null;
    setBusyRow(row.id);
    if (body) {
      const before = viewRef.current;
      setView(applyWrites(before, plan.writes));
      const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/reorder`, body);
      setBusyRow(null);
      if (!r.ok) {
        setView(before);
        setNote(row.id, { tone: 'warn', text: r.error });
        say({ tone: 'warn', title: 'Nothing moved', lines: [r.error] });
        if (r.status === 409) load({ quiet: true });
        return;
      }
      const undo = reorderBody(plan.undo);
      moveToast(plan.words || r.data.words, undo ? () => runSteps([{ route: 'reorder', body: undo }]) : null);
      load({ quiet: true });
      return;
    }
    const draft = row.kind === 'draft';
    const to = plan.to || {};
    const moveBody = draft ? { draftId: row.id, toSeason: to.season } : { episodeId: row.id, toSeason: to.season, toNumber: to.number, mode: 'insert' };
    const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/move`, moveBody);
    setBusyRow(null);
    if (!r.ok) {
      setNote(row.id, { tone: 'warn', text: r.error });
      say({ tone: 'warn', title: 'Nothing moved', lines: [r.error] });
      load({ quiet: true });
      return;
    }
    let steps = null;
    if (draft) {
      const from = plan.from || {};
      steps = [{ route: 'move', body: { draftId: row.id, toSeason: from.season || 1, ...(from.number ? { toNumber: from.number } : {}) } }];
    } else steps = undoMoveSteps(r.data.rows, row.id);
    moveToast(r.data.words || plan.words, steps ? () => runSteps(steps) : null, r.data.lines || []);
    load({ quiet: true });
  }, [showId, load, say, moveToast, runSteps]);

  const planFor = useCallback((id, target) => planMove(planRows, id, target), [planRows]);
  const toPlanTarget = useCallback((target) => {
    if (!target) return null;
    if (target.type === 'season') return { season: target.season };
    const other = planRows.find((r) => String(r.id) === String(target.id));
    if (!other) return null;
    if (target.type === 'swap') return { season: Number(other.season) || 1, number: other.seriesOrder, mode: 'swap' };
    return target.before ? { beforeId: other.id } : { afterId: other.id };
  }, [planRows]);

  const { startDrag, draggingId } = useSortableRows({
    enabled: reorderOpen,
    describe: (id, target) => {
      const t = toPlanTarget(target);
      const plan = t ? planFor(id, t) : null;
      if (!plan || !plan.ok || !plan.to) return null;
      const moved = planRows.find((r) => String(r.id) === String(id));
      const cross = moved && (Number(moved.season) || 1) !== plan.to.season;
      return `${cross ? `S${plan.to.season} ` : ''}E${plan.to.number}`;
    },
    onDrop: ({ id, target }) => {
      const row = planRows.find((r) => String(r.id) === String(id));
      const t = toPlanTarget(target);
      if (!row || !t) return;
      commitPlan(planFor(id, t), row);
    }
  });

  const actions = {
    open: openRow,
    startDrag,
    moveBy: (row, delta) => {
      const order = planRows.filter((r) => (Number(r.season) || 1) === (Number(row.season) || 1) && r.inRunningOrder !== false && r.status !== 'rejected' && !r.withdrawnAt).sort(compareEpisodes);
      const idx = order.findIndex((r) => String(r.id) === String(row.id));
      if (idx < 0) return;
      commitPlan(planFor(row.id, idx + delta), row);
    },
    setNumber: (row, n) => {
      const season = Number(row.season) || 1;
      const plan = planFor(row.id, { season, number: n });
      if (!plan.ok && plan.code === 'taken') {
        const swap = plan.choices.includes('swap') ? planFor(row.id, { season, number: n, mode: 'swap' }) : null;
        const insert = planFor(row.id, { season, number: n, mode: 'insert' });
        setConflicts((c) => ({
          ...c,
          [row.id]: {
            number: n,
            holderTitle: plan.holder ? plan.holder.title : null,
            choices: plan.choices,
            lines: [swap && swap.ok ? `Swap: ${swap.words}` : null, insert && insert.ok ? `Insert here: ${insert.words}` : null].filter(Boolean)
          }
        }));
        return;
      }
      commitPlan(plan, row);
    },
    resolveConflict: (row, how) => {
      const c = conflicts[row.id];
      if (!c) return;
      commitPlan(planFor(row.id, { season: Number(row.season) || 1, number: c.number, mode: how }), row);
    },
    clearConflict: (row) => clearConflict(row.id),
    openMove: async (row, e) => {
      const el = e && e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('[data-row-id]') : null;
      const rect = el ? el.getBoundingClientRect() : null;
      setSheet({ kind: 'move', row, rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null });
      if (!myShows) {
        const r = await callApi('GET', team ? '/api/show?all=1' : '/api/show');
        setMyShows(r.ok && Array.isArray(r.data.shows) ? r.data.shows.filter((s) => s.kind !== 'vertical' || team) : []);
      }
    },
    togglePage: async (row) => {
      setBusyRow(row.id);
      const r = await callApi('PATCH', `/api/show/episode/${encodeURIComponent(row.id)}`, { hasPage: !row.hasPage });
      setBusyRow(null);
      if (!r.ok) return say({ tone: 'warn', title: 'Not changed', lines: [r.error] });
      const notSaved = (r.data.notSaved || []).map((x) => x.reason);
      say({ tone: notSaved.length ? 'warn' : 'ok', title: notSaved.length ? 'Not saved' : row.hasPage ? `${row.displayTitle} plays straight from the show` : `${row.displayTitle} has its own page now`, lines: notSaved });
      return load({ quiet: true });
    },
    askRemove: (row) => setSheet({ kind: 'remove', row }),
    // A live episode's price (slice 3b: whoever runs the show prices its
    // episodes, a contributor's included).
    sell: async (row) => {
      if (!pricing) {
        const r = await callApi('GET', `/api/creator/pricing?show=${encodeURIComponent(showId)}`);
        if (r.ok) setPricing(r.data);
      }
      setSellTarget({ type: 'episode', id: row.id, title: row.displayTitle || row.title || 'This episode', sub: [row.code, show ? show.name : null].filter(Boolean).join(' · ') });
    },
    discard: async (row) => {
      if (!window.confirm(`Discard ${row.displayTitle || 'this draft'}? Its uploaded file is deleted too.`)) return;
      cancelQueueItem(row.id);
      setBusyRow(row.id);
      const r = await callApi('DELETE', '/api/creator/drafts', { id: row.id });
      setBusyRow(null);
      if (!r.ok) return say({ tone: 'warn', title: 'Couldn’t discard it', lines: [r.error] });
      say({ tone: 'ok', title: `${row.displayTitle || 'The draft'} is gone` }, 4000);
      return load({ quiet: true });
    },
    pickFile: (row, file) => {
      const resume = fileMatches(file, row);
      enqueueUploads([{ draftId: row.id, file, showId, showName: show ? show.name : null, label: `${row.code || 'Draft'} · ${row.displayTitle}`, endpoint: `/api/creator/get-upload-url?seriesId=${encodeURIComponent(showId)}`, runtimeSeconds: (row.video && row.video.runtimeSeconds) || null, freshStart: !resume }]);
      say({ tone: 'ok', title: resume ? `Resuming ${row.displayTitle}` : `Uploading ${file.name} for ${row.displayTitle}` }, 4000);
    },
    send: async (season, ids) => {
      const created = [];
      const skipped = [];
      let failed = null;
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        setSending({ season, label: ids.length > 10 ? `Sending ${Math.min(i + chunk.length, ids.length)} of ${ids.length}…` : 'Sending…' });
        const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/send`, { draftIds: chunk });
        if (!r.ok) {
          failed = r.error;
          break;
        }
        created.push(...(r.data.created || []));
        skipped.push(...(r.data.skipped || []));
      }
      setSending(null);
      setRowNotes((n) => {
        const next = { ...n };
        for (const s of skipped) next[s.draftId] = { tone: 'warn', text: s.reason };
        return next;
      });
      const lines = [];
      if (skipped.length) lines.push(`${skipped.length} not sent: ${skipped[0].reason}${skipped.length > 1 ? ' (and more on their rows)' : ''}`);
      if (failed) lines.push(failed);
      say({ tone: skipped.length || failed ? 'warn' : 'ok', title: created.length ? `${created.length} sent for review` : 'Nothing was sent', lines }, 7000);
      await load({ quiet: true });
    },
    renameSeason: async (season, name) => {
      const r = await callApi('PATCH', `/api/show/${encodeURIComponent(showId)}/seasons`, { action: 'rename', number: season, label: name.trim() });
      if (!r.ok) return say({ tone: 'warn', title: 'Not renamed', lines: [r.error] });
      say({ tone: 'ok', title: r.data.label ? `It reads “${r.data.label}”` : `Season ${season} has no name now` }, 4000);
      return load({ quiet: true });
    },
    askRenumber: (season) => {
      const plan = renumberFromOne(planRows, season);
      if (!plan.ok) return say({ tone: 'warn', title: 'Can’t renumber it', lines: [plan.reason] });
      if (plan.code === 'same') return say({ tone: 'ok', title: plan.words }, 4000);
      return setConfirm({ season, words: `${plan.words}.`, plan });
    },
    renumber: async (season) => {
      const plan = confirm && confirm.season === season ? confirm.plan : null;
      setBusyRow(`renumber-${season}`);
      const r = await callApi('PATCH', `/api/show/${encodeURIComponent(showId)}/seasons`, { action: 'renumber', number: season });
      setBusyRow(null);
      setConfirm(null);
      if (!r.ok) return say({ tone: 'warn', title: 'Not renumbered', lines: [r.error] });
      const undo = plan ? reorderBody(plan.undo) : null;
      moveToast(r.data.words || (plan && plan.words), undo ? () => runSteps([{ route: 'reorder', body: undo }]) : null);
      return load({ quiet: true });
    },
    cancelConfirm: () => setConfirm(null),
    addSeason: () => {
      const n = lastSeason + 1;
      setExtraSeasons((s) => (s.includes(n) ? s : [...s, n]));
      setDropSeason(n);
    },
    placeExtra: (x) => setSheet({ kind: 'place', extra: x }),

    // --- admin mode: a row in review, a row whose removal is asked ---------
    approveRow: async (row, tier) => {
      setBusyRow(row.id);
      setNote(row.id, null);
      // What the reviewer is looking at (its file): replaced since, the
      // server refuses instead of releasing the new one unseen.
      const inReview = admin && admin.review && admin.review.rows ? admin.review.rows[row.id] : null;
      const r = await callApi('POST', `/api/admin/show/${encodeURIComponent(showId)}`, { action: 'approve', episodeIds: [row.id], tierOverride: tier === 'premium' ? 'premium' : tier === 'free' ? 'free' : 'keep', ...(inReview && inReview.seen ? { seen: { [row.id]: inReview.seen } } : {}) });
      setBusyRow(null);
      if (!r.ok) {
        setNote(row.id, { tone: 'warn', text: r.error });
        say({ tone: 'warn', title: 'Not approved', lines: [r.error] });
        load({ quiet: true });
        return;
      }
      const owner = admin && admin.ownerName ? admin.ownerName : 'its owner';
      say({ tone: 'ok', title: `${row.code ? `${row.code} · ` : ''}${row.displayTitle || 'It'} is approved`, lines: [r.data.showPublic ? 'It’s live now.' : `It stays private until ${owner} makes the show public.`] }, 6000);
      load({ quiet: true });
    },
    rejectRow: async (row, reason) => {
      setBusyRow(row.id);
      setNote(row.id, null);
      const r = await callApi('POST', `/api/admin/show/${encodeURIComponent(showId)}`, { action: 'reject', episodeIds: [row.id], reason });
      setBusyRow(null);
      if (!r.ok) {
        setNote(row.id, { tone: 'warn', text: r.error });
        load({ quiet: true });
        return false;
      }
      say({ tone: 'ok', title: `${row.displayTitle || 'It'} was sent back`, lines: ['The uploader was told why.'] }, 6000);
      load({ quiet: true });
      return true;
    },
    useNumber: async (row, n) => {
      setBusyRow(row.id);
      setNote(row.id, null);
      const r = await callApi('PATCH', `/api/show/episode/${encodeURIComponent(row.id)}`, { season: Number(row.season) || 1, seriesOrder: n });
      setBusyRow(null);
      if (!r.ok) {
        setNote(row.id, { tone: 'warn', text: r.error });
        load({ quiet: true });
        return;
      }
      say({ tone: 'ok', title: `It’s E${n} now` }, 4000);
      load({ quiet: true });
    },
    decideRemoval: async (row, decision) => {
      if (decision === 'confirm' && !window.confirm(`Remove ${row.displayTitle || 'this episode'} for good? Anyone who bought it keeps it.`)) return;
      setBusyRow(row.id);
      setNote(row.id, null);
      const r = await callApi('POST', '/api/admin/resolve-deletion', { type: 'episode', id: row.id, decision });
      setBusyRow(null);
      if (!r.ok) {
        setNote(row.id, { tone: 'warn', text: r.error });
        load({ quiet: true });
        return;
      }
      say({
        tone: 'ok',
        title: decision !== 'confirm' ? `${row.displayTitle || 'It'} stays up` : r.data && r.data.withdrawn ? `${row.displayTitle || 'It'} is off the site` : `${row.displayTitle || 'It'} is removed`,
        lines: decision === 'confirm' && r.data && r.data.withdrawn ? ['Someone bought it, so it’s kept for them.'] : []
      }, 5000);
      load({ quiet: true });
    }
  };

  // An "Approve all" refused for a few rows: their own lines go on them.
  const markProblems = useCallback((problems) => {
    setRowNotes((n) => {
      const next = { ...n };
      for (const id of Object.keys(next)) if (next[id] && next[id].fromBatch) delete next[id];
      for (const p of problems || []) if (p && p.episodeId) next[p.episodeId] = { tone: 'warn', text: p.words || p.error || 'This one can’t be approved yet.', fromBatch: true };
      return next;
    });
  }, []);

  // --- adding files ------------------------------------------------------------------------
  const endpoint = `/api/creator/get-upload-url?seriesId=${encodeURIComponent(showId)}`;
  const queueOf = useCallback((drafts, files, runtimes) => {
    const pool = files.map((f, i) => ({ f, runtime: runtimes[i], used: false }));
    const items = [];
    const info = {};
    for (const d of drafts) {
      const m = pool.find((p) => !p.used && p.f.name === (d.fileName || ''));
      if (!m) continue;
      m.used = true;
      info[d.id] = { runtime: m.runtime || (d.form && d.form.runtime) || null, fileName: m.f.name };
      items.push({ draftId: d.id, file: m.f, showId, showName: show ? show.name : null, label: `${d.code} · ${d.displayTitle}`, endpoint, runtimeSeconds: m.runtime });
    }
    setDraftInfo((x) => ({ ...x, ...info }));
    return items;
  }, [showId, show, endpoint]);

  const addFiles = useCallback(async (files, season, sortBy = 'name') => {
    setSheetBusy(true);
    setSheetError(null);
    const runtimes = await readRuntimes(files);
    const items = files.map((f, i) => ({ videoName: f.name, videoBytes: f.size, runtimeSeconds: runtimes[i] || undefined, lastModified: f.lastModified }));
    const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/episodes`, { season, sortBy, items });
    setSheetBusy(false);
    if (!r.ok) {
      setSheetError(r.error);
      say({ tone: 'warn', title: 'Nothing was added', lines: [r.error] }, 8000);
      return false;
    }
    const drafts = r.data.drafts || [];
    enqueueUploads(queueOf(drafts, files, runtimes));
    const notes = drafts.filter((d) => d.note).map((d) => `${d.fileName || d.displayTitle}: ${d.note}`);
    const skipped = (r.data.skipped || []).map((s) => `${s.name || 'A file'}: ${s.reason}`);
    say({ tone: skipped.length ? 'warn' : 'ok', title: `${drafts.length} added as draft${drafts.length === 1 ? '' : 's'} — uploading one after another`, lines: [...notes, ...skipped].slice(0, 4) }, 7000);
    setSheet(null);
    setDropSeason(null);
    await load({ quiet: true });
    return true;
  }, [showId, enqueueUploads, queueOf, load, say]);

  const resumeFiles = useCallback((pairs) => {
    if (!pairs.length) return;
    enqueueUploads(pairs.map(({ file, row }) => ({ draftId: row.id, file, showId, showName: show ? show.name : null, label: `${row.code || 'Draft'} · ${row.displayTitle}`, endpoint, runtimeSeconds: (row.video && row.video.runtimeSeconds) || null })));
    say({ tone: 'ok', title: pairs.length === 1 ? `Resuming ${pairs[0].row.displayTitle}` : `Resuming ${pairs.length} uploads` }, 4000);
  }, [enqueueUploads, showId, show, endpoint, say]);

  const stoppedDrafts = useMemo(() => flat.filter((r) => r.kind === 'draft' && r.mine && (r.master === 'uploading' || r.master === 'none') && !(uploads[r.id] && ['queued', 'starting', 'uploading', 'uploaded'].includes(uploads[r.id].status))), [flat, uploads]);

  const handleFiles = useCallback((files, season) => {
    if (!view || !drafts116) return;
    const pairs = [];
    const fresh = [];
    for (const f of files) {
      const d = stoppedDrafts.find((r) => fileMatches(f, r) && !pairs.some((p) => p.row.id === r.id));
      if (d) pairs.push({ file: f, row: d });
      else fresh.push(f);
    }
    if (!fresh.length) {
      resumeFiles(pairs);
      return;
    }
    if (fresh.length === 1 && !pairs.length) {
      addFiles(fresh, season);
      return;
    }
    setSheetError(null);
    setSheet({ kind: 'several', files: fresh, resumes: pairs, season });
  }, [view, drafts116, stoppedDrafts, resumeFiles, addFiles]);

  const onResumePicked = useCallback((files) => {
    const pairs = [];
    const unmatched = [];
    for (const f of files) {
      const d = stoppedDrafts.find((r) => fileMatches(f, r) && !pairs.some((p) => p.row.id === r.id));
      if (d) pairs.push({ file: f, row: d });
      else unmatched.push(f.name);
    }
    resumeFiles(pairs);
    if (unmatched.length) say({ tone: 'warn', title: 'Not the same files', lines: [`${unmatched.join(', ')} ${unmatched.length === 1 ? 'isn’t' : 'aren’t'} the file a stopped draft was made from — drop ${unmatched.length === 1 ? 'it' : 'them'} on a season to add new episodes.`] }, 8000);
  }, [stoppedDrafts, resumeFiles, say]);

  // --- the show's own actions --------------------------------------------------------------
  async function makePublic() {
    const noun = kind === 'podcast' ? 'show' : 'series';
    if (!window.confirm(`Make ${show.name} public?\n\nIts approved episodes go on the site now, and the ones approved later go live as they’re approved. This is one-way: a public ${noun} only comes down if you remove it.`)) return;
    setBusy('public');
    const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/public`, {});
    setBusy(null);
    if (!r.ok) {
      say({ tone: 'warn', title: 'Not public yet', lines: [r.error] });
      load({ quiet: true });
      return;
    }
    say({ tone: 'ok', title: `${show.name} is public`, lines: ['Its approved episodes are on the site; the next ones go live as they’re approved.'] }, 8000);
    load({ quiet: true });
  }
  async function askRemoval(action, reason) {
    setBusy('removal');
    const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/removal`, action === 'request' ? { action, reason } : { action });
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: action === 'request' ? 'Not asked' : 'Not cancelled', lines: [r.error] });
    say({ tone: 'ok', title: action === 'request' ? 'Removal requested' : 'Removal cancelled', lines: [action === 'request' ? 'It left the site; we confirm it soon.' : 'It’s back as it was.'] }, 6000);
    return load({ quiet: true });
  }
  async function resubmit() {
    setBusy('resubmit');
    const r = await callApi('PATCH', `/api/show/${encodeURIComponent(showId)}`, { resubmit: true });
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: 'Not sent', lines: [r.error] });
    say({ tone: 'ok', title: 'Sent again', lines: ['It’s not public yet; once an episode is approved you choose when it goes public.'] });
    return load({ quiet: true });
  }
  async function toggleChannels(on) {
    setBusy('channels');
    const r = await callApi('PATCH', `/api/show/${encodeURIComponent(showId)}`, { channelOptIn: on });
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: 'Not changed', lines: [r.error] });
    if (r.data.view) setView(r.data.view);
    say({ tone: 'ok', title: on ? 'Channels may air the whole show' : 'Channels won’t air it' }, 4000);
    return load({ quiet: true });
  }
  // Who gets paid changed (the card, a withdrawn invite): its words, then
  // the page again — the rows' "paid to" and the show card's line follow.
  function onPayeeChanged(next, words) {
    if (next) setView((v) => (v ? { ...v, payee: next } : v));
    if (words) say({ tone: 'ok', title: words }, 7000);
    load({ quiet: true });
  }
  async function cancelStaged(field) {
    setBusy(`staged-${field}`);
    const r = await callApi('DELETE', `/api/show/${encodeURIComponent(showId)}/staged?field=${encodeURIComponent(field)}`);
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: 'Not cancelled', lines: [r.error] });
    say({ tone: 'ok', title: 'Taken back' }, 3000);
    return load({ quiet: true });
  }
  function onProblem(p) {
    // The team decides waiting changes on the Waiting for approval card.
    if (isAdminMode && (p.code === 'staged' || p.code === 'staged-episodes')) {
      const el = document.getElementById('show-adm-staged');
      if (el) {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
    }
    if (p.code === 'staged' || p.code === 'trailer' || p.code === 'trailer-failed') {
      openShow('art');
      return;
    }
    if (p.code === 'gap' && p.from) {
      flash(`gap-${p.season}-${p.from}`, null);
      return;
    }
    const id = (p.episodeIds || [])[0];
    if (!id) return;
    const row = flat.find((r) => String(r.id) === String(id));
    flash(`${row && row.kind === 'draft' ? 'draft' : 'ep'}-${id}`, id);
  }

  // --- the sheets ---------------------------------------------------------------------------
  async function submitLink(url) {
    setSheetBusy(true);
    setSheetError(null);
    const name = (() => {
      try {
        return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'Linked file';
      } catch {
        return 'Linked file';
      }
    })();
    let item = null;
    if (kind === 'podcast') {
      const a = await callApi('POST', '/api/creator/import-audio-url', { audioUrl: url, fileName: name });
      if (!a.ok) {
        setSheetBusy(false);
        setSheetError(a.error);
        return;
      }
      item = { videoName: name, audioUrl: a.data.audioUrl, audioBytes: a.data.audioBytes };
    } else {
      const v = await callApi('POST', '/api/creator/import-video-url', { videoUrl: url, fileName: name });
      if (!v.ok) {
        setSheetBusy(false);
        setSheetError(v.error);
        return;
      }
      item = { videoName: name, videoUid: v.data.uid };
    }
    const r = await callApi('POST', `/api/show/${encodeURIComponent(showId)}/episodes`, { season: lastSeason, items: [item] });
    setSheetBusy(false);
    if (!r.ok) {
      setSheetError(r.error);
      return;
    }
    const d = (r.data.drafts || [])[0];
    const sk = (r.data.skipped || [])[0];
    if (!d) {
      setSheetError(sk ? sk.reason : 'It couldn’t be added.');
      return;
    }
    setSheet(null);
    say({ tone: 'ok', title: `${d.code} · ${d.displayTitle} is a draft`, lines: [kind === 'podcast' ? 'Send it for review from its row.' : 'Cloudflare is fetching the file; send it for review once it’s ready.'] }, 6000);
    load({ quiet: true, drafts: true });
  }
  async function submitRemoval(reason) {
    const row = sheet && sheet.row;
    if (!row) return;
    setSheetBusy(true);
    setSheetError(null);
    const r = await callApi('POST', `/api/show/episode/${encodeURIComponent(row.id)}/removal`, { action: 'request', reason });
    setSheetBusy(false);
    if (!r.ok) {
      setSheetError(r.error);
      return;
    }
    setSheet(null);
    say({ tone: 'ok', title: 'Removal requested', lines: [r.data.hiddenNow ? 'It left the site right away; we confirm it soon.' : 'We confirm it soon.'] }, 6000);
    load({ quiet: true });
  }
  async function placeExtra(parentType, parentId) {
    const x = sheet && sheet.extra;
    if (!x) return;
    setSheetBusy(true);
    setSheetError(null);
    const r = await callApi('PATCH', `/api/show/episode/${encodeURIComponent(x.id)}`, { bonusParentType: parentType, bonusParentId: parentId });
    setSheetBusy(false);
    if (!r.ok) {
      setSheetError(r.error);
      return;
    }
    setSheet(null);
    say({ tone: 'ok', title: parentType === 'series' ? `${x.displayTitle} sits with the show` : 'Placed' }, 4000);
    load({ quiet: true });
  }

  // --- the screen -----------------------------------------------------------------------------
  const panelEpisode = wide && openEpisodeId ? openEpisodeId : null;
  const panelShow = wide && !panelEpisode && openShowEditor ? openShowEditor : null;
  const openRowObj = panelEpisode ? flat.find((r) => String(r.id) === String(panelEpisode)) || (view && (view.extras || []).find((x) => String(x.id) === String(panelEpisode))) : null;

  // The panel stacks Details and Art: "Edit show, Art" (the poster, a
  // problem line, /edit?tab=art) scrolls it to Art once it has drawn.
  useEffect(() => {
    if (panelShow !== 'art') return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById('show-ed-sec-art');
      tries += 1;
      if (el || tries > 30) {
        clearInterval(timer);
        if (el) el.scrollIntoView({ block: 'start' });
      }
    }, 100);
    return () => clearInterval(timer);
  }, [panelShow]);

  // Inside the admin shell the page already has its <main>.
  const Stage = isAdminMode ? 'div' : 'main';
  const stageProps = isAdminMode ? { className: 'show-room-stage is-admin' } : { id: 'main-content', className: 'show-room-stage' };
  const backLink = isAdminMode
    ? <Link href="/admin/shows" className="acct-back show-room-back"><BackArrowIcon size={14} /> All shows</Link>
    : <Link href="/creator" className="acct-back show-room-back"><BackArrowIcon size={14} /> Creator Studio</Link>;

  if (phase.state !== 'ready' || !view) {
    return (
      <Stage {...stageProps}>
        <div className="show-room is-waiting" aria-busy={phase.state === 'loading' ? 'true' : undefined}>
          {backLink}
          {phase.state === 'loading' ? (
            <div className="show-room-skeleton" aria-label="Loading the show"><span /><span /><span /><span /></div>
          ) : (
            <div className="show-room-missing" role="alert">
              <strong>{phase.status === 404 ? 'That show isn’t there' : 'Couldn’t open the show'}</strong>
              <p>{phase.status === 404 ? (isAdminMode ? 'It may have been removed.' : 'It may have been removed, or it belongs to someone else.') : phase.error}</p>
              {phase.status !== 404 && <button type="button" className="apl-btn-secondary" onClick={() => { setPhase({ state: 'loading' }); load(); }}>Try again</button>}
            </div>
          )}
        </div>
      </Stage>
    );
  }

  const ctx = {
    showId,
    mode,
    paths,
    kind,
    showName: show.name,
    showStill: show.art ? show.art.thumbnail : null,
    showPoster: show.art ? show.art.poster : null,
    showPublic: Boolean(show.isPublic),
    isOwner,
    team,
    canRun,
    shows118,
    drafts116,
    canReorder,
    reorderOpen,
    reorderLine: shows118 ? (locked ? closedLine || 'Nothing can be moved right now.' : null) : 'Reordering needs a database update (migration 118)',
    canAdd,
    closedLine,
    canOpen: (row) => (row.kind === 'draft' ? Boolean(row.mine) : Boolean(isOwner || team || row.mine)),
    canMove: (row) => !locked && row.status !== 'rejected' && !row.withdrawnAt && !row.deletionRequested && (row.kind === 'draft' ? Boolean(row.mine) : Boolean(canRun || row.mine)),
    uploads,
    draftInfo,
    conflicts,
    rowNotes,
    busyRow,
    openId: panelEpisode,
    flashId,
    draggingId,
    sending,
    confirm,
    dropSeason,
    lastSeason,
    submitHref,
    nextFree,
    defaultTier: (show.defaults && show.defaults.tier) || null,
    premiumWord: PREMIUM_WORD,
    // Slice 3b: who it pays (rows with a paid account of their own say so)
    // and the runner's "Sell…" on a live row (not on the admin page).
    viewerId: viewer.userId || null,
    canSell: !isAdminMode && (isOwner || Boolean(viewer.isAdmin)) && show.isPublic && !locked && kind !== 'vertical',
    priceOf: (id) => (pricing && pricing.prices ? pricing.prices[`episode:${id}`] || null : null),
    // Admin mode: the rows in review (their place, what blocks them, when
    // the owner last edited them), what this account may do and why not.
    admin: isAdminMode && admin ? {
      rows: (admin.review && admin.review.rows) || {},
      can: admin.can || {},
      needs: admin.needs || {},
      nextFree
    } : null
  };

  const noun = kind === 'podcast' ? 'show' : 'series';
  const sellable = show.isPublic && canRun && !locked && kind !== 'vertical' && !isAdminMode;
  const episodePrices = pricing && pricing.prices
    ? flat.filter((r) => r.kind === 'episode').map((r) => pricing.prices[`episode:${r.id}`]).filter((p) => p && p.status === 'on' && p.price_cents).map((p) => Number(p.price_cents))
    : [];
  const seasonsForSheets = seasonsShown.map((s) => ({ number: s.number, label: s.label }));
  const flashLine = !createdNote ? null
    : isAdminMode ? `${show.name} is set up. ${show.ownerName || 'Its owner'} can add its episodes from Creator Studio.`
      : `${show.name} is ready. Drop its episodes.`;
  const adminAct = (action, body) => callApi('POST', `/api/admin/show/${encodeURIComponent(showId)}`, { action, ...(body || {}) });
  const adminDone = () => load({ quiet: true });
  const adminCards = isAdminMode && admin ? { admin, view, onAction: adminAct, onDone: adminDone, say } : null;

  return (
    <Stage {...stageProps}>
      <Head>
        <title>{isAdminMode ? `${show.name || 'A show'} — Shows — Admin — ${SITE.name}` : `${show.name || 'Your show'} — Your ${noun} — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className={`show-room ${isAdminMode ? 'is-admin' : ''} ${panelEpisode || panelShow ? 'has-panel' : ''}`}>
        <div className="show-room-side" ref={sideRef}>
          {backLink}
          {flashLine && (
            <div className="cs-flash show-room-flash" role="status">
              <CheckIcon size={15} /> <span><strong>{flashLine}</strong></span>
              <button type="button" className="show-room-flash-x" aria-label="Dismiss" onClick={() => setCreatedNote(false)}><CloseIcon size={14} /></button>
            </div>
          )}
          {vertical && !team ? (
            <div className="show-status level-neutral"><h2 className="show-status-head"><InfoIcon size={18} /><span>Vertical series are set up by the studio.</span></h2></div>
          ) : null}
          <ShowCard view={view} canEdit={Boolean(show.canEditShow) && !(vertical && !team)} onEdit={openShow} onCancelStaged={isAdminMode ? null : cancelStaged} busy={busy} />
          {isAdminMode ? (
            adminCards ? (
              <>
                <FactsCard {...adminCards} />
                <OwnerCard {...adminCards} />
                {view.payee && <PayeeCard payee={view.payee} mode="card" onChanged={onPayeeChanged} />}
                <AdminStatusCard {...adminCards} onProblem={onProblem} />
                <DecisionsCard {...adminCards} onProblems={markProblems} />
                <StagedChangesCard {...adminCards} />
              </>
            ) : (
              <div className="show-side-card show-adm-card" role={adminError ? 'alert' : 'status'}>
                {adminError ? (
                  <>
                    <p className="show-adm-error">{adminError}</p>
                    <button type="button" className="apl-btn-secondary show-mini" onClick={() => loadAdmin()}>Try again</button>
                  </>
                ) : <p className="show-adm-line">Loading the team’s cards…</p>}
              </div>
            )
          ) : (
            <ShowStatusCard view={view} contributor={contributor} onProblem={onProblem} onMakePublic={makePublic} onCancelRemoval={canRun || viewer.isAdmin ? () => askRemoval('cancel') : null} onResubmit={canRun ? resubmit : null} busy={busy} />
          )}
          {sellable && <SellCard view={view} episodePrices={episodePrices} onOpen={async () => { if (!pricing) { const r = await callApi('GET', `/api/creator/pricing?show=${encodeURIComponent(showId)}`); if (r.ok) setPricing(r.data); } setSellTarget({ type: 'series', id: showId, title: show.name, sub: countLine(view.seasons) }); }} />}
          {!isAdminMode && view.payee && <PayeeCard payee={view.payee} mode="card" onChanged={onPayeeChanged} />}
          {canRun && !(vertical && !team) && <ChannelsCard view={view} canEdit={canRun} locked={held ? 'Locked while it’s pulled.' : removal ? 'Locked while its removal is requested.' : null} busy={busy === 'channels'} onToggle={toggleChannels} />}
          {!isAdminMode && !(vertical && !team) && <RemoveShowCard view={view} canRequest={isOwner || Boolean(viewer.isAdmin)} busy={busy} onRequest={(reason) => askRemoval('request', reason)} onCancel={() => askRemoval('cancel')} />}
        </div>

        <div className="show-room-main">
          {!isAdminMode && !(vertical && !team) && (
            <AddEpisodesBar
              view={view}
              ctx={ctx}
              onAddSeveral={() => setDropSeason((s) => (s ? null : lastSeason))}
              onLink={() => { setSheetError(null); setSheet({ kind: 'link' }); }}
              onRss={() => setSheet({ kind: 'rss' })}
            />
          )}
          {!isAdminMode && (
            <QueuePanel
              items={myQueue.map((it) => ({ ...it, ...(uploads[it.draftId] || {}), key: it.key, status: it.status, name: it.file ? it.file.name : null }))}
              paused={queuePaused}
              stopped={canAdd ? stoppedDrafts.filter((r) => (r.master === 'uploading' || (r.master === 'none' && r.file)) && !(uploads[r.id] && uploads[r.id].status === 'stopped')).length : 0}
              onRetry={() => retryQueueItems({ showId })}
              onResumeFiles={onResumePicked}
            />
          )}
          {canRun && !shows118 && (
            <p className="show-behind" role="status"><InfoIcon size={15} /> Reordering needs a database update (migration 118)</p>
          )}
          {wide && reorderOpen && flat.length > 1 && (
            <p className="show-drag-hint">Drag by <span className="show-key">⋮⋮</span> · hold <span className="show-key">Alt</span> to swap two episodes · <span className="show-key">↑</span> <span className="show-key">↓</span> keys move a focused row</p>
          )}
          {seasonsShown.map((s) => (
            <SeasonSection key={s.number} season={s} ctx={ctx} actions={actions}>
              {canAdd && drafts116 && (dropSeason === s.number || (s.empty && !flat.length)) && (
                <DropZone season={s.number} label={s.label} onFiles={handleFiles} onClose={flat.length ? () => setDropSeason(null) : null} autoFocus={dropSeason === s.number} />
              )}
              {canAdd && !drafts116 && s.empty && !flat.length && (
                <p className="show-empty-line">Nothing in it yet. <a className="apl-link" href={submitHref({ season: s.number, number: 1 })}>Submit the first episode</a></p>
              )}
            </SeasonSection>
          ))}
          {canAdd && (
            <button type="button" className="show-add-season" onClick={actions.addSeason}>
              <span><PlusIcon size={16} /> Add season</span>
              <small>Season {lastSeason + 1} · kept once its first episode lands</small>
            </button>
          )}
          {((view.extras || []).length > 0 || canAdd) && <ExtrasShelf view={view} ctx={ctx} actions={actions} />}
          {adminCards && <RemovalCard {...adminCards} />}
          {adminCards && <HistoryCard {...adminCards} />}
        </div>
      </div>

      {panelEpisode && (
        <EpisodeEditor
          key={`ep-${panelEpisode}`}
          showId={showId}
          episodeId={panelEpisode}
          isDraft={Boolean(openIsDraft || (openRowObj && openRowObj.kind === 'draft'))}
          mode={mode}
          layout="panel"
          onClose={closePanel}
          onSaved={onEditorSaved}
          onDirtyChange={(d) => { dirtyRef.current = d; }}
        />
      )}
      {panelShow && (
        <ShowEditor
          key="show-editor"
          showId={showId}
          mode={mode}
          layout="panel"
          tab={panelShow}
          onClose={closePanel}
          onSaved={() => load({ quiet: true })}
          onDirtyChange={(d) => { dirtyRef.current = d; }}
        />
      )}

      {sheet && sheet.kind === 'move' && (
        <MoveSheet
          show={{ id: showId, name: show.name, kind, seasons: seasonsForSheets }}
          episode={{ id: sheet.row.id, kind: sheet.row.kind === 'draft' ? 'draft' : 'episode', title: sheet.row.title, displayTitle: sheet.row.displayTitle, season: sheet.row.season, seriesOrder: sheet.row.seriesOrder, code: sheet.row.code, status: sheet.row.status }}
          myShows={myShows}
          anchorRect={wide ? sheet.rect : null}
          onClose={() => setSheet(null)}
          onMoved={(result) => {
            const away = result.toShowId && result.toShowId !== showId;
            const steps = !away && sheet.row.kind !== 'draft' ? undoMoveSteps(result.rows, sheet.row.id) : null;
            moveToast(result.words || 'Moved', steps ? () => runSteps(steps) : null, [...(result.lines || []), away ? 'It’s in the other show now.' : null]);
            load({ quiet: true });
          }}
        />
      )}
      {sheet && sheet.kind === 'several' && (
        <AddSeveralSheet
          files={sheet.files}
          resumes={sheet.resumes || []}
          season={sheet.season}
          seasons={seasonsForSheets}
          rows={planRows}
          showName={show.name}
          onSeason={(n) => setSheet((s) => ({ ...s, season: n }))}
          onClose={() => { setSheet(null); setSheetError(null); }}
          busy={sheetBusy}
          error={sheetError}
          onConfirm={async ({ files, sortBy }) => {
            if (sheet.resumes && sheet.resumes.length) resumeFiles(sheet.resumes);
            await addFiles(files, sheet.season, sortBy);
          }}
        />
      )}
      {sheet && sheet.kind === 'link' && (
        <LinkSheet podcast={kind === 'podcast'} showName={show.name} busy={sheetBusy} error={sheetError} onSubmit={submitLink} onClose={() => { setSheet(null); setSheetError(null); }} />
      )}
      {sheet && sheet.kind === 'rss' && (
        <RssSheet
          showName={show.name}
          onClose={() => { setSheet(null); load({ quiet: true }); }}
          onPreview={(feedUrl) => callApi('POST', '/api/creator/rss-preview', { feedUrl })}
          onImport={(episodes) => callApi('POST', '/api/creator/rss-import', { seriesId: showId, episodes })}
        />
      )}
      {sheet && sheet.kind === 'remove' && (
        <RemoveEpisodeSheet row={sheet.row} live={sheet.row.status === 'approved' && show.isPublic} busy={sheetBusy} error={sheetError} onSubmit={submitRemoval} onClose={() => { setSheet(null); setSheetError(null); }} />
      )}
      {sheet && sheet.kind === 'place' && (
        <RoomSheet title={`Place ${sheet.extra.displayTitle}`} eyebrow={extraKindLabel(sheet.extra.extraKind)} onClose={() => { setSheet(null); setSheetError(null); }} foot={sheetError ? <p className="show-ed-error" role="alert">{sheetError}</p> : null}>
          <div className="show-sheet-block">
            <div className="show-sheet-shows" role="radiogroup" aria-label="Where it sits">
              <button type="button" role="radio" aria-checked={!sheet.extra.anchor ? 'true' : 'false'} className={`show-sheet-show ${!sheet.extra.anchor ? 'on' : ''}`} disabled={sheetBusy} onClick={() => placeExtra('series', showId)}>
                <i aria-hidden="true" /><span><strong>With the show</strong><small>On the show&rsquo;s Extras shelf</small></span>
              </button>
              {flat.filter((r) => r.kind === 'episode' && r.status !== 'rejected').map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={sheet.extra.anchor && sheet.extra.anchor.episodeId === r.id ? 'true' : 'false'} className={`show-sheet-show ${sheet.extra.anchor && sheet.extra.anchor.episodeId === r.id ? 'on' : ''}`} disabled={sheetBusy} onClick={() => placeExtra('episode', r.id)}>
                  <i aria-hidden="true" /><span><strong>After {r.code}</strong><small>{r.displayTitle}</small></span>
                </button>
              ))}
            </div>
          </div>
        </RoomSheet>
      )}
      {sellTarget && pricing && (
        <SellTitleModal
          target={sellTarget}
          price={pricing.prices ? pricing.prices[`${sellTarget.type}:${sellTarget.id}`] || null : null}
          settings={pricing.settings || {}}
          blocked={pricing.blocked ? pricing.blocked[`${sellTarget.type}:${sellTarget.id}`] || null : null}
          isAdmin={Boolean(viewer.isAdmin)}
          onClose={() => setSellTarget(null)}
          onSaved={async () => {
            const r = await callApi('GET', `/api/creator/pricing?show=${encodeURIComponent(showId)}`);
            if (r.ok) setPricing(r.data);
            load({ quiet: true });
          }}
        />
      )}

      <RoomToast toast={toast} onClose={() => say(null)} />
    </Stage>
  );
}

function RemoveEpisodeSheet({ row, live, busy, error, onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <RoomSheet
      title={`Remove ${row.displayTitle}?`}
      eyebrow={row.code || null}
      onClose={onClose}
      foot={(
        <>
          {error && <p className="show-ed-error" role="alert">{error}</p>}
          <div className="show-sheet-actions">
            <button type="button" className="show-danger-btn" disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())}>{busy ? 'Asking…' : 'Ask us to remove it'}</button>
            <button type="button" className="apl-btn-secondary" onClick={onClose}>Keep it</button>
          </div>
        </>
      )}
    >
      <div className="show-sheet-block">
        <p className="show-sheet-help">{live ? 'It is hidden from the site right away while we confirm it. Anyone who bought it keeps it.' : 'We confirm it soon; anyone who bought it keeps it.'}</p>
        <label className="show-ed-label" htmlFor="show-remove-ep-reason">Why?</label>
        <textarea id="show-remove-ep-reason" className="show-ed-textarea is-short" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A line for us" />
      </div>
    </RoomSheet>
  );
}

// "E7 → E3; E3–E6 become E4–E7 · Undo" for 8 s, or what didn't work.
function RoomToast({ toast, onClose }) {
  const [undoing, setUndoing] = useState(false);
  useEffect(() => { setUndoing(false); }, [toast && toast.id]);
  if (!toast) return <div className="show-room-toast-slot" aria-live="polite" />;
  return (
    <div className="show-room-toast-slot" aria-live="polite">
      <div className={`show-room-toast tone-${toast.tone || 'ok'}`} key={toast.id}>
        <span className="show-room-toast-icon" aria-hidden="true">{toast.tone === 'warn' ? <WarningIcon size={16} /> : <CheckIcon size={16} />}</span>
        <div className="show-room-toast-text">
          <strong>{toast.title}</strong>
          {(toast.lines || []).map((l) => <span key={l}>{l}</span>)}
        </div>
        {toast.undo && (
          <button type="button" className="show-room-toast-undo" disabled={undoing} onClick={async () => { setUndoing(true); await toast.undo(); }}>
            <UndoIcon size={15} /> {undoing ? 'Undoing…' : 'Undo'}
          </button>
        )}
        <button type="button" className="show-room-toast-x" aria-label="Dismiss" onClick={onClose}><CloseIcon size={14} /></button>
        {toast.ms ? <span className="show-room-toast-bar" style={{ animationDuration: `${toast.ms}ms` }} aria-hidden="true" /> : null}
      </div>
    </div>
  );
}
