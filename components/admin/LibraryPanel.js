import { useEffect, useState } from 'react';
import AdminEditEpisodeModal from '../AdminEditEpisodeModal';
import ManualEpisodeForm from '../ManualEpisodeForm';

// Content library and its queues: every episode (search + edit), the
// homepage hero pool, pending artwork, pending edits, deletion
// requests, orphaned media, and the manual "add an episode" form. Moved
// out of the old pages/admin.js hub (2026-10-08); rendered by
// pages/admin/library.js. Section ids match the old hub's anchors so
// old links still land in the right place.
export default function LibraryPanel({ allSeries: initialAllSeries }) {
  const [allSeries, setAllSeries] = useState(initialAllSeries || []);
  const [library, setLibrary] = useState(null);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [librarySearch, setLibrarySearch] = useState('');
  const [editingEpisode, setEditingEpisode] = useState(null);
  const [pendingArtwork, setPendingArtwork] = useState(null);
  const [artworkActionLoading, setArtworkActionLoading] = useState(null);
  const [artworkError, setArtworkError] = useState(null);
  const [pendingEdits, setPendingEdits] = useState(null);
  const [editActionLoading, setEditActionLoading] = useState(null);
  const [editError, setEditError] = useState(null);
  const [deletions, setDeletions] = useState(null);
  const [deletionActionLoading, setDeletionActionLoading] = useState(null);
  const [deletionError, setDeletionError] = useState(null);
  const [orphans, setOrphans] = useState(null);
  const [orphanActionLoading, setOrphanActionLoading] = useState(null);
  const [orphanError, setOrphanError] = useState(null);

  async function loadLibrary(q) {
    setLibraryLoading(true);
    try {
      const res = await fetch(`/api/admin/library${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      const data = await res.json();
      setLibrary(data.episodes || []);
    } catch (err) {
      setLibrary([]);
    }
    setLibraryLoading(false);
  }

  async function loadAllSeries() {
    try {
      const res = await fetch('/api/creator/list-series');
      const data = await res.json();
      if (res.ok) setAllSeries(data.series || []);
    } catch (err) {
      // Keep the existing list.
    }
  }

  async function loadPendingArtwork() {
    try {
      const res = await fetch('/api/admin/pending-artwork');
      const data = await res.json();
      if (res.ok) setPendingArtwork(data);
    } catch (err) {
      setPendingArtwork({ episodes: [], series: [] });
    }
  }

  async function loadPendingEdits() {
    try {
      const res = await fetch('/api/admin/pending-edits');
      const data = await res.json();
      if (res.ok) setPendingEdits(data);
    } catch (err) {
      setPendingEdits({ episodes: [], series: [] });
    }
  }

  async function loadDeletions() {
    try {
      const res = await fetch('/api/admin/pending-deletions');
      const data = await res.json();
      if (res.ok) setDeletions(data);
    } catch (err) {
      setDeletions({ episodes: [], series: [] });
    }
  }

  async function loadOrphans() {
    try {
      const res = await fetch('/api/admin/orphaned-media');
      const data = await res.json();
      if (res.ok) setOrphans(data.orphans);
    } catch (err) {
      setOrphans([]);
    }
  }

  useEffect(() => { loadLibrary(''); loadPendingArtwork(); loadPendingEdits(); loadDeletions(); loadOrphans(); }, []);

  // Debounced search — 300ms feels instant without hammering the endpoint.
  useEffect(() => {
    const t = setTimeout(() => loadLibrary(librarySearch), 300);
    return () => clearTimeout(t);
  }, [librarySearch]);

  function queueChanged() {
    window.dispatchEvent(new CustomEvent('taprino:admin-queue-changed'));
  }

  async function quickRemoveFromHero(episodeId) {
    try {
      await fetch('/api/admin/edit-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, featured: false })
      });
      await loadLibrary(librarySearch);
    } catch (err) {
      alert('Could not update this.');
    }
  }

  async function postDecision(url, body, setBusy, setError, key, after) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resolve this.');
      await after();
      queueChanged();
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  }

  const resolveArtwork = (type, id, decision) => postDecision('/api/admin/resolve-artwork', { type, id, decision }, setArtworkActionLoading, setArtworkError, `${type}-${id}`,
    () => Promise.all([loadPendingArtwork(), loadOrphans(), loadLibrary(librarySearch)]));
  const resolveEdit = (type, id, decision) => postDecision('/api/admin/resolve-edit', { type, id, decision }, setEditActionLoading, setEditError, `${type}-${id}`,
    () => Promise.all([loadPendingEdits(), loadLibrary(librarySearch)]));
  const resolveDeletion = (type, id, decision) => postDecision('/api/admin/resolve-deletion', { type, id, decision }, setDeletionActionLoading, setDeletionError, `${type}-${id}`,
    () => Promise.all([loadDeletions(), loadLibrary(librarySearch), loadOrphans()]));
  const cleanupOrphan = (orphanId) => postDecision('/api/admin/cleanup-orphan', { orphanId }, setOrphanActionLoading, setOrphanError, orphanId, () => loadOrphans());

  const rowStyle = { borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.9rem 0' };
  const kindTag = (label, color) => <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color, marginBottom: '0.2rem', textTransform: 'uppercase' }}>{label}</div>;
  const decideButtons = (busy, onYes, onNo, yesLabel = '✓ Approve', noLabel = '✕ Deny') => (
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
      <button className="account-btn-primary" style={{ width: 'auto' }} disabled={busy} onClick={onYes}>{busy ? 'Working…' : yesLabel}</button>
      <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={busy} onClick={onNo}>{noLabel}</button>
    </div>
  );

  return (
    <>
      <div id="library-all" className="account-card">
        <div className="account-eyebrow">Library</div>
        <h3>Every episode, any status</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
          Includes approved and rejected episodes too — edit metadata, change tier, toggle homepage-hero eligibility, or un-approve something that shouldn&rsquo;t have gone live.
        </p>
        <input type="text" placeholder="Search by title or artist…" value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} style={{ marginBottom: '0.8rem' }} />
        {libraryLoading ? (
          <p>Loading…</p>
        ) : library.length === 0 ? (
          <p className="adm-empty">No episodes match.</p>
        ) : (
          library.map((e) => (
            <div key={e.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.8rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div>
                <h4 style={{ margin: '0 0 0.2rem' }}>{e.title}</h4>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--ink-dim)' }}>
                  {e.status === 'approved' ? '✓ live' : e.status === 'pending' ? '⏳ pending' : '✕ rejected'}
                  {' · '}{e.tier}{e.featured ? ' · ⭐ hero-eligible' : ''}{e.deletionRequested ? ' · 🗑 pending deletion' : ''}
                  {!e.rating && <span style={{ color: 'var(--signal-amber)' }}> · no rating set (treated as 17+)</span>}
                </div>
              </div>
              <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setEditingEpisode(e)}>Edit</button>
            </div>
          ))
        )}
      </div>

      <div id="hero-pool" className="account-card">
        <div className="account-eyebrow">Hero rotation</div>
        <h3>Homepage hero pool</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
          Every episode currently eligible for the homepage hero rotation. To add one, find it above and check &ldquo;eligible for the homepage hero rotation&rdquo; in its edit modal.
        </p>
        {libraryLoading ? (
          <p>Loading…</p>
        ) : (library || []).filter((e) => e.featured).length === 0 ? (
          <p className="adm-empty">Nothing in the rotation right now.</p>
        ) : (
          library.filter((e) => e.featured).map((e) => (
            <div key={e.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.7rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div>
                <h4 style={{ margin: '0 0 0.2rem' }}>{e.title}</h4>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--ink-dim)' }}>
                  {e.status === 'approved' ? '✓ live' : e.status === 'pending' ? '⏳ pending' : '✕ rejected'}
                  {e.status !== 'approved' && ' · won’t actually show in rotation until approved'}
                </div>
              </div>
              <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => quickRemoveFromHero(e.id)}>Remove from rotation</button>
            </div>
          ))
        )}
      </div>

      <ManualEpisodeForm
        allSeries={allSeries}
        standaloneEpisodes={(library || []).filter((e) => ['movie', 'short'].includes(e.contentType))}
        onCreated={() => { loadLibrary(librarySearch); loadAllSeries(); queueChanged(); }}
      />

      <div id="library-artwork" className="account-card">
        <div className="account-eyebrow">Pending artwork changes</div>
        <h3>Poster, thumbnail, and trailer changes awaiting approval</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Approving replaces what&rsquo;s currently shown; denying discards the upload and keeps the current one.</p>
        {artworkError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{artworkError}</p>}
        {!pendingArtwork ? <p>Loading…</p> : pendingArtwork.episodes.length === 0 && pendingArtwork.series.length === 0 ? <p className="adm-empty">Nothing pending right now.</p> : (
          <>
            {pendingArtwork.episodes.map((e) => (
              <div key={`episode-${e.id}`} style={rowStyle}>
                {kindTag('Episode', 'var(--signal-amber)')}
                <h4 style={{ margin: '0 0 0.3rem' }}>{e.title}</h4>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>{e.pendingPoster && 'New poster staged. '}{e.pendingThumbnail && 'New thumbnail staged.'}</p>
                {decideButtons(artworkActionLoading === `episode-${e.id}`, () => resolveArtwork('episode', e.id, 'approve'), () => resolveArtwork('episode', e.id, 'deny'))}
              </div>
            ))}
            {pendingArtwork.series.map((s) => (
              <div key={`series-${s.id}`} style={rowStyle}>
                {kindTag('Series', 'var(--brass)')}
                <h4 style={{ margin: '0 0 0.3rem' }}>{s.name}</h4>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                  {s.pendingPoster && 'New poster staged. '}{s.pendingThumbnail && 'New thumbnail staged. '}{s.pendingHeroImage && 'New hero image staged. '}
                  {s.pendingTitleImageUrl && 'New title image staged. '}{s.pendingTitleImageRemoval && 'Title image removal requested. '}{s.pendingTrailerSrc && 'New trailer staged.'}
                </p>
                {decideButtons(artworkActionLoading === `series-${s.id}`, () => resolveArtwork('series', s.id, 'approve'), () => resolveArtwork('series', s.id, 'deny'))}
              </div>
            ))}
          </>
        )}
      </div>

      <div id="library-edits" className="account-card">
        <div className="account-eyebrow">Pending edits</div>
        <h3>Title &amp; description changes awaiting approval</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>A creator requested a change to something already live. Denying leaves the current text untouched; approving replaces it.</p>
        {editError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{editError}</p>}
        {!pendingEdits ? <p>Loading…</p> : pendingEdits.episodes.length === 0 && pendingEdits.series.length === 0 ? <p className="adm-empty">Nothing pending right now.</p> : (
          <>
            {pendingEdits.episodes.map((e) => (
              <div key={`episode-${e.id}`} style={rowStyle}>
                {kindTag('Episode', 'var(--signal-amber)')}
                {e.pendingTitle && <p style={{ margin: '0 0 0.3rem', fontSize: '0.85rem' }}><strong>Title:</strong> {e.currentTitle} <span style={{ color: 'var(--ink-dim)' }}>→</span> {e.pendingTitle}</p>}
                {e.pendingDescription && <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}><strong>Description:</strong> {e.currentDescription} <span>→</span> {e.pendingDescription}</p>}
                {decideButtons(editActionLoading === `episode-${e.id}`, () => resolveEdit('episode', e.id, 'approve'), () => resolveEdit('episode', e.id, 'deny'))}
              </div>
            ))}
            {pendingEdits.series.map((s) => (
              <div key={`series-${s.id}`} style={rowStyle}>
                {kindTag('Show / series', 'var(--brass)')}
                {s.pendingName && <p style={{ margin: '0 0 0.3rem', fontSize: '0.85rem' }}><strong>Name:</strong> {s.currentName} <span style={{ color: 'var(--ink-dim)' }}>→</span> {s.pendingName}</p>}
                {s.pendingDescription && <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}><strong>Description:</strong> {s.currentDescription} <span>→</span> {s.pendingDescription}</p>}
                {decideButtons(editActionLoading === `series-${s.id}`, () => resolveEdit('series', s.id, 'approve'), () => resolveEdit('series', s.id, 'deny'))}
              </div>
            ))}
          </>
        )}
      </div>

      <div id="library-deletions" className="account-card">
        <div className="account-eyebrow">Pending deletions</div>
        <h3>Episode and series removal requests</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>These are already hidden from the site. Confirming permanently deletes the row; denying restores it.</p>
        {deletionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{deletionError}</p>}
        {!deletions ? <p>Loading…</p> : deletions.episodes.length === 0 && deletions.series.length === 0 ? <p className="adm-empty">Nothing pending right now.</p> : (
          <>
            {deletions.episodes.map((e) => (
              <div key={`episode-${e.id}`} style={rowStyle}>
                {kindTag('Episode', 'var(--signal-amber)')}
                <h4 style={{ margin: '0 0 0.3rem' }}>{e.title}{e.artist ? ` — by ${e.artist}` : ''}</h4>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>Reason: {e.reason}</p>
                {decideButtons(deletionActionLoading === `episode-${e.id}`, () => resolveDeletion('episode', e.id, 'confirm'), () => resolveDeletion('episode', e.id, 'deny'), '🗑 Confirm delete', 'Deny — restore it')}
              </div>
            ))}
            {deletions.series.map((s) => (
              <div key={`series-${s.id}`} style={rowStyle}>
                {kindTag('Series', 'var(--brass)')}
                <h4 style={{ margin: '0 0 0.3rem' }}>{s.name}</h4>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>Reason: {s.reason}</p>
                {decideButtons(deletionActionLoading === `series-${s.id}`, () => resolveDeletion('series', s.id, 'confirm'), () => resolveDeletion('series', s.id, 'deny'), '🗑 Confirm delete', 'Deny — restore it')}
              </div>
            ))}
          </>
        )}
      </div>

      <div id="library-orphans" className="account-card">
        <div className="account-eyebrow">Orphaned media</div>
        <h3>Files no longer referenced anywhere</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Left behind by confirmed deletions and replaced videos or artwork. Deleting here is permanent.</p>
        {orphanError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{orphanError}</p>}
        {!orphans ? <p>Loading…</p> : orphans.length === 0 ? <p className="adm-empty">Nothing orphaned right now.</p> : (
          orphans.map((o) => (
            <div key={o.id} style={{ borderTop: '1px solid rgba(251,232,211,0.1)', padding: '0.8rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: o.kind === 'cloudflare_video' ? 'var(--signal-amber)' : 'var(--brass)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                  {o.kind === 'cloudflare_video' ? 'Cloudflare video' : 'Storage image'}
                </div>
                <div style={{ fontSize: '0.9rem' }}>{o.context || '(no title on file)'}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>{o.reason}</div>
              </div>
              <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={orphanActionLoading === o.id} onClick={() => cleanupOrphan(o.id)}>
                {orphanActionLoading === o.id ? 'Deleting…' : '🗑 Delete now'}
              </button>
            </div>
          ))
        )}
      </div>

      {editingEpisode && (
        <AdminEditEpisodeModal
          episode={editingEpisode}
          allSeries={allSeries}
          standaloneEpisodes={(library || []).filter((e) => ['movie', 'short'].includes(e.contentType) && e.id !== editingEpisode.id)}
          onClose={() => setEditingEpisode(null)}
          onSaved={() => { setEditingEpisode(null); loadLibrary(librarySearch); loadOrphans(); queueChanged(); }}
        />
      )}
    </>
  );
}
