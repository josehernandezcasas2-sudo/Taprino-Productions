import { useState } from 'react';
import { useUpload } from '../contexts/UploadContext';
import { readVideoDuration, formatRuntime } from '../lib/videoMetadata';
import { PlusIcon, VideoCameraIcon, ImageIcon } from './PlayerIcons';

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
export default function CreatePostModal({ onClose, onPosted }) {
  const { startUpload } = useUpload();
  const [step, setStep] = useState('choose');

  // Post (caption + optional photo)
  const [caption, setCaption] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Video
  const [videoFile, setVideoFile] = useState(null);
  const [videoDuration, setVideoDuration] = useState(null);
  const [videoCaption, setVideoCaption] = useState('');
  const [checkingVideo, setCheckingVideo] = useState(false);
  const [videoError, setVideoError] = useState(null);

  function handleImagePick(e) {
    const f = e.target.files[0] || null;
    setImageFile(f);
    setImagePreview(f ? URL.createObjectURL(f) : null);
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

  async function handleVideoPick(e) {
    const f = e.target.files[0] || null;
    setVideoFile(f);
    setVideoDuration(null);
    setVideoError(null);
    if (!f) return;
    setCheckingVideo(true);
    try {
      const duration = await readVideoDuration(f);
      if (duration > MAX_VIDEO_SECONDS) {
        setVideoError(`That video is ${formatRuntime(duration)} — videos are limited to 5 minutes.`);
        setVideoFile(null);
      } else {
        setVideoDuration(duration);
      }
    } catch (err) {
      // Can't read duration client-side (unusual codec/container) — let it
      // through; the server re-checks against Cloudflare's own number once
      // it's processed (see pages/api/posts/create.js).
      setVideoDuration(null);
    } finally {
      setCheckingVideo(false);
    }
  }

  function handleVideoSubmit(e) {
    e.preventDefault();
    if (!videoFile) {
      setVideoError('Choose a video first.');
      return;
    }
    startUpload(
      videoFile,
      { kind: 'video', caption: videoCaption.trim(), durationSeconds: videoDuration },
      null,
      'tus',
      '/api/posts/create',
      { label: 'Posted!', meta: 'Your video is live in Discover.' }
    );
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {step === 'choose' ? 'New post' : step === 'post' ? 'New post' : 'New video'}
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === 'choose' && (
          <div className="create-post-choices">
            <button type="button" className="create-post-choice" onClick={() => setStep('post')}>
              <ImageIcon size={26} />
              <span>Post</span>
              <span className="create-post-choice-sub">Caption + an optional photo</span>
            </button>
            <button type="button" className="create-post-choice" onClick={() => setStep('video')}>
              <VideoCameraIcon size={26} />
              <span>Video</span>
              <span className="create-post-choice-sub">Vertical clip, up to 5 minutes</span>
            </button>
          </div>
        )}

        {step === 'post' && (
          <form onSubmit={handlePostSubmit}>
            <label>Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              rows={4}
              placeholder="What's up?"
              style={{ marginBottom: '0.8rem' }}
            />
            <label>Photo — optional</label>
            <input type="file" accept="image/*" onChange={handleImagePick} style={{ marginBottom: '0.8rem' }} />
            {imagePreview && (
              <div className="create-post-image-preview" style={{ backgroundImage: `url(${imagePreview})` }} />
            )}

            {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
              <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
                {saving ? 'Posting…' : 'Post'}
              </button>
              <button className="account-btn-secondary" type="button" onClick={() => setStep('choose')} disabled={saving} style={{ width: 'auto' }}>
                Back
              </button>
            </div>
          </form>
        )}

        {step === 'video' && (
          <form onSubmit={handleVideoSubmit}>
            <label>Video — vertical, up to 5 minutes</label>
            <input type="file" accept="video/*" onChange={handleVideoPick} style={{ marginBottom: '0.4rem' }} />
            {checkingVideo && <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Checking length…</p>}
            {videoDuration != null && (
              <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Length: {formatRuntime(videoDuration)}</p>
            )}
            <label style={{ marginTop: '0.6rem' }}>Caption — optional</label>
            <textarea
              value={videoCaption}
              onChange={(e) => setVideoCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              rows={3}
              placeholder="What's this clip about?"
              style={{ marginBottom: '0.8rem' }}
            />

            {videoError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{videoError}</p>}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
              <button className="account-btn-primary" type="submit" disabled={!videoFile || checkingVideo} style={{ width: 'auto' }}>
                <PlusIcon size={14} /> Post video
              </button>
              <button className="account-btn-secondary" type="button" onClick={() => setStep('choose')} style={{ width: 'auto' }}>
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
