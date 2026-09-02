import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../../lib/accountContext';
import { getApprovedPitches } from '../../lib/pitches';
import { getSiteSettings } from '../../lib/siteSettings';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import PitchSwipeCard, { SwipeButtons } from '../../components/PitchSwipeCard';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  const account = await getAccountContext(req);
  const siteSettings = await getSiteSettings();
  const bypassingDisabled = !siteSettings.elevatorPitchEnabled && account.isAdmin;

  // Same gate as /pitches — this is the same feature area, just a
  // different way of browsing it, so it shouldn't need its own separate
  // admin toggle.
  if (!siteSettings.elevatorPitchEnabled && !account.isAdmin) {
    return { notFound: true };
  }

  // private, not public: this response embeds personalized account data
  // (email, admin/creator status via HeaderNav's props) — a public,
  // shared cache could serve one signed-in user's personalized page to a
  // completely different visitor within the cache window.
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

  const { userId } = getAuth(req);
  const [pitches, episodes] = await Promise.all([getApprovedPitches(), getPublicEpisodes()]);
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
      bypassingDisabled,
      requireSignIn: !userId
    }
  };
}

function shuffled(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function PitchDiscover({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, pitches, bypassingDisabled, requireSignIn }) {
  const [deck, setDeck] = useState(() => shuffled(pitches));
  const [secondChance, setSecondChance] = useState([]);
  const [round, setRound] = useState(1);
  const [likedPitches, setLikedPitches] = useState([]);
  const [finished, setFinished] = useState(pitches.length === 0);
  const [saveError, setSaveError] = useState(null);

  const current = deck[0];

  async function trySave(pitch) {
    try {
      const res = await fetch('/api/pitch-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId: pitch.id })
      });
      if (!res.ok) throw new Error();
    } catch {
      setSaveError(`"${pitch.title}" was liked, but couldn't be saved — it may not show up in your followed projects.`);
    }
  }

  function advance(direction) {
    const pitch = deck[0];
    const rest = deck.slice(1);
    // Computed locally rather than read back from state right after
    // setSecondChance — state updates aren't applied until the next
    // render, so reading secondChance.length here would still see the
    // value from before this swipe on the exact swipe that fills it,
    // and the round-2 transition below would incorrectly think it's
    // still empty.
    let nextSecondChance = secondChance;

    if (direction === 'right') {
      setLikedPitches((prev) => [...prev, pitch]);
      trySave(pitch);
    } else if (direction === 'down' && round === 1) {
      // A down-swipe only earns a second chance in round 1 — the replay
      // round is everyone's actual second chance, so a down-swipe there
      // means they've now seen it twice and passed both times.
      nextSecondChance = [...secondChance, pitch];
      setSecondChance(nextSecondChance);
    }
    // 'left' (not interested), and any round-2 'down', are dropped for
    // the rest of this session with no further tracking — there's
    // nothing to persist for a pass the way a like needs pitch_saves.

    if (rest.length > 0) {
      setDeck(rest);
    } else if (round === 1 && nextSecondChance.length > 0) {
      setDeck(shuffled(nextSecondChance));
      setSecondChance([]);
      setRound(2);
    } else {
      setFinished(true);
    }
  }

  return (
    <>
      <Head>
        <title>Discover — Pitch Room — {SITE.name}</title>
        <meta name="description" content={`Swipe through project ideas looking for backing on ${SITE.name}.`} />
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

      <main className="library-stage discover-stage">
        <Link href="/pitches" className="back-link">&larr; Back to Pitch Room</Link>
        <div className="library-heading">Discover</div>
        <div className="library-sub">
          Swipe right to like and follow a project, left if it's not for you, or down to skip it for
          now — anything you skip comes back around for a second look before you're done.
        </div>

        {saveError && <div className="admin-preview-banner" style={{ marginTop: '1rem' }}>{saveError}</div>}

        {requireSignIn && (
          <div className="poster-empty" style={{ marginTop: '1.4rem' }}>
            Sign in to like and follow projects — you can still browse without an account, but likes
            won&rsquo;t be saved anywhere.
          </div>
        )}

        <div className="swipe-deck-wrap">
          {finished || !current ? (
            <div className="swipe-summary">
              <h3>That&rsquo;s everything for now.</h3>
              {likedPitches.length > 0 ? (
                <>
                  <p>You liked {likedPitches.length} project{likedPitches.length === 1 ? '' : 's'}:</p>
                  <ul className="swipe-summary-list">
                    {likedPitches.map((p) => (
                      <li key={p.id}>
                        <Link href={`/pitches/${p.id}`}>{p.title}</Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>You didn&rsquo;t like anything this time through — that&rsquo;s alright, more ideas show up as creators submit them.</p>
              )}
              <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                <Link href="/pitches" className="account-btn-primary" style={{ width: 'auto', display: 'inline-block', textDecoration: 'none' }}>
                  Browse Pitch Room
                </Link>
                <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => window.location.reload()}>
                  Start over
                </button>
              </div>
            </div>
          ) : (
            <>
              {round === 2 && (
                <div className="swipe-round-tag">Second look — one more chance for the ones you skipped</div>
              )}
              <div className="swipe-card-stack">
                {/* A quiet second card peeking out from behind gives the
                    stack visual depth and previews that more are coming,
                    without it being interactive itself. */}
                {deck[1] && (
                  <div
                    className="swipe-card swipe-card-behind"
                    style={{ backgroundImage: deck[1].thumbnail ? `url(${deck[1].thumbnail})` : undefined }}
                  />
                )}
                <PitchSwipeCard key={current.id} pitch={current} onSwipe={advance} />
              </div>
              <SwipeButtons
                onDislike={() => advance('left')}
                onSkip={() => advance('down')}
                onLike={() => advance('right')}
              />
            </>
          )}
        </div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
