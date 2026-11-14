import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useUpload } from '../../contexts/UploadContext';
import { readVideoMetadata } from '../../lib/videoMetadata';
import { shrinkArtwork } from '../../lib/shrinkImage';
import { bytesLabel, runtimeClock } from '../../lib/creatorRights';
import { formatAdBreaksForInput, parseAdBreaksInput } from '../../lib/adBreaks';
import { joinDescription, planMove, saveSummary, splitDescription } from '../../lib/showRules';
import { SITE } from '../../lib/siteConfig';
import MoveSheet from './MoveSheet';
import DraftEditor from './DraftEditor';
import { fileDrop, pickerKeys } from './roomBits';
import CreditsFields, { creditsFormBody, creditsFormKey, creditsToForm } from './CreditsFields';
import {
  ArtSlot, Banner, EditorFrame, FieldHead, FieldNote, PickButton, StagedBox, SwitchRow, Toast,
  callApi, isOpen, masterWords, readAsDataUrl, shortDate, uploadPct, uploadRunning, useBeforeUnload, useDirtyReport, useHeaderOffset, useToast
} from './EditorBits';
import { AboutField, MoreOptions, NOT_SAVED_WORDS, OneLineField, PlaceBlock, SameAsShow, StagedLegend, TitleField, askHref } from './EpisodeFields';
import { BackArrowIcon, CheckIcon, ClockIcon, CloseIcon, ExternalLinkIcon, PlusIcon, TrashIcon, WarningIcon } from '../PlayerIcons';
import { PREVIEW_BUILT } from './ShowCards';
import PayeeCard, { PayeeLine } from './PayeeCard';
import ExtraKindField from '../ExtraKindField';
import FlashingLightsField from '../FlashingLightsField';
import DownloadsAllowedField from '../DownloadsAllowedField';
import { downloadableKind } from '../../lib/downloadRules';
import { extraKindChoice, extraKindFromChoice, extraKindLabel } from '../../lib/extraKinds';

// The episode editor (series revamp slice 2; spec Screens, "Episode
// editor"; boards EditorBasics, EditorMoreInfo, EditorPlace, ShowLaptop).
// One component for every episode of a show (and a standalone title or an
// extra opened the same way), in two layouts:
//   layout 'page'   a phone-first screen (/creator/show/[id]/episode/[eid]):
//                   the Back pill to the show, tabs Basics · More info ·
//                   Place, a footer that sticks to the bottom;
//   layout 'panel'  the control room's 420px right-hand panel on a laptop:
//                   a close button, the three tabs stacked as sections,
//                   the footer pinned to the panel's bottom.
// Everything is read from GET /api/show/episode/[id] and saved with PATCH
// (policy-driven: a field applies at once, waits for approval, or is the
// team's — the payload's `policy` says which, and its line is drawn under
// the field). A new file goes through POST …/video, a waiting change is
// taken back with DELETE …/staged, captions stay on /api/creator/add-
// captions, a removal is POST …/removal, a move POST /api/show/[id]/move.
// A draft (a creator_drafts row: an episode not sent yet) opens in
// DraftEditor, the same screen over /api/creator/drafts.
//
// Who gets paid (slice 3b): the "Runs it · Paid to" line under the title
// and the Who gets paid card at the end of More info (components/show/
// PayeeCard.js), for those who may see who is paid; /…/episode/<id>
// #who-gets-paid (Your work's row menu) opens More info at that card.
//
// Props: { showId, episodeId, mode: 'creator' | 'admin', layout,
// isDraft (skip the episode read: the control room knows), onClose(),
// onSaved(episode, info) } — info: { applied, staged } after a save,
// { movedTo } after a move to another show, { sentFromDraft } when a
// draft went for review (the episode is the new one).

const DESC_MAX = 4000;
const NOTES_MAX = 4000;
const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm';
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const TITLE_IMAGE_ACCEPT = 'image/png,image/webp';
const CAPTIONS_ACCEPT = '.srt,.vtt,text/vtt';
const POLL_MS = 15000;
const POLL_MAX = 40;

const PILL_TONE = {
  Live: 'ok',
  'In review': 'review',
  'Not this time': 'warn',
  Pulled: 'danger',
  'Pending deletion': 'neutral',
  Withdrawn: 'neutral',
  'Approved · not public yet': 'review',
  Draft: 'neutral'
};

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
    adBreaksText: formatAdBreaksForInput(ep.adBreakSeconds),
    channelOptIn: Boolean(ep.channelOptIn),
    featured: Boolean(ep.featured),
    isOriginal: Boolean(ep.isOriginal),
    hasFlashingLights: Boolean(ep.hasFlashingLights),
    // "Allow downloads in the app" (migration 123): on unless switched off.
    downloadsAllowed: ep.downloadsAllowed !== false,
    hasPage: Boolean(ep.hasPage),
    pageNotes: ep.pageNotes || '',
    credits: creditsToForm(ep.credits, { inherit: hasShow }),
    season: Number(ep.season) || 1,
    number: ep.seriesOrder ? String(ep.seriesOrder) : '',
    bonusParentType: ep.bonus ? ep.bonus.parentType || null : null,
    bonusParentId: ep.bonus ? ep.bonus.parentId || null : null,
    // What kind of extra (migration 121): which chip is on, and the words
    // in "Your category" when it is Other.
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

const replaceKey = (id) => `showEd.replace.${id}`;
function readReplace(id) {
  try {
    return JSON.parse(window.localStorage.getItem(replaceKey(id)) || 'null');
  } catch {
    return null;
  }
}
function writeReplace(id, value) {
  try {
    if (value) window.localStorage.setItem(replaceKey(id), JSON.stringify(value));
    else window.localStorage.removeItem(replaceKey(id));
  } catch {
    // a private window: the resume just isn't remembered
  }
}

export default function EpisodeEditor(props) {
  const { showId, episodeId, isDraft = false, layout = 'page', onClose, mode = 'creator' } = props;
  const [state, setState] = useState({ phase: 'loading' });

  const load = useCallback(async () => {
    if (!isDraft) {
      const r = await callApi('GET', `/api/show/episode/${encodeURIComponent(episodeId)}`);
      if (r.ok) return setState({ phase: 'episode', data: r.data });
      if (r.status !== 404) return setState({ phase: 'error', error: r.error, status: r.status });
    }
    const d = await callApi('GET', `/api/creator/drafts?id=${encodeURIComponent(episodeId)}`);
    if (d.ok && d.data.draft) return setState({ phase: 'draft', draft: d.data.draft });
    if (d.status === 503) return setState({ phase: 'error', status: 503, error: d.error });
    return setState({ phase: 'error', status: 404, error: isDraft ? 'That draft isn’t there any more — it may have been sent or discarded.' : 'That episode isn’t there.' });
  }, [episodeId, isDraft]);

  useEffect(() => {
    setState({ phase: 'loading' });
    load();
  }, [load]);

  if (state.phase === 'episode') return <EpisodeMode key={`e-${episodeId}`} {...props} initial={state.data} />;
  if (state.phase === 'draft') return <DraftEditor key={`d-${episodeId}`} {...props} initialDraft={state.draft} />;
  const panel = layout === 'panel';
  return (
    <div className={`show-ed ${panel ? 'is-panel' : 'is-page'} is-waiting`} aria-busy={state.phase === 'loading' ? 'true' : undefined}>
      {!panel && showId && (
        <Link href={mode === 'admin' ? `/admin/shows/${encodeURIComponent(showId)}` : `/creator/show/${encodeURIComponent(showId)}`} className="acct-back show-ed-back"><BackArrowIcon size={14} /> The show</Link>
      )}
      {panel && onClose && <button type="button" className="show-ed-close is-floating" aria-label="Close the editor" onClick={onClose}><CloseIcon size={16} /></button>}
      {state.phase === 'loading' ? (
        <div className="show-ed-skeleton" aria-label="Loading the episode"><span /><span /><span /></div>
      ) : (
        <div className="show-ed-card show-ed-missing" role="alert">
          <strong>{state.status === 404 ? 'Not here' : 'Couldn’t open it'}</strong>
          <p>{state.error}</p>
          {state.status !== 404 && <button type="button" className="apl-btn-secondary" onClick={() => { setState({ phase: 'loading' }); load(); }}>Try again</button>}
        </div>
      )}
    </div>
  );
}

