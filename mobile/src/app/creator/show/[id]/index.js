import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import {
  compareEpisodes, fileMatches, nextFreeNumber, planMove, positionsFor, renumberFromOne, reorderBody, seasonLabel, undoMoveSteps
} from '../../../../lib/showRules';
import { migrationRefusal, showCall, showPath } from '../../../../lib/showApi';
import { assetFile, assetName, assetRuntime, cancelShowUpload, enqueueShowUploads, retryShowUploads, useShowQueue } from '../../../../lib/showUploadQueue';
import { freshToken } from '../../../../lib/api';
import { absoluteFill, colors, fonts, inkTint, okTint } from '../../../../lib/theme';
import { AccountFrame } from '../../../../components/account/AccountBits';
import { PrimaryButton, pickVideo, pickVideos } from '../../../../components/CreatorBits';
import SellTitleSheet from '../../../../components/SellTitleSheet';
import { CloseIcon, PencilIcon, TrashIcon } from '../../../../components/WorkIcons';
import {
  ActionSheet, Behind, CheckIcon, LinkText, PREMIUM_WORD, PlusIcon, RoomToast, SmallButton,
  countLine, episodeEditorRoute, episodePublicRoute, publicRoute, showEditRoute, ss, submitRoute, useRoomToast
} from '../../../../components/show/ShowBits';
import { ChannelsCard, ExtrasShelf, RemoveShowCard, SellCard, ShowCard, ShowStatusCard } from '../../../../components/show/ShowCards';
import SeasonSection, { rowMenuItems } from '../../../../components/show/SeasonSection';
import AddEpisodesBar, { AddSeveralSheet, LinkSheet, QueuePanel } from '../../../../components/show/AddEpisodesBar';
import MoveSheet from '../../../../components/show/MoveSheet';
import { PlaceExtraSheet, RemoveEpisodeSheet } from '../../../../components/show/RowSheets';
import PayeeCard from '../../../../components/show/PayeeCard';
import { extraKindLabel } from '../../../../lib/extraKinds';

// The show page in the app (the series revamp, slice 5; spec "App — New
// show, Show page, Episode editor" and "The app"; the website's
// components/show/ShowControlRoom.js, phone order): the show card, the
// status card (Make it public, Resubmit, Cancel request, the problem
// lines), the Add bar and its uploads, the seasons with ↑/↓ and the
// E-badge on every row (no drag in the app), + Add season, Extras, Sell,
// "Who gets paid" (slice 3b: components/show/PayeeCard.js), the channels
// switch and "Remove this show…". Everything is read from
// GET /api/show/<id> and changed through the /api/show routes
// (mockups/series-slice2-api.md); the rules are mobile/src/lib/showRules.js
// (the website's, word for word).
//
// Every change to the order is planned here with planMove, sent once
// (/reorder inside a season, /move across) and answered with a toast that
// says what moved and offers Undo for 8 s. "Add several" picks up to 30
// videos: each becomes a draft at once (POST /api/show/<id>/episodes) and
// uploads one after another through mobile/src/lib/showUploadQueue.js,
// which keeps going while the creator moves around the app.
//
// Params: id; created=1 (New show just made it); ep=<episode id> or
// draft=<draft id> (scroll to that row and flash it).

const POLL_MS = 20000;
const TOAST_MS = 8000;

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

function linkName(url) {
  try {
    const path = String(url).split('?')[0].split('#')[0];
    return decodeURIComponent(path.split('/').pop() || '') || 'Linked file';
  } catch {
    return 'Linked file';
  }
}

// Keyed by the show: a Back pill's dismissTo() lands on a show screen
// already in the stack and hands it new params, which may be another
// show (after an episode moved there) — that one starts fresh.
export default function ShowRoute() {
  const { id } = useLocalSearchParams();
  return <ShowScreen key={String(id || '')} />;
}

function ShowScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const showId = String(params.id || '');
  const arriveId = typeof params.ep === 'string' ? params.ep : typeof params.draft === 'string' ? params.draft : null;
  const { isLoaded, isSignedIn, getToken: clerkGetToken } = useAuth();
  // One getter for the screen's life (Clerk's may change identity): the
  // reads below depend on it, and a new one each render would read again.
  const tokenRef = useRef(clerkGetToken);
  tokenRef.current = clerkGetToken;
  const getToken = useCallback((...a) => tokenRef.current(...a), []);
  const call = useCallback((method, path, body) => showCall(method, path, body, getToken), [getToken]);
  const { toast, say } = useRoomToast();
  const q = useShowQueue(showId);

  const [phase, setPhase] = useState({ state: 'loading' });
  const [view, setView] = useState(null);
  const viewRef = useRef(null);
  viewRef.current = view;
  const [conflicts, setConflicts] = useState({});
  const [rowNotes, setRowNotes] = useState({});
  const [busyRow, setBusyRow] = useState(null);
  const [busy, setBusy] = useState(null);
  const [sending, setSending] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [extraSeasons, setExtraSeasons] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [myShows, setMyShows] = useState(null);
  const [pricing, setPricing] = useState(null);
  // What the Sell sheet is open for: the whole series (the Sell card) or
  // one episode (the row's Sell…, slice 3b): { type, id, title, sub }.
  const [sellTarget, setSellTarget] = useState(null);
  const [createdNote, setCreatedNote] = useState(params.created === '1');
  const [picking, setPicking] = useState(false);
  // A 503 seen at run time (the page said the migration was there, the
  // route said it isn't): the server's own line, and the control greys.
  const [behind, setBehind] = useState({ m116: null, m118: null });
  const loadingRef = useRef(null);
  const focused = useRef(false);

  const scrollRef = useRef(null);
  const bodyRef = useRef(null);
  const bodyY = useRef(0);
  const rowNodes = useRef(new Map());
  const rowRefs = useRef(new Map());
  const rowRef = useCallback((id) => {
    if (!rowRefs.current.has(id)) rowRefs.current.set(id, (node) => { if (node) rowNodes.current.set(id, node); else rowNodes.current.delete(id); });
    return rowRefs.current.get(id);
  }, []);

  const noteBehind = useCallback((r) => {
    const m = migrationRefusal(r);
    if (!m) return false;
    setBehind((b) => (m.code === 'migration-116' ? { ...b, m116: m.line } : m.code === 'migration-118' ? { ...b, m118: m.line } : b));
    return true;
  }, []);

  // --- reading the show -------------------------------------------------------
  const load = useCallback(async ({ quiet = false, drafts = false } = {}) => {
    // A read already on its way may have left before the change this caller
    // just made: the caller waits for one more read after it, so
    // `await load()` always sees the change.
    const cur = loadingRef.current;
    if (cur) {
      cur.followDrafts = cur.followDrafts || drafts;
      if (!cur.follow) cur.follow = cur.promise.catch(() => null).then(() => load({ quiet: true, drafts: cur.followDrafts }));
      return cur.follow;
    }
    const run = { follow: null, followDrafts: false, promise: null };
    loadingRef.current = run;
    run.promise = (async () => {
      try {
        // Drafts still processing: their state comes fresh from Cloudflare
        // (the drafts route writes it back) before the show page is read.
        if (drafts) await call('GET', `/api/creator/drafts?seriesId=${encodeURIComponent(showId)}`);
        const r = await call('GET', showPath(showId));
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
  }, [showId, call]);

  // Read on every visit (back from an editor, from the submit screen).
  useFocusEffect(useCallback(() => {
    focused.current = true;
    if (isLoaded && isSignedIn && showId) load({ quiet: Boolean(viewRef.current), drafts: true });
    return () => { focused.current = false; };
  }, [isLoaded, isSignedIn, showId, load]));

  const show = view ? view.show : null;
  const viewer = view ? view.viewer || {} : {};
  const flat = useMemo(() => (view ? (view.seasons || []).flatMap((s) => s.rows || []).filter((r) => r.kind !== 'gap') : []), [view]);
  const planRows = useMemo(() => flat.map((r) => ({ ...r, seriesId: showId })), [flat, showId]);
  const uploads = q.uploads;

  // A file finished: the rows catch up (its draft reads Processing, then ready).
  const uploadedCount = q.items.filter((it) => it.status === 'uploaded').length;
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

  // Polled while something is in flux (files processing, an upload
  // running), every 20 s and only while this screen is in front.
  const inFlux = useMemo(() => q.live || flat.some((r) => (r.kind === 'draft' && r.video && ['processing', 'unknown'].includes(r.master)) || (r.kind === 'episode' && r.status === 'pending' && r.master === 'processing')), [flat, q.live]);
  useEffect(() => {
    if (!inFlux) return undefined;
    const t = setInterval(() => {
      if (focused.current && AppState.currentState === 'active') load({ quiet: true, drafts: true });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [inFlux, load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && focused.current && viewRef.current) load({ quiet: true }); });
    return () => sub.remove();
  }, [load]);

  // --- arriving at a row (?ep=, ?draft=, a problem line) -------------------------
  const flash = useCallback((nodeId, rowId) => {
    const node = rowNodes.current.get(nodeId);
    if (node && bodyRef.current && typeof node.measureLayout === 'function') {
      node.measureLayout(bodyRef.current, (x, y) => {
        if (scrollRef.current) scrollRef.current.scrollTo({ y: Math.max(0, bodyY.current + y - 120), animated: true });
      }, () => {});
    }
    if (rowId) {
      setFlashId(rowId);
      setTimeout(() => setFlashId((x) => (x === rowId ? null : x)), 2600);
    }
  }, []);
  // The row last arrived at: Back from an editor brings ?ep= / ?draft= to
  // this same screen again, and that row is shown too.
  // The timer outlives a read landing meanwhile (a new `view` mustn't
  // cancel the scroll); it goes with the screen.
  const arrived = useRef(null);
  const arriveTimer = useRef(null);
  useEffect(() => () => clearTimeout(arriveTimer.current), []);
  useEffect(() => {
    if (!view || !arriveId || arrived.current === arriveId) return;
    arrived.current = arriveId;
    clearTimeout(arriveTimer.current);
    arriveTimer.current = setTimeout(() => flash(arriveId, arriveId), 350);
  }, [view, arriveId, flash]);

  // The Sell card: the series' price row and the episodes' prices.
  const isOwner = Boolean(viewer.isOwner);
  const team = Boolean(viewer.teamEdits);
  const canRun = isOwner || team;
  // Every price of this show's titles (?show=: whoever holds the row), so
  // a price set before slice 3b by a contributor still shows here.
  const loadPricing = useCallback(async () => {
    const r = await call('GET', `/api/creator/pricing?show=${encodeURIComponent(showId)}`);
    if (r.ok) setPricing(r.data);
    return r.ok;
  }, [call, showId]);
  useEffect(() => {
    if (!show || !show.isPublic || !canRun || pricing) return;
    loadPricing();
  }, [show, canRun, pricing, loadPricing]);

  // --- who may do what ---------------------------------------------------------
  const shows118 = Boolean(view && view.migration && view.migration.shows118) && !behind.m118;
  const drafts116 = Boolean(view && view.addBar && view.addBar.drafts116) && !behind.m116;
  const held = Boolean(show && show.held);
  const removal = Boolean(show && show.deletion && show.deletion.requested);
  const declined = Boolean(show && show.status === 'rejected' && !held);
  const vertical = Boolean(show && show.kind === 'vertical');
  const locked = held || removal || (declined && !team) || (vertical && !team);
  // An uploader into someone else's show, or an account it pays (slice 3b:
  // the page opens read-only to a paid account), sees it as a contributor.
  const contributor = Boolean((viewer.isContributor || viewer.isPayee) && !isOwner && !team);
  const canReorder = canRun && !locked;
  const reorderOpen = canReorder && shows118;
  const behind118Line = behind.m118 || 'Reordering needs a database update (migration 118)';
  const closedLine = !show ? null
    : vertical && !team ? 'Vertical series are set up by the studio.'
      : held ? 'Nothing can be added while an admin looks at it.'
        : removal ? 'Its removal is requested — it takes nothing new.'
          : declined && !team ? 'An admin declined this show — resubmit it before adding to it.'
            : null;
  const canAdd = canRun && !locked;
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
  const nextFree = useCallback((season) => nextFreeNumber(planRows, season), [planRows]);
  const addOneAt = useCallback((season, number) => router.push(submitRoute({ kind, showId, season, number })), [router, kind, showId]);

  // --- moving rows -------------------------------------------------------------
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
      const r = await call('POST', `${showPath(showId)}/${s.route}`, s.body);
      if (!r.ok) {
        noteBehind(r);
        say({ tone: 'warn', title: 'Couldn’t undo that', lines: [r.error] });
        await load({ quiet: true });
        return false;
      }
    }
    // "Undone" once the rows are back where they were, not before.
    await load({ quiet: true });
    say({ tone: 'ok', title: 'Undone' }, 4000);
    return true;
  }, [call, showId, load, say, noteBehind]);

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
      const r = await call('POST', `${showPath(showId)}/reorder`, body);
      setBusyRow(null);
      if (!r.ok) {
        setView(before);
        noteBehind(r);
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
    const r = await call('POST', `${showPath(showId)}/move`, moveBody);
    setBusyRow(null);
    if (!r.ok) {
      noteBehind(r);
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
  }, [call, showId, load, say, moveToast, runSteps, noteBehind]);

  const planFor = useCallback((id, target) => planMove(planRows, id, target), [planRows]);

  const openMove = useCallback(async (row) => {
    setSheet({ kind: 'move', row });
    if (!myShows) {
      const r = await call('GET', team ? '/api/show?all=1' : '/api/show');
      setMyShows(r.ok && Array.isArray(r.data.shows) ? r.data.shows.filter((s) => s.kind !== 'vertical' || team) : []);
    }
  }, [call, myShows, team]);

  const openRow = useCallback((row) => router.push(episodeEditorRoute(showId, row.id, row.kind === 'draft')), [router, showId]);

  // Picks the file for a draft: the same one (name and size) resumes it,
  // another starts it afresh.
  const pickFile = useCallback(async (row) => {
    try {
      const asset = await pickVideo();
      if (!asset) return;
      const resume = fileMatches(assetFile(asset), row);
      enqueueShowUploads([{ draftId: row.id, asset, showId, showName: show ? show.name : null, label: `${row.code || 'Draft'} · ${row.displayTitle}`, runtimeSeconds: (row.video && row.video.runtimeSeconds) || assetRuntime(asset), freshStart: !resume }], getToken);
      say({ tone: 'ok', title: resume ? `Resuming ${row.displayTitle}` : `Uploading ${assetName(asset)} for ${row.displayTitle}` }, 4000);
    } catch (err) {
      say({ tone: 'warn', title: 'Nothing was picked', lines: [err.message] });
    }
  }, [showId, show, getToken, say]);

  const actions = {
    open: openRow,
    menu: (row) => setSheet({ kind: 'row', row }),
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
        const free = nextFree(season);
        setConflicts((c) => ({
          ...c,
          [row.id]: {
            number: n,
            holderTitle: plan.holder ? plan.holder.title || plan.holder.displayTitle || null : null,
            choices: plan.choices,
            nextFree: free && free !== Number(row.seriesOrder) ? free : null,
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
    send: async (season, ids) => {
      const created = [];
      const skipped = [];
      let failed = null;
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        setSending({ season, label: ids.length > 10 ? `Sending ${Math.min(i + chunk.length, ids.length)} of ${ids.length}…` : 'Sending…' });
        const r = await call('POST', `${showPath(showId)}/send`, { draftIds: chunk });
        if (!r.ok) {
          noteBehind(r);
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
      const r = await call('PATCH', `${showPath(showId)}/seasons`, { action: 'rename', number: season, label: String(name || '').trim() });
      if (!r.ok) {
        noteBehind(r);
        return say({ tone: 'warn', title: 'Not renamed', lines: [r.error] });
      }
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
      const r = await call('PATCH', `${showPath(showId)}/seasons`, { action: 'renumber', number: season });
      setBusyRow(null);
      setConfirm(null);
      if (!r.ok) {
        noteBehind(r);
        return say({ tone: 'warn', title: 'Not renumbered', lines: [r.error] });
      }
      const undo = plan ? reorderBody(plan.undo) : null;
      moveToast(r.data.words || (plan && plan.words), undo ? () => runSteps([{ route: 'reorder', body: undo }]) : null);
      return load({ quiet: true });
    },
    cancelConfirm: () => setConfirm(null),
    addSeason: () => {
      const n = lastSeason + 1;
      setExtraSeasons((s) => (s.includes(n) ? s : [...s, n]));
      say({ tone: 'ok', title: `Season ${n} is ready for its first episode`, lines: ['It’s kept once an episode lands in it.'] }, 4000);
    },
    addAt: (season, number) => addOneAt(season, number)
  };

  // The row's kebab (rowMenuItems builds the list).
  const rowActions = {
    open: openRow,
    openMove,
    togglePage: async (row) => {
      setBusyRow(row.id);
      const r = await call('PATCH', `/api/show/episode/${encodeURIComponent(row.id)}`, { hasPage: !row.hasPage });
      setBusyRow(null);
      if (!r.ok) return say({ tone: 'warn', title: 'Not changed', lines: [r.error] });
      const notSaved = (r.data.notSaved || []).map((x) => x.reason);
      say({ tone: notSaved.length ? 'warn' : 'ok', title: notSaved.length ? 'Not saved' : row.hasPage ? `${row.displayTitle} plays straight from the show` : `${row.displayTitle} has its own page now`, lines: notSaved });
      return load({ quiet: true });
    },
    pickFile,
    discard: (row) => {
      Alert.alert(`Discard ${row.displayTitle || 'this draft'}?`, 'Its uploaded file is deleted too.', [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: async () => {
          cancelShowUpload(row.id);
          setBusyRow(row.id);
          const r = await call('DELETE', '/api/creator/drafts', { id: row.id });
          setBusyRow(null);
          if (!r.ok) return say({ tone: 'warn', title: 'Couldn’t discard it', lines: [r.error] });
          say({ tone: 'ok', title: `${row.displayTitle || 'The draft'} is gone` }, 4000);
          return load({ quiet: true });
        } }
      ]);
    },
    askRemove: (row) => { setSheetError(null); setSheet({ kind: 'remove', row }); },
    viewPublic: (row) => router.push(episodePublicRoute(row.id))
  };

  // --- adding files ------------------------------------------------------------------------
  const queueOf = useCallback((drafts, assets) => {
    const pool = assets.map((a) => ({ a, name: assetName(a), used: false }));
    const items = [];
    for (const d of drafts) {
      const m = pool.find((p) => !p.used && p.name === (d.fileName || ''));
      if (!m) continue;
      m.used = true;
      items.push({ draftId: d.id, asset: m.a, showId, showName: show ? show.name : null, label: `${d.code} · ${d.displayTitle}`, runtimeSeconds: assetRuntime(m.a) });
    }
    return items;
  }, [showId, show]);

  const addAssets = useCallback(async (assets, season, sortBy = 'name') => {
    setSheetBusy(true);
    setSheetError(null);
    const items = assets.map((a) => {
      const f = assetFile(a);
      return { videoName: f.name, ...(f.size ? { videoBytes: f.size } : {}), ...(assetRuntime(a) ? { runtimeSeconds: assetRuntime(a) } : {}) };
    });
    const r = await call('POST', `${showPath(showId)}/episodes`, { season, sortBy, items });
    setSheetBusy(false);
    if (!r.ok) {
      noteBehind(r);
      setSheetError(r.error);
      say({ tone: 'warn', title: 'Nothing was added', lines: [r.error] }, 8000);
      return false;
    }
    const drafts = r.data.drafts || [];
    enqueueShowUploads(queueOf(drafts, assets), getToken);
    const notes = drafts.filter((d) => d.note).map((d) => `${d.fileName || d.displayTitle}: ${d.note}`);
    const skipped = (r.data.skipped || []).map((s) => `${s.name || 'A file'}: ${s.reason}`);
    say({ tone: skipped.length ? 'warn' : 'ok', title: `${drafts.length} added as draft${drafts.length === 1 ? '' : 's'} — uploading one after another`, lines: [...notes, ...skipped].slice(0, 4) }, 7000);
    setSheet(null);
    await load({ quiet: true });
    return true;
  }, [call, showId, queueOf, getToken, load, say, noteBehind]);

  const resumeAssets = useCallback((pairs) => {
    if (!pairs.length) return;
    enqueueShowUploads(pairs.map(({ asset, row }) => ({ draftId: row.id, asset, showId, showName: show ? show.name : null, label: `${row.code || 'Draft'} · ${row.displayTitle}`, runtimeSeconds: (row.video && row.video.runtimeSeconds) || assetRuntime(asset) })), getToken);
    say({ tone: 'ok', title: pairs.length === 1 ? `Resuming ${pairs[0].row.displayTitle}` : `Resuming ${pairs.length} uploads` }, 4000);
  }, [showId, show, getToken, say]);

  const stoppedDrafts = useMemo(() => flat.filter((r) => r.kind === 'draft' && r.mine && (r.master === 'uploading' || r.master === 'none') && !(uploads[r.id] && ['queued', 'starting', 'uploading', 'uploaded'].includes(uploads[r.id].status))), [flat, uploads]);

  // "+ Add several": up to 30 videos from the library. Files that are a
  // stopped draft's own resume it; one new file is added at once; more
  // open the plan sheet first.
  const pickSeveral = useCallback(async (season = lastSeason) => {
    if (!view || !drafts116 || picking) return;
    setPicking(true);
    let assets = [];
    try {
      assets = await pickVideos({ limit: 30 });
    } catch (err) {
      setPicking(false);
      say({ tone: 'warn', title: 'Nothing was picked', lines: [err.message] });
      return;
    }
    setPicking(false);
    if (!assets.length) return;
    const pairs = [];
    const fresh = [];
    for (const a of assets) {
      const d = stoppedDrafts.find((r) => fileMatches(assetFile(a), r) && !pairs.some((p) => p.row.id === r.id));
      if (d) pairs.push({ asset: a, row: d });
      else fresh.push(a);
    }
    if (!fresh.length) {
      resumeAssets(pairs);
      return;
    }
    if (fresh.length === 1 && !pairs.length) {
      addAssets(fresh, season);
      return;
    }
    setSheetError(null);
    setSheet({ kind: 'several', assets: fresh, resumes: pairs, season });
  }, [view, drafts116, picking, lastSeason, stoppedDrafts, resumeAssets, addAssets, say]);

  // "Pick files" after uploads stopped (the app was closed, say).
  const resumePick = useCallback(async () => {
    let assets = [];
    try {
      assets = await pickVideos({ limit: 30 });
    } catch (err) {
      say({ tone: 'warn', title: 'Nothing was picked', lines: [err.message] });
      return;
    }
    const pairs = [];
    const unmatched = [];
    for (const a of assets) {
      const d = stoppedDrafts.find((r) => fileMatches(assetFile(a), r) && !pairs.some((p) => p.row.id === r.id));
      if (d) pairs.push({ asset: a, row: d });
      else unmatched.push(assetName(a));
    }
    resumeAssets(pairs);
    if (unmatched.length) say({ tone: 'warn', title: 'Not the same files', lines: [`${unmatched.join(', ')} ${unmatched.length === 1 ? 'isn’t' : 'aren’t'} the file a stopped draft was made from — use Add several to add new episodes.`] }, 8000);
  }, [stoppedDrafts, resumeAssets, say]);

  async function submitLink(url) {
    setSheetBusy(true);
    setSheetError(null);
    const name = linkName(url);
    let item = null;
    if (kind === 'podcast') {
      const a = await call('POST', '/api/creator/import-audio-url', { audioUrl: url, fileName: name });
      if (!a.ok) {
        setSheetBusy(false);
        setSheetError(a.error);
        return;
      }
      item = { videoName: name, audioUrl: a.data.audioUrl, audioBytes: a.data.audioBytes };
    } else {
      const v = await call('POST', '/api/creator/import-video-url', { videoUrl: url, fileName: name });
      if (!v.ok) {
        setSheetBusy(false);
        setSheetError(v.error);
        return;
      }
      item = { videoName: name, videoUid: v.data.uid };
    }
    const r = await call('POST', `${showPath(showId)}/episodes`, { season: lastSeason, items: [item] });
    setSheetBusy(false);
    if (!r.ok) {
      noteBehind(r);
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

  // --- the show's own actions --------------------------------------------------------------
  function makePublic() {
    const noun = kind === 'podcast' ? 'show' : 'series';
    Alert.alert(`Make ${show.name} public?`, `Its approved episodes go on the site now, and the ones approved later go live as they’re approved. This is one-way: a public ${noun} only comes down if you remove it.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Make it public', onPress: async () => {
        setBusy('public');
        const r = await call('POST', `${showPath(showId)}/public`, {});
        setBusy(null);
        if (!r.ok) {
          say({ tone: 'warn', title: 'Not public yet', lines: [r.error] });
          load({ quiet: true });
          return;
        }
        say({ tone: 'ok', title: `${show.name} is public`, lines: ['Its approved episodes are on the site; the next ones go live as they’re approved.'] }, 8000);
        load({ quiet: true });
      } }
    ]);
  }
  async function askRemoval(action, reason) {
    setBusy('removal');
    const r = await call('POST', `${showPath(showId)}/removal`, action === 'request' ? { action, reason } : { action });
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: action === 'request' ? 'Not asked' : 'Not cancelled', lines: [r.error] });
    say({ tone: 'ok', title: action === 'request' ? 'Removal requested' : 'Removal cancelled', lines: [action === 'request' ? 'It left the site; we confirm it soon.' : 'It’s back as it was.'] }, 6000);
    return load({ quiet: true });
  }
  async function resubmit() {
    setBusy('resubmit');
    const r = await call('PATCH', showPath(showId), { resubmit: true });
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: 'Not sent', lines: [r.error] });
    say({ tone: 'ok', title: 'Sent again', lines: ['It’s not public yet; once an episode is approved you choose when it goes public.'] });
    return load({ quiet: true });
  }
  async function toggleChannels(on) {
    setBusy('channels');
    const r = await call('PATCH', showPath(showId), { channelOptIn: on });
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: 'Not changed', lines: [r.error] });
    if (r.data.view) setView(r.data.view);
    say({ tone: 'ok', title: on ? 'Channels may air the whole show' : 'Channels won’t air it' }, 4000);
    return load({ quiet: true });
  }
  async function cancelStaged(field) {
    setBusy(`staged-${field}`);
    const r = await call('DELETE', `${showPath(showId)}/staged?field=${encodeURIComponent(field)}`);
    setBusy(null);
    if (!r.ok) return say({ tone: 'warn', title: 'Not cancelled', lines: [r.error] });
    say({ tone: 'ok', title: 'Taken back' }, 3000);
    return load({ quiet: true });
  }
  function onProblem(p) {
    if (p.code === 'staged' || p.code === 'trailer' || p.code === 'trailer-failed') {
      router.push(showEditRoute(showId, 'art'));
      return;
    }
    if (p.code === 'gap' && p.from) {
      flash(`gap-${p.season}-${p.from}`, null);
      return;
    }
    const id = (p.episodeIds || [])[0];
    if (id) flash(String(id), String(id));
  }
  async function submitRemoval(reason) {
    const row = sheet && sheet.row;
    if (!row) return;
    setSheetBusy(true);
    setSheetError(null);
    const r = await call('POST', `/api/show/episode/${encodeURIComponent(row.id)}/removal`, { action: 'request', reason });
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
    const r = await call('PATCH', `/api/show/episode/${encodeURIComponent(x.id)}`, { bonusParentType: parentType, bonusParentId: parentId });
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
  const dashboard = !isLoaded ? null : { isSignedIn: Boolean(isSignedIn) };
  const back = { href: '/creator', label: 'Creator Studio' };

  if (!view || phase.state !== 'ready') {
    const notThere = phase.status === 404;
    const forbidden = phase.status === 403;
    return (
      <AccountFrame title={phase.state === 'loading' ? null : notThere ? 'That show isn’t there' : 'Couldn’t open the show'} dashboard={dashboard} back={back}>
        {phase.state === 'loading' ? (
          <View style={{ gap: 12 }}>
            <View style={sx.skeleton} /><View style={[sx.skeleton, { height: 90 }]} /><View style={[sx.skeleton, { height: 60 }]} />
          </View>
        ) : forbidden ? (
          <View style={ss.card}>
            <Text style={ss.p}>{phase.error}</Text>
            <Text style={ss.p}>Creator Studio opens once an application is accepted.</Text>
            <PrimaryButton label="Send us your film" onPress={() => router.push('/apply')} />
          </View>
        ) : (
          <View style={ss.card}>
            <Text style={ss.p}>{notThere ? 'It may have been removed, or it belongs to someone else.' : phase.error}</Text>
            {!notThere ? <SmallButton label="Try again" onPress={() => { setPhase({ state: 'loading' }); load(); }} /> : null}
          </View>
        )}
      </AccountFrame>
    );
  }

  // "Who gets paid" changed (an invite sent, a pick, a withdrawal, a
  // step-down): the server's words, its new block at once, then the page
  // again (rows' "Paid to", the show card's line). (null, null) = the
  // card's block was out of date: just read the page again.
  const onPayeeChanged = (next, words) => {
    if (words) say({ tone: 'ok', title: words }, 7000);
    if (next) setView((v) => (v ? { ...v, payee: next } : v));
    load({ quiet: true });
  };

  // The row's Sell… (slice 3b, §2 row 4): whoever runs the show prices any
  // live episode in it, a contributor's included — and any live extra,
  // which follows its show (Jose, 2026-11-06); a full admin too. Put
  // before the divider that leads to Discard / Remove….
  const runsIt = isOwner || Boolean(viewer.isAdmin);
  const withSell = (items, row) => {
    const liveRow = (row.kind === 'episode' || row.kind === 'extra') && row.status === 'approved' && show.isPublic && !row.held && !row.deletionRequested && !row.withdrawnAt;
    if (!runsIt || !liveRow || locked || kind === 'vertical') return items;
    const priced = pricing && pricing.prices ? pricing.prices[`episode:${row.id}`] : null;
    const sell = {
      key: 'sell',
      label: priced ? 'Price and sales' : 'Sell…',
      icon: <Text style={sx.dollar}>$</Text>,
      onPress: async () => {
        if (!pricing) await loadPricing();
        setSellTarget({ type: 'episode', id: row.id, title: row.displayTitle || row.title || 'This episode', sub: [row.code, show.name].filter(Boolean).join(' · ') });
      }
    };
    const at = items.findIndex((it) => it && it.divider);
    return at < 0 ? [...items, sell] : [...items.slice(0, at), sell, ...items.slice(at)];
  };

  const ctx = {
    showId,
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
    behind116Line: behind.m116,
    canReorder,
    reorderOpen,
    reorderLine: shows118 ? (locked ? closedLine || 'Nothing can be moved right now.' : null) : behind118Line,
    canAdd,
    closedLine,
    canOpen: (row) => (row.kind === 'draft' ? Boolean(row.mine) : Boolean(isOwner || team || row.mine)),
    canMove: (row) => !locked && row.status !== 'rejected' && !row.withdrawnAt && !row.deletionRequested && (row.kind === 'draft' ? Boolean(row.mine) : Boolean(canRun || row.mine)),
    uploads,
    conflicts,
    rowNotes,
    busyRow,
    flashId,
    sending,
    confirm,
    lastSeason,
    defaultTier: (show.defaults && show.defaults.tier) || null,
    premiumWord: PREMIUM_WORD,
    viewerId: viewer.userId || null,
    rowRef
  };

  const sellable = show.isPublic && canRun && !locked && kind !== 'vertical';
  const episodePrices = pricing && pricing.prices
    ? flat.filter((r) => r.kind === 'episode').map((r) => pricing.prices[`episode:${r.id}`]).filter((p) => p && p.status === 'on' && p.price_cents).map((p) => Number(p.price_cents))
    : [];
  const seasonsForSheets = seasonsShown.map((s) => ({ number: s.number, label: s.label }));
  const sheetRow = sheet && sheet.row ? sheet.row : null;
  // Remove… comes last, after a divider, as on the episode rows (withSell
  // puts Sell… before the divider).
  const extraRemovable = sheet && sheet.kind === 'extra' && sheet.extra.mine && !sheet.extra.deletionRequested;
  const extraItems = sheet && sheet.kind === 'extra' ? withSell([
    sheet.extra.mine || team ? { key: 'edit', label: 'Edit', icon: <PencilIcon size={15} color={colors.ink} />, onPress: () => openRow(sheet.extra) } : null,
    isOwner || sheet.extra.mine || team ? { key: 'place', label: 'Place after…', icon: <PlusIcon size={15} color={colors.ink} />, onPress: () => { setSheetError(null); setSheet({ kind: 'place', extra: sheet.extra }); } } : null,
    ...(extraRemovable ? [
      { divider: true },
      { key: 'remove', label: 'Remove…', danger: true, icon: <TrashIcon size={15} color={colors.danger} />, onPress: () => { setSheetError(null); setSheet({ kind: 'remove', row: sheet.extra }); } }
    ] : [])
  ], sheet.extra) : null;

  return (
    <AccountFrame
      title={show.name || 'Your show'}
      dashboard={dashboard}
      back={back}
      scrollRef={scrollRef}
      overlay={<RoomToast toast={toast} onClose={() => say(null)} />}
    >
      <View ref={bodyRef} collapsable={false} style={sx.body} onLayout={(e) => { bodyY.current = e.nativeEvent.layout.y; }}>
        {createdNote ? (
          <View style={sx.flash} accessibilityLiveRegion="polite">
            <CheckIcon size={15} color={colors.ok} />
            <Text style={[ss.p, { flex: 1, color: colors.ink }]}><Text style={ss.strong}>{show.name} is ready. Add its episodes.</Text></Text>
            <Pressable onPress={() => setCreatedNote(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss"><CloseIcon size={14} color={colors.inkDim} /></Pressable>
          </View>
        ) : null}
        {vertical && !team ? <Behind line="Vertical series are set up by the studio." /> : null}

        <ShowCard
          view={view}
          payee={view.payee || null}
          canEdit={Boolean(show.canEditShow) && !(vertical && !team)}
          onEdit={(tab) => router.push(showEditRoute(showId, tab))}
          onView={() => router.push(publicRoute(show))}
          onCancelStaged={cancelStaged}
          busy={busy}
        />
        <ShowStatusCard
          view={view}
          contributor={contributor}
          onProblem={onProblem}
          onMakePublic={makePublic}
          onCancelRemoval={canRun || viewer.isAdmin ? () => askRemoval('cancel') : null}
          onResubmit={canRun ? resubmit : null}
          busy={busy}
        />

        {!(vertical && !team) ? (
          <AddEpisodesBar
            view={view}
            ctx={ctx}
            busy={picking}
            onAddOne={() => addOneAt(lastSeason, nextFree(lastSeason))}
            onAddSeveral={() => pickSeveral(lastSeason)}
            onLink={() => { setSheetError(null); setSheet({ kind: 'link' }); }}
          />
        ) : null}
        <QueuePanel
          items={q.items}
          uploads={uploads}
          paused={q.paused}
          stopped={canAdd ? stoppedDrafts.filter((r) => (r.master === 'uploading' || (r.master === 'none' && r.file)) && !(uploads[r.id] && uploads[r.id].status === 'stopped')).length : 0}
          onRetry={() => retryShowUploads({ showId }, getToken)}
          onResumePick={resumePick}
        />
        {canRun && !shows118 ? <Behind line={behind118Line} /> : null}

        {seasonsShown.map((s) => (
          <SeasonSection key={s.number} season={s} ctx={ctx} actions={actions}>
            {canAdd && s.empty ? (
              drafts116 ? (
                <View style={sx.emptySeason}>
                  <Text style={ss.small}>Nothing in {s.label || `Season ${s.number}`} yet.</Text>
                  <View style={ss.wrap}>
                    <SmallButton label="Add episode" icon={<PlusIcon size={14} color={colors.ink} />} onPress={() => addOneAt(s.number, nextFree(s.number))} />
                    <SmallButton label="Add several" busy={picking} onPress={() => pickSeveral(s.number)} />
                  </View>
                </View>
              ) : (
                <Text style={ss.small}>Nothing in it yet. <LinkText onPress={() => addOneAt(s.number, 1)}>Submit the first episode</LinkText></Text>
              )
            ) : null}
          </SeasonSection>
        ))}
        {canAdd ? (
          <Pressable style={({ pressed }) => [sx.addSeason, pressed && ss.pressed]} onPress={actions.addSeason} accessibilityRole="button">
            <View style={ss.row}><PlusIcon size={16} color={colors.ink} /><Text style={sx.addSeasonText}>Add season</Text></View>
            <Text style={ss.mono}>Season {lastSeason + 1} · kept once its first episode lands</Text>
          </Pressable>
        ) : null}
        {(view.extras || []).length > 0 || canAdd ? (
          <ExtrasShelf
            view={view}
            ctx={ctx}
            onOpen={openRow}
            onMenu={(x) => setSheet({ kind: 'extra', extra: x })}
            onAdd={() => router.push(submitRoute({ kind, showId, type: 'bonus' }))}
          />
        ) : null}

        {sellable ? (
          <SellCard view={view} episodePrices={episodePrices} onOpen={async () => { if (!pricing) await loadPricing(); setSellTarget({ type: 'series', id: showId, title: show.name, sub: countLine(view.seasons) }); }} />
        ) : null}
        {view.payee ? <PayeeCard payee={view.payee} mode="card" onChanged={onPayeeChanged} /> : null}
        {canRun && !(vertical && !team) ? (
          <ChannelsCard view={view} canEdit={canRun} locked={held ? 'Locked while it’s pulled.' : removal ? 'Locked while its removal is requested.' : null} busy={busy === 'channels'} onToggle={toggleChannels} />
        ) : null}
        {!(vertical && !team) ? (
          <RemoveShowCard view={view} canRequest={isOwner || Boolean(viewer.isAdmin)} busy={busy} onRequest={(reason) => askRemoval('request', reason)} onCancel={() => askRemoval('cancel')} />
        ) : null}
      </View>

      {sheet && sheet.kind === 'row' && sheetRow ? (
        <ActionSheet title={sheetRow.displayTitle || 'This episode'} eyebrow={sheetRow.code || (sheetRow.kind === 'draft' ? 'Draft' : null)} items={withSell(rowMenuItems(sheetRow, ctx, rowActions), sheetRow)} onClose={() => setSheet(null)} />
      ) : null}
      {extraItems ? (
        <ActionSheet title={sheet.extra.displayTitle} eyebrow={extraKindLabel(sheet.extra.extraKind)} items={extraItems} onClose={() => setSheet(null)} />
      ) : null}
      {sheet && sheet.kind === 'move' && sheetRow ? (
        <MoveSheet
          show={{ id: showId, name: show.name, kind, seasons: seasonsForSheets }}
          episode={{ id: sheetRow.id, kind: sheetRow.kind === 'draft' ? 'draft' : 'episode', title: sheetRow.title, displayTitle: sheetRow.displayTitle, season: sheetRow.season, seriesOrder: sheetRow.seriesOrder, code: sheetRow.code, status: sheetRow.status }}
          myShows={myShows}
          onClose={() => setSheet(null)}
          onMoved={(result) => {
            const away = result.toShowId && result.toShowId !== showId;
            const steps = !away && sheetRow.kind !== 'draft' ? undoMoveSteps(result.rows, sheetRow.id) : null;
            moveToast(result.words || 'Moved', steps ? () => runSteps(steps) : null, [...(result.lines || []), away ? 'It’s in the other show now.' : null]);
            load({ quiet: true });
          }}
        />
      ) : null}
      {sheet && sheet.kind === 'several' ? (
        <AddSeveralSheet
          assets={sheet.assets}
          resumes={sheet.resumes || []}
          season={sheet.season}
          seasons={seasonsForSheets}
          rows={planRows}
          showName={show.name}
          onSeason={(n) => setSheet((s) => ({ ...s, season: n }))}
          onClose={() => { setSheet(null); setSheetError(null); }}
          busy={sheetBusy}
          error={sheetError}
          onConfirm={async ({ assets, sortBy }) => {
            if (sheet.resumes && sheet.resumes.length) resumeAssets(sheet.resumes);
            await addAssets(assets, sheet.season, sortBy);
          }}
        />
      ) : null}
      {sheet && sheet.kind === 'link' ? (
        <LinkSheet podcast={kind === 'podcast'} showName={show.name} busy={sheetBusy} error={sheetError} onSubmit={submitLink} onClose={() => { setSheet(null); setSheetError(null); }} />
      ) : null}
      {sheet && sheet.kind === 'remove' && sheetRow ? (
        <RemoveEpisodeSheet row={sheetRow} live={sheetRow.status === 'approved' && show.isPublic} busy={sheetBusy} error={sheetError} onSubmit={submitRemoval} onClose={() => { setSheet(null); setSheetError(null); }} />
      ) : null}
      {sheet && sheet.kind === 'place' ? (
        <PlaceExtraSheet extra={sheet.extra} showId={showId} episodes={flat.filter((r) => r.kind === 'episode' && r.status !== 'rejected')} busy={sheetBusy} error={sheetError} onPlace={placeExtra} onClose={() => { setSheet(null); setSheetError(null); }} />
      ) : null}
      <Modal visible={Boolean(sellTarget) && Boolean(pricing)} transparent animationType="fade" onRequestClose={() => setSellTarget(null)}>
        <View style={sx.modalBackdrop}>
          <Pressable style={absoluteFill} onPress={() => setSellTarget(null)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={sx.modalCard}>
            {sellTarget && pricing ? (
              <SellTitleSheet
                target={sellTarget}
                price={pricing.prices ? pricing.prices[`${sellTarget.type}:${sellTarget.id}`] || null : null}
                blocked={pricing.blocked ? pricing.blocked[`${sellTarget.type}:${sellTarget.id}`] || null : null}
                settings={pricing.settings || {}}
                isAdmin={Boolean(viewer.isAdmin)}
                getToken={() => freshToken(getToken)}
                onClose={() => setSellTarget(null)}
                onSaved={() => { loadPricing(); load({ quiet: true }); }}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </AccountFrame>
  );
}

const sx = StyleSheet.create({
  body: { gap: 16 },
  skeleton: { height: 160, borderRadius: 12, backgroundColor: colors.surface1 },
  flash: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: okTint(0.5), backgroundColor: okTint(0.1) },
  emptySeason: { gap: 8, padding: 14, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25) },
  addSeason: { gap: 4, padding: 14, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25) },
  addSeasonText: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.surface1, borderRadius: 14, padding: 18, width: '100%', maxWidth: 420 },
  dollar: { fontFamily: fonts.monoBold, fontSize: 15, color: colors.olive }
});
