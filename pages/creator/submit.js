import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../../lib/accountContext';
import { getAllSeriesForCreator } from '../../lib/series';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getDraft } from '../../lib/creatorDrafts';
import {
  SUBMIT_TYPES, MAIN_GENRES, STEPS, EMPTY_SUBMIT_FORM, typeNeedsShow, typeIsNumbered, showNoun, stepBlocker, toSubmitBody
} from '../../lib/submitRules';
import { readVideoMetadata, formatRuntime } from '../../lib/videoMetadata';
import { parseAdBreaksInput } from '../../lib/adBreaks';
import { bytesLabel, runtimeClock } from '../../lib/creatorRights';
import { useUpload } from '../../contexts/UploadContext';
import HeaderNav from '../../components/HeaderNav';
import Footer from '../../components/Footer';
import RatingOptions from '../../components/RatingOptions';
import { SITE } from '../../lib/siteConfig';

// Creator Studio's submit, three steps (2026-10-31, from the creator-path
// canvas): the file (it starts uploading the moment it's dropped and keeps
// going through the next two steps), about it (with "+ New show" inline),
// artwork + captions with the rarely-touched options folded away. Saved
// as a draft as the creator goes (/api/creator/drafts), so the hub lists
// it and this page reopens at the same step; the stopped upload resumes
// when the same file is picked again. Replaces the six-button modal page.
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const [allSeries, episodes, draft] = await Promise.all([
    getAllSeriesForCreator(account.userId, { isAdmin: account.isAdmin }),
    getPublicEpisodes(),
    query.draft ? getDraft(account.userId, String(query.draft)) : Promise.resolve(null)
  ]);
  const type = SUBMIT_TYPES.some((t) => t.value === query.type) ? query.type : null;
  return {
    props: {
      allSeries: allSeries.map((s) => ({ id: s.id, name: s.name, status: s.status || 'approved', hasArt: Boolean(s.poster || s.thumbnail) })),
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      draft,
      initialType: type,
      initialSeriesId: typeof query.series === 'string' ? query.series : null
    }
  };
}

const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm';

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

async function postJson(url, body, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { data, status: res.status });
  return data;
}

function initialForm(draft, initialType, initialSeriesId) {
  const base = { ...EMPTY_SUBMIT_FORM, ...(draft ? draft.form : {}) };
  if (!draft && initialType) base.contentType = initialType;
  if (!draft && initialSeriesId) base.seriesId = initialSeriesId;
  if (!draft && initialType === 'bonus') base.cutArtwork = false;
  return base;
}

