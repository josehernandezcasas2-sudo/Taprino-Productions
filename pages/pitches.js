import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../lib/accountContext';
import { HeartIcon, usePlayerIconOverrides } from '../components/PlayerIcons';
import { getApprovedPitches, getSavedPitchIds, PITCH_TAGS } from '../lib/pitches';
import { getSupabase } from '../lib/supabase';
import { getSiteSettings } from '../lib/siteSettings';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  const account = await getAccountContext(req);
  const siteSettings = await getSiteSettings();
  const bypassingDisabled = !siteSettings.elevatorPitchEnabled && account.isAdmin;

  if (!siteSettings.elevatorPitchEnabled && !account.isAdmin) {
    return { notFound: true };
  }

  // SECURITY: the admin bypass view must never be cacheable. If this got
  // the same public s-maxage as the normal page, a CDN could serve an
  // admin's "disabled page, viewing anyway" response to the very next
  // anonymous visitor within the cache window — exactly the audience this
  // toggle exists to hide the page from.
  res.setHeader(
    'Cache-Control',
    bypassingDisabled ? 'private, no-store' : 'public, s-maxage=60, stale-while-revalidate=300'
  );

  const { userId } = getAuth(req);
  const [pitches, episodes, savedIds] = await Promise.all([
    getApprovedPitches(),
    getPublicEpisodes(),
    userId ? getSavedPitchIds(userId) : []
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  // Save count per pitch, for the "Most saved" sort option — a separate,
  // lightweight query (just pitch_id) rather than pulling full save rows.
  const supabase = getSupabase();
  const { data: saveRows } = await supabase.from('pitch_saves').select('pitch_id');
  const saveCountsByPitchId = {};
  for (const row of saveRows || []) {
    saveCountsByPitchId[row.pitch_id] = (saveCountsByPitchId[row.pitch_id] || 0) + 1;
  }
  const pitchesWithSaveCounts = pitches.map((p) => ({ ...p, savedCount: saveCountsByPitchId[p.id] || 0 }));

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      pitches: pitchesWithSaveCounts,
      savedIds,
      bypassingDisabled
    }
  };
}

export default function PitchRoom({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, pitches, savedIds, bypassingDisabled }) {
  const iconOverrides = usePlayerIconOverrides();
  const [saved, setSaved] = useState(new Set(savedIds));
  const [activeTag, setActiveTag] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'closest' | 'saved'

  async function toggleSave(pitchId) {
    if (!isSignedIn) return;
    setSaved((prev) => {
      const next = new Set(prev);
      next.has(pitchId) ? next.delete(pitchId) : next.add(pitchId);
      return next;
    });
    await fetch('/api/pitch-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pitchId })
    }).catch(() => {});
  }

  function fundingPct(p) {
    if (!p.funding_goal) return null;
    return Math.min(100, Math.round(((p.funding_raised || 0) / p.funding_goal) * 100));
  }

  const q = searchQuery.trim().toLowerCase();
  const visiblePitches = pitches
    .filter((p) => activeTag === 'All' || p.tag === activeTag)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.creator_name || '').toLowerCase().includes(q))
    .sort((a, b) => {
      if (sortBy === 'saved') return (b.savedCount || 0) - (a.savedCount || 0);
      if (sortBy === 'closest') {
        // Pitches with no funding goal at all aren't "close to" anything —
        // sort them after every pitch that actually has a goal, rather
        // than letting a null goal accidentally sort as if it were 0% or
        // land ahead of real, nearly-funded projects by chance.
        const pctA = fundingPct(a);
        const pctB = fundingPct(b);
        if (pctA === null && pctB === null) return 0;
        if (pctA === null) return 1;
        if (pctB === null) return -1;
        return pctB - pctA;
      }
      return 0; // 'newest' — already the server's own order, nothing to re-sort
    });
  const usedTags = ['All', ...PITCH_TAGS.filter((t) => pitches.some((p) => p.tag === t))];

  return (
    <>
      <Head>
        <title>Pitch Room — {SITE.name}</title>
        <meta name="description" content={`Projects looking for backing on ${SITE.name}.`} />
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
      {bypassingDisabled && (
        <div className="admin-preview-banner">
          ⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.
          <Link href="/admin">Go turn it back on</Link>
        </div>
      )}

      <main className="library-stage">
        <Link href="/" className="back-link">&larr; Back to screening room</Link>
        <div className="library-heading">Pitch Room</div>
        <div className="library-sub">
          Projects looking for backing. Studio Tapa doesn&rsquo;t handle any of this funding directly —
          each project links straight to the creator&rsquo;s own page. Save one to follow along and get
          notified when they post an update.
        </div>

        {isCreator && (
          <div style={{ margin: '1rem 0 1.6rem' }}>
            <Link href="/creator/pitch/new" className="account-btn-primary" style={{ display: 'inline-block', width: 'auto', textDecoration: 'none' }}>
              Submit your project
            </Link>
            <Link href="/creator/pitch/dashboard" className="account-btn-secondary" style={{ display: 'inline-block', width: 'auto', textDecoration: 'none', marginLeft: '0.7rem' }}>
              Your pitches
            </Link>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title or creator…"
            className="pitch-search-input"
            style={{ flex: '1 1 220px' }}
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="pitch-sort-select"
          >
            <option value="newest">Newest</option>
            <option value="closest">Closest to goal</option>
            <option value="saved">Most saved</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.4rem' }}>
          {usedTags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(t)}
              className="account-btn-secondary"
              style={{
                width: 'auto',
                padding: '0.35rem 0.85rem',
                fontSize: '0.78rem',
                background: activeTag === t ? 'var(--brass)' : undefined,
                color: activeTag === t ? '#241a05' : undefined
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {visiblePitches.length === 0 ? (
          <div className="poster-empty">
            {pitches.length === 0
              ? 'Nothing here yet — check back soon.'
              : 'No projects match your search or filter.'}
          </div>
        ) : (
          <div className="pitch-grid">
            {visiblePitches.map((p) => {
              const pct = fundingPct(p);
              return (
                <Link key={p.id} href={`/pitches/${p.id}`} className="pitch-card">
                  <div className="pitch-thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : {}}>
                    {p.tag && <span className="pitch-tag">{p.tag}</span>}
                    <button
                      className="pitch-save"
                      onClick={(e) => { e.preventDefault(); toggleSave(p.id); }}
                    >
                      <HeartIcon size={16} active={saved.has(p.id)} src={saved.has(p.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} />
                    </button>
                  </div>
                  <div className="pitch-info">
                    <h4>{p.title}</h4>
                    {p.creator_name && <div className="creator">{p.creator_name}</div>}
                    {pct !== null && (
                      <>
                        <div className="pitch-progress-track"><div className="pitch-progress-fill" style={{ width: `${pct}%` }} /></div>
                        <div className="pitch-progress-label">
                          ${Number(p.funding_raised || 0).toLocaleString()} of ${Number(p.funding_goal).toLocaleString()} goal
                        </div>
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
