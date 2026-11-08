import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useUpload } from '../../contexts/UploadContext';
import { readVideoMetadata } from '../../lib/videoMetadata';
import { bytesLabel, runtimeClock } from '../../lib/creatorRights';
import { joinDescription, saveSummary, splitDescription } from '../../lib/showRules';
import { changedFields } from '../../lib/draftPatch';
import { SITE } from '../../lib/siteConfig';
import MoveSheet from './MoveSheet';
import { fileDrop, pickerKeys } from './roomBits';
import { Banner, EditorFrame, FieldHead, FieldNote, Toast, callApi, masterWords, shortDate, uploadPct, uploadRunning, useBeforeUnload, useDirtyReport, useHeaderOffset, useToast } from './EditorBits';
import { AboutField, MoreOptions, OneLineField, PlaceBlock, SameAsShow, TitleField } from './EpisodeFields';
import { CheckIcon, ClockIcon, TrashIcon, WarningIcon } from '../PlayerIcons';
import ExtraKindField from '../ExtraKindField';
import { extraKindChoice } from '../../lib/extraKinds';

// The episode editor for a draft (series revamp slice 2): an episode that
// isn't sent yet, a creator_drafts row whose form holds the show, season
// and number. Same screen and layouts as EpisodeEditor, everything applies
// at once (nothing is live), saved with PATCH /api/creator/drafts — only
// the fields the person changed (lib/draftPatch.js), so the show page's
// upload queue, which puts the file on the same draft meanwhile, and this
// screen never put back each other's older copy — and "Send for review"
// posts it to /api/show/[id]/send.
// The poster and still, captions, a trailer, its own page and the credits
// come after it is sent (the episode editor then has them).

const DESC_MAX = 4000;
const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm';
const POLL_MS = 15000;
const POLL_MAX = 40;
const DIRECT = { mode: 'direct', line: null };

function draftFormOf(d) {
  const f = (d && d.form) || {};
  const desc = splitDescription(f.description || '');
  return {
    title: f.title || '',
    oneLine: desc.oneLine,
    about: desc.about,
    mainGenre: f.mainGenre || '',
    genre: f.genre || '',
    artist: f.artist || '',
    releaseYear: f.releaseYear ? String(f.releaseYear) : '',
    rating: f.rating || '',
    tier: f.tier === 'premium' ? 'premium' : 'free',
    runtime: f.runtime || (d && d.video && d.video.runtimeSeconds ? runtimeClock(d.video.runtimeSeconds) || '' : ''),
    fundingUrl: f.fundingUrl || '',
    adsEnabled: f.adsEnabled !== false,
    adBreaksText: f.adBreaksText || '0:00',
    channelOptIn: f.channelOptIn === true,
    featured: f.featured === true,
    isOriginal: f.isOriginal === true,
    season: Number(f.season) || 1,
    number: f.seriesOrder ? String(f.seriesOrder) : '',
    // An extra's kind (migration 121), kept in the draft as the field holds
    // it (the three-step submit's keys); a draft with only `extraKind`
    // opens on that.
    extraKindChoice: typeof f.extraKindChoice === 'string' ? f.extraKindChoice : extraKindChoice(f.extraKind).choice,
    extraKindOther: typeof f.extraKindOther === 'string' ? f.extraKindOther : extraKindChoice(f.extraKind).other
  };
}

// The form as the draft stores it (the three-step submit's shape).
function draftValues(form) {
  return {
    title: form.title.trim(),
    description: joinDescription(form.oneLine, form.about),
    mainGenre: form.mainGenre,
    genre: form.genre.trim(),
    artist: form.artist.trim(),
    releaseYear: form.releaseYear.trim(),
    rating: form.rating,
    tier: form.tier,
    runtime: form.runtime.trim(),
    fundingUrl: form.fundingUrl.trim(),
    adsEnabled: form.adsEnabled,
    adBreaksText: form.adBreaksText,
    channelOptIn: form.channelOptIn,
    featured: form.featured,
    isOriginal: form.isOriginal,
    season: String(Number(form.season) || 1),
    seriesOrder: String(form.number || '').trim(),
    extraKindChoice: form.extraKindChoice || '',
    extraKindOther: form.extraKindOther || ''
  };
}

