import { useEffect, useState } from 'react';
import Image from 'next/image';
import { SITE } from '../lib/siteConfig';
import RatingOptions from './RatingOptions';
import { parseAdBreaksInput, formatAdBreaksForInput } from '../lib/adBreaks';
import PageNotesField, { pageNotesBoxShows } from './PageNotesField';
import ExtraKindField from './ExtraKindField';
import { extraKindChoice, extraKindFromChoice } from '../lib/extraKinds';

// The kind of extra's line before migration 121 (lib/showPage.js
// EXTRA_KIND_121_MSG says the same).
const EXTRA_KIND_121_LINE = 'What kind of extra it is needs a database update (migration 121).';

const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];

// Matches lib/cloudflareUpload.js's cloudflareUidFromUrl exactly, done
// client-side so the modal can show "what's currently attached" the
// instant it opens, without a round trip just to extract an ID from a URL
// the browser already has in `episode.src`.
function uidFromPlaybackUrl(url) {
  if (!url) return null;
  const match = url.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)\//);
  return match ? match[1] : null;
}

// Shows enough of a Cloudflare video ID to recognise WHICH video is
// attached, without splashing the full credential-ish string across the
// screen on every open. Four leading characters is comfortably enough to
// tell two videos apart at this library's scale, and the full value is one
// click away for anyone who needs to paste it into Cloudflare's dashboard.
function maskUid(uid) {
  if (!uid) return null;
  if (uid.length <= 4) return uid;
  return `${uid.slice(0, 4)}${'*'.repeat(Math.min(uid.length - 4, 24))}`;
}

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

