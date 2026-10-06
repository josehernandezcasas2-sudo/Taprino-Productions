import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useSmartBack } from '../../components/BackButton';
import {
  ArrowDownIcon, ArrowUpIcon, BookmarkIcon, CheckIcon, CloseIcon, DoorHoldIcon, HeartIcon, ShareIcon, usePlayerIconOverrides
} from '../../components/PlayerIcons';
import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../../lib/accountContext';
import { getApprovedPitches, getLikedPitchIds, getPitchLikeCounts, getSavedPitchIds } from '../../lib/pitches';
import { getSiteSettings } from '../../lib/siteSettings';
import MobileTabBar from '../../components/MobileTabBar';
import { ElevatorButton, ElevatorCab, ElevatorCard, FloorIndicator, motionTimings } from '../../components/PitchElevator';
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
  // (whether this viewer is bypassing a disabled Pitch Room as an admin,
  // which pitches they've saved and liked) — a public, shared cache could
  // serve one signed-in user's personalized page to a completely
  // different visitor within the cache window.
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

  const { userId } = getAuth(req);
  const [pitches, savedIds, likedIds, likeCounts] = await Promise.all([
    getApprovedPitches(),
    userId ? getSavedPitchIds(userId) : [],
    userId ? getLikedPitchIds(userId) : [],
    getPitchLikeCounts()
  ]);

  return {
    props: {
      isSignedIn: account.isSignedIn,
      pitches,
      bypassingDisabled,
      requireSignIn: !userId,
      savedIds,
      likedIds,
      likeCounts
    }
  };
}