const FIELD_OF = { title: 'title', description: 'description', mainGenre: 'mainGenre', genre: 'genre', artist: 'artist', releaseYear: 'releaseYear', rating: 'rating', tier: 'tier', runtime: 'runtime', fundingUrl: 'fundingUrl', adsEnabled: 'adsEnabled', adBreaksText: 'adBreakSeconds', channelOptIn: 'channelOptIn', featured: 'featured', isOriginal: 'isOriginal', season: 'place', seriesOrder: 'place', extraKindChoice: 'extraKind', extraKindOther: 'extraKind' };

// What a save sends: the fields changed since the draft was read (the
// season and the number go together, as one place).
function formChange(init, form) {
  const was = draftValues(init);
  const now = draftValues(form);
  const change = changedFields(was, now);
  if ('season' in change || 'seriesOrder' in change) {
    change.season = now.season;
    change.seriesOrder = now.seriesOrder;
  }
  // The kind's chip and its words go together, as one field.
  if ('extraKindChoice' in change || 'extraKindOther' in change) {
    change.extraKindChoice = now.extraKindChoice;
    change.extraKindOther = now.extraKindOther;
  }
  return change;
}

function findRow(view, id) {
  for (const s of (view && view.seasons) || []) for (const r of s.rows || []) if (r.kind === 'draft' && r.id === id) return r;
  return null;
}

