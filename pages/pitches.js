import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { HeartIcon, SwipeDeckIcon, BackItIcon, SearchIcon, usePlayerIconOverrides } from '../components/PlayerIcons';
import { stayHereProps } from '../lib/resumeTaskRules';
import { PITCH_TAGS } from '../lib/pitchRules';
import { getPitchRoomData } from '../lib/pitchRoom';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';
import { cssUrl } from '../lib/cssUrl';

export async function getServerSideProps({ req, res }) {
  const data = await getPitchRoomData(req);
  if (data.disabled) return { notFound: true };
  const { account } = data;

  // SECURITY: this response embeds personalized account data (email,
  // admin/creator status) for any signed-in user, not just during the
  // admin bypass — a public, shared cache could serve one signed-in
  // user's personalized page to a completely different visitor within
  // the cache window. Only genuinely anonymous visitors, who have
  // nothing personal in the response, get the cached public path.
  // (bypassingDisabled implies isSignedIn — you can't be an admin
  // without being signed in — so this one check safely covers both.)
  res.setHeader(
    'Cache-Control',
    account.isSignedIn ? 'private, no-cache, no-store, must-revalidate' : 'public, s-maxage=60, stale-while-revalidate=300'
  );

  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      pitches: data.pitches,
      savedIds: data.savedIds,
      bypassingDisabled: data.bypassingDisabled
    }
  };
}

