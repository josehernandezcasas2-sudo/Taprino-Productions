import { useState, useEffect } from 'react';
import Head from 'next/head';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import AdminEditEpisodeModal from '../components/AdminEditEpisodeModal';

// SECURITY: this is the enforcement point for "private, admin-only." A
// non-admin (or anyone not signed in) gets redirected server-side before
// any admin data is ever fetched or rendered — there's no client-side-only
// gate here that a curious person could bypass by disabling JavaScript or
// editing the page's own state.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  return {
    props: {
      mainGenres,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function AdminPortal({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [submissions, setSubmissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [creatorEmail, setCreatorEmail] = useState('');
  const [creatorAction, setCreatorAction] = useState('grant');
  const [creatorStatus, setCreatorStatus] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [deletions, setDeletions] = useState(null);
  const [deletionActionLoading, setDeletionActionLoading] = useState(null);
  const [deletionError, setDeletionError] = useState(null);
  const [stats, setStats] = useState(null);
  const [roster, setRoster] = useState(null);
  const [library, setLibrary] = useState(null);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [librarySearch, setLibrarySearch] = useState('');
  const [editingEpisode, setEditingEpisode] = useState(null);

  async function loadStats() {
    try {
      const res = await fetch('/api/admin/stats');
      const data = await res.json();
      if (res.ok) setStats(data);
    } catch (err) {
      // Leave stats blank on failure — the rest of the page still works.
    }
  }

  async function loadRoster() {
    try {
      const res = await fetch('/api/admin/creators');
      const data = await res.json();
      if (res.ok) setRoster(data.creators);
    } catch (err) {
      setRoster([]);
    }
  }

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

  useEffect(() => { loadStats(); loadRoster(); loadLibrary(''); }, []);

  // Debounced so every keystroke doesn't fire a request — 300ms is enough
  // to feel instant without hammering the endpoint while typing.
  useEffect(() => {
    const t = setTimeout(() => loadLibrary(librarySearch), 300);
    return () => clearTimeout(t);
  }, [librarySearch]);

  async function loadDeletions() {
    try {
      const res = await fetch('/api/admin/pending-deletions');
      const data = await res.json();
      if (res.ok) setDeletions(data);
    } catch (err) {
      setDeletions({ episodes: [], series: [] });
    }
  }

  useEffect(() => { loadDeletions(); }, []);

  async function resolveDeletion(type, id, decision) {
    setDeletionActionLoading(`${type}-${id}`);
    setDeletionError(null);
    try {
      const res = await fetch('/api/admin/resolve-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, decision })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resolve this.');
      await Promise.all([loadDeletions(), loadStats(), loadLibrary(librarySearch)]);
    } catch (err) {
      setDeletionError(err.message);
    }
    setDeletionActionLoading(null);
  }

  async function loadSubmissions() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/pending-submissions');
      const data = await res.json();
      setSubmissions(data.submissions || []);
    } catch (err) {
      setSubmissions([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadSubmissions(); }, []);

  async function review(episodeId, decision, extra = {}) {
    setActionLoading(episodeId);
    try {
      await fetch('/api/admin/review-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, decision, ...extra })
      });
      await Promise.all([loadSubmissions(), loadStats(), loadLibrary(librarySearch)]);
    } catch (err) {
      alert('Could not update this submission.');
    }
    setActionLoading(null);
    setRejectingId(null);
    setRejectionReason('');
  }

  async function submitCreatorAction(e) {
    e.preventDefault();
    setCreatorStatus('Working…');
    try {
      const res = await fetch('/api/admin/manage-creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorEmail, action: creatorAction })
      });
      const data = await res.json();
      setCreatorStatus(res.ok ? `Done — ${creatorEmail} ${creatorAction === 'grant' ? 'can now submit episodes.' : 'no longer has creator access.'}` : data.error);
      if (res.ok) { loadRoster(); loadStats(); }
    } catch (err) {
      setCreatorStatus('Something went wrong.');
    }
  }

  return (
    <>
      <Head>
        <title>Admin — Taprino Transmission</title>
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

      <main className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '820px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Admin Portal</div>
        <p className="library-sub" style={{ marginBottom: '1.2rem' }}>Review creator submissions and manage access.</p>

        {stats && (
          <div className="dash-stats">
            <div className="dash-stat"><div className="dash-stat-value">{stats.total}</div><div className="dash-stat-label">Total episodes</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.pendingCount}</div><div className="dash-stat-label">Pending</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.approvalRate === null ? '—' : `${stats.approvalRate}%`}</div><div className="dash-stat-label">Approval rate</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.avgTurnaroundHours === null ? '—' : `${stats.avgTurnaroundHours}h`}</div><div className="dash-stat-label">Avg. review time</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.creatorCount}</div><div className="dash-stat-label">Creators</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.totalViews}</div><div className="dash-stat-label">Total views</div></div>
          </div>
        )}

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Pending review</div>
          <h3>Creator submissions</h3>

          {loading ? (
            <p>Loading…</p>
          ) : submissions.length === 0 ? (
            <p>Nothing waiting on review right now.</p>
          ) : (
            submissions.map((s) => (
              <div key={s.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '1rem 0' }}>
                <h4 style={{ margin: '0 0 0.3rem' }}>{s.title}</h4>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>{s.description}</p>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--ink-dim)', marginBottom: '0.6rem' }}>
                  {s.content_type} · {s.genre} · {s.runtime} · by {s.artist} · suggested tier: {s.tier}
                </div>
                <video src={s.src} controls style={{ width: '100%', maxWidth: '360px', borderRadius: '4px', marginBottom: '0.6rem' }} />
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button
                    className="account-btn-primary"
                    style={{ width: 'auto' }}
                    disabled={actionLoading === s.id}
                    onClick={() => review(s.id, 'approve', { tierOverride: s.tier })}
                  >
                    {actionLoading === s.id ? 'Working…' : '✓ Approve'}
                  </button>
                  <button
                    className="account-btn-secondary"
                    style={{ width: 'auto' }}
                    disabled={actionLoading === s.id}
                    onClick={() => setRejectingId(rejectingId === s.id ? null : s.id)}
                  >
                    ✕ Reject
                  </button>
                </div>
                {rejectingId === s.id && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <input
                      type="text"
                      placeholder="Reason (shown to the creator)"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}
                    />
                    <button
                      className="account-btn-secondary"
                      style={{ width: 'auto' }}
                      disabled={actionLoading === s.id}
                      onClick={() => review(s.id, 'reject', { rejectionReason })}
                    >
                      Confirm rejection
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Library</div>
          <h3>Every episode, any status</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
            Unlike the pending-review queue above, this includes already-approved and rejected episodes too — edit
            metadata, change tier, toggle homepage-hero eligibility, or un-approve something that shouldn&rsquo;t have gone live.
          </p>

          <input
            type="text"
            placeholder="Search by title or artist…"
            value={librarySearch}
            onChange={(e) => setLibrarySearch(e.target.value)}
            style={{ marginBottom: '0.8rem' }}
          />

          {libraryLoading ? (
            <p>Loading…</p>
          ) : library.length === 0 ? (
            <p>No episodes match.</p>
          ) : (
            library.map((e) => (
              <div key={e.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.8rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.2rem' }}>{e.title}</h4>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--ink-dim)' }}>
                    {e.status === 'approved' ? '✓ live' : e.status === 'pending' ? '⏳ pending' : '✕ rejected'}
                    {' · '}{e.tier}{e.featured ? ' · ⭐ hero-eligible' : ''}{e.deletionRequested ? ' · 🗑 pending deletion' : ''}
                  </div>
                </div>
                <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setEditingEpisode(e)}>
                  Edit
                </button>
              </div>
            ))
          )}
        </div>

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Pending deletions</div>
          <h3>Episode and series removal requests</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
            These are already hidden from the site. Confirming here permanently deletes the row; denying restores it.
          </p>

          {deletionError && <p style={{ color: '#e08a6f', fontSize: '0.85rem' }}>{deletionError}</p>}

          {!deletions ? (
            <p>Loading…</p>
          ) : deletions.episodes.length === 0 && deletions.series.length === 0 ? (
            <p>Nothing pending right now.</p>
          ) : (
            <>
              {deletions.episodes.map((e) => (
                <div key={`episode-${e.id}`} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--signal-amber)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Episode</div>
                  <h4 style={{ margin: '0 0 0.3rem' }}>{e.title}{e.artist ? ` — by ${e.artist}` : ''}</h4>
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>Reason: {e.reason}</p>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      className="account-btn-primary"
                      style={{ width: 'auto' }}
                      disabled={deletionActionLoading === `episode-${e.id}`}
                      onClick={() => resolveDeletion('episode', e.id, 'confirm')}
                    >
                      {deletionActionLoading === `episode-${e.id}` ? 'Working…' : '🗑 Confirm delete'}
                    </button>
                    <button
                      className="account-btn-secondary"
                      style={{ width: 'auto' }}
                      disabled={deletionActionLoading === `episode-${e.id}`}
                      onClick={() => resolveDeletion('episode', e.id, 'deny')}
                    >
                      Deny — restore it
                    </button>
                  </div>
                </div>
              ))}

              {deletions.series.map((s) => (
                <div key={`series-${s.id}`} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--cipher-teal)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Series</div>
                  <h4 style={{ margin: '0 0 0.3rem' }}>{s.name}</h4>
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>Reason: {s.reason}</p>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      className="account-btn-primary"
                      style={{ width: 'auto' }}
                      disabled={deletionActionLoading === `series-${s.id}`}
                      onClick={() => resolveDeletion('series', s.id, 'confirm')}
                    >
                      {deletionActionLoading === `series-${s.id}` ? 'Working…' : '🗑 Confirm delete'}
                    </button>
                    <button
                      className="account-btn-secondary"
                      style={{ width: 'auto' }}
                      disabled={deletionActionLoading === `series-${s.id}`}
                      onClick={() => resolveDeletion('series', s.id, 'deny')}
                    >
                      Deny — restore it
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Creator access</div>
          <h3>Roster</h3>

          {!roster ? (
            <p>Loading…</p>
          ) : roster.length === 0 ? (
            <p>No creators or admins yet.</p>
          ) : (
            roster.map((c) => (
              <div key={c.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.7rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{c.email || '(no email on file)'}</strong>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: c.role === 'admin' ? 'var(--cipher-teal)' : 'var(--signal-amber)' }}>
                    {c.role}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '0.2rem' }}>
                  {c.totalSubmissions} submission{c.totalSubmissions === 1 ? '' : 's'} · {c.approved} approved · {c.pending} pending · {c.rejected} rejected
                  {c.approvalRate !== null ? ` · ${c.approvalRate}% approval rate` : ''}
                </div>
              </div>
            ))
          )}

          <h3 style={{ marginTop: '1.2rem' }}>Grant or revoke</h3>
          <p>Only people you explicitly add here can submit episodes for review.</p>
          <form onSubmit={submitCreatorAction}>
            <input
              type="email"
              placeholder="creator@example.com"
              value={creatorEmail}
              onChange={(e) => setCreatorEmail(e.target.value)}
              required
            />
            <select value={creatorAction} onChange={(e) => setCreatorAction(e.target.value)} style={{ margin: '0.6rem 0', width: '100%', padding: '0.6rem' }}>
              <option value="grant">Grant creator access</option>
              <option value="revoke">Revoke creator access</option>
            </select>
            <button className="account-btn-primary" type="submit">Submit</button>
          </form>
          {creatorStatus && <p style={{ marginTop: '0.6rem' }}>{creatorStatus}</p>}
        </div>
      </main>

      <footer className="site-footer">
        <span>TAPRINO TRANSMISSION</span>
        <span>© {new Date().getFullYear()} Studio Taprino</span>
      </footer>

      {editingEpisode && (
        <AdminEditEpisodeModal
          episode={editingEpisode}
          onClose={() => setEditingEpisode(null)}
          onSaved={() => {
            setEditingEpisode(null);
            loadLibrary(librarySearch);
            loadStats();
            loadSubmissions();
          }}
        />
      )}
    </>
  );
}
