import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminEditEpisodeModal from '../AdminEditEpisodeModal';
import ManualEpisodeForm from '../ManualEpisodeForm';
import { isTitleId } from '../../lib/titleIds';

// Content library and its queues: every episode (search + edit), the
// homepage hero pool, pending artwork, pending edits, deletion
// requests, orphaned media, and the manual "add an episode" form. Moved
// out of the old pages/admin.js hub (2026-10-08); rendered by
// pages/admin/library.js. Section ids match the old hub's anchors so
// old links still land in the right place.
//
// Since the series revamp's slice 3a a show's queue rows link to its page
// on Admin → Shows (a show's removal is decided there, where its card says
// what goes with it), an episode's waiting art lists its title image and
// trailer too (migration 120), Orphaned media has Dismiss (off the list,
// the file left alone), and ?edit=<id> opens the edit modal for that title
// (the admin show page's "Open in Library modal").
// 1780 -> "29:40" for the Ad plan link on a library row.
function fmtAir(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export default function LibraryPanel({ allSeries: initialAllSeries }) {
  const router = useRouter();
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

  // ?edit=<id> (from a show's page): that title's edit modal, read on its own.
  const editParam = router.isReady && typeof router.query.edit === 'string' ? router.query.edit : null;
  const [editNote, setEditNote] = useState(null);
  useEffect(() => {
    if (!editParam) return undefined;
    let alive = true;
    if (!isTitleId(editParam)) {
      setEditNote('That title isn’t there.');
      return undefined;
    }
    fetch(`/api/admin/library?id=${encodeURIComponent(editParam)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!alive) return;
        const row = ok && Array.isArray(d.episodes) ? d.episodes[0] : null;
        if (row) {
          setEditingEpisode(row);
          setEditNote(null);
        } else setEditNote(d.error || 'That title isn’t there.');
      })
      .catch(() => { if (alive) setEditNote('Couldn’t open that title — try again.'); });
    return () => { alive = false; };
  }, [editParam]);

  // Closing the modal opened from ?edit= leaves the address as the Library's.
  function closeEdit() {
    setEditingEpisode(null);
    if (editParam) {
      const q = { ...router.query };
      delete q.edit;
      router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true, scroll: false });
    }
  }

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

  // `seen`: what the card showed waiting (from the list), so a change the
  // creator replaced since is refused instead of going live unseen.
  const resolveArtwork = (type, id, decision, seen) => postDecision('/api/admin/resolve-artwork', { type, id, decision, ...(seen ? { seen } : {}) }, setArtworkActionLoading, setArtworkError, `${type}-${id}`,
    () => Promise.all([loadPendingArtwork(), loadOrphans(), loadLibrary(librarySearch)]));
  const resolveEdit = (type, id, decision, seen) => postDecision('/api/admin/resolve-edit', { type, id, decision, ...(seen ? { seen } : {}) }, setEditActionLoading, setEditError, `${type}-${id}`,
    () => Promise.all([loadPendingEdits(), loadLibrary(librarySearch)]));
  const resolveDeletion = (type, id, decision) => postDecision('/api/admin/resolve-deletion', { type, id, decision }, setDeletionActionLoading, setDeletionError, `${type}-${id}`,
    () => Promise.all([loadDeletions(), loadLibrary(librarySearch), loadOrphans()]));
  const cleanupOrphan = (orphanId) => postDecision('/api/admin/cleanup-orphan', { orphanId }, setOrphanActionLoading, setOrphanError, orphanId, () => loadOrphans());
  const dismissOrphan = (orphanId) => postDecision('/api/admin/orphaned-media', { orphanId }, setOrphanActionLoading, setOrphanError, `dismiss-${orphanId}`, () => loadOrphans());
  const openShow = (id, hash = '') => (
    <Link href={`/admin/shows/${encodeURIComponent(id)}${hash}`} className="account-btn-secondary" style={{ width: 'auto', textDecoration: 'none' }}>Open the show →</Link>
  );

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
      {editNote && <p className="rq-error" role="alert">{editNote}</p>}
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
                  {e.status === 'approved' && e.adPlan && (
                    <span style={{ color: e.adPlan.status === 'ready' ? 'var(--ok)' : 'var(--olive)' }}>
                      {' · '}ad plan {e.adPlan.status === 'ready' ? `ready · air ${fmtAir(e.adPlan.airSeconds)}` : 'draft'}
                    </span>
                  )}
                </div>
              </div>
              <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {e.status === 'approved' && <a className="account-btn-secondary" style={{ width: 'auto', textDecoration: 'none' }} href={`/ad-plan/${e.id}`}>Ad plan</a>}
                <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setEditingEpisode(e)}>Edit</button>
              </span>
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
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                  {e.pendingPoster && 'New poster staged. '}{e.pendingThumbnail && 'New thumbnail staged. '}
                  {e.pendingTitleImageUrl && 'New title image staged. '}{e.pendingTitleImageRemoval && !e.pendingTitleImageUrl && 'Title image removal requested. '}{e.pendingTrailerSrc && 'New trailer staged.'}
                </p>
                {decideButtons(artworkActionLoading === `episode-${e.id}`, () => resolveArtwork('episode', e.id, 'approve', e.seen), () => resolveArtwork('episode', e.id, 'deny', e.seen))}
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
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {decideButtons(artworkActionLoading === `series-${s.id}`, () => resolveArtwork('series', s.id, 'approve', s.seen), () => resolveArtwork('series', s.id, 'deny', s.seen))}
                  {openShow(s.id)}
                </div>
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
                {decideButtons(editActionLoading === `episode-${e.id}`, () => resolveEdit('episode', e.id, 'approve', e.seen), () => resolveEdit('episode', e.id, 'deny', e.seen))}
              </div>
            ))}
            {pendingEdits.series.map((s) => (
              <div key={`series-${s.id}`} style={rowStyle}>
                {kindTag('Show / series', 'var(--brass)')}
                {s.pendingName && <p style={{ margin: '0 0 0.3rem', fontSize: '0.85rem' }}><strong>Name:</strong> {s.currentName} <span style={{ color: 'var(--ink-dim)' }}>→</span> {s.pendingName}</p>}
                {s.pendingDescription && <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}><strong>Description:</strong> {s.currentDescription} <span>→</span> {s.pendingDescription}</p>}
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {decideButtons(editActionLoading === `series-${s.id}`, () => resolveEdit('series', s.id, 'approve', s.seen), () => resolveEdit('series', s.id, 'deny', s.seen))}
                  {openShow(s.id)}
                </div>
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
                <p style={{ margin: '0 0 0.3rem', fontSize: '0.85rem' }}>Reason: {s.reason}</p>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: 'var(--ink-dim)' }}>A show is removed from its page, where you can see what goes with it and what stays for its buyers.</p>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  {openShow(s.id, '#removal')}
                  <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={deletionActionLoading === `series-${s.id}`} onClick={() => resolveDeletion('series', s.id, 'deny')}>
                    {deletionActionLoading === `series-${s.id}` ? 'Working…' : 'Deny — restore it'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div id="library-orphans" className="account-card">
        <div className="account-eyebrow">Orphaned media</div>
        <h3>Files no longer referenced anywhere</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Left behind by confirmed deletions and replaced videos or artwork. Deleting here is permanent; Dismiss takes a row off this list and leaves the file where it is.</p>
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
              <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={Boolean(orphanActionLoading)} onClick={() => cleanupOrphan(o.id)}>
                  {orphanActionLoading === o.id ? 'Deleting…' : '🗑 Delete now'}
                </button>
                <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={Boolean(orphanActionLoading)} title="Take it off this list and leave the file alone" onClick={() => dismissOrphan(o.id)}>
                  {orphanActionLoading === `dismiss-${o.id}` ? 'Dismissing…' : 'Dismiss'}
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {editingEpisode && (
        <AdminEditEpisodeModal
          episode={editingEpisode}
          allSeries={allSeries}
          standaloneEpisodes={(library || []).filter((e) => ['movie', 'short'].includes(e.contentType) && e.id !== editingEpisode.id)}
          onClose={closeEdit}
          onSaved={() => { closeEdit(); loadLibrary(librarySearch); loadOrphans(); queueChanged(); }}
        />
      )}
    </>
  );
}
