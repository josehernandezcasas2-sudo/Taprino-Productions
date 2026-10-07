import { useAuth } from '@clerk/expo';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  BookmarkIcon, CheckIcon, DOOR_MS, DWELL_MS, ElevatorButton, ElevatorCab, ElevatorCard, FloorIndicator, HeartIcon, ShareIcon
} from '../../components/PitchElevator';
import { API_BASE_URL, apiDelete, apiGet, apiPost } from '../../lib/api';
import { absoluteFill, colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';

function shuffled(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Same shape as lib/swipeProgressStorage.js's reconstructFromIds on the
// website — small enough to keep local rather than sharing a package.
function reconstructFromIds(pitches, saved) {
  const byId = new Map(pitches.map((p) => [p.id, p]));
  const resolve = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
  const deck = resolve(saved.deckIds);
  const rawIndex = Number.isInteger(saved.floorIndex) ? saved.floorIndex : 0;
  return {
    deck,
    secondChance: resolve(saved.secondChanceIds),
    round: saved.round === 2 ? 2 : 1,
    likedPitches: resolve(saved.likedIds),
    floorIndex: deck.length ? Math.min(Math.max(0, rawIndex), deck.length - 1) : 0
  };
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Port of pages/pitches/discover.js: every pitch is a floor. Swiping the
// card rides the elevator — left or right goes up to the next floor (right
// also likes, same as the old swipe deck), down holds the pitch for a
// second look and moves on. The right plate reacts to the pitch on this
// floor (Save/Share/Like). Same ride state machine and progress
// persistence (with floorIndex) as the web. Signed-out visitors get a
// fresh ride each time — no AsyncStorage equivalent of the website's
// localStorage fallback yet.
export default function PitchDiscover() {
  const { getToken } = useAuth();
  const router = useRouter();

  const [feedState, setFeedState] = useState({ loading: true, error: null, feed: null });
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [deck, setDeck] = useState([]);
  const [floor, setFloor] = useState(0);
  const [round, setRound] = useState(1);
  const [held, setHeld] = useState([]);
  const [rideLiked, setRideLiked] = useState([]);
  const [likedIds, setLikedIds] = useState(new Set());
  const [savedIds, setSavedIds] = useState(new Set());
  const [likeCounts, setLikeCounts] = useState({});
  const [finished, setFinished] = useState(false);

  const [doorsClosed, setDoorsClosed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [direction, setDirection] = useState(null);
  const [flipped, setFlipped] = useState(false);

  const [toast, setToast] = useState(null);
  const [shareCopiedId, setShareCopiedId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const tokenRef = useRef(null);
  const timersRef = useRef([]);
  const toastTimerRef = useRef(null);

  const current = deck[floor];
  const currentHeld = Boolean(current) && held.some((p) => p.id === current.id);
  const isSignedIn = Boolean(feedState.feed?.isSignedIn);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        tokenRef.current = token;
        const data = await apiGet('/api/pitch-discover-feed', token);
        if (cancelled) return;
        setSavedIds(new Set(data.savedIds || []));
        setLikedIds(new Set(data.likedIds || []));
        setLikeCounts(data.likeCounts || {});
        setFeedState({ loading: false, error: null, feed: data });
      } catch (err) {
        if (!cancelled) setFeedState({ loading: false, error: err.message, feed: null });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (feedState.loading || feedState.error || !feedState.feed) return;
    let cancelled = false;
    const { pitches, isSignedIn: signedIn } = feedState.feed;

    async function loadProgress() {
      let saved = null;
      if (signedIn) {
        try {
          const data = await apiGet('/api/pitch-swipe-progress', tokenRef.current);
          saved = data.progress;
        } catch {
          // Falls through to a fresh ride — same as the web's try/catch.
        }
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
      setLoadingProgress(false);
    }

    loadProgress();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedState.loading, feedState.error, feedState.feed]);

  useEffect(() => {
    if (loadingProgress || feedState.loading || !feedState.feed?.isSignedIn) return;
    if (finished) {
      apiDelete('/api/pitch-swipe-progress', {}, tokenRef.current).catch(() => {});
      return;
    }
    const progress = {
      deckIds: deck.map((p) => p.id),
      secondChanceIds: held.map((p) => p.id),
      round,
      likedIds: rideLiked.map((p) => p.id),
      floorIndex: floor
    };
    apiPost('/api/pitch-swipe-progress', progress, tokenRef.current).catch(() => {});
  }, [deck, held, round, rideLiked, floor, finished, loadingProgress, feedState.loading, feedState.feed]);

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
      await apiDelete('/api/pitch-swipe-progress', {}, tokenRef.current).catch(() => {});
    }
    setHeld([]);
    setRound(1);
    setRideLiked([]);
    setFinished(false);
    setFlipped(false);
    setFloor(0);
    setDeck(shuffled(feedState.feed.pitches));
  }

  // Doors close, the floor changes behind them, doors open. heldOverride
  // is for hold(), which has just queued a pitch but whose setHeld hasn't
  // been applied yet when it calls this.
  function ride(dir, heldOverride) {
    if (moving || finished || loadingProgress) return;
    if (dir < 0 && floor === 0) return;
    const queue = heldOverride || held;

    setMoving(true);
    setDirection(dir > 0 ? 'up' : 'down');
    setDoorsClosed(true);

    later(() => {
      setFlipped(false);
      if (dir > 0) {
        if (floor + 1 < deck.length) {
          setFloor(floor + 1);
        } else if (round === 1 && queue.length > 0) {
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
        later(() => setMoving(false), DOOR_MS);
      }, DWELL_MS);
    }, DOOR_MS);
  }

  // Hold for a second look, then ride on. Round 1 only — in the second-
  // look ride a down-swipe just rides on.
  function hold() {
    if (moving || finished || !current) return;
    if (round !== 1) {
      ride(1);
      return;
    }
    const nextHeld = currentHeld ? held : [...held, current];
    setHeld(nextHeld);
    ride(1, nextHeld);
  }

  // What a swipe on the card means — same mapping as the old swipe deck:
  // right = like (and move on), left = pass, down = hold for a second look.
  function handleSwipe(swipeDirection) {
    if (!current || moving) return;
    if (swipeDirection === 'right') {
      if (!likedIds.has(current.id)) toggleLike(current);
      ride(1);
    } else if (swipeDirection === 'left') {
      ride(1);
    } else if (swipeDirection === 'down') {
      hold();
    }
  }

  function promptSignIn(what) {
    Alert.alert(`Sign in to ${what} projects`, 'Saved projects notify you when the creator posts an update.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Sign in', onPress: () => router.push('/account') }
    ]);
  }

  async function toggleSave(pitch) {
    if (!isSignedIn || !tokenRef.current) {
      promptSignIn('save');
      return;
    }
    const wasSaved = savedIds.has(pitch.id);
    const apply = (saved) => setSavedIds((prev) => {
      const next = new Set(prev);
      saved ? next.add(pitch.id) : next.delete(pitch.id);
      return next;
    });
    apply(!wasSaved);
    showToast(wasSaved ? 'Removed from My List' : 'Saved to My List');
    try {
      const data = await apiPost('/api/pitch-save', { pitchId: pitch.id }, tokenRef.current);
      apply(Boolean(data.saved));
    } catch {
      apply(wasSaved);
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
    // Signed-out likes count locally for this ride's lobby summary and
    // light the lamp; they just aren't stored anywhere, as the banner says.
    if (!isSignedIn || !tokenRef.current) return;
    try {
      const data = await apiPost('/api/pitch-like', { pitchId: pitch.id }, tokenRef.current);
      apply(Boolean(data.liked));
      if (typeof data.count === 'number') setLikeCounts((prev) => ({ ...prev, [pitch.id]: data.count }));
    } catch {
      apply(wasLiked);
      setLikeCounts((prev) => ({ ...prev, [pitch.id]: Math.max(0, (prev[pitch.id] || 0) + (wasLiked ? 1 : -1)) }));
    }
  }

  function share(pitch) {
    const url = `${API_BASE_URL}/pitches/${pitch.id}`;
    setShareCopiedId(pitch.id);
    later(() => setShareCopiedId(null), 1200);
    Share.share({ message: url, url, title: pitch.title }).catch(() => {});
  }

  if (feedState.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }

  if (feedState.error || !feedState.feed) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.errorText}>Couldn't call the elevator: {feedState.error || 'not found'}</Text></View>
      </SafeAreaView>
    );
  }

  const { bypassingDisabled, requireSignIn } = feedState.feed;
  const savedThisRide = deck.concat(held).filter((p) => savedIds.has(p.id)).length;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      {bypassingDisabled ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.</Text>
        </View>
      ) : null}
      {saveError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{saveError}</Text>
        </View>
      ) : null}
      {requireSignIn ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Sign in to save and like projects — you can still ride through without an account, but saves and likes won't be kept anywhere.</Text>
        </View>
      ) : null}

      {/* The car fills everything between the top nav (and any banner)
          and the floating tab bar — see styles.stage's paddingBottom. */}
      <View style={styles.stage}>
        {loadingProgress ? (
          <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
        ) : (
          <ElevatorCab closed={doorsClosed}>
            <View style={styles.indicatorWrap} pointerEvents="none">
              <FloorIndicator
                floor={floor}
                total={Math.max(deck.length, 1)}
                direction={direction}
                secondLook={round === 2 && !finished}
                lobby={finished}
              />
            </View>
            {round === 2 && !finished ? (
              <Text style={styles.roundTag} pointerEvents="none">SECOND LOOK — THE ONES YOU HELD</Text>
            ) : null}

            {finished || !current ? (
              <View style={styles.lobby}>
                <Text style={styles.lobbyEyebrow}>LOBBY</Text>
                <Text style={styles.lobbyTitle}>That's every floor for now.</Text>
                {rideLiked.length > 0 || savedThisRide > 0 ? (
                  <>
                    <Text style={styles.lobbyText}>
                      You liked {rideLiked.length} and saved {savedThisRide} project{savedThisRide === 1 ? '' : 's'}.
                      {savedThisRide > 0 ? ' Saved ones are in My List.' : ''}
                    </Text>
                    {rideLiked.map((p) => (
                      <Pressable key={p.id} onPress={() => router.push(`/pitches/${p.id}`)}>
                        <Text style={styles.lobbyLink}>{p.title}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : (
                  <Text style={styles.lobbyText}>Nothing caught you this ride — that's alright, more floors open as creators submit ideas.</Text>
                )}
                <View style={styles.lobbyActions}>
                  <Pressable style={styles.primaryBtn} onPress={() => router.push('/pitches')}>
                    <Text style={styles.primaryBtnText}>Browse Pitch Room</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryBtn} onPress={startOver}>
                    <Text style={styles.secondaryBtnText}>Ride again</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                {currentHeld && round === 1 ? <Text style={styles.holdLamp}>HELD · 2ND LOOK</Text> : null}

                <View style={styles.cardSlot} pointerEvents="box-none">
                  <View style={styles.cardBox}>
                    <ElevatorCard
                      key={current.id}
                      pitch={current}
                      flipped={flipped}
                      onFlip={(next) => setFlipped(next)}
                      onSwipe={handleSwipe}
                      disabled={moving}
                    />
                  </View>
                </View>

                <View style={styles.plateCol} pointerEvents="box-none">
                  <View style={styles.plate}>
                    <ElevatorButton
                      icon={(c) => <BookmarkIcon color={c} active={savedIds.has(current.id)} />}
                      label="Save"
                      accessibilityLabel={savedIds.has(current.id) ? 'Remove from My List' : 'Save to My List'}
                      lit={savedIds.has(current.id)}
                      variant="save"
                      onPress={() => toggleSave(current)}
                    />
                    <ElevatorButton
                      icon={(c) => (shareCopiedId === current.id ? <CheckIcon color={c} /> : <ShareIcon color={c} />)}
                      label="Share"
                      lit={shareCopiedId === current.id}
                      onPress={() => share(current)}
                    />
                    <ElevatorButton
                      icon={(c) => <HeartIcon color={c} active={likedIds.has(current.id)} />}
                      label="Like"
                      accessibilityLabel={likedIds.has(current.id) ? 'Unlike' : 'Like'}
                      lit={likedIds.has(current.id)}
                      variant="heart"
                      count={likeCounts[current.id] || 0}
                      onPress={() => toggleLike(current)}
                    />
                  </View>
                </View>
              </>
            )}

            {toast ? <Text style={styles.toast} pointerEvents="none">{toast}</Text> : null}
          </ElevatorCab>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  banner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline
  },
  bannerText: { color: colors.inkDim, fontSize: 13, lineHeight: 18 },
  // paddingBottom clears BottomNav's floating pill (~64px tall, 18px off
  // the bottom inset, which SafeAreaView already adds) plus a breath.
  stage: { flex: 1, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 94 },

  indicatorWrap: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center', zIndex: 7 },
  // The round-2 explainer and the held lamp share the strip under the
  // indicator; they never show at the same time (held is round 1 only).
  roundTag: { position: 'absolute', top: 58, alignSelf: 'center', zIndex: 7, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2, color: colors.olive, backgroundColor: 'rgba(12,19,31,0.6)', borderWidth: 1, borderColor: 'rgba(231,162,85,0.4)', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, overflow: 'hidden' },
  holdLamp: { position: 'absolute', top: 58, right: 10, zIndex: 7, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2, color: colors.mint, backgroundColor: 'rgba(12,19,31,0.6)', borderWidth: 1, borderColor: 'rgba(147,208,164,0.5)', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, overflow: 'hidden' },

  // The card sits in the room left of the plate (84px: ring + plate
  // padding + inset), clear of the indicator strip above.
  cardSlot: { ...absoluteFill, paddingLeft: 14, paddingRight: 84, paddingTop: 58, paddingBottom: 22, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  cardBox: { width: '100%', maxWidth: 340, aspectRatio: 3 / 4.6, maxHeight: '100%' },

  plateCol: { position: 'absolute', right: 9, top: 0, bottom: 0, justifyContent: 'center', zIndex: 4 },
  plate: {
    alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 5, borderRadius: 10,
    backgroundColor: '#2b3852', borderWidth: 1, borderColor: '#5a6a8d',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 20, elevation: 8
  },

  lobby: { ...absoluteFill, zIndex: 3, justifyContent: 'center', gap: 10, padding: 22, backgroundColor: colors.surface1 },
  lobbyEyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.8, color: colors.olive, textAlign: 'center' },
  lobbyTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink, textAlign: 'center' },
  lobbyText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim, textAlign: 'center' },
  lobbyLink: { fontFamily: fonts.body, color: colors.olive, fontSize: 14, textAlign: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  lobbyActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 6 },
  primaryBtn: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  primaryBtnText: { fontFamily: fonts.displaySemi, color: colors.surface0, fontSize: 13 },
  secondaryBtn: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  secondaryBtnText: { fontFamily: fonts.displaySemi, color: colors.ink, fontSize: 13 },

  toast: { position: 'absolute', bottom: 14, alignSelf: 'center', zIndex: 7, fontFamily: fonts.mono, fontSize: 11, color: colors.ink, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 13, overflow: 'hidden' }
});
