import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getRoleContext } from '../lib/roles';
import { getAllSeries } from '../lib/series';

// SECURITY: same enforcement pattern as /admin — a non-creator is
// redirected server-side before this page (or any creator-only data) ever
// renders.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const allSeries = await getAllSeries();
  return { props: { allSeries } };
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

export default function CreatorSubmit({ allSeries }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function uploadWithProgress(url, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      const body = new FormData();
      body.append('file', file);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Upload failed.'));
      xhr.send(body);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) {
      setStatus({ error: 'Please choose a video file.' });
      return;
    }
    setSubmitting(true);
    setStatus({ info: 'Requesting upload link…' });

    try {
      const urlRes = await fetch('/api/creator/get-upload-url', { method: 'POST' });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not get an upload link.');

      setStatus({ info: 'Uploading video…' });
      await uploadWithProgress(urlData.uploadUrl, file);

      setStatus({ info: 'Saving submission…' });
      const submitRes = await fetch('/api/creator/submit-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, videoUid: urlData.uid })
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Could not save the submission.');

      setStatus({ success: 'Submitted — it now sits with the admin for review before it goes live.' });
      setForm(EMPTY_FORM);
      setFile(null);
      setUploadPct(0);
    } catch (err) {
      setStatus({ error: err.message });
    }
    setSubmitting(false);
  }

  return (
    <>
      <Head>
        <title>Submit an episode — Taprino Transmission</title>
      </Head>

      <header className="channel-bar">
        <div className="channel-mark">
          <span className="dot" aria-hidden="true" />
          <span>CREATOR</span>
        </div>
        <div className="channel-title">
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>TAPRINO TRANSMISSION</Link>
          <span className="sub">submit new episode</span>
        </div>
        <Link href="/" className="install-btn" style={{ textDecoration: 'none' }}>← Back to screening room</Link>
      </header>

      <main className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '560px' }}>
        <div className="account-card">
          <div className="account-eyebrow">New submission</div>
          <h3>Every field here is required</h3>
          <p>Your submission goes to the admin for review — it won&rsquo;t appear on the site until approved.</p>

          <form onSubmit={handleSubmit}>
            <label>Title</label>
            <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />

            <label>Description</label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />

            <label>Your name / artist credit</label>
            <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />

            <label>Runtime (e.g. 05:30)</label>
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
                  {allSeries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__new__">A new series not listed here</option>
                </select>
                {form.seriesId === '__new__' && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
                    Mention the new series name in your description above — the admin will set it up and can move this submission into it during review.
                  </p>
                )}
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
              <option value="premium">Cipher Circle (premium)</option>
            </select>

            <label>Video file (under 200MB for now)</label>
            <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files[0] || null)} required style={{ marginBottom: '0.8rem' }} />

            {uploadPct > 0 && uploadPct < 100 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginBottom: '0.6rem' }}>Uploading… {uploadPct}%</div>
            )}

            <button className="account-btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit for review'}
            </button>
          </form>

          {status && status.info && <p style={{ marginTop: '0.8rem' }}>{status.info}</p>}
          {status && status.success && <p style={{ marginTop: '0.8rem', color: 'var(--signal-amber)' }}>{status.success}</p>}
          {status && status.error && <p style={{ marginTop: '0.8rem', color: '#e08a6f' }}>{status.error}</p>}
        </div>
      </main>
    </>
  );
}
