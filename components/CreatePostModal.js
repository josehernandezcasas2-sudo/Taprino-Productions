import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUpload } from '../contexts/UploadContext';
import { readVideoDuration, formatRuntime } from '../lib/videoMetadata';
import { PlusIcon, VideoCameraIcon, ImageIcon, CloseIcon } from './PlayerIcons';

const MAX_VIDEO_SECONDS = 5 * 60;
const MAX_CAPTION_LENGTH = 2200;

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

// Admin-only test composer (see MobileTabBar's own admin gate on the "+"
// button that opens this) — two kinds: a quick post (caption + optional
// photo) or a short vertical video, capped at 5 minutes. Both publish
// immediately, no review step — this doesn't go through the creator
// submission pipeline in lib/episodes.js at all, it writes to the
// separate `posts` table (lib/posts.js).
//
// The media comes first, caption second — the same order Instagram/
// Twitter use, and the one Jose asked for: pick the photo/video, see it,
// THEN write about it underneath, rather than typing into a form field
// before there's anything to react to.
export default function CreatePostModal({ onClose, onPosted }) {
  const { startUpload } = useUpload();
  const [step, setStep] = useState('choose');
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);

  // Post (photo + caption)
  const [caption, setCaption] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Video
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [videoDuration, setVideoDuration] = useState(null);
  const [videoCaption, setVideoCaption] = useState('');
  const [checkingVideo, setCheckingVideo] = useState(false);
  const [videoError, setVideoError] = useState(null);
  // Optional custom cover — without one, the post falls back to whichever
  // frame Cloudflare happens to grab from the video itself once it's
  // processed, same as every video posted before this existed. A photo
  // post has no equivalent field; the photo already is its own thumbnail.
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const thumbnailInputRef = useRef(null);

  function pickImage(e) {
    const f = e.target.files[0] || null;
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(f);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  }

  function clearImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  async function handlePostSubmit(e) {
    e.preventDefault();
    if (!caption.trim() && !imageFile) {
      setError('Add a caption or a photo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const imageBase64 = await readAsDataUrl(imageFile);
      const res = await fetch('/api/posts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'post',
          caption: caption.trim(),
          ...(imageBase64 ? { imageBase64, imageFileName: imageFile.name } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the post.');
      if (onPosted) onPosted();
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  function clearVideo() {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(null);
    setVideoPreview(null);
    setVideoDuration(null);
    setVideoError(null);
    if (videoInputRef.current) videoInputRef.current.value = '';
    clearThumbnail();
  }

  function pickThumbnail(e) {
    const f = e.target.files[0] || null;
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    setThumbnailFile(f);
    setThumbnailPreview(f ? URL.createObjectURL(f) : null);
  }

  function clearThumbnail() {
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    setThumbnailFile(null);
    setThumbnailPreview(null);
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
  }

  async function pickVideo(e) {
    const f = e.target.files[0] || null;
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(null);
    setVideoPreview(null);
    setVideoDuration(null);
    setVideoError(null);
    if (!f) return;

    setCheckingVideo(true);
    try {
      const duration = await readVideoDuration(f);
      if (duration > MAX_VIDEO_SECONDS) {
        setVideoError(`That snippet is ${formatRuntime(duration)} — snippets are limited to 5 minutes.`);
        if (videoInputRef.current) videoInputRef.current.value = '';
      } else {
        setVideoFile(f);
        setVideoPreview(URL.createObjectURL(f));
        setVideoDuration(duration);
      }
    } catch (err) {
      // Can't read duration client-side (unusual codec/container) — let it
      // through; the server re-checks against Cloudflare's own number once
      // it's processed (see pages/api/posts/create.js).
      setVideoFile(f);
      setVideoPreview(URL.createObjectURL(f));
    } finally {
      setCheckingVideo(false);
    }
  }

  async function handleVideoSubmit(e) {
    e.preventDefault();
    if (!videoFile) {
      setVideoError('Choose a snippet first.');
      return;
    }
    // Read before the upload starts (not in parallel with it) — this
    // modal closes as soon as startUpload kicks off, handing off to the
    // global upload widget, so the thumbnail needs to already be part of
    // the payload startUpload carries rather than something added later.
    const thumbnailBase64 = await readAsDataUrl(thumbnailFile);
    startUpload(
      videoFile,
      {
        kind: 'video',
        caption: videoCaption.trim(),
        durationSeconds: videoDuration,
        ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {})
      },
      null,
      'tus',
      '/api/posts/create',
      { label: 'Posted!', meta: 'Your snippet is live in Discover.' }
    );
    onClose();
  }

  function backToChoose() {
    clearImage();
    setCaption('');
    setError(null);
    clearVideo();
    setVideoCaption('');
    setStep('choose');
  }
  // Note: clearVideo() above already resets the thumbnail (see its own
  // definition) since a thumbnail without its video makes no sense.

  // Rendered into document.body via a portal rather than in place —
  // MobileTabBar mounts this modal as a child of <nav className="tabbar">,
  // and .tabbar has backdrop-filter: blur(10px). That CSS property makes
  // .tabbar the containing block for any position:fixed descendant
  // (same rule as transform/filter/perspective), so .modal-backdrop's
  // fixed positioning would otherwise be confined to the tab bar's own
  // tiny box instead of covering the viewport — the modal existed in the
  // DOM but was invisible, squeezed inside the pill. The portal escapes
  // that entirely.
  if (typeof document === 'undefined') return null;
  return createPortal((
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card create-post-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {step === 'choose' ? 'New post' : step === 'post' ? 'New post' : 'New snippet'}
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === 'choose' && (
          <div className="create-post-choices">
            <button type="button" className="create-post-choice" onClick={() => setStep('post')}>
              <ImageIcon size={26} />
              <span>Post</span>
              <span className="create-post-choice-sub">Photo + a caption</span>
            </button>
            <button type="button" className="create-post-choice" onClick={() => setStep('video')}>
              <VideoCameraIcon size={26} />
              <span>Snippet</span>
              <span className="create-post-choice-sub">Vertical clip, up to 5 minutes</span>
            </button>
          </div>
        )}

        {step === 'post' && (
          <form className="create-post-form" onSubmit={handlePostSubmit}>
            <div
              className="create-post-dropzone create-post-dropzone-photo"
              onClick={() => imageInputRef.current && imageInputRef.current.click()}
              style={imagePreview ? { backgroundImage: `url(${imagePreview})` } : undefined}
            >
              {!imagePreview ? (
                <div className="create-post-dropzone-empty">
                  <ImageIcon size={28} />
                  <span>Tap to add a photo</span>
                  <span className="create-post-dropzone-hint">Optional — a caption alone works too</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="create-post-dropzone-remove"
                  onClick={(e) => { e.stopPropagation(); clearImage(); }}
                  aria-label="Remove photo"
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>
            <input ref={imageInputRef} type="file" accept="image/*" onChange={pickImage} hidden />

            <textarea
              className="create-post-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              rows={3}
              placeholder="Write a caption…"
            />
            <div className="create-post-char-count">{caption.length}/{MAX_CAPTION_LENGTH}</div>

            {error && <p className="create-post-error">{error}</p>}

            <div className="create-post-form-actions">
              <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
                {saving ? 'Posting…' : 'Post'}
              </button>
              <button className="account-btn-secondary" type="button" onClick={backToChoose} disabled={saving} style={{ width: 'auto' }}>
                Back
              </button>
            </div>
          </form>
        )}

        {step === 'video' && (
          <form className="create-post-form" onSubmit={handleVideoSubmit}>
            <div
              className="create-post-dropzone create-post-dropzone-video"
              onClick={() => !videoPreview && videoInputRef.current && videoInputRef.current.click()}
            >
              {!videoPreview ? (
                <div className="create-post-dropzone-empty">
                  <VideoCameraIcon size={28} />
                  <span>Tap to choose a snippet</span>
                  <span className="create-post-dropzone-hint">Vertical, up to 5 minutes</span>
                </div>
              ) : (
                <>
                  <video className="create-post-video-preview" src={videoPreview} muted playsInline loop autoPlay />
                  {videoDuration != null && (
                    <span className="create-post-duration-badge">{formatRuntime(videoDuration)}</span>
                  )}
                  <button
                    type="button"
                    className="create-post-dropzone-remove"
                    onClick={(e) => { e.stopPropagation(); clearVideo(); }}
                    aria-label="Remove snippet"
                  >
                    <CloseIcon size={14} />
                  </button>
                </>
              )}
              {checkingVideo && <div className="create-post-dropzone-checking">Checking length…</div>}
            </div>
            <input ref={videoInputRef} type="file" accept="video/*" onChange={pickVideo} hidden />

            {videoError && <p className="create-post-error">{videoError}</p>}

            {/* Only once there's a video to be a thumbnail FOR — picking a
                cover before that has nothing to attach to. Optional:
                leaving it blank falls back to whichever frame Cloudflare
                grabs from the video itself once it's processed, same as
                every video posted before this field existed. */}
            {videoFile && (
              <div className="create-post-thumbnail-field">
                <span className="create-post-thumbnail-label">
                  Cover thumbnail <span className="create-post-dropzone-hint">optional — replaces the auto-generated frame</span>
                </span>
                <div
                  className="create-post-dropzone create-post-dropzone-thumbnail"
                  onClick={() => thumbnailInputRef.current && thumbnailInputRef.current.click()}
                  style={thumbnailPreview ? { backgroundImage: `url(${thumbnailPreview})` } : undefined}
                >
                  {!thumbnailPreview ? (
                    <div className="create-post-dropzone-empty">
                      <ImageIcon size={18} />
                      <span>Add cover</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="create-post-dropzone-remove"
                      onClick={(e) => { e.stopPropagation(); clearThumbnail(); }}
                      aria-label="Remove custom thumbnail"
                    >
                      <CloseIcon size={14} />
                    </button>
                  )}
                </div>
                <input ref={thumbnailInputRef} type="file" accept="image/*" onChange={pickThumbnail} hidden />
              </div>
            )}

            <textarea
              className="create-post-caption"
              value={videoCaption}
              onChange={(e) => setVideoCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              rows={3}
              placeholder="What's this clip about?"
            />
            <div className="create-post-char-count">{videoCaption.length}/{MAX_CAPTION_LENGTH}</div>

            <div className="create-post-form-actions">
              <button className="account-btn-primary" type="submit" disabled={!videoFile || checkingVideo} style={{ width: 'auto' }}>
                <PlusIcon size={14} /> Post snippet
              </button>
              <button className="account-btn-secondary" type="button" onClick={backToChoose} style={{ width: 'auto' }}>
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  ), document.body);
}
