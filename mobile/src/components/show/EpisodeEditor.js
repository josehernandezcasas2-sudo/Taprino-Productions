import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { freshToken } from '../../lib/api';
import { currentUpload, startTusUpload } from '../../lib/tusUpload';
import { joinDescription, planMove, saveSummary, splitDescription, undoMoveSteps } from '../../lib/showRules';
import { bytesLabel, parseAdBreaks, runtimeClock } from '../../lib/submitRules';
import { migrationRefusal, showPath } from '../../lib/showApi';
import { assetName } from '../../lib/showUploadQueue';
import { colors, fonts, inkTint } from '../../lib/theme';
import { AccountFrame } from '../account/AccountBits';
import { pickImageAsDataUrl, pickVideo, useUploadProgress } from '../CreatorBits';
import SmartImage from '../SmartImage';
import { ClockIcon, ExternalLinkIcon, TrashIcon, WarningIcon } from '../WorkIcons';
import MoveSheet from './MoveSheet';
import DraftEditor from './DraftEditor';
import CreditsFields, { creditsFormBody, creditsFormKey, creditsToForm } from './CreditsFields';
import {
  ArtSlot, Banner, CancelButton, ChoiceChips, ClockLine, EdInput, EditorFoot, EditorHead, FieldHead, FieldNote, FootNote,
  LOCKED_FALLBACK, NEEDS_118, NOT_SAVED_WORDS, PILL_TONE, SaveButton, SectionHead, StagedBox, StatusLine, SwitchRow, UploadLine,
  isOpen, masterWords, openOnWebsite, useFootSpace, useInFront, useKeyboardShown, useLeaveGuard, useShowAuth
} from './EditorBits';
import { AboutField, MoreOptions, OneLineField, PlaceBlock, SameAsShow, StagedLegend, TitleField } from './EpisodeFields';
import { PREVIEW_BUILT } from './ShowCards';
import PayeeCard, { PaidLine } from './PayeeCard';
import ExtraKindField from '../ExtraKindField';
import { extraKindChoice, extraKindFromChoice, extraKindLabel } from '../../lib/extraKinds';
import {
  CheckIcon, LinkText, PlusIcon, RoomToast, SmallButton, UploadIcon, askUs, episodeEditorRoute, episodePublicRoute,
  shortDate, showRoute, ss, submitRoute, useRoomToast
} from './ShowBits';

// The episode editor in the app (the series revamp, slice 5; spec "App —
// New show, Show page, Episode editor"; the website's components/show/
// EpisodeEditor.js, the same words): one screen for every episode of a
// show (and an extra or a standalone title opened the same way), its
// three parts stacked — Basics (the file, the title, one line), More info
// (about, the art, "Same as the show", captions, the trailer, the funding
// link, its own page and notes, the credits, extras, the folded options)
// and Place (season and number, Move to another show, Remove). Read from
// GET /api/show/episode/<id> and saved with PATCH, field by field as the
// payload's `policy` says: applies at once, waits for approval (the
// waiting value with Cancel → DELETE …/staged), or is the team's (the
// server's words under it). The Save bar names what goes to review.
// On a live episode a new title image, its removal and a new trailer wait
// too (migration 120, slice 3a; ShowEditor's Art tab, the same words);
// before 120 the policy locks them with the server's line.
//
// The app's habits: a poster, still or title image picked from the library
// is saved the moment it's picked (or cut from the film), and a trailer the
// moment its upload ends; "Replace the file" uploads through
// mobile/src/lib/tusUpload.js (one upload at a time) and then POST
// …/video. Captions are added on the website (no document picker here).
// A draft (an episode not sent yet) opens in DraftEditor.
//
// Props: { showId, episodeId, isDraft (the row said so: skip the episode
// read), sent (just sent from a draft: say so) }.

const DESC_MAX = 4000;
const NOTES_MAX = 4000;
const POLL_MS = 15000;
const POLL_MAX = 40;
const enc = (x) => encodeURIComponent(String(x));