function shuffled(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Every pitch is a floor. The left plate moves the car (Next/Back/Hold),
// the right plate reacts to the pitch on this floor (Save/Share/Like).
// Unlike the old swipe deck, the whole ordered deck is kept and you ride
// up and down it by index, so a pitch you just passed is one floor down
// rather than gone for the session. Hold is the old "skip for a second
// look": held pitches come back as a second ride once you reach the top.
export default function PitchDiscover({ isSignedIn, pitches, bypassingDisabled, requireSignIn, savedIds: initialSavedIds, likedIds: initialLikedIds, likeCounts: initialLikeCounts }) {
  // Full-screen takeover, same idea as /vertical/discover — no HeaderNav
  // (this smart-back close button replaces it), just the tab bar staying
  // put at the bottom. goBack matches the header/nav pill's own "true
  // back if you navigated here in-site, otherwise /pitches" behavior.
  const goBack = useSmartBack('/pitches');
  const iconOverrides = usePlayerIconOverrides();

  // Starts empty/loading rather than synchronously shuffling — whether to
  // resume a saved ride or start fresh can't be known until the mount
  // effect below checks (an API call for signed-in users, localStorage
  // for everyone else), and neither of those exists during server
  // rendering, so the very first client render has to match the server's
  // and stay neutral until then.
  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState([]);
  const [floor, setFloor] = useState(0);
  const [round, setRound] = useState(1);
  const [held, setHeld] = useState([]);
  // Likes made during this ride, in order — what the lobby summary lists
  // and what gets persisted with the ride's progress (for signed-out
  // visitors it's the only record a like leaves at all).
  const [rideLiked, setRideLiked] = useState([]);
  const [likedIds, setLikedIds] = useState(() => new Set(initialLikedIds));
  const [savedIds, setSavedIds] = useState(() => new Set(initialSavedIds));
  const [likeCounts, setLikeCounts] = useState(initialLikeCounts || {});
  const [finished, setFinished] = useState(false);

  // The car itself: doors, which nav lamp is lit, which way the indicator
  // arrow points, and whether a ride is mid-flight (every button on the
  // left plate is ignored until the doors have reopened).
  const [doorsClosed, setDoorsClosed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [direction, setDirection] = useState(null);
  const [litNav, setLitNav] = useState(null);
  const [flipped, setFlipped] = useState(false);

  const [toast, setToast] = useState(null);
  const [shareCopiedId, setShareCopiedId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const bannersRef = useRef(null);
  const timersRef = useRef([]);
  const toastTimerRef = useRef(null);

  const current = deck[floor];
  const currentHeld = Boolean(current) && held.some((p) => p.id === current.id);

  // .pitch-discover-banners floats over the stage rather than sitting in
  // the centered flex column (see its own CSS comment) so the car stays
  // centered on the viewport regardless of whether a banner is showing —
  // but a fixed top offset for that banner can't know how tall its own
  // text will actually wrap to at a given width (three lines on a narrow
  // phone vs. one on desktop), so a sufficiently long banner on a
  // sufficiently narrow screen could still overlap a big enough car.
  // Measuring the banner's real height and feeding it back in as
  // --pitch-banner-clearance (consumed by .swipe-deck-wrap) means the
  // stage only ever gives up exactly as much room as this specific
  // banner, on this specific screen, actually needs — same pattern
  // MobileTabBar.js already uses for --vv-bottom-gap. ResizeObserver
  // (not just a window resize listener) also catches the banner's own
  // height changing from text reflow alone, e.g. a saveError banner
  // appearing/changing without any viewport resize at all.
  useEffect(() => {
    const el = bannersRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.contentRect.height;
      const clearance = height > 0 ? height + 24 : 0;
      document.documentElement.style.setProperty('--pitch-banner-clearance', `${clearance}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty('--pitch-banner-clearance', '0px');
    };
  }, [bypassingDisabled, saveError, requireSignIn]);

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
          setFloor(restored.floorIndex);
          setHeld(restored.secondChance);
          setRound(restored.round);
          setRideLiked(restored.likedPitches);
          setFinished(false);
        } else if (restored.round === 1 && restored.secondChance.length > 0) {
          // The saved deck came back empty — most likely every pitch in
          // it has since been deleted or unapproved — but the held queue
          // still has valid ones. Move straight into the second-look
          // ride rather than marking this finished and quietly losing
          // pitches the user hadn't actually gotten a second look at yet.
          setDeck(shuffled(restored.secondChance));
          setFloor(0);
          setHeld([]);
          setRound(2);
          setRideLiked(restored.likedPitches);
          setFinished(false);
        } else {
          setRideLiked(restored.likedPitches);
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

  // Keep progress up to date as the user rides, in whichever store fits
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
      secondChanceIds: held.map((p) => p.id),
      round,
      likedIds: rideLiked.map((p) => p.id),
      floorIndex: floor
    };
    if (isSignedIn) {
      fetch('/api/pitch-swipe-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(progress)
      }).catch(() => {
        // A failed save here isn't worth interrupting the ride over —
        // worst case, resuming later starts fresh instead, same as if
        // nothing had ever been saved.
      });
    } else {
      saveLocalProgress(progress);
    }
  }, [deck, held, round, rideLiked, floor, finished, loading, isSignedIn]);

  // Any ride still mid-flight when the page unmounts would otherwise try
  // to set state on a gone component.
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    clearTimeout(toastTimerRef.current);
  }, []);

  function later(fn, ms) {
    timersRef.current.push(setTimeout(fn, ms));
  }

  function showToast(text) {
    setToast(text);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1500);
  }

  async function startOver() {
    if (isSignedIn) {
      await fetch('/api/pitch-swipe-progress', { method: 'DELETE' }).catch(() => {});
    } else {
      clearLocalProgress();
    }
    window.location.reload();
  }

  // Doors close, the floor changes behind them, doors open. `heldOverride`
  // lets Hold pass the queue it just added to — state updates aren't
  // applied until the next render, so reading `held` here on the exact
  // press that fills it would still see the pre-Hold value and the
  // second-look transition below would wrongly think it's empty.
  function ride(dir, heldOverride) {
    if (moving || finished || loading) return;
    if (dir < 0 && floor === 0) return;
    const queue = heldOverride || held;
    const { door, dwell } = motionTimings();

    setMoving(true);
    setLitNav(dir > 0 ? 'up' : 'down');
    setDirection(dir > 0 ? 'up' : 'down');
    setFlipped(false);
    setDoorsClosed(true);

    later(() => {
      if (dir > 0) {
        if (floor + 1 < deck.length) {
          setFloor(floor + 1);
        } else if (round === 1 && queue.length > 0) {
          // Top floor reached with pitches on hold — the second-look ride
          // starts from the ground with just those.
          setDeck(shuffled(queue));
          setHeld([]);
          setFloor(0);
          setRound(2);
        } else {
          setFinished(true);
        }
      } else {
        setFloor(floor - 1);
      }
      later(() => {
        setDoorsClosed(false);
        setDirection(null);
        later(() => {
          setMoving(false);
          setLitNav(null);
        }, door);
      }, dwell);
    }, door);
  }

  // Hold the door: mark this pitch for a second look, then ride on. Only
  // in round 1 — the second-look ride *is* the second look, so holding
  // there would mean seeing it a third time.
  function hold() {
    if (moving || finished || !current || round !== 1) return;
    const nextHeld = currentHeld ? held : [...held, current];
    setHeld(nextHeld);
    setLitNav('hold');
    later(() => ride(1, nextHeld), 260);
  }

  async function toggleSave(pitch) {
    // /api/pitch-save always 401s when signed out — that's correct, not a
    // bug, and the requireSignIn banner already explains it, so the
    // button simply does nothing rather than surfacing a redundant error.
    if (!isSignedIn) return;
    const wasSaved = savedIds.has(pitch.id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      wasSaved ? next.delete(pitch.id) : next.add(pitch.id);
      return next;
    });
    showToast(wasSaved ? 'Removed from My List' : 'Saved to My List');
    try {
      const res = await fetch('/api/pitch-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId: pitch.id })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSavedIds((prev) => {
        const next = new Set(prev);
        data.saved ? next.add(pitch.id) : next.delete(pitch.id);
        return next;
      });
    } catch {
      setSavedIds((prev) => {
        const next = new Set(prev);
        wasSaved ? next.add(pitch.id) : next.delete(pitch.id);
        return next;
      });
      setSaveError(`"${pitch.title}" couldn't be saved right now — it may not show up in My List.`);
    }
  }

  async function toggleLike(pitch) {
    const wasLiked = likedIds.has(pitch.id);
    const apply = (liked) => {
      setLikedIds((prev) => {
        const next = new Set(prev);
        liked ? next.add(pitch.id) : next.delete(pitch.id);
        return next;
      });
      setRideLiked((prev) => (liked ? (prev.some((p) => p.id === pitch.id) ? prev : [...prev, pitch]) : prev.filter((p) => p.id !== pitch.id)));
    };
    apply(!wasLiked);
    setLikeCounts((prev) => ({ ...prev, [pitch.id]: Math.max(0, (prev[pitch.id] || 0) + (wasLiked ? -1 : 1)) }));
    // Signed-out likes still count locally for this session's own lobby
    // summary (and light the lamp), they just aren't stored anywhere —
    // same as the banner says.
    if (!isSignedIn) return;
    try {
      const res = await fetch('/api/pitch-like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId: pitch.id })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      apply(Boolean(data.liked));
      if (typeof data.count === 'number') setLikeCounts((prev) => ({ ...prev, [pitch.id]: data.count }));
    } catch {
      apply(wasLiked);
      setLikeCounts((prev) => ({ ...prev, [pitch.id]: Math.max(0, (prev[pitch.id] || 0) + (wasLiked ? 1 : -1)) }));
    }
  }

  // Same share code as the pitch page and the reel feed: native share
  // sheet where there is one, clipboard everywhere else.
  function share(pitch) {
    const url = `${window.location.origin}/pitches/${pitch.id}`;
    if (navigator.share) {
      navigator.share({ title: pitch.title, url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setShareCopiedId(pitch.id);
        showToast('Link copied');
        later(() => setShareCopiedId(null), 2000);
      }).catch(() => {});
    }
  }

  // Keyboard: ↑ next, ↓ back, F flip, S save, L like, H hold. Handlers
  // read through a ref so the listener subscribes once and still sees
  // the current floor/deck.
  const actionsRef = useRef(null);
  actionsRef.current = { ride, hold, toggleSave, toggleLike, current, flip: () => setFlipped((f) => !f), finished };
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const a = actionsRef.current;
      if (!a || a.finished) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); a.ride(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); a.ride(-1); }
      else if (a.current) {
        const k = e.key.toLowerCase();
        if (k === 'f') a.flip();
        else if (k === 's') a.toggleSave(a.current);
        else if (k === 'l') a.toggleLike(a.current);
        else if (k === 'h') a.hold();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const savedThisRide = deck.concat(held).filter((p) => savedIds.has(p.id)).length;

  return (
    <>
      <Head>
        <title>Discover — Pitch Room — {SITE.name}</title>
        <meta name="description" content={`Ride floor to floor through project ideas looking for backing on ${SITE.name}.`} />
      </Head>

      <div className="pitch-discover-stage">
        <button className="pitch-discover-close" onClick={goBack} aria-label="Close">
          <CloseIcon size={16} />
        </button>

        <div className="pitch-discover-banners" ref={bannersRef}>
          {bypassingDisabled && (
            <div className="admin-preview-banner pitch-discover-banner">
              ⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.
              <Link href="/admin">Go turn it back on</Link>
            </div>
          )}
          {saveError && <div className="admin-preview-banner pitch-discover-banner">{saveError}</div>}
          {requireSignIn && (
            <div className="poster-empty pitch-discover-banner">
              Sign in to save and like projects — you can still ride through without an account, but
              saves and likes won&rsquo;t be kept anywhere.
            </div>
          )}
        </div>

        <div className="swipe-deck-wrap">
          {loading ? (
            <div className="poster-empty">Calling the elevator…</div>
          ) : (
            <div className="elev-stage">
              {round === 2 && !finished && (
                <div className="swipe-round-tag">Second look — one more ride for the ones you held</div>
              )}
              <FloorIndicator
                floor={floor}
                total={Math.max(deck.length, 1)}
                direction={direction}
                secondLook={round === 2 && !finished}
                lobby={finished}
              />

              <ElevatorCab closed={doorsClosed}>
                {finished || !current ? (
                  <div className="elev-lobby">
                    <span className="elev-lobby-eyebrow">Lobby</span>
                    <h3>That&rsquo;s every floor for now.</h3>
                    {rideLiked.length > 0 || savedThisRide > 0 ? (
                      <>
                        <p>
                          You liked {rideLiked.length} and saved {savedThisRide} project{savedThisRide === 1 ? '' : 's'}.
                          {savedThisRide > 0 && <> Saved ones are in <Link href="/wishlist">My List</Link>.</>}
                        </p>
                        {rideLiked.length > 0 && (
                          <ul className="elev-lobby-list">
                            {rideLiked.map((p) => (
                              <li key={p.id}><Link href={`/pitches/${p.id}`}>{p.title}</Link></li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      <p>Nothing caught you this ride — that&rsquo;s alright, more floors open as creators submit ideas.</p>
                    )}
                    <div className="elev-lobby-actions">
                      <Link href="/pitches" className="account-btn-primary" style={{ width: 'auto', display: 'inline-block', textDecoration: 'none' }}>
                        Browse Pitch Room
                      </Link>
                      <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={startOver}>
                        Ride again
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {currentHeld && round === 1 && <div className="elev-hold-lamp">Held · 2nd look</div>}

                    <div className="elev-card-slot">
                      <ElevatorCard key={current.id} pitch={current} flipped={flipped} onFlip={(next) => setFlipped(next)} />
                    </div>

                    <div className="elev-plate elev-plate-left" role="group" aria-label="Elevator controls">
                      <ElevatorButton
                        icon={<ArrowUpIcon size={19} />}
                        label="Next"
                        ariaLabel="Next pitch"
                        lit={litNav === 'up'}
                        disabled={moving}
                        onClick={() => ride(1)}
                      />
                      <ElevatorButton
                        icon={<ArrowDownIcon size={19} />}
                        label="Back"
                        ariaLabel="Previous pitch"
                        lit={litNav === 'down'}
                        disabled={moving || floor === 0}
                        onClick={() => ride(-1)}
                      />
                      <ElevatorButton
                        icon={<DoorHoldIcon size={19} />}
                        label="Hold"
                        ariaLabel="Hold for a second look"
                        lit={litNav === 'hold'}
                        disabled={moving || round === 2}
                        onClick={hold}
                      />
                    </div>

                    <div className="elev-plate elev-plate-right" role="group" aria-label="Pitch actions">
                      <ElevatorButton
                        icon={<BookmarkIcon size={19} active={savedIds.has(current.id)} />}
                        label="Save"
                        ariaLabel={savedIds.has(current.id) ? 'Remove from My List' : 'Save to My List'}
                        ariaPressed={savedIds.has(current.id)}
                        lit={savedIds.has(current.id)}
                        variant="save"
                        disabled={!isSignedIn}
                        onClick={() => toggleSave(current)}
                      />
                      <ElevatorButton
                        icon={shareCopiedId === current.id ? <CheckIcon size={19} /> : <ShareIcon size={19} src={iconOverrides.share} />}
                        label="Share"
                        lit={shareCopiedId === current.id}
                        onClick={() => share(current)}
                      />
                      <ElevatorButton
                        icon={<HeartIcon size={19} active={likedIds.has(current.id)} src={likedIds.has(current.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} />}
                        label="Like"
                        ariaLabel={likedIds.has(current.id) ? 'Unlike' : 'Like'}
                        ariaPressed={likedIds.has(current.id)}
                        lit={likedIds.has(current.id)}
                        variant="heart"
                        count={likeCounts[current.id] || 0}
                        onClick={() => toggleLike(current)}
                      />
                    </div>
                  </>
                )}
              </ElevatorCab>

              <div className={`elev-toast ${toast ? 'elev-toast-on' : ''}`} role="status">{toast}</div>
            </div>
          )}
        </div>
      </div>
      <MobileTabBar />
    </>
  );
}
