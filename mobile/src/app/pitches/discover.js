import { useAuth } from '@clerk/expo';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PitchSwipeCard, { SwipeButtons } from '../../components/PitchSwipeCard';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';

function shuffled(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Same shape as lib/swipeProgressStorage.js's reconstructFromIds on the
// website — small enough to keep local rather than sharing a package.
function reconstructFromIds(pitches, saved) {
  const byId = new Map(pitches.map((p) => [p.id, p]));
  const resolve = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
  return {
    deck: resolve(saved.deckIds),
    secondChance: resolve(saved.secondChanceIds),
    round: saved.round === 2 ? 2 : 1,
    likedPitches: resolve(saved.likedIds)
  };
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Mirrors pages/pitches/discover.js — same gate, same round/deck/second-
// chance/liked state machine, same progress persistence for signed-in
// users via /api/pitch-swipe-progress. Signed-out mobile visitors get a
// fresh deck each time (no AsyncStorage equivalent of the website's
// localStorage fallback — see project_mobile_app_status memory).
export default function PitchDiscover() {
  const { getToken } = useAuth();

  const [feedState, setFeedState] = useState({ loading: true, error: null, feed: null });
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [deck, setDeck] = useState([]);
  const [secondChance, setSecondChance] = useState([]);
  const [round, setRound] = useState(1);
  const [likedPitches, setLikedPitches] = useState([]);
  const [finished, setFinished] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const tokenRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        tokenRef.current = token;
        const data = await apiGet('/api/pitch-discover-feed', token);
        if (!cancelled) setFeedState({ loading: false, error: null, feed: data });
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
          // Falls through to a fresh deck — same as the web's try/catch.
        }
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
      secondChanceIds: secondChance.map((p) => p.id),
      round,
      likedIds: likedPitches.map((p) => p.id)
    };
    apiPost('/api/pitch-swipe-progress', progress, tokenRef.current).catch(() => {});
  }, [deck, secondChance, round, likedPitches, finished, loadingProgress, feedState.loading, feedState.feed]);

  async function startOver() {
    if (feedState.feed?.isSignedIn) {
      await apiDelete('/api/pitch-swipe-progress', {}, tokenRef.current).catch(() => {});
    }
    setSecondChance([]);
    setRound(1);
    setLikedPitches([]);
    setFinished(false);
    setDeck(shuffled(feedState.feed.pitches));
  }

  async function trySave(pitch) {
    try {
      await apiPost('/api/pitch-save', { pitchId: pitch.id }, tokenRef.current);
    } catch {
      setSaveError(`"${pitch.title}" was liked, but couldn't be saved — it may not show up in your followed projects.`);
    }
  }

  function advance(direction) {
    const pitch = deck[0];
    const rest = deck.slice(1);
    let nextSecondChance = secondChance;

    if (direction === 'right') {
      setLikedPitches((prev) => [...prev, pitch]);
      if (feedState.feed?.isSignedIn) trySave(pitch);
    } else if (direction === 'down' && round === 1) {
      nextSecondChance = [...secondChance, pitch];
      setSecondChance(nextSecondChance);
    }

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
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load the pitch deck: {feedState.error || 'not found'}</Text></View>
      </SafeAreaView>
    );
  }

  const { bypassingDisabled, requireSignIn } = feedState.feed;
  const current = deck[0];

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
          <Text style={styles.bannerText}>Sign in to like and follow projects — you can still browse without an account, but likes won't be saved anywhere.</Text>
        </View>
      ) : null}

      <View style={styles.stage}>
        {loadingProgress ? (
          <ActivityIndicator color={colors.brass} />
        ) : finished || !current ? (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>That's everything for now.</Text>
            {likedPitches.length > 0 ? (
              <>
                <Text style={styles.summaryText}>
                  You liked {likedPitches.length} project{likedPitches.length === 1 ? '' : 's'}:
                </Text>
                {likedPitches.map((p) => (
                  <Pressable key={p.id} onPress={() => Linking.openURL(`https://studiotapatv.site/pitches/${p.id}`)}>
                    <Text style={styles.summaryLink}>{p.title}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <Text style={styles.summaryText}>
                You didn't like anything this time through — that's alright, more ideas show up as creators submit them.
              </Text>
            )}
            <Pressable style={styles.startOverBtn} onPress={startOver}>
              <Text style={styles.startOverBtnText}>Start over</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {round === 2 ? (
              <Text style={styles.roundTag}>Second look — one more chance for the ones you skipped</Text>
            ) : null}
            <View style={styles.cardStack}>
              {current ? <PitchSwipeCard key={current.id} pitch={current} onSwipe={advance} /> : null}
            </View>
            <SwipeButtons
              onDislike={() => advance('left')}
              onSkip={() => advance('down')}
              onLike={() => advance('right')}
            />
          </>
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
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  roundTag: { color: colors.olive, fontSize: 13, marginBottom: 14, textAlign: 'center' },
  cardStack: { width: '100%', maxWidth: 360, aspectRatio: 3 / 4.6, maxHeight: '72%' },
  summary: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 360
  },
  summaryTitle: { color: colors.ink, fontSize: 19, fontWeight: '700', marginBottom: 10 },
  summaryText: { color: colors.inkDim, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  summaryLink: { color: colors.olive, fontSize: 14, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  startOverBtn: {
    marginTop: 16,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline
  },
  startOverBtnText: { color: colors.ink, fontSize: 14, fontWeight: '600' }
});
