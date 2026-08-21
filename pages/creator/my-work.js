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
import RssImportPanel from '../../components/RssImportPanel';
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
  if (!account.isCreator && !account.isAdmin) {
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
  const [searchQuery, setSearchQuery] = useState('');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [artworkSubmission, setArtworkSubmission] = useState(null);
  const [deletingSubmission, setDeletingSubmission] = useState(null);
  const [captionSubmission, setCaptionSubmission] = useState(null);
  const [replacingVideoSubmission, setReplacingVideoSubmission] = useState(null);
  const [deleteActionError, setDeleteActionError] = useState(null);
  const [extractingId, setExtractingId] = useState(null);
  const [extractProgress, setExtractProgress] = useState(null);

  async function extractAudio(episodeId) {
    setExtractingId(episodeId);
    setExtractProgress(null);
    // Polls every 3s, same cadence as the Cloudflare processing polls
    // used elsewhere (CloudflareHouseAdImport, etc.) — audio extraction
    // runs on Cloudflare's side and this just checks in on it.
    const poll = async () => {
      try {
        const res = await fetch('/api/creator/extract-podcast-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not extract audio.');
        if (data.status === 'ready') {
          setExtractingId(null);
          setExtractProgress(null);
          loadSubmissions();
          return;
        }
        setExtractProgress(data.percentComplete);
        setTimeout(poll, 3000);
      } catch (err) {
        setDeleteActionError(err.message);
        setExtractingId(null);
        setExtractProgress(null);
      }
    };
    poll();
  }

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

  const filteredSubmissions = (submissions || []).filter((s) => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (searchQuery.trim() && !s.title.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    if (needsAttentionOnly) {
      const needsIt = s.status === 'pending' || (s.missingArtwork && s.status !== 'rejected') || (s.status === 'approved' && s.contentType !== 'podcast' && !s.captionsUrl);
      if (!needsIt) return false;
    }
    return true;
  });

  const STANDALONE_TYPE_LABELS = { movie: 'Films', short: 'Shorts', vertical: 'Vertical', podcast: 'Podcasts' };

  // Grouped by project always — a show/series/podcast gets its own
  // section keyed by seriesId (podcast episodes always belong to a show,
  // same as series episodes), and anything without one (standalone
  // movies/shorts/vertical) gets grouped by content type instead, so a
  // creator with several different kinds of standalone work still sees
  // it organized rather than one undifferentiated pile.
  const groupsByKey = {};
  for (const s of filteredSubmissions) {
    const isGrouped = !!s.seriesId;
    const key = isGrouped ? `series:${s.seriesId}` : `type:${s.contentType}`;
    if (!groupsByKey[key]) {
      groupsByKey[key] = {
        key,
        isGrouped,
        label: isGrouped ? (s.seriesName || 'Untitled show') : (STANDALONE_TYPE_LABELS[s.contentType] || 'Other'),
        typeTag: s.contentType === 'podcast' ? '🎧 Podcast' : (s.contentType === 'series' ? 'Series' : null),
        items: []
      };
    }
    groupsByKey[key].items.push(s);
  }
  // Shows/series/podcasts first (alphabetical), then standalone-by-type
  // groups after, in that same fixed Films/Shorts/Vertical/Podcasts order
  // used everywhere else on the site.
  const typeOrder = Object.keys(STANDALONE_TYPE_LABELS);
  const projectGroups = Object.values(groupsByKey).sort((a, b) => {
    if (a.isGrouped !== b.isGrouped) return a.isGrouped ? -1 : 1;
    if (!a.isGrouped && !b.isGrouped) {
      return typeOrder.indexOf(a.items[0].contentType) - typeOrder.indexOf(b.items[0].contentType);
    }
    return a.label.localeCompare(b.label);
  });

  function renderEpisodeRow(s) {
    const flags = [];
    if (s.missingArtwork && s.status !== 'rejected') flags.push({ icon: '🖼', title: 'Missing artwork' });
    if (s.contentType !== 'podcast' && !s.captionsUrl && s.status === 'approved') flags.push({ icon: '💬', title: 'No captions' });
    if (s.artworkPending) flags.push({ icon: '⏳', title: 'Artwork change awaiting approval' });
    if (s.deletionRequested) flags.push({ icon: '🗑', title: 'Pending deletion' });

    return (
      <div key={s.id} className="episode-row">
        <div className="episode-thumb" style={s.thumbnail ? { backgroundImage: `url(${s.thumbnail})` } : {}}>
          {!s.thumbnail && (s.cloudflareState === 'error' ? '⚠' : '⏳')}
        </div>
        <div className="episode-row-main">
          <div className="episode-title">
            {s.title}
            {/* For a podcast with both audio and video, showing both icons
                here is the whole point — at a glance, a creator can tell
                which of their episodes are audio-only, video-only, or
                offer both, without opening anything. */}
            {s.hasVideo && <span className="episode-media-icon" title="Has video">🎬</span>}
            {s.hasAudio && <span className="episode-media-icon" title="Has audio">🎧</span>}
          </div>
          <div className="episode-meta">
            {s.cloudflareState && s.cloudflareState !== 'ready'
              ? (CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState)
              : (s.runtime || s.description)}
          </div>
          {s.status === 'rejected' && s.rejectionReason && (
            <p className="submission-rejection">Admin's note: {s.rejectionReason}</p>
          )}
          {s.cloudflareState === 'error' && s.cloudflareError && (
            <p className="submission-rejection">Upload problem: {s.cloudflareError} — this file likely needs to be re-exported and re-submitted.</p>
          )}
          {s.deletionRequested && <p className="submission-rejection">Deletion reason: {s.deletionReason}</p>}
        </div>
        <span className={`status-pill ${s.status}`}>{(STATUS_LABEL[s.status] || {}).text || s.status}</span>
        <div className="row-views">{s.status === 'approved' ? `👁 ${s.viewCount}` : '—'}</div>
        {flags.length > 0 && (
          <div className="row-flags">
            {flags.map((f) => <span key={f.icon} className="row-flag" title={f.title}>{f.icon}</span>)}
          </div>
        )}
        <div className="row-actions">
          {s.contentType === 'podcast' && s.hasVideo && !s.hasAudio && (
            <button onClick={() => extractAudio(s.id)} disabled={extractingId === s.id} title="Extract audio from video">
              {extractingId === s.id ? `…${extractProgress != null ? ` ${Math.round(extractProgress)}%` : ''}` : '🎧+'}
            </button>
          )}
          {s.status === 'pending' && !s.deletionRequested && (
            <button onClick={() => setEditingSubmission(s)} title="Edit">✎</button>
          )}
          {!s.deletionRequested && (
            <button onClick={() => setArtworkSubmission(s)} title={s.poster || s.thumbnail ? 'Replace artwork' : 'Add artwork'}>🖼</button>
          )}
          {!s.deletionRequested && (
            <button onClick={() => setReplacingVideoSubmission(s)} title={s.hasVideo ? 'Replace video' : 'Add video'}>🎬</button>
          )}
          {!s.deletionRequested && s.contentType !== 'podcast' && (
            <button onClick={() => setCaptionSubmission(s)} title={s.captionsUrl ? 'Replace captions' : 'Add captions'}>💬</button>
          )}
          {s.deletionRequested ? (
            <button onClick={() => cancelEpisodeDeletion(s.id)} title="Cancel deletion request">↺</button>
          ) : (
            <button onClick={() => setDeletingSubmission(s)} title="Request deletion">🗑</button>
          )}
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

        <RssImportPanel allSeries={allSeries} onImported={loadSubmissions} />

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

              <div className="yourwork-toolbar">
                <input
                  type="search"
                  placeholder="Search your titles…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {['all', 'pending', 'approved', 'rejected'].map((f) => (
                  <button
                    key={f}
                    className={`filter-pill ${statusFilter === f ? 'on' : ''}`}
                    onClick={() => setStatusFilter(f)}
                  >
                    {f === 'all' ? 'All' : STATUS_LABEL[f].text}
                  </button>
                ))}
                <button
                  className={`filter-pill ${needsAttentionOnly ? 'on' : ''}`}
                  onClick={() => setNeedsAttentionOnly((v) => !v)}
                >
                  ⚠ Needs attention
                </button>
              </div>

              {filteredSubmissions.length === 0 && (
                <p>Nothing matches this filter.</p>
              )}

              {projectGroups.map((group) => {
                const pendingInGroup = group.items.filter((s) => s.status === 'pending').length;
                const missingArtworkInGroup = group.items.filter((s) => s.missingArtwork && s.status !== 'rejected').length;
                const groupArt = group.items.find((s) => s.thumbnail || s.poster);
                return (
                  <div key={group.key} className="project-group">
                    <div className="project-header">
                      <div
                        className="project-art"
                        style={groupArt ? { backgroundImage: `url(${groupArt.thumbnail || groupArt.poster})` } : {}}
                      />
                      <div className="project-title-wrap">
                        <div className="project-title">
                          {group.label}
                          {group.typeTag && <span className="project-type-tag">{group.typeTag}</span>}
                        </div>
                        <div className="project-sub">
                          {group.items.length} episode{group.items.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="project-badges">
                        {pendingInGroup > 0 && <span className="project-badge pending">{pendingInGroup} pending</span>}
                        {missingArtworkInGroup > 0 && <span className="project-badge missing">{missingArtworkInGroup} needs artwork</span>}
                      </div>
                    </div>
                    {group.items.map(renderEpisodeRow)}
                  </div>
                );
              })}
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
