import { useState } from 'react';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' }
];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export default function CaptionUploadModal({ submission, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [language, setLanguage] = useState(submission.captionsLanguage || 'en');
  const [label, setLabel] = useState(submission.captionsLabel || 'English');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const hasExisting = !!submission.captionsUrl;

  async function save() {
    if (!file) {
      setError('Choose a .vtt or .srt file first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base64 = await readAsDataUrl(file);
      const res = await fetch('/api/creator/add-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: submission.id,
          captionsBase64: base64,
          captionsFileName: file.name,
          language,
          label
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      setResult(data);
      if (onSaved) onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/creator/add-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: submission.id, remove: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not remove captions.');
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Captions">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="account-eyebrow">Captions</div>
        <h3 style={{ margin: '0 0 0.3rem' }}>{submission.title}</h3>
        <p className="cap-help">
          Captions let deaf and hard-of-hearing viewers watch your work, and they&rsquo;re how most
          people watch with the sound off. They also make your dialogue searchable.
        </p>

        {result ? (
          <div className="cap-success">
            <strong>Captions are live.</strong>
            <span>
              {result.cueCount} caption lines loaded
              {result.converted ? ', converted from SRT to WebVTT automatically' : ''}. Viewers will
              see a CC button on this episode.
            </span>
            <button className="unlock-btn" onClick={onClose} style={{ marginTop: '0.9rem' }}>
              Done
            </button>
          </div>
        ) : (
          <>
            {hasExisting && (
              <div className="cap-existing">
                This episode already has a caption track ({submission.captionsLabel || 'English'}).
                Uploading a new file replaces it.
              </div>
            )}

            <label className="cap-field">
              <span>Caption file</span>
              <input
                type="file"
                accept=".vtt,.srt,text/vtt"
                onChange={(e) => {
                  setFile(e.target.files[0] || null);
                  setError(null);
                }}
              />
              <small>
                WebVTT (.vtt) or SubRip (.srt) — if you upload an .srt we&rsquo;ll convert it for you.
                Most editing software exports one of these; YouTube and Descript both do.
              </small>
            </label>

            <div className="cap-row">
              <label className="cap-field">
                <span>Language</span>
                <select
                  value={language}
                  onChange={(e) => {
                    const code = e.target.value;
                    setLanguage(code);
                    const match = LANGUAGES.find((l) => l.code === code);
                    if (match) setLabel(match.label);
                  }}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cap-field">
                <span>Menu label</span>
                <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
              </label>
            </div>

            {error && <div className="cap-error">{error}</div>}

            <div className="modal-actions">
              <button onClick={onClose} disabled={busy}>Cancel</button>
              {hasExisting && (
                <button onClick={remove} disabled={busy} className="cap-remove">
                  Remove captions
                </button>
              )}
              <button className="unlock-btn" onClick={save} disabled={busy || !file}>
                {busy ? 'Uploading…' : 'Upload captions'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
