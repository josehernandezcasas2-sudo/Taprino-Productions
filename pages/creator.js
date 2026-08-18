import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getAllSeries } from '../lib/series';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { useUpload } from '../contexts/UploadContext';
import { readVideoDuration, formatRuntime } from '../lib/videoMetadata';
import dynamic from 'next/dynamic';

// Uppy touches browser-only APIs during its own setup — rendering it
// during Next.js's server-side render pass (this page uses
// getServerSideProps) throws before the page ever reaches the browser.
// { ssr: false } skips that entirely: the component only ever renders
// client-side, after hydration.
const UppyFilePicker = dynamic(() => import('../components/UppyFilePicker'), { ssr: false });
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import EditSubmissionModal from '../components/EditSubmissionModal';
import ArtworkModal from '../components/ArtworkModal';
import DeleteRequestModal from '../components/DeleteRequestModal';
import CaptionUploadModal from '../components/CaptionUploadModal';
import ReplaceVideoModal from '../components/ReplaceVideoModal';
import { SITE } from '../lib/siteConfig';

// SECURITY: same enforcement pattern as /admin — a non-creator is
// redirected server-side before this page (or any creator-only data) ever
// renders.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator) {
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
  { value: 'podcast', label: 'Podcast' }
];

const EMPTY_FORM = {
  title: '', description: '', tier: 'free',
  genre: '', mainGenre: MAIN_GENRES[0], contentType: 'short',
  seriesId: '', season: '1', seriesOrder: '', artist: '', runtime: ''
};

const STATUS_LABEL = {
  pending: { text: 'Pending review', color: 'var(--signal-amber)' },
  approved: { text: 'Approved — live', color: 'var(--ok)' },
  rejected: { text: 'Rejected', color: 'var(--danger)' }
};

