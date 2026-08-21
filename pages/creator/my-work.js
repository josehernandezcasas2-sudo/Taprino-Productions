import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getAllSeries } from '../../lib/series';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import EditSubmissionModal from '../../components/EditSubmissionModal';
import ArtworkModal from '../../components/ArtworkModal';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import CaptionUploadModal from '../../components/CaptionUploadModal';
import ReplaceVideoModal from '../../components/ReplaceVideoModal';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

const STATUS_LABEL = {
  pending: { text: 'Pending review', color: 'var(--signal-amber)' },
  approved: { text: 'Approved — live', color: 'var(--ok)' },
  rejected: { text: 'Rejected', color: 'var(--danger)' }
};

const CF_STATE_LABEL = {
  pendingupload: 'Waiting on upload',
  downloading: 'Cloudflare receiving file…',
  queued: 'Queued for processing',
  inprogress: 'Processing…',
  ready: 'Ready to stream',
  error: 'Processing failed'
};

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeries(), getPublicEpisodes()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      allSeries
    }
  };
}

export default function MyWork({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, allSeries }) {
  const [submissions, setSubmissions] = useState(null);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupBySeries, setGroupBySeries] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [artworkSubmission, setArtworkSubmission] = useState(null);
  const [deletingSubmission, setDeletingSubmission] = useState(null);
  const [captionSubmission, setCaptionSubmission] = useState(null);
  const [replacingVideoSubmission, setReplacingVideoSubmission] = useState(null);
  const [deleteActionError, setDeleteActionError] = useState(null);

  async function loadSubmissions() {
    setLoadingSubmissions(true);
    try {
      const res = await fetch('/api/creator/my-submissions');
      const data = await res.json();
      if (res.ok) setSubmissions(data.submissions);
    } catch (err) {
      // Leave submissions as whatever it already was — a failed refresh
      // shouldn't wipe out what's already showing.
    }
    setLoadingSubmissions(false);
  }

  useEffect(() => { loadSubmissions(); }, []);

  async function requestEpisodeDeletion(reason) {
    const res = await fetch('/api/creator/request-episode-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId: deletingSubmission.id, action: 'request', reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit the request.');
    setDeletingSubmission(null);
    loadSubmissions();
  }

  async function cancelEpisodeDeletion(episodeId) {
    setDeleteActionError(null);
    try {
      const res = await fetch('/api/creator/request-episode-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, action: 'cancel' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel the request.');
      loadSubmissions();
    } catch (err) {
      setDeleteActionError(err.message);
    }
  }

  const total = submissions ? submissions.length : 0;
  const approvedCount = submissions ? submissions.filter((s) => s.status === 'approved').length : 0;
  const pendingCount = submissions ? submissions.filter((s) => s.status === 'pending').length : 0;
  const rejectedCount = submissions ? submissions.filter((s) => s.status === 'rejected').length : 0;
  const reviewedCount = approvedCount + rejectedCount;
  const approvalRate = reviewedCount > 0 ? Math.round((approvedCount / reviewedCount) * 100) : null;
  const turnaroundHoursList = submissions
    ? submissions
        .filter((s) => s.reviewedAt && s.createdAt)
        .map((s) => (new Date(s.reviewedAt).getTime() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60))
    : [];
  const avgTurnaroundHours = turnaroundHoursList.length > 0
    ? Math.round(turnaroundHoursList.reduce((a, b) => a + b, 0) / turnaroundHoursList.length)
    : null;
  const missingArtworkCount = submissions
    ? submissions.filter((s) => s.status !== 'rejected' && s.missingArtwork).length
    : 0;

  const filteredSubmissions = (submissions || []).filter((s) => statusFilter === 'all' || s.status === statusFilter);

  const groupedSubmissions = groupBySeries
    ? filteredSubmissions.reduce((groups, s) => {
        const key = s.seriesName || 'Standalone';
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
        return groups;
      }, {})
    : null;

  function renderCard(s) {
    return (
      <div key={s.id} className="submission-card">
        <div className="submission-thumb">
          {s.thumbnail ? (
            <img src={s.thumbnail} alt="" />
          ) : (
            <div className="submission-thumb-placeholder">
              {s.cloudflareState === 'error' ? '⚠' : '⏳'}
            </div>
          )}
        </div>
        <div className="submission-info">
          <h4>{s.title}</h4>
          <p>{s.description}</p>
          <div className="submission-badges">
            <span style={{ color: (STATUS_LABEL[s.status] || {}).color }}>
              {(STATUS_LABEL[s.status] || {}).text || s.status}
            </span>
            {s.cloudflareState && (
              <span className={s.cloudflareState === 'error' ? 'submission-badge-error' : ''}>
                {CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState}
              </span>
            )}
            {s.status === 'approved' && <span>👁 {s.viewCount} view{s.viewCount === 1 ? '' : 's'}</span>}
            {s.missingArtwork && s.status !== 'rejected' && <span>🖼 missing artwork</span>}
            {!s.captionsUrl && s.status === 'approved' && <span>💬 no captions</span>}
            {s.artworkPending && <span>⏳ artwork change awaiting approval</span>}
            {s.deletionRequested && <span>🗑 pending deletion</span>}
          </div>
          {s.status === 'rejected' && s.rejectionReason && (
            <p className="submission-rejection">Admin's note: {s.rejectionReason}</p>
          )}
          {s.cloudflareState === 'error' && s.cloudflareError && (
            <p className="submission-rejection">Upload problem: {s.cloudflareError} — this file likely needs to be re-exported and re-submitted.</p>
          )}
          {s.deletionRequested && (
            <p className="submission-rejection">Deletion reason: {s.deletionReason}</p>
          )}
          <div className="submission-card-actions">
            {s.status === 'pending' && !s.deletionRequested && (
              <button onClick={() => setEditingSubmission(s)}>✎ Edit</button>
            )}
            {!s.deletionRequested && (
              <button onClick={() => setArtworkSubmission(s)}>
                🖼 {s.poster || s.thumbnail ? 'Replace artwork' : 'Add artwork'}
              </button>
            )}
            {!s.deletionRequested && (
              <button onClick={() => setReplacingVideoSubmission(s)}>🎬 Replace video</button>
            )}
            {!s.deletionRequested && (
              <button onClick={() => setCaptionSubmission(s)}>
                💬 {s.captionsUrl ? 'Replace captions' : 'Add captions'}
              </button>
            )}
            {s.deletionRequested ? (
              <button onClick={() => cancelEpisodeDeletion(s.id)}>Cancel deletion request</button>
            ) : (
              <button onClick={() => setDeletingSubmission(s)}>🗑 Request deletion</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Your work — {SITE.name}</title>
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

      <main id="main-content" className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Creator Studio</div>
            <h1>Your work</h1>
            <p className="ca-sub">Everything you've submitted, pending or already live — edit, add artwork, or manage it here.</p>
          </div>
          <Link href="/creator" className="account-btn-primary" style={{ width: 'auto', textDecoration: 'none' }}>
            + Submit new episode
          </Link>
        </div>

        <div className="account-card">
          <p style={{ margin: '0 0 1rem', fontSize: '0.87rem', color: 'var(--ink-dim)' }}>
            Want to see how they&rsquo;re doing?{' '}
            <Link href="/creator/analytics" style={{ color: 'var(--signal-amber)' }}>
              View your numbers →
            </Link>
          </p>

          {deleteActionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{deleteActionError}</p>}

          {loadingSubmissions && <p>Loading…</p>}

          {!loadingSubmissions && submissions && submissions.length === 0 && (
            <p>Nothing submitted yet — <Link href="/creator" style={{ color: 'var(--signal-amber)' }}>submit your first one</Link>.</p>
          )}

          {!loadingSubmissions && submissions && submissions.length > 0 && (
            <>
              <div className="dash-stats">
                <div className="dash-stat">
                  <div className="dash-stat-value">{total}</div>
                  <div className="dash-stat-label">Total</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{pendingCount}</div>
                  <div className="dash-stat-label">Pending</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{approvedCount}</div>
                  <div className="dash-stat-label">Approved</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{approvalRate === null ? '—' : `${approvalRate}%`}</div>
                  <div className="dash-stat-label">Approval rate</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{avgTurnaroundHours === null ? '—' : `${avgTurnaroundHours}h`}</div>
                  <div className="dash-stat-label">Avg. review time</div>
                </div>
              </div>

              {missingArtworkCount > 0 && (
                <div className="dash-nudge">
                  🖼 {missingArtworkCount} submission{missingArtworkCount === 1 ? '' : 's'} still missing a poster or thumbnail — use &ldquo;Add artwork&rdquo; below on any of them, pending or already live.
                </div>
              )}

              <div className="dash-controls">
                {['all', 'pending', 'approved', 'rejected'].map((f) => (
                  <button
                    key={f}
                    className={`dash-filter-btn ${statusFilter === f ? 'active' : ''}`}
                    onClick={() => setStatusFilter(f)}
                  >
                    {f === 'all' ? 'All' : STATUS_LABEL[f].text}
                  </button>
                ))}
                <button
                  className={`dash-filter-btn ${groupBySeries ? 'active' : ''}`}
                  onClick={() => setGroupBySeries((v) => !v)}
                  style={{ marginLeft: 'auto' }}
                >
                  {groupBySeries ? '▤ Grouped by series' : '☰ Group by series'}
                </button>
              </div>

              {filteredSubmissions.length === 0 && (
                <p>Nothing matches this filter.</p>
              )}

              {groupBySeries ? (
                <div className="submission-grid">
                  {Object.entries(groupedSubmissions).map(([seriesName, items]) => (
                    <div key={seriesName} style={{ gridColumn: '1 / -1' }}>
                      <div className="dash-group-heading">{seriesName} ({items.length})</div>
                      <div className="submission-grid">
                        {items.map(renderCard)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="submission-grid">
                  {filteredSubmissions.map(renderCard)}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />

      {editingSubmission && (
        <EditSubmissionModal
          submission={editingSubmission}
          allSeries={allSeries}
          onClose={() => setEditingSubmission(null)}
          onSaved={() => { setEditingSubmission(null); loadSubmissions(); }}
        />
      )}

      {artworkSubmission && (
        <ArtworkModal
          submission={artworkSubmission}
          onClose={() => setArtworkSubmission(null)}
          onSaved={() => { setArtworkSubmission(null); loadSubmissions(); }}
        />
      )}

      {deletingSubmission && (
        <DeleteRequestModal
          itemLabel={deletingSubmission.title}
          onClose={() => setDeletingSubmission(null)}
          onConfirm={requestEpisodeDeletion}
        />
      )}

      {replacingVideoSubmission && (
        <ReplaceVideoModal
          submission={replacingVideoSubmission}
          onClose={() => { setReplacingVideoSubmission(null); loadSubmissions(); }}
        />
      )}

      {captionSubmission && (
        <CaptionUploadModal
          submission={captionSubmission}
          onClose={() => setCaptionSubmission(null)}
          onSaved={loadSubmissions}
        />
      )}
    </>
  );
}
