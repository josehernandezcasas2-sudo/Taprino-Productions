import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getAllSeriesForCreator } from '../../lib/series';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getSupabase } from '../../lib/supabase';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import SeriesMediaForm from '../../components/SeriesMediaForm';
import CreatorSubmissionForm from '../../components/CreatorSubmissionForm';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import { SITE } from '../../lib/siteConfig';
import Footer from '../../components/Footer';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeriesForCreator(), getPublicEpisodes()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  // Episode counts per series — a lightweight, separate query (id +
  // series_id only) rather than pulling full episode rows, and counting
  // every episode regardless of review status. A creator managing their
  // shows wants the real count, including anything still pending review,
  // not just what's already live.
  const supabase = getSupabase();
  const { data: episodeRows } = await supabase.from('episodes').select('series_id').not('series_id', 'is', null);
  const countsBySeriesId = {};
  for (const row of episodeRows || []) {
    countsBySeriesId[row.series_id] = (countsBySeriesId[row.series_id] || 0) + 1;
  }
  const allSeriesWithCounts = allSeries.map((s) => ({ ...s, episodeCount: countsBySeriesId[s.id] || 0 }));

  return {
    props: {
      allSeries: allSeriesWithCounts,
      mainGenres,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

function ArtPills({ s }) {
  const items = [
    ['Poster', s.poster], ['Thumb', s.thumbnail], ['Hero', s.heroImage], ['Trailer', s.trailerSrc]
  ];
  return (
    <div className="series-mgmt-pills">
      {items.map(([label, has]) => (
        <span key={label} className={has ? 'on' : 'off'}>{label} {has ? '✓' : '—'}</span>
      ))}
    </div>
  );
}

// Name/description edits go through admin approval (see
// pages/api/creator/request-series-edit.js — writes to pending_name /
// pending_description, not the live columns), so this can't show the
// change as applied immediately the way the artwork form's own "Saved."
// message can. It has to say "requested," not "saved."
function NameDescPanel({ series, onRequested }) {
  const [name, setName] = useState(series.name);
  const [description, setDescription] = useState(series.desc || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/creator/request-series-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId: series.id, name, description })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit that request.');
      setDone(true);
      onRequested();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: '1.2rem' }}>
      <label>Series name</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      <label>Description</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ width: '100%', boxSizing: 'border-box' }} />
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}
      {done && <p style={{ color: 'var(--signal-amber)', fontSize: '0.8rem' }}>Requested — an admin needs to approve this before it goes live.</p>}
      <button className="account-btn-secondary" type="submit" disabled={saving} style={{ width: 'auto' }}>
        {saving ? 'Requesting…' : 'Request name/description change'}
      </button>
    </form>
  );
}