const CF_STATE_LABEL = {
  pendingupload: 'Waiting on upload',
  downloading: 'Cloudflare receiving file…',
  queued: 'Queued for processing',
  inprogress: 'Processing…',
  ready: 'Ready to stream',
  error: 'Processing failed'
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
  const seriesList = allSeries;
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [videoSource, setVideoSource] = useState('file'); // 'file' | 'link'
  const [videoUrl, setVideoUrl] = useState('');
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [trailerFile, setTrailerFile] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submissions, setSubmissions] = useState(null);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupBySeries, setGroupBySeries] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [artworkSubmission, setArtworkSubmission] = useState(null);
  const [deletingSubmission, setDeletingSubmission] = useState(null);
  const [captionSubmission, setCaptionSubmission] = useState(null);
  const [deleteActionError, setDeleteActionError] = useState(null);
  const [replacingVideoSubmission, setReplacingVideoSubmission] = useState(null);
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

  async function requestEpisodeDeletion(reason) {
    const res = await fetch('/api/creator/request-episode-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId: deletingSubmission.id, action: 'request', reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit the request.');
    setDeletingSubmission(null);
    loadSubmissions();
  }

  async function cancelEpisodeDeletion(episodeId) {
    setDeleteActionError(null);
    try {
      const res = await fetch('/api/creator/request-episode-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, action: 'cancel' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel the request.');
      loadSubmissions();
    } catch (err) {
      setDeleteActionError(err.message);
    }
  }

  async function loadSubmissions() {
    setLoadingSubmissions(true);
    try {
      const res = await fetch('/api/creator/my-submissions');
      const data = await res.json();
      if (res.ok) setSubmissions(data.submissions);
    } catch (err) {
      // Leave submissions as whatever it already was — a failed refresh
      // shouldn't wipe out what's already showing.
    }
    setLoadingSubmissions(false);
  }

  useEffect(() => {
    loadSubmissions();
  }, []);

  // Refreshes the submissions list the moment an upload finishes, so the
  // new one appears without the creator having to manually reload.
  useEffect(() => {
    if (activeUpload && activeUpload.status === 'done') {
      loadSubmissions();
    }
  }, [activeUpload && activeUpload.status]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (videoSource === 'file' && !file) {
      setFormError('Please choose a video file.');
      return;
    }
    if (videoSource === 'link' && !videoUrl.trim()) {
      setFormError('Paste a link to your video file.');
      return;
    }
    if (videoSource === 'link' && !form.runtime.trim()) {
      // Auto-detection needs an actual File object to read — there isn't
      // one for a link import, so this is the one field link-mode can't
      // fill in for you.
      setFormError('Enter the runtime (link imports can\'t detect it automatically).');
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
      ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
      ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {})
    };

    // Fire-and-forget on purpose — the upload now lives in the shared
    // context, not this page. It keeps running even if this page unmounts
    // (navigating elsewhere), which is the whole point.
    if (videoSource === 'link') {
      // No trailer support for link imports yet — see UploadContext's
      // startUrlImport for why this is a separate, simpler path.
      startUrlImport(videoUrl.trim(), form.title ? `${form.title}.mp4` : undefined, submissionData);
    } else {
      startUpload(file, submissionData, trailerFile || undefined);
    }

    // Reset the form immediately so the creator can start filling out a
    // new submission right away, without waiting for this one to finish.
    clearDraft();
    setForm(EMPTY_FORM);
    setFile(null);
    setVideoUrl('');
    setPosterFile(null);
    setThumbnailFile(null);
    setTrailerFile(null);
    setRuntimeStatus(null);
    setPickerResetKey((k) => k + 1);
  }

  // Derived stats — computed client-side from the submissions list already
  // in memory rather than a separate endpoint, since this is cheap at the
  // scale of one creator's own history.
  const total = submissions ? submissions.length : 0;
  const approvedCount = submissions ? submissions.filter((s) => s.status === 'approved').length : 0;
  const pendingCount = submissions ? submissions.filter((s) => s.status === 'pending').length : 0;
  const rejectedCount = submissions ? submissions.filter((s) => s.status === 'rejected').length : 0;
  const reviewedCount = approvedCount + rejectedCount;
  const approvalRate = reviewedCount > 0 ? Math.round((approvedCount / reviewedCount) * 100) : null;
  const turnaroundHoursList = submissions
    ? submissions
        .filter((s) => s.reviewedAt && s.createdAt)
        .map((s) => (new Date(s.reviewedAt).getTime() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60))
    : [];
  const avgTurnaroundHours = turnaroundHoursList.length > 0
    ? Math.round(turnaroundHoursList.reduce((a, b) => a + b, 0) / turnaroundHoursList.length)
    : null;
  const missingArtworkCount = submissions
    ? submissions.filter((s) => s.status !== 'rejected' && s.missingArtwork).length
    : 0;

  const filteredSubmissions = (submissions || []).filter((s) => statusFilter === 'all' || s.status === statusFilter);

  // Grouped view buckets by series name (falling back to "Standalone" for
  // anything without a series), preserving each bucket's own sort order
  // from the already-newest-first API response.
  const groupedSubmissions = groupBySeries
    ? filteredSubmissions.reduce((groups, s) => {
        const key = s.seriesName || 'Standalone';
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
        return groups;
      }, {})
    : null;

  function renderCard(s) {
    return (
      <div key={s.id} className="submission-card">
        <div className="submission-thumb">
          {s.thumbnail ? (
            <img src={s.thumbnail} alt="" />
          ) : (
            <div className="submission-thumb-placeholder">
              {s.cloudflareState === 'error' ? '⚠' : '⏳'}
            </div>
          )}
        </div>
        <div className="submission-info">
          <h4>{s.title}</h4>
          <p>{s.description}</p>
          <div className="submission-badges">
            <span style={{ color: (STATUS_LABEL[s.status] || {}).color }}>
              {(STATUS_LABEL[s.status] || {}).text || s.status}
            </span>
            {s.cloudflareState && (
              <span className={s.cloudflareState === 'error' ? 'submission-badge-error' : ''}>
                {CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState}
              </span>
            )}
            {s.status === 'approved' && <span>👁 {s.viewCount} view{s.viewCount === 1 ? '' : 's'}</span>}
            {s.missingArtwork && s.status !== 'rejected' && <span>🖼 missing artwork</span>}
            {!s.captionsUrl && s.status === 'approved' && <span>💬 no captions</span>}
            {s.artworkPending && <span>⏳ artwork change awaiting approval</span>}
            {s.deletionRequested && <span>🗑 pending deletion</span>}
          </div>
          {s.status === 'rejected' && s.rejectionReason && (
            <p className="submission-rejection">Admin's note: {s.rejectionReason}</p>
          )}
          {s.cloudflareState === 'error' && s.cloudflareError && (
            <p className="submission-rejection">Upload problem: {s.cloudflareError} — this file likely needs to be re-exported and re-submitted.</p>
          )}
          {s.deletionRequested && (
            <p className="submission-rejection">Deletion reason: {s.deletionReason}</p>
          )}
          <div className="submission-card-actions">
            {s.status === 'pending' && !s.deletionRequested && (
              <button onClick={() => setEditingSubmission(s)}>✎ Edit</button>
            )}
            {!s.deletionRequested && (
              <button onClick={() => setArtworkSubmission(s)}>
                🖼 {s.poster || s.thumbnail ? 'Replace artwork' : 'Add artwork'}
              </button>
            )}
            {!s.deletionRequested && (
              <button onClick={() => setReplacingVideoSubmission(s)}>🎬 Replace video</button>
            )}
            {!s.deletionRequested && (
              <button onClick={() => setCaptionSubmission(s)}>
                💬 {s.captionsUrl ? 'Replace captions' : 'Add captions'}
              </button>
            )}
            {s.deletionRequested ? (
              <button onClick={() => cancelEpisodeDeletion(s.id)}>Cancel deletion request</button>
            ) : (
              <button onClick={() => setDeletingSubmission(s)}>🗑 Request deletion</button>
            )}
          </div>
        </div>
      </div>
    );
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
        <p className="library-sub" style={{ marginBottom: '1.2rem' }}>Submit new episodes and track your review status.</p>

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

            <label>Content type</label>
            <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
              {CONTENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            {form.contentType === 'series' && (
              <>
                <label>Series</label>
                <select value={form.seriesId} onChange={(e) => update('seriesId', e.target.value)} required>
                  <option value="">Choose a series…</option>
                  {seriesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__new__">A new series not listed here</option>
                </select>
                {form.seriesId === '__new__' && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
                    Prefer setting this up properly first? Use the &ldquo;Series info&rdquo; section below to create the series with its own trailer and artwork — then it&rsquo;ll show up in this dropdown.
                  </p>
                )}
                {form.seriesId && form.seriesId !== '__new__' && (() => {
                  const s = seriesList.find((x) => x.id === form.seriesId);
                  return s && (s.poster || s.thumbnail || s.trailerSrc) ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
                      This series already has its own artwork/trailer — you can leave poster, thumbnail, and trailer blank below unless this specific episode needs its own.
                    </p>
                  ) : null;
                })()}
                <label>Season</label>
                <input type="number" min="1" value={form.season} onChange={(e) => update('season', e.target.value)} required />
                <label>Episode number within season</label>
                <input type="number" min="1" value={form.seriesOrder} onChange={(e) => update('seriesOrder', e.target.value)} required />
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

            <label>Video source</label>
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
            </div>

            {videoSource === 'file' ? (
              <>
                <UppyFilePicker
                  key={`video-${pickerResetKey}`}
                  accept="video/*"
                  note="Any video file, no size limit"
                  onFileSelected={handleVideoFileChange}
                />
                {!file && <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '-0.5rem', marginBottom: '0.8rem' }}>Required before you can submit.</p>}
              </>
            ) : (
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

            <label>Poster image — 2:3 portrait (roughly 400×600px or larger), optional</label>
            <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

            <label>Thumbnail image — 16:9 landscape (roughly 640×360px or larger), optional</label>
            <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

            <label>Trailer clip — 15–30s cut works well; used for the "Watch trailer" button and the homepage hero if this gets featured, optional</label>
            <UppyFilePicker
              key={`trailer-${pickerResetKey}`}
              accept="video/*"
              note="Optional — a short cut of the episode"
              onFileSelected={setTrailerFile}
            />

            <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
              Poster, thumbnail, and trailer aren&rsquo;t required to submit — but a submission with all three tends to get approved faster, since there&rsquo;s nothing left for the admin to chase down.
            </p>

            <button className="account-btn-primary" type="submit">
              Submit for review
            </button>
          </form>

          {formError && <p style={{ marginTop: '0.8rem', color: 'var(--danger)' }}>{formError}</p>}
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1.5rem' }}>
          Setting up a series trailer or artwork, or need to remove a series? Head to <Link href="/creator/series" style={{ color: 'var(--signal-amber)' }}>Series management</Link>.
        </p>

        <div className="account-card" style={{ marginTop: '1.5rem' }}>
          <div className="account-eyebrow">Your submissions</div>
          <p style={{ margin: '0 0 1rem', fontSize: '0.87rem', color: 'var(--ink-dim)' }}>
            Want to see how they&rsquo;re doing?{' '}
            <Link href="/creator/analytics" style={{ color: 'var(--signal-amber)' }}>
              View your numbers →
            </Link>
          </p>
          <h3>What you've sent in so far</h3>

          {deleteActionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{deleteActionError}</p>}

          {loadingSubmissions && <p>Loading…</p>}

          {!loadingSubmissions && submissions && submissions.length === 0 && (
            <p>Nothing submitted yet — your first one will show up here once it's uploaded.</p>
          )}

          {!loadingSubmissions && submissions && submissions.length > 0 && (
            <>
              <div className="dash-stats">
                <div className="dash-stat">
                  <div className="dash-stat-value">{total}</div>
                  <div className="dash-stat-label">Total</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{pendingCount}</div>
                  <div className="dash-stat-label">Pending</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{approvedCount}</div>
                  <div className="dash-stat-label">Approved</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{approvalRate === null ? '—' : `${approvalRate}%`}</div>
                  <div className="dash-stat-label">Approval rate</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{avgTurnaroundHours === null ? '—' : `${avgTurnaroundHours}h`}</div>
                  <div className="dash-stat-label">Avg. review time</div>
                </div>
              </div>

              {missingArtworkCount > 0 && (
                <div className="dash-nudge">
                  🖼 {missingArtworkCount} submission{missingArtworkCount === 1 ? '' : 's'} still missing a poster or thumbnail — use &ldquo;Add artwork&rdquo; below on any of them, pending or already live.
                </div>
              )}

              <div className="dash-controls">
                {['all', 'pending', 'approved', 'rejected'].map((f) => (
                  <button
                    key={f}
                    className={`dash-filter-btn ${statusFilter === f ? 'active' : ''}`}
                    onClick={() => setStatusFilter(f)}
                  >
                    {f === 'all' ? 'All' : STATUS_LABEL[f].text}
                  </button>
                ))}
                <button
                  className={`dash-filter-btn ${groupBySeries ? 'active' : ''}`}
                  onClick={() => setGroupBySeries((v) => !v)}
                  style={{ marginLeft: 'auto' }}
                >
                  {groupBySeries ? '▤ Grouped by series' : '☰ Group by series'}
                </button>
              </div>

              {filteredSubmissions.length === 0 && (
                <p>Nothing matches this filter.</p>
              )}

              {groupBySeries ? (
                <div className="submission-grid">
                  {Object.entries(groupedSubmissions).map(([seriesName, items]) => (
                    <div key={seriesName} style={{ gridColumn: '1 / -1' }}>
                      <div className="dash-group-heading">{seriesName} ({items.length})</div>
                      <div className="submission-grid">
                        {items.map(renderCard)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="submission-grid">
                  {filteredSubmissions.map(renderCard)}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="site-footer">
        <span>{SITE.nameUpper}</span>
        <span>© {new Date().getFullYear()} {SITE.studio}</span>
        <span className="footer-legal">
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/cookies">Cookies</a>
        </span>
      </footer>

      {editingSubmission && (
        <EditSubmissionModal
          submission={editingSubmission}
          allSeries={seriesList}
          onClose={() => setEditingSubmission(null)}
          onSaved={() => { setEditingSubmission(null); loadSubmissions(); }}
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
    </>
  );
}
