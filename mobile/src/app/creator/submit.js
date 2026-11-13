import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiDelete, apiGet, apiPost, freshToken } from '../../lib/api';
import { showCall, showPath } from '../../lib/showApi';
import { startTusUpload } from '../../lib/tusUpload';
import {
  SUBMIT_TYPES, MAIN_GENRES, STEPS, EMPTY_SUBMIT_FORM, typeNeedsShow, typeIsNumbered, showNoun, stepBlocker, toSubmitBody, formatRuntime, bytesLabel,
  SUBMIT_NOTES_MAX, submitHasOwnPage
} from '../../lib/submitRules';
import { MAX_EPISODE_NUMBER, nextFreeExcept, showPickerTag } from '../../lib/showRules';
import { changedFields, mediaChanged } from '../../lib/draftPatch';
import { useAdminRole } from '../../lib/adminRole';
import { useContentRatings } from '../../lib/contentAdvisory';
import { colors, fonts, inkTint, okTint, dangerTint, brassTint, oliveTint } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import {
  cp, pickVideo, pickImageAsDataUrl, useUploadProgress, ProgressCard, factsFor, Field, Input, Chips, Switch, PrimaryButton, GhostButton, SecondaryButton
} from '../../components/CreatorBits';
import { BackArrowIcon } from '../../components/account/AccountBits';
import { WarningIcon } from '../../components/WorkIcons';
import { Chip, ChevronIcon, PlusIcon, Sheet, SmallButton } from '../../components/show/ShowBits';
import ExtraKindField from '../../components/ExtraKindField';
import FlashingLightsField from '../../components/FlashingLightsField';

// Creator Studio's submit, three steps (mirrors pages/creator/submit.js,
// 2026-10-31): the file (uploading from the moment it's picked), about it
// (with "+ New show" inline), artwork with the options folded away. Saved
// as a draft as the creator goes (/api/creator/drafts), reopened at the
// same step from the hub; the stopped upload resumes when the same file
// is picked again. Captions are the website's (no document picker here).
//
// Step 2's Place block (the series revamp, slice 5; the website's
// SubmitPlace board): where a series or podcast episode goes comes first —
// the show (only shows of the type's kind, each with where it stands; one
// that takes nothing new is greyed with the reason), the season as chips,
// the number with "E4 · next free" from GET /api/show/[id]/positions and
// the line when another episode holds it ("E3 is taken by “Pilot” — Use
// E4 | Swap"; Swap moves that episode to the next free number when the
// title is sent, and back if sending fails). Going on is blocked while the
// number is taken. ?series=&season=&number= fill all three in (the show
// screen's "+ Add episode"); a title sent into a show lands on the hub
// with "Open the show page".

const firstParam = (v) => (Array.isArray(v) ? v[0] : v);

function placeNumber(v) {
  const n = Number(v);
  return typeof v === 'string' && Number.isInteger(n) && n > 0 && n <= MAX_EPISODE_NUMBER ? n : null;
}

function initialForm(draft, { type = null, series = null, season = null, number = null } = {}) {
  const base = { ...EMPTY_SUBMIT_FORM, ...(draft ? draft.form : {}) };
  if (!draft && type && SUBMIT_TYPES.some((t) => t.value === type)) base.contentType = type;
  else if (!draft && series) base.contentType = 'series';
  if (!draft && series) base.seriesId = series;
  if (!draft && series && season) base.season = String(season);
  if (!draft && series && number) base.seriesOrder = String(number);
  if (!draft && type === 'bonus') base.cutArtwork = false;
  return base;
}

// The show kinds a type files into; a kind unknown (a database before
// migration 118) is let through and the server decides.
function kindFits(kind, contentType) {
  if (contentType === 'bonus') return kind !== 'vertical';
  if (contentType === 'series') return !kind || kind === 'series';
  if (contentType === 'podcast') return !kind || kind === 'podcast';
  return false;
}

