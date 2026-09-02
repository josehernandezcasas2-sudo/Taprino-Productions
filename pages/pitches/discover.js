import { useEffect, useState } from 'react';
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
import { readLocalProgress, saveLocalProgress, clearLocalProgress, reconstructFromIds } from '../../lib/swipeProgressStorage';

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
  // Starts empty/loading rather than synchronously shuffling — whether to
  // resume a saved deck or start fresh can't be known until the mount
  // effect below checks (an API call for signed-in users, localStorage
  // for everyone else), and neither of those exists during server
  // rendering, so the very first client render has to match the server's
  // and stay neutral until then.
  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState([]);
  const [secondChance, setSecondChance] = useState([]);
  const [round, setRound] = useState(1);
  const [likedPitches, setLikedPitches] = useState([]);
  const [finished, setFinished] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const current = deck[0];

  // Restore progress on mount, or start a fresh shuffled deck if there's
  // nothing to restore.
  useEffect(() => {
    let cancelled = false;

    async function loadProgress() {
      let saved = null;
      if (isSignedIn) {
        try {
          const res = await fetch('/api/pitch-swipe-progress');
          if (res.ok) {
            const data = await res.json();
            saved = data.progress;
          }
        } catch {
          // Falls through to a fresh deck below — a failed load shouldn't
          // block using the page, just means resuming isn't possible
          // this time.
        }
      } else {
        saved = readLocalProgress();
      }

      if (cancelled) return;

      const hasSavedContent = saved && ((saved.deckIds && saved.deckIds.length) || (saved.secondChanceIds && saved.secondChanceIds.length));
      if (hasSavedContent) {
        const restored = reconstructFromIds(pitches, saved);
        if (restored.deck.length > 0) {
          setDeck(restored.deck);
          setSecondChance(restored.secondChance);
          setRound(restored.round);
          setLikedPitches(restored.likedPitches);
          setFinished(false);
        } else if (restored.round === 1 && restored.secondChance.length > 0) {
          // The saved deck came back empty — most likely every pitch in
          // it has since been deleted or unapproved — but the
          // second-chance queue still has valid ones. Move straight into
          // round 2 rather than marking this finished and quietly
          // losing pitches the user hadn't actually gotten a second look
          // at yet.
          setDeck(shuffled(restored.secondChance));
          setSecondChance([]);
          setRound(2);
          setLikedPitches(restored.likedPitches);
          setFinished(false);
        } else {
          setLikedPitches(restored.likedPitches);
          setFinished(true);
        }
      } else {
        setDeck(shuffled(pitches));
        setFinished(pitches.length === 0);
      }
      setLoading(false);
    }

    loadProgress();
    return () => { cancelled = true; };
    // Deliberately once-on-mount — isSignedIn/pitches are stable for the
    // life of this page (a real change means a fresh navigation, which
    // remounts the component anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep progress up to date as the user swipes, in whichever store fits
  // their sign-in state. Skipped entirely until the initial load above
  // has finished — otherwise this would immediately overwrite whatever
  // was just restored with the still-empty pre-load state.
  useEffect(() => {
    if (loading) return;
    if (finished) {
      if (isSignedIn) {
        fetch('/api/pitch-swipe-progress', { method: 'DELETE' }).catch(() => {});
      } else {
        clearLocalProgress();
      }
      return;
    }
    const progress = {
      deckIds: deck.map((p) => p.id),
      secondChanceIds: secondChance.map((p) => p.id),
      round,
      likedIds: likedPitches.map((p) => p.id)
    };
    if (isSignedIn) {
      fetch('/api/pitch-swipe-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(progress)
      }).catch(() => {
        // A failed save here isn't worth interrupting the swiping
        // experience over — worst case, resuming later starts fresh
        // instead, same as if nothing had ever been saved.
      });
    } else {
      saveLocalProgress(progress);
    }
  }, [deck, secondChance, round, likedPitches, finished, loading, isSignedIn]);

  async function startOver() {
    if (isSignedIn) {
      await fetch('/api/pitch-swipe-progress', { method: 'DELETE' }).catch(() => {});
    } else {
      clearLocalProgress();
    }
    window.location.reload();
  }

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
          {loading ? (
            <div className="poster-empty">Loading your deck…</div>
          ) : finished || !current ? (
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
                <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={startOver}>
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
