import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useUpload } from '../contexts/UploadContext';
import { readVideoDuration, formatRuntime } from '../lib/videoMetadata';
import { parseAdBreaksInput } from '../lib/adBreaks';
import { useDraftAutosave } from '../lib/useDraftAutosave';
import { SITE } from '../lib/siteConfig';
import { CONTENT_RATINGS } from '../lib/contentRatings';
import { VIDEO_PROVIDERS } from '../lib/videoProviders';

// Same reasoning as CreatorSubmissionForm's own use of this — Uppy touches
// browser-only APIs during setup, so it has to be skipped entirely during
// server-side rendering.
const UppyFilePicker = dynamic(() => import('./UppyFilePicker'), { ssr: false });

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
  creatorEmail: '', title: '', description: '', contentType: 'short', rating: '', bonusParent: '',
  seriesId: '', newSeriesName: '', season: '1', seriesOrder: '',
  genre: '', mainGenre: MAIN_GENRES[0], artist: '', runtime: '', releaseYear: '',
  tier: 'free', status: 'pending', featured: false, adsEnabled: true, isOriginal: false, fundingUrl: '', adBreaksText: '0:00'
};

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

// Admin-only direct add, bypassing the pending-review queue entirely
// (see the Status field below). Shares the exact same upload machinery as
// CreatorSubmissionForm — the same UppyFilePicker, the same useUpload()
// TUS pipeline, the same startUrlImport — pointed at this endpoint
// (/api/admin/manual-episode) instead of submit-episode.js. The
// paste-a-video-ID path stays available underneath "Video source" for
// when the in-app upload itself is the thing that's broken (ad blocker,
// firewall) and a video was uploaded directly through Cloudflare's own
// Stream dashboard instead.
export default function ManualEpisodeForm({ allSeries, standaloneEpisodes, onCreated }) {
  const { activeUpload, startUpload, startUrlImport } = useUpload();
  const [form, setForm] = useState(EMPTY_FORM);
  const { existingDraft, scheduleSave, clearDraft, dismissDraft } = useDraftAutosave('admin_episode');
  const [draftApplied, setDraftApplied] = useState(false);

  const readyToAutosave = existingDraft === null || draftApplied;
  useEffect(() => {
    if (readyToAutosave && form.title.trim()) {
      scheduleSave({ form });
    }
  }, [form, readyToAutosave, scheduleSave]);

  function resumeDraft() {
    if (existingDraft && existingDraft.form) setForm(existingDraft.form);
    setDraftApplied(true);
  }
  // 'upload' | 'link' | 'cloudflare-id' — only meaningful when
  // videoProvider === 'cloudflare'; Bunny/Mux stay paste-only (see the
  // note further down about neither being wired to its own API yet).
  // Defaults to 'upload' so this reflects the same easy path the
  // creator-facing form defaults to, rather than requiring a manual
  // Cloudflare-dashboard round trip every time.
  const [videoSource, setVideoSource] = useState('upload');
  const [file, setFile] = useState(null);
  const [videoLinkUrl, setVideoLinkUrl] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState(null); // null | 'detecting' | 'detected' | 'failed'
  const [pickerResetKey, setPickerResetKey] = useState(0);
  const [videoUid, setVideoUid] = useState('');
  const [videoCheck, setVideoCheck] = useState(null);
  const [videoProvider, setVideoProvider] = useState('cloudflare');
  const [bunnyPullZoneHost, setBunnyPullZoneHost] = useState('');
  const [bunnyVideoId, setBunnyVideoId] = useState('');
  const [muxPlaybackId, setMuxPlaybackId] = useState('');
  const [trailerSource, setTrailerSource] = useState('file'); // 'file' | 'cloudflare-id'
  const [trailerFile, setTrailerFile] = useState(null);
  const [trailerUid, setTrailerUid] = useState('');
  const [skipVideo, setSkipVideo] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioImporting, setAudioImporting] = useState(false);
  const [audioImportedUrl, setAudioImportedUrl] = useState(null);
  const [audioBytes, setAudioBytes] = useState(null);
  const [audioError, setAudioError] = useState(null);
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successId, setSuccessId] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function checkVideo() {
    if (!videoUid.trim()) return;
    setVideoCheck('checking');
    try {
      const res = await fetch(`/api/admin/check-cloudflare-video?uid=${encodeURIComponent(videoUid.trim())}`);
      const data = await res.json();
      setVideoCheck(res.ok ? data : { error: data.error });
    } catch (err) {
      setVideoCheck({ error: 'Could not reach the check endpoint.' });
    }
  }

  // Same as the creator form's own handler — reads the video's duration
  // client-side the moment it's chosen and fills in the runtime field,
  // left editable in case auto-detection gets an oddly encoded file wrong.
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
      setRuntimeStatus('failed');
    }
  }

  function resetFormFields() {
    clearDraft();
    setForm(EMPTY_FORM);
    setVideoSource('upload');
    setFile(null);
    setVideoLinkUrl('');
    setRuntimeStatus(null);
    setPickerResetKey((k) => k + 1);
    setVideoUid('');
    setVideoCheck(null);
    setVideoProvider('cloudflare');
    setBunnyPullZoneHost('');
    setBunnyVideoId('');
    setMuxPlaybackId('');
    setTrailerSource('file');
    setTrailerFile(null);
    setTrailerUid('');
    setSkipVideo(false);
    setAudioUrl('');
    setAudioImportedUrl(null);
    setAudioBytes(null);
    setAudioError(null);
    setPosterFile(null);
    setThumbnailFile(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccessId(null);
    if (skipVideo && !audioImportedUrl) {
      setError('Import an audio file first, or uncheck "Audio only" to link a video instead.');
      return;
    }
    if (!skipVideo) {
      if (videoProvider === 'cloudflare') {
        if (videoSource === 'upload' && !file) {
          setError('Choose a video file, or switch to a link/video ID above, or check "Audio only".');
          return;
        }
        if (videoSource === 'link' && !videoLinkUrl.trim()) {
          setError('Paste a link to the video file.');
          return;
        }
        if (videoSource === 'cloudflare-id' && !videoUid.trim()) {
          setError('Paste the Cloudflare video ID first, or check "Audio only" above for an audio-only episode.');
          return;
        }
      }
      if (videoProvider === 'bunny' && (!bunnyPullZoneHost.trim() || !bunnyVideoId.trim())) {
        setError('Enter both the Bunny.net pull zone hostname and the video ID, or check "Audio only" above.');
        return;
      }
      if (videoProvider === 'mux' && !muxPlaybackId.trim()) {
        setError('Paste the Mux playback ID first, or check "Audio only" above for an audio-only episode.');
        return;
      }
    }
    // Same rule the creator form enforces — a second submit here would
    // otherwise stomp the first upload's own progress tracking, since
    // both share the one global upload context.
    if (activeUpload && activeUpload.status !== 'done' && activeUpload.status !== 'error') {
      setError('An upload is already in progress — wait for it to finish before starting another.');
      return;
    }

    // Uses startUpload for a real file, or a direct fetch for every other
    // path (a video already exists somewhere — Cloudflare/Bunny/Mux — so
    // there's nothing to track upload progress for). videoSource === 'link'
    // is the one remaining case, handled separately below via
    // startUrlImport, since it has its own progress model (Cloudflare's
    // own import percentage, not upload bytes).
    const usesTrackedUpload = !skipVideo && videoProvider === 'cloudflare' && (videoSource === 'upload' || videoSource === 'link');

    setSaving(true);
    try {
      const [posterBase64, thumbnailBase64] = await Promise.all([readAsDataUrl(posterFile), readAsDataUrl(thumbnailFile)]);
      const [bonusParentType, bonusParentId] = form.bonusParent ? form.bonusParent.split(':') : [null, null];
      const submissionData = {
        ...form,
        adBreakSeconds: form.adsEnabled ? parseAdBreaksInput(form.adBreaksText) : [0],
        bonusParentType,
        bonusParentId,
        ...(skipVideo ? {} : {
          videoProvider,
          ...(videoProvider === 'cloudflare' && videoSource === 'cloudflare-id' ? { cloudflareVideoUid: videoUid.trim() } : {}),
          ...(videoProvider === 'bunny' ? { bunnyPullZoneHost: bunnyPullZoneHost.trim(), bunnyVideoId: bunnyVideoId.trim() } : {}),
          ...(videoProvider === 'mux' ? { muxPlaybackId: muxPlaybackId.trim() } : {})
        }),
        ...(audioImportedUrl ? { audioUrl: audioImportedUrl, audioBytes } : {}),
        ...(trailerSource === 'cloudflare-id' && trailerUid.trim() ? { trailerCloudflareUid: trailerUid.trim() } : {}),
        ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
        ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {})
      };
      const doneMessages = {
        label: 'Episode created',
        meta: form.status === 'approved' ? 'Live now.' : form.status === 'rejected' ? 'Saved, marked rejected.' : 'Saved — sitting in the pending queue.'
      };

      if (!usesTrackedUpload) {
        const res = await fetch('/api/admin/manual-episode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submissionData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create the episode.');
        setSuccessId(data.episodeId);
        onCreated();
      } else if (videoSource === 'link') {
        startUrlImport(videoLinkUrl.trim(), form.title ? `${form.title}.mp4` : undefined, submissionData, '/api/admin/manual-episode', doneMessages);
      } else {
        startUpload(file, submissionData, trailerSource === 'file' ? (trailerFile || undefined) : undefined, 'tus', '/api/admin/manual-episode', doneMessages);
      }
      resetFormFields();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="account-card" style={{ maxWidth: 'none' }}>
      <div className="account-eyebrow">Manual episode entry</div>
      <h3>Add an episode directly — no review queue</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
        Same upload flow the creator submission form uses — pick a video file below and it uploads right
        here, no separate Cloudflare dashboard trip needed. If the in-app upload ever fails on you (ad
        blocker, firewall, flaky network), switch to &ldquo;Import from a link&rdquo; or upload the file
        directly at <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer" style={{ color: 'var(--signal-amber)' }}>Cloudflare&rsquo;s Stream dashboard</a> and
        paste the resulting video ID under &ldquo;Cloudflare video ID&rdquo; instead.
      </p>

      {successId && (
        <p style={{ color: 'var(--ok)', fontSize: '0.85rem' }}>✓ Created — episode ID: {successId}</p>
      )}

      {existingDraft && !draftApplied && (
        <div className="account-card" style={{ maxWidth: 'none', background: 'rgba(248,95,115,0.1)', border: '1px solid rgba(248,95,115,0.3)' }}>
          <p style={{ margin: '0 0 0.8rem' }}>You have an unsaved draft of an episode submission. Resume where you left off?</p>
          <button className="account-btn-primary" type="button" style={{ width: 'auto', marginRight: '0.6rem' }} onClick={resumeDraft}>Resume draft</button>
          <button className="account-btn-secondary" type="button" style={{ width: 'auto' }} onClick={dismissDraft}>Start fresh</button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label>Attribute to creator — email, optional (defaults to you)</label>
        <input type="email" value={form.creatorEmail} onChange={(e) => update('creatorEmail', e.target.value)} placeholder="creator@example.com" />

        {form.contentType === 'podcast' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal', marginBottom: '0.8rem' }}>
            <input type="checkbox" checked={skipVideo} onChange={(e) => setSkipVideo(e.target.checked)} />
            Audio only — no video for this episode
          </label>
        )}

        {!skipVideo && (
          <>
            <label>Video provider</label>
            <select value={videoProvider} onChange={(e) => setVideoProvider(e.target.value)} style={{ marginBottom: '0.6rem' }}>
              {VIDEO_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>

            {videoProvider === 'cloudflare' && (
              <>
                <label>Video source</label>
                <div className="video-source-toggle" role="group" aria-label="Video source">
                  <button type="button" className={videoSource === 'upload' ? 'on' : ''} onClick={() => setVideoSource('upload')}>
                    Upload a file
                  </button>
                  <button type="button" className={videoSource === 'link' ? 'on' : ''} onClick={() => setVideoSource('link')}>
                    Import from a link
                  </button>
                  <button type="button" className={videoSource === 'cloudflare-id' ? 'on' : ''} onClick={() => setVideoSource('cloudflare-id')}>
                    Cloudflare video ID
                  </button>
                </div>

                {videoSource === 'upload' && (
                  <>
                    <UppyFilePicker
                      key={`video-${pickerResetKey}`}
                      accept="video/*"
                      note="Any video file, no size limit"
                      onFileSelected={handleVideoFileChange}
                    />
                    {!file && form.contentType !== 'podcast' && (
                      <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '-0.5rem', marginBottom: '0.8rem' }}>Required before you can submit.</p>
                    )}
                  </>
                )}

                {videoSource === 'link' && (
                  <>
                    <input
                      type="url"
                      inputMode="url"
                      placeholder="https://…/the-episode.mp4"
                      value={videoLinkUrl}
                      onChange={(e) => setVideoLinkUrl(e.target.value)}
                      style={{ marginBottom: '0.5rem' }}
                    />
                    <p className="video-source-help">
                      Paste a direct link to the video file — a signed download link from Dropbox, Google
                      Drive, WeTransfer, or similar works, as does any plain .mp4/.mov URL. Cloudflare
                      fetches it once and it plays through our own hosting from then on, same as a
                      regular upload.
                    </p>
                  </>
                )}

                {videoSource === 'cloudflare-id' && (
                  <>
                    <label>Cloudflare video ID{form.contentType !== 'podcast' && ' — required'}</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
                      <input type="text" value={videoUid} onChange={(e) => { setVideoUid(e.target.value); setVideoCheck(null); }} placeholder="e.g. c792e0c49f72f77e00693d10c0ef02cd" style={{ flex: 1 }} required={form.contentType !== 'podcast'} />
                      <button type="button" className="account-btn-secondary" onClick={checkVideo} disabled={!videoUid.trim() || videoCheck === 'checking'} style={{ width: 'auto' }}>
                        {videoCheck === 'checking' ? 'Checking…' : 'Check'}
                      </button>
                    </div>
                    {videoCheck && videoCheck !== 'checking' && (
                  videoCheck.error ? (
                    <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>{videoCheck.error}</p>
                  ) : videoCheck.state === 'error' ? (
                    <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>
                      Cloudflare could not process this file: {videoCheck.errorReasonText || videoCheck.errorReasonCode}. Re-export and re-upload before linking.
                    </p>
                  ) : videoCheck.state === 'ready' ? (
                    <p style={{ color: 'var(--ok)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>✓ Ready to stream.</p>
                  ) : (
                    <p style={{ color: 'var(--signal-amber)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>
                      Still processing ({videoCheck.state}{videoCheck.pctComplete ? `, ${videoCheck.pctComplete}%` : ''}) — you can still create the episode, it just won&rsquo;t be watchable until this finishes.
                    </p>
                  )
                )}
                  </>
                )}
              </>
            )}

            {videoProvider === 'bunny' && (
              <>
                <label>Bunny.net pull zone hostname{form.contentType !== 'podcast' && ' — required'}</label>
                <input
                  type="text"
                  value={bunnyPullZoneHost}
                  onChange={(e) => setBunnyPullZoneHost(e.target.value)}
                  placeholder="e.g. vz-abc123-456.b-cdn.net"
                  required={form.contentType !== 'podcast'}
                  style={{ marginBottom: '0.4rem' }}
                />
                <label>Bunny.net video ID{form.contentType !== 'podcast' && ' — required'}</label>
                <input
                  type="text"
                  value={bunnyVideoId}
                  onChange={(e) => setBunnyVideoId(e.target.value)}
                  placeholder="the video GUID from your Bunny Stream library"
                  required={form.contentType !== 'podcast'}
                  style={{ marginBottom: '0.4rem' }}
                />
                <p className="video-source-help">
                  Not wired up to Bunny&rsquo;s API yet, so this can&rsquo;t verify the video actually
                  processed the way the Cloudflare field does — it just builds the playback URL from
                  what&rsquo;s typed here. Both values are on the video&rsquo;s page in your Bunny Stream
                  library.
                </p>
              </>
            )}

            {videoProvider === 'mux' && (
              <>
                <label>Mux playback ID{form.contentType !== 'podcast' && ' — required'}</label>
                <input
                  type="text"
                  value={muxPlaybackId}
                  onChange={(e) => setMuxPlaybackId(e.target.value)}
                  placeholder="e.g. DS00Spx1CV902MCtPj5WknGlR102V5HFkDe"
                  required={form.contentType !== 'podcast'}
                  style={{ marginBottom: '0.4rem' }}
                />
                <p className="video-source-help">
                  Not wired up to Mux&rsquo;s API yet, so this can&rsquo;t verify the video actually
                  processed the way the Cloudflare field does — it just builds the playback URL from
                  what&rsquo;s typed here. Found on the asset&rsquo;s page in your Mux dashboard.
                </p>
              </>
            )}

            <label>Trailer — optional</label>
            <div className="video-source-toggle" role="group" aria-label="Trailer source">
              <button
                type="button"
                className={trailerSource === 'file' ? 'on' : ''}
                onClick={() => setTrailerSource('file')}
                disabled={videoProvider !== 'cloudflare' || videoSource !== 'upload'}
              >
                Upload a file
              </button>
              <button type="button" className={trailerSource === 'cloudflare-id' ? 'on' : ''} onClick={() => setTrailerSource('cloudflare-id')}>
                Cloudflare video ID
              </button>
            </div>
            {(videoProvider !== 'cloudflare' || videoSource !== 'upload') && trailerSource === 'file' && (
              <p style={{ fontSize: '0.76rem', color: 'var(--ink-dim)', marginTop: '-0.4rem', marginBottom: '0.5rem' }}>
                A trailer file can only ride along with a main video that&rsquo;s also being uploaded here — use a trailer video ID instead, or skip the trailer.
              </p>
            )}
            {trailerSource === 'file' && videoProvider === 'cloudflare' && videoSource === 'upload' ? (
              <UppyFilePicker
                key={`trailer-${pickerResetKey}`}
                accept="video/*"
                note="Optional — a short cut of the episode"
                onFileSelected={setTrailerFile}
              />
            ) : (
              <input type="text" value={trailerUid} onChange={(e) => setTrailerUid(e.target.value)} placeholder="Only if a trailer was already uploaded elsewhere" style={{ marginBottom: '0.8rem' }} />
            )}
          </>
        )}

        {form.contentType === 'podcast' && (
          <>
            <label>
              Audio {skipVideo ? '' : <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — add it alongside video, or check &ldquo;Audio only&rdquo; above for audio-only</span>}
            </label>
            {audioImportedUrl ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--ok)', marginBottom: '0.8rem' }}>
                ✓ Audio file ready.{' '}
                <button type="button" onClick={() => { setAudioImportedUrl(null); setAudioBytes(null); setAudioUrl(''); }} style={{ color: 'var(--ink-dim)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
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
                        // Same endpoint the creator-facing form already uses —
                        // it accepts isAdmin as well as isCreator, so this
                        // works identically from this admin tool.
                        const res = await fetch('/api/creator/import-audio-url', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ audioUrl: audioUrl.trim() })
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || 'Could not import that audio file.');
                        setAudioImportedUrl(data.audioUrl);
                        setAudioBytes(data.audioBytes || null);
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
                  Paste a direct link to the audio file — a signed download link from Dropbox, Google
                  Drive, WeTransfer, or similar, or any plain .mp3/.m4a/.wav URL. Capped at 150MB.
                </p>
              </>
            )}
          </>
        )}

        <label>Title</label>
        <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />

        <label>Description</label>
        <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />

        <label>Content type</label>
        <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
          {CONTENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <label>Content rating <span style={{ fontWeight: 'normal' }}>optional</span></label>
        <select value={form.rating} onChange={(e) => update('rating', e.target.value)}>
          <option value="">Not set</option>
          {CONTENT_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {!form.rating && (
          <p style={{ fontSize: '0.78rem', color: 'var(--signal-amber)', marginTop: '-0.4rem', marginBottom: '1rem' }}>
            Leaving this unset treats the title as 17+: viewers will have to create an account and confirm their age before they can watch it. Pick a rating here if that&rsquo;s not what you want.
          </p>
        )}

        {(form.contentType === 'series' || form.contentType === 'podcast') && (
          <>
            <label>{form.contentType === 'podcast' ? 'Show' : 'Series'}</label>
            <select value={form.seriesId} onChange={(e) => update('seriesId', e.target.value)}>
              <option value="">Choose a {form.contentType === 'podcast' ? 'show' : 'series'}…</option>
              {allSeries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label>Or create a new {form.contentType === 'podcast' ? 'show' : 'series'}</label>
            <input type="text" value={form.newSeriesName} onChange={(e) => update('newSeriesName', e.target.value)} placeholder="Leave blank if you picked one above" />
            <label>Season</label>
            <input type="number" min="1" value={form.season} onChange={(e) => update('season', e.target.value)} required />
            <label>Episode number within season</label>
            <input type="number" min="1" value={form.seriesOrder} onChange={(e) => update('seriesOrder', e.target.value)} required />
          </>
        )}

        {form.contentType === 'bonus' && (
          <>
            <label>This bonus content belongs under</label>
            <select value={form.bonusParent} onChange={(e) => update('bonusParent', e.target.value)} required>
              <option value="">Choose a series or movie/short…</option>
              {allSeries.length > 0 && (
                <optgroup label="Series">
                  {allSeries.map((s) => <option key={`series:${s.id}`} value={`series:${s.id}`}>{s.name}</option>)}
                </optgroup>
              )}
              {standaloneEpisodes && standaloneEpisodes.length > 0 && (
                <optgroup label="Movies &amp; shorts">
                  {standaloneEpisodes.map((e) => <option key={`episode:${e.id}`} value={`episode:${e.id}`}>{e.title}</option>)}
                </optgroup>
              )}
            </select>
            <p style={{ fontSize: '0.78rem', opacity: 0.65, marginTop: '-0.4rem' }}>
              Give it a descriptive title above — e.g. "Behind the Scenes: Episode 3" or "Official Trailer" — it'll show up in a Bonus Content section on that series or movie's page.
            </p>
          </>
        )}

        <label>Main genre</label>
        <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
          {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>

        <label>Specific genre</label>
        <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />

        <label>Artist credit</label>
        <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />

        <label>
          Runtime (e.g. 05:30)
          {runtimeStatus === 'detecting' && <span style={{ color: 'var(--ink-dim)', fontWeight: 'normal' }}> — detecting from your video…</span>}
          {runtimeStatus === 'detected' && <span style={{ color: 'var(--ok)', fontWeight: 'normal' }}> — auto-detected, edit if needed</span>}
          {runtimeStatus === 'failed' && <span style={{ color: 'var(--ink-dim)', fontWeight: 'normal' }}> — couldn&rsquo;t auto-detect, please enter it</span>}
        </label>
        <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} required placeholder="mm:ss" />

        <label>Year created <span style={{ fontWeight: 'normal' }}>optional</span></label>
        <input
          type="number"
          value={form.releaseYear}
          onChange={(e) => update('releaseYear', e.target.value)}
          placeholder={String(new Date().getFullYear())}
          min="1900"
          max={new Date().getFullYear() + 1}
        />

        <label>Tier</label>
        <select value={form.tier} onChange={(e) => update('tier', e.target.value)}>
          <option value="free">Free</option>
          <option value="premium">{SITE.premiumTier} (premium)</option>
        </select>

        <label>Status</label>
        <select value={form.status} onChange={(e) => update('status', e.target.value)}>
          <option value="pending">Pending — goes through normal review</option>
          <option value="approved">Approved — live immediately</option>
          <option value="rejected">Rejected</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal', marginTop: '0.6rem' }}>
          <input type="checkbox" checked={form.featured} onChange={(e) => update('featured', e.target.checked)} />
          Eligible for the homepage hero rotation
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal' }}>
          <input type="checkbox" checked={form.adsEnabled} onChange={(e) => update('adsEnabled', e.target.checked)} />
          Show ads on this episode {form.tier === 'premium' && `(ignored — ${SITE.premiumTier} members never see ads regardless)`}
        </label>

        {form.adsEnabled && (
          <>
            <label>Ad break times <span style={{ fontWeight: 'normal', opacity: 0.65 }}>comma-separated MM:SS, e.g. "0:00, 10:00, 20:30" — defaults to pre-roll only if left as-is</span></label>
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

        <label>Funding link <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — the creator's own project/funding page</span></label>
        <input type="url" value={form.fundingUrl} onChange={(e) => update('fundingUrl', e.target.value)} placeholder="https://kickstarter.com/..." />

        <label>Poster — optional</label>
        <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

        <label>Thumbnail — optional</label>
        <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

        {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

        <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
          {saving ? 'Creating…' : 'Create episode'}
        </button>
        {videoProvider === 'cloudflare' && (videoSource === 'upload' || videoSource === 'link') && (
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '0.5rem' }}>
            The upload keeps running even if you navigate elsewhere — check the corner of your screen for progress.
          </p>
        )}
      </form>
    </div>
  );
}
