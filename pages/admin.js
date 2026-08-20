import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { SITE } from '../lib/siteConfig';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getAllSeriesForCreator } from '../lib/series';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import AdminEditEpisodeModal from '../components/AdminEditEpisodeModal';
import ManualEpisodeForm from '../components/ManualEpisodeForm';
import { siteConfigIncomplete, missingSiteConfigFields } from '../lib/siteConfig';

import Footer from '../components/Footer';
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
  const allSeries = await getAllSeriesForCreator();
  return {
    props: {
      mainGenres,
      allSeries,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function AdminPortal({ mainGenres, allSeries, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [submissions, setSubmissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [creatorEmail, setCreatorEmail] = useState('');
  const [creatorAction, setCreatorAction] = useState('grant');
  const [creatorStatus, setCreatorStatus] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkRejectionReason, setBulkRejectionReason] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState(null);

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkReview(decision) {
    setBulkError(null);
    if (decision === 'reject' && !bulkRejectionReason.trim()) {
      setBulkError('A reason is required to reject.');
      return;
    }
    setBulkLoading(true);
    try {
      const res = await fetch('/api/admin/bulk-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [...selectedIds], decision, rejectionReason: bulkRejectionReason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update these submissions.');
      setSelectedIds(new Set());
      setBulkRejecting(false);
      setBulkRejectionReason('');
      await Promise.all([loadSubmissions(), loadStats(), loadLibrary(librarySearch), loadAuditLog()]);
    } catch (err) {
      setBulkError(err.message);
    }
    setBulkLoading(false);
  }
  const [rejectionReason, setRejectionReason] = useState('');
  const [deletions, setDeletions] = useState(null);
  const [deletionActionLoading, setDeletionActionLoading] = useState(null);
  const [deletionError, setDeletionError] = useState(null);
  const [orphans, setOrphans] = useState(null);
  const [orphanActionLoading, setOrphanActionLoading] = useState(null);
  const [orphanError, setOrphanError] = useState(null);
  const [siteSettings, setSiteSettings] = useState(null);
  const [confirmedSiteSettings, setConfirmedSiteSettings] = useState(null);
  const [siteSettingsSaving, setSiteSettingsSaving] = useState(false);
  const [siteSettingsSaved, setSiteSettingsSaved] = useState(false);
  const [siteSettingsError, setSiteSettingsError] = useState(null);

  async function loadSiteSettings() {
    try {
      const res = await fetch('/api/admin/site-settings');
      const data = await res.json();
      setSiteSettings(data);
      setConfirmedSiteSettings(data);
    } catch (err) {
      setSiteSettingsError('Could not load site settings.');
    }
  }

  async function saveSiteSettings(overrides = {}) {
    setSiteSettingsSaving(true);
    setSiteSettingsSaved(false);
    setSiteSettingsError(null);
    try {
      const res = await fetch('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopEnabled: siteSettings.shopEnabled,
          shopUrl: siteSettings.shopUrl,
          liveTvEnabled: siteSettings.liveTvEnabled,
          recommendationCloseness: siteSettings.recommendationCloseness,
          ...overrides
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      await loadSiteSettings();
      setSiteSettingsSaved(true);
      setTimeout(() => setSiteSettingsSaved(false), 2500);
    } catch (err) {
      setSiteSettingsError(err.message);
    } finally {
      setSiteSettingsSaving(false);
    }
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadSearchIcon(file) {
    setSiteSettingsSaving(true);
    setSiteSettingsError(null);
    try {
      const searchIconBase64 = await readAsDataUrl(file);
      const res = await fetch('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopEnabled: siteSettings.shopEnabled,
          shopUrl: siteSettings.shopUrl,
          liveTvEnabled: siteSettings.liveTvEnabled,
          searchIconBase64,
          searchIconFileName: file.name
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not upload that image.');
      await loadSiteSettings();
    } catch (err) {
      setSiteSettingsError(err.message);
    } finally {
      setSiteSettingsSaving(false);
    }
  }
  const [pendingArtwork, setPendingArtwork] = useState(null);
  const [artworkActionLoading, setArtworkActionLoading] = useState(null);
  const [artworkError, setArtworkError] = useState(null);
  const [auditLog, setAuditLog] = useState(null);

  async function loadAuditLog() {
    try {
      const res = await fetch('/api/admin/audit-log');
      const data = await res.json();
      if (res.ok) setAuditLog(data.entries);
    } catch (err) {
      setAuditLog([]);
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

  async function resolveArtwork(type, id, decision) {
    setArtworkActionLoading(`${type}-${id}`);
    setArtworkError(null);
    try {
      const res = await fetch('/api/admin/resolve-artwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, decision })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resolve this.');
      await Promise.all([loadPendingArtwork(), loadOrphans(), loadLibrary(librarySearch), loadAuditLog()]);
    } catch (err) {
      setArtworkError(err.message);
    }
    setArtworkActionLoading(null);
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

  async function cleanupOrphan(orphanId) {
    setOrphanActionLoading(orphanId);
    setOrphanError(null);
    try {
      const res = await fetch('/api/admin/cleanup-orphan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orphanId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete this.');
      await Promise.all([loadOrphans(), loadAuditLog()]);
    } catch (err) {
      setOrphanError(err.message);
    }
    setOrphanActionLoading(null);
  }
  const [stats, setStats] = useState(null);
  const [roster, setRoster] = useState(null);
  const [library, setLibrary] = useState(null);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [librarySearch, setLibrarySearch] = useState('');
  const [editingEpisode, setEditingEpisode] = useState(null);

  async function quickRemoveFromHero(episodeId) {
    try {
      await fetch('/api/admin/edit-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, featured: false })
      });
      await Promise.all([loadLibrary(librarySearch), loadStats()]);
    } catch (err) {
      alert('Could not update this.');
    }
  }

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

  useEffect(() => { loadDeletions(); loadOrphans(); loadPendingArtwork(); loadAuditLog(); loadSiteSettings(); }, []);

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
      await Promise.all([loadDeletions(), loadStats(), loadLibrary(librarySearch), loadOrphans(), loadAuditLog()]);
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
      await Promise.all([loadSubmissions(), loadStats(), loadLibrary(librarySearch), loadAuditLog()]);
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
      if (res.ok) { loadRoster(); loadStats(); loadAuditLog(); }
    } catch (err) {
      setCreatorStatus('Something went wrong.');
    }
  }

  return (
    <>
      <Head>
        <title>Admin — {SITE.name}</title>
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
      {siteConfigIncomplete() && (
        <div className="admin-config-warning">
          <strong>Legal pages aren&rsquo;t finished.</strong> These are still placeholders in{' '}
          <code>lib/siteConfig.js</code>: {missingSiteConfigFields().join(', ')}. They show up
          literally on your public Terms, Privacy, and Cookie pages until they&rsquo;re filled in —
          and AdSense checks those pages during review.
        </div>
      )}

      <div className="admin-tool-links">
        <Link href="/admin/team">👥 Team &amp; permissions →</Link>
        <Link href="/admin/house-ads">📺 House ads →</Link>
        <Link href="/admin/live">🔴 Go live →</Link>
        <Link href="/admin/channel">📡 Channel schedule →</Link>
        <Link href="/admin/applications">📥 Applications →</Link>
        <Link href="/admin/genre-icons">🖼️ Genre icons →</Link>
        <Link href="/admin/content-lifecycle">📅 Content lifecycle →</Link>
      </div>

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '820px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Admin Portal</div>
        <p className="library-sub" style={{ marginBottom: '1.2rem' }}>Review creator submissions and manage access.</p>

        {stats && (
          <div className="dash-stats">
            <div className="dash-stat"><div className="dash-stat-value">{stats.total}</div><div className="dash-stat-label">Total episodes</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.pendingCount}</div><div className="dash-stat-label">Pending</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.approvalRate === null ? '—' : `${stats.approvalRate}%`}</div><div className="dash-stat-label">Approval rate</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.avgTurnaroundHours === null ? '—' : `${stats.avgTurnaroundHours}h`}</div><div className="dash-stat-label">Avg. review time</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.creatorCount}</div><div className="dash-stat-label">Creator{stats.creatorCount === 1 ? '' : 's'}</div></div>
            <div className="dash-stat"><div className="dash-stat-value">{stats.totalViews}</div><div className="dash-stat-label">Total views</div></div>
          </div>
        )}

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Hero rotation</div>
          <h3>Homepage hero pool</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
            Every episode currently eligible for the homepage hero rotation. To add one, find it in the Library below and
            check &ldquo;eligible for the homepage hero rotation&rdquo; in its edit modal.
          </p>

          {libraryLoading ? (
            <p>Loading…</p>
          ) : library.filter((e) => e.featured).length === 0 ? (
            <p>Nothing in the rotation right now.</p>
          ) : (
            library.filter((e) => e.featured).map((e) => (
              <div key={e.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.7rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.2rem' }}>{e.title}</h4>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--ink-dim)' }}>
                    {e.status === 'approved' ? '✓ live' : e.status === 'pending' ? '⏳ pending' : '✕ rejected'}
                    {e.status !== 'approved' && ' · won\u2019t actually show in rotation until approved'}
                  </div>
                </div>
                <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => quickRemoveFromHero(e.id)}>
                  Remove from rotation
                </button>
              </div>
            ))
          )}
        </div>

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Site settings</div>
          <h3>Header &amp; links</h3>

          {!siteSettings ? (
            <p>Loading…</p>
          ) : (
            <>
              {siteSettingsError && <p style={{ color: 'var(--danger)' }}>{siteSettingsError}</p>}

              <div style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.6rem' }}>
                  <input
                    type="checkbox"
                    checked={siteSettings.shopEnabled}
                    onChange={(e) => setSiteSettings((s) => ({ ...s, shopEnabled: e.target.checked }))}
                  />
                  Show &ldquo;Shop&rdquo; link in the header (opens in a new tab)
                  {confirmedSiteSettings && confirmedSiteSettings.shopEnabled && confirmedSiteSettings.shopUrl && (
                    <span style={{ color: 'var(--brass)', fontSize: '0.72rem', fontWeight: 700 }}>✓ Connected</span>
                  )}
                </label>
                <input
                  type="url"
                  placeholder="https://shop.studiotapa.com"
                  value={siteSettings.shopUrl || ''}
                  onChange={(e) => setSiteSettings((s) => ({ ...s, shopUrl: e.target.value }))}
                  style={{ marginBottom: '0.4rem' }}
                />
                {confirmedSiteSettings && (siteSettings.shopUrl !== confirmedSiteSettings.shopUrl || siteSettings.shopEnabled !== confirmedSiteSettings.shopEnabled) && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--signal-amber)', marginBottom: '0.4rem' }}>
                    Unsaved changes — click Save below to apply.
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={siteSettings.liveTvEnabled}
                    onChange={(e) => setSiteSettings((s) => ({ ...s, liveTvEnabled: e.target.checked }))}
                  />
                  Show &ldquo;Live TV&rdquo; link in the header (the /channel looping playlist)
                </label>
              </div>

              <div style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
                <label style={{ display: 'block', marginBottom: '0.4rem' }}>
                  My Recs — closeness ({siteSettings.recommendationCloseness}/10)
                </label>
                <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.5rem' }}>
                  0 = wide exploration, mostly outside someone's usual pattern. 10 = closely matches their genre/artist
                  history. Applies to everyone's "My Recs" page.
                </p>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={siteSettings.recommendationCloseness}
                  onChange={(e) => setSiteSettings((s) => ({ ...s, recommendationCloseness: Number(e.target.value) }))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--ink-dim)' }}>
                  <span>Explore (0)</span>
                  <span>Close match (10)</span>
                </div>
              </div>

              <button
                className="account-btn-primary"
                style={{ width: 'auto', marginTop: '0.4rem' }}
                onClick={() => saveSiteSettings()}
                disabled={siteSettingsSaving}
              >
                {siteSettingsSaving ? 'Saving…' : 'Save'}
              </button>
              {siteSettingsSaved && <span style={{ marginLeft: '0.8rem', color: 'var(--brass)' }}>Saved.</span>}

              <div style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0 0', marginTop: '0.9rem' }}>
                <div style={{ marginBottom: '0.5rem' }}>Search icon</div>
                <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.6rem' }}>
                  Replace the default 🔍 emoji in the header with an uploaded image — same idea as genre icons.
                </p>
                {siteSettings.searchIconUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.6rem' }}>
                    <img src={siteSettings.searchIconUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                    <button
                      className="account-btn-secondary"
                      style={{ width: 'auto' }}
                      onClick={() => saveSiteSettings({ clearSearchIcon: true })}
                      disabled={siteSettingsSaving}
                    >
                      Reset to default
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files[0] && uploadSearchIcon(e.target.files[0])}
                  disabled={siteSettingsSaving}
                />
              </div>
            </>
          )}
        </div>

        <ManualEpisodeForm
          allSeries={allSeries}
          standaloneEpisodes={(library || []).filter((e) => ['movie', 'short'].includes(e.contentType))}
          onCreated={() => { loadSubmissions(); loadLibrary(librarySearch); loadStats(); }}
        />

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Pending review</div>
          <h3>Creator submissions</h3>

          {loading ? (
            <p>Loading…</p>
          ) : submissions.length === 0 ? (
            <p>Nothing waiting on review right now.</p>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="dash-nudge" style={{ borderColor: 'rgba(74,168,162,0.35)', background: 'rgba(74,168,162,0.08)' }}>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>{selectedIds.size} selected</span>
                    <button className="account-btn-primary" style={{ width: 'auto' }} disabled={bulkLoading} onClick={() => bulkReview('approve')}>
                      {bulkLoading ? 'Working…' : `✓ Approve ${selectedIds.size}`}
                    </button>
                    <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={bulkLoading} onClick={() => setBulkRejecting((v) => !v)}>
                      ✕ Reject {selectedIds.size}
                    </button>
                    <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={bulkLoading} onClick={() => setSelectedIds(new Set())}>
                      Clear selection
                    </button>
                  </div>
                  {bulkRejecting && (
                    <div style={{ marginTop: '0.6rem' }}>
                      <input
                        type="text"
                        placeholder="Reason (shown to every creator in this batch)"
                        value={bulkRejectionReason}
                        onChange={(e) => setBulkRejectionReason(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}
                      />
                      <button className="account-btn-secondary" style={{ width: 'auto' }} disabled={bulkLoading} onClick={() => bulkReview('reject')}>
                        Confirm rejection of {selectedIds.size}
                      </button>
                    </div>
                  )}
                  {bulkError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.5rem' }}>{bulkError}</p>}
                </div>
              )}

              {submissions.map((s) => (
                <div key={s.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '1rem 0' }}>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSelected(s.id)}
                      style={{ marginTop: '0.3rem' }}
                    />
                    <div style={{ flex: 1 }}>
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
                  </div>
                </div>
              ))}
            </>
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
          <div className="account-eyebrow">Pending artwork changes</div>
          <h3>Poster, thumbnail, and trailer changes awaiting approval</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
            These haven&rsquo;t gone live yet — approving replaces what&rsquo;s currently shown; denying discards the
            upload and keeps the current one.
          </p>

          {artworkError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{artworkError}</p>}

          {!pendingArtwork ? (
            <p>Loading…</p>
          ) : pendingArtwork.episodes.length === 0 && pendingArtwork.series.length === 0 ? (
            <p>Nothing pending right now.</p>
          ) : (
            <>
              {pendingArtwork.episodes.map((e) => (
                <div key={`episode-${e.id}`} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--signal-amber)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Episode</div>
                  <h4 style={{ margin: '0 0 0.3rem' }}>{e.title}</h4>
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                    {e.pendingPoster && 'New poster staged. '}
                    {e.pendingThumbnail && 'New thumbnail staged.'}
                  </p>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      className="account-btn-primary"
                      style={{ width: 'auto' }}
                      disabled={artworkActionLoading === `episode-${e.id}`}
                      onClick={() => resolveArtwork('episode', e.id, 'approve')}
                    >
                      {artworkActionLoading === `episode-${e.id}` ? 'Working…' : '✓ Approve'}
                    </button>
                    <button
                      className="account-btn-secondary"
                      style={{ width: 'auto' }}
                      disabled={artworkActionLoading === `episode-${e.id}`}
                      onClick={() => resolveArtwork('episode', e.id, 'deny')}
                    >
                      ✕ Deny
                    </button>
                  </div>
                </div>
              ))}

              {pendingArtwork.series.map((s) => (
                <div key={`series-${s.id}`} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--cipher-teal)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Series</div>
                  <h4 style={{ margin: '0 0 0.3rem' }}>{s.name}</h4>
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                    {s.pendingPoster && 'New poster staged. '}
                    {s.pendingThumbnail && 'New thumbnail staged. '}
                    {s.pendingTrailerSrc && 'New trailer staged.'}
                  </p>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      className="account-btn-primary"
                      style={{ width: 'auto' }}
                      disabled={artworkActionLoading === `series-${s.id}`}
                      onClick={() => resolveArtwork('series', s.id, 'approve')}
                    >
                      {artworkActionLoading === `series-${s.id}` ? 'Working…' : '✓ Approve'}
                    </button>
                    <button
                      className="account-btn-secondary"
                      style={{ width: 'auto' }}
                      disabled={artworkActionLoading === `series-${s.id}`}
                      onClick={() => resolveArtwork('series', s.id, 'deny')}
                    >
                      ✕ Deny
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Pending deletions</div>
          <h3>Episode and series removal requests</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
            These are already hidden from the site. Confirming here permanently deletes the row; denying restores it.
          </p>

          {deletionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{deletionError}</p>}

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
          <div className="account-eyebrow">Orphaned media</div>
          <h3>Files no longer referenced anywhere</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
            Left behind by confirmed deletions and by replacing a video, poster, or thumbnail — these still exist on
            Cloudflare or in Storage, just nothing in the app points at them anymore. Deleting here is permanent.
          </p>

          {orphanError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{orphanError}</p>}

          {!orphans ? (
            <p>Loading…</p>
          ) : orphans.length === 0 ? (
            <p>Nothing orphaned right now.</p>
          ) : (
            orphans.map((o) => (
              <div key={o.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.8rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: o.kind === 'cloudflare_video' ? 'var(--signal-amber)' : 'var(--cipher-teal)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                    {o.kind === 'cloudflare_video' ? 'Cloudflare video' : 'Storage image'}
                  </div>
                  <div style={{ fontSize: '0.9rem' }}>{o.context || '(no title on file)'}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>{o.reason}</div>
                </div>
                <button
                  className="account-btn-secondary"
                  style={{ width: 'auto' }}
                  disabled={orphanActionLoading === o.id}
                  onClick={() => cleanupOrphan(o.id)}
                >
                  {orphanActionLoading === o.id ? 'Deleting…' : '🗑 Delete now'}
                </button>
              </div>
            ))
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
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: c.role === 'admin' ? 'var(--brass)' : 'var(--signal-amber)' }}>
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

          <p style={{ marginTop: '1.2rem' }}>
            To grant or revoke access — including sub-admin roles and permission toggles —
            use <Link href="/admin/team">Team &amp; permissions →</Link>.
          </p>
        </div>

        <div className="account-card" style={{ maxWidth: 'none' }}>
          <div className="account-eyebrow">Audit log</div>
          <h3>Recent admin actions</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Read-only history — approvals, rejections, deletions, artwork decisions, cleanup, and access changes.</p>

          {!auditLog ? (
            <p>Loading…</p>
          ) : auditLog.length === 0 ? (
            <p>Nothing logged yet.</p>
          ) : (
            auditLog.map((entry) => (
              <div key={entry.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.6rem 0', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                {' — '}
                <strong>{entry.adminEmail || 'unknown admin'}</strong>
                {' '}
                {entry.action.replace(/_/g, ' ')}
                {entry.details ? ` — ${entry.details}` : ''}
              </div>
            ))
          )}
        </div>
      </main>
      <Footer />

      {editingEpisode && (
        <AdminEditEpisodeModal
          episode={editingEpisode}
          allSeries={allSeries}
          standaloneEpisodes={(library || []).filter((e) => ['movie', 'short'].includes(e.contentType) && e.id !== editingEpisode.id)}
          onClose={() => setEditingEpisode(null)}
          onSaved={() => {
            setEditingEpisode(null);
            loadLibrary(librarySearch);
            loadStats();
            loadSubmissions();
            loadOrphans();
          }}
        />
      )}
    </>
  );
}