export default function SeriesManagement({ allSeries, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [seriesList, setSeriesList] = useState(allSeries);
  const [deletingSeries, setDeletingSeries] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  // { seriesId, panel: 'add' | 'edit' } | null — only one panel open across
  // the whole page at a time, matching how the mockup behaved.
  const [expanded, setExpanded] = useState(null);

  function togglePanel(seriesId, panel) {
    setExpanded((cur) => (cur && cur.seriesId === seriesId && cur.panel === panel) ? null : { seriesId, panel });
  }

  async function refreshSeriesList() {
    try {
      const res = await fetch('/api/creator/list-series');
      const data = await res.json();
      if (res.ok) {
        // list-series doesn't know about episodeCount (that's computed
        // only in this page's getServerSideProps) — carry the existing
        // counts forward rather than losing them on every refresh.
        setSeriesList((prev) => {
          const countsById = Object.fromEntries(prev.map((s) => [s.id, s.episodeCount]));
          return data.series.map((s) => ({ ...s, episodeCount: countsById[s.id] || 0 }));
        });
      }
    } catch (err) {
      // Leave the list as-is on a failed refresh.
    }
  }

  async function requestDeletion(reason) {
    const res = await fetch('/api/creator/request-series-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId: deletingSeries.id, action: 'request', reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit the request.');
    setDeletingSeries(null);
    refreshSeriesList();
  }

  async function cancelDeletion(seriesId) {
    setActionError(null);
    try {
      const res = await fetch('/api/creator/request-series-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId, action: 'cancel' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel the request.');
      refreshSeriesList();
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <>
      <Head>
        <title>Series — {SITE.name}</title>
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

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Series management</div>
        <p className="library-sub" style={{ marginBottom: '1.2rem' }}>
          Create a series, add episodes to it, and manage its artwork and details — all from this page.
          For standalone shorts and movies (not part of a series), use <Link href="/creator" style={{ color: 'var(--signal-amber)' }}>Creator Studio</Link> instead.
        </p>

        <button
          className="account-btn-primary"
          onClick={() => setShowCreateForm((v) => !v)}
          style={{ marginBottom: showCreateForm ? '0' : '1.5rem' }}
        >
          {showCreateForm ? '− Close' : '+ Create new series'}
        </button>

        {showCreateForm && (
          <SeriesMediaForm
            key="create"
            allSeries={seriesList}
            initialMode="new"
            onSaved={() => { setShowCreateForm(false); refreshSeriesList(); }}
          />
        )}

        <div style={{ marginTop: showCreateForm ? '1.5rem' : 0 }}>
          <div className="account-eyebrow" style={{ marginBottom: '0.8rem' }}>Your series</div>

          {actionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{actionError}</p>}
          {seriesList.length === 0 && <p style={{ color: 'var(--ink-dim)' }}>No series yet — create one above.</p>}

          {seriesList.map((s) => {
            const addOpen = expanded && expanded.seriesId === s.id && expanded.panel === 'add';
            const editOpen = expanded && expanded.seriesId === s.id && expanded.panel === 'edit';
            const posterUrl = s.poster || s.thumbnail;
            return (
              <div key={s.id} className="account-card" style={{ marginBottom: '1rem' }}>
                <div className="series-mgmt-header">
                  <div
                    className="series-mgmt-poster"
                    style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : {}}
                  >
                    {!posterUrl && 'no art'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: '0 0 0.15rem' }}>{s.name}</h3>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                      {s.episodeCount} episode{s.episodeCount === 1 ? '' : 's'}
                    </p>
                    <ArtPills s={s} />

                    {(s.pendingPoster || s.pendingThumbnail || s.pendingHeroImage || s.pendingTrailerSrc) && (
                      <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: 'var(--signal-amber)' }}>
                        ⏳ Artwork change awaiting admin approval.
                      </p>
                    )}
                    {(s.pendingName || s.pendingDescription) && (
                      <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: 'var(--signal-amber)' }}>
                        ⏳ Name/description change awaiting admin approval.
                      </p>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        className={addOpen ? 'account-btn-secondary' : 'account-btn-primary'}
                        style={{ width: 'auto' }}
                        onClick={() => togglePanel(s.id, 'add')}
                      >
                        {addOpen ? '− Close' : '+ Add episode'}
                      </button>
                      <button
                        className="account-btn-secondary"
                        style={{ width: 'auto' }}
                        onClick={() => togglePanel(s.id, 'edit')}
                      >
                        {editOpen ? '− Close' : 'Edit details'}
                      </button>
                    </div>
                  </div>
                </div>

                {addOpen && (
                  <div className="series-mgmt-panel add">
                    <div className="account-eyebrow" style={{ marginBottom: '0.6rem' }}>
                      New episode for {s.name}
                    </div>
                    <CreatorSubmissionForm
                      allSeries={seriesList}
                      initialContentType="series"
                      initialSeriesId={s.id}
                      onSubmitted={() => { setExpanded(null); refreshSeriesList(); }}
                    />
                  </div>
                )}

                {editOpen && (
                  <div className="series-mgmt-panel edit">
                    <div className="account-eyebrow" style={{ marginBottom: '0.6rem' }}>
                      Edit {s.name}
                    </div>
                    <NameDescPanel series={s} onRequested={refreshSeriesList} />
                    <SeriesMediaForm
                      key={`edit-${s.id}`}
                      allSeries={seriesList}
                      lockedSeriesId={s.id}
                      compact
                      onSaved={() => refreshSeriesList()}
                    />
                  </div>
                )}

                <div style={{ marginTop: '0.9rem', paddingTop: '0.7rem', borderTop: '1px solid rgba(234,231,221,0.08)' }}>
                  {s.deletionRequested ? (
                    <>
                      <p style={{ fontSize: '0.8rem', color: 'var(--signal-amber)', margin: '0 0 0.4rem' }}>
                        Pending deletion — reason: {s.deletionReason}
                      </p>
                      <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => cancelDeletion(s.id)}>
                        Cancel deletion request
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeletingSeries(s)}
                      style={{ background: 'none', border: 'none', color: '#8a6a5a', fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    >
                      Request deletion
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
      <Footer />

      {deletingSeries && (
        <DeleteRequestModal
          itemLabel={deletingSeries.name}
          onClose={() => setDeletingSeries(null)}
          onConfirm={requestDeletion}
        />
      )}
    </>
  );
}