export default function SubmitTitle() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const pDraft = firstParam(params.draft) || null;
  const pType = firstParam(params.type) || null;
  const pSeries = firstParam(params.series) || null;
  const pSeason = placeNumber(firstParam(params.season));
  const pNumber = placeNumber(firstParam(params.number));
  const fromParams = { type: pType, series: pSeries, season: pSeason, number: pNumber };
  const { getToken: clerkGetToken, userId } = useAuth();
  // One getter for the screen's life (Clerk's may change identity).
  const tokenRef = useRef(clerkGetToken);
  tokenRef.current = clerkGetToken;
  const getToken = useCallback((...a) => tokenRef.current(...a), []);
  const role = useAdminRole();
  const isAdmin = Boolean(role && role.isAdmin);
  const upload = useUploadProgress();
  // Null until /api/ratings has answered once this session.
  const ratings = useContentRatings() || [];
  const [loading, setLoading] = useState(Boolean(pDraft));
  const [allSeries, setAllSeries] = useState([]);
  const [form, setForm] = useState(() => initialForm(null, fromParams));
  const [video, setVideo] = useState(null);
  const [trailer, setTrailer] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [step, setStep] = useState(1);
  const [poster, setPoster] = useState(null);
  const [still, setStill] = useState(null);
  // The title set as a picture (2026-11-12): optional, a PNG with a
  // transparent background, drawn in place of the text title on its page
  // (never cut from the film).
  const [titleImage, setTitleImage] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | failed | behind
  const [saveLine, setSaveLine] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // The Place block: the number follows the show and the season until
  // it's typed; a Swap waiting for the send; the season's numbers.
  const [autoNumber, setAutoNumber] = useState(() => !String(initialForm(null, fromParams).seriesOrder || '').trim());
  const [swap, setSwap] = useState(null); // { showId, season, number, holderId, holderTitle }
  const [pos, setPos] = useState({ show: null, data: null, error: null });
  const [posTick, setPosTick] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const saveTimer = useRef(null);
  // A 503 on the drafts route (migration 116 not run): stop asking.
  const draftsBehind = useRef(false);
  const latest = useRef({ form, video, trailer, draftId });
  latest.current = { form, video, trailer, draftId };
  // What the server has from this screen (the draft as opened, then each
  // save), so a save sends only what changed since; and the save in
  // flight, so the next one waits for it.
  const saved = useRef({ form: null, video: null, trailer: null });
  const saving = useRef(Promise.resolve());

  // The creator's shows for the picker (list-series: every show they run,
  // with its kind and art), and the draft when resuming one.
  useEffect(() => {
    let alive = true;
    (async () => {
      showCall('GET', '/api/creator/list-series', undefined, getToken).then((r) => {
        if (!alive || !r.ok) return;
        const rows = (r.data.series || []).map((x) => ({
          id: x.id,
          name: x.name ?? null,
          status: x.status || 'approved',
          kind: x.kind || null,
          held: Boolean(x.held),
          deletionRequested: Boolean(x.deletionRequested),
          art: x.poster || x.thumbnail || null,
          creatorId: x.creatorId || null
        }));
        setAllSeries(rows);
        // Opened from a show without a type: the show's kind says which.
        if (!pDraft && pSeries && !SUBMIT_TYPES.some((t) => t.value === pType)) {
          const row = rows.find((x) => x.id === pSeries);
          if (row && row.kind === 'podcast') setForm((f) => (f.seriesId === pSeries ? { ...f, contentType: 'podcast' } : f));
        }
      });
      if (pDraft) {
        try {
          const d = await apiGet(`/api/creator/drafts?id=${encodeURIComponent(pDraft)}`, await freshToken(getToken));
          if (!alive) return;
          setForm(initialForm(d.draft, {}));
          setVideo(d.draft.video);
          setTrailer(d.draft.trailer);
          setDraftId(d.draft.id);
          saved.current = { form: initialForm(d.draft, {}), video: d.draft.video, trailer: d.draft.trailer };
          setAutoNumber(!String((d.draft.form && d.draft.form.seriesOrder) || '').trim());
          setStep(d.draft.form && d.draft.form.step ? Math.min(3, Math.max(1, Number(d.draft.form.step))) : 1);
        } catch (err) {
          if (alive) setError(err.message);
        } finally {
          if (alive) setLoading(false);
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pDraft]);

  const media = useMemo(() => ({ video, trailer, audioUrl: form.audioUrl || null, audioBytes: form.audioBytes || null }), [video, trailer, form.audioUrl, form.audioBytes]);
  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  // The first save creates the draft; after that only what changed goes
  // (PATCH, lib/draftPatch.js), so the show page's upload queue putting a
  // file on the same draft is never undone by this screen, nor this
  // screen's form by it. One save at a time.
  const saveNow = useCallback(async () => {
    if (draftsBehind.current) return;
    const { form: f, video: v, trailer: t, draftId: id } = latest.current;
    if (!v && !t && !String(f.title || '').trim() && !f.audioUrl) return;
    const last = saved.current;
    let body = null;
    if (id) {
      const formPart = changedFields(last.form, f);
      body = { id };
      if (Object.keys(formPart).length) body.form = formPart;
      if (mediaChanged(last.video, v)) body.video = v || null;
      if (mediaChanged(last.trailer, t)) body.trailer = t || null;
      if (Object.keys(body).length === 1) {
        setSaveState('saved');
        return;
      }
    }
    setSaveState('saving');
    const r = id
      ? await showCall('PATCH', '/api/creator/drafts', body, getToken)
      : await showCall('POST', '/api/creator/drafts', { form: f, video: v, trailer: t }, getToken);
    if (r.ok) {
      saved.current = { form: f, video: v, trailer: t };
      if (!id && r.data.draft) {
        latest.current = { ...latest.current, draftId: r.data.draft.id };
        setDraftId(r.data.draft.id);
      }
      setSaveState('saved');
      setSaveLine(null);
      return;
    }
    // Before migration 116 the drafts route answers 503 with its own line:
    // the server is behind, not the connection.
    if (r.status === 503) {
      draftsBehind.current = true;
      setSaveState('behind');
      setSaveLine(r.error);
      return;
    }
    setSaveState('failed');
    setSaveLine(r.status === 0 ? null : r.error);
  }, [getToken]);
  const saveDraft = useCallback(() => {
    saving.current = saving.current.then(saveNow, saveNow);
    return saving.current;
  }, [saveNow]);

  useEffect(() => {
    if (loading) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveDraft, 1000);
    return () => clearTimeout(saveTimer.current);
  }, [form, video, trailer, loading, saveDraft]);

  useEffect(() => { update('step', step); }, [step]);

  useEffect(() => {
    if (video && video.runtimeSeconds && !String(form.runtime || '').trim()) update('runtime', formatRuntime(video.runtimeSeconds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video && video.runtimeSeconds]);

  // A link import: ask every few seconds until Cloudflare has it.
  const polling = video && video.state === 'processing' && !video.bytes;
  useEffect(() => {
    if (!polling) return undefined;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n > 200) { clearInterval(t); return; }
      try {
        const st = await apiGet(`/api/creator/video-status?uid=${encodeURIComponent(video.uid)}`, await freshToken(getToken));
        if (st.state === 'ready' || st.readyToStream) setVideo((v) => (v ? { ...v, state: 'ready', runtimeSeconds: v.runtimeSeconds || (st.duration ? Math.round(st.duration) : null) } : v));
        else if (st.state === 'error') { setVideo((v) => (v ? { ...v, state: 'error' } : v)); setError(st.errorReasonText || 'Cloudflare could not process that link.'); }
      } catch {
        // next tick
      }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, video && video.uid]);

  // --- the Place block --------------------------------------------------------
  // The viewer's shows as GET /api/show sums them up (kind, where each
  // stands, counts, season names, whether they run it); the team's list is
  // every show. Until it answers, the picker reads list-series.
  const [summaries, setSummaries] = useState(null);
  // Before migration 121 "What kind of extra?" is greyed with the server's line.
  const [kindLocked, setKindLocked] = useState(null);
  useEffect(() => {
    let alive = true;
    showCall('GET', isAdmin ? '/api/show?all=1' : '/api/show?mine=1', undefined, getToken).then((r) => {
      if (!alive || !r.ok) return;
      if (Array.isArray(r.data.shows)) setSummaries(r.data.shows);
      if (r.data.extraKind && r.data.extraKind.ready === false) setKindLocked(r.data.extraKind.line || 'Needs a database update (migration 121).');
    });
    return () => { alive = false; };
  }, [isAdmin, getToken]);

  const pickerShows = useMemo(() => {
    const byId = new Map();
    for (const x of allSeries) byId.set(x.id, { id: x.id, name: x.name, kind: x.kind, art: x.art, series: x, summary: null });
    for (const sh of summaries || []) {
      const cur = byId.get(sh.id) || { id: sh.id, name: sh.name, kind: sh.kind, art: null, series: null, summary: null };
      byId.set(sh.id, { ...cur, name: sh.name || cur.name, kind: sh.kind || cur.kind, art: cur.art || sh.poster || sh.thumbnail || null, summary: sh });
    }
    return [...byId.values()]
      .map((x) => ({ ...x, ...showPickerTag(x.summary || x.series || {}) }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' }));
  }, [allSeries, summaries]);

  const placeType = typeNeedsShow(form.contentType);
  const numbered = typeIsNumbered(form.contentType);
  const newMode = placeType && form.contentType !== 'bonus' && String(form.newSeriesName || '').length > 0;
  const season = Math.max(1, Math.floor(Number(form.season)) || 1);
  const typedNumber = Number(form.seriesOrder) > 0 && Number.isInteger(Number(form.seriesOrder)) ? Number(form.seriesOrder) : null;
  const chosen = placeType && form.seriesId && !newMode ? pickerShows.find((x) => x.id === form.seriesId) || null : null;
  const placeOn = numbered && Boolean(form.seriesId) && !newMode;

  // The season's numbers (GET /api/show/[id]/positions): who holds which,
  // and with a typed number whether another episode keeps it. Asked a
  // moment after the show, season or number stops changing.
  useEffect(() => {
    if (!placeOn) {
      setPos({ show: null, data: null, error: null });
      return undefined;
    }
    let alive = true;
    const showId = String(form.seriesId);
    const t = setTimeout(async () => {
      let q = `season=${season}`;
      if (typedNumber && typedNumber <= MAX_EPISODE_NUMBER) q += `&number=${typedNumber}`;
      if (draftId) q += `&exclude=${encodeURIComponent(draftId)}`;
      const r = await showCall('GET', `${showPath(showId)}/positions?${q}`, undefined, getToken);
      if (!alive) return;
      setPos(r.ok ? { show: showId, data: r.data, error: null } : { show: showId, data: null, error: r.error || 'Could not read the numbers.' });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [placeOn, form.seriesId, season, typedNumber, draftId, posTick, getToken]);

  const posData = placeOn && pos.show === String(form.seriesId) && pos.data && pos.data.season === season ? pos.data : null;
  const nextFree = posData ? nextFreeExcept(posData, draftId) : newMode ? 1 : null;
  const check = posData && posData.check && posData.check.number === typedNumber ? posData.check : null;
  const taken = Boolean(check && check.episodeFree === false);
  const swapOn = Boolean(swap && taken && swap.showId === form.seriesId && swap.season === season && swap.number === typedNumber && check.holder && check.holder.id === swap.holderId);
  // Swapping moves another episode of the show: its owner (or the team) only.
  const canSwap = Boolean(chosen && (chosen.summary ? chosen.summary.canEdit : (isAdmin || (chosen.series && chosen.series.creatorId && chosen.series.creatorId === userId))));

  // The number follows the show and the season until it's typed.
  useEffect(() => {
    if (!autoNumber) return;
    if (placeOn && posData) {
      const n = String(nextFreeExcept(posData, draftId));
      if (String(form.seriesOrder || '') !== n) update('seriesOrder', n);
    } else if (newMode && numbered && !String(form.seriesOrder || '').trim()) {
      update('seriesOrder', '1');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNumber, placeOn, posData, draftId, newMode, numbered]);

  // Why the chosen show takes nothing (a kind it doesn't take, declined,
  // pulled, leaving), or why the number can't be used.
  let showProblem = null;
  if (placeType && form.seriesId && !newMode) {
    if (!chosen) showProblem = summaries ? `That ${showNoun(form.contentType)} isn’t one of yours — pick another.` : null;
    else if (!kindFits(chosen.kind, form.contentType)) showProblem = chosen.kind === 'podcast' ? 'That show is a podcast: a series episode goes into a series.' : chosen.kind === 'vertical' ? 'Vertical series are set up by the studio.' : 'That show is a series: a podcast episode goes into a podcast.';
    else if (!chosen.ok) showProblem = `${(chosen.summary && chosen.summary.pickReason) || 'That show takes nothing new'} — pick another.`;
  }
  const placeBlocker = showProblem ? `Pick another ${form.contentType === 'series' ? 'series' : 'show'} to go on.` : taken && !swapOn ? 'Pick a free number to go on.' : null;

  function pickShow(value) {
    setSwap(null);
    setPickerOpen(false);
    if (value === '__new__') {
      setForm((f) => ({ ...f, seriesId: '', newSeriesName: f.newSeriesName || ' ', season: '1', seriesOrder: '' }));
      setAutoNumber(true);
      return;
    }
    const sh = pickerShows.find((x) => x.id === value);
    const seasons = sh && sh.summary && Array.isArray(sh.summary.seasons) ? sh.summary.seasons.map((x) => Number(x.number)).filter((n) => n > 0) : [];
    // A new episode goes at the end of the show's latest season.
    const last = seasons.length ? Math.max(...seasons) : 1;
    setForm((f) => ({ ...f, seriesId: value, newSeriesName: '', newSeriesDescription: '', season: String(last), seriesOrder: '' }));
    setAutoNumber(true);
  }

  function pickSeason(n) {
    setSwap(null);
    setForm((f) => ({ ...f, season: String(n), seriesOrder: '' }));
    setAutoNumber(true);
  }

  function typeNumber(value) {
    setSwap(null);
    setAutoNumber(false);
    update('seriesOrder', String(value).replace(/[^0-9]/g, '').slice(0, 4));
  }

  function takeNumber(n) {
    setSwap(null);
    setAutoNumber(true);
    update('seriesOrder', String(n));
  }

  // Swap, when the title is sent: the episode holding the number moves to
  // the next free one first (POST /api/show/[id]/move, the show owner's or
  // the team's), with fresh numbers so nothing moves on a stale view. The
  // move to undo it when sending fails, or null when nothing had to move.
  async function runSwap() {
    const showId = String(form.seriesId);
    let q = `season=${season}&number=${typedNumber}`;
    if (draftId) q += `&exclude=${encodeURIComponent(draftId)}`;
    const r = await showCall('GET', `${showPath(showId)}/positions?${q}`, undefined, getToken);
    if (!r.ok) throw new Error(r.error || 'Could not read the numbers.');
    const fresh = r.data;
    const c = fresh.check;
    if (!c || c.episodeFree) return null;
    if (!c.holder || c.holder.id !== swap.holderId) throw new Error(`E${typedNumber} changed hands a moment ago — pick the number again.`);
    const to = nextFreeExcept(fresh, draftId);
    const m = await showCall('POST', `${showPath(showId)}/move`, { episodeId: swap.holderId, toSeason: season, toNumber: to }, getToken);
    if (!m.ok) throw new Error(m.error);
    return { showId, episodeId: swap.holderId, season, from: typedNumber };
  }

  // --- the file ------------------------------------------------------------------
  const anyUploading = Boolean(upload && ['requesting-url', 'uploading'].includes(upload.status));
  const masterUploading = Boolean(upload && video && upload.uid === video.uid && anyUploading);
  const trailerUploading = Boolean(upload && trailer && upload.uid === trailer.uid && anyUploading);

  async function beginMaster(asset, { resumeUrl = null } = {}) {
    setError(null);
    try {
      const started = await startTusUpload({
        asset, urlPath: '/api/creator/get-upload-url', token: await freshToken(getToken), resumeUrl, kind: 'main',
        onUrl: (url) => setVideo((v) => (v && v.uid === started.uid ? { ...v, uploadUrl: url } : v))
      });
      setVideo({ uid: started.uid, state: 'uploading', name: asset.fileName || 'video', bytes: asset.fileSize || null, uploadUrl: resumeUrl || null, runtimeSeconds: asset.duration ? Math.round(asset.duration / 1000) : null, width: asset.width || null, height: asset.height || null });
      if (!String(latest.current.form.title || '').trim() && asset.fileName) update('title', asset.fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      started.done.then(() => setVideo((v) => (v && v.uid === started.uid ? { ...v, state: 'processing' } : v))).catch(() => {});
    } catch (err) {
      setError(err.message || 'Could not start the upload.');
    }
  }

  async function pickMaster() {
    if (anyUploading) { setError('An upload is already running. Let it finish first.'); return; }
    try {
      const asset = await pickVideo();
      if (!asset) return;
      const resume = video && video.uploadUrl && video.state === 'uploading' && video.bytes === asset.fileSize;
      await beginMaster(asset, { resumeUrl: resume ? video.uploadUrl : null });
    } catch (err) {
      setError(err.message);
    }
  }

  async function pickTrailer() {
    if (anyUploading) { setError('The master is still uploading. Pick the trailer once it has finished.'); return; }
    try {
      const asset = await pickVideo();
      if (!asset) return;
      const started = await startTusUpload({ asset, urlPath: '/api/creator/get-upload-url', token: await freshToken(getToken), kind: 'trailer' });
      setTrailer({ uid: started.uid, state: 'uploading', name: asset.fileName || 'trailer' });
      started.done.then(() => setTrailer((t) => (t && t.uid === started.uid ? { ...t, state: 'processing' } : t))).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  }

  async function importLink() {
    const url = link.trim();
    if (!url) return;
    setImporting(true);
    setError(null);
    try {
      const token = await freshToken(getToken);
      if (form.contentType === 'podcast' && /\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(url)) {
        const data = await apiPost('/api/creator/import-audio-url', { audioUrl: url }, token);
        setForm((f) => ({ ...f, audioUrl: data.audioUrl, audioBytes: data.audioBytes || null }));
      } else {
        const data = await apiPost('/api/creator/import-video-url', { videoUrl: url, fileName: form.title ? `${form.title}.mp4` : undefined }, token);
        setVideo({ uid: data.uid, state: 'processing', name: url.replace(/^https?:\/\//, '').slice(0, 60), bytes: null, uploadUrl: null, runtimeSeconds: null });
      }
      setLinkMode(false);
      setLink('');
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function pickArt(kind) {
    try {
      if (kind === 'titleImage') {
        const img = await pickImageAsDataUrl({ width: 1200, format: 'png' });
        if (img) setTitleImage(img);
        return;
      }
      const img = await pickImageAsDataUrl({ width: kind === 'poster' ? 600 : 1280 });
      if (!img) return;
      if (kind === 'poster') setPoster(img); else setStill(img);
      update('cutArtwork', false);
    } catch (err) {
      setError(err.message);
    }
  }

  function discardDraft() {
    Alert.alert('Discard this draft?', 'The uploaded file is deleted too.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => {
        try {
          if (draftId) await apiDelete('/api/creator/drafts', { id: draftId }, await freshToken(getToken));
          if (saveTimer.current) clearTimeout(saveTimer.current);
          router.replace('/creator');
        } catch (err) {
          setError(err.message);
        }
      } }
    ]);
  }

  function next() {
    const why = stepBlocker(step, form, media) || (step === 2 ? placeBlocker : null);
    if (why) { setError(why); return; }
    setError(null);
    setStep((x) => Math.min(3, x + 1));
  }

  async function submit() {
    for (const n of [1, 2]) {
      const why = stepBlocker(n, form, media) || (n === 2 ? placeBlocker : null);
      if (why) { setError(why); setStep(n); return; }
    }
    setSubmitting(true);
    setError(null);
    // Swap first: the episode on the number moves out of the way.
    let swapped = null;
    if (swapOn) {
      try {
        swapped = await runSwap();
      } catch (err) {
        setSwap(null);
        setPosTick((n) => n + 1);
        setError(err.message);
        setSubmitting(false);
        setStep(2);
        return;
      }
    }
    const body = toSubmitBody(form, media, {
      ...(!form.cutArtwork && poster ? { posterBase64: poster.base64, posterFileName: poster.fileName } : {}),
      ...(!form.cutArtwork && still ? { thumbnailBase64: still.base64, thumbnailFileName: still.fileName } : {}),
      ...(titleImage && form.contentType !== 'podcast' && form.contentType !== 'vertical' ? { titleImageBase64: titleImage.base64, titleImageFileName: titleImage.fileName } : {}),
      ...(draftId ? { draftId } : {})
    });
    const r = await showCall('POST', '/api/creator/submit-episode', body, getToken);
    if (!r.ok) {
      // Sending failed after the swap: the episode goes back to its number.
      if (swapped) {
        await showCall('POST', `${showPath(swapped.showId)}/move`, { episodeId: swapped.episodeId, toSeason: swapped.season, toNumber: swapped.from }, getToken);
        setSwap(null);
      }
      // A number taken meanwhile: back to step 2, where the line says so.
      if (r.data && r.data.code === 'taken') {
        setPosTick((n) => n + 1);
        setStep(2);
      }
      setError(r.error);
      setSubmitting(false);
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    latest.current = { form: EMPTY_SUBMIT_FORM, video: null, trailer: null, draftId: null };
    const showId = r.data.seriesId || (r.data.newShow && r.data.newShow.id) || null;
    router.replace(`/creator?submitted=${encodeURIComponent(form.title.trim())}${r.data.id ? `&id=${encodeURIComponent(r.data.id)}` : ''}${showId ? `&show=${encodeURIComponent(showId)}` : ''}`);
  }

  if (loading) {
    return <SafeAreaView style={cp.screen} edges={['top', 'bottom']}><TopNav /><View style={cp.center}><ActivityIndicator color={colors.brass} /></View></SafeAreaView>;
  }

  const stepInfo = STEPS[step - 1];
  const typeInfo = SUBMIT_TYPES.find((t) => t.value === form.contentType) || SUBMIT_TYPES[0];
  const pct = upload && upload.total ? Math.min(100, Math.round((upload.sent / upload.total) * 100)) : 0;
  const strip = video
    ? `${video.name}${video.bytes ? ` · ${bytesLabel(video.bytes)}` : ''} · ${masterUploading ? `${pct}% uploading` : video.state === 'uploading' ? 'upload stopped' : video.state === 'processing' ? 'uploaded, processing' : video.state === 'ready' ? 'ready' : video.state === 'error' ? 'failed to process' : video.state}`
    : form.audioUrl ? 'Audio imported' : null;

  // What the Place block draws.
  const noun = showNoun(form.contentType);
  const choices = pickerShows.filter((x) => kindFits(x.kind, form.contentType) || x.id === form.seriesId);
  const chosenTag = chosen && chosen.tag ? chosen.tag.replace(/^\(|\)$/g, '') : null;
  const chosenLine = chosen
    ? (chosen.summary
      ? [chosen.summary.statusLabel, chosen.summary.countLine].filter(Boolean).join(' · ')
      : chosenTag ? `${chosenTag.charAt(0).toUpperCase()}${chosenTag.slice(1)}` : 'Live')
    : null;
  const holderTitle = check && check.holder && check.holder.title ? check.holder.title : 'another episode';
  const seasonSource = (posData && posData.seasons) || (chosen && chosen.summary && chosen.summary.seasons) || [];
  const knownSeasons = seasonSource.map((x) => Number(x.number)).filter((n) => n > 0);
  const seasonChips = [...new Set([...(knownSeasons.length ? knownSeasons : [1]), season])].sort((a, b) => a - b).map((n) => {
    const entry = seasonSource.find((x) => Number(x.number) === n);
    const name = entry && entry.label ? String(entry.label).replace(/^Season\s+\d+\s*·\s*/, '') : '';
    if (knownSeasons.length > 0 && !knownSeasons.includes(n)) return { n, text: `${n} · new` };
    return { n, text: name && name !== `Season ${n}` ? `${n} · ${name}` : String(n) };
  });
  const nextSeason = Math.max(...seasonChips.map((c) => c.n)) + 1;
  const fromShowPage = Boolean(!pDraft && pSeries && form.seriesId === pSeries);
  const footLine = step === 3
    ? 'We watch it and reply, usually within a few days. You’ll see it under In review.'
    : saveState === 'saved' ? 'Saved as a draft.'
      : saveState === 'saving' ? 'Saving…'
        : saveState === 'behind' ? `The server is being updated: ${saveLine || 'drafts aren’t kept yet.'}`
          : saveState === 'failed' ? (saveLine ? `Draft not saved: ${saveLine}` : 'Draft not saved; check the connection.')
            : 'Saved as a draft as you go.';

  return (
    <SafeAreaView style={cp.screen} edges={['top', 'bottom']}>
      <TopNav />
      {/* iOS: scroll the field being typed in (the E-number, the title,
          About it) above the keyboard; Android resizes the window itself. */}
      <ScrollView contentContainerStyle={[cp.scroll, { paddingTop: 8 }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={s.head}>
          <Pressable onPress={() => router.navigate('/creator')} hitSlop={8} style={s.back} accessibilityRole="button" accessibilityLabel="Back to Creator Studio"><BackArrowIcon size={16} color={colors.inkDim} /></Pressable>
          <Text style={s.headTitle}>Submit a title</Text>
          <Text style={s.headStep}>STEP {step} OF 3</Text>
        </View>
        <View style={s.progress}><View style={[s.progressFill, { width: `${(step / 3) * 100}%` }]} /></View>
        {step > 1 && strip ? (
          <View style={[s.strip, video && video.state === 'error' && s.stripError]}>
            <Text style={s.stripText} numberOfLines={1}>{strip}</Text>
            <Text style={s.stripText}>{masterUploading ? `${pct}%` : video && (video.state === 'ready' || video.state === 'processing') ? '✓' : ''}</Text>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={{ gap: 14 }}>
            <Text style={cp.h1}>{stepInfo.title}</Text>
            <Text style={cp.lede}>Pick the master. It starts uploading now and keeps going while you fill in the next two steps; close the app and it stops, pick the same file again and it carries on.</Text>
            {!linkMode ? (
              <Field label="What is it"><Chips options={SUBMIT_TYPES} value={form.contentType} onChange={(v) => update('contentType', v)} /></Field>
            ) : null}
            {!video && !form.audioUrl && !linkMode ? (
              <View style={cp.drop}>
                <Text style={cp.dropTitle}>Pick the master</Text>
                <Text style={cp.dropSub}>{form.contentType === 'vertical' ? '9:16, MP4 or MOV, any size.' : 'MP4 or MOV, 1080p or better, any size.'}</Text>
                <GhostButton label="Choose a video" onPress={pickMaster} />
              </View>
            ) : null}
            {video ? <ProgressCard video={video} upload={masterUploading ? upload : null} facts={factsFor(video)} onRemove={() => setVideo(null)} onResume={video.state === 'uploading' && !masterUploading ? pickMaster : null} /> : null}
            {form.audioUrl ? (
              <View style={cp.progress}>
                <View style={cp.progressRow}><Text style={cp.progressName}>Audio imported{form.audioBytes ? ` · ${bytesLabel(form.audioBytes)}` : ''}</Text><Text style={cp.progressRight}>ready ✓</Text></View>
                <View style={cp.progressMeta}><Text style={cp.metaText}>An audio-only episode. Add a video too, or go on.</Text><Text style={cp.link} onPress={() => setForm((f) => ({ ...f, audioUrl: null, audioBytes: null }))}>Remove</Text></View>
              </View>
            ) : null}
            {!linkMode ? (
              <Text style={cp.link} onPress={() => setLinkMode(true)}>The file is somewhere else</Text>
            ) : (
              <View style={cp.card}>
                <Text style={cp.cardK}>A link to the file</Text>
                <Text style={cp.help}>A direct file link (a signed download link from Drive, Dropbox, WeTransfer, Frame.io or S3) and Cloudflare fetches it. A page that only shows a player has no file to fetch.{form.contentType === 'podcast' ? ' Audio only: paste the MP3 the same way.' : ''}</Text>
                <Input value={link} onChangeText={setLink} placeholder="https://" autoCapitalize="none" keyboardType="url" />
                <View style={cp.actions}>
                  <SecondaryButton label={importing ? 'Fetching…' : 'Fetch it'} disabled={importing || !link.trim()} onPress={importLink} />
                  <GhostButton label="Pick the file instead" onPress={() => setLinkMode(false)} />
                </View>
              </View>
            )}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={{ gap: 14 }}>
            {placeType ? <Text style={cp.eyebrow}>{typeInfo.label}</Text> : null}
            <Text style={cp.h1}>{stepInfo.title}</Text>
            <Text style={cp.lede}>{placeType ? 'Where it goes first, then what viewers read. Short is fine.' : 'What viewers read on the page. Short is fine.'}</Text>

            {placeType ? (
              <View style={[cp.card, s.place]} accessibilityLabel="Where it goes">
                <Field label={form.contentType === 'bonus' ? 'Which show is it for' : `The ${noun}`}>
                  <Pressable
                    style={({ pressed }) => [s.pickField, showProblem && s.pickFieldWarn, pressed && s.pressed]}
                    onPress={() => setPickerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`${form.contentType === 'bonus' ? 'Which show is it for' : `The ${noun}`}: ${newMode ? `New ${noun}` : chosen ? chosen.name : 'Choose'}`}
                  >
                    {chosen ? (chosen.art ? <SmartImage uri={chosen.art} style={s.pickArt} resizeMode="cover" /> : <View style={s.pickArt} />) : null}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.pickName, !chosen && !newMode && s.pickPlaceholder]} numberOfLines={1}>
                        {newMode ? `+ New ${noun}` : chosen ? (chosen.name || 'Untitled show') : form.seriesId ? 'A show that isn’t yours' : 'Choose…'}
                      </Text>
                      {chosenLine ? <Text style={s.pickLine} numberOfLines={1}>{chosenLine}</Text> : null}
                    </View>
                    <ChevronIcon size={14} color={colors.inkDim} />
                  </Pressable>
                  {!chosen && !newMode && choices.length === 0 && summaries ? (
                    <Text style={cp.help}>{form.contentType === 'bonus' ? 'An extra goes with one of your shows — you have none yet.' : `No ${noun} of yours yet: “+ New ${noun}” starts one with this episode.`}</Text>
                  ) : null}
                  {showProblem ? <Text style={s.placeWarn} accessibilityRole="alert">{showProblem}</Text> : null}
                </Field>

                {newMode ? (
                  <View style={s.newShow}>
                    <Field label={`New ${noun} name`}><Input value={form.newSeriesName.trimStart()} onChangeText={(v) => update('newSeriesName', v || ' ')} maxLength={120} placeholder="The show this episode belongs to" /></Field>
                    <Field label={`About the ${noun}`} note="optional"><Input multiline value={form.newSeriesDescription} onChangeText={(v) => update('newSeriesDescription', v)} maxLength={2000} style={{ minHeight: 64 }} /></Field>
                    <Text style={cp.help}>The {noun} is created with this episode and stays private until you make it public. Its own poster and trailer come later, on its show page.</Text>
                  </View>
                ) : null}

                {numbered ? (
                  <>
                    <Field label="Season">
                      <View style={s.chips} accessibilityRole="radiogroup">
                        {seasonChips.map((c) => <Chip key={c.n} on={c.n === season} label={c.text} onPress={() => pickSeason(c.n)} />)}
                        <Chip dashed label={`+ ${nextSeason} · new`} onPress={() => pickSeason(nextSeason)} />
                      </View>
                    </Field>
                    <Field label="Episode number">
                      <View style={s.numberRow}>
                        <View style={[s.number, taken && !swapOn && s.numberTaken]}>
                          <Text style={s.numberE}>E</Text>
                          <Input
                            value={String(form.seriesOrder || '')}
                            onChangeText={typeNumber}
                            keyboardType="number-pad"
                            maxLength={4}
                            style={s.numberInput}
                            accessibilityLabel="Episode number"
                          />
                        </View>
                        {nextFree ? (
                          <Pressable
                            style={({ pressed }) => [s.nextFree, typedNumber === nextFree && s.nextFreeOn, pressed && s.pressed]}
                            onPress={() => takeNumber(nextFree)}
                            accessibilityRole="button"
                            accessibilityLabel={`Use E${nextFree}, the next free number`}
                          >
                            <Text style={s.nextFreeText}>E{nextFree} · <Text style={s.nextFreeDim}>next free</Text></Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {taken && !swapOn ? (
                        <View style={s.conflict} accessibilityRole="alert">
                          <View style={s.conflictLine}>
                            <WarningIcon size={15} color={colors.brass} />
                            <Text style={s.conflictText}><Text style={cp.strong}>E{typedNumber}</Text> is taken by <Text style={cp.strong}>{holderTitle}</Text></Text>
                          </View>
                          <View style={s.conflictActs}>
                            {nextFree ? <SmallButton tone="primary" label={`Use E${nextFree}`} onPress={() => takeNumber(nextFree)} /> : null}
                            {canSwap && nextFree ? (
                              <SmallButton label="Swap" onPress={() => setSwap({ showId: form.seriesId, season, number: typedNumber, holderId: check.holder.id, holderTitle: check.holder.title || null })} />
                            ) : null}
                          </View>
                          {canSwap && nextFree ? <Text style={s.conflictNote}>Swap moves {holderTitle} to E{nextFree}.</Text> : null}
                        </View>
                      ) : null}
                      {swapOn ? (
                        <View style={[s.conflict, s.conflictSwap]} accessibilityLiveRegion="polite">
                          <Text style={s.conflictText}>{holderTitle} moves to E{nextFree} when you send this one, and this one takes E{typedNumber}.</Text>
                          <Text style={cp.link} onPress={() => setSwap(null)}>Keep {holderTitle} where it is</Text>
                        </View>
                      ) : null}
                      {!taken && check && check.code === 'draft' ? (
                        <Text style={cp.help}>{check.words} — that one will need another number before it’s sent.</Text>
                      ) : null}
                      {placeOn && pos.error ? <Text style={cp.help}>{pos.error}</Text> : null}
                    </Field>
                  </>
                ) : null}
              </View>
            ) : null}
            {placeType && fromShowPage ? (
              <Text style={cp.help}>Opened from the show page, so the {noun}, season and number came filled in.</Text>
            ) : null}

            {/* What kind of extra (migration 121): only a label on its card and its page. */}
            {form.contentType === 'bonus' ? (
              <ExtraKindField
                choice={form.extraKindChoice || ''}
                other={form.extraKindOther || ''}
                disabled={Boolean(kindLocked)}
                onChange={(v) => setForm((f) => ({ ...f, extraKindChoice: v.choice, extraKindOther: v.other }))}
              >
                {kindLocked ? <Text style={cp.help}>{kindLocked}</Text> : null}
              </ExtraKindField>
            ) : null}

            <Field label="Title"><Input value={form.title} onChangeText={(v) => update('title', v)} maxLength={300} /></Field>
            <Field label="About it"><Input multiline value={form.description} onChangeText={(v) => update('description', v)} maxLength={4000} /></Field>
            {/* A film or a short has its own page from the start: its notes
                go on it (saved with the draft, written on Send) — the
                website's components/PageNotesField.js, the same words. */}
            {submitHasOwnPage(form.contentType) ? (
              <Field label="Notes for the title’s page" note="optional · blank lines make paragraphs">
                <Input
                  multiline
                  value={form.pageNotes || ''}
                  onChangeText={(v) => update('pageNotes', v)}
                  maxLength={SUBMIT_NOTES_MAX}
                  placeholder="How it was made, who’s in it, the story behind a scene."
                  accessibilityLabel="Notes for the title’s page"
                />
                <Text style={cp.help}>{String(form.pageNotes || '').length.toLocaleString('en-US')} / {SUBMIT_NOTES_MAX.toLocaleString('en-US')} · shown on the title’s page in place of the description.</Text>
              </Field>
            ) : null}
            <Field label="Your name, as credited"><Input value={form.artist} onChangeText={(v) => update('artist', v)} maxLength={200} /></Field>
            <Field label="Genre"><Chips small options={MAIN_GENRES.map((g) => ({ value: g, label: g }))} value={form.mainGenre} onChange={(v) => update('mainGenre', v)} /></Field>
            <Field label="Rating" note="not set = treated as 17+"><Chips small options={[{ value: '', label: 'Not set' }, ...ratings.map((r) => ({ value: r.code, label: r.code }))]} value={form.rating} onChange={(v) => update('rating', v)} /></Field>
            {/* The uploader's own mark (Jose, 2026-11-13); saved with the draft. */}
            <FlashingLightsField checked={form.hasFlashingLights === true} onChange={(v) => update('hasFlashingLights', v)} />
            <View style={s.two}>
              <Field label="Runtime" note={video && video.runtimeSeconds ? 'read from the file' : 'MM:SS'} style={{ flex: 1 }}><Input value={form.runtime} onChangeText={(v) => update('runtime', v)} placeholder="12:04" /></Field>
              <Field label="Year" note="optional" style={{ flex: 1 }}><Input value={String(form.releaseYear || '')} onChangeText={(v) => update('releaseYear', v)} keyboardType="number-pad" placeholder={String(new Date().getFullYear())} /></Field>
            </View>
            <Field label="Specific genre" note="optional, e.g. “Cosmic Horror”"><Input value={form.genre} onChangeText={(v) => update('genre', v)} maxLength={60} /></Field>
          </View>
        ) : null}

        {step === 3 ? (
          <View style={{ gap: 14 }}>
            <Text style={cp.h1}>{stepInfo.title}</Text>
            <Text style={cp.lede}>A poster and a still. No text baked in. Skip them and we cut both from the film itself; swap them any time from Your work.</Text>
            <View style={s.art}>
              <Pressable style={[s.slotPoster, form.cutArtwork && s.slotOff]} onPress={() => pickArt('poster')}>
                {poster && !form.cutArtwork ? <Image source={{ uri: poster.uri }} style={s.slotImg} /> : <Text style={s.slotText}>POSTER{'\n'}2:3</Text>}
              </Pressable>
              <View style={{ flex: 1, gap: 10 }}>
                <Pressable style={[s.slotStill, form.cutArtwork && s.slotOff]} onPress={() => pickArt('still')}>
                  {still && !form.cutArtwork ? <Image source={{ uri: still.uri }} style={s.slotImg} /> : <Text style={s.slotText}>STILL · 16:9</Text>}
                </Pressable>
                <GhostButton on={form.cutArtwork} label={form.cutArtwork ? '✓ Cutting both from the film' : 'Cut both from the film for me'} onPress={() => update('cutArtwork', !form.cutArtwork)} style={{ alignSelf: 'stretch' }} />
              </View>
            </View>
            {form.contentType !== 'podcast' && form.contentType !== 'vertical' ? (
              <Field label="Title image" note="optional · a PNG with a transparent background">
                <Pressable style={s.slotTitle} onPress={() => pickArt('titleImage')} accessibilityRole="button" accessibilityLabel={titleImage ? 'Replace the title image' : 'Add a title image'}>
                  {titleImage ? <Image source={{ uri: titleImage.uri }} style={s.slotTitleImg} resizeMode="contain" /> : <Text style={s.slotText}>THE TITLE SET AS A PICTURE{'\n'}SHOWN IN PLACE OF THE TEXT TITLE</Text>}
                </Pressable>
                {titleImage ? <GhostButton label="Remove the title image" onPress={() => setTitleImage(null)} style={{ alignSelf: 'flex-start' }} /> : null}
              </Field>
            ) : null}
            <Field label="Trailer" note="optional · 15–30 s">
              {trailer
                ? <ProgressCard video={{ ...trailer, bytes: null }} upload={trailerUploading ? upload : null} facts={[]} onRemove={() => setTrailer(null)} />
                : <GhostButton label={anyUploading ? 'Once the master has finished' : 'Pick a clip, or skip'} disabled={anyUploading} onPress={pickTrailer} style={{ alignSelf: 'stretch' }} />}
            </Field>
            <Text style={cp.help}>Captions (SRT or VTT) are added from Your work on the website once it&rsquo;s in; otherwise we caption what we can.</Text>

            <View style={s.options}>
              <Pressable onPress={() => setOptionsOpen((o) => !o)}><Text style={s.optionsSummary}>{optionsOpen ? '▾' : '▸'} More options <Text style={cp.help}>· the defaults are fine for most titles</Text></Text></Pressable>
              {optionsOpen ? (
                <View style={{ gap: 12, marginTop: 12 }}>
                  <View style={{ gap: 6 }}>
                    <Text style={s.optLabel}>Who can watch</Text>
                    <Text style={cp.help}>Free with ads, or Tapa + members only. The studio has the final say.</Text>
                    <Chips small options={[{ value: 'free', label: 'Free' }, { value: 'premium', label: 'Tapa +' }]} value={form.tier === 'premium' ? 'premium' : 'free'} onChange={(v) => update('tier', v)} />
                  </View>
                  <Field label="Ad breaks" note="MM:SS, comma-separated"><Input value={form.adBreaksText} onChangeText={(v) => update('adBreaksText', v)} /></Field>
                  <Switch on={form.channelOptIn} onPress={() => update('channelOptIn', !form.channelOptIn)} label="Let channels air it" hint="TapaTV can schedule it live, with ads." />
                  <Switch on={form.featured} onPress={() => update('featured', !form.featured)} label="Ask for the home page hero" hint="The studio decides what rotates." />
                  <Switch on={form.isOriginal} onPress={() => update('isOriginal', !form.isOriginal)} label="Tapa Original" hint="Made with or for the studio." />
                  <Field label="Funding link" note="optional"><Input value={form.fundingUrl} onChangeText={(v) => update('fundingUrl', v)} placeholder="https://" autoCapitalize="none" keyboardType="url" /></Field>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {error ? <Text style={cp.error} accessibilityRole="alert">{error}</Text> : null}

        <View style={s.foot}>
          {step < 3
            ? <PrimaryButton label={step === 1 ? 'Next: about it' : 'Next: artwork'} onPress={next} />
            : <PrimaryButton label="Submit for review" onPress={submit} busy={submitting} />}
          <View style={s.footRow}>
            {step > 1 ? <Text style={cp.link} onPress={() => { setError(null); setStep((x) => x - 1); }}>Back</Text> : <Text> </Text>}
            <Text style={[cp.note, { flex: 1 }]}>{footLine}</Text>
            {draftId || video ? <Text style={cp.link} onPress={discardDraft}>Discard</Text> : <Text> </Text>}
          </View>
        </View>
      </ScrollView>

      {pickerOpen ? (
        <Sheet title={form.contentType === 'bonus' ? 'Which show is it for' : `The ${noun}`} eyebrow={typeInfo.label} onClose={() => setPickerOpen(false)}>
          <View style={{ gap: 6 }} accessibilityRole="radiogroup">
            {choices.map((x) => {
              const on = x.id === form.seriesId && !newMode;
              const off = !x.ok && !on;
              const reason = !x.ok && x.summary && x.summary.pickReason ? x.summary.pickReason : null;
              return (
                <Pressable
                  key={x.id}
                  style={({ pressed }) => [s.pickRow, on && s.pickRowOn, off && s.pickRowOff, pressed && !off && s.pressed]}
                  disabled={off}
                  onPress={() => pickShow(x.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: off }}
                  accessibilityLabel={`${x.name || 'Untitled show'}${x.tag ? ` ${x.tag}` : ''}`}
                >
                  {x.art ? <SmartImage uri={x.art} style={s.pickArt} resizeMode="cover" /> : <View style={s.pickArt} />}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.pickName} numberOfLines={1}>{x.name || 'Untitled show'}</Text>
                    {x.tag ? <Text style={s.pickLine} numberOfLines={1}>{x.tag.replace(/^\(|\)$/g, '')}</Text> : null}
                    {reason ? <Text style={s.pickLine} numberOfLines={2}>{reason}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            {choices.length === 0 ? (
              <Text style={cp.help}>{summaries || allSeries.length ? (form.contentType === 'bonus' ? 'An extra goes with one of your shows — you have none yet.' : `No ${noun} of yours yet.`) : 'Reading your shows…'}</Text>
            ) : null}
            {form.contentType !== 'bonus' ? (
              <Pressable style={({ pressed }) => [s.pickRow, s.pickRowNew, newMode && s.pickRowOn, pressed && s.pressed]} onPress={() => pickShow('__new__')} accessibilityRole="radio" accessibilityState={{ checked: newMode }}>
                <View style={[s.pickArt, s.pickArtNew]}><PlusIcon size={16} color={colors.inkDim} /></View>
                <Text style={s.pickName}>New {noun}</Text>
              </Pressable>
            ) : null}
          </View>
        </Sheet>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  headTitle: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  headStep: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.inkDim },
  progress: { height: 3, borderRadius: 2, backgroundColor: inkTint(0.12), overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.olive },
  strip: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, backgroundColor: okTint(0.08) },
  stripError: { backgroundColor: dangerTint(0.1) },
  stripText: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkDim, flexShrink: 1 },
  two: { flexDirection: 'row', gap: 10 },
  pressed: { opacity: 0.75 },

  // the Place block
  place: { gap: 14 },
  pickField: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: inkTint(0.2), backgroundColor: colors.surface0 },
  pickFieldWarn: { borderColor: brassTint(0.6) },
  pickArt: { width: 28, height: 42, borderRadius: 4, backgroundColor: colors.surface2 },
  pickArtNew: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.3), backgroundColor: 'transparent' },
  pickName: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  pickPlaceholder: { color: colors.inkDim, fontFamily: fonts.display },
  pickLine: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkDim },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.12) },
  pickRowOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.12) },
  pickRowOff: { opacity: 0.45 },
  pickRowNew: { borderStyle: 'dashed', borderColor: inkTint(0.3) },
  placeWarn: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.brass },
  newShow: { gap: 10, padding: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  number: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, borderRadius: 8, borderWidth: 1, borderColor: inkTint(0.2), backgroundColor: colors.surface0 },
  numberTaken: { borderColor: colors.brass },
  numberE: { fontFamily: fonts.mono, fontSize: 15, color: colors.inkDim },
  numberInput: { width: 72, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 4 },
  nextFree: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.3), justifyContent: 'center' },
  nextFreeOn: { borderStyle: 'solid', borderColor: colors.olive, backgroundColor: oliveTint(0.12) },
  nextFreeText: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink },
  nextFreeDim: { color: colors.inkDim },
  conflict: { gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: brassTint(0.5), backgroundColor: brassTint(0.08) },
  conflictSwap: { borderColor: oliveTint(0.5), backgroundColor: oliveTint(0.08) },
  conflictLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  conflictText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  conflictActs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  conflictNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkDim },

  art: { flexDirection: 'row', gap: 12 },
  slotPoster: { width: 110, height: 165, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: inkTint(0.4), alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.surface0 },
  slotStill: { flex: 1, minHeight: 90, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: inkTint(0.4), alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.surface0 },
  slotOff: { opacity: 0.45 },
  slotTitle: { minHeight: 64, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center', padding: 8, backgroundColor: colors.surface0 },
  slotTitleImg: { width: '100%', height: 64 },
  slotImg: { width: '100%', height: '100%' },
  slotText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1, color: colors.inkDim, textAlign: 'center', lineHeight: 14 },
  options: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.15) },
  optionsSummary: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  optLabel: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  foot: { gap: 8, marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }
});