// HTML date inputs require exactly YYYY-MM-DD — the server sends full ISO
// timestamps, so this trims one down to what the input actually accepts.
function toDateInputValue(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

// The form as the episode stands when the modal opens (the Library's row,
// /api/admin/library). A save is compared against it.
function formFromEpisode(episode) {
  return {
    title: episode.title || '',
    description: episode.description || '',
    // The notes for its own page (migration 118; components/PageNotesField.js).
    pageNotes: episode.pageNotes || '',
    contentType: episode.contentType || 'short',
    rating: episode.rating || '',
    seriesId: episode.seriesId || '',
    season: episode.season ? String(episode.season) : '1',
    seriesOrder: episode.seriesOrder ? String(episode.seriesOrder) : '',
    bonusParent: episode.bonusParentType && episode.bonusParentId ? `${episode.bonusParentType}:${episode.bonusParentId}` : '',
    artist: episode.artist || '',
    runtime: episode.runtime || '',
    releaseYear: episode.releaseYear || '',
    genre: episode.genre || '',
    mainGenre: episode.mainGenre || MAIN_GENRES[0],
    tier: episode.tier || 'free',
    status: episode.status || 'pending',
    featured: !!episode.featured,
    discoverCurated: !!episode.discoverCurated,
    isOriginal: !!episode.isOriginal,
    hasFlashingLights: !!episode.hasFlashingLights,
    fundingUrl: episode.fundingUrl || '',
    availableFrom: toDateInputValue(episode.availableFrom),
    availableUntil: toDateInputValue(episode.availableUntil),
    adsEnabled: episode.adsEnabled !== false,
    adBreaksText: formatAdBreaksForInput(episode.adBreakSeconds),
    // What kind of extra (migration 121): { choice, other } for the field.
    extraKind: extraKindChoice(episode.extraKind)
  };
}

// Compared as trimmed text: the inputs, the selects, the dates and the
// numbers as typed (/api/admin/edit-episode reads the numbers).
const TEXT_FIELDS = ['title', 'description', 'pageNotes', 'contentType', 'rating', 'artist', 'runtime', 'releaseYear', 'genre', 'mainGenre', 'tier', 'status', 'fundingUrl', 'availableFrom', 'availableUntil'];
const SWITCH_FIELDS = ['featured', 'discoverCurated', 'isOriginal', 'hasFlashingLights'];
const PLACE_FIELDS = ['seriesId', 'season', 'seriesOrder'];
const NUMBERED_TYPES = ['series', 'podcast'];
// The inputs marked required: changed to nothing but spaces, they'd save blank.
const REQUIRED_TEXT = [['title', 'The title'], ['description', 'The description'], ['artist', 'The artist credit'], ['runtime', 'The runtime'], ['genre', 'The specific genre']];

const textOf = (v) => (v === null || v === undefined ? '' : String(v).trim());

// What a save sends besides the episode id and the files: only the fields
// that differ from the form the modal opened with. The route reads a
// missing key as "unchanged", so a field nobody touched is never
// overwritten by whatever the form happened to show (every save used to
// send the whole form: discoverCurated false for a title whose curated
// switch isn't on screen, and a blank bonus parent that the route now
// refuses).
function changedFields(start, form) {
  const out = {};
  for (const f of TEXT_FIELDS) if (textOf(form[f]) !== textOf(start[f])) out[f] = textOf(form[f]);
  for (const f of SWITCH_FIELDS) if (Boolean(form[f]) !== Boolean(start[f])) out[f] = Boolean(form[f]);
  // A place in a show means something only to a series or podcast
  // episode; for anything else the route clears it (or, for a Snippet,
  // keeps the stored one).
  if (NUMBERED_TYPES.includes(form.contentType)) {
    for (const f of PLACE_FIELDS) if (textOf(form[f]) !== textOf(start[f])) out[f] = textOf(form[f]);
  }
  // What bonus content belongs under: when it was picked again, or when
  // the title becomes bonus content (the route checks the parent then).
  if (form.contentType === 'bonus' && (form.bonusParent !== start.bonusParent || form.contentType !== start.contentType)) {
    const at = form.bonusParent.indexOf(':');
    out.bonusParentType = at > 0 ? form.bonusParent.slice(0, at) : null;
    out.bonusParentId = at > 0 ? form.bonusParent.slice(at + 1) : null;
  }
  // The ads switch, and the break times whenever either one moved
  // (switched off, only the opening break is kept, as the modal always
  // sent it).
  const adsChanged = Boolean(form.adsEnabled) !== Boolean(start.adsEnabled);
  if (adsChanged) out.adsEnabled = Boolean(form.adsEnabled);
  if (adsChanged || textOf(form.adBreaksText) !== textOf(start.adBreaksText)) {
    out.adBreakSeconds = form.adsEnabled ? parseAdBreaksInput(form.adBreaksText) : [0];
  }
  return out;
}

export default function AdminEditEpisodeModal({ episode, allSeries, standaloneEpisodes, onClose, onSaved }) {
  // `start` is the form the modal opened with and never changes; `form` is
  // what's on screen.
  const [start] = useState(() => formFromEpisode(episode));
  const [form, setForm] = useState(start);
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [titleImageFile, setTitleImageFile] = useState(null);
  const [removeTitleImage, setRemoveTitleImage] = useState(false);
  const [videoUid, setVideoUid] = useState('');
  const [videoCheck, setVideoCheck] = useState(null); // null | 'checking' | { state, errorReasonText, readyToStream, ... } | { error }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmNoVideo, setConfirmNoVideo] = useState(false);
  const [revealUid, setRevealUid] = useState(false);

  const existingUid = uidFromPlaybackUrl(episode.src);

  // The show and the parent it has now, when the pickers don't list them
  // (the parent picker lists the shows and this Library page's films and
  // shorts; an extra hung on a series episode, or on a title the search
  // left out, isn't there). Without its own option the select would show
  // the placeholder and its `required` would block every save.
  const storedShowUnlisted = Boolean(start.seriesId) && !(allSeries || []).some((s) => s.id === start.seriesId);
  const storedParentUnlisted = Boolean(start.bonusParent)
    && !(allSeries || []).some((s) => `series:${s.id}` === start.bonusParent)
    && !(standaloneEpisodes || []).some((e) => `episode:${e.id}` === start.bonusParent);

  // Runs the moment the modal opens — this is what makes "is a video
  // actually attached" something you SEE rather than something you have
  // to trust. Checking against Cloudflare directly (not just "is src
  // non-empty") is what catches a video that saved but never finished
  // processing, too.
  useEffect(() => {
    let cancelled = false;
    if (!existingUid) {
      setVideoCheck({ none: true });
      return;
    }
    setVideoCheck('checking');
    fetch(`/api/admin/check-cloudflare-video?uid=${encodeURIComponent(existingUid)}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!cancelled) setVideoCheck(ok ? data : { error: data.error });
      })
      .catch(() => {
        if (!cancelled) setVideoCheck({ error: 'Could not reach Cloudflare to check.' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setConfirmNoVideo(false);
  }

  async function checkNewVideo() {
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

  // The actual guard against what most likely happened here: approving an
  // episode that has no watchable video at all. Only blocks on the exact
  // dangerous combination — status is (or is becoming) approved, AND
  // there's neither an existing attached video nor a new one being linked
  // in this save. Everything else saves normally, no extra click.
  //
  // `dangerous` reflects the data and stays stable across both clicks of
  // the confirmation, so the warning and button label don't flicker or
  // change meaning between the first and second press — only the actual
  // submit behavior changes, gated separately by `confirmNoVideo`.
  const noVideoAtAll = !existingUid && !videoUid.trim();
  const notesShown = pageNotesBoxShows(episode, { contentType: form.contentType, seriesId: form.seriesId });
  const dangerous = form.status === 'approved' && noVideoAtAll;
  // The Library row says whether the database has migration 121's column
  // (an older answer without the flag reads as not ready).
  const kindReady = episode.extraKindReady === true;
  const kindOpen = form.contentType === 'bonus' && kindReady;

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    const changes = changedFields(start, form);
    // What kind of extra (migration 121), for bonus content once the
    // database has the column, and only when it changed.
    if (kindOpen) {
      const kindBefore = extraKindFromChoice(start.extraKind.choice, start.extraKind.other);
      const kindAfter = extraKindFromChoice(form.extraKind.choice, form.extraKind.other);
      if (kindAfter !== kindBefore) changes.extraKind = kindAfter;
    }
    // Notes only while their box is on the form (the title, as typed now,
    // has its own page and the database has the column).
    if (!notesShown) delete changes.pageNotes;
    const blank = REQUIRED_TEXT.find(([field]) => changes[field] === '');
    if (blank) {
      setError(`${blank[1]} can’t be blank.`);
      return;
    }
    // Nothing changed and nothing attached: close as Cancel would, without
    // a request.
    const attaching = Boolean(posterFile || thumbnailFile || titleImageFile || removeTitleImage || videoUid.trim());
    if (Object.keys(changes).length === 0 && !attaching) {
      onClose();
      return;
    }
    if (dangerous && !confirmNoVideo) {
      setConfirmNoVideo(true);
      return;
    }
    setSaving(true);
    try {
      const [posterBase64, thumbnailBase64, titleImageBase64] = await Promise.all([readAsDataUrl(posterFile), readAsDataUrl(thumbnailFile), readAsDataUrl(titleImageFile)]);
      const res = await fetch('/api/admin/edit-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: episode.id,
          ...changes,
          ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
          ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {}),
          ...(titleImageBase64 ? { titleImageBase64, titleImageFileName: titleImageFile.name } : {}),
          ...(removeTitleImage && !titleImageBase64 ? { removeTitleImage: true } : {}),
          ...(videoUid.trim() ? { cloudflareVideoUid: videoUid.trim() } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save changes.');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card admin-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit episode</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="admin-edit-sub">
          Admin edit — works on any episode regardless of status, including changing status itself.
        </p>

        {/* The self-verifying part: what's actually attached right now,
            checked live against Cloudflare rather than just "a src is set." */}
        <div className={`admin-video-status ${videoCheck === 'checking' ? 'checking' : videoCheck?.error ? 'bad' : videoCheck?.none ? 'none' : videoCheck?.state === 'ready' ? 'good' : videoCheck?.state === 'error' ? 'bad' : 'pending'}`}>
          {videoCheck === 'checking' && <span>Checking the currently attached video…</span>}
          {videoCheck?.none && <span><strong>No video attached.</strong> This episode has nothing to play — link one below before approving it.</span>}
          {videoCheck?.error && <span><strong>Couldn&rsquo;t verify the attached video.</strong> {videoCheck.error}</span>}
          {videoCheck?.state === 'ready' && <span><strong>✓ Video attached and ready to stream.</strong></span>}
          {videoCheck?.state === 'error' && <span><strong>Attached video failed on Cloudflare&rsquo;s side.</strong> {videoCheck.errorReasonText || videoCheck.errorReasonCode} — this episode won&rsquo;t play until it&rsquo;s replaced.</span>}
          {videoCheck && videoCheck !== 'checking' && !videoCheck.none && !videoCheck.error && videoCheck.state && videoCheck.state !== 'ready' && videoCheck.state !== 'error' && (
            <span><strong>Still processing on Cloudflare</strong> ({videoCheck.state}{videoCheck.pctComplete ? `, ${videoCheck.pctComplete}%` : ''}) — not watchable yet.</span>
          )}
        </div>

        <form onSubmit={handleSave} className="admin-edit-form">
          <div className="admin-field">
            <label>Title</label>
            <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />
          </div>

          <div className="admin-field">
            <label>Description</label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} />
          </div>

          {notesShown && (
            <PageNotesField id="admin-page-notes" wrapClassName="admin-field" value={form.pageNotes} onChange={(v) => update('pageNotes', v)} />
          )}

          <div className="admin-field">
            <label>Content type</label>
            <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
              <option value="short">Short</option>
              <option value="movie">Movie</option>
              <option value="series">Series episode</option>
              <option value="vertical">Vertical</option>
              <option value="podcast">Podcast</option>
              <option value="bonus">Bonus content (BTS, trailer, extra…)</option>
            </select>
          </div>

          <div className="admin-field">
            <label>Content rating <span style={{ fontWeight: 'normal' }}>optional</span></label>
            <select value={form.rating} onChange={(e) => update('rating', e.target.value)}>
              <option value="">Not set</option>
              <RatingOptions />
            </select>
          </div>

          {form.contentType === 'bonus' && (
            <div className="admin-field">
              <label>This bonus content belongs under</label>
              <select value={form.bonusParent} onChange={(e) => update('bonusParent', e.target.value)} required>
                <option value="">Choose a series or movie/short…</option>
                {storedParentUnlisted && (
                  <option value={start.bonusParent}>{episode.bonusParentTitle || start.bonusParent.slice(start.bonusParent.indexOf(':') + 1)} · where it is now</option>
                )}
                {(allSeries || []).length > 0 && (
                  <optgroup label="Series">
                    {allSeries.map((s) => <option key={`series:${s.id}`} value={`series:${s.id}`}>{s.name}</option>)}
                  </optgroup>
                )}
                {(standaloneEpisodes || []).length > 0 && (
                  <optgroup label="Movies &amp; shorts">
                    {standaloneEpisodes.map((e) => <option key={`episode:${e.id}`} value={`episode:${e.id}`}>{e.title}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {form.contentType === 'bonus' && (
            <div className="admin-field admin-extra-kind">
              <ExtraKindField idPrefix={`admin-xk-${episode.id}`} choice={form.extraKind.choice} other={form.extraKind.other} onChange={(v) => update('extraKind', v)} disabled={!kindReady} variant="apply">
                {!kindReady && <p className="apl-help">{EXTRA_KIND_121_LINE}</p>}
              </ExtraKindField>
            </div>
          )}

          {form.contentType === 'series' && (
            <div className="admin-field-row">
              <div className="admin-field">
                <label>Series</label>
                <select value={form.seriesId} onChange={(e) => update('seriesId', e.target.value)} required>
                  <option value="">Choose a series…</option>
                  {storedShowUnlisted && <option value={start.seriesId}>{start.seriesId} · where it is now</option>}
                  {(allSeries || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="admin-field">
                <label>Season</label>
                <input type="number" min="1" value={form.season} onChange={(e) => update('season', e.target.value)} />
              </div>
              <div className="admin-field">
                <label>Episode #</label>
                <input type="number" min="1" value={form.seriesOrder} onChange={(e) => update('seriesOrder', e.target.value)} />
              </div>
            </div>
          )}

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Artist credit</label>
              <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />
            </div>
            <div className="admin-field">
              <label>Runtime</label>
              <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} placeholder="mm:ss" required />
            </div>
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Year created <span style={{ fontWeight: 'normal' }}>optional</span></label>
              <input
                type="number"
                value={form.releaseYear}
                onChange={(e) => update('releaseYear', e.target.value)}
                placeholder={String(new Date().getFullYear())}
                min="1900"
                max={new Date().getFullYear() + 1}
              />
            </div>
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Main genre</label>
              <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
                {!MAIN_GENRES.includes(start.mainGenre) && <option value={start.mainGenre}>{start.mainGenre}</option>}
                {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label>Specific genre</label>
              <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />
            </div>
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Tier</label>
              <select value={form.tier} onChange={(e) => update('tier', e.target.value)}>
                <option value="free">Free</option>
                <option value="premium">{SITE.premiumTier} (premium)</option>
              </select>
            </div>
            <div className="admin-field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => update('status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="approved">Approved — live</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <label className="admin-checkbox">
            <input type="checkbox" checked={form.featured} onChange={(e) => update('featured', e.target.checked)} />
            Eligible for the homepage hero rotation
          </label>

          {form.contentType === 'vertical' && (
            <label className="admin-checkbox">
              <input type="checkbox" checked={form.discoverCurated} onChange={(e) => update('discoverCurated', e.target.checked)} />
              Curated pick for the Discover feed <span className="admin-optional">— shows up in the feed&rsquo;s dedicated curated slot (every 4th card) instead of only appearing through the random/personalized lanes</span>
            </label>
          )}

          <label className="admin-checkbox">
            <input type="checkbox" checked={form.adsEnabled} onChange={(e) => update('adsEnabled', e.target.checked)} />
            Show ads on this episode
            {form.tier === 'premium' && <span className="admin-optional"> — ignored, {SITE.premiumTier} members never see ads regardless of tier</span>}
          </label>

          {form.adsEnabled && (
            <>
              <label>Ad break times <span className="admin-optional">comma-separated MM:SS, e.g. &ldquo;0:00, 10:00, 20:30&rdquo;</span></label>
              <input
                type="text"
                value={form.adBreaksText}
                onChange={(e) => update('adBreaksText', e.target.value)}
                placeholder="0:00"
              />
            </>
          )}

          <label className="admin-checkbox">
            <input type="checkbox" checked={form.isOriginal} onChange={(e) => update('isOriginal', e.target.checked)} />
            Tapa Original <span className="admin-optional"> — exclusive to Studio Tapa, independent of free/premium tier</span>
          </label>

          {/* The flashing-lights warning (2026-11-12): a chip on the title's
              page and a photosensitivity card before it plays. */}
          <label className="admin-checkbox">
            <input type="checkbox" checked={form.hasFlashingLights} onChange={(e) => update('hasFlashingLights', e.target.checked)} />
            Contains flashing lights <span className="admin-optional"> — shows a warning on its page and holds the video under a photosensitivity card before it plays</span>
          </label>

          <div className="admin-field">
            <label>Funding link <span className="admin-optional">optional — the creator's own project/funding page</span></label>
            <input type="url" value={form.fundingUrl} onChange={(e) => update('fundingUrl', e.target.value)} placeholder="https://kickstarter.com/..." />
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Available from <span className="admin-optional">optional</span></label>
              <input type="date" value={form.availableFrom} onChange={(e) => update('availableFrom', e.target.value)} />
              <p className="admin-field-hint">Counts as a &ldquo;new release&rdquo; for a while after this date.</p>
            </div>
            <div className="admin-field">
              <label>Available until <span className="admin-optional">optional</span></label>
              <input type="date" value={form.availableUntil} onChange={(e) => update('availableUntil', e.target.value)} />
              <p className="admin-field-hint">
                Shows as &ldquo;leaving soon&rdquo; beforehand. Once this date passes, it&rsquo;s
                automatically flagged for deletion review — it won&rsquo;t vanish without you seeing
                it first.
              </p>
            </div>
          </div>

          <div className="eyebrow admin-media-heading">Current media</div>

          <div className="admin-media-grid">
            <div className={`admin-media-slot ${posterFile ? 'replacing' : episode.poster ? 'has' : 'empty'}`}>
              <div className="admin-media-preview">
                {episode.poster ? (
                  <Image src={episode.poster} alt="" width={56} height={84} />
                ) : (
                  <span className="admin-media-none">None</span>
                )}
              </div>
              <div className="admin-media-body">
                <div className="admin-media-label">
                  <span className={`admin-connection-dot ${episode.poster ? 'connected' : 'disconnected'}`} aria-hidden="true" />
                  Poster
                </div>
                <div className="admin-media-state">
                  {posterFile ? `Replacing with ${posterFile.name}` : episode.poster ? 'In use' : 'Not set'}
                </div>
                <label className="admin-media-action">
                  {episode.poster ? 'Replace…' : 'Upload…'}
                  <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} />
                </label>
                {posterFile && (
                  <button type="button" className="admin-media-undo" onClick={() => setPosterFile(null)}>
                    Keep existing
                  </button>
                )}
              </div>
            </div>

            <div className={`admin-media-slot ${thumbnailFile ? 'replacing' : episode.thumbnail ? 'has' : 'empty'}`}>
              <div className="admin-media-preview">
                {episode.thumbnail ? (
                  <Image src={episode.thumbnail} alt="" width={56} height={84} />
                ) : (
                  <span className="admin-media-none">None</span>
                )}
              </div>
              <div className="admin-media-body">
                <div className="admin-media-label">
                  <span className={`admin-connection-dot ${episode.thumbnail ? 'connected' : 'disconnected'}`} aria-hidden="true" />
                  Thumbnail
                </div>
                <div className="admin-media-state">
                  {thumbnailFile ? `Replacing with ${thumbnailFile.name}` : episode.thumbnail ? 'In use' : 'Not set'}
                </div>
                <label className="admin-media-action">
                  {episode.thumbnail ? 'Replace…' : 'Upload…'}
                  <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} />
                </label>
                {thumbnailFile && (
                  <button type="button" className="admin-media-undo" onClick={() => setThumbnailFile(null)}>
                    Keep existing
                  </button>
                )}
              </div>
            </div>

            <div className={`admin-media-slot ${titleImageFile ? 'replacing' : removeTitleImage ? 'replacing' : episode.titleImageUrl ? 'has' : 'empty'}`}>
              <div className="admin-media-preview">
                {episode.titleImageUrl && !removeTitleImage ? (
                  <Image src={episode.titleImageUrl} alt="" width={56} height={84} />
                ) : (
                  <span className="admin-media-none">None</span>
                )}
              </div>
              <div className="admin-media-body">
                <div className="admin-media-label">
                  <span className={`admin-connection-dot ${episode.titleImageUrl && !removeTitleImage ? 'connected' : 'disconnected'}`} aria-hidden="true" />
                  Title image (PNG logo)
                </div>
                <div className="admin-media-state">
                  {titleImageFile
                    ? `Replacing with ${titleImageFile.name}`
                    : removeTitleImage
                    ? 'Will be removed — hero will show plain text title'
                    : episode.titleImageUrl
                    ? 'In use — hero shows this instead of the text title'
                    : 'Not set — hero shows plain text title'}
                </div>
                <label className="admin-media-action">
                  {episode.titleImageUrl ? 'Replace…' : 'Upload…'}
                  <input type="file" accept="image/png" onChange={(e) => { setTitleImageFile(e.target.files[0] || null); setRemoveTitleImage(false); }} />
                </label>
                {titleImageFile && (
                  <button type="button" className="admin-media-undo" onClick={() => setTitleImageFile(null)}>
                    Keep existing
                  </button>
                )}
                {episode.titleImageUrl && !titleImageFile && (
                  <button
                    type="button"
                    className="admin-media-undo"
                    onClick={() => setRemoveTitleImage((r) => !r)}
                  >
                    {removeTitleImage ? 'Undo — keep title image' : 'Remove — use text title instead'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {(posterFile || thumbnailFile || titleImageFile || removeTitleImage) && (
            <div className="admin-warning admin-warning-soft">
              <strong>Artwork will be replaced when you save.</strong> The current image is
              overwritten and isn&rsquo;t recoverable from here — make sure you still have the
              original somewhere before saving.
            </div>
          )}

          <div className="admin-field">
            <label>Video</label>

            {/* Showing WHICH video is attached, not just whether one is.
                Previously this field sat empty even when a video was
                perfectly well attached, which read as "nothing here" and is
                what made it feel like saved IDs weren't sticking. */}
            {existingUid ? (
              <div className="admin-uid-current">
                <div className="admin-uid-row">
                  <span
                    className={`admin-connection-dot ${videoCheck?.state === 'ready' ? 'connected' : videoCheck === 'checking' ? 'checking' : 'disconnected'}`}
                    aria-hidden="true"
                  />
                  <span className="admin-uid-label">Attached ID</span>
                  <code className="admin-uid-value">{revealUid ? existingUid : maskUid(existingUid)}</code>
                  <button
                    type="button"
                    className="admin-uid-toggle"
                    onClick={() => setRevealUid((r) => !r)}
                    aria-label={revealUid ? 'Hide full video ID' : 'Show full video ID'}
                  >
                    {revealUid ? 'Hide' : 'Show full'}
                  </button>
                </div>
                <p className="admin-uid-note">
                  Leave the field below empty to keep this video. Pasting a new ID
                  <strong> permanently swaps out what viewers watch</strong> — the current video is
                  detached from this episode and any watch progress people have on it stops lining up.
                </p>
              </div>
            ) : (
              <p className="admin-field-hint">
                No video is attached to this episode yet.
              </p>
            )}

            <label className="admin-sub-label">
              {existingUid ? 'Swap in a different video' : 'Attach a video'}{' '}
              <span className="admin-optional">Cloudflare video ID, not a URL</span>
            </label>
            <p className="admin-field-hint">
              For a file uploaded directly through Cloudflare&rsquo;s own dashboard (the fallback when
              in-app upload keeps failing) — paste its video ID.
            </p>
            <div className="admin-video-input-row">
              <input
                type="text"
                value={videoUid}
                onChange={(e) => { setVideoUid(e.target.value); setConfirmNoVideo(false); }}
                placeholder="e.g. c792e0c49f72f77e00693d10c0ef02cd"
              />
              <button type="button" onClick={checkNewVideo} disabled={!videoUid.trim() || videoCheck === 'checking'}>
                {videoCheck === 'checking' ? 'Checking…' : 'Check'}
              </button>
            </div>
            {videoUid.trim() && videoCheck && videoCheck !== 'checking' && !videoCheck.none && (
              videoCheck.error ? (
                <p className="admin-video-note bad">{videoCheck.error}</p>
              ) : videoCheck.state === 'error' ? (
                <p className="admin-video-note bad">
                  Cloudflare could not process this file: {videoCheck.errorReasonText || videoCheck.errorReasonCode}. Re-export and re-upload before linking.
                </p>
              ) : videoCheck.state === 'ready' ? (
                <p className="admin-video-note good">✓ Ready to stream — safe to save.</p>
              ) : (
                <p className="admin-video-note pending">
                  Still processing on Cloudflare&rsquo;s side ({videoCheck.state}{videoCheck.pctComplete ? `, ${videoCheck.pctComplete}%` : ''}) — you can save now, but it won&rsquo;t be watchable until this finishes.
                </p>
              )
            )}
          </div>

          {existingUid && videoUid.trim() && videoUid.trim() !== existingUid && (
            <div className="admin-warning">
              <strong>You&rsquo;re replacing the video on a published episode.</strong> Once saved,
              anyone watching this episode gets the new file instead. Saved watch positions will
              point at the wrong moments, and if the new video is shorter, some people&rsquo;s
              progress will sit past its end.
            </div>
          )}

          {dangerous && (
            <div className="admin-warning">
              <strong>This episode has no video attached at all.</strong> Setting it to Approved will
              make it appear on the site with nothing to play.{' '}
              {confirmNoVideo
                ? 'Click Save anyway once more to confirm.'
                : 'Click Save anyway below to confirm you want to do this — or paste a Cloudflare video ID above first.'}
            </div>
          )}

          {error && <p className="admin-error">{error}</p>}

          <div className="admin-actions">
            <button className="account-btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : dangerous ? 'Save anyway' : 'Save changes'}
            </button>
            <button className="account-btn-secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