export default function PitchRoom({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, pitches, savedIds, bypassingDisabled }) {
  const iconOverrides = usePlayerIconOverrides();
  const router = useRouter();
  const { openSignIn } = useClerk();
  const [saved, setSaved] = useState(new Set(savedIds));
  const [activeTag, setActiveTag] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'closest' | 'saved'

  async function toggleSave(pitchId) {
    // Signed out, the heart asks them to sign in and keeps them on this
    // page, as the app's alert does.
    if (!isSignedIn) { openSignIn(stayHereProps(router.asPath)); return; }
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

  const q = searchQuery.trim().toLowerCase();
  const visiblePitches = pitches
    .filter((p) => activeTag === 'All' || p.tag === activeTag)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.creatorDisplayName || '').toLowerCase().includes(q))
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
      {bypassingDisabled && (
        <div className="admin-preview-banner">
          ⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.
          <Link href="/admin">Go turn it back on</Link>
        </div>
      )}

      {/* The app's Pitch Room screen (mobile/src/app/pitches/index.js),
          kept short so the projects come up on the first screen
          (2026-11-17): one title row with Swipe ideas and, for a creator,
          the + to pitch; the search (it says how many there are); one row
          of chips with the sort and the kinds; then the cards. */}
      <main className="library-stage prm">
        <div className="prm-top">
          <h1 className="prm-title">Pitch Room</h1>
          <div className="prm-top-actions">
            <Link href="/pitches/discover" className="prm-swipe" aria-label="Swipe through ideas">
              <SwipeDeckIcon size={18} src={iconOverrides.pitch_swipe} />
              <span>Swipe ideas</span>
            </Link>
            {isCreator && (
              <Link href="/creator/pitch/new" className="prm-add" aria-label="Submit your project" title="Submit your project">+</Link>
            )}
          </div>
        </div>

        <div className="prm-tools">
          <label className="prm-search">
            <SearchIcon size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder(pitches.length)}
              aria-label="Search by title or creator"
              autoComplete="off"
            />
            {searchQuery && (
              <button type="button" className="prm-clear" onClick={() => setSearchQuery('')} aria-label="Clear the search">✕</button>
            )}
          </label>
          <div className="prm-chips">
            {/* The sort is a pill; the page's own <select> lies over it,
                so the phone's own picker opens and a tap never zooms. */}
            <span className="prm-sort">
              <span aria-hidden="true">{SORTS.find((s) => s.key === sortBy).label}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort the projects">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </span>
            {usedTags.length > 2 && (
              <>
                <span className="prm-chip-rule" aria-hidden="true" />
                <span className="prm-tags" role="group" aria-label="Show one kind of project">
                  {usedTags.map((t) => (
                    <button key={t} type="button" className="prm-tag-pill" aria-pressed={activeTag === t} onClick={() => setActiveTag(t)}>
                      {t}
                    </button>
                  ))}
                </span>
              </>
            )}
          </div>
        </div>


        {visiblePitches.length === 0 ? (
          <div className="prm-empty">
            {pitches.length === 0
              ? 'Nothing here yet — check back soon.'
              : 'No projects match your search or filter.'}
          </div>
        ) : (
          <div className="prm-grid">
            {visiblePitches.map((p) => {
              const pct = fundingPct(p);
              const remaining = daysLeft(p);
              const isSaved = saved.has(p.id);
              return (
                <Link key={p.id} href={`/pitches/${p.id}`} className="prm-card">
                  <div className={`prm-art${p.thumbnail ? '' : ' bare'}`} style={p.thumbnail ? { backgroundImage: cssUrl(p.thumbnail) } : {}}>
                    {/* No art uploaded yet: a quiet gradient with the
                        title's initial rather than an empty box. */}
                    {!p.thumbnail && <span className="prm-initial" aria-hidden="true">{(p.title || '?')[0].toUpperCase()}</span>}
                    <span className="prm-scrim" aria-hidden="true" />
                    {p.tag && <span className="prm-card-tag">{p.tag}</span>}
                    <button
                      type="button"
                      className={`prm-save${isSaved ? ' on' : ''}`}
                      aria-pressed={isSaved}
                      aria-label={isSaved ? `Stop following ${p.title}` : `Save ${p.title} to follow along`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSave(p.id); }}
                    >
                      <HeartIcon size={14} active={isSaved} src={isSaved ? iconOverrides.heart_active : iconOverrides.heart_inactive} />
                    </button>
                    {remaining !== null && (
                      <span className="prm-deadline">{remaining === 1 ? 'Last day' : `${remaining} days left`}</span>
                    )}
                  </div>
                  <div className="prm-body">
                    <h2 className="prm-card-title">{p.title}</h2>
                    {p.creatorDisplayName && (
                      <div className="prm-by">
                        by{' '}
                        {p.created_by ? (
                          // A real <Link> here would nest an <a> inside the
                          // card's own <Link> (invalid HTML — browsers
                          // un-nest it, which can visibly relocate it out of
                          // the card). A keyboard-operable span with the
                          // same click-through-to-navigate behavior instead.
                          <span
                            className="prm-by-link"
                            role="link"
                            tabIndex={0}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/profile/${p.created_by}`); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault(); e.stopPropagation();
                                router.push(`/profile/${p.created_by}`);
                              }
                            }}
                          >
                            {p.creatorDisplayName}
                          </span>
                        ) : p.creatorDisplayName}
                      </div>
                    )}
                    {p.logline && <p className="prm-logline">{p.logline}</p>}
                    {pct !== null && (
                      <div className="prm-funding">
                        <div className="prm-track"><div className="prm-fill" style={{ width: `${Math.max(pct, 2)}%` }} /></div>
                        <div className="prm-funding-row">
                          <span className="prm-raised">
                            {money(raisedDollars(p), p.funding_enabled)}
                            <span className="prm-goal"> of {money(p.funding_goal)}</span>
                          </span>
                          <span className="prm-pct">{pct}%</span>
                        </div>
                      </div>
                    )}
                    {(p.savedCount > 0 || p.funding_enabled) && (
                      <div className="prm-foot">
                        {p.savedCount > 0 ? (
                          <span className="prm-following">♥ {p.savedCount} {p.savedCount === 1 ? 'person' : 'people'} following</span>
                        ) : <span />}
                        {p.funding_enabled && <span className="prm-back-it"><BackItIcon size={12} src={iconOverrides.back_it} /> Back it</span>}
                      </div>
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

const SORTS = [
  { key: 'newest', label: 'Newest' },
  { key: 'closest', label: 'Closest to goal' },
  { key: 'saved', label: 'Most saved' }
];

// Same rules as the app's screen: live donation totals for in-platform
// funding, the self-reported number otherwise; null when there's no goal.
function raisedDollars(p) {
  return p.funding_enabled ? (p.liveRaisedCents || 0) / 100 : Number(p.funding_raised || 0);
}

function fundingPct(p) {
  if (!p.funding_goal) return null;
  return Math.min(100, Math.round((raisedDollars(p) / p.funding_goal) * 100));
}

// The search box says how many projects there are, so no separate count
// line is needed (the app's screen says the same).
function searchPlaceholder(n) {
  return n > 0 ? `Search ${n} ${n === 1 ? 'project' : 'projects'}…` : 'Search by title or creator…';
}

function money(n, cents) {
  return `$${Number(n).toLocaleString('en-US', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
}

// Whole calendar days until the deadline date, comparing dates only
// (not time-of-day) so "the deadline is tomorrow" reads as 1 day left,
// not 2. A deadline of today floors to 1 rather than 0, so it reads as
// "last day" instead of looking already-expired. Returns null once the
// deadline has passed rather than a negative number — this is
// self-reported, informal metadata, not an authoritative cutoff, so
// it's treated the same as "no deadline set" instead of implying the
// project is definitively over.
function daysLeft(p) {
  if (!p.funding_deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(p.funding_deadline + 'T00:00:00');
  const diffDays = Math.round((deadline - today) / 86400000);
  return diffDays < 0 ? null : Math.max(1, diffDays);
}