function EpisodeMode({ showId, episodeId, mode = 'creator', layout = 'page', onClose, onSaved, onDirtyChange, initial }) {
  const router = useRouter();
  const rootRef = useRef(null);
  useHeaderOffset(rootRef);
  const { activeUpload, startVideoUpload, setQueueHost } = useUpload();
  const [data, setData] = useState(initial);
  const ep = data.episode;
  const show = data.show;
  const viewer = data.viewer || {};
  const policy = data.policy || {};
  const pol = useCallback((f) => policy[f] || { mode: 'locked', line: 'This can’t be changed here' }, [policy]);
  const has118 = !data.migration || data.migration.shows118 !== false;
  const inShow = Boolean(show) && (ep.contentType === 'series' || ep.contentType === 'podcast');
  const isExtra = ep.contentType === 'bonus';
  const contentType = ep.contentType === 'podcast' ? 'podcast' : 'series';
  const theShowId = show ? show.id : showId;
  const live = ep.status === 'approved';

  const [form, setForm] = useState(() => episodeForm(initial.episode, Boolean(initial.show)));
  const [init, setInit] = useState(() => episodeForm(initial.episode, Boolean(initial.show)));
  const [resets, setResets] = useState(() => new Set());
  const [files, setFiles] = useState({ poster: null, thumbnail: null, titleImage: null });
  const [cut, setCut] = useState({ poster: false, thumbnail: false });
  const [removeTitle, setRemoveTitle] = useState(false);
  const [trailerUp, setTrailerUp] = useState(null);
  const [replace, setReplace] = useState(null);
  const [fileMsg, setFileMsg] = useState(null);
  const [tab, setTab] = useState('basics');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [removal, setRemoval] = useState({ open: false, reason: '' });
  const [caps, setCaps] = useState({ file: null, language: 'en', label: 'English' });
  const [seasonPos, setSeasonPos] = useState({});
  const [anchorEpisodes, setAnchorEpisodes] = useState(null);
  const [toast, showToast] = useToast();

  // #who-gets-paid: More info, scrolled to the Who gets paid card.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#who-gets-paid') return undefined;
    setTab('more');
    const t = setTimeout(() => {
      const el = document.getElementById('ep-payee');
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const btn = el.querySelector('button:not([disabled])');
      if (btn) btn.focus({ preventScroll: true });
    }, 150);
    return () => clearTimeout(t);
  }, []);

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
      setFiles({ poster: null, thumbnail: null, titleImage: null });
      setCut({ poster: false, thumbnail: false });
      setRemoveTitle(false);
      setTrailerUp(null);
      setSeasonPos({});
    } else if (place) {
      const f = episodeForm(view.episode, Boolean(view.show));
      setInit((i) => ({ ...i, season: f.season, number: f.number, bonusParentType: f.bonusParentType, bonusParentId: f.bonusParentId }));
      setForm((x) => ({ ...x, season: f.season, number: f.number, bonusParentType: f.bonusParentType, bonusParentId: f.bonusParentId }));
      setSeasonPos({});
    }
  }, []);

  const reload = useCallback(async (opts = {}) => {
    const r = await callApi('GET', `/api/show/episode/${encodeURIComponent(ep.id)}`);
    if (r.ok) applyView(r.data, opts);
    return r;
  }, [ep.id, applyView]);

  // Who gets paid changed: its words, then the editor (and the room) again.
  const onPayeeChanged = useCallback(async (next, words) => {
    if (next) setData((d) => ({ ...d, payee: next }));
    if (words) showToast({ title: words });
    await reload({});
    if (onSaved) onSaved(ep, { payee: true });
  }, [reload, showToast, onSaved, ep]);

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
    if (form.hasFlashingLights !== init.hasFlashingLights) add('hasFlashingLights', 'hasFlashingLights', form.hasFlashingLights);
    if (form.downloadsAllowed !== init.downloadsAllowed) add('downloadsAllowed', 'downloadsAllowed', form.downloadsAllowed);
    const breaks = parseAdBreaksInput(form.adBreaksText);
    if (JSON.stringify(breaks) !== JSON.stringify(parseAdBreaksInput(init.adBreaksText))) add('adBreakSeconds', 'adBreakSeconds', breaks);
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
    if (files.poster || cut.poster) changes.push({ field: 'poster', mode: pol('poster').mode });
    if (files.thumbnail || cut.thumbnail) changes.push({ field: 'thumbnail', mode: pol('thumbnail').mode });
    if (files.titleImage) changes.push({ field: 'titleImage', mode: pol('titleImage').mode });
    if (removeTitle) changes.push({ field: 'titleImageRemoval', mode: pol('titleImage').mode });
    if (trailerUp && trailerUp.state === 'uploaded') {
      body.trailerUid = trailerUp.uid;
      changes.push({ field: 'trailer', mode: pol('trailer').mode });
    }
    return { body, changes };
  }, [form, init, resets, files, cut, removeTitle, trailerUp, pol, creditOpts, inShow, isExtra]);
  const summary = saveSummary(computed.changes);
  const dirty = computed.changes.length > 0 || Boolean(trailerUp && trailerUp.state === 'uploading');
  useBeforeUnload(dirty);
  useDirtyReport(dirty, onDirtyChange);
  const edited = (field) => computed.changes.some((c) => c.field === field);

  // --- the place: season, number, what a taken number offers ----------------
  const curSeason = Number(form.season) || 1;
  const basePos = data.positions && Number(data.positions.season) === curSeason ? data.positions : null;
  const pos = basePos || (seasonPos[curSeason] && seasonPos[curSeason].data) || null;
  const posLoading = Boolean(inShow && !pos && seasonPos[curSeason] && seasonPos[curSeason].state === 'loading');
  useEffect(() => {
    if (!inShow || basePos || seasonPos[curSeason]) return;
    setSeasonPos((p) => ({ ...p, [curSeason]: { state: 'loading' } }));
    callApi('GET', `/api/show/${encodeURIComponent(theShowId)}/positions?season=${curSeason}&exclude=${encodeURIComponent(ep.id)}`).then((r) => {
      setSeasonPos((p) => ({ ...p, [curSeason]: r.ok ? { state: 'ready', data: r.data } : { state: 'error', error: r.error } }));
      if (r.ok) setForm((f) => (Number(f.season) === curSeason && !String(f.number).trim() ? { ...f, number: String(r.data.nextFree || 1) } : f));
    });
  }, [inShow, basePos, seasonPos, curSeason, theShowId, ep.id]);

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

  async function placeVia(how) {
    setBusy('place');
    setError(null);
    const r = await callApi('POST', `/api/show/${encodeURIComponent(theShowId)}/move`, { episodeId: ep.id, toSeason: curSeason, toNumber: numberN, mode: how });
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    // The place fields stay closed until the new numbers are read back, so
    // nothing typed meanwhile is overwritten.
    const fresh = await reload({ place: true });
    setBusy(null);
    showToast({ title: r.data.unchanged ? 'Nothing moved' : 'Moved', lines: [r.data.words, ...(r.data.lines || [])].filter(Boolean) });
    if (onSaved) onSaved(fresh.ok ? fresh.data.episode : ep, { moved: true, words: r.data.words });
  }

  // An extra's anchor: the show's episodes to hang it after.
  useEffect(() => {
    if (!isExtra || !show || anchorEpisodes) return;
    callApi('GET', `/api/show/${encodeURIComponent(show.id)}`).then((r) => {
      if (!r.ok) {
        setAnchorEpisodes([]);
        return;
      }
      const list = [];
      for (const s of r.data.seasons || []) for (const row of s.rows || []) if (row.kind === 'episode') list.push({ id: row.id, code: row.code, title: row.displayTitle || row.title });
      setAnchorEpisodes(list);
    });
  }, [isExtra, show, anchorEpisodes]);

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
      const r = await callApi('GET', `/api/show/episode/${encodeURIComponent(ep.id)}`);
      if (r.ok) setData(r.data);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [watching, ep.id]);

  const busyUpload = uploadRunning(activeUpload);
  const replaceUploading = Boolean(replace && activeUpload && activeUpload.uid === replace.uid && busyUpload);
  const trailerUploading = Boolean(trailerUp && activeUpload && activeUpload.uid === trailerUp.uid && busyUpload);
  const uploadEndpoint = `/api/creator/get-upload-url${inShow || isExtra ? `?seriesId=${encodeURIComponent(theShowId)}` : ''}`;
  // The screen draws its own uploads (the file card, the trailer slot), so
  // the corner widget stays off them — and off this footer's Save — as on
  // the show page: they ride with the show (`queue`), whose page this is.
  const ownUpload = { showId: theShowId, showName: show ? show.name : null };
  useEffect(() => {
    if (layout === 'panel' || !setQueueHost) return undefined;
    setQueueHost(theShowId);
    return () => setQueueHost(null);
  }, [layout, theShowId, setQueueHost]);

  async function sendReplacement(uid) {
    setReplace((x) => (x && x.uid === uid ? { ...x, state: 'sending', error: null } : x));
    const r = await callApi('POST', `/api/show/episode/${encodeURIComponent(ep.id)}/video`, { videoUid: uid });
    if (!r.ok) {
      setReplace((x) => (x && x.uid === uid ? { ...x, state: 'failed', error: r.error } : x));
      return;
    }
    writeReplace(ep.id, null);
    setReplace(null);
    setFileMsg(r.data.message || 'The new file is in.');
    await reload({});
  }

  async function pickReplacement(file) {
    if (!file) return;
    setFileMsg(null);
    if (busyUpload) {
      setReplace({ state: 'blocked', name: file.name, error: 'Another upload is running — let it finish first.' });
      return;
    }
    const saved = readReplace(ep.id);
    const resumeUrl = saved && saved.uploadUrl && saved.name === file.name && saved.bytes === file.size ? saved.uploadUrl : null;
    let meta = {};
    try {
      meta = await readVideoMetadata(file);
    } catch {
      meta = {};
    }
    let uidNow = null;
    try {
      const started = await startVideoUpload(file, {
        urlEndpoint: uploadEndpoint,
        resumeUrl,
        kind: 'main',
        queue: ownUpload,
        onUrl: (url) => writeReplace(ep.id, { uid: uidNow, uploadUrl: url, name: file.name, bytes: file.size })
      });
      uidNow = started.uid;
      writeReplace(ep.id, { uid: started.uid, uploadUrl: resumeUrl || null, name: file.name, bytes: file.size });
      setReplace({ uid: started.uid, name: file.name, bytes: file.size, runtimeSeconds: meta && meta.duration ? Math.round(meta.duration) : null, state: 'uploading' });
      started.done
        .then(() => sendReplacement(started.uid))
        .catch(() => setReplace((x) => (x && x.uid === started.uid ? { ...x, state: 'stopped' } : x)));
    } catch (err) {
      setReplace({ state: 'failed', name: file.name, error: (err && err.message) || 'Could not start the upload.' });
    }
  }

  async function pickTrailer(file) {
    if (!file) return;
    if (busyUpload) {
      setError('Another upload is running — drop the trailer once it has finished.');
      return;
    }
    try {
      const started = await startVideoUpload(file, { urlEndpoint: uploadEndpoint, kind: 'trailer', queue: ownUpload });
      setTrailerUp({ uid: started.uid, name: file.name, state: 'uploading' });
      started.done
        .then(() => setTrailerUp((t) => (t && t.uid === started.uid ? { ...t, state: 'uploaded' } : t)))
        .catch(() => setTrailerUp((t) => (t && t.uid === started.uid ? { ...t, state: 'stopped' } : t)));
    } catch (err) {
      setError((err && err.message) || 'Could not start the trailer upload.');
    }
  }

  // --- actions that apply on their own (not part of Save) ------------------
  async function cancelStaged(field) {
    setBusy(`cancel-${field}`);
    setError(null);
    const r = await callApi('DELETE', `/api/show/episode/${encodeURIComponent(ep.id)}/staged?field=${encodeURIComponent(field)}`);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    showToast({ title: 'Taken back', lines: ['What was live stays live.'] });
    await reload({});
  }

  async function uploadCaptions() {
    if (!caps.file) return;
    setBusy('captions');
    setError(null);
    let base64 = null;
    try {
      base64 = await readAsDataUrl(caps.file);
    } catch (err) {
      setBusy(null);
      setError(err.message);
      return;
    }
    const r = await callApi('POST', '/api/creator/add-captions', { episodeId: ep.id, captionsBase64: base64, captionsFileName: caps.file.name, language: caps.language || 'en', label: caps.label || 'English' });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCaps({ file: null, language: caps.language, label: caps.label });
    showToast({ title: 'Captions saved', lines: [r.data.converted ? 'Converted from SRT.' : null, r.data.cueCount ? `${r.data.cueCount} lines.` : null].filter(Boolean) });
    await reload({});
  }

  async function removeCaptions() {
    if (!window.confirm('Remove the captions from this episode?')) return;
    setBusy('captions');
    const r = await callApi('POST', '/api/creator/add-captions', { episodeId: ep.id, remove: true });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    showToast({ title: 'Captions removed' });
    await reload({});
  }

  async function askRemoval(action) {
    setBusy('removal');
    setError(null);
    const r = await callApi('POST', `/api/show/episode/${encodeURIComponent(ep.id)}/removal`, action === 'cancel' ? { action: 'cancel' } : { action: 'request', reason: removal.reason.trim() });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRemoval({ open: false, reason: '' });
    showToast({ title: action === 'cancel' ? 'Removal cancelled' : 'Removal requested', lines: action === 'cancel' ? [] : [r.data.hiddenNow ? 'It’s hidden from the site while we look.' : 'We look at it and take it down.'] });
    await reload({ resetForm: true });
  }

  // --- Save -----------------------------------------------------------------
  async function save({ resubmit = false } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const body = { ...computed.body };
    try {
      // Shrunk to what the site draws, and kept under the host's body limit
      // together (lib/shrinkImage.js; a camera's poster and still were a 413).
      const art = await shrinkArtwork([
        { key: 'poster', file: files.poster },
        { key: 'thumbnail', file: files.thumbnail },
        { key: 'titleImage', file: files.titleImage, keepAlpha: true }
      ]);
      if (files.poster) {
        body.posterBase64 = art.poster;
        body.posterFileName = files.poster.name;
      }
      if (files.thumbnail) {
        body.thumbnailBase64 = art.thumbnail;
        body.thumbnailFileName = files.thumbnail.name;
      }
      if (files.titleImage) {
        body.titleImageBase64 = art.titleImage;
        body.titleImageFileName = files.titleImage.name;
      }
    } catch (err) {
      setSaving(false);
      setError(err.message);
      return;
    }
    const cutWhich = [cut.poster && !files.poster ? 'poster' : null, cut.thumbnail && !files.thumbnail ? 'thumbnail' : null].filter(Boolean);
    if (cutWhich.length === 2) body.cutFromFilm = true;
    else if (cutWhich.length === 1) body.cutFromFilm = cutWhich[0];
    if (removeTitle) body.removeTitleImage = true;
    if (resubmit) body.resubmit = true;
    const r = await callApi('PATCH', `/api/show/episode/${encodeURIComponent(ep.id)}`, body);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      if (r.status === 409 && r.data && r.data.code === 'taken' && layout !== 'panel') setTab('place');
      return;
    }
    const view = r.data.view;
    applyView(view, { resetForm: true });
    const lines = [];
    if (r.data.message) lines.push(r.data.message);
    for (const n of r.data.notices || []) lines.push(n);
    for (const ns of r.data.notSaved || []) lines.push(`Not saved — ${NOT_SAVED_WORDS[ns.field] || ns.field}: ${ns.reason}`);
    const stagedN = (r.data.staged || []).length;
    showToast({
      tone: (r.data.notSaved || []).length ? 'warn' : 'ok',
      title: r.data.unchanged ? 'Nothing to save' : stagedN ? `Saved — ${stagedN === 1 ? '1 change waits' : `${stagedN} changes wait`} for approval` : resubmit ? 'Sent again for review' : 'Saved',
      lines
    });
    if (onSaved) onSaved(view.episode, { applied: r.data.applied || [], staged: r.data.staged || [] });
  }

  function close() {
    if (dirty && !window.confirm('Leave without saving your changes?')) return;
    if (onClose) onClose();
  }

  // --- the head, the banners --------------------------------------------------
  const title = ep.displayTitle || ep.title || 'Untitled';
  const placeholder = ep.inherited && ep.inherited.title && !ep.title ? ep.inherited.title : ep.seriesOrder ? `Episode ${ep.seriesOrder}` : 'Title';
  const eyebrow = [show ? show.name : isExtra ? extraKindLabel(ep.extraKind) : null, ep.code || (isExtra && ep.bonus && ep.bonus.code ? `After ${ep.bonus.code}` : null)].filter(Boolean).join(' · ');
  const pill = { text: ep.statusLabel || 'Live', tone: PILL_TONE[ep.statusLabel] || 'neutral', since: layout === 'panel' && ep.statusLabel === 'Live' && (ep.releasedAt || ep.reviewedAt) ? `since ${shortDate(ep.releasedAt || ep.reviewedAt)}` : null };
  const viewable = live && !ep.held && !ep.deletionRequested && !ep.withdrawnAt && (!show || show.isPublic);
  const statusLine = ep.withdrawnAt ? 'Withdrawn · kept for its buyers'
    : ep.deletionRequested ? `Removal requested${ep.deletionRequestedAt ? ` on ${shortDate(ep.deletionRequestedAt)}` : ''}`
      : ep.held ? 'Pulled while an admin looks at it'
        : ep.status === 'pending' ? `In review since ${shortDate(ep.createdAt) || 'it was sent'}`
          : ep.status === 'rejected' ? 'Not this time'
            : show && !show.isPublic ? 'Approved · the show isn’t public yet'
              : `Live${ep.releasedAt || ep.reviewedAt ? ` since ${shortDate(ep.releasedAt || ep.reviewedAt)}` : ''}`;
  const stagedFields = [
    ep.staged && ep.staged.title ? { field: 'title', words: `title “${ep.staged.title}”` } : null,
    ep.staged && ep.staged.description ? { field: 'description', words: 'an edited description' } : null,
    // Migration 122: notes waiting ('' = clearing them).
    ep.staged && typeof ep.staged.pageNotes === 'string' ? { field: 'pageNotes', words: ep.staged.pageNotes === '' ? 'clearing the notes' : 'new notes' } : null,
    ep.staged && ep.staged.poster ? { field: 'poster', words: 'the poster' } : null,
    ep.staged && ep.staged.thumbnail ? { field: 'thumbnail', words: 'the still' } : null,
    // Migration 120: a live episode's title image (or its removal) and
    // trailer wait too; Cancel takes back either (titleImage clears both).
    ep.staged && ep.staged.titleImageUrl ? { field: 'titleImage', words: 'a new title image' } : null,
    ep.staged && !ep.staged.titleImageUrl && ep.staged.titleImageRemoval ? { field: 'titleImage', words: 'removing the title image' } : null,
    ep.staged && ep.staged.trailer ? { field: 'trailer', words: 'a new trailer' } : null,
    ep.staged && ep.staged.video ? { field: 'video', words: `a new file (${ep.staged.video.ready ? 'ready' : masterWords(ep.staged.video.state).text.toLowerCase()})` } : null
  ].filter(Boolean);
  const canAct = viewer.isUploader || viewer.team;
  // Taking back a waiting change is the uploader's: the team decides it
  // under Waiting for approval on the admin page, where Deny tells them.
  const canCancel = Boolean(viewer.isUploader);

  const banners = (
    <>
      {stagedFields.length > 0 && (
        <Banner level="review" icon={<ClockIcon size={16} />} title="Changes awaiting review:">
          <ul className="show-ed-banner-list">
            {stagedFields.map((s) => (
              <li key={s.field}>
                <span>{s.words}</span>
                {canCancel && <button type="button" className="show-ed-cancel" disabled={busy === `cancel-${s.field}`} onClick={() => cancelStaged(s.field)}>{busy === `cancel-${s.field}` ? '…' : 'Cancel'}</button>}
              </li>
            ))}
          </ul>
          {!canCancel && mode === 'admin' ? <p className="show-ed-banner-sub">Approve or deny these under Waiting for approval on the show page.</p> : null}
        </Banner>
      )}
      {ep.status === 'rejected' && (
        <Banner
          level="warn"
          icon={<WarningIcon size={16} />}
          title={`Not this time${ep.rejectionReason ? ':' : ''}`}
          action={canAct && !ep.deletionRequested ? <button type="button" className="apl-btn-secondary show-ed-banner-btn" disabled={saving || Boolean(trailerUp && trailerUp.state === 'uploading')} title={trailerUp && trailerUp.state === 'uploading' ? 'The trailer is still uploading — send it once it’s up.' : undefined} onClick={() => save({ resubmit: true })}>{saving ? 'Sending…' : 'Send again for review'}</button> : null}
        >
          {ep.rejectionReason ? <p>{ep.rejectionReason}</p> : null}
          <p className="show-ed-banner-sub">Fix what it needs here, then send it again{computed.changes.length ? ' — your changes go with it' : ''}.</p>
        </Banner>
      )}
      {ep.held && (
        <Banner level="danger" icon={<WarningIcon size={16} />} title={`Pulled${ep.holdReason ? `: ${ep.holdReason}` : ''}`}>
          <p className="show-ed-banner-sub">Captions, the notes and a new file still work; everything else waits. <a href={askHref(`Pulled: ${title}`)}>Email us</a></p>
        </Banner>
      )}
      {ep.deletionRequested && !ep.withdrawnAt && (
        <Banner
          level="neutral"
          title={`Removal requested${ep.deletionRequestedAt ? ` on ${shortDate(ep.deletionRequestedAt)}` : ''}`}
          action={viewer.isUploader ? <button type="button" className="show-ed-cancel" disabled={busy === 'removal'} onClick={() => askRemoval('cancel')}>{busy === 'removal' ? '…' : 'Cancel'}</button> : null}
        >
          {ep.deletionReason ? <p>{ep.deletionReason}</p> : null}
          <p className="show-ed-banner-sub">Nothing can change while it waits.</p>
        </Banner>
      )}
      {ep.withdrawnAt && <Banner level="neutral" title="Withdrawn and kept for its buyers"><p className="show-ed-banner-sub">It stays playable for the people who bought it; nothing else changes.</p></Banner>}
      {!has118 && <Banner level="neutral" title="Its own page, the notes and the credits wait for a database update (migration 118)." />}
    </>
  );

  // --- Basics ----------------------------------------------------------------
  const mw = masterWords(masterState);
  const facts = [ep.runtime || (ep.master && ep.master.durationSeconds ? runtimeClock(ep.master.durationSeconds) : null), mw.note || null].filter(Boolean).join(' · ');
  const videoPolicy = pol('video');
  const replaceLine = live ? 'A new file goes to us first; this one keeps playing until we approve it.' : ep.status === 'pending' ? 'The new file replaces this one; it stays in review.' : ep.status === 'rejected' ? 'It goes back to review with the new file.' : null;
  const fileCard = (
    <div className="show-ed-card show-ed-file">
      <span className="show-ed-card-k">The file</span>
      <div className="show-ed-file-row">
        <div className="show-ed-file-thumb">{ep.art && (ep.art.thumbnail || ep.art.showThumbnail) ? <img src={ep.art.thumbnail || ep.art.showThumbnail} alt="" /> : null}</div>
        <div className="show-ed-file-text">
          <span className={`show-ed-file-state tone-${mw.tone}`}>{mw.tone === 'ok' ? <CheckIcon size={14} /> : null} {mw.text}</span>
          {facts ? <span className="show-ed-file-facts">{facts}</span> : null}
        </div>
        {layout === 'panel' && isOpen(videoPolicy) ? (
          <PickButton label={masterState === 'none' ? '↑ Add file' : '↑ Replace file'} accept={VIDEO_ACCEPT} disabled={busyUpload} onPick={pickReplacement} className="show-ed-mini show-ed-file-pick" />
        ) : null}
      </div>
      {pendingVideo && (
        <StagedBox title="A new file waits for approval" onCancel={canCancel ? () => cancelStaged('video') : null} busy={busy === 'cancel-video'}>
          <span className="show-ed-staged-live">{pendingVideo.ready ? 'Ready — we look at it next.' : `${masterWords(pendingVideo.state).text}.`} The current file keeps playing.</span>
        </StagedBox>
      )}
      {replace && replace.state !== 'blocked' && (
        <div className={`apl-progress ${replace.state === 'failed' ? 'is-error' : ''}`} aria-live="polite">
          <div className="apl-progress-row">
            <span className="apl-progress-name">{replace.name}{replace.bytes ? ` · ${bytesLabel(replace.bytes)}` : ''}</span>
            <span aria-hidden={replaceUploading ? 'true' : undefined}>{replaceUploading ? `${uploadPct(activeUpload)}%` : replace.state === 'sending' ? 'saving…' : replace.state === 'stopped' ? 'stopped' : replace.state === 'failed' ? 'not saved' : ''}</span>
          </div>
          <div className="apl-bar" role={replaceUploading ? 'progressbar' : undefined} aria-valuemin={replaceUploading ? 0 : undefined} aria-valuemax={replaceUploading ? 100 : undefined} aria-valuenow={replaceUploading ? uploadPct(activeUpload) : undefined} aria-label={replaceUploading ? 'Uploading the new file' : undefined}><div className="apl-bar-fill" style={{ width: `${replaceUploading ? uploadPct(activeUpload) : replace.state === 'sending' ? 100 : 0}%` }} /></div>
          <div className="apl-progress-meta">
            {replaceUploading && <span>Keep this tab open until it’s up.</span>}
            {replace.state === 'stopped' && <span>The upload stopped — pick the same file again to resume.</span>}
            {replace.state === 'failed' && <span>{replace.error}</span>}
            {replace.state === 'failed' && replace.uid ? <button type="button" className="apl-link" onClick={() => sendReplacement(replace.uid)}>Try again</button> : null}
          </div>
        </div>
      )}
      {replace && replace.state === 'blocked' && <p className="show-ed-line locked">{replace.error}</p>}
      {fileMsg && <p className="show-ed-hint tone-ok" role="status">{fileMsg}</p>}
      {isOpen(videoPolicy) && layout !== 'panel' ? (
        <label className={`show-ed-drop ${busyUpload ? 'is-off' : ''}`} role="button" aria-disabled={busyUpload ? 'true' : undefined} {...pickerKeys(busyUpload)} {...fileDrop(pickReplacement, busyUpload)}>
          <span className="show-ed-drop-icon" aria-hidden="true">↑</span>
          <span className="show-ed-drop-text">
            <strong>{masterState === 'none' ? 'Add the file' : 'Replace the file'}</strong>
            <span>Drop a new master here, or browse</span>
          </span>
          <input type="file" accept={VIDEO_ACCEPT} hidden disabled={busyUpload} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pickReplacement(f); }} />
        </label>
      ) : null}
      {isOpen(videoPolicy) && replaceLine ? <p className="show-ed-line"><ClockIcon size={12} /> {replaceLine}</p> : <FieldNote policy={videoPolicy} />}
    </div>
  );

  const basics = (
    <>
      {fileCard}
      <TitleField
        id="ep-title"
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
      <OneLineField id="ep-oneline" value={form.oneLine} onChange={(v) => set('oneLine', v)} policy={pol('description')} edited={edited('description')} />
      {isExtra && (
        <div className="show-ed-field">
          <ExtraKindField
            idPrefix="ep-kind"
            choice={form.extraKindChoice}
            other={form.extraKindOther}
            disabled={!isOpen(pol('extraKind'))}
            onChange={(v) => setForm((f) => ({ ...f, extraKindChoice: v.choice, extraKindOther: v.other }))}
          >
            <FieldNote policy={pol('extraKind')} edited={edited('extraKind')} />
          </ExtraKindField>
        </div>
      )}
    </>
  );

  // --- More info ---------------------------------------------------------------
  const art = ep.art || {};
  const posterStaged = ep.staged && ep.staged.poster;
  const stillStaged = ep.staged && ep.staged.thumbnail;
  // A frame can only be cut from a Cloudflare video that is ready.
  const canCut = Boolean(ep.master && ep.master.state === 'ready');
  const artSlot = (field, kind, label) => {
    const p = pol(field);
    const own = art[field] || null;
    const showArt = field === 'poster' ? art.showPoster : art.showThumbnail;
    const picked = files[field];
    const cutting = cut[field] && !picked;
    const status = picked || cutting ? 'new' : (field === 'poster' ? posterStaged : stillStaged) ? 'waiting' : own ? 'live' : null;
    return (
      <ArtSlot
        kind={kind}
        label={label}
        status={status}
        policy={p}
        live={own}
        fallback={own ? null : showArt || null}
        fallbackTag={show ? 'Using the show’s art' : null}
        picked={picked}
        pickedNote={cutting ? 'Cut from the film when you save' : picked ? (p.mode === 'staged' ? 'Goes to review when you save' : 'Saved when you save') : null}
        // A new pick (or a cut) shows itself, not the one waiting.
        staged={picked || cutting ? null : field === 'poster' ? posterStaged : stillStaged}
        stagedNote={`Visitors see the live ${field === 'poster' ? 'poster' : 'still'} until we approve this one.`}
        onCancelStaged={canCancel ? () => cancelStaged(field) : null}
        cancelBusy={busy === `cancel-${field}`}
        emptyTitle="None yet"
        emptyText={show ? null : 'We use a frame of the film until you set one.'}
        caption={own ? 'Its own' : show && showArt ? `From ${show.name} until you set one` : null}
        actions={isOpen(p) ? (
          <>
            <PickButton label={own || picked ? 'Replace' : 'Upload'} accept={IMAGE_ACCEPT} onPick={(f) => { setFiles((x) => ({ ...x, [field]: f })); setCut((c) => ({ ...c, [field]: false })); }} />
            {picked || cutting ? (
              <button type="button" className="show-ed-mini" onClick={() => { setFiles((x) => ({ ...x, [field]: null })); setCut((c) => ({ ...c, [field]: false })); }}>Undo</button>
            ) : canCut ? (
              <button type="button" className="show-ed-mini is-gold" onClick={() => setCut((c) => ({ ...c, [field]: true }))}>Cut from the film</button>
            ) : null}
          </>
        ) : null}
      />
    );
  };

  const capPolicy = pol('captions');
  const captionsOpen = isOpen(capPolicy) && viewer.isUploader;
  const trailerPolicy = pol('trailer');
  const titlePolicy = pol('titleImage');
  // Migration 120: what waits for approval on a live episode.
  const stagedNow = ep.staged || {};
  const titleStaged = stagedNow.titleImageUrl || null;
  const titleRemovalStaged = stagedNow.titleImageRemoval === true;
  const trailerStaged = Boolean(stagedNow.trailer);
  const notesMax = NOTES_MAX;
  const aboutMax = DESC_MAX - (form.oneLine.trim() ? form.oneLine.trim().length + 2 : 0);
  const makerName = ep.creditLines && ep.creditLines.find((l) => l.key === 'maker') ? ep.creditLines.find((l) => l.key === 'maker').name : form.artist || (show && show.ownerName) || null;

  const moreInfo = (
    <>
      {live && <StagedLegend />}
      <AboutField
        id="ep-about"
        value={form.about}
        onChange={(v) => set('about', v)}
        max={aboutMax}
        policy={pol('description')}
        edited={edited('description')}
        stagedValue={ep.staged ? ep.staged.description : null}
        onCancelStaged={canCancel ? () => cancelStaged('description') : null}
        cancelBusy={busy === 'cancel-description'}
      />
      <div className="show-ed-art">
        {artSlot('poster', 'poster', 'Poster 2:3')}
        {artSlot('thumbnail', 'still', 'Still 16:9')}
      </div>
      <ArtSlot
        kind="title"
        label="Title image · PNG"
        status={files.titleImage || removeTitle ? 'new' : titleStaged || titleRemovalStaged ? 'waiting' : art.titleImageUrl ? 'live' : null}
        policy={titlePolicy}
        live={art.titleImageUrl || null}
        picked={files.titleImage}
        removing={removeTitle}
        pickedNote={files.titleImage || removeTitle ? (titlePolicy.mode === 'staged' ? 'Goes to review when you save' : 'Saved when you save') : null}
        // A new pick (or a removal) shows itself, not the one waiting.
        staged={files.titleImage || removeTitle ? null : titleStaged}
        stagedNote="Visitors see the live title image until we approve this one."
        onCancelStaged={canCancel ? () => cancelStaged('titleImage') : null}
        cancelBusy={busy === 'cancel-titleImage'}
        emptyTitle={removeTitle ? 'Removed when you save' : titleRemovalStaged ? 'Removal waits for approval' : 'None'}
        emptyText="The name set as a picture, shown on the art."
        actions={isOpen(titlePolicy) ? (
          <>
            <PickButton label={art.titleImageUrl || titleStaged || files.titleImage ? 'Replace' : 'Upload'} accept={TITLE_IMAGE_ACCEPT} onPick={(f) => { setFiles((x) => ({ ...x, titleImage: f })); setRemoveTitle(false); }} />
            {files.titleImage || removeTitle ? (
              <button type="button" className="show-ed-mini" onClick={() => { setFiles((x) => ({ ...x, titleImage: null })); setRemoveTitle(false); }}>Undo</button>
            ) : art.titleImageUrl && !titleRemovalStaged ? (
              <button type="button" className="show-ed-mini" onClick={() => setRemoveTitle(true)}>Remove</button>
            ) : null}
          </>
        ) : null}
      />
      {titleRemovalStaged && !titleStaged && !files.titleImage && !removeTitle ? (
        <StagedBox title="Removing the title image waits for approval" onCancel={canCancel ? () => cancelStaged('titleImage') : null} busy={busy === 'cancel-titleImage'}>
          <span className="show-ed-staged-live">Visitors see the live title image until we approve it; then the name shows as text.</span>
        </StagedBox>
      ) : null}
      <SameAsShow inShow={Boolean(show)} ctx={{ form, set, defaults, showYear: show ? show.year : null, resets, reset, pol, idPrefix: 'ep', titleForAsk: `${show ? `${show.name} · ` : ''}${title}`, adFree: ep.contentType === 'podcast' }} />
      {/* The uploader's mark (Jose, 2026-11-13): on at once in every state;
          ticked on a live title it is the team's to take off
          (lib/showRules.js flashingLightsPolicy, the server's policy). */}
      <FlashingLightsField
        id="ep-flashing"
        className="show-ed-field"
        checked={form.hasFlashingLights}
        onChange={(v) => set('hasFlashingLights', v)}
        locked={pol('hasFlashingLights').mode === 'locked' ? pol('hasFlashingLights').line || 'This can’t be changed here' : null}
      />
      {/* The creator's switch for downloads in the app (Jose, 2026-11-14;
          lib/downloadSiteRules.js downloadsAllowedPolicy, the server's
          policy): applies at once in every state. A podcast is never
          downloaded, so it has no switch. */}
      {downloadableKind(ep.contentType) && policy.downloadsAllowed ? (
        <DownloadsAllowedField
          id="ep-downloads"
          className="show-ed-field"
          checked={form.downloadsAllowed}
          onChange={(v) => set('downloadsAllowed', v)}
          locked={pol('downloadsAllowed').mode === 'locked' ? pol('downloadsAllowed').line || 'This can’t be changed here' : null}
        />
      ) : null}

      <div className="show-ed-card show-ed-captions">
        <span className="show-ed-card-k">Captions</span>
        {ep.captions && ep.captions.has ? (
          <div className="show-ed-cap-row">
            <div className="show-ed-cap-text"><strong>{ep.captions.label || 'English'}</strong><span>{ep.captions.language || 'en'} · applies at once</span></div>
            {captionsOpen && <button type="button" className="show-ed-mini" disabled={busy === 'captions'} onClick={removeCaptions}>Remove</button>}
          </div>
        ) : (
          <p className="show-ed-hint">None yet. Viewers who turn captions on see nothing until you add them.</p>
        )}
        {ep.captions && ep.captions.stale && <p className="show-ed-line"><WarningIcon size={12} /> The file changed since these were made — check they still line up.</p>}
        {captionsOpen ? (
          <>
            <div className="show-ed-cap-pick">
              <PickButton label={caps.file ? caps.file.name : ep.captions && ep.captions.has ? 'Replace with a file (SRT or VTT)' : 'Add a file (SRT or VTT)'} accept={CAPTIONS_ACCEPT} onPick={(f) => setCaps((c) => ({ ...c, file: f }))} className="show-ed-slot" />
            </div>
            {caps.file && (
              <div className="apl-grid2 show-ed-grid2">
                <div className="show-ed-field"><label className="show-ed-label" htmlFor="ep-cap-lang">Language code</label><input id="ep-cap-lang" className="show-ed-input" type="text" value={caps.language} maxLength={10} onChange={(e) => setCaps((c) => ({ ...c, language: e.target.value }))} /></div>
                <div className="show-ed-field"><label className="show-ed-label" htmlFor="ep-cap-label">Label</label><input id="ep-cap-label" className="show-ed-input" type="text" value={caps.label} maxLength={40} onChange={(e) => setCaps((c) => ({ ...c, label: e.target.value }))} /></div>
              </div>
            )}
            {caps.file && <button type="button" className="apl-btn-secondary" disabled={busy === 'captions'} onClick={uploadCaptions}>{busy === 'captions' ? 'Saving…' : 'Save the captions'}</button>}
          </>
        ) : (
          <p className="show-ed-line locked">{!viewer.isUploader ? 'Only the person who uploaded it can change the captions' : capPolicy.line}</p>
        )}
      </div>

      <div className="show-ed-card show-ed-trailer">
        <div className="show-ed-art-head">
          <span className="show-ed-label">{trailerPolicy.mode === 'staged' && <ClockIcon size={12} />}<span>Trailer</span></span>
          {trailerUp ? <span className="show-ed-pill tone-review">{trailerUp.state === 'uploaded' ? (trailerPolicy.mode === 'staged' ? 'Goes to review' : 'Not saved yet') : trailerUp.state === 'stopped' ? 'Stopped' : 'Uploading'}</span> : trailerStaged ? <span className="show-ed-pill tone-review">Waiting for approval</span> : ep.trailer ? <span className="show-ed-pill tone-ok">Live</span> : <span className="show-ed-pill tone-neutral">None</span>}
        </div>
        {trailerUp ? (
          <div className="apl-progress" aria-live="polite">
            <div className="apl-progress-row"><span className="apl-progress-name">{trailerUp.name}</span><span aria-hidden={trailerUploading ? 'true' : undefined}>{trailerUploading ? `${uploadPct(activeUpload)}%` : trailerUp.state === 'uploaded' ? 'uploaded ✓' : trailerUp.state}</span></div>
            <div className="apl-bar" role={trailerUploading ? 'progressbar' : undefined} aria-valuemin={trailerUploading ? 0 : undefined} aria-valuemax={trailerUploading ? 100 : undefined} aria-valuenow={trailerUploading ? uploadPct(activeUpload) : undefined} aria-label={trailerUploading ? 'Uploading the trailer' : undefined}><div className="apl-bar-fill" style={{ width: `${trailerUploading ? uploadPct(activeUpload) : trailerUp.state === 'uploaded' ? 100 : 0}%` }} /></div>
            <div className="apl-progress-meta">
              <span>{trailerUp.state === 'uploaded' ? 'It’s attached when you save.' : trailerUp.state === 'stopped' ? 'The upload stopped — drop it again.' : 'Keep this tab open until it’s up.'}</span>
              <button type="button" className="apl-link" onClick={() => setTrailerUp(null)}>Not this one</button>
            </div>
          </div>
        ) : trailerStaged ? (
          <StagedBox title="A new trailer waits for approval" onCancel={canCancel ? () => cancelStaged('trailer') : null} busy={busy === 'cancel-trailer'}>
            <span className="show-ed-staged-live">{ep.trailer ? 'The current one keeps playing until then.' : 'No trailer plays until then.'}</span>
          </StagedBox>
        ) : (
          <p className="show-ed-hint">{ep.trailer ? 'A trailer is attached; it plays on its own page and in the show’s hero.' : 'A short clip, 15–30 seconds. Optional.'}</p>
        )}
        {isOpen(trailerPolicy) && !trailerUp ? <PickButton label={ep.trailer || trailerStaged ? 'Replace the trailer' : 'Add a trailer'} accept={VIDEO_ACCEPT} disabled={busyUpload} onPick={pickTrailer} className="show-ed-slot" /> : null}
        {isOpen(trailerPolicy) && trailerPolicy.mode === 'staged' && !trailerUp ? <p className="show-ed-line"><ClockIcon size={12} /> A new trailer on a live episode goes to us first; the current one keeps playing until we approve it.</p> : <FieldNote policy={trailerPolicy} />}
      </div>

      <div className="show-ed-field">
        <FieldHead htmlFor="ep-funding" label="Funding link" hint=" optional" locked={pol('fundingUrl').mode === 'locked'} />
        <input id="ep-funding" className="show-ed-input" type="url" inputMode="url" value={form.fundingUrl} placeholder="https://" maxLength={500} disabled={!isOpen(pol('fundingUrl'))} onChange={(e) => set('fundingUrl', e.target.value)} />
        <FieldNote policy={pol('fundingUrl')} edited={edited('fundingUrl')} />
      </div>

      <div className="show-ed-card show-ed-own-page">
        <SwitchRow id="ep-has-page" title="Give this episode its own page" on={form.hasPage} onChange={(v) => set('hasPage', v)} disabled={!has118 || !isOpen(pol('hasPage'))} policy={pol('hasPage').mode === 'locked' ? pol('hasPage') : null}>
          People can open a page with notes, credits and the trailer; otherwise it plays straight from the show.
        </SwitchRow>
        {form.hasPage && (
          <div className="show-ed-field">
            <FieldHead htmlFor="ep-notes" label="Notes" hint=" blank lines make paragraphs" staged={pol('pageNotes').mode === 'staged'} locked={pol('pageNotes').mode === 'locked'} count={form.pageNotes.length} max={notesMax} />
            <textarea id="ep-notes" className="show-ed-textarea" rows={6} value={form.pageNotes} maxLength={notesMax} disabled={!has118 || !isOpen(pol('pageNotes'))} placeholder="How it was made, who’s in it, the story behind a scene." onChange={(e) => set('pageNotes', e.target.value)} />
            {/* On a live title the notes wait for approval like the
                description (migration 122); what waits, with Cancel. */}
            {ep.staged && typeof ep.staged.pageNotes === 'string' ? (
              <StagedBox title={ep.staged.pageNotes === '' ? 'Clearing the notes waits for approval' : 'New notes wait for approval:'} onCancel={canCancel ? () => cancelStaged('pageNotes') : null} busy={busy === 'cancel-pageNotes'}>
                {ep.staged.pageNotes ? <span className="show-ed-staged-live show-ed-staged-text-long">{ep.staged.pageNotes.length > 240 ? `${ep.staged.pageNotes.slice(0, 240)}…` : ep.staged.pageNotes}</span> : <span className="show-ed-staged-live">Visitors see the live notes until we approve it.</span>}
              </StagedBox>
            ) : null}
            <FieldNote policy={pol('pageNotes')} edited={edited('pageNotes')} />
            {/* "Open page" once it's live; before that its preview (slice 4) —
                an episode in review, approved in a private show, or pulled;
                never a declined or withdrawn one (nothing to preview). */}
            {(viewable || (PREVIEW_BUILT && ep.status !== 'rejected' && !ep.withdrawnAt)) && <a className="show-ed-mini is-link" href={`/episode/${encodeURIComponent(ep.id)}${viewable ? '' : '?preview=1'}`} target="_blank" rel="noreferrer"><ExternalLinkIcon size={12} /> {viewable ? 'Open page' : 'Preview page'}</a>}
          </div>
        )}
        {!has118 && <p className="show-ed-line locked">Needs a database update (migration 118).</p>}
      </div>

      <div className="show-ed-card">
        <span className="show-ed-card-k">Credits</span>
        <CreditsFields idPrefix="ep-credits" value={form.credits} onChange={(v) => set('credits', v)} inherit={Boolean(show)} showCredits={null} makerName={makerName} makerLabel={contentType === 'podcast' ? 'Hosted by' : 'Made by'} policy={has118 ? pol('credits') : { mode: 'locked', line: 'Needs a database update (migration 118).' }} />
      </div>

      {!isExtra && show && (
        <div className="show-ed-card show-ed-extras">
          <span className="show-ed-card-k">Extras with this episode</span>
          {(data.extras || []).length ? (
            <ul className="show-ed-extra-list">
              {data.extras.map((x) => <li key={x.id}><span>{x.title || 'Untitled extra'}</span><small>{x.status === 'approved' ? 'Live' : x.status === 'pending' ? 'In review' : x.status === 'rejected' ? 'Not this time' : x.status}</small></li>)}
            </ul>
          ) : <p className="show-ed-hint">None</p>}
          {mode !== 'admin' && <Link href={`/creator/submit?type=bonus&series=${encodeURIComponent(show.id)}`} className="show-ed-mini is-gold is-link"><PlusIcon size={12} /> Add extra</Link>}
        </div>
      )}

      <MoreOptions idPrefix="ep" form={form} set={set} pol={pol} live={live} adFree={ep.contentType === 'podcast'} />

      {data.payee ? <PayeeCard payee={data.payee} mode="section" onChanged={onPayeeChanged} titleWord={`“${title}”`} /> : null}
    </>
  );

  // --- Place ---------------------------------------------------------------------
  const removalOpen = !ep.deletionRequested && !ep.withdrawnAt;
  const placeSection = (
    <>
      {inShow ? (
        <PlaceBlock
          idPrefix="ep-place"
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
        <div className="show-ed-field">
          <FieldHead htmlFor="ep-anchor" label="Attached to" />
          <select
            id="ep-anchor"
            className="show-ed-select"
            disabled={!isOpen(pol('bonusParent')) || !show}
            value={form.bonusParentType === 'episode' ? form.bonusParentId || '' : 'show'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'show') setForm((f) => ({ ...f, bonusParentType: 'series', bonusParentId: show ? show.id : null }));
              else setForm((f) => ({ ...f, bonusParentType: 'episode', bonusParentId: v }));
            }}
          >
            <option value="show">With the show</option>
            {(anchorEpisodes || []).map((x) => <option key={x.id} value={x.id}>After {x.code ? `${x.code} · ` : ''}{x.title}</option>)}
          </select>
          <FieldNote policy={pol('bonusParent')} edited={edited('bonusParent')} />
        </div>
      ) : (
        <p className="show-ed-hint">This title isn’t in a show. Putting it into one isn’t built yet — <a href={askHref(`Put “${title}” into a show`)}>ask us</a>.</p>
      )}

      {inShow && (
        <div className="show-ed-field">
          <span className="show-ed-label">Another show</span>
          <button type="button" className="show-ed-link" onClick={() => setMoveOpen(true)} disabled={ep.deletionRequested || Boolean(ep.withdrawnAt)}>Move to another show…</button>
          {(data.moveTargets || []).length === 0 && <p className="show-ed-hint">You have no other {contentType === 'podcast' ? 'shows' : 'series'} it could go into.</p>}
        </div>
      )}
      {inShow && <p className="show-ed-quiet">Turning it into an extra isn’t built yet — <a href={askHref(`Make “${title}” an extra`)}>ask us</a>.</p>}

      <div className="show-ed-remove">
        {ep.deletionRequested ? (
          <p className="show-ed-hint">Removal requested{ep.deletionRequestedAt ? ` on ${shortDate(ep.deletionRequestedAt)}` : ''}. {viewer.isUploader ? <button type="button" className="show-ed-link" disabled={busy === 'removal'} onClick={() => askRemoval('cancel')}>Cancel removal</button> : null}</p>
        ) : !removalOpen ? null : !viewer.isUploader ? (
          <p className="show-ed-line locked">Only the person who uploaded it can ask for it to be removed.</p>
        ) : removal.open ? (
          <div className="show-ed-card show-ed-removal-card">
            <FieldHead htmlFor="ep-removal" label="Why remove it?" />
            <textarea id="ep-removal" className="show-ed-textarea" rows={3} maxLength={1000} value={removal.reason} onChange={(e) => setRemoval((x) => ({ ...x, reason: e.target.value }))} placeholder="A line for us — the reason is required." />
            <p className="show-ed-hint">{live ? 'It is hidden from the site right away while we look.' : 'We look at it and take it down.'}</p>
            <div className="show-ed-row-acts">
              <button type="button" className="show-ed-danger" disabled={busy === 'removal' || !removal.reason.trim()} onClick={() => askRemoval('request')}>{busy === 'removal' ? 'Asking…' : 'Ask to remove it'}</button>
              <button type="button" className="show-ed-link" onClick={() => setRemoval({ open: false, reason: '' })}>Keep it</button>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="show-ed-danger" onClick={() => setRemoval({ open: true, reason: '' })}><TrashIcon size={14} /> Remove this episode…</button>
            <p className="show-ed-hint">{live ? 'It is hidden from the site right away while we look.' : 'We look at it and take it down.'}</p>
          </>
        )}
      </div>
    </>
  );

  // --- the footer ---------------------------------------------------------------
  const trailerWaiting = Boolean(trailerUp && trailerUp.state === 'uploading');
  const canSave = computed.changes.length > 0 && !saving && !placeBlocked && !trailerWaiting;
  const footer = (
    <>
      {summary.note && <p className="show-ed-foot-note"><ClockIcon size={12} /> {summary.note}</p>}
      {placeBlocked && <p className="show-ed-foot-note is-warn">E{numberN} is taken — pick Swap or Insert here on Place, or another number.</p>}
      {trailerWaiting && <p className="show-ed-foot-note">The trailer is still uploading — save once it’s up.</p>}
      {error && <p className="show-ed-error" role="alert">{error}</p>}
      <div className={`show-ed-foot-actions ${viewable ? 'has-second' : ''}`}>
        <button type="button" className="apl-btn show-ed-primary show-ed-save" disabled={!canSave} onClick={() => save()}>{saving ? 'Saving…' : summary.label}</button>
        <div className="show-ed-foot-meta">
          {viewable ? (
            <a className="apl-btn-secondary show-ed-second show-ed-view" href={`/episode/${encodeURIComponent(ep.id)}`} target="_blank" rel="noreferrer">View page <ExternalLinkIcon size={12} /></a>
          ) : null}
          <p className="show-ed-status"><i className={`tone-${pill.tone}`} aria-hidden="true" /> {statusLine}</p>
        </div>
      </div>
    </>
  );

  const sections = [
    { key: 'basics', label: 'Basics', content: basics },
    { key: 'more', label: 'More info', content: moreInfo },
    { key: 'place', label: 'Place', content: placeSection }
  ];
  const backHref = mode === 'admin' ? `/admin/shows/${encodeURIComponent(theShowId)}` : `/creator/show/${encodeURIComponent(theShowId)}${ep.id ? `#ep-${encodeURIComponent(ep.id)}` : ''}`;

  return (
    <>
      {layout !== 'panel' && <Head><title>{`${title}${show ? ` · ${show.name}` : ''} — Edit — ${SITE.name}`}</title><meta name="robots" content="noindex" /></Head>}
      <EditorFrame
        layout={layout}
        rootRef={rootRef}
        backHref={backHref}
        backLabel={show ? show.name : 'Your work'}
        onBack={() => !dirty || window.confirm('Leave without saving your changes?')}
        onClose={close}
        eyebrow={eyebrow}
        pill={pill}
        title={title}
        titleNote={data.payee && data.payee.line ? <PayeeLine payee={data.payee} className="show-ed-paid" /> : null}
        banners={banners}
        sections={sections}
        active={tab}
        onTab={setTab}
        footer={footer}
        toast={<Toast toast={toast} onClose={() => showToast(null)} />}
        ariaLabel={`Edit ${title}`}
        tabsLabel="Episode editor"
      />
      {moveOpen && (
        <MoveSheet
          show={{ id: theShowId, name: show ? show.name : '', kind: show ? show.kind : contentType, seasons: data.seasons || [] }}
          episode={{ id: ep.id, kind: 'episode', title: ep.title, displayTitle: title, season: ep.season, seriesOrder: ep.seriesOrder, code: ep.code, status: ep.status }}
          myShows={data.moveTargets || []}
          onClose={() => setMoveOpen(false)}
          onMoved={async (result) => {
            showToast({ title: result.unchanged ? 'Nothing moved' : 'Moved', lines: [result.words, ...(result.lines || [])].filter(Boolean) });
            if (result.toShowId && result.toShowId !== theShowId) {
              if (onSaved) onSaved({ ...ep, seriesId: result.toShowId }, { movedTo: result.toShowId });
              if (layout !== 'panel') router.replace(`${mode === 'admin' ? '/admin/shows' : '/creator/show'}/${encodeURIComponent(result.toShowId)}/episode/${encodeURIComponent(ep.id)}`);
              return;
            }
            setBusy('place');
            const fresh = await reload({ place: true });
            setBusy(null);
            if (onSaved) onSaved(fresh.ok ? fresh.data.episode : ep, { moved: true, words: result.words });
          }}
        />
      )}
    </>
  );
}