export default function SubmitTitle({ allSeries, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, draft, initialType, initialSeriesId }) {
  const router = useRouter();
  const { activeUpload, startVideoUpload } = useUpload();
  const [form, setForm] = useState(() => initialForm(draft, initialType, initialSeriesId));
  const [video, setVideo] = useState(draft ? draft.video : null);
  const [trailer, setTrailer] = useState(draft ? draft.trailer : null);
  const [draftId, setDraftId] = useState(draft ? draft.id : null);
  const [step, setStep] = useState(draft && draft.form && draft.form.step ? Math.min(3, Math.max(1, Number(draft.form.step))) : 1);
  const [posterFile, setPosterFile] = useState(null);
  const [stillFile, setStillFile] = useState(null);
  const [captionsFile, setCaptionsFile] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | failed
  const [submitting, setSubmitting] = useState(false);
  const [over, setOver] = useState(false);
  const saveTimer = useRef(null);
  const latest = useRef({ form, video, trailer, draftId });
  latest.current = { form, video, trailer, draftId };

  const type = SUBMIT_TYPES.find((t) => t.value === form.contentType) || SUBMIT_TYPES[0];
  const media = useMemo(() => ({ video, trailer, audioUrl: form.audioUrl || null, audioBytes: form.audioBytes || null }), [video, trailer, form.audioUrl, form.audioBytes]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // The draft: saved a second after the last change, as long as there's
  // something to keep (a file, or a title typed).
  const saveDraft = useCallback(async () => {
    const { form: f, video: v, trailer: t, draftId: id } = latest.current;
    if (!v && !t && !String(f.title || '').trim() && !f.audioUrl) return;
    setSaveState('saving');
    try {
      const data = await postJson('/api/creator/drafts', { id, form: f, video: v, trailer: t });
      if (!id) setDraftId(data.draft.id);
      setSaveState('saved');
    } catch (err) {
      setSaveState('failed');
      if (err.status === 503) setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveDraft, 1000);
    return () => clearTimeout(saveTimer.current);
  }, [form, video, trailer, saveDraft]);

  // Keep the step in the draft, so it reopens where it was.
  useEffect(() => { update('step', step); }, [step]);

  // The runtime field follows what the file said, until typed over.
  useEffect(() => {
    if (video && video.runtimeSeconds && !String(form.runtime || '').trim()) update('runtime', formatRuntime(video.runtimeSeconds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video && video.runtimeSeconds]);

  // A link import: Cloudflare fetches it; ask every few seconds until ready.
  const polling = video && video.state === 'processing' && !video.bytes;
  useEffect(() => {
    if (!polling) return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n > 200) { clearInterval(t); return; }
      try {
        const res = await fetch(`/api/creator/video-status?uid=${encodeURIComponent(video.uid)}`);
        const st = await res.json();
        if (!res.ok) return;
        if (st.state === 'ready' || st.readyToStream) setVideo((v) => (v ? { ...v, state: 'ready', runtimeSeconds: v.runtimeSeconds || (st.duration ? Math.round(st.duration) : null) } : v));
        else if (st.state === 'error') { setVideo((v) => (v ? { ...v, state: 'error' } : v)); setError(st.errorReasonText || 'Cloudflare could not process that link.'); }
      } catch {
        // next tick
      }
    }, 4000);
    return () => clearInterval(t);
  }, [polling, video && video.uid]);

  const uploadNow = activeUpload && activeUpload.videoOnly ? activeUpload : null;
  const masterUploading = Boolean(uploadNow && video && uploadNow.uid === video.uid && ['requesting-url', 'uploading'].includes(uploadNow.status));
  const trailerUploading = Boolean(uploadNow && trailer && uploadNow.uid === trailer.uid && ['requesting-url', 'uploading'].includes(uploadNow.status));
  const anyUploading = Boolean(uploadNow && ['requesting-url', 'uploading'].includes(uploadNow.status));

  async function beginMaster(file, { resumeUrl = null } = {}) {
    setError(null);
    let meta = { duration: null, width: null, height: null };
    try { meta = await readVideoMetadata(file); } catch { /* the runtime is typed in step 2 */ }
    try {
      const started = await startVideoUpload(file, {
        urlEndpoint: '/api/creator/get-upload-url',
        resumeUrl,
        kind: 'main',
        onUrl: (url) => setVideo((v) => (v && v.uid === started.uid ? { ...v, uploadUrl: url } : v))
      });
      setVideo({ uid: started.uid, state: 'uploading', name: file.name, bytes: file.size, uploadUrl: resumeUrl || null, runtimeSeconds: meta.duration ? Math.round(meta.duration) : null, width: meta.width, height: meta.height });
      if (!String(latest.current.form.title || '').trim()) update('title', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      started.done.then(() => setVideo((v) => (v && v.uid === started.uid ? { ...v, state: 'processing' } : v))).catch(() => {});
    } catch (err) {
      setError(err.message || 'Could not start the upload.');
    }
  }

  function pickMaster(file) {
    if (!file) return;
    if (anyUploading) { setError('An upload is already running. Let it finish first.'); return; }
    // The same file as a stopped upload: carry on where it was.
    const resume = video && video.uploadUrl && video.state === 'uploading' && video.bytes === file.size && video.name === file.name;
    beginMaster(file, { resumeUrl: resume ? video.uploadUrl : null });
  }

  async function beginTrailer(file) {
    if (!file) return;
    if (anyUploading) { setError('The master is still uploading. Drop the trailer once it has finished.'); return; }
    setError(null);
    try {
      const started = await startVideoUpload(file, { urlEndpoint: '/api/creator/get-upload-url', kind: 'trailer' });
      setTrailer({ uid: started.uid, state: 'uploading', name: file.name });
      started.done.then(() => setTrailer((t) => (t && t.uid === started.uid ? { ...t, state: 'processing' } : t))).catch(() => {});
    } catch (err) {
      setError(err.message || 'Could not start the trailer upload.');
    }
  }

  async function importLink() {
    const url = link.trim();
    if (!url) return;
    setImporting(true);
    setError(null);
    try {
      if (form.contentType === 'podcast' && /\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(url)) {
        const data = await postJson('/api/creator/import-audio-url', { audioUrl: url });
        setForm((f) => ({ ...f, audioUrl: data.audioUrl, audioBytes: data.audioBytes || null }));
      } else {
        const data = await postJson('/api/creator/import-video-url', { videoUrl: url, fileName: form.title ? `${form.title}.mp4` : undefined });
        setVideo({ uid: data.uid, state: 'processing', name: url.replace(/^https?:\/\//, '').slice(0, 80), bytes: null, uploadUrl: null, runtimeSeconds: null });
      }
      setLinkMode(false);
      setLink('');
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function discardDraft() {
    if (!window.confirm('Discard this draft? The uploaded file is deleted too.')) return;
    try {
      if (draftId) await postJson('/api/creator/drafts', { id: draftId }, 'DELETE');
      router.push('/creator');
    } catch (err) {
      setError(err.message);
    }
  }

  function next() {
    const why = stepBlocker(step, form, media);
    if (why) { setError(why); return; }
    setError(null);
    setStep((s) => Math.min(3, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    for (const s of [1, 2]) {
      const why = stepBlocker(s, form, media);
      if (why) { setError(why); setStep(s); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      const [posterBase64, thumbnailBase64, captionsBase64] = await Promise.all([readAsDataUrl(form.cutArtwork ? null : posterFile), readAsDataUrl(form.cutArtwork ? null : stillFile), readAsDataUrl(captionsFile)]);
      const body = toSubmitBody(form, media, {
        adBreakSeconds: form.adsEnabled !== false ? parseAdBreaksInput(form.adBreaksText) : [0],
        ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
        ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: stillFile.name } : {}),
        ...(captionsBase64 ? { captionsBase64, captionsFileName: captionsFile.name, captionsLanguage: form.captionsLanguage, captionsLabel: form.captionsLabel } : {}),
        ...(draftId ? { draftId } : {})
      });
      const data = await postJson('/api/creator/submit-episode', body);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      latest.current = { form: EMPTY_SUBMIT_FORM, video: null, trailer: null, draftId: null };
      router.push(`/creator?submitted=${encodeURIComponent(form.title.trim())}&id=${encodeURIComponent(data.id)}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const stepInfo = STEPS[step - 1];
  const fileLine = video
    ? `${video.name}${video.bytes ? ` · ${bytesLabel(video.bytes)}` : ''} · ${masterUploading ? `${pctOf(uploadNow)}% uploading` : video.state === 'uploading' ? 'upload stopped' : video.state === 'processing' ? 'uploaded, processing' : video.state === 'ready' ? 'ready' : video.state === 'error' ? 'failed to process' : video.state}`
    : form.audioUrl ? `Audio imported${form.audioBytes ? ` · ${bytesLabel(form.audioBytes)}` : ''}` : null;

  return (
    <>
      <Head><title>Submit a title — {SITE.name}</title></Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="apl sub">
        <div className="sub-head">
          <Link href="/creator" className="sub-back" aria-label="Back to Creator Studio">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </Link>
          <span className="sub-head-title">Submit a title</span>
          <span className="sub-head-step">Step {step} of 3</span>
        </div>
        <div className="sub-progress" aria-hidden="true"><div style={{ width: `${(step / 3) * 100}%` }} /></div>
        {step > 1 && fileLine && (
          <div className={`sub-strip ${video && video.state === 'error' ? 'is-error' : ''}`}>
            <span>{fileLine}</span>
            <span>{masterUploading ? `${pctOf(uploadNow)}%` : video && (video.state === 'ready' || video.state === 'processing') ? '✓' : ''}</span>
          </div>
        )}

        {step === 1 && (
          <section className="sub-step">
            <h1 className="sub-h1">{stepInfo.title}</h1>
            <p className="sub-lede">Drop the master. It starts uploading now and keeps going while you fill in the next two steps; close the tab and it stops, pick the same file again and it carries on.</p>

            {!linkMode && (
              <div className="apl-field">
                <div className="apl-label" id="sub-type-label">What is it</div>
                <div className="apl-pills" role="radiogroup" aria-labelledby="sub-type-label">
                  {SUBMIT_TYPES.map((t) => (
                    <button key={t.value} type="button" role="radio" aria-checked={form.contentType === t.value} className={`apl-pill ${form.contentType === t.value ? 'on' : ''}`} onClick={() => update('contentType', t.value)}>{t.label}</button>
                  ))}
                </div>
              </div>
            )}

            {!video && !form.audioUrl && !linkMode && (
              <div
                className={`apl-drop ${over ? 'is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); pickMaster(e.dataTransfer.files && e.dataTransfer.files[0]); }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></svg>
                <div className="apl-drop-title">Drop the master here</div>
                <div className="apl-drop-sub">{form.contentType === 'vertical' ? '9:16, MP4 or MOV, any size.' : 'MP4 or MOV, 1080p or better, any size.'}</div>
                <label className="apl-btn-ghost">
                  Browse files
                  <input type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => { pickMaster(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                </label>
              </div>
            )}
            {video && (
              <MediaProgress
                name={video.name}
                bytes={video.bytes}
                state={masterUploading ? 'uploading' : video.state}
                upload={masterUploading ? uploadNow : null}
                facts={[runtimeClock(video.runtimeSeconds), video.width && video.height ? `${video.width} × ${video.height}` : null].filter(Boolean)}
                onRemove={() => setVideo(null)}
                onResume={video.state === 'uploading' && !masterUploading ? (f) => pickMaster(f) : null}
              />
            )}
            {form.audioUrl && (
              <div className="apl-progress">
                <div className="apl-progress-row"><span className="apl-progress-name">Audio imported{form.audioBytes ? ` · ${bytesLabel(form.audioBytes)}` : ''}</span><span>ready ✓</span></div>
                <div className="apl-progress-meta"><span>An audio-only episode. Add a video too, or go on.</span><button type="button" className="apl-link" onClick={() => setForm((f) => ({ ...f, audioUrl: null, audioBytes: null }))}>Remove</button></div>
              </div>
            )}

            {!linkMode ? (
              <button type="button" className="apl-link sub-alt" onClick={() => setLinkMode(true)}>The file is somewhere else</button>
            ) : (
              <div className="apl-card sub-linkcard">
                <div className="apl-card-k">A link to the file</div>
                <p className="apl-help">A direct file link (a signed download link from Drive, Dropbox, WeTransfer, Frame.io or S3) and Cloudflare fetches it. A page that only shows a player, like a YouTube link, has no file to fetch.{form.contentType === 'podcast' ? ' Audio only: paste the MP3 the same way.' : ''}</p>
                <div className="apl-field">
                  <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" aria-label="Link to the file" />
                </div>
                <div className="apl-actions">
                  <button type="button" className="apl-btn-secondary" disabled={importing || !link.trim()} onClick={importLink}>{importing ? 'Fetching…' : 'Fetch it'}</button>
                  <button type="button" className="apl-btn-ghost" onClick={() => setLinkMode(false)}>Upload the file instead</button>
                </div>
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="sub-step">
            <h1 className="sub-h1">{stepInfo.title}</h1>
            <p className="sub-lede">What viewers read on the page. Short is fine.</p>
            <div className="apl-field">
              <label className="apl-label" htmlFor="sub-title">Title</label>
              <input id="sub-title" type="text" value={form.title} onChange={(e) => update('title', e.target.value)} maxLength={300} />
            </div>
            <div className="apl-field">
              <label className="apl-label" htmlFor="sub-desc">About it</label>
              <textarea id="sub-desc" rows={4} value={form.description} onChange={(e) => update('description', e.target.value)} maxLength={4000} />
            </div>
            <div className="apl-field">
              <label className="apl-label" htmlFor="sub-artist">Your name, as credited</label>
              <input id="sub-artist" type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} maxLength={200} />
            </div>

            {typeNeedsShow(form.contentType) && (
              <div className="apl-field">
                <label className="apl-label" htmlFor="sub-show">{form.contentType === 'bonus' ? 'Which show is it for' : `The ${showNoun(form.contentType)}`}</label>
                <select id="sub-show" value={String(form.newSeriesName || '').trim() ? '__new__' : form.seriesId} onChange={(e) => {
                  if (e.target.value === '__new__') setForm((f) => ({ ...f, seriesId: '', newSeriesName: f.newSeriesName || ' ' }));
                  else setForm((f) => ({ ...f, seriesId: e.target.value, newSeriesName: '', newSeriesDescription: '' }));
                }}>
                  <option value="">Choose…</option>
                  {allSeries.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'pending' ? ' (in review)' : ''}</option>)}
                  {form.contentType !== 'bonus' && <option value="__new__">+ New {showNoun(form.contentType)}</option>}
                </select>
                {String(form.newSeriesName || '').length > 0 && form.contentType !== 'bonus' && (
                  <div className="sub-newshow">
                    <div className="apl-field">
                      <label className="apl-label" htmlFor="sub-newname">New {showNoun(form.contentType)} name</label>
                      <input id="sub-newname" type="text" value={form.newSeriesName.trimStart()} onChange={(e) => update('newSeriesName', e.target.value || ' ')} maxLength={120} placeholder="The show this episode belongs to" />
                    </div>
                    <div className="apl-field">
                      <label className="apl-label" htmlFor="sub-newdesc">About the {showNoun(form.contentType)} <em>optional</em></label>
                      <textarea id="sub-newdesc" rows={2} value={form.newSeriesDescription} onChange={(e) => update('newSeriesDescription', e.target.value)} maxLength={2000} />
                    </div>
                    <p className="apl-help">The {showNoun(form.contentType)} is created with this episode. Its own poster and trailer come later, from Series management.</p>
                  </div>
                )}
              </div>
            )}
            {typeIsNumbered(form.contentType) && (
              <div className="apl-grid2">
                <div className="apl-field">
                  <label className="apl-label" htmlFor="sub-season">Season</label>
                  <input id="sub-season" type="number" min="1" value={form.season} onChange={(e) => update('season', e.target.value)} />
                </div>
                <div className="apl-field">
                  <label className="apl-label" htmlFor="sub-order">Episode number</label>
                  <input id="sub-order" type="number" min="1" value={form.seriesOrder} onChange={(e) => update('seriesOrder', e.target.value)} />
                </div>
              </div>
            )}
            <div className="apl-grid2">
              <div className="apl-field">
                <label className="apl-label" htmlFor="sub-genre">Genre</label>
                <select id="sub-genre" value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)}>
                  {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="sub-rating">Rating</label>
                <select id="sub-rating" value={form.rating} onChange={(e) => update('rating', e.target.value)}>
                  <option value="">Not set (treated as 17+)</option>
                  <RatingOptions />
                </select>
              </div>
            </div>
            <div className="apl-grid2">
              <div className="apl-field">
                <label className="apl-label" htmlFor="sub-runtime">Runtime <em>{video && video.runtimeSeconds ? 'read from the file' : 'MM:SS'}</em></label>
                <input id="sub-runtime" type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} placeholder="12:04" />
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="sub-year">Year <em>optional</em></label>
                <input id="sub-year" type="number" min="1900" max={new Date().getFullYear() + 1} value={form.releaseYear} onChange={(e) => update('releaseYear', e.target.value)} placeholder={String(new Date().getFullYear())} />
              </div>
            </div>
            <div className="apl-field">
              <label className="apl-label" htmlFor="sub-subgenre">Specific genre <em>optional, e.g. “Cosmic Horror”</em></label>
              <input id="sub-subgenre" type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} maxLength={60} />
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="sub-step">
            <h1 className="sub-h1">{stepInfo.title}</h1>
            <p className="sub-lede">A poster and a still. No text baked in. Skip them and we cut both from the film itself; swap them any time from Your work.</p>
            <div className="sub-art">
              <label className={`sub-art-slot poster ${form.cutArtwork ? 'off' : ''}`}>
                {posterFile && !form.cutArtwork ? <img src={URL.createObjectURL(posterFile)} alt="" /> : <span>Poster<br />2:3</span>}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { setPosterFile(e.target.files && e.target.files[0]); update('cutArtwork', false); }} />
              </label>
              <div className="sub-art-right">
                <label className={`sub-art-slot still ${form.cutArtwork ? 'off' : ''}`}>
                  {stillFile && !form.cutArtwork ? <img src={URL.createObjectURL(stillFile)} alt="" /> : <span>Still · 16:9</span>}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { setStillFile(e.target.files && e.target.files[0]); update('cutArtwork', false); }} />
                </label>
                <button type="button" className={`apl-btn-ghost ${form.cutArtwork ? 'on' : ''}`} onClick={() => { update('cutArtwork', !form.cutArtwork); }}>
                  {form.cutArtwork ? '✓ Cutting both from the film' : 'Cut both from the film for me'}
                </button>
              </div>
            </div>
            {form.contentType === 'bonus' && <p className="apl-help">A clip on a show's page: its art is optional either way.</p>}

            <div className="apl-field">
              <div className="apl-label">Trailer <em>optional · 15–30 s</em></div>
              {trailer ? (
                <MediaProgress name={trailer.name} bytes={null} state={trailerUploading ? 'uploading' : trailer.state} upload={trailerUploading ? uploadNow : null} facts={[]} onRemove={() => setTrailer(null)} />
              ) : (
                <label className={`sub-slot ${anyUploading ? 'off' : ''}`}>
                  {anyUploading ? 'Drop a clip once the master has finished uploading' : 'Drop a clip, or skip'}
                  <input type="file" accept={VIDEO_ACCEPT} hidden disabled={anyUploading} onChange={(e) => { beginTrailer(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                </label>
              )}
            </div>
            <div className="apl-field">
              <div className="apl-label">Captions <em>optional · SRT or VTT</em></div>
              <label className="sub-slot">
                {captionsFile ? `${captionsFile.name} ✓` : 'Drop the file, or we caption what we can'}
                <input type="file" accept=".srt,.vtt,text/vtt" hidden onChange={(e) => setCaptionsFile(e.target.files && e.target.files[0])} />
              </label>
              {captionsFile && (
                <div className="apl-grid2">
                  <div className="apl-field"><label className="apl-label" htmlFor="sub-cl">Language code</label><input id="sub-cl" type="text" value={form.captionsLanguage} onChange={(e) => update('captionsLanguage', e.target.value)} maxLength={10} /></div>
                  <div className="apl-field"><label className="apl-label" htmlFor="sub-cb">Label</label><input id="sub-cb" type="text" value={form.captionsLabel} onChange={(e) => update('captionsLabel', e.target.value)} maxLength={40} /></div>
                </div>
              )}
            </div>

            <details className="sub-opt">
              <summary>More options <span>· the defaults are fine for most titles</span></summary>
              <div className="sub-opt-body">
                <div className="sub-opt-row">
                  <span className="sub-opt-text"><span>Who can watch</span><span>Free with ads, or {SITE.premiumTier} members only. {SITE.studio ? 'The studio' : 'We'} has the final say.</span></span>
                  <span className="apl-pills">
                    <button type="button" className={`apl-pill ${form.tier !== 'premium' ? 'on' : ''}`} onClick={() => update('tier', 'free')}>Free</button>
                    <button type="button" className={`apl-pill ${form.tier === 'premium' ? 'on' : ''}`} onClick={() => update('tier', 'premium')}>{SITE.premiumTier}</button>
                  </span>
                </div>
                <div className="sub-opt-row">
                  <span className="sub-opt-text"><span>Ad breaks</span><span>One before the title. Add break points as MM:SS, comma-separated.</span></span>
                  <input type="text" className="sub-opt-input" value={form.adBreaksText} onChange={(e) => update('adBreaksText', e.target.value)} aria-label="Ad breaks" />
                </div>
                <label className="sub-opt-row">
                  <span className="sub-opt-text"><span>Let channels air it</span><span>TapaTV can schedule it live, with ads.</span></span>
                  <input type="checkbox" checked={form.channelOptIn} onChange={(e) => update('channelOptIn', e.target.checked)} />
                </label>
                <label className="sub-opt-row">
                  <span className="sub-opt-text"><span>Ask for the home page hero</span><span>The studio decides what rotates.</span></span>
                  <input type="checkbox" checked={form.featured} onChange={(e) => update('featured', e.target.checked)} />
                </label>
                <label className="sub-opt-row">
                  <span className="sub-opt-text"><span>Tapa Original</span><span>Made with or for the studio.</span></span>
                  <input type="checkbox" checked={form.isOriginal} onChange={(e) => update('isOriginal', e.target.checked)} />
                </label>
                <div className="apl-field">
                  <label className="apl-label" htmlFor="sub-fund">Funding link <em>optional</em></label>
                  <input id="sub-fund" type="url" value={form.fundingUrl} onChange={(e) => update('fundingUrl', e.target.value)} placeholder="https://" />
                </div>
              </div>
            </details>
          </section>
        )}

        {error && <p className="admin-error" role="alert">{error}</p>}

        <div className="sub-foot">
          {step < 3 ? (
            <button type="button" className="apl-btn" onClick={next}>{step === 1 ? 'Next: about it' : 'Next: artwork'}</button>
          ) : (
            <button type="button" className="apl-btn" onClick={submit} disabled={submitting}>{submitting ? 'Sending…' : 'Submit for review'}</button>
          )}
          <div className="sub-foot-row">
            {step > 1 ? <button type="button" className="apl-link" onClick={() => { setError(null); setStep((s) => s - 1); }}>Back</button> : <span />}
            <span className="apl-send-note">
              {step === 3
                ? 'We watch it and reply, usually within a few days. You’ll see it under In review on Your work.'
                : saveState === 'saved' ? 'Saved as a draft.' : saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Draft not saved; check the connection.' : 'Saved as a draft as you go.'}
            </span>
            {(draftId || video) ? <button type="button" className="apl-link" onClick={discardDraft}>Discard</button> : <span />}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function pctOf(upload) {
  if (!upload || !upload.fileSize) return 0;
  return Math.min(100, Math.round((upload.bytesUploaded / upload.fileSize) * 100));
}

// The master's (or the trailer's) progress card.
function MediaProgress({ name, bytes, state, upload, facts, onRemove, onResume }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!upload || upload.status !== 'uploading') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [upload && upload.status]);
  const pct = pctOf(upload);
  const elapsed = upload ? Math.max(1, (Date.now() - upload.startedAt) / 1000) : 0;
  const speed = upload ? upload.bytesUploaded / elapsed : 0;
  const left = upload && speed > 0 ? Math.round((upload.fileSize - upload.bytesUploaded) / speed) : null;
  const leftLabel = left == null ? '' : left < 60 ? 'under a minute left' : `${Math.round(left / 60)} min left`;
  const right = state === 'uploading' && upload ? `${pct}%${leftLabel ? ` · ${leftLabel}` : ''}` : state === 'uploading' ? 'upload stopped' : state === 'processing' ? 'uploaded · processing' : state === 'ready' ? 'ready ✓' : state === 'error' ? 'failed' : state;
  return (
    <div className={`apl-progress ${state === 'error' ? 'is-error' : ''}`} aria-live="polite">
      <div className="apl-progress-row"><span className="apl-progress-name">{name}{bytes ? ` · ${bytesLabel(bytes)}` : ''}</span><span>{right}</span></div>
      <div className="apl-bar"><div className="apl-bar-fill" style={{ width: `${state === 'uploading' ? pct : 100}%` }} /></div>
      <div className="apl-progress-meta">
        {state === 'uploading' && !upload
          ? <span>The upload stopped. {onResume ? <label className="apl-link">Pick the same file again to resume<input type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => { onResume(e.target.files && e.target.files[0]); e.target.value = ''; }} /></label> : null}</span>
          : state === 'error'
            ? <span>Cloudflare couldn’t process it. Pick another file.</span>
            : facts.length
              ? <span>Runtime read from the file: <strong>{facts[0]}</strong>{facts[1] ? ` · ${facts[1]}` : ''}</span>
              : <span>{state === 'uploading' ? 'Keeps going while you fill in the next steps.' : 'Cloudflare is working on it; nothing more to do here.'}</span>}
        <button type="button" className="apl-link" onClick={onRemove}>Not this file</button>
      </div>
    </div>
  );
}
