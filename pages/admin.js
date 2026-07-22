import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getRoleContext } from '../lib/roles';

// SECURITY: this is the enforcement point for "private, admin-only." A
// non-admin (or anyone not signed in) gets redirected server-side before
// any admin data is ever fetched or rendered — there's no client-side-only
// gate here that a curious person could bypass by disabling JavaScript or
// editing the page's own state.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  return { props: {} };
}

export default function AdminPortal() {
  const [submissions, setSubmissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [creatorEmail, setCreatorEmail] = useState('');
  const [creatorAction, setCreatorAction] = useState('grant');
  const [creatorStatus, setCreatorStatus] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

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
      await loadSubmissions();
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
    } catch (err) {
      setCreatorStatus('Something went wrong.');
    }
  }

  return (
    <>
      <Head>
        <title>Admin — Taprino Transmission</title>
      </Head>

      <header className="channel-bar">
        <div className="channel-mark">
          <span className="dot" aria-hidden="true" />
          <span>ADMIN</span>
        </div>
        <div className="channel-title">
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>TAPRINO TRANSMISSION</Link>
          <span className="sub">admin portal</span>
        </div>
        <Link href="/" className="install-btn" style={{ textDecoration: 'none' }}>← Back to screening room</Link>
      </header>

      <main className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '820px' }}>
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
          <div className="account-eyebrow">Creator access</div>
          <h3>Grant or revoke</h3>
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
    </>
  );
}
