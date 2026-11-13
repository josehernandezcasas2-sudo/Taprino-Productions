import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useUpload } from '../../contexts/UploadContext';
import { MAIN_GENRES } from '../../lib/submitRules';
import { fieldPolicy, fieldPolicyLine, joinDescription, saveSummary, splitDescription } from '../../lib/showRules';
import { SEASON_ART_122_MSG, SEASON_ART_PER_SAVE, seasonArtRows } from '../../lib/seasonArt';
import { SITE } from '../../lib/siteConfig';
import { shrinkArtwork } from '../../lib/shrinkImage';
import { PODCASTS_AD_FREE } from '../../lib/adBreakRules';
import RatingOptions from '../RatingOptions';
import CreditsFields, { creditsFormBody, creditsFormKey, creditsToForm } from './CreditsFields';
import {
  ArtSlot, Banner, EditorFrame, FieldHead, FieldNote, PickButton, SwitchRow, Toast,
  callApi, isOpen, shortDate, uploadPct, uploadRunning, useBeforeUnload, useDirtyReport, useHeaderOffset, useToast
} from './EditorBits';
import { AboutField, NOT_SAVED_WORDS, OneLineField, askHref } from './EpisodeFields';
import { PayeeLine } from './PayeeCard';
import { BackArrowIcon, ClockIcon, CloseIcon, ExternalLinkIcon, InfoIcon, WarningIcon } from '../PlayerIcons';

// Edit show (series revamp slice 2; amendment 13, boards ShowEditor and
// ShowEditorArt): a screen at /creator/show/[id]/edit on a phone, the
// control room's right-hand panel on a laptop (layout 'panel'). Two tabs:
//   Details  the name (it waits for approval once an episode is approved),
//            one line + about (the show's one description), year, funding
//            link, the defaults for episodes added from now on (genre,
//            rating, Who can watch, Made by, ads), the season names, the
//            Studio / Producer credits, "Let channels air the whole show",
//            and the kind while the show is still empty;
//   Art      poster, still, hero image, title image and trailer, each Live,
//            Waiting for approval (Cancel) or None — a podcast has the
//            poster and the still only — and a series' Season art: one
//            16:9 picture per season (migration 122), waiting for approval
//            like the rest once an episode is approved; Details carries
//            the switch that puts the newest released season's art in the
//            hero (it applies at once).
// Reads GET /api/show/[id] and saves with PATCH (lib/showRules.js
// fieldPolicy decides what applies at once and what waits, the same rule
// the route runs); a waiting change is taken back with DELETE …/staged.
//
// Props: { showId, mode: 'creator' | 'admin', layout: 'page' | 'panel',
// tab: 'details' | 'art', onClose(), onSaved(show) }.

const ABOUT_MAX = 2000;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const TITLE_IMAGE_ACCEPT = 'image/png,image/webp';
const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm';
// Every picture rides in Edit show's body as a data URL: they are shrunk
// to what the site draws and kept under the host's 4.5 MB body limit
// together (lib/shrinkImage.js shrinkArtwork; the old 7 MB of files here
// was over that limit, which answered a bare 413).
const ART = [
  { field: 'poster', kind: 'poster', label: 'Poster 2:3', live: 'poster', staged: 'poster', words: 'On cards, rows and the show page.' },
  { field: 'thumbnail', kind: 'still', label: 'Still 16:9', live: 'thumbnail', staged: 'thumbnail', words: 'Behind the show in rows and on the episode strip.' },
  { field: 'heroImage', kind: 'hero', label: 'Hero image', live: 'heroImage', staged: 'heroImage', words: 'The wide picture behind the name at the top of the show page.', notPodcast: true },
  { field: 'titleImage', kind: 'title', label: 'Title image · PNG', live: 'titleImageUrl', staged: 'titleImageUrl', words: 'The name set as a picture, shown on the art.', notPodcast: true }
];

function seasonsOfView(view) {
  const labels = {};
  for (const l of view.show.seasonLabels || []) labels[Number(l.number)] = l.name || '';
  const nums = [...new Set([...(view.seasons || []).map((s) => Number(s.number)), ...Object.keys(labels).map(Number)])].filter(Boolean).sort((a, b) => a - b);
  return nums.map((n) => ({ number: n, name: labels[n] || '' }));
}

function showForm(view) {
  const s = view.show;
  const d = splitDescription(s.description || '');
  const defs = s.defaults || {};
  return {
    name: s.name || '',
    oneLine: d.oneLine,
    about: d.about,
    releaseYear: s.year ? String(s.year) : '',
    fundingUrl: s.fundingUrl || '',
    channelOptIn: Boolean(s.channelOptIn),
    kind: s.kind === 'podcast' ? 'podcast' : 'series',
    mainGenre: defs.mainGenre || '',
    genre: defs.genre || '',
    rating: defs.rating || '',
    tier: defs.tier || '',
    artist: defs.artist || '',
    adsEnabled: defs.adsEnabled !== false,
    seasons: seasonsOfView(view),
    credits: creditsToForm(s.credits, { inherit: false }),
    newestSeasonHero: s.newestSeasonHero !== false
  };
}

// The Season art rows (lib/seasonArt.js): every season the show has, with
// its saved words, what is live and what waits.
function seasonArtOfView(view) {
  const s = view.show;
  return seasonArtRows({
    seasons: seasonsOfView(view).map((x) => ({ number: x.number, label: x.name ? `Season ${x.number} · ${x.name}` : `Season ${x.number}` })),
    live: (s.art && s.art.seasonArt) || [],
    pending: (s.staged && s.staged.seasonArt) || []
  });
}

