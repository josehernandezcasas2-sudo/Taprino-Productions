import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../lib/accountContext';
import { getApprovedPitches, getSavedPitchIds, PITCH_TAGS } from '../lib/pitches';
import { getSiteSettings } from '../lib/siteSettings';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  const siteSettings = await getSiteSettings();
  if (!siteSettings.elevatorPitchEnabled) {
    return { notFound: true };
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const account = await getAccountContext(req);
  const { userId } = getAuth(req);
  const [pitches, episodes, savedIds] = await Promise.all([
    getApprovedPitches(),
    getPublicEpisodes(),
    userId ? getSavedPitchIds(userId) : []
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      pitches,
      savedIds
    }
  };
}

export default function PitchRoom({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, pitches, savedIds }) {
  const [saved, setSaved] = useState(new Set(savedIds));
  const [activeTag, setActiveTag] = useState('All');

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

  const visiblePitches = activeTag === 'All' ? pitches : pitches.filter((p) => p.tag === activeTag);
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
          <div className="poster-empty">Nothing here yet — check back soon.</div>
        ) : (
          <div className="pitch-grid">
            {visiblePitches.map((p) => {
              const pct = p.funding_goal ? Math.min(100, Math.round(((p.funding_raised || 0) / p.funding_goal) * 100)) : null;
              return (
                <Link key={p.id} href={`/pitches/${p.id}`} className="pitch-card">
                  <div className="pitch-thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : {}}>
                    {p.tag && <span className="pitch-tag">{p.tag}</span>}
                    <button
                      className="pitch-save"
                      onClick={(e) => { e.preventDefault(); toggleSave(p.id); }}
                    >
                      {saved.has(p.id) ? '♥' : '♡'}
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