// [0, 600, 1230] → "0:00, 10:00, 20:30" (the website's lib/adBreaks.js).
function formatAdBreaks(seconds) {
  if (!Array.isArray(seconds) || seconds.length === 0) return '0:00';
  return seconds.slice().sort((a, b) => a - b).map((s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`).join(', ');
}

function episodeForm(ep, hasShow) {
  const d = splitDescription(ep.description || '');
  return {
    // "Episode N" is what an untitled episode is stored as (lib/showPage.js
    // numberTitle): the field stays empty, with the number as its placeholder.
    title: ep.title && !(ep.seriesOrder && ep.title === `Episode ${ep.seriesOrder}`) ? ep.title : '',
    oneLine: d.oneLine,
    about: d.about,
    mainGenre: ep.mainGenre || '',
    genre: ep.genre || '',
    artist: ep.artist || '',
    releaseYear: ep.releaseYear ? String(ep.releaseYear) : '',
    rating: ep.rating || '',
    tier: ep.tier === 'premium' ? 'premium' : 'free',
    runtime: ep.runtime || '',
    fundingUrl: ep.fundingUrl || '',
    adsEnabled: ep.adsEnabled !== false,
    adBreaksText: formatAdBreaks(ep.adBreakSeconds),
    channelOptIn: Boolean(ep.channelOptIn),
    featured: Boolean(ep.featured),
    isOriginal: Boolean(ep.isOriginal),
    hasPage: Boolean(ep.hasPage),
    pageNotes: ep.pageNotes || '',
    credits: creditsToForm(ep.credits, { inherit: hasShow }),
    season: Number(ep.season) || 1,
    number: ep.seriesOrder ? String(ep.seriesOrder) : '',
    bonusParentType: ep.bonus ? ep.bonus.parentType || null : null,
    bonusParentId: ep.bonus ? ep.bonus.parentId || null : null,
    // What kind of extra (migration 121): which chip is on, and the words
    // under Other.
    extraKindChoice: extraKindChoice(ep.extraKind).choice,
    extraKindOther: extraKindChoice(ep.extraKind).other
  };
}

// The rows planMove reads, from a positions answer (episodes only: a move
// of an episode never pushes drafts along).
function rowsFromPositions(pos, seriesId, contentType) {
  if (!pos || !pos.taken) return [];
  return Object.entries(pos.taken)
    .filter(([, h]) => h && h.kind !== 'draft')
    .map(([n, h]) => ({ id: h.id, title: h.title || null, seriesId, season: pos.season, seriesOrder: Number(n), status: h.status || 'approved', contentType }));
}

function uploadBusy() {
  const cur = currentUpload();
  return Boolean(cur && ['requesting-url', 'uploading'].includes(cur.status));
}

// A stopped "Replace the file" upload, kept while the app runs: the same
// file picked again resumes from tus's address.
const replaceMemo = new Map();

export default function EpisodeEditor({ showId, episodeId, isDraft = false, sent = false }) {
  const auth = useShowAuth();
  const { call, isLoaded, isSignedIn } = auth;
  const [state, setState] = useState({ phase: 'loading' });

  const load = useCallback(async () => {
    if (!isDraft) {
      const r = await call('GET', `/api/show/episode/${enc(episodeId)}`);
      if (r.ok) return setState({ phase: 'episode', data: r.data });
      if (r.status !== 404) return setState({ phase: 'error', status: r.status, error: r.error });
    }
    const d = await call('GET', `/api/creator/drafts?id=${enc(episodeId)}`);
    if (d.ok && d.data.draft) return setState({ phase: 'draft', draft: d.data.draft });
    if (d.status !== 404 && d.status !== 400) return setState({ phase: 'error', status: d.status, error: d.error });
    return setState({ phase: 'error', status: 404, error: isDraft ? 'That draft isn’t there any more — it may have been sent or discarded.' : 'That episode isn’t there.' });
  }, [call, episodeId, isDraft]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    setState({ phase: 'loading' });
    load();
  }, [isLoaded, isSignedIn, load]);

  if (state.phase === 'episode') return <EpisodeMode key={`e-${episodeId}`} showId={showId} initial={state.data} auth={auth} sent={sent} />;
  if (state.phase === 'draft') return <DraftEditor key={`d-${episodeId}`} showId={showId} initialDraft={state.draft} auth={auth} />;
  const notThere = state.status === 404;
  return (
    <AccountFrame title={state.phase === 'loading' ? null : notThere ? 'Not here' : 'Couldn’t open it'} dashboard={auth.dashboard} back={{ href: showRoute(showId), label: 'The show' }}>
      {state.phase === 'loading' ? (
        <View style={{ gap: 12 }} accessibilityLabel="Loading the episode">
          <View style={es.skeleton} /><View style={[es.skeleton, { height: 90 }]} /><View style={[es.skeleton, { height: 60 }]} />
        </View>
      ) : (
        <View style={ss.card} accessibilityRole="alert">
          <Text style={ss.p}>{state.error}</Text>
          {!notThere ? <SmallButton label="Try again" onPress={() => { setState({ phase: 'loading' }); load(); }} /> : null}
        </View>
      )}
    </AccountFrame>
  );
}

function EpisodeMode({ showId, initial, auth, sent }) {
  const router = useRouter();
  const { call, getToken, dashboard } = auth;
  const upload = useUploadProgress();
  const inFront = useInFront();
  const keyboard = useKeyboardShown();
  const { toast, say } = useRoomToast();
  const foot = useFootSpace();
  const scrollRef = useRef(null);
  const bodyY = useRef(0);
  const placeY = useRef(0);

  const [data, setData] = useState(initial);
  const ep = data.episode;
  const show = data.show;
  const viewer = data.viewer || {};
  const policy = data.policy || {};
  const pol = useCallback((f) => policy[f] || LOCKED_FALLBACK, [policy]);
  // A 503 seen at run time (the payload said 118 was there, a route said it
  // isn't): the server's own line, and the controls that need it grey.
  const [behind, setBehind] = useState({});
  const noteBehind = useCallback((r) => {
    const m = migrationRefusal(r) || (r && r.status === 503 && r.data && r.data.code === 'migration-120' ? { code: 'migration-120', line: r.error } : null);
    if (m) setBehind((b) => ({ ...b, [m.code]: m.line }));
    return Boolean(m);
  }, []);
  // The title image and the trailer wait in 120's columns on a live
  // episode; a 503 seen at run time locks them with the server's line.
  const artPol = useCallback((f) => {
    const p = policy[f] || LOCKED_FALLBACK;
    return behind['migration-120'] && p.mode === 'staged' ? { mode: 'locked', line: behind['migration-120'] } : p;
  }, [policy, behind]);
  const has118 = (!data.migration || data.migration.shows118 !== false) && !behind['migration-118'];
  const inShow = Boolean(show) && (ep.contentType === 'series' || ep.contentType === 'podcast');
  const isExtra = ep.contentType === 'bonus';
  const contentType = ep.contentType === 'podcast' ? 'podcast' : 'series';
  const theShowId = show ? show.id : showId;
  const live = ep.status === 'approved';
  const epPath = `/api/show/episode/${enc(ep.id)}`;

  const [form, setForm] = useState(() => episodeForm(initial.episode, Boolean(initial.show)));
  const [init, setInit] = useState(() => episodeForm(initial.episode, Boolean(initial.show)));
  const [resets, setResets] = useState(() => new Set());
  const [replace, setReplace] = useState(null);
  const [trailerUp, setTrailerUp] = useState(null);
  const [fileMsg, setFileMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [removal, setRemoval] = useState({ open: false, reason: '' });
  const [seasonPos, setSeasonPos] = useState({});
  const [anchorEpisodes, setAnchorEpisodes] = useState(null);
  const [takenNext, setTakenNext] = useState(null);

  useEffect(() => {
    if (sent) say({ tone: 'ok', title: 'Sent for review', lines: [`${initial.episode.code || 'It'} is in review now.`] }, 6000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResets((r) => {
      if (!r.has(key)) return r;
      const next = new Set(r);
      next.delete(key);
      return next;
    });
  }, []);

  const defaults = (show && show.defaults) || {};
  const reset = useCallback((key) => {
    const d = (show && show.defaults) || {};
    const value = key === 'genre' || key === 'artist' || key === 'releaseYear' ? '' : key === 'tier' ? (d.tier === 'premium' ? 'premium' : 'free') : d[key] || '';
    setForm((f) => ({ ...f, [key]: value }));
    setResets((r) => new Set(r).add(key));
  }, [show]);

  const applyView = useCallback((view, { resetForm = false, place = false } = {}) => {
    setData(view);
    if (resetForm) {
      const f = episodeForm(view.episode, Boolean(view.show));
      setForm(f);
      setInit(f);
      setResets(new Set());
      setSeasonPos({});
    } else if (place) {
      const f = episodeForm(view.episode, Boolean(view.show));
      setInit((i) => ({ ...i, season: f.season, number: f.number, bonusParentType: f.bonusParentType, bonusParentId: f.bonusParentId }));
      setForm((x) => ({ ...x, season: f.season, number: f.number, bonusParentType: f.bonusParentType, bonusParentId: f.bonusParentId }));
      setSeasonPos({});
    }
  }, []);

  const reload = useCallback(async (opts = {}) => {
    const r = await call('GET', epPath);
    if (r.ok) applyView(r.data, opts);
    return r;
  }, [call, epPath, applyView]);

  // "Who gets paid" changed (slice 3b): the server's words, its new block
  // at once, then the editor again (the form stays as it is).
  const onPayeeChanged = useCallback((next, words) => {
    if (words) say({ tone: 'ok', title: words }, 7000);
    if (next) setData((d) => ({ ...d, payee: next }));
    reload();
  }, [say, reload]);

  // --- what changed, and what saving it does -------------------------------
  const creditOpts = useMemo(() => ({ inherit: Boolean(show), showOrder: null }), [show]);
  const computed = useMemo(() => {
    const body = {};
    const changes = [];
    const add = (field, key, value, policyField) => {
      body[key] = value;
      changes.push({ field, mode: pol(policyField || field).mode });
    };
    if (form.title.trim() !== init.title.trim()) add('title', 'title', form.title.trim());
    const desc = joinDescription(form.oneLine, form.about);
    if (desc !== joinDescription(init.oneLine, init.about)) add('description', 'description', desc);
    for (const key of ['mainGenre', 'genre', 'artist', 'rating', 'tier', 'releaseYear']) {
      if (resets.has(key)) {
        add(key, key, null);
        continue;
      }
      if (String(form[key]).trim() === String(init[key]).trim()) continue;
      add(key, key, key === 'releaseYear' ? form.releaseYear.trim() || null : typeof form[key] === 'string' ? form[key].trim() : form[key]);
    }
    if (form.runtime.trim() !== init.runtime.trim()) add('runtime', 'runtime', form.runtime.trim());
    if (form.fundingUrl.trim() !== init.fundingUrl.trim()) add('fundingUrl', 'fundingUrl', form.fundingUrl.trim());
    for (const key of ['adsEnabled', 'channelOptIn', 'featured', 'isOriginal']) if (form[key] !== init[key]) add(key, key, form[key]);
    const breaks = parseAdBreaks(form.adBreaksText);
    if (JSON.stringify(breaks) !== JSON.stringify(parseAdBreaks(init.adBreaksText))) add('adBreakSeconds', 'adBreakSeconds', breaks);
    if (form.hasPage !== init.hasPage) add('hasPage', 'hasPage', form.hasPage);
    if (form.pageNotes.trim() !== init.pageNotes.trim()) add('pageNotes', 'pageNotes', form.pageNotes.trim());
    if (creditsFormKey(form.credits, creditOpts) !== creditsFormKey(init.credits, creditOpts)) add('credits', 'credits', creditsFormBody(form.credits, creditOpts));
    if (inShow && (Number(form.season) !== Number(init.season) || String(form.number) !== String(init.number))) {
      body.season = Number(form.season);
      body.seriesOrder = Number(form.number) || form.number;
      changes.push({ field: 'place', mode: pol('season').mode });
    }
    if (isExtra) {
      const kind = extraKindFromChoice(form.extraKindChoice, form.extraKindOther);
      if (kind !== extraKindFromChoice(init.extraKindChoice, init.extraKindOther)) add('extraKind', 'extraKind', kind);
    }
    if (isExtra && (form.bonusParentType !== init.bonusParentType || form.bonusParentId !== init.bonusParentId)) {
      body.bonusParentType = form.bonusParentType;
      if (form.bonusParentType === 'episode') body.bonusParentId = form.bonusParentId;
      changes.push({ field: 'bonusParent', mode: pol('bonusParent').mode });
    }
    return { body, changes };
  }, [form, init, resets, pol, creditOpts, inShow, isExtra]);
  const summary = saveSummary(computed.changes);
  const dirty = computed.changes.length > 0;
  const leave = useLeaveGuard(dirty);
  const edited = (field) => computed.changes.some((c) => c.field === field);

  // --- the place: season, number, what a taken number offers ----------------
  const curSeason = Number(form.season) || 1;
  const basePos = data.positions && Number(data.positions.season) === curSeason ? data.positions : null;
  const pos = basePos || (seasonPos[curSeason] && seasonPos[curSeason].data) || null;
  const posLoading = Boolean(inShow && !pos && seasonPos[curSeason] && seasonPos[curSeason].state === 'loading');
  useEffect(() => {
    if (!inShow || basePos || seasonPos[curSeason]) return;
    setSeasonPos((p) => ({ ...p, [curSeason]: { state: 'loading' } }));
    call('GET', `${showPath(theShowId)}/positions?season=${curSeason}&exclude=${enc(ep.id)}`).then((r) => {
      setSeasonPos((p) => ({ ...p, [curSeason]: r.ok ? { state: 'ready', data: r.data } : { state: 'error', error: r.error } }));
      if (r.ok) setForm((f) => (Number(f.season) === curSeason && !String(f.number).trim() ? { ...f, number: String(r.data.nextFree || 1) } : f));
    });
  }, [inShow, basePos, seasonPos, curSeason, theShowId, ep.id, call]);

  const numberN = Number(form.number) || null;
  const holderRaw = pos && numberN && pos.taken ? pos.taken[numberN] : null;
  const holder = holderRaw && holderRaw.id !== ep.id ? holderRaw : null;
  const placeChanged = inShow && (Number(form.season) !== Number(init.season) || String(form.number) !== String(init.number));
  const placeBlocked = Boolean(placeChanged && holder && holder.kind !== 'draft');
  const previews = useMemo(() => {
    if (!holder || holder.kind === 'draft' || !pos || !numberN) return {};
    const rows = [];
    const seen = new Set();
    const add = (r) => { if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); } };
    add({ id: ep.id, title: ep.title || null, seriesId: theShowId, season: Number(init.season) || 1, seriesOrder: Number(init.number) || null, status: ep.status, contentType });
    if (data.positions) for (const r of rowsFromPositions(data.positions, theShowId, contentType)) add(r);
    for (const r of rowsFromPositions(pos, theShowId, contentType)) add(r);
    const words = (m) => {
      const p = planMove(rows, ep.id, { season: curSeason, number: numberN, mode: m });
      return p.ok ? p.words : null;
    };
    return { swap: words('swap'), insert: words('insert') };
  }, [holder, pos, numberN, ep, theShowId, init.season, init.number, data.positions, contentType, curSeason]);

  function pickSeason(n) {
    if (n === Number(init.season)) setForm((f) => ({ ...f, season: n, number: init.number }));
    else {
      const p = data.positions && Number(data.positions.season) === n ? data.positions : seasonPos[n] && seasonPos[n].data;
      setForm((f) => ({ ...f, season: n, number: p ? String(p.nextFree || 1) : '' }));
    }
  }

  // Undo for a move (Swap / Insert here, the Move sheet inside this show):
  // the steps undoMoveSteps builds from the route's rows.
  const undoFor = useCallback((rows) => {
    const steps = undoMoveSteps(rows, ep.id);
    if (!steps) return null;
    return async () => {
      for (const s of steps) {
        const r = await call('POST', `${showPath(theShowId)}/${s.route}`, s.body);
        if (!r.ok) {
          say({ tone: 'warn', title: 'Couldn’t undo that', lines: [r.error] });
          await reload({ place: true });
          return;
        }
      }
      await reload({ place: true });
      say({ tone: 'ok', title: 'Undone' }, 4000);
    };
  }, [call, ep.id, theShowId, reload, say]);

  async function placeVia(how) {
    setBusy('place');
    setError(null);
    const r = await call('POST', `${showPath(theShowId)}/move`, { episodeId: ep.id, toSeason: curSeason, toNumber: numberN, mode: how });
    if (!r.ok) {
      setBusy(null);
      noteBehind(r);
      setError(r.error);
      return;
    }
    // The place fields stay closed until the new numbers are read back, so
    // nothing typed meanwhile is overwritten.
    await reload({ place: true });
    setBusy(null);
    say({ tone: 'ok', title: r.data.unchanged ? 'Nothing moved' : 'Moved', lines: [r.data.words, ...(r.data.lines || [])].filter(Boolean), undo: r.data.unchanged ? null : undoFor(r.data.rows) }, 8000);
  }

  // An extra's anchor: the show's episodes to hang it after.
  useEffect(() => {
    if (!isExtra || !show || anchorEpisodes) return;
    call('GET', showPath(show.id)).then((r) => {
      if (!r.ok) {
        setAnchorEpisodes([]);
        return;
      }
      const list = [];
      for (const s of r.data.seasons || []) for (const row of s.rows || []) if (row.kind === 'episode') list.push({ id: row.id, code: row.code, title: row.displayTitle || row.title });
      setAnchorEpisodes(list);
    });
  }, [isExtra, show, anchorEpisodes, call]);

  // --- the file: its state while it processes ------------------------------
  const masterState = ep.master ? ep.master.state : 'none';
  const pendingVideo = ep.staged && ep.staged.video;
  const watching = ['uploading', 'processing'].includes(masterState) || Boolean(pendingVideo && !pendingVideo.ready);
  useEffect(() => {
    if (!watching) return undefined;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n > POLL_MAX) {
        clearInterval(t);
        return;
      }
      if (!inFront()) return;
      const r = await call('GET', epPath);
      if (r.ok) setData(r.data);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [watching, epPath, call, inFront]);

  const busyUpload = Boolean(upload && ['requesting-url', 'uploading'].includes(upload.status));
  const pctOf = (u) => (u && u.total ? Math.min(100, Math.round((u.sent / u.total) * 100)) : 0);
  const replaceUploading = Boolean(replace && upload && upload.uid === replace.uid && busyUpload);
  const trailerUploading = Boolean(trailerUp && upload && upload.uid === trailerUp.uid && busyUpload);
  const uploadPath = `/api/creator/get-upload-url${(inShow || isExtra) && theShowId ? `?seriesId=${enc(theShowId)}` : ''}`;

  async function sendReplacement(uid) {
    setReplace((x) => (x && x.uid === uid ? { ...x, state: 'sending', error: null } : x));
    const r = await call('POST', `${epPath}/video`, { videoUid: uid });
    if (!r.ok) {
      noteBehind(r);
      setReplace((x) => (x && x.uid === uid ? { ...x, state: 'failed', error: r.error } : x));
      return;
    }
    replaceMemo.delete(ep.id);
    setReplace(null);
    setFileMsg(r.data.message || 'The new file is in.');
    await reload({});
  }

  async function pickReplacement() {
    setFileMsg(null);
    setError(null);
    if (uploadBusy()) {
      setReplace({ state: 'blocked', error: 'Another upload is running — let it finish first.' });
      return;
    }
    let asset = null;
    try {
      asset = await pickVideo();
    } catch (err) {
      setError(err.message);
      return;
    }
    if (!asset) return;
    const name = assetName(asset);
    const bytes = Number(asset.fileSize) || 0;
    const saved = replaceMemo.get(ep.id);
    const resumeUrl = saved && saved.uploadUrl && saved.name === name && saved.bytes === bytes ? saved.uploadUrl : null;
    try {
      const started = await startTusUpload({
        asset,
        urlPath: uploadPath,
        token: await freshToken(getToken),
        resumeUrl,
        kind: 'main',
        onUrl: (url) => replaceMemo.set(ep.id, { uploadUrl: url, name, bytes })
      });
      setReplace({ uid: started.uid, name, bytes, state: 'uploading' });
      started.done
        .then(() => sendReplacement(started.uid))
        .catch(() => setReplace((x) => (x && x.uid === started.uid ? { ...x, state: 'stopped' } : x)));
    } catch (err) {
      setReplace({ state: 'failed', name, error: (err && err.message) || 'Could not start the upload.' });
    }
  }

  // A trailer is attached the moment its upload ends (the app's habit).
  async function attachTrailer(uid) {
    setTrailerUp((t) => (t && t.uid === uid ? { ...t, state: 'saving' } : t));
    const r = await call('PATCH', epPath, { trailerUid: uid });
    if (!r.ok) {
      noteBehind(r);
      setTrailerUp((t) => (t && t.uid === uid ? { ...t, state: 'failed', error: r.error } : t));
      return;
    }
    setTrailerUp(null);
    setData(r.data.view);
    const waits = (r.data.staged || []).includes('trailer');
    const liveTrailer = Boolean(r.data.view && r.data.view.episode && r.data.view.episode.trailer);
    const waitLine = waits ? (liveTrailer ? 'The current one keeps playing until we approve it.' : 'No trailer plays until we approve it.') : null;
    say({ tone: 'ok', title: waits ? 'The trailer waits for approval' : 'Trailer saved', lines: [waitLine, ...(r.data.notices || [])].filter(Boolean) });
  }

  async function pickTrailer() {
    setError(null);
    if (uploadBusy()) {
      setError('Another upload is running — pick the trailer once it has finished.');
      return;
    }
    let asset = null;
    try {
      asset = await pickVideo();
    } catch (err) {
      setError(err.message);
      return;
    }
    if (!asset) return;
    try {
      const started = await startTusUpload({ asset, urlPath: uploadPath, token: await freshToken(getToken), kind: 'trailer' });
      setTrailerUp({ uid: started.uid, name: assetName(asset), state: 'uploading' });
      started.done
        .then(() => attachTrailer(started.uid))
        .catch(() => setTrailerUp((t) => (t && t.uid === started.uid ? { ...t, state: 'stopped' } : t)));
    } catch (err) {
      setError((err && err.message) || 'Could not start the trailer upload.');
    }
  }

  // --- the art: saved the moment it's picked --------------------------------
  const ART_WORDS = { poster: 'The poster', thumbnail: 'The still', titleImage: 'The title image' };
  async function saveArt(field, body, words = ART_WORDS[field]) {
    setBusy(`art-${field}`);
    setError(null);
    const r = await call('PATCH', epPath, body);
    setBusy(null);
    if (!r.ok) {
      noteBehind(r);
      say({ tone: 'warn', title: `${words} wasn’t saved`, lines: [r.error] }, 8000);
      return;
    }
    setData(r.data.view);
    const waits = (r.data.staged || []).length > 0;
    say({
      tone: 'ok',
      title: r.data.unchanged ? 'Nothing changed' : waits ? `${words} waits for approval` : `${words} is saved`,
      lines: [waits ? 'Visitors see the live one until we approve it.' : null, ...(r.data.notices || [])].filter(Boolean)
    });
  }
  async function pickArt(field) {
    let img = null;
    try {
      img = await pickImageAsDataUrl({ width: field === 'poster' ? 600 : field === 'titleImage' ? 1200 : 1280, format: field === 'titleImage' ? 'png' : 'jpeg' });
    } catch (err) {
      setError(err.message);
      return;
    }
    if (!img) return;
    saveArt(field, { [`${field}Base64`]: img.base64, [`${field}FileName`]: img.fileName });
  }
  function removeTitleImage() {
    Alert.alert('Remove the title image?', 'The name shows as text again.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => saveArt('titleImage', { removeTitleImage: true }, 'Removing the title image') }
    ]);
  }

  // --- actions that apply on their own (not part of Save) ------------------
  async function cancelStaged(field) {
    setBusy(`cancel-${field}`);
    setError(null);
    const r = await call('DELETE', `${epPath}/staged?field=${enc(field)}`);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    say({ tone: 'ok', title: 'Taken back', lines: ['What was live stays live.'] });
    await reload({});
  }

  async function askRemoval(action) {
    setBusy('removal');
    setError(null);
    const r = await call('POST', `${epPath}/removal`, action === 'cancel' ? { action: 'cancel' } : { action: 'request', reason: removal.reason.trim() });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRemoval({ open: false, reason: '' });
    say({ tone: 'ok', title: action === 'cancel' ? 'Removal cancelled' : 'Removal requested', lines: action === 'cancel' ? [] : [r.data.hiddenNow ? 'It’s hidden from the site while we look.' : 'We look at it and take it down.'] });
    await reload({ resetForm: true });
  }

  // --- Save -----------------------------------------------------------------
  async function save({ resubmit = false } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const body = { ...computed.body };
    if (resubmit) body.resubmit = true;
    const r = await call('PATCH', epPath, body);
    setSaving(false);
    if (!r.ok) {
      noteBehind(r);
      setError(r.error);
      if (r.status === 409 && r.data && r.data.code === 'taken') {
        // The number went meanwhile: the server's words, "Use E<n>", and
        // the season's numbers read again (the Place box then offers Swap).
        setTakenNext(r.data.nextFree || null);
        setSeasonPos({});
        reload({});
        if (scrollRef.current) scrollRef.current.scrollTo({ y: Math.max(0, bodyY.current + placeY.current - 60), animated: true });
      }
      return;
    }
    setTakenNext(null);
    const view = r.data.view;
    applyView(view, { resetForm: true });
    const lines = [];
    if (r.data.message) lines.push(r.data.message);
    for (const n of r.data.notices || []) lines.push(n);
    for (const ns of r.data.notSaved || []) lines.push(`Not saved — ${NOT_SAVED_WORDS[ns.field] || ns.field}: ${ns.reason}`);
    const stagedN = (r.data.staged || []).length;
    say({
      tone: (r.data.notSaved || []).length ? 'warn' : 'ok',
      title: r.data.unchanged ? 'Nothing to save' : stagedN ? `Saved — ${stagedN === 1 ? '1 change waits' : `${stagedN} changes wait`} for approval` : resubmit ? 'Sent again for review' : 'Saved',
      lines
    }, 7000);
  }

  // --- the head, the banners --------------------------------------------------
  const title = ep.displayTitle || ep.title || 'Untitled';
  const placeholder = ep.inherited && ep.inherited.title && !ep.title ? ep.inherited.title : ep.seriesOrder ? `Episode ${ep.seriesOrder}` : 'Title';
  const eyebrow = [show ? show.name : isExtra ? extraKindLabel(ep.extraKind) : null, ep.code || (isExtra && ep.bonus && ep.bonus.code ? `After ${ep.bonus.code}` : null)].filter(Boolean).join(' · ');
  const pill = { text: ep.statusLabel || 'Live', tone: PILL_TONE[ep.statusLabel] || 'neutral' };
  const viewable = live && !ep.held && !ep.deletionRequested && !ep.withdrawnAt && (!show || show.isPublic);
  const statusLine = ep.withdrawnAt ? 'Withdrawn · kept for its buyers'
    : ep.deletionRequested ? `Removal requested${ep.deletionRequestedAt ? ` on ${shortDate(ep.deletionRequestedAt)}` : ''}`
      : ep.held ? 'Pulled while an admin looks at it'
        : ep.status === 'pending' ? `In review since ${shortDate(ep.createdAt) || 'it was sent'}`
          : ep.status === 'rejected' ? 'Not this time'
            : show && !show.isPublic ? 'Approved · the show isn’t public yet'
              : `Live${ep.releasedAt || ep.reviewedAt ? ` since ${shortDate(ep.releasedAt || ep.reviewedAt)}` : ''}`;
  const st = ep.staged || {};
  const stagedFields = [
    st.title ? { field: 'title', words: `title “${st.title}”` } : null,
    st.description ? { field: 'description', words: 'an edited description' } : null,
    st.poster ? { field: 'poster', words: 'the poster' } : null,
    st.thumbnail ? { field: 'thumbnail', words: 'the still' } : null,
    // Migration 120: a waiting image replaces a waiting removal and the
    // other way round, so at most one of these two is there.
    st.titleImageUrl ? { field: 'titleImage', words: 'a new title image' } : st.titleImageRemoval ? { field: 'titleImage', words: 'removing the title image' } : null,
    st.trailer ? { field: 'trailer', words: 'a new trailer' } : null,
    st.video ? { field: 'video', words: `a new file (${st.video.ready ? 'ready' : masterWords(st.video.state).text.toLowerCase()})` } : null
  ].filter(Boolean);
  const canAct = viewer.isUploader || viewer.team;
  // Taking back a waiting change is the uploader's (the team decides it on
  // the website's admin page, where Deny tells them).
  const canCancel = Boolean(viewer.isUploader);

  const banners = (
    <>
      {stagedFields.length > 0 ? (
        <Banner level="review" icon={<ClockIcon size={16} color={colors.olive} />} title="Changes awaiting review:">
          {stagedFields.map((s) => (
            <View key={s.field} style={es.bannerItem}>
              <Text style={[ss.p, { flex: 1 }]}>{s.words}</Text>
              {canCancel ? <CancelButton busy={busy === `cancel-${s.field}`} onPress={() => cancelStaged(s.field)} /> : null}
            </View>
          ))}
        </Banner>
      ) : null}
      {ep.status === 'rejected' ? (
        <Banner
          level="warn"
          icon={<WarningIcon size={16} color={colors.brass} />}
          title={`Not this time${ep.rejectionReason ? ':' : ''}`}
          action={canAct && !ep.deletionRequested ? <SmallButton label={saving ? 'Sending…' : 'Send again for review'} busy={saving} onPress={() => save({ resubmit: true })} /> : null}
        >
          {ep.rejectionReason ? <Text style={ss.p}>{ep.rejectionReason}</Text> : null}
          <Text style={ss.small}>Fix what it needs here, then send it again{computed.changes.length ? ' — your changes go with it' : ''}.</Text>
        </Banner>
      ) : null}
      {ep.held ? (
        <Banner level="danger" icon={<WarningIcon size={16} color={colors.danger} />} title={`Pulled${ep.holdReason ? `: ${ep.holdReason}` : ''}`}>
          <Text style={ss.small}>Captions, the notes and a new file still work; everything else waits. <LinkText onPress={() => askUs(`Pulled: ${title}`)}>Email us</LinkText></Text>
        </Banner>
      ) : null}
      {ep.deletionRequested && !ep.withdrawnAt ? (
        <Banner
          level="neutral"
          title={`Removal requested${ep.deletionRequestedAt ? ` on ${shortDate(ep.deletionRequestedAt)}` : ''}`}
          action={viewer.isUploader ? <CancelButton busy={busy === 'removal'} onPress={() => askRemoval('cancel')} /> : null}
        >
          {ep.deletionReason ? <Text style={ss.p}>{ep.deletionReason}</Text> : null}
          <Text style={ss.small}>Nothing can change while it waits.</Text>
        </Banner>
      ) : null}
      {ep.withdrawnAt ? <Banner level="neutral" title="Withdrawn and kept for its buyers"><Text style={ss.small}>It stays playable for the people who bought it; nothing else changes.</Text></Banner> : null}
      {!has118 ? <Banner level="neutral" title="Its own page, the notes and the credits wait for a database update (migration 118)." /> : null}
    </>
  );

  // --- Basics ----------------------------------------------------------------
  const mw = masterWords(masterState);
  const facts = [ep.runtime || (ep.master && ep.master.durationSeconds ? runtimeClock(ep.master.durationSeconds) : null), mw.note || null].filter(Boolean).join(' · ');
  const videoPolicy = pol('video');
  const replaceLine = live ? 'A new file goes to us first; this one keeps playing until we approve it.' : ep.status === 'pending' ? 'The new file replaces this one; it stays in review.' : ep.status === 'rejected' ? 'It goes back to review with the new file.' : null;
  const art = ep.art || {};
  const thumb = art.thumbnail || art.showThumbnail || null;
  const replaceRight = replaceUploading ? `${pctOf(upload)}%` : replace && replace.state === 'sending' ? 'saving…' : replace && replace.state === 'stopped' ? 'stopped' : replace && replace.state === 'failed' ? 'not saved' : '';
  const fileCard = (
    <View style={ss.card}>
      <Text style={ss.cardK}>The file</Text>
      <View style={es.fileRow}>
        <View style={es.fileThumb}>{thumb ? <SmartImage uri={thumb} style={es.fileThumb} resizeMode="cover" /> : null}</View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={ss.row}>
            {mw.tone === 'ok' ? <CheckIcon size={14} color={colors.ok} /> : null}
            <Text style={[es.fileState, { color: mw.tone === 'ok' ? colors.ok : mw.tone === 'danger' ? colors.danger : mw.tone === 'warn' ? colors.brass : mw.tone === 'review' ? colors.olive : colors.inkDim }]}>{mw.text}</Text>
          </View>
          {facts ? <Text style={ss.mono}>{facts}</Text> : null}
        </View>
      </View>
      {pendingVideo ? (
        <StagedBox title="A new file waits for approval" onCancel={canCancel ? () => cancelStaged('video') : null} busy={busy === 'cancel-video'}>
          <Text style={ss.small}>{pendingVideo.ready ? 'Ready — we look at it next.' : `${masterWords(pendingVideo.state).text}.`} The current file keeps playing.</Text>
        </StagedBox>
      ) : null}
      {replace && replace.state !== 'blocked' ? (
        <UploadLine
          name={replace.name || 'The new file'}
          bytesLabel={bytesLabel(replace.bytes)}
          right={replaceRight}
          pct={replaceUploading ? pctOf(upload) : replace.state === 'sending' ? 100 : 0}
          failed={replace.state === 'failed'}
          meta={replaceUploading ? 'Keep the app open until it’s up.' : replace.state === 'stopped' ? 'The upload stopped — pick the same file again to resume.' : replace.state === 'failed' ? replace.error : null}
        >
          {replace.state === 'failed' && replace.uid ? <LinkText onPress={() => sendReplacement(replace.uid)}>Try again</LinkText> : null}
        </UploadLine>
      ) : null}
      {replace && replace.state === 'blocked' ? <FieldNote policy={{ mode: 'locked', line: replace.error }} /> : null}
      {fileMsg ? <Text style={ss.okText} accessibilityLiveRegion="polite">{fileMsg}</Text> : null}
      {isOpen(videoPolicy) ? (
        <SmallButton
          label={masterState === 'none' ? 'Add the file' : replace && replace.state === 'stopped' ? 'Pick the same file to resume' : 'Replace the file'}
          icon={<UploadIcon size={15} color={colors.ink} />}
          disabled={busyUpload || Boolean(live && behind['migration-118'])}
          onPress={pickReplacement}
        />
      ) : null}
      {live && behind['migration-118'] ? <FieldNote policy={{ mode: 'locked', line: behind['migration-118'] }} /> : null}
      {isOpen(videoPolicy) && replaceLine ? <ClockLine>{replaceLine}</ClockLine> : <FieldNote policy={videoPolicy} />}
    </View>
  );

  // --- More info: the art ------------------------------------------------------
  const canCut = Boolean(ep.master && ep.master.state === 'ready');
  const artSlot = (field, kind, label) => {
    const p = pol(field);
    const own = art[field] || null;
    const showArt = field === 'poster' ? art.showPoster : art.showThumbnail;
    const staged = ep.staged ? ep.staged[field] || null : null;
    const status = staged ? 'waiting' : own ? 'live' : null;
    const artBusy = busy === `art-${field}`;
    return (
      <ArtSlot
        kind={kind}
        label={label}
        status={status}
        policy={p}
        live={own}
        fallback={own ? null : showArt || null}
        fallbackTag={show ? 'Using the show’s art' : null}
        staged={staged}
        stagedNote={`Visitors see the live ${field === 'poster' ? 'poster' : 'still'} until we approve this one.`}
        onCancelStaged={canCancel ? () => cancelStaged(field) : null}
        cancelBusy={busy === `cancel-${field}`}
        emptyTitle="None yet"
        emptyText={show ? null : 'We use a frame of the film until you set one.'}
        caption={own ? 'Its own' : show && showArt ? `From ${show.name} until you set one` : null}
        busy={artBusy}
        actions={isOpen(p) ? (
          <>
            <SmallButton label={own || staged ? 'Replace' : 'Upload'} disabled={Boolean(busy)} onPress={() => pickArt(field)} />
            {canCut ? <SmallButton label="Cut from the film" disabled={Boolean(busy)} onPress={() => saveArt(field, { cutFromFilm: field })} /> : null}
          </>
        ) : null}
      />
    );
  };

  const capPolicy = pol('captions');
  const trailerPolicy = artPol('trailer');
  const aboutMax = DESC_MAX - (form.oneLine.trim() ? form.oneLine.trim().length + 2 : 0);
  const makerLine = (ep.creditLines || []).find((l) => l.key === 'maker');
  const makerName = makerLine ? makerLine.name : form.artist || (show && show.ownerName) || null;
  const titlePolicy = artPol('titleImage');
  const titleWaiting = Boolean(st.titleImageUrl || st.titleImageRemoval);
  const webEditor = `/creator/show/${enc(theShowId)}/episode/${enc(ep.id)}`;

  // --- Place ---------------------------------------------------------------------
  const removalOpen = !ep.deletionRequested && !ep.withdrawnAt;
  const anchorValue = form.bonusParentType === 'episode' ? form.bonusParentId || '' : 'show';

  // --- the footer ---------------------------------------------------------------
  const canSave = computed.changes.length > 0 && !saving && !placeBlocked;

  return (
    <>
      <AccountFrame
        title={null}
        dashboard={dashboard}
        back={{ href: showRoute(theShowId || showId, { ep: ep.id }), label: show ? show.name : 'Your work' }}
        scrollRef={scrollRef}
        overlay={(
          <>
            {!keyboard ? (
              <EditorFoot onHeight={foot.setFootH}>
                {summary.note ? <FootNote>{summary.note}</FootNote> : null}
                {placeBlocked ? <FootNote tone="warn">E{numberN} is taken — pick Swap or Insert here on Place, or another number.</FootNote> : null}
                {error ? <Text style={ss.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
                {error && takenNext && String(form.number) !== String(takenNext) ? (
                  <SmallButton label={`Use E${takenNext}`} onPress={() => { set('number', String(takenNext)); setTakenNext(null); setError(null); }} />
                ) : null}
                <SaveButton label={summary.label} busy={saving} disabled={!canSave} onPress={() => save()} />
                <View style={es.footMeta}>
                  <View style={{ flex: 1 }}><StatusLine tone={pill.tone}>{statusLine}</StatusLine></View>
                  {viewable ? <LinkText onPress={() => router.push(episodePublicRoute(ep.id))}>View page</LinkText> : null}
                </View>
              </EditorFoot>
            ) : null}
            <RoomToast toast={toast} onClose={() => say(null)} bottom={keyboard ? null : foot.toastBottom} />
          </>
        )}
      >
        <View style={es.body} onLayout={(e) => { bodyY.current = e.nativeEvent.layout.y; }}>
          <EditorHead eyebrow={eyebrow} pill={pill} title={title} note={data.payee ? <PaidLine payee={data.payee} /> : null} />
          {banners}

          <SectionHead label="Basics" />
          {fileCard}
          <View style={ss.card}>
            <TitleField
              value={form.title}
              onChange={(v) => set('title', v)}
              policy={pol('title')}
              placeholder={placeholder}
              liveTitle={init.title}
              stagedTitle={ep.staged ? ep.staged.title : null}
              onCancelStaged={canCancel ? () => cancelStaged('title') : null}
              cancelBusy={busy === 'cancel-title'}
              edited={edited('title')}
            />
            <OneLineField value={form.oneLine} onChange={(v) => set('oneLine', v)} policy={pol('description')} edited={edited('description')} />
          </View>
          {isExtra ? (
            <View style={ss.card}>
              <ExtraKindField
                choice={form.extraKindChoice}
                other={form.extraKindOther}
                disabled={!isOpen(pol('extraKind'))}
                onChange={(v) => setForm((f) => ({ ...f, extraKindChoice: v.choice, extraKindOther: v.other }))}
              >
                <FieldNote policy={pol('extraKind')} edited={edited('extraKind')} />
              </ExtraKindField>
            </View>
          ) : null}

          <SectionHead label="More info" />
          {live ? <StagedLegend /> : null}
          <View style={ss.card}>
            <AboutField value={form.about} onChange={(v) => set('about', v)} max={aboutMax} policy={pol('description')} edited={edited('description')} />
          </View>
          <View style={ss.card}>
            <Text style={ss.cardK}>Art</Text>
            {artSlot('poster', 'poster', 'Poster 2:3')}
            {artSlot('thumbnail', 'still', 'Still 16:9')}
            <ArtSlot
              kind="title"
              label="Title image · PNG"
              status={titleWaiting ? 'waiting' : art.titleImageUrl ? 'live' : null}
              policy={titlePolicy}
              live={art.titleImageUrl || null}
              staged={st.titleImageUrl || null}
              stagedNote="Visitors see the live title image until we approve this one."
              onCancelStaged={canCancel ? () => cancelStaged('titleImage') : null}
              cancelBusy={busy === 'cancel-titleImage'}
              emptyTitle={st.titleImageRemoval ? 'Removal waits for approval' : 'None'}
              emptyText="The name set as a picture, shown on the art."
              caption={st.titleImageRemoval && art.titleImageUrl ? 'Removal waits for approval — visitors see it until then.' : null}
              busy={busy === 'art-titleImage'}
              actions={isOpen(titlePolicy) ? (
                <>
                  <SmallButton label={art.titleImageUrl || st.titleImageUrl ? 'Replace' : 'Upload'} disabled={Boolean(busy)} onPress={() => pickArt('titleImage')} />
                  {art.titleImageUrl && !st.titleImageRemoval ? <SmallButton label="Remove" disabled={Boolean(busy)} onPress={removeTitleImage} /> : null}
                  {st.titleImageRemoval && !st.titleImageUrl && canCancel ? <CancelButton busy={busy === 'cancel-titleImage'} onPress={() => cancelStaged('titleImage')} /> : null}
                </>
              ) : null}
            />
            <Text style={ss.small}>A picture is saved the moment you pick it.</Text>
          </View>
          <SameAsShow inShow={Boolean(show)} ctx={{ form, set, defaults, showYear: show ? show.year : null, resets, reset, pol, titleForAsk: `${show ? `${show.name} · ` : ''}${title}` }} />

          <View style={ss.card}>
            <Text style={ss.cardK}>Captions</Text>
            {ep.captions && ep.captions.has ? (
              <Text style={ss.p}><Text style={ss.strong}>{ep.captions.label || 'English'}</Text>  {ep.captions.language || 'en'}</Text>
            ) : (
              <Text style={ss.small}>None yet. Viewers who turn captions on see nothing until you add them.</Text>
            )}
            {ep.captions && ep.captions.stale ? (
              <View style={ss.row}><WarningIcon size={12} color={colors.brass} /><Text style={[ss.small, { flex: 1 }]}>The file changed since these were made — check they still line up.</Text></View>
            ) : null}
            {isOpen(capPolicy) && viewer.isUploader ? (
              <SmallButton label="Add captions on the website" icon={<ExternalLinkIcon size={14} color={colors.ink} />} onPress={() => openOnWebsite(webEditor)} />
            ) : (
              <FieldNote policy={{ mode: 'locked', line: !viewer.isUploader ? 'Only the person who uploaded it can change the captions' : capPolicy.line }} />
            )}
          </View>

          <View style={ss.card}>
            <View style={es.headRow}>
              <View style={ss.row}>
                {trailerPolicy.mode === 'staged' ? <ClockIcon size={12} color={colors.olive} /> : null}
                <Text style={ss.cardK}>Trailer</Text>
              </View>
              <Text style={[ss.mono, { color: !trailerUp && st.trailer ? colors.olive : ep.trailer ? colors.ok : colors.inkDim }]}>{trailerUp ? (trailerUp.state === 'stopped' ? 'STOPPED' : trailerUp.state === 'failed' ? 'NOT SAVED' : 'UPLOADING') : st.trailer ? 'WAITING FOR APPROVAL' : ep.trailer ? 'LIVE' : 'NONE'}</Text>
            </View>
            {trailerUp ? (
              <UploadLine
                name={trailerUp.name}
                right={trailerUploading ? `${pctOf(upload)}%` : trailerUp.state === 'saving' ? 'saving…' : trailerUp.state}
                pct={trailerUploading ? pctOf(upload) : trailerUp.state === 'saving' ? 100 : 0}
                failed={trailerUp.state === 'failed'}
                meta={trailerUp.state === 'failed' ? trailerUp.error : trailerUp.state === 'stopped' ? 'The upload stopped — pick it again.' : 'It’s attached once it’s up. Keep the app open until then.'}
              >
                {trailerUp.state === 'failed' ? <LinkText onPress={() => attachTrailer(trailerUp.uid)}>Try again</LinkText> : null}
                {['stopped', 'failed'].includes(trailerUp.state) ? <LinkText onPress={() => setTrailerUp(null)}>Not this one</LinkText> : null}
              </UploadLine>
            ) : st.trailer ? (
              <StagedBox title="A new trailer waits for approval" onCancel={canCancel ? () => cancelStaged('trailer') : null} busy={busy === 'cancel-trailer'}>
                <Text style={ss.small}>{ep.trailer ? 'The current one keeps playing until then.' : 'No trailer plays until then.'}</Text>
              </StagedBox>
            ) : (
              <Text style={ss.small}>{ep.trailer ? 'A trailer is attached; it plays on its own page and in the show’s hero.' : 'A short clip, 15–30 seconds. Optional.'}</Text>
            )}
            {isOpen(trailerPolicy) && (!trailerUp || ['stopped', 'failed'].includes(trailerUp.state)) ? (
              <SmallButton label={ep.trailer || st.trailer ? 'Replace the trailer' : 'Add a trailer'} icon={<UploadIcon size={15} color={colors.ink} />} disabled={busyUpload} onPress={pickTrailer} />
            ) : null}
            <FieldNote policy={trailerPolicy} />
          </View>

          <View style={ss.card}>
            <FieldHead label="Funding link" hint="optional" locked={pol('fundingUrl').mode === 'locked'} />
            <EdInput value={form.fundingUrl} placeholder="https://" maxLength={500} keyboardType="url" autoCapitalize="none" autoCorrect={false} disabled={!isOpen(pol('fundingUrl'))} onChangeText={(t) => set('fundingUrl', t)} accessibilityLabel="Funding link" />
            <FieldNote policy={pol('fundingUrl')} edited={edited('fundingUrl')} />
          </View>

          <View style={ss.card}>
            <SwitchRow title="Give this episode its own page" on={form.hasPage} onChange={(v) => set('hasPage', v)} disabled={!has118 || !isOpen(pol('hasPage'))} policy={pol('hasPage').mode === 'locked' ? pol('hasPage') : null}>
              People can open a page with notes, credits and the trailer; otherwise it plays straight from the show.
            </SwitchRow>
            {form.hasPage ? (
              <View style={{ gap: 6 }}>
                <FieldHead label="Notes" hint="blank lines make paragraphs" count={form.pageNotes.length} max={NOTES_MAX} />
                <EdInput multiline style={{ minHeight: 120 }} value={form.pageNotes} maxLength={NOTES_MAX} disabled={!has118 || !isOpen(pol('pageNotes'))} placeholder="How it was made, who’s in it, the story behind a scene." onChangeText={(t) => set('pageNotes', t)} accessibilityLabel="Notes" />
                <FieldNote policy={pol('pageNotes')} edited={edited('pageNotes')} />
                {/* Open page when it's live; else the owner's preview (?preview=1, slice 4) unless it was declined. */}
                {viewable ? <LinkText onPress={() => router.push(episodePublicRoute(ep.id))}>Open page</LinkText>
                  : PREVIEW_BUILT && ep.status !== 'rejected' && !ep.withdrawnAt ? <LinkText onPress={() => router.push(episodePublicRoute(ep.id, { preview: true }))}>Preview page</LinkText> : null}
              </View>
            ) : null}
            {!has118 ? <FieldNote policy={NEEDS_118} /> : null}
          </View>

          <View style={ss.card}>
            <Text style={ss.cardK}>Credits</Text>
            <CreditsFields value={form.credits} onChange={(v) => set('credits', v)} inherit={Boolean(show)} showCredits={null} makerName={makerName} makerLabel={contentType === 'podcast' ? 'Hosted by' : 'Made by'} policy={has118 ? pol('credits') : NEEDS_118} />
          </View>

          {!isExtra && show ? (
            <View style={ss.card}>
              <Text style={ss.cardK}>Extras with this episode</Text>
              {(data.extras || []).length ? (
                (data.extras || []).map((x) => (
                  <View key={x.id} style={es.extraRow}>
                    <Text style={[ss.p, { flex: 1, color: colors.ink }]} numberOfLines={1}>{x.title || 'Untitled extra'}</Text>
                    <Text style={ss.mono}>{x.status === 'approved' ? 'Live' : x.status === 'pending' ? 'In review' : x.status === 'rejected' ? 'Not this time' : x.status}</Text>
                  </View>
                ))
              ) : <Text style={ss.small}>None</Text>}
              <SmallButton label="Add extra" icon={<PlusIcon size={14} color={colors.ink} />} onPress={() => router.push(submitRoute({ kind: show.kind, showId: show.id, type: 'bonus' }))} />
            </View>
          ) : null}

          <MoreOptions form={form} set={set} pol={pol} live={live} />

          {/* Slice 3b: who its earnings go to, at the end of More info
              (null for a viewer who may not see who is paid). */}
          {data.payee ? <PayeeCard payee={data.payee} mode="section" onChanged={onPayeeChanged} /> : null}

          <SectionHead label="Place" onLayout={(e) => { placeY.current = e.nativeEvent.layout.y; }} />
          <View style={ss.card}>
            {inShow ? (
              <PlaceBlock
                place={{
                  seasons: data.seasons || [],
                  season: curSeason,
                  number: form.number,
                  wasCode: placeChanged ? ep.code : null,
                  nextFree: pos ? pos.nextFree : null,
                  holder,
                  loading: posLoading,
                  swapWords: previews.swap,
                  insertWords: previews.insert,
                  policy: pol('season'),
                  onSeason: pickSeason,
                  onNumber: (v) => set('number', v),
                  onSwap: has118 && init.number ? () => placeVia('swap') : null,
                  onInsert: has118 ? () => placeVia('insert') : null,
                  moveNote: has118 ? null : 'Swap and Insert here need a database update (migration 118); pick a free number.',
                  busy: busy === 'place'
                }}
              />
            ) : isExtra ? (
              <View style={{ gap: 6 }}>
                <FieldHead label="Attached to" />
                <ChoiceChips
                  options={[{ value: 'show', label: 'With the show' }, ...(anchorEpisodes || []).map((x) => ({ value: x.id, label: `After ${x.code ? `${x.code} · ` : ''}${x.title}` }))]}
                  value={anchorValue}
                  disabled={!isOpen(pol('bonusParent')) || !show}
                  onChange={(v) => {
                    if (v === 'show') setForm((f) => ({ ...f, bonusParentType: 'series', bonusParentId: show ? show.id : null }));
                    else setForm((f) => ({ ...f, bonusParentType: 'episode', bonusParentId: v }));
                  }}
                />
                <FieldNote policy={pol('bonusParent')} edited={edited('bonusParent')} />
              </View>
            ) : (
              <Text style={ss.small}>This title isn’t in a show. Putting it into one isn’t built yet — <LinkText onPress={() => askUs(`Put “${title}” into a show`)}>ask us</LinkText>.</Text>
            )}
          </View>

          {inShow ? (
            <View style={ss.card}>
              <Text style={ss.sheetLabel}>Another show</Text>
              <SmallButton label="Move to another show…" disabled={ep.deletionRequested || Boolean(ep.withdrawnAt)} onPress={() => setMoveOpen(true)} />
              {(data.moveTargets || []).length === 0 ? <Text style={ss.small}>You have no other {contentType === 'podcast' ? 'shows' : 'series'} it could go into.</Text> : null}
              <Text style={ss.small}>Turning it into an extra isn’t built yet — <LinkText onPress={() => askUs(`Make “${title}” an extra`)}>ask us</LinkText>.</Text>
            </View>
          ) : null}

          <View style={ss.card}>
            {ep.deletionRequested ? (
              <Text style={ss.small}>Removal requested{ep.deletionRequestedAt ? ` on ${shortDate(ep.deletionRequestedAt)}` : ''}. {viewer.isUploader ? <LinkText disabled={busy === 'removal'} onPress={() => askRemoval('cancel')}>Cancel removal</LinkText> : null}</Text>
            ) : !removalOpen ? (
              <Text style={ss.small}>Withdrawn and kept for its buyers.</Text>
            ) : !viewer.isUploader ? (
              <FieldNote policy={{ mode: 'locked', line: 'Only the person who uploaded it can ask for it to be removed.' }} />
            ) : removal.open ? (
              <View style={{ gap: 8 }}>
                <FieldHead label="Why remove it?" />
                <EdInput multiline value={removal.reason} maxLength={1000} placeholder="A line for us — the reason is required." onChangeText={(t) => setRemoval((x) => ({ ...x, reason: t }))} accessibilityLabel="Why remove it?" />
                <Text style={ss.small}>{live ? 'It is hidden from the site right away while we look.' : 'We look at it and take it down.'}</Text>
                <View style={ss.wrap}>
                  <SmallButton tone="danger" label={busy === 'removal' ? 'Asking…' : 'Ask to remove it'} busy={busy === 'removal'} disabled={!removal.reason.trim()} onPress={() => askRemoval('request')} />
                  <LinkText onPress={() => setRemoval({ open: false, reason: '' })}>Keep it</LinkText>
                </View>
              </View>
            ) : (
              <View style={{ gap: 6 }}>
                <SmallButton tone="danger" label="Remove this episode…" icon={<TrashIcon size={14} color={colors.danger} />} onPress={() => setRemoval({ open: true, reason: '' })} />
                <Text style={ss.small}>{live ? 'It is hidden from the site right away while we look.' : 'We look at it and take it down.'}</Text>
              </View>
            )}
          </View>
          <View style={{ height: foot.spacer }} />
        </View>
      </AccountFrame>
      {moveOpen ? (
        <MoveSheet
          show={{ id: theShowId, name: show ? show.name : '', kind: show ? show.kind : contentType, seasons: data.seasons || [] }}
          episode={{ id: ep.id, kind: 'episode', title: ep.title, displayTitle: title, season: ep.season, seriesOrder: ep.seriesOrder, code: ep.code, status: ep.status }}
          myShows={data.moveTargets || []}
          onClose={() => setMoveOpen(false)}
          onMoved={async (result) => {
            const away = result.toShowId && result.toShowId !== theShowId;
            say({ tone: 'ok', title: result.unchanged ? 'Nothing moved' : 'Moved', lines: [result.words, ...(result.lines || [])].filter(Boolean), undo: away || result.unchanged ? null : undoFor(result.rows) }, 8000);
            if (away) {
              leave(() => router.replace(episodeEditorRoute(result.toShowId, ep.id)));
              return;
            }
            setBusy('place');
            await reload({ place: true });
            setBusy(null);
          }}
        />
      ) : null}
    </>
  );
}

const es = StyleSheet.create({
  body: { gap: 14 },
  skeleton: { height: 160, borderRadius: 12, backgroundColor: colors.surface1 },
  bannerItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fileThumb: { width: 96, height: 54, borderRadius: 6, backgroundColor: colors.surface0, overflow: 'hidden' },
  fileState: { fontFamily: fonts.displaySemi, fontSize: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: inkTint(0.08) },
  footMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 }
});
