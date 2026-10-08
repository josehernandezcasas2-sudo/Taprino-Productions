import { useEffect, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import Link from 'next/link';

// Content ratings: the standard MPAA / TV Parental Guidelines list plus any
// custom rating. Each one can carry a PNG bug, which the channel player
// shows top-left as a program starts; custom ratings also set the minimum
// viewer age the age gate uses.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

function readAsDataUrl(f) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(f);
  });
}

async function call(method, body) {
  const res = await fetch('/api/admin/ratings', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export default function RatingsAdmin({ account, mainGenres }) {
  const [ratings, setRatings] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({ code: '', label: '', minAge: '13' });
  const [draftFile, setDraftFile] = useState(null);

  async function load() {
    try {
      setRatings((await call('GET')).ratings);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function act(code, fn) {
    setBusy(code);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const uploadImage = (code, file) => act(code, async () => call('POST', { code, imageBase64: await readAsDataUrl(file), imageFileName: file.name }));
  const clearImage = (code) => act(code, () => call('POST', { code, clearImage: true }));
  const remove = (code) => {
    if (!window.confirm(`Remove the "${code}" rating? Titles already rated ${code} keep the label but will be treated as Not Rated (17+).`)) return;
    act(code, () => call('DELETE', { code }));
  };
  async function addCustom(e) {
    e.preventDefault();
    await act('new', async () => {
      const body = { code: draft.code.trim(), label: draft.label.trim(), minAge: Number(draft.minAge) };
      if (draftFile) { body.imageBase64 = await readAsDataUrl(draftFile); body.imageFileName = draftFile.name; }
      await call('POST', body);
      setDraft({ code: '', label: '', minAge: '13' });
      setDraftFile(null);
    });
  }
  const saveCustomDetails = (r, label, minAge) => act(r.code, () => call('POST', { code: r.code, label, minAge }));

  return (
    <>
      <AdminShell account={account} mainGenres={mainGenres} title="Ratings" crumbs={['Content']}>
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Ratings</h1>
            <p className="ca-sub">
              The ratings creators pick from when they submit, the minimum age each one needs, and the bug the
              channel player shows top-left for a few seconds as a program starts. Upload a PNG for each rating;
              until one is there the player shows the code as text.
            </p>
            <div style={{ background: 'rgba(248,95,115,0.1)', border: '1px solid rgba(248,95,115,0.3)', borderRadius: 8, padding: '0.9rem 1rem', margin: '0.8rem 0' }}>
              <strong>PNG guidelines:</strong> use the standard TV Parental Guidelines and MPAA bugs, as transparent PNGs,
              at least 200px tall (they show at about a tenth of the player&rsquo;s height, bigger in fullscreen). White or
              light artwork reads best over video; a thin dark edge or shadow in the file helps on bright scenes.
            </div>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}
        {!ratings && !error && <p className="ca-sub">Loading…</p>}

        {ratings && (
          <div className="genre-icon-grid">
            {ratings.map((r) => (
              <RatingCard key={r.code} rating={r} busy={busy === r.code} onUpload={(f) => uploadImage(r.code, f)} onClear={() => clearImage(r.code)} onRemove={() => remove(r.code)} onSaveDetails={(label, minAge) => saveCustomDetails(r, label, minAge)} />
            ))}
          </div>
        )}

        <section className="ca-card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', margin: '0 0 0.6rem' }}>Add a custom rating</h2>
          <p className="ca-sub">For anything the standard list doesn&rsquo;t cover. It shows up in every rating dropdown right away.</p>
          <form onSubmit={addCustom} className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.7rem', alignItems: 'end' }}>
            <label className="sch-field"><span>Code</span><input id="rt-code" value={draft.code} maxLength={16} placeholder="18+" onChange={(e) => setDraft({ ...draft, code: e.target.value })} required /></label>
            <label className="sch-field"><span>Label</span><input id="rt-label" value={draft.label} maxLength={60} placeholder="Adults only" onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
            <label className="sch-field"><span>Minimum age</span><input id="rt-age" type="number" min={0} max={21} value={draft.minAge} onChange={(e) => setDraft({ ...draft, minAge: e.target.value })} required /></label>
            <label className="sch-field"><span>PNG (optional)</span><input id="rt-file" type="file" accept="image/png,image/*" onChange={(e) => setDraftFile(e.target.files[0] || null)} /></label>
            <button type="submit" className="sch-btn primary" disabled={busy === 'new' || !draft.code.trim()}>{busy === 'new' ? 'Adding…' : 'Add rating'}</button>
          </form>
        </section>
      </AdminShell>
    </>
  );
}

function RatingCard({ rating, busy, onUpload, onClear, onRemove, onSaveDetails }) {
  const [label, setLabel] = useState(rating.label);
  const [minAge, setMinAge] = useState(String(rating.minAge));
  const detailsChanged = rating.custom && (label !== rating.label || Number(minAge) !== rating.minAge);
  return (
    <div className="genre-icon-card">
      <div className="genre-icon-preview" style={{ background: '#0f0f0a', color: '#eae7dd', height: 72 }}>
        {rating.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={rating.imageUrl} alt={`Rated ${rating.code}`} style={{ height: 56, width: 'auto', objectFit: 'contain' }} />
          : <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', border: '1px solid rgba(234,231,221,0.55)', borderRadius: 4, padding: '0.25rem 0.6rem' }}>{rating.code}</span>}
      </div>
      <div className="genre-icon-name">{rating.code}{rating.custom ? ' · custom' : ''}</div>
      <div className="genre-icon-state">{rating.label} · {rating.minAge === 0 ? 'any age' : `${rating.minAge}+`}</div>
      {rating.custom && (
        <div style={{ display: 'grid', gap: '0.4rem', margin: '0.4rem 0' }}>
          <input aria-label="Label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="sch-search" />
          <input aria-label="Minimum age" type="number" min={0} max={21} value={minAge} onChange={(e) => setMinAge(e.target.value)} className="sch-search" />
          {detailsChanged && <button type="button" className="sch-btn primary" disabled={busy} onClick={() => onSaveDetails(label, Number(minAge))}>Save details</button>}
        </div>
      )}
      <div className="genre-icon-actions">
        <label className="admin-media-action">
          {busy ? 'Working…' : rating.imageUrl ? 'Replace PNG…' : 'Upload PNG…'}
          <input type="file" accept="image/png,image/*" disabled={busy} onChange={(e) => e.target.files[0] && onUpload(e.target.files[0])} />
        </label>
        {rating.imageUrl && <button type="button" className="admin-media-undo" onClick={onClear} disabled={busy}>Remove image</button>}
        {rating.custom && <button type="button" className="admin-media-undo" onClick={onRemove} disabled={busy}>Delete rating</button>}
      </div>
    </div>
  );
}
