import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getAllSeries } from '../lib/series';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { useUpload } from '../contexts/UploadContext';
import { readVideoDuration, formatRuntime } from '../lib/videoMetadata';
import { parseAdBreaksInput } from '../lib/adBreaks';
import dynamic from 'next/dynamic';

// Uppy touches browser-only APIs during its own setup — rendering it
// during Next.js's server-side render pass (this page uses
// getServerSideProps) throws before the page ever reaches the browser.
// { ssr: false } skips that entirely: the component only ever renders
// client-side, after hydration.
const UppyFilePicker = dynamic(() => import('../components/UppyFilePicker'), { ssr: false });
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import { SITE } from '../lib/siteConfig';
import { CONTENT_RATINGS } from '../lib/contentRatings';

import Footer from '../components/Footer';
// SECURITY: same enforcement pattern as /admin — a non-creator is
// redirected server-side before this page (or any creator-only data) ever
// renders.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeries(), getPublicEpisodes()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  return {
    props: {
      allSeries,
      mainGenres,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];
const CONTENT_TYPES = [
  { value: 'short', label: 'Short' },
  { value: 'movie', label: 'Movie' },
  { value: 'series', label: 'Series episode' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'bonus', label: 'Bonus content (BTS, trailer, extra…)' }
];

const EMPTY_FORM = {
  title: '', description: '', tier: 'free',
  genre: '', mainGenre: MAIN_GENRES[0], contentType: 'short', rating: '',
  seriesId: '', season: '1', seriesOrder: '', artist: '', runtime: '',
  featured: false, adsEnabled: true, isOriginal: false, fundingUrl: '', adBreaksText: '0:00'
};

// Reads an image file as a base64 data URL — small enough (posters/
// thumbnails, not video) to travel as JSON in the submit-episode request
// rather than needing a real multipart upload. Resolves to null for a
// missing file so callers can treat "no image chosen" and "read it"
// identically.
function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

// Draft autosave — text fields only. File inputs (video/poster/thumbnail/
// trailer) can't survive a page reload no matter what (browsers won't let
// JS re-populate a file input for security reasons), so a restored draft
// still needs those re-selected — this just saves re-typing everything
// else. Client-only by design: a creator's in-progress form text has no
// reason to touch the server until they actually hit submit.
const DRAFT_KEY = 'taprino-creator-draft';

function loadDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveDraft(formValue) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(formValue));
  } catch (err) {
    // Not worth surfacing — worst case, autosave just silently doesn't happen.
  }
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    // Ignore — nothing meaningful to do if this fails.
  }
}

// A draft is only worth offering to restore if it actually has something
// in it beyond the defaults — an empty form saved on page load shouldn't
// prompt "restore your draft?" the very next visit.
function draftHasContent(draft) {
  return !!draft && (draft.title || draft.description || draft.artist || draft.genre);
}