export default function DraftEditor({ showId, mode = 'creator', layout = 'page', onClose, onSaved, onDirtyChange, initialDraft }) {
  const router = useRouter();
  const rootRef = useRef(null);
  useHeaderOffset(rootRef);
  const { activeUpload, startVideoUpload, setQueueHost } = useUpload();
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  draftRef.current = draft;
  const showOf = (d) => (d && d.form && d.form.seriesId ? String(d.form.seriesId) : showId);
  const theShowId = showOf(draft);
  const [view, setView] = useState(null);
  const [viewError, setViewError] = useState(null);
  const [form, setForm] = useState(() => draftFormOf(initialDraft));
  const [init, setInit] = useState(() => draftFormOf(initialDraft));
  const [resets, setResets] = useState(() => new Set());
  const [tab, setTab] = useState('basics');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [fileNote, setFileNote] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [myShows, setMyShows] = useState(null);
  const [seasonPos, setSeasonPos] = useState({});
  const [toast, showToast] = useToast();

  const loadView = useCallback(async () => {
    const r = await callApi('GET', `/api/show/${encodeURIComponent(theShowId)}`);
    if (r.ok) {
      setView(r.data);
      setViewError(null);
    } else setViewError(r.error);
    return r;
  }, [theShowId]);
  useEffect(() => { loadView(); }, [loadView]);

  const show = view ? view.show : null;
  const row = view ? findRow(view, draft.id) : null;
  // An extra still in draft (a three-step submit of bonus content) gets the
  // kind field too.
  const draftIsExtra = Boolean(draft && draft.form && draft.form.contentType === 'bonus');
  const defaults = (show && show.defaults) || {};
  const kind = show ? show.kind : 'series';

  const set = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResets((r) => {
      if (!r.has(key)) return r;
      const next = new Set(r);
      next.delete(key);
      return next;
    });
  }, []);
  const reset = useCallback((key) => {
    const value = key === 'genre' || key === 'artist' || key === 'releaseYear' ? '' : key === 'tier' ? (defaults.tier === 'premium' ? 'premium' : 'free') : defaults[key] || '';
    setForm((f) => ({ ...f, [key]: value }));
    setResets((r) => new Set(r).add(key));
  }, [defaults]);
  const pol = useCallback(() => DIRECT, []);

  const changes = useMemo(() => {
    const a = draftValues(form);
    const b = draftValues(init);
    const out = [];
    const seen = new Set();
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      const field = FIELD_OF[k] || k;
      if (seen.has(field)) continue;
      seen.add(field);
      out.push({ field, mode: 'direct' });
    }
    return out;
  }, [form, init]);
  const dirty = changes.length > 0;
  useBeforeUnload(dirty);
  useDirtyReport(dirty, onDirtyChange);
  const summary = saveSummary(changes);
  const edited = (field) => changes.some((c) => c.field === field);

  // --- the place ------------------------------------------------------------------
  const curSeason = Number(form.season) || 1;
  const pos = seasonPos[curSeason] && seasonPos[curSeason].state === 'ready' ? seasonPos[curSeason].data : null;
  useEffect(() => {
    if (seasonPos[curSeason]) return;
    setSeasonPos((p) => ({ ...p, [curSeason]: { state: 'loading' } }));
    callApi('GET', `/api/show/${encodeURIComponent(theShowId)}/positions?season=${curSeason}&exclude=${encodeURIComponent(draft.id)}`).then((r) => {
      setSeasonPos((p) => ({ ...p, [curSeason]: r.ok ? { state: 'ready', data: r.data } : { state: 'error', error: r.error } }));
      if (r.ok) setForm((f) => (Number(f.season) === curSeason && !String(f.number).trim() ? { ...f, number: String(r.data.nextFree || 1) } : f));
    });
  }, [seasonPos, curSeason, theShowId, draft.id]);
  const numberN = Number(form.number) || null;
  const holderRaw = pos && numberN && pos.taken ? pos.taken[numberN] : null;
  const holder = holderRaw && holderRaw.id !== draft.id ? holderRaw : null;
  const placeChanged = Number(form.season) !== Number(init.season) || String(form.number) !== String(init.number);
  const placeBlocked = Boolean(holder && holder.kind === 'episode');
  const seasons = useMemo(() => {
    const list = (view && view.seasons ? view.seasons : []).map((s) => ({ number: s.number, label: s.label }));
    return list;
  }, [view]);

  function pickSeason(n) {
    if (n === Number(init.season)) setForm((f) => ({ ...f, season: n, number: init.number }));
    else setForm((f) => ({ ...f, season: n, number: seasonPos[n] && seasonPos[n].data ? String(seasonPos[n].data.nextFree || 1) : '' }));
  }

  async function reloadDraft({ resetForm = false, place = false } = {}) {
    const r = await callApi('GET', `/api/creator/drafts?id=${encodeURIComponent(draft.id)}`);
    if (!r.ok || !r.data.draft) return r;
    const d = r.data.draft;
    setDraft(d);
    const f = draftFormOf(d);
    if (resetForm) {
      setForm(f);
      setInit(f);
      setResets(new Set());
    } else if (place) {
      setInit((i) => ({ ...i, season: f.season, number: f.number }));
      setForm((x) => ({ ...x, season: f.season, number: f.number }));
      setSeasonPos({});
    } else {
      // The runtime the file reported, where nobody typed one.
      setInit((i) => (i.runtime.trim() ? i : { ...i, runtime: f.runtime }));
      setForm((x) => (x.runtime.trim() ? x : { ...x, runtime: f.runtime }));
    }
    return r;
  }

  async function placeVia(how) {
    setBusy('place');
    setError(null);
    const r = await callApi('POST', `/api/show/${encodeURIComponent(theShowId)}/move`, { draftId: draft.id, toSeason: curSeason, toNumber: numberN, mode: how });
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    await reloadDraft({ place: true });
    setBusy(null);
    showToast({ title: 'Moved', lines: [r.data.words].filter(Boolean) });
    loadView();
  }

  // --- the file ----------------------------------------------------------------------
  // The screen draws its own uploads (the file card, the trailer slot), so
  // the corner widget stays off them — and off this footer's Save — as on
  // the show page: they ride with the show (`queue`), whose page this is.
  useEffect(() => {
    if (layout === 'panel' || !setQueueHost) return undefined;
    setQueueHost(theShowId);
    return () => setQueueHost(null);
  }, [layout, theShowId, setQueueHost]);
  const video = draft.video;
  const busyUpload = uploadRunning(activeUpload);
  const uploadingNow = Boolean(video && activeUpload && activeUpload.uid === video.uid && busyUpload);
  const masterState = row && row.master ? row.master : video ? video.state || 'processing' : draft.form && draft.form.audioUrl ? 'audio' : 'none';
  const watching = Boolean(video && ['uploading', 'processing'].includes(video.state) && !uploadingNow);
  useEffect(() => {
    if (!watching) return undefined;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n > POLL_MAX) {
        clearInterval(t);
        return;
      }
      const r = await reloadDraft({});
      if (r && r.ok && r.data.draft && r.data.draft.video && r.data.draft.video.state === 'ready') loadView();
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, draft.id]);

  // A save of the media only: this video, nothing else.
  const saveVideo = useCallback(async (nextVideo) => {
    const d = draftRef.current;
    const r = await callApi('PATCH', '/api/creator/drafts', { id: d.id, video: nextVideo });
    if (r.ok && r.data.draft) setDraft(r.data.draft);
    return r;
  }, []);

  async function pickFile(file) {
    if (!file) return;
    setError(null);
    setFileNote(null);
    if (busyUpload) {
      setError('Another upload is running — let it finish first.');
      return;
    }
    const v = draftRef.current.video;
    const resumeUrl = v && v.uploadUrl && v.state === 'uploading' && v.name === file.name && Number(v.bytes) === file.size ? v.uploadUrl : null;
    let meta = {};
    try {
      meta = await readVideoMetadata(file);
    } catch {
      meta = {};
    }
    try {
      let current = null;
      const started = await startVideoUpload(file, {
        urlEndpoint: `/api/creator/get-upload-url?seriesId=${encodeURIComponent(theShowId)}`,
        resumeUrl,
        kind: 'main',
        queue: { showId: theShowId, showName: show ? show.name : null },
        onUrl: (url) => {
          if (current) {
            current = { ...current, uploadUrl: url };
            saveVideo(current);
          }
        }
      });
      current = {
        uid: started.uid,
        state: 'uploading',
        name: file.name,
        bytes: file.size,
        uploadUrl: resumeUrl || null,
        runtimeSeconds: meta && meta.duration ? Math.round(meta.duration) : v && resumeUrl ? v.runtimeSeconds || null : null
      };
      const saved = await saveVideo(current);
      if (!saved.ok) setError(saved.error);
      if (current.runtimeSeconds && !form.runtime.trim()) set('runtime', runtimeClock(current.runtimeSeconds) || '');
      started.done
        .then(async () => {
          current = { ...current, state: 'processing' };
          await saveVideo(current);
          setFileNote('Uploaded — Cloudflare is processing it.');
        })
        .catch(() => setFileNote('The upload stopped — pick the same file again to resume.'));
    } catch (err) {
      setError((err && err.message) || 'Could not start the upload.');
    }
  }

  // --- save, send, discard ---------------------------------------------------------------
  async function save({ quiet = false } = {}) {
    if (saving) return false;
    if (placeBlocked) {
      setError(`E${numberN} is held by an episode — pick another number.`);
      return false;
    }
    setSaving(true);
    setError(null);
    // Only what the person changed: the show page's upload queue may be
    // putting a file on this draft meanwhile, and the server merges both.
    const d = draftRef.current;
    const r = await callApi('PATCH', '/api/creator/drafts', { id: d.id, form: formChange(init, form) });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setDraft(r.data.draft);
    const f = draftFormOf(r.data.draft);
    setForm(f);
    setInit(f);
    setResets(new Set());
    if (placeChanged) setSeasonPos({});
    if (!quiet) showToast({ title: 'Saved', lines: ['A draft is only yours until you send it.'] });
    loadView();
    if (onSaved) onSaved({ id: d.id, kind: 'draft', ...draftValues(f) }, { draft: true });
    return true;
  }

  async function send() {
    if (dirty && !(await save({ quiet: true }))) return;
    setBusy('send');
    setError(null);
    const r = await callApi('POST', `/api/show/${encodeURIComponent(theShowId)}/send`, { draftIds: [draft.id] });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const created = (r.data.created || [])[0];
    const skipped = (r.data.skipped || [])[0];
    if (created) {
      showToast({ title: 'Sent for review', lines: [`${created.code || 'It'} is in review now.`] });
      if (onSaved) onSaved({ id: created.id, season: created.season, seriesOrder: created.seriesOrder, code: created.code, title: created.title, status: 'pending' }, { sentFromDraft: draft.id });
      if (layout !== 'panel') router.replace(`/creator/show/${encodeURIComponent(theShowId)}/episode/${encodeURIComponent(created.id)}`);
      return;
    }
    if (skipped) {
      setError(skipped.reason);
      if (skipped.nextFree) set('number', String(skipped.nextFree));
    }
  }

  async function discard() {
    if (!window.confirm('Discard this draft? Its uploaded file is deleted too.')) return;
    setBusy('discard');
    const r = await callApi('DELETE', '/api/creator/drafts', { id: draft.id });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (onSaved) onSaved({ id: draft.id, kind: 'draft' }, { discarded: true });
    if (layout === 'panel') {
      if (onClose) onClose();
    } else router.push(`/creator/show/${encodeURIComponent(theShowId)}`);
  }

  async function openMove() {
    setMoveOpen(true);
    if (myShows) return;
    const r = await callApi('GET', '/api/show');
    setMyShows(r.ok && Array.isArray(r.data.shows) ? r.data.shows : []);
  }

  function close() {
    if (dirty && !window.confirm('Leave without saving your changes?')) return;
    if (onClose) onClose();
  }

  // --- the screen ------------------------------------------------------------------------
  const code = numberN ? `S${curSeason} E${init.number || numberN}` : null;
  const title = form.title.trim() || (init.number ? `Episode ${init.number}` : 'Untitled draft');
  const blocker = row ? row.blocker : null;
  const mw = masterWords(uploadingNow ? 'uploading' : masterState);
  const banners = (
    <>
      {viewError && <Banner level="danger" icon={<WarningIcon size={16} />} title={viewError} />}
      {blocker && <Banner level="review" icon={<ClockIcon size={16} />} title="Not ready to send yet"><p>{blocker}</p></Banner>}
    </>
  );

  const fileCard = (
    <div className="show-ed-card show-ed-file">
      <span className="show-ed-card-k">The file</span>
      {video ? (
        <div className={`apl-progress ${masterState === 'error' ? 'is-error' : ''}`} aria-live="polite">
          <div className="apl-progress-row">
            <span className="apl-progress-name">{video.name || 'The master'}{video.bytes ? ` · ${bytesLabel(video.bytes)}` : ''}</span>
            <span aria-hidden={uploadingNow ? 'true' : undefined}>{uploadingNow ? `${uploadPct(activeUpload)}%` : masterState === 'ready' ? 'ready ✓' : masterState === 'uploading' ? 'stopped' : masterState === 'error' ? 'failed' : 'processing'}</span>
          </div>
          <div className="apl-bar" role={uploadingNow ? 'progressbar' : undefined} aria-valuemin={uploadingNow ? 0 : undefined} aria-valuemax={uploadingNow ? 100 : undefined} aria-valuenow={uploadingNow ? uploadPct(activeUpload) : undefined} aria-label={uploadingNow ? 'Uploading the file' : undefined}><div className="apl-bar-fill" style={{ width: `${uploadingNow ? uploadPct(activeUpload) : masterState === 'uploading' ? 0 : 100}%` }} /></div>
          <div className="apl-progress-meta">
            <span className={`show-ed-file-state tone-${mw.tone}`}>{masterState === 'ready' ? <CheckIcon size={13} /> : null} {uploadingNow ? 'Uploading — keep this tab open' : masterState === 'uploading' ? 'The upload stopped — pick the same file again to resume' : mw.text}</span>
            {video.runtimeSeconds ? <span>{runtimeClock(video.runtimeSeconds)}</span> : null}
          </div>
        </div>
      ) : draft.form && draft.form.audioUrl ? (
        <p className="show-ed-hint">An audio file from a link{draft.form.audioBytes ? ` · ${bytesLabel(draft.form.audioBytes)}` : ''}.</p>
      ) : (
        <p className="show-ed-hint">No file yet.</p>
      )}
      {fileNote && <p className="show-ed-hint" role="status">{fileNote}</p>}
      <label className={`show-ed-drop ${busyUpload ? 'is-off' : ''}`} role="button" aria-disabled={busyUpload ? 'true' : undefined} {...pickerKeys(busyUpload)} {...fileDrop(pickFile, busyUpload)}>
        <span className="show-ed-drop-icon" aria-hidden="true">↑</span>
        <span className="show-ed-drop-text">
          <strong>{video ? (masterState === 'uploading' && !uploadingNow ? 'Pick the same file to resume' : 'Replace the file') : 'Add the file'}</strong>
          <span>Drop the master here, or browse</span>
        </span>
        <input type="file" accept={VIDEO_ACCEPT} hidden disabled={busyUpload} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pickFile(f); }} />
      </label>
      {video && <p className="show-ed-line">The old file is deleted when a new one takes its place.</p>}
    </div>
  );

  const basics = (
    <>
      {fileCard}
      <TitleField id="dr-title" value={form.title} onChange={(v) => set('title', v)} policy={DIRECT} placeholder={init.number ? `Episode ${init.number}` : 'Title'} edited={edited('title')} />
      <OneLineField id="dr-oneline" value={form.oneLine} onChange={(v) => set('oneLine', v)} policy={DIRECT} edited={edited('description')} />
      {draftIsExtra && (
        <div className="show-ed-field">
          <ExtraKindField
            idPrefix="dr-kind"
            choice={form.extraKindChoice}
            other={form.extraKindOther}
            onChange={(v) => setForm((f) => ({ ...f, extraKindChoice: v.choice, extraKindOther: v.other }))}
          >
            <FieldNote policy={DIRECT} edited={edited('extraKind')} />
          </ExtraKindField>
        </div>
      )}
    </>
  );

  const aboutMax = DESC_MAX - (form.oneLine.trim() ? form.oneLine.trim().length + 2 : 0);
  const moreInfo = (
    <>
      <AboutField id="dr-about" value={form.about} onChange={(v) => set('about', v)} max={aboutMax} policy={DIRECT} edited={edited('description')} />
      <SameAsShow inShow={Boolean(show)} ctx={{ form, set, defaults, showYear: show ? show.year : null, resets, reset, pol, idPrefix: 'dr', titleForAsk: title }} />
      <div className="show-ed-field">
        <FieldHead htmlFor="dr-funding" label="Funding link" hint=" optional" />
        <input id="dr-funding" className="show-ed-input" type="url" inputMode="url" value={form.fundingUrl} placeholder="https://" maxLength={500} onChange={(e) => set('fundingUrl', e.target.value)} />
      </div>
      <div className="show-ed-card show-ed-later">
        <span className="show-ed-card-k">Once it’s sent</span>
        <p className="show-ed-hint">Its own poster and still (it uses {show ? `${show.name}’s` : 'the show’s'} art until then), captions, a trailer, its own page and the credits are added in this editor once the draft is sent for review.</p>
      </div>
      <MoreOptions idPrefix="dr" form={form} set={set} pol={pol} />
    </>
  );

  const placeSection = (
    <>
      <PlaceBlock
        idPrefix="dr-place"
        place={{
          seasons,
          season: curSeason,
          number: form.number,
          wasCode: placeChanged && init.number ? `S${init.season} E${init.number}` : null,
          nextFree: pos ? pos.nextFree : null,
          holder,
          loading: Boolean(seasonPos[curSeason] && seasonPos[curSeason].state === 'loading'),
          policy: DIRECT,
          onSeason: pickSeason,
          onNumber: (v) => set('number', v),
          onSwap: holder && holder.kind === 'draft' && init.number ? () => placeVia('swap') : null,
          onInsert: holder && holder.kind === 'draft' ? () => placeVia('insert') : null,
          busy: busy === 'place',
          isDraft: true
        }}
      />
      <div className="show-ed-field">
        <span className="show-ed-label">Another show</span>
        <button type="button" className="show-ed-link" onClick={openMove}>Move to another show…</button>
      </div>
      <div className="show-ed-remove">
        <button type="button" className="show-ed-danger" disabled={busy === 'discard'} onClick={discard}><TrashIcon size={14} /> Discard this draft…</button>
        <p className="show-ed-hint">Its uploaded file is deleted too.</p>
      </div>
    </>
  );

  const canSave = dirty && !saving && !placeBlocked;
  const canSend = !saving && busy !== 'send' && !placeBlocked && (!row || row.ready !== false) && Boolean(row);
  const footer = (
    <>
      {placeBlocked && <p className="show-ed-foot-note is-warn">E{numberN} is held by an episode — pick another number on Place.</p>}
      {error && <p className="show-ed-error" role="alert">{error}</p>}
      <div className="show-ed-foot-actions has-second">
        <button type="button" className="apl-btn show-ed-primary show-ed-send" disabled={!canSend} onClick={send}>{busy === 'send' ? 'Sending…' : 'Send for review'}</button>
        <div className="show-ed-foot-meta">
          <button type="button" className="apl-btn-secondary show-ed-second show-ed-save-draft" disabled={!canSave} onClick={() => save()}>{saving ? 'Saving…' : summary.count ? 'Save' : 'Saved'}</button>
          <p className="show-ed-status"><i className="tone-neutral" aria-hidden="true" /> Draft{draft.updatedAt ? ` · saved ${shortDate(draft.updatedAt)}` : ''}{blocker ? '' : row && row.ready ? ' · ready to send' : ''}</p>
        </div>
      </div>
    </>
  );

  const sections = [
    { key: 'basics', label: 'Basics', content: basics },
    { key: 'more', label: 'More info', content: moreInfo },
    { key: 'place', label: 'Place', content: placeSection }
  ];
  const backHref = mode === 'admin' ? `/admin/shows/${encodeURIComponent(theShowId)}` : `/creator/show/${encodeURIComponent(theShowId)}`;

  return (
    <>
      {layout !== 'panel' && <Head><title>{`${title} (draft)${show ? ` · ${show.name}` : ''} — ${SITE.name}`}</title><meta name="robots" content="noindex" /></Head>}
      <EditorFrame
        layout={layout}
        rootRef={rootRef}
        backHref={backHref}
        backLabel={show ? show.name : 'The show'}
        onBack={() => !dirty || window.confirm('Leave without saving your changes?')}
        onClose={close}
        eyebrow={[show ? show.name : null, code].filter(Boolean).join(' · ')}
        pill={{ text: 'Draft', tone: 'neutral' }}
        title={title}
        banners={banners}
        sections={sections}
        active={tab}
        onTab={setTab}
        footer={footer}
        toast={<Toast toast={toast} onClose={() => showToast(null)} />}
        ariaLabel={`Edit the draft ${title}`}
        tabsLabel="Draft editor"
      />
      {moveOpen && (
        <MoveSheet
          show={{ id: theShowId, name: show ? show.name : '', kind, seasons }}
          episode={{ id: draft.id, kind: 'draft', title: form.title.trim() || null, displayTitle: title, season: init.season, seriesOrder: Number(init.number) || null, code: init.number ? `S${init.season} E${init.number}` : null, status: 'draft' }}
          myShows={myShows}
          onClose={() => setMoveOpen(false)}
          onMoved={async (result) => {
            showToast({ title: 'Moved', lines: [result.words].filter(Boolean) });
            if (result.toShowId && result.toShowId !== theShowId) {
              if (onSaved) onSaved({ id: draft.id, kind: 'draft' }, { movedTo: result.toShowId });
              if (layout !== 'panel') router.replace(`/creator/show/${encodeURIComponent(result.toShowId)}/episode/${encodeURIComponent(draft.id)}?draft=1`);
              return;
            }
            await reloadDraft({ place: true });
            loadView();
          }}
        />
      )}
    </>
  );
}