// What a change to the show does now: the same fieldPolicy the route runs.
function policyCtx(view) {
  const rows = (view.seasons || []).flatMap((s) => s.rows || []);
  const eps = rows.filter((r) => r.kind === 'episode');
  return {
    target: 'show',
    isAdmin: Boolean(view.viewer && view.viewer.teamEdits),
    isRunner: Boolean(view.viewer && view.viewer.isOwner),
    status: view.show.status || 'approved',
    held: Boolean(view.show.held),
    deletionRequested: Boolean(view.show.deletion && view.show.deletion.requested),
    approvedEpisodes: eps.filter((r) => r.status === 'approved').length,
    episodeCount: eps.filter((r) => r.inRunningOrder !== false).length + Number((view.counts && view.counts.drafts) || 0)
  };
}

const LEVEL_TONE = { ok: 'ok', review: 'review', warn: 'warn', neutral: 'neutral' };

export default function ShowEditor(props) {
  const { showId, layout = 'page', onClose } = props;
  const [state, setState] = useState({ phase: 'loading' });
  const load = useCallback(async () => {
    const r = await callApi('GET', `/api/show/${encodeURIComponent(showId)}`);
    setState(r.ok ? { phase: 'ready', view: r.data } : { phase: 'error', status: r.status, error: r.error });
  }, [showId]);
  useEffect(() => {
    setState({ phase: 'loading' });
    load();
  }, [load]);
  if (state.phase === 'ready') return <ShowEditorReady key={showId} {...props} initial={state.view} />;
  const panel = layout === 'panel';
  return (
    <div className={`show-ed ${panel ? 'is-panel' : 'is-page'} is-waiting`} aria-busy={state.phase === 'loading' ? 'true' : undefined}>
      {!panel && <Link href={`/creator/show/${encodeURIComponent(showId)}`} className="acct-back show-ed-back"><BackArrowIcon size={14} /> The show</Link>}
      {panel && onClose && <button type="button" className="show-ed-close is-floating" aria-label="Close the editor" onClick={onClose}><CloseIcon size={16} /></button>}
      {state.phase === 'loading' ? (
        <div className="show-ed-skeleton" aria-label="Loading the show"><span /><span /><span /></div>
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

function ShowEditorReady({ showId, mode = 'creator', layout = 'page', tab: startTab = 'details', onClose, onSaved, onDirtyChange, initial }) {
  const rootRef = useRef(null);
  useHeaderOffset(rootRef);
  const { activeUpload, startVideoUpload, setQueueHost } = useUpload();
  const [view, setView] = useState(initial);
  const show = view.show;
  const viewer = view.viewer || {};
  const ctx = useMemo(() => policyCtx(view), [view]);
  const pol = useCallback((field) => {
    const m = fieldPolicy(field, ctx);
    return { mode: m, line: m === 'direct' ? null : fieldPolicyLine(field, ctx) };
  }, [ctx]);
  const podcast = show.kind === 'podcast';
  // Edit show calls a series and a podcast alike "show" (the boards' words:
  // "Edit show", "Changing a live show's name…").
  const noun = 'show';
  const has118 = !view.migration || view.migration.shows118 !== false;
  // Season art and the newest-season switch need migration 122.
  const has122 = Boolean(view.migration && view.migration.series122 === true);
  const canEdit = Boolean(viewer.canEditShow);
  // Taking back a waiting change is the owner's: the team decides it under
  // Waiting for approval on the admin page, where Deny tells the owner.
  const canCancel = Boolean(viewer.isOwner);

  const [form, setForm] = useState(() => showForm(initial));
  const [init, setInit] = useState(() => showForm(initial));
  const [files, setFiles] = useState({ poster: null, thumbnail: null, heroImage: null, titleImage: null });
  const [removeTitle, setRemoveTitle] = useState(false);
  // Season art picked here and not saved yet: { [number]: File | 'remove' }.
  const [seasonPicks, setSeasonPicks] = useState({});
  const [trailerUp, setTrailerUp] = useState(null);
  const [tab, setTab] = useState(startTab === 'art' ? 'art' : 'details');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [toast, showToast] = useToast();

  const set = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);
  const applyView = useCallback((v) => {
    setView(v);
    const f = showForm(v);
    setForm(f);
    setInit(f);
    setFiles({ poster: null, thumbnail: null, heroImage: null, titleImage: null });
    setRemoveTitle(false);
    setSeasonPicks({});
    setTrailerUp(null);
  }, []);
  const reload = useCallback(async () => {
    const r = await callApi('GET', `/api/show/${encodeURIComponent(show.id)}`);
    if (r.ok) setView(r.data);
    return r;
  }, [show.id]);

  const computed = useMemo(() => {
    const body = {};
    const changes = [];
    const add = (field, key, value, policyField) => {
      body[key] = value;
      changes.push({ field, mode: pol(policyField || field).mode });
    };
    if (form.name.trim() !== init.name.trim()) add('name', 'name', form.name.trim());
    const desc = joinDescription(form.oneLine, form.about);
    if (desc !== joinDescription(init.oneLine, init.about)) add('description', 'description', desc);
    if (form.releaseYear.trim() !== init.releaseYear.trim()) add('releaseYear', 'releaseYear', form.releaseYear.trim() || null);
    if (form.fundingUrl.trim() !== init.fundingUrl.trim()) add('fundingUrl', 'fundingUrl', form.fundingUrl.trim());
    if (form.channelOptIn !== init.channelOptIn) add('channelOptIn', 'channelOptIn', form.channelOptIn);
    if (form.kind !== init.kind) add('kind', 'kind', form.kind);
    const defaults = {};
    for (const key of ['mainGenre', 'genre', 'rating', 'tier', 'artist']) if (String(form[key]).trim() !== String(init[key]).trim()) defaults[key] = String(form[key]).trim();
    if (form.adsEnabled !== init.adsEnabled) defaults.adsEnabled = form.adsEnabled;
    if (Object.keys(defaults).length) add('defaults', 'defaults', defaults);
    const seasons = form.seasons.map((s) => ({ number: s.number, name: s.name.trim() })).filter((s) => s.name);
    const seasonsBefore = init.seasons.map((s) => ({ number: s.number, name: s.name.trim() })).filter((s) => s.name);
    if (JSON.stringify(seasons) !== JSON.stringify(seasonsBefore)) add('seasons', 'seasons', seasons);
    if (creditsFormKey(form.credits) !== creditsFormKey(init.credits)) add('credits', 'credits', creditsFormBody(form.credits));
    if (form.newestSeasonHero !== init.newestSeasonHero) add('newestSeasonHero', 'newestSeasonHero', form.newestSeasonHero);
    for (const n of Object.keys(seasonPicks)) changes.push({ field: 'seasonArt', mode: pol('seasonArt').mode, season: Number(n) });
    for (const f of ['poster', 'thumbnail', 'heroImage', 'titleImage']) if (files[f]) changes.push({ field: f, mode: pol(f).mode });
    if (removeTitle) changes.push({ field: 'titleImageRemoval', mode: pol('titleImage').mode });
    if (trailerUp && trailerUp.state === 'uploaded') {
      body.trailerUid = trailerUp.uid;
      changes.push({ field: 'trailer', mode: pol('trailer').mode });
    }
    return { body, changes };
  }, [form, init, files, removeTitle, seasonPicks, trailerUp, pol]);
  const summary = saveSummary(computed.changes);
  const dirty = computed.changes.length > 0 || Boolean(trailerUp && trailerUp.state === 'uploading');
  useBeforeUnload(dirty);
  useDirtyReport(dirty, onDirtyChange);
  const edited = (field) => computed.changes.some((c) => c.field === field);

  async function save({ resubmit = false } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const body = { ...computed.body };
    const seasonList = Object.entries(seasonPicks).map(([n, pick]) => ({ number: Number(n), pick }));
    if (seasonList.length > SEASON_ART_PER_SAVE) {
      setSaving(false);
      setError(`Up to ${SEASON_ART_PER_SAVE} seasons’ art in one save — save these, then the rest.`);
      return;
    }
    try {
      const art = await shrinkArtwork([
        ...['poster', 'thumbnail', 'heroImage', 'titleImage'].map((f) => ({ key: f, file: files[f] || null, keepAlpha: f === 'titleImage', max: f === 'heroImage' ? 2400 : 2000 })),
        ...seasonList.filter((x) => x.pick && x.pick !== 'remove').map(({ number, pick }) => ({ key: `season-${number}`, file: pick, max: 2400 }))
      ]);
      for (const f of ['poster', 'thumbnail', 'heroImage', 'titleImage']) {
        if (!files[f]) continue;
        body[`${f}Base64`] = art[f];
        body[`${f}FileName`] = files[f].name;
      }
      if (seasonList.length) {
        body.seasonArt = [];
        for (const { number, pick } of seasonList) {
          body.seasonArt.push(pick === 'remove' ? { number, remove: true } : { number, imageBase64: art[`season-${number}`], fileName: pick.name });
        }
      }
    } catch (err) {
      setSaving(false);
      setError(err.message);
      return;
    }
    if (removeTitle) body.removeTitleImage = true;
    if (resubmit) body.resubmit = true;
    const r = await callApi('PATCH', `/api/show/${encodeURIComponent(show.id)}`, body);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      if (r.data && r.data.field && layout !== 'panel') setTab(['poster', 'thumbnail', 'heroImage', 'titleImage', 'trailer', 'seasonArt'].includes(r.data.field) ? 'art' : 'details');
      return;
    }
    applyView(r.data.view);
    const lines = [...(r.data.notices || [])];
    for (const ns of r.data.notSaved || []) lines.push(`Not saved — ${NOT_SAVED_WORDS[ns.field] || ns.field}: ${ns.reason}`);
    const stagedN = (r.data.staged || []).length;
    showToast({
      tone: (r.data.notSaved || []).length ? 'warn' : 'ok',
      title: r.data.unchanged ? 'Nothing to save' : resubmit ? 'Sent again — it’s not public yet' : stagedN ? `Saved — ${stagedN === 1 ? '1 change waits' : `${stagedN} changes wait`} for approval` : 'Saved',
      lines
    });
    if (onSaved) onSaved(r.data.view.show, { applied: r.data.applied || [], staged: r.data.staged || [] });
  }

  async function cancelStaged(field) {
    setBusy(`cancel-${field}`);
    setError(null);
    const r = await callApi('DELETE', `/api/show/${encodeURIComponent(show.id)}/staged?field=${encodeURIComponent(field)}`);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    showToast({ title: 'Taken back', lines: ['What was live stays live.'] });
    await reload();
  }

  // One season's waiting art, taken back.
  async function cancelSeasonStaged(number) {
    setBusy(`cancel-season-${number}`);
    setError(null);
    const r = await callApi('DELETE', `/api/show/${encodeURIComponent(show.id)}/staged?field=seasonArt&season=${encodeURIComponent(number)}`);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    showToast({ title: 'Taken back', lines: ['What was live stays live.'] });
    await reload();
  }

  async function cancelRemoval() {
    setBusy('removal');
    const r = await callApi('POST', `/api/show/${encodeURIComponent(show.id)}/removal`, { action: 'cancel' });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    showToast({ title: 'Removal cancelled' });
    const g = await reload();
    if (g.ok) applyView(g.data);
  }

  const busyUpload = uploadRunning(activeUpload);
  const trailerUploading = Boolean(trailerUp && activeUpload && activeUpload.uid === trailerUp.uid && busyUpload);
  // The screen draws its own uploads (the trailer slot), so
  // the corner widget stays off them — and off this footer's Save — as on
  // the show page: they ride with the show (`queue`), whose page this is.
  useEffect(() => {
    if (layout === 'panel' || !setQueueHost) return undefined;
    setQueueHost(show.id);
    return () => setQueueHost(null);
  }, [layout, show.id, setQueueHost]);
  async function pickTrailer(file) {
    if (!file) return;
    if (busyUpload) {
      setError('Another upload is running — drop the trailer once it has finished.');
      return;
    }
    try {
      const started = await startVideoUpload(file, { urlEndpoint: `/api/creator/get-upload-url?seriesId=${encodeURIComponent(show.id)}`, kind: 'trailer', queue: { showId: show.id, showName: show.name } });
      setTrailerUp({ uid: started.uid, name: file.name, state: 'uploading' });
      started.done
        .then(() => setTrailerUp((t) => (t && t.uid === started.uid ? { ...t, state: 'uploaded' } : t)))
        .catch(() => setTrailerUp((t) => (t && t.uid === started.uid ? { ...t, state: 'stopped' } : t)));
    } catch (err) {
      setError((err && err.message) || 'Could not start the trailer upload.');
    }
  }

  function close() {
    if (dirty && !window.confirm('Leave without saving your changes?')) return;
    if (onClose) onClose();
  }

  // --- banners -----------------------------------------------------------------
  const st = show.staged || {};
  const stagedList = [
    st.name ? { field: 'name', words: `the name “${st.name}”` } : null,
    st.description ? { field: 'description', words: 'an edited description' } : null,
    st.poster ? { field: 'poster', words: 'the poster' } : null,
    st.thumbnail ? { field: 'thumbnail', words: 'the still' } : null,
    st.heroImage ? { field: 'heroImage', words: 'the hero image' } : null,
    st.titleImageUrl || st.titleImageRemoval ? { field: 'titleImage', words: st.titleImageRemoval ? 'removing the title image' : 'the title image' } : null,
    st.trailer ? { field: 'trailer', words: 'the trailer' } : null,
    ...(Array.isArray(st.seasonArt) ? st.seasonArt : []).map((w) => ({ field: `seasonArt-${w.number}`, season: w.number, words: w.image ? `the Season ${w.number} art` : `removing the Season ${w.number} art` }))
  ].filter(Boolean);
  const declined = show.status === 'rejected' && !show.held;
  const banners = (
    <>
      {!canEdit && <Banner level="neutral" icon={<InfoIcon size={16} />} title={`Only ${show.ownerName || 'the show’s owner'} can change the ${noun}.`} />}
      {show.held && (
        <Banner level="danger" icon={<WarningIcon size={16} />} title={`Pulled by an admin${show.holdReason ? `: ${show.holdReason}` : ''}`}>
          <p className="show-ed-banner-sub">Nothing about the {noun} can change while an admin looks at it. <a href={askHref(`Pulled: ${show.name}`)}>Email us</a></p>
        </Banner>
      )}
      {show.deletion && show.deletion.requested && (
        <Banner
          level="neutral"
          title={`Removal requested${show.deletion.at ? ` on ${shortDate(show.deletion.at)}` : ''}`}
          action={viewer.isOwner || viewer.isAdmin ? <button type="button" className="show-ed-cancel" disabled={busy === 'removal'} onClick={cancelRemoval}>{busy === 'removal' ? '…' : 'Cancel'}</button> : null}
        >
          {show.deletion.reason ? <p>{show.deletion.reason}</p> : null}
          <p className="show-ed-banner-sub">The {noun} is off the site while it waits; nothing can change until the request is cancelled.</p>
        </Banner>
      )}
      {declined && (
        <Banner
          level="warn"
          icon={<WarningIcon size={16} />}
          title={`An admin declined this ${noun}`}
          action={canEdit ? <button type="button" className="apl-btn-secondary show-ed-banner-btn" disabled={saving || Boolean(trailerUp && trailerUp.state === 'uploading')} title={trailerUp && trailerUp.state === 'uploading' ? 'The trailer is still uploading — resubmit once it’s up.' : undefined} onClick={() => save({ resubmit: true })}>{saving ? 'Sending…' : 'Resubmit'}</button> : null}
        >
          {show.decisionNote ? <p>{show.decisionNote}</p> : null}
          <p className="show-ed-banner-sub">Fix what it needs and press Resubmit; it comes back as not public yet.</p>
        </Banner>
      )}
      {stagedList.length > 0 && (
        <Banner level="review" icon={<ClockIcon size={16} />} title="Changes awaiting review:">
          <ul className="show-ed-banner-list">
            {stagedList.map((s) => {
              const key = s.season ? `cancel-season-${s.season}` : `cancel-${s.field}`;
              return (
                <li key={s.field}>
                  <span>{s.words}</span>
                  {canCancel && <button type="button" className="show-ed-cancel" disabled={busy === key} onClick={() => (s.season ? cancelSeasonStaged(s.season) : cancelStaged(s.field))}>{busy === key ? '…' : 'Cancel'}</button>}
                </li>
              );
            })}
          </ul>
          {!canCancel && mode === 'admin' ? <p className="show-ed-banner-sub">Approve or deny these under Waiting for approval on the show page.</p> : null}
        </Banner>
      )}
      {!has118 && <Banner level="neutral" title="The defaults, the season names, the credits and the kind wait for a database update (migration 118)." />}
    </>
  );

  // --- Details ------------------------------------------------------------------
  const namePolicy = canEdit ? pol('name') : { mode: 'locked', line: 'Only the show’s owner can change this' };
  const lockAll = (field) => (canEdit ? pol(field) : namePolicy);
  const aboutMax = ABOUT_MAX - (form.oneLine.trim() ? form.oneLine.trim().length + 2 : 0);
  const defaultsPolicy = has118 ? lockAll('defaults') : { mode: 'locked', line: 'Needs a database update (migration 118).' };
  const seasonsPolicy = has118 ? lockAll('seasons') : { mode: 'locked', line: 'Needs a database update (migration 118).' };
  const creditsPolicy = has118 ? lockAll('credits') : { mode: 'locked', line: 'Needs a database update (migration 118).' };
  const kindPolicy = has118 ? lockAll('kind') : { mode: 'locked', line: 'Needs a database update (migration 118).' };
  const heroSwitchPolicy = has122 ? lockAll('newestSeasonHero') : { mode: 'locked', line: SEASON_ART_122_MSG };
  const seasonArtPolicy = has122 ? lockAll('seasonArt') : { mode: 'locked', line: SEASON_ART_122_MSG };
  const makerLine = (show.creditLines || []).find((l) => l.key === 'maker');

  // Who gets paid (slice 3b): the line, and the way to the show page's
  // card — over the room, the panel closes onto it.
  const payeeHref = `${mode === 'admin' ? '/admin/shows' : '/creator/show'}/${encodeURIComponent(show.id)}#show-payee`;
  const toPayeeCard = (e) => {
    if (dirty && !window.confirm('Leave without saving your changes?')) {
      e.preventDefault();
      return;
    }
    if (layout !== 'panel' || !onClose) return;
    e.preventDefault();
    onClose();
    // The room under the panel (or the room page this editor's address
    // goes back to) draws the card once the panel is gone: wait for it.
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const el = document.getElementById('show-payee');
      const panelGone = !document.querySelector('.show-ed.is-panel');
      if ((el && panelGone) || tries > 60) {
        clearInterval(timer);
        if (!el || !panelGone) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const btn = el.querySelector('button:not([disabled]), a[href]');
        if (btn) btn.focus({ preventScroll: true });
      }
    }, 150);
  };

  const details = (
    <>
      {view.payee && view.payee.line ? (
        <div className="show-ed-card show-ed-paid-card">
          <PayeeLine payee={view.payee} className="show-ed-paid" />
          <Link className="apl-link show-ed-paid-link" href={payeeHref} onClick={toPayeeCard}>Change it under Who gets paid →</Link>
        </div>
      ) : null}
      <div className="show-ed-field">
        <FieldHead htmlFor="sh-name" label="Name" staged={namePolicy.mode === 'staged'} locked={namePolicy.mode === 'locked'} count={form.name.length} max={form.name.length > 90 ? 120 : null} />
        <input id="sh-name" className="show-ed-input is-title" type="text" value={form.name} maxLength={120} disabled={!isOpen(namePolicy)} onChange={(e) => set('name', e.target.value)} />
        {namePolicy.mode === 'staged' && <p className="show-ed-line">Changing a live {noun}’s name goes to us first.</p>}
        {st.name ? (
          <div className="show-ed-staged">
            <div className="show-ed-staged-text"><span className="show-ed-staged-k">Waiting for approval:</span><strong>{st.name}</strong></div>
            {canCancel && <button type="button" className="show-ed-cancel" disabled={busy === 'cancel-name'} onClick={() => cancelStaged('name')}>{busy === 'cancel-name' ? '…' : 'Cancel'}</button>}
          </div>
        ) : null}
        <FieldNote policy={namePolicy.mode === 'staged' ? null : namePolicy} edited={edited('name') && namePolicy.mode !== 'staged'} />
      </div>
      <OneLineField id="sh-oneline" value={form.oneLine} onChange={(v) => set('oneLine', v)} policy={lockAll('description')} edited={edited('description')} />
      <AboutField id="sh-about" value={form.about} onChange={(v) => set('about', v)} max={aboutMax} policy={lockAll('description')} edited={edited('description')} placeholder={`Everything else about the ${noun}.`} />
      <div className="apl-grid2 show-ed-grid2 show-ed-year-row">
        <div className="show-ed-field">
          <FieldHead htmlFor="sh-year" label="Year" />
          <input id="sh-year" className="show-ed-input" type="text" inputMode="numeric" maxLength={4} value={form.releaseYear} placeholder={String(new Date().getFullYear())} disabled={!isOpen(lockAll('releaseYear'))} onChange={(e) => set('releaseYear', e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div className="show-ed-field">
          <FieldHead htmlFor="sh-funding" label="Funding link" hint=" optional" />
          <input id="sh-funding" className="show-ed-input" type="url" inputMode="url" maxLength={500} value={form.fundingUrl} placeholder="https://" disabled={!isOpen(lockAll('fundingUrl'))} onChange={(e) => set('fundingUrl', e.target.value)} />
        </div>
      </div>

      {(kindPolicy.mode === 'direct' || form.kind !== init.kind) && (
        <div className="show-ed-field">
          <span className="show-ed-label" id="sh-kind-k">What it is</span>
          <div className="apl-pills" role="radiogroup" aria-labelledby="sh-kind-k">
            {['series', 'podcast'].map((k) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k ? 'true' : 'false'} className={`apl-pill ${form.kind === k ? 'on' : ''}`} disabled={!isOpen(kindPolicy)} onClick={() => set('kind', k)}>{k === 'podcast' ? 'Podcast' : 'Series'}</button>
            ))}
          </div>
          <p className="show-ed-hint">Set once it has episodes.</p>
        </div>
      )}

      <div className="show-ed-card show-ed-defaults">
        <p className="show-ed-defaults-head"><strong>Defaults</strong> · applies to episodes added from now on</p>
        <div className="show-ed-field">
          <span className="show-ed-label" id="sh-genre-k">Genre</span>
          <div className="apl-pills" role="radiogroup" aria-labelledby="sh-genre-k">
            {MAIN_GENRES.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={form.mainGenre === g ? 'true' : 'false'} className={`apl-pill ${form.mainGenre === g ? 'on' : ''}`} disabled={!isOpen(defaultsPolicy)} onClick={() => set('mainGenre', form.mainGenre === g ? '' : g)}>{g}</button>
            ))}
          </div>
        </div>
        <div className="show-ed-field">
          <FieldHead htmlFor="sh-subgenre" label="Specific genre" hint=" optional" />
          <input id="sh-subgenre" className="show-ed-input" type="text" maxLength={60} value={form.genre} placeholder="e.g. Cosmic Horror" disabled={!isOpen(defaultsPolicy)} onChange={(e) => set('genre', e.target.value)} />
        </div>
        <div className="show-ed-field">
          <FieldHead htmlFor="sh-rating" label="Rating" />
          <select id="sh-rating" className="show-ed-select" value={form.rating} disabled={!isOpen(defaultsPolicy)} onChange={(e) => set('rating', e.target.value)}>
            <option value="">Not set (treated as 17+)</option>
            <RatingOptions />
          </select>
        </div>
        <div className="show-ed-field">
          <span className="show-ed-label" id="sh-tier-k">Who can watch</span>
          <div className="apl-pills" role="radiogroup" aria-labelledby="sh-tier-k">
            {/* A podcast carries no ads of ours (lib/adBreakRules.js). */}
            {[['free', podcast ? 'Free' : 'Free with ads'], ['premium', SITE.premiumTier]].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={form.tier === v ? 'true' : 'false'} className={`apl-pill ${form.tier === v ? 'on' : ''}`} disabled={!isOpen(defaultsPolicy)} onClick={() => set('tier', v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="show-ed-field">
          <FieldHead htmlFor="sh-artist" label={podcast ? 'Hosted by' : 'Made by'} />
          <input id="sh-artist" className="show-ed-input" type="text" maxLength={120} value={form.artist} placeholder={show.ownerName || 'Your name, as credited'} disabled={!isOpen(defaultsPolicy)} onChange={(e) => set('artist', e.target.value)} />
        </div>
        {podcast
          ? <p className="show-ed-hint">{PODCASTS_AD_FREE} No ad of ours plays in an episode; a sponsor read in your own audio is yours.</p>
          : <SwitchRow id="sh-ads" title="Ads between scenes" on={form.adsEnabled} onChange={(v) => set('adsEnabled', v)} disabled={!isOpen(defaultsPolicy)} />}
        <p className="show-ed-hint show-ed-defaults-note"><InfoIcon size={13} /> Episodes already added keep their own rating and who can watch.</p>
        <FieldNote policy={defaultsPolicy} edited={edited('defaults')} />
      </div>

      {form.seasons.length > 0 && (
        <div className="show-ed-field show-ed-seasons">
          <span className="show-ed-label">Season names</span>
          {form.seasons.map((s, i) => (
            <div className="show-ed-season-row" key={s.number}>
              <label htmlFor={`sh-season-${s.number}`}>Season {s.number}</label>
              <input id={`sh-season-${s.number}`} className="show-ed-input" type="text" maxLength={80} value={s.name} placeholder="Optional name" disabled={!isOpen(seasonsPolicy)} onChange={(e) => setForm((f) => ({ ...f, seasons: f.seasons.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} />
            </div>
          ))}
          {(() => {
            const named = form.seasons.find((s) => s.name.trim());
            return <p className="show-ed-hint">{named ? `The show page reads “Season ${named.number} · ${named.name.trim()}”.` : 'A name shows beside the number: “Season 2 · The Return”.'}</p>;
          })()}
          <FieldNote policy={seasonsPolicy} edited={edited('seasons')} />
        </div>
      )}

      <div className="show-ed-card">
        <span className="show-ed-card-k">Credits</span>
        <CreditsFields idPrefix="sh-credits" value={form.credits} onChange={(v) => set('credits', v)} makerName={form.artist.trim() || (makerLine ? makerLine.name : null) || show.ownerName || null} makerLabel={podcast ? 'Hosted by' : 'Made by'} policy={creditsPolicy} />
      </div>

      <div className="show-ed-card">
        <SwitchRow id="sh-channels" title={`Let channels air the whole ${noun}`} on={form.channelOptIn} onChange={(v) => set('channelOptIn', v)} disabled={!isOpen(lockAll('channelOptIn'))} policy={lockAll('channelOptIn').mode === 'locked' ? lockAll('channelOptIn') : null}>
          TapaTV can schedule every episode live, with ads.
        </SwitchRow>
      </div>

      {!podcast && (
        <div className="show-ed-card">
          <SwitchRow id="sh-season-hero" title="Use the newest season’s art as the hero" on={form.newestSeasonHero} onChange={(v) => set('newestSeasonHero', v)} disabled={!isOpen(heroSwitchPolicy)} policy={heroSwitchPolicy.mode === 'locked' ? heroSwitchPolicy : null}>
            When a new season goes public with its own art (Art → Season art), that picture becomes the show’s hero; off, the show’s own hero image stays.
          </SwitchRow>
        </div>
      )}
    </>
  );

  // --- Art ---------------------------------------------------------------------
  const anyArtStaged = Boolean(st.poster || st.thumbnail || st.heroImage || st.titleImageUrl || st.titleImageRemoval || st.trailer || (Array.isArray(st.seasonArt) && st.seasonArt.length > 0));
  const seasonRows = seasonArtOfView(view);
  const pickSeason = (number, pick) => setSeasonPicks((x) => ({ ...x, [number]: pick }));
  const undoSeason = (number) => setSeasonPicks((x) => {
    const next = { ...x };
    delete next[number];
    return next;
  });
  const artPolicyStaged = canEdit && pol('poster').mode === 'staged';
  const art = show.art || {};
  const artTab = (
    <>
      {artPolicyStaged && <p className="show-ed-legend"><ClockIcon size={13} /> New art on a live {noun} goes to us first; the current art stays until we approve it.</p>}
      {ART.filter((a) => !(podcast && a.notPodcast)).map((a) => {
        const p = canEdit ? pol(a.field) : namePolicy;
        const live = art[a.live] || null;
        const staged = a.field === 'titleImage' ? st.titleImageUrl || null : st[a.staged] || null;
        const picked = files[a.field];
        const removing = a.field === 'titleImage' && removeTitle;
        const waitingRemoval = a.field === 'titleImage' && st.titleImageRemoval;
        const status = picked || removing ? 'new' : staged || waitingRemoval ? 'waiting' : live ? 'live' : 'none';
        return (
          <ArtSlot
            key={a.field}
            kind={a.kind}
            label={a.label}
            status={status}
            policy={p}
            live={live}
            picked={picked}
            removing={removing}
            pickedNote={picked || removing ? (p.mode === 'staged' ? 'Goes to review when you save' : 'Applies when you save') : null}
            // A new pick (or a removal) shows itself, not the one waiting.
            staged={picked || removing ? null : staged}
            stagedNote={`Visitors see the live ${a.label.split(' ')[0].toLowerCase()} until we approve this one.`}
            onCancelStaged={canCancel ? () => cancelStaged(a.field) : null}
            cancelBusy={busy === `cancel-${a.field}`}
            emptyTitle={removing ? 'Removed when you save' : waitingRemoval ? 'Removal waits for approval' : a.field === 'heroImage' ? 'No hero image yet' : 'None'}
            emptyText={a.words}
            caption={live ? a.words : null}
            actions={isOpen(p) ? (
              <>
                <PickButton label={live || picked ? 'Replace' : 'Upload'} accept={a.field === 'titleImage' ? TITLE_IMAGE_ACCEPT : IMAGE_ACCEPT} onPick={(f) => { setFiles((x) => ({ ...x, [a.field]: f })); if (a.field === 'titleImage') setRemoveTitle(false); }} />
                {picked || removing ? (
                  <button type="button" className="show-ed-mini" onClick={() => { setFiles((x) => ({ ...x, [a.field]: null })); if (a.field === 'titleImage') setRemoveTitle(false); }}>Undo</button>
                ) : a.field === 'titleImage' && live && !waitingRemoval ? (
                  <button type="button" className="show-ed-mini" onClick={() => setRemoveTitle(true)}>Remove</button>
                ) : null}
              </>
            ) : null}
          />
        );
      })}
      {!podcast && (
        <div className="show-ed-card show-ed-trailer">
          <div className="show-ed-art-head">
            <span className="show-ed-label">{pol('trailer').mode === 'staged' && <ClockIcon size={12} />}<span>Trailer</span></span>
            {trailerUp ? (
              <span className="show-ed-pill tone-review">{trailerUploading ? `Uploading ${uploadPct(activeUpload)}%` : trailerUp.state === 'uploaded' ? (pol('trailer').mode === 'staged' ? 'Goes to review' : 'Not saved yet') : 'Stopped'}</span>
            ) : st.trailer ? <span className="show-ed-pill tone-review">Waiting for approval</span> : art.trailer ? <span className="show-ed-pill tone-ok">Live</span> : <span className="show-ed-pill tone-neutral">None</span>}
          </div>
          {trailerUp ? (
            <div className="apl-progress" aria-live="polite">
              <div className="apl-progress-row"><span className="apl-progress-name">{trailerUp.name}</span><span aria-hidden={trailerUploading ? 'true' : undefined}>{trailerUploading ? `${uploadPct(activeUpload)}%` : trailerUp.state === 'uploaded' ? 'uploaded ✓' : 'stopped'}</span></div>
              <div className="apl-bar" role={trailerUploading ? 'progressbar' : undefined} aria-valuemin={trailerUploading ? 0 : undefined} aria-valuemax={trailerUploading ? 100 : undefined} aria-valuenow={trailerUploading ? uploadPct(activeUpload) : undefined} aria-label={trailerUploading ? 'Uploading the trailer' : undefined}><div className="apl-bar-fill" style={{ width: `${trailerUploading ? uploadPct(activeUpload) : trailerUp.state === 'uploaded' ? 100 : 0}%` }} /></div>
              <div className="apl-progress-meta">
                <span>{trailerUp.state === 'uploaded' ? 'It plays on the show page once it’s ready.' : trailerUp.state === 'stopped' ? 'The upload stopped — drop it again.' : 'Keep this tab open until it’s up.'}</span>
                <button type="button" className="apl-link" onClick={() => setTrailerUp(null)}>Not this one</button>
              </div>
            </div>
          ) : st.trailer ? (
            <div className="show-ed-staged">
              <div className="show-ed-staged-text"><span className="show-ed-staged-k">A new trailer waits for approval</span><span className="show-ed-staged-live">The {art.trailer ? 'current one keeps playing' : 'show page shows its art'} until then.</span></div>
              {canCancel && <button type="button" className="show-ed-cancel" disabled={busy === 'cancel-trailer'} onClick={() => cancelStaged('trailer')}>{busy === 'cancel-trailer' ? '…' : 'Cancel'}</button>}
            </div>
          ) : (
            <p className="show-ed-hint">{art.trailer ? 'It plays behind the name at the top of the show page.' : 'A short clip, 15–30 seconds, behind the name at the top of the show page.'}</p>
          )}
          {isOpen(canEdit ? pol('trailer') : namePolicy) && !trailerUp ? <PickButton label={art.trailer || st.trailer ? 'Replace the trailer' : 'Add a trailer'} accept={VIDEO_ACCEPT} disabled={busyUpload} onPick={pickTrailer} className="show-ed-slot" /> : null}
          <FieldNote policy={canEdit ? (pol('trailer').mode === 'staged' ? null : pol('trailer')) : namePolicy} />
        </div>
      )}
      {!podcast && (
        <div className="show-ed-card show-ed-season-art">
          <div className="show-ed-art-head">
            <span className="show-ed-label">{seasonArtPolicy.mode === 'staged' && <ClockIcon size={12} />}<span>Season art</span></span>
          </div>
          <p className="show-ed-hint">
            One 16:9 picture per season.{' '}
            {form.newestSeasonHero ? 'While “Use the newest season’s art as the hero” is on (Details), the newest released season’s picture is the show’s hero.' : 'The newest-season hero is off (Details): these wait for when you turn it on.'}
          </p>
          {!has122 ? (
            <FieldNote policy={seasonArtPolicy} />
          ) : seasonRows.length === 0 ? (
            <p className="show-ed-hint">Seasons show up here once the show has episodes.</p>
          ) : seasonRows.map((row) => {
            const pick = seasonPicks[row.number];
            const picked = pick && pick !== 'remove' ? pick : null;
            const removing = pick === 'remove';
            const p = canEdit ? seasonArtPolicy : namePolicy;
            const status = picked || removing ? 'new' : row.staged || row.removal ? 'waiting' : row.live ? 'live' : 'none';
            return (
              <ArtSlot
                key={row.number}
                kind="still"
                label={row.label}
                status={status}
                policy={p}
                live={row.live}
                picked={picked}
                removing={removing}
                pickedNote={picked || removing ? (p.mode === 'staged' ? 'Goes to review when you save' : 'Applies when you save') : null}
                staged={picked || removing ? null : row.staged}
                stagedNote={`Visitors see ${row.live ? 'the live picture' : 'the show’s own art'} until we approve this one.`}
                onCancelStaged={canCancel ? () => cancelSeasonStaged(row.number) : null}
                cancelBusy={busy === `cancel-season-${row.number}`}
                emptyTitle={removing ? 'Removed when you save' : 'No art yet'}
                emptyText="A 16:9 picture for this season."
                caption={row.removal && !removing ? 'Removing it waits for approval.' : null}
                actions={isOpen(p) ? (
                  <>
                    <PickButton label={row.live || row.staged || picked ? 'Replace' : 'Upload'} accept={IMAGE_ACCEPT} onPick={(f) => pickSeason(row.number, f)} />
                    {picked || removing ? (
                      <button type="button" className="show-ed-mini" onClick={() => undoSeason(row.number)}>Undo</button>
                    ) : row.live && !row.removal ? (
                      <button type="button" className="show-ed-mini" onClick={() => pickSeason(row.number, 'remove')}>Remove</button>
                    ) : null}
                  </>
                ) : null}
              />
            );
          })}
        </div>
      )}
    </>
  );

  const trailerWaiting = Boolean(trailerUp && trailerUp.state === 'uploading');
  const canSave = canEdit && computed.changes.length > 0 && !saving && !trailerWaiting;
  const viewHref = show.isPublic ? (podcast ? `/podcasts/${encodeURIComponent(show.id)}` : `/series/${encodeURIComponent(show.id)}`) : null;
  const pill = { text: show.statusLabel || (show.isPublic ? 'Live' : 'Not public yet'), tone: LEVEL_TONE[show.level] || (show.isPublic ? 'ok' : 'neutral') };
  const footer = (
    <>
      {summary.note && <p className="show-ed-foot-note"><ClockIcon size={12} /> {summary.note}</p>}
      {trailerWaiting && <p className="show-ed-foot-note">The trailer is still uploading — save once it’s up.</p>}
      {error && <p className="show-ed-error" role="alert">{error}</p>}
      <div className={`show-ed-foot-actions ${viewHref ? 'has-second' : ''}`}>
        <button type="button" className="apl-btn show-ed-primary show-ed-save" disabled={!canSave} onClick={() => save()}>{saving ? 'Saving…' : summary.label}</button>
        <div className="show-ed-foot-meta">
          {viewHref && <a className="apl-btn-secondary show-ed-second show-ed-view" href={viewHref} target="_blank" rel="noreferrer">View page <ExternalLinkIcon size={12} /></a>}
          <p className="show-ed-status">{show.isPublic ? 'Changes reach visitors within a few minutes' : 'It isn’t public yet — only you and the team see it'}</p>
        </div>
      </div>
    </>
  );

  const sections = [
    { key: 'details', label: 'Details', content: details },
    { key: 'art', label: 'Art', content: artTab, glyph: anyArtStaged ? <ClockIcon size={12} /> : null, glyphLabel: anyArtStaged ? 'something waits for approval' : null }
  ];
  const backHref = mode === 'admin' ? `/admin/shows/${encodeURIComponent(show.id)}` : `/creator/show/${encodeURIComponent(show.id)}`;

  return (
    <>
      {layout !== 'panel' && <Head><title>{`Edit ${show.name || noun} — ${SITE.name}`}</title><meta name="robots" content="noindex" /></Head>}
      <EditorFrame
        layout={layout}
        rootRef={rootRef}
        backHref={backHref}
        backLabel={show.name || `The ${noun}`}
        onBack={() => !dirty || window.confirm('Leave without saving your changes?')}
        onClose={close}
        eyebrow={`Edit ${noun}`}
        pill={pill}
        title={show.name || 'Untitled'}
        banners={banners}
        sections={sections}
        active={tab}
        onTab={setTab}
        footer={footer}
        toast={<Toast toast={toast} onClose={() => showToast(null)} />}
        ariaLabel={`Edit ${show.name || noun}`}
        tabsLabel={`Edit ${noun}`}
      />
    </>
  );
}