export default function CreatorSubmit({ allSeries, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const { activeUpload, startUpload, startUrlImport } = useUpload();
  const router = useRouter();
  const seriesList = allSeries;
  const [form, setForm] = useState(EMPTY_FORM);

  // Supports deep links like /creator?contentType=bonus&seriesId=X (used
  // by the "＋ Add bonus content" option on a show's settings dropdown in
  // /creator/my-work) — pre-fills the form instead of landing on a blank
  // one the creator has to reconfigure by hand. Only runs once router is
  // actually ready (query isn't populated on the very first render).
  useEffect(() => {
    if (!router.isReady) return;
    const { contentType, seriesId } = router.query;
    if (contentType && CONTENT_TYPES.some((t) => t.value === contentType)) {
      setForm((f) => ({
        ...f,
        contentType: String(contentType),
        ...(seriesId ? { seriesId: String(seriesId) } : {})
      }));
    }
  }, [router.isReady]);

  const [file, setFile] = useState(null);
  const [videoSource, setVideoSource] = useState('file'); // 'file' | 'link' | 'cloudflare-id'
  const [videoUrl, setVideoUrl] = useState('');
  const [manualVideoUid, setManualVideoUid] = useState('');
  const [trailerSource, setTrailerSource] = useState('file'); // 'file' | 'cloudflare-id'
  const [manualTrailerUid, setManualTrailerUid] = useState('');
  const [submittingManual, setSubmittingManual] = useState(false);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioImporting, setAudioImporting] = useState(false);
  const [audioImportedUrl, setAudioImportedUrl] = useState(null);
  const [audioError, setAudioError] = useState(null);
  const [skipVideo, setSkipVideo] = useState(false);
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [trailerFile, setTrailerFile] = useState(null);
  const [formError, setFormError] = useState(null);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState(null); // null | 'detecting' | 'detected' | 'failed'
  const [pickerResetKey, setPickerResetKey] = useState(0);

  // Checked once on mount — if there's a leftover draft with real content
  // in it, offer to restore rather than silently discarding or silently
  // auto-applying (either of which could surprise a creator).
  useEffect(() => {
    if (draftHasContent(loadDraft())) setDraftAvailable(true);
  }, []);

  // Reads the video's own duration the moment it's chosen — before any
  // upload starts — and fills in the runtime field automatically. Left
  // editable afterward on purpose: auto-detection can be wrong for oddly
  // encoded files, and a creator should be able to just fix it rather than
  // fight the form if that happens.
  async function handleVideoFileChange(selectedFile) {
    setFile(selectedFile);
    if (!selectedFile) {
      setRuntimeStatus(null);
      return;
    }
    setRuntimeStatus('detecting');
    try {
      const seconds = await readVideoDuration(selectedFile);
      update('runtime', formatRuntime(seconds));
      setRuntimeStatus('detected');
    } catch (err) {
      // Not a form-blocking error — the creator can still type the runtime
      // in by hand, same as before this existed.
      setRuntimeStatus('failed');
    }
  }

  function update(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      saveDraft(next);
      return next;
    });
  }

  function restoreDraft() {
    const draft = loadDraft();
    if (draft) setForm({ ...EMPTY_FORM, ...draft });
    setDraftAvailable(false);
  }

  function discardDraft() {
    clearDraft();
    setDraftAvailable(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (skipVideo && !audioImportedUrl) {
      setFormError('Import an audio file first, or uncheck "Audio only" to add a video instead.');
      return;
    }
    if (!skipVideo && videoSource === 'file' && !file) {
      setFormError('Please choose a video file.');
      return;
    }
    if (!skipVideo && videoSource === 'link' && !videoUrl.trim()) {
      setFormError('Paste a link to your video file.');
      return;
    }
    if (!skipVideo && videoSource === 'link' && !form.runtime.trim()) {
      // Auto-detection needs an actual File object to read — there isn't
      // one for a link import, so this is the one field link-mode can't
      // fill in for you.
      setFormError('Enter the runtime (link imports can\'t detect it automatically).');
      return;
    }
    if (!skipVideo && videoSource === 'cloudflare-id' && !manualVideoUid.trim()) {
      setFormError('Paste the Cloudflare video ID.');
      return;
    }
    if (!skipVideo && videoSource === 'cloudflare-id' && !form.runtime.trim()) {
      setFormError('Enter the runtime — there\'s no file here to auto-detect it from.');
      return;
    }
    if (skipVideo && !form.runtime.trim()) {
      setFormError('Enter the runtime — there\'s no video here to auto-detect it from.');
      return;
    }
    if (!skipVideo && videoSource === 'cloudflare-id' && trailerSource === 'file' && trailerFile) {
      setFormError('A pasted video ID can\'t be combined with an uploaded trailer file — use a trailer video ID instead, or skip the trailer for now.');
      return;
    }
    if (trailerSource === 'cloudflare-id' && !manualTrailerUid.trim() && trailerFile) {
      // Belt-and-suspenders — the toggle already hides the file picker
      // when trailerSource is 'cloudflare-id', but this guards against
      // stale state if someone toggles back and forth.
      setFormError('Choose one trailer source, not both.');
      return;
    }
    if (activeUpload && activeUpload.status !== 'done' && activeUpload.status !== 'error') {
      setFormError('An upload is already in progress — wait for it to finish (or fail) before starting another.');
      return;
    }

    // Read any chosen images now, while the form still has them — the form
    // gets reset immediately below so the creator can start their next
    // submission right away.
    let posterBase64 = null;
    let thumbnailBase64 = null;
    try {
      [posterBase64, thumbnailBase64] = await Promise.all([readAsDataUrl(posterFile), readAsDataUrl(thumbnailFile)]);
    } catch (err) {
      setFormError(err.message);
      return;
    }

    const submissionData = {
      ...form,
      adBreakSeconds: form.adsEnabled ? parseAdBreaksInput(form.adBreaksText) : [0],
      ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
      ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {}),
      // A manually-typed trailer ID rides along as plain metadata — if no
      // trailerFile is passed to startUpload, the upload context's own
      // trailerUid (from an actual upload) stays undefined and never
      // overwrites this, so it survives straight through to submit-episode.
      ...(trailerSource === 'cloudflare-id' && manualTrailerUid.trim()
        ? { trailerUid: manualTrailerUid.trim(), trailerIdWasManuallyEntered: true }
        : {}),
      // Same idea for audio — already imported and verified server-side
      // by this point (see the Import button above), so this is just the
      // resulting URL riding along as metadata, not a new upload.
      ...(audioImportedUrl ? { audioUrl: audioImportedUrl } : {})
    };

    if (skipVideo) {
      // Audio-only podcast episode — no video at all, so there's nothing
      // for the shared upload context to track. Goes straight to
      // submit-episode.js as a plain POST, same shape as the
      // cloudflare-id path below.
      setSubmittingManual(true);
      try {
        const res = await fetch('/api/creator/submit-episode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submissionData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit.');
      } catch (err) {
        setFormError(err.message);
        setSubmittingManual(false);
        return;
      }
      setSubmittingManual(false);
    } else if (videoSource === 'cloudflare-id') {
      // No upload happening at all here — this goes straight to
      // submit-episode.js as a normal POST, the same way manual episode
      // entry works for admin. The shared upload context is specifically
      // for tracking file uploads in progress; there's nothing to track
      // when the video already exists in Cloudflare.
      setSubmittingManual(true);
      try {
        const res = await fetch('/api/creator/submit-episode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...submissionData,
            videoUid: manualVideoUid.trim(),
            videoIdWasManuallyEntered: true
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit.');
      } catch (err) {
        setFormError(err.message);
        setSubmittingManual(false);
        return;
      }
      setSubmittingManual(false);
    } else if (videoSource === 'link') {
      // No trailer support for link imports yet — see UploadContext's
      // startUrlImport for why this is a separate, simpler path.
      startUrlImport(videoUrl.trim(), form.title ? `${form.title}.mp4` : undefined, submissionData);
    } else {
      startUpload(file, submissionData, trailerSource === 'file' ? (trailerFile || undefined) : undefined);
    }

    // Reset the form immediately so the creator can start filling out a
    // new submission right away, without waiting for this one to finish.
    clearDraft();
    setForm(EMPTY_FORM);
    setFile(null);
    setVideoUrl('');
    setManualVideoUid('');
    setManualTrailerUid('');
    setSkipVideo(false);
    setAudioUrl('');
    setAudioImportedUrl(null);
    setAudioError(null);
    setPosterFile(null);
    setThumbnailFile(null);
    setTrailerFile(null);
    setRuntimeStatus(null);
    setPickerResetKey((k) => k + 1);
  }


  return (
    <>
      <Head>
        <title>Submit an episode — {SITE.name}</title>
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
      <div className="install-row"><InstallButton /></div>

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Creator Studio</div>
        <p className="library-sub" style={{ marginBottom: '1rem' }}>Submit new episodes and track your review status.</p>
        <Link
          href="/creator/series"
          className="account-btn-secondary"
          style={{ display: 'inline-block', width: 'auto', textDecoration: 'none', marginBottom: '1.5rem' }}
        >
          ▤ Series management
        </Link>

        {draftAvailable && (
          <div className="draft-banner">
            <span>You have an unsaved draft from earlier — video and image files aren&rsquo;t saved, so you&rsquo;ll need to re-choose those, but the text fields can be restored.</span>
            <span style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={restoreDraft}>Restore draft</button>
              <button onClick={discardDraft}>Discard</button>
            </span>
          </div>
        )}

        <div className="account-card">
          <div className="account-eyebrow">New submission</div>
          <h3>Metadata and video are required — artwork helps you get approved faster</h3>
          <p>Your submission goes to the admin for review — it won&rsquo;t appear on the site until approved. Once you hit submit, the upload keeps running even if you navigate elsewhere — check the corner of your screen for progress.</p>

          <form onSubmit={handleSubmit}>
            <label>Title</label>
            <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />

            <label>Description</label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />

            <label>Your name / artist credit</label>
            <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />

            <label>
              Runtime (e.g. 05:30)
              {runtimeStatus === 'detecting' && <span style={{ color: 'var(--ink-dim)', fontWeight: 'normal' }}> — detecting from your video…</span>}
              {runtimeStatus === 'detected' && <span style={{ color: 'var(--ok)', fontWeight: 'normal' }}> — auto-detected from your video, edit if needed</span>}
              {runtimeStatus === 'failed' && <span style={{ color: 'var(--ink-dim)', fontWeight: 'normal' }}> — couldn&rsquo;t auto-detect, please enter it</span>}
            </label>
            <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} required placeholder="mm:ss" />

            <label>Content rating <span style={{ fontWeight: 'normal', color: 'var(--ink-dim)' }}>optional</span></label>
            <select value={form.rating} onChange={(e) => update('rating', e.target.value)}>
              <option value="">Not set</option>
              {CONTENT_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {!form.rating && (
              <p style={{ fontSize: '0.78rem', color: 'var(--signal-amber)', marginTop: '-0.4rem', marginBottom: '1rem' }}>
                Leaving this unset treats the title as 17+: viewers will have to create an account and confirm their age before they can watch it. Pick a rating here if that&rsquo;s not what you want.
              </p>
            )}

            <label>Content type</label>
            <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
              {CONTENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            {(form.contentType === 'series' || form.contentType === 'podcast') && (
              <>
                <label>{form.contentType === 'podcast' ? 'Show' : 'Series'}</label>
                <select value={form.seriesId} onChange={(e) => update('seriesId', e.target.value)} required>
                  <option value="">Choose a {form.contentType === 'podcast' ? 'show' : 'series'}…</option>
                  {seriesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__new__">A new {form.contentType === 'podcast' ? 'show' : 'series'} not listed here</option>
                </select>
                {form.seriesId === '__new__' && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
                    Prefer setting this up properly first? Use <Link href="/creator/series" style={{ color: 'var(--signal-amber)' }}>Series management</Link> to
                    create the {form.contentType === 'podcast' ? 'show' : 'series'} with its own trailer and artwork — then it&rsquo;ll show up in this dropdown.
                  </p>
                )}
                {form.seriesId && form.seriesId !== '__new__' && (() => {
                  const s = seriesList.find((x) => x.id === form.seriesId);
                  return s && (s.poster || s.thumbnail || s.trailerSrc) ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
                      This {form.contentType === 'podcast' ? 'show' : 'series'} already has its own artwork/trailer — you can leave poster, thumbnail, and trailer blank below unless this specific episode needs its own.
                    </p>
                  ) : null;
                })()}
                <label>{form.contentType === 'podcast' ? 'Season (use 1 if this show doesn\u2019t have seasons)' : 'Season'}</label>
                <input type="number" min="1" value={form.season} onChange={(e) => update('season', e.target.value)} required />
                <label>Episode number within season</label>
                <input type="number" min="1" value={form.seriesOrder} onChange={(e) => update('seriesOrder', e.target.value)} required />
              </>
            )}

            {form.contentType === 'bonus' && (
              <>
                <label>Which show is this bonus content for?</label>
                <select value={form.seriesId} onChange={(e) => update('seriesId', e.target.value)} required>
                  <option value="">Choose a series or show…</option>
                  {seriesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
                  Give it a descriptive title above — e.g. &ldquo;Behind the Scenes: Episode 3&rdquo; or
                  &ldquo;Official Trailer&rdquo; — it&rsquo;ll show up in a Bonus Content section on that show&rsquo;s page.
                  This one isn&rsquo;t part of the show&rsquo;s own numbered episodes, so no season/episode number needed.
                </p>
              </>
            )}

            <label>Main genre</label>
            <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
              {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>

            <label>Specific genre (e.g. "Cosmic Horror")</label>
            <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />

            <label>Suggested tier — the admin has final say</label>
            <select value={form.tier} onChange={(e) => update('tier', e.target.value)} required>
              <option value="free">Free</option>
              <option value="premium">{SITE.premiumTier} (premium)</option>
            </select>

            {form.contentType === 'podcast' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal', marginBottom: '0.8rem' }}>
                <input type="checkbox" checked={skipVideo} onChange={(e) => setSkipVideo(e.target.checked)} />
                Audio only — no video for this episode
              </label>
            )}

            {!skipVideo && <label>Video source</label>}
            {!skipVideo && (
            <div className="video-source-toggle" role="group" aria-label="Video source">
              <button
                type="button"
                className={videoSource === 'file' ? 'on' : ''}
                onClick={() => setVideoSource('file')}
              >
                Upload a file
              </button>
              <button
                type="button"
                className={videoSource === 'link' ? 'on' : ''}
                onClick={() => setVideoSource('link')}
              >
                Import from a link
              </button>
              <button
                type="button"
                className={videoSource === 'cloudflare-id' ? 'on' : ''}
                onClick={() => setVideoSource('cloudflare-id')}
              >
                Cloudflare video ID
              </button>
            </div>
            )}

            {!skipVideo && videoSource === 'file' && (
              <>
                <UppyFilePicker
                  key={`video-${pickerResetKey}`}
                  accept="video/*"
                  note="Any video file, no size limit"
                  onFileSelected={handleVideoFileChange}
                />
                {!file && <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '-0.5rem', marginBottom: '0.8rem' }}>Required before you can submit.</p>}
              </>
            )}
            {!skipVideo && videoSource === 'link' && (
              <>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://…/your-episode.mp4"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  style={{ marginBottom: '0.5rem' }}
                />
                <p className="video-source-help">
                  Use this if the in-app upload keeps failing on your network. Paste a direct link to
                  the video file — a signed download link from Dropbox, Google Drive, WeTransfer, or
                  similar works, as does any plain .mp4/.mov URL. A page that just shows a video
                  player (like a YouTube watch link) won&rsquo;t work — there&rsquo;s no single file
                  there to fetch.
                </p>
                <p className="video-source-help">
                  The link is only used once, to bring the file in. After that it plays entirely
                  through our own video hosting, the same as a regular upload — nobody watching ever
                  sees or can reach the original link, and downloads stay blocked exactly like any
                  other episode. We won&rsquo;t auto-detect the runtime for a link, so enter it below.
                </p>
              </>
            )}
            {!skipVideo && videoSource === 'cloudflare-id' && (
              <>
                <input
                  type="text"
                  placeholder="e.g. 6b1b3f4a2e9c4d0a8f7e1c2d3b4a5f6e"
                  value={manualVideoUid}
                  onChange={(e) => setManualVideoUid(e.target.value)}
                  style={{ marginBottom: '0.5rem' }}
                />
                <p className="video-source-help">
                  For a video that's already uploaded to Cloudflare Stream — it has to already say
                  &ldquo;ready to stream&rdquo; before this will work. We won&rsquo;t auto-detect the
                  runtime here either, so enter it below.
                </p>
              </>
            )}

            {form.contentType === 'podcast' && (
              <>
                <label>
                  Audio {skipVideo ? '' : <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — add it alongside video, or skip video above for audio-only</span>}
                </label>
                {audioImportedUrl ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--ok)', marginBottom: '0.8rem' }}>
                    ✓ Audio file ready.{' '}
                    <button type="button" onClick={() => { setAudioImportedUrl(null); setAudioUrl(''); }} style={{ color: 'var(--ink-dim)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
                      Remove
                    </button>
                  </p>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="https://…/your-episode.mp3"
                        value={audioUrl}
                        onChange={(e) => setAudioUrl(e.target.value)}
                        style={{ flex: 1, marginBottom: 0 }}
                      />
                      <button
                        type="button"
                        className="account-btn-secondary"
                        style={{ width: 'auto' }}
                        disabled={audioImporting || !audioUrl.trim()}
                        onClick={async () => {
                          setAudioImporting(true);
                          setAudioError(null);
                          try {
                            const res = await fetch('/api/creator/import-audio-url', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ audioUrl: audioUrl.trim() })
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || 'Could not import that audio file.');
                            setAudioImportedUrl(data.audioUrl);
                          } catch (err) {
                            setAudioError(err.message);
                          } finally {
                            setAudioImporting(false);
                          }
                        }}
                      >
                        {audioImporting ? 'Importing…' : 'Import'}
                      </button>
                    </div>
                    {audioError && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '-0.3rem' }}>{audioError}</p>}
                    <p className="video-source-help">
                      Paste a direct link to your audio file — a signed download link from Dropbox, Google
                      Drive, WeTransfer, or similar, or any plain .mp3/.m4a/.wav URL. Capped at 150MB.
                    </p>
                  </>
                )}
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal', marginTop: '0.6rem' }}>
              <input type="checkbox" checked={form.featured} onChange={(e) => update('featured', e.target.checked)} />
              Request homepage hero rotation <span style={{ opacity: 0.65 }}>— admin has final say on what actually rotates through</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal' }}>
              <input type="checkbox" checked={form.adsEnabled} onChange={(e) => update('adsEnabled', e.target.checked)} />
              Show ads on this episode {form.tier === 'premium' && `(ignored — ${SITE.premiumTier} members never see ads regardless)`}
            </label>

            {form.adsEnabled && (
              <>
                <label>Ad break times <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — comma-separated MM:SS, e.g. "0:00, 10:00, 20:30". Leave blank for a single ad at the start.</span></label>
                <input
                  type="text"
                  value={form.adBreaksText}
                  onChange={(e) => update('adBreaksText', e.target.value)}
                  placeholder="0:00"
                  style={{ marginBottom: '0.8rem' }}
                />
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal' }}>
              <input type="checkbox" checked={form.isOriginal} onChange={(e) => update('isOriginal', e.target.checked)} />
              Tapa Original <span style={{ opacity: 0.65 }}>— exclusive to Studio Tapa, independent of free/premium tier</span>
            </label>

            <label>Funding link <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — your own project/funding page</span></label>
            <input type="url" value={form.fundingUrl} onChange={(e) => update('fundingUrl', e.target.value)} placeholder="https://kickstarter.com/..." style={{ marginBottom: '0.8rem' }} />

            <label>Poster image — 2:3 portrait (roughly 400×600px or larger), optional</label>
            <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

            <label>Thumbnail image — 16:9 landscape (roughly 640×360px or larger), optional</label>
            <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

            <label>Trailer clip — 15–30s cut works well; used for the "Watch trailer" button and the homepage hero if this gets featured, optional</label>
            <div className="video-source-toggle" role="group" aria-label="Trailer source">
              <button
                type="button"
                className={trailerSource === 'file' ? 'on' : ''}
                onClick={() => setTrailerSource('file')}
                disabled={videoSource === 'cloudflare-id'}
              >
                Upload a file
              </button>
              <button
                type="button"
                className={trailerSource === 'cloudflare-id' ? 'on' : ''}
                onClick={() => setTrailerSource('cloudflare-id')}
              >
                Cloudflare video ID
              </button>
            </div>
            {videoSource === 'cloudflare-id' && (
              <p style={{ fontSize: '0.76rem', color: 'var(--ink-dim)', marginTop: '-0.4rem', marginBottom: '0.5rem' }}>
                A pasted main video can't be paired with an uploaded trailer file — use a trailer video ID instead, or skip the trailer.
              </p>
            )}
            {trailerSource === 'file' ? (
              <UppyFilePicker
                key={`trailer-${pickerResetKey}`}
                accept="video/*"
                note="Optional — a short cut of the episode"
                onFileSelected={setTrailerFile}
              />
            ) : (
              <input
                type="text"
                placeholder="e.g. 9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c"
                value={manualTrailerUid}
                onChange={(e) => setManualTrailerUid(e.target.value)}
                style={{ marginBottom: '0.5rem' }}
              />
            )}

            <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
              Poster, thumbnail, and trailer aren&rsquo;t required to submit — but a submission with all three tends to get approved faster, since there&rsquo;s nothing left for the admin to chase down.
            </p>

            <button className="account-btn-primary" type="submit" disabled={submittingManual}>
              {submittingManual ? 'Submitting…' : 'Submit for review'}
              Submit for review
            </button>
          </form>

          {formError && <p style={{ marginTop: '0.8rem', color: 'var(--danger)' }}>{formError}</p>}
        </div>

        <div className="account-card" style={{ marginTop: '1.5rem' }}>
          <div className="account-eyebrow">Your work</div>
          <h3>See and manage what you've submitted</h3>
          <p style={{ margin: '0.6rem 0 1rem', fontSize: '0.87rem', color: 'var(--ink-dim)' }}>
            Pending review, already live, edit, add artwork, replace video, captions, or request deletion —
            it's all on your <Link href="/creator/my-work" style={{ color: 'var(--signal-amber)' }}>Your Work</Link> page now.
          </p>
          <Link href="/creator/my-work" className="account-btn-primary" style={{ width: 'auto', display: 'inline-block', textDecoration: 'none' }}>
            Go to Your Work →
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
