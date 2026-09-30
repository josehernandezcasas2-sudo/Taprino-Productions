import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import ReelPlayer from '../../components/ReelPlayer';
import { apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import { buildPersonalUnitKeys, buildVerticalUnits, createDiscoverPicker, expandUnitToSlides, unitKey } from '../../lib/verticalFeed';

function HeartIcon({ active, size = 22 }) {
  return active ? (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#e8503d">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}
function ShareIcon({ size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 15V4" />
      <Path d="M8 8l4-4 4 4" />
      <Path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </Svg>
  );
}
function CheckIcon({ size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}
function CloseIconSvg({ size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 5l14 14" />
      <Path d="M19 5L5 19" />
    </Svg>
  );
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

const SITE_ORIGIN = 'https://studiotapatv.site';

// Mirrors pages/vertical/discover.js: same catalog-entitlement filter,
// same 3-random/1-curated/3-personal picker (mobile/src/lib/verticalFeed.js,
// a byte-for-byte port — see its own header comment), same auto-extend-
// near-the-end and per-series end-card behavior. Scope cuts from the web
// version, both deliberate: no house-ad slides (mobile ad integration is
// paused, see project_mobile_app_ads_paused memory) and no user-posted
// video slides (lib/posts.js is an admin test feature with no mobile
// screen anywhere yet) — this feed is catalog-only.
export default function VerticalDiscover() {
  const router = useRouter();
  const { series: requestedSeriesId } = useLocalSearchParams();
  const { getToken } = useAuth();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [feedState, setFeedState] = useState({ loading: true, error: null, feed: null });
  const [deck, setDeck] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [srcByEpisodeId, setSrcByEpisodeId] = useState({});
  const [wishlistSet, setWishlistSet] = useState(new Set());
  const [shareCopiedKey, setShareCopiedKey] = useState(null);

  const tokenRef = useRef(null);
  const seenSeriesIds = useRef(new Set());
  const unitsRef = useRef([]);
  const pickerRef = useRef(null);
  const listRef = useRef(null);
  const pendingScrollToEnd = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        tokenRef.current = token;
        const data = await apiGet('/api/vertical-discover-feed', token);
        if (cancelled) return;
        setFeedState({ loading: false, error: null, feed: data });
        setWishlistSet(new Set(data.wishlist || []));

        unitsRef.current = buildVerticalUnits(data.verticalEpisodes);
        pickerRef.current = createDiscoverPicker(unitsRef.current, new Set(data.personalUnitKeys));
        const requested = requestedSeriesId
          ? unitsRef.current.find((u) => u.type === 'series' && u.seriesId === requestedSeriesId)
          : null;
        const first = requested || pickerRef.current.next(seenSeriesIds.current);
        if (!first) return;
        seenSeriesIds.current.add(unitKey(first));
        setDeck(expandUnitToSlides(first));
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

  function extendDeck() {
    const next = pickerRef.current && pickerRef.current.next(seenSeriesIds.current);
    if (!next) return;
    seenSeriesIds.current.add(unitKey(next));
    setDeck((d) => [...d, ...expandUnitToSlides(next)]);
  }

  useEffect(() => {
    if (deck.length === 0) return;
    const nearEnd = activeIndex >= deck.length - 2;
    const lastIsEndCard = deck[deck.length - 1].kind === 'end-card';
    if (nearEnd && !lastIsEndCard) extendDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, deck]);

  useEffect(() => {
    if (pendingScrollToEnd.current && deck.length > 0) {
      pendingScrollToEnd.current = false;
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [deck]);

  useEffect(() => {
    const toFetch = [deck[activeIndex], deck[activeIndex + 1]]
      .filter((s) => s && s.kind === 'episode' && !srcByEpisodeId[s.episode.id]);
    toFetch.forEach((slide) => {
      apiGet(`/api/vertical/playback?episodeId=${slide.episode.id}`, tokenRef.current)
        .then((data) => {
          if (data.src) setSrcByEpisodeId((m) => ({ ...m, [slide.episode.id]: data.src }));
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, deck]);

  async function toggleWishlist(episodeId) {
    const wasWishlisted = wishlistSet.has(episodeId);
    setWishlistSet((prev) => {
      const next = new Set(prev);
      if (wasWishlisted) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
    try {
      await apiPost('/api/wishlist', { episodeId, action: wasWishlisted ? 'remove' : 'add' }, tokenRef.current);
    } catch {
      setWishlistSet((prev) => {
        const next = new Set(prev);
        if (wasWishlisted) next.add(episodeId);
        else next.delete(episodeId);
        return next;
      });
    }
  }

  function share(slide) {
    const url = slide.seriesId
      ? `${SITE_ORIGIN}/vertical/discover?series=${slide.seriesId}`
      : `${SITE_ORIGIN}/episode/${slide.episode.id}`;
    Share.share({ message: url, url }).catch(() => {});
    setShareCopiedKey(slide.key);
    setTimeout(() => setShareCopiedKey(null), 2000);
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.push('/watch/vertical');
  }

  // FlatList throws if onViewableItemsChanged changes identity after
  // mount, so both it and its config are refs rather than plain
  // closures/inline objects.
  const onViewableItemsChangedRef = useRef(({ viewableItems }) => {
    const visible = viewableItems.find((v) => v.isViewable);
    if (visible) setActiveIndex(visible.index);
  });
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 60 });

  if (feedState.loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.brass} />
      </View>
    );
  }

  if (feedState.error || !feedState.feed) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorText}>Couldn't load Vertical Discover: {feedState.error || 'not found'}</Text>
        <Pressable style={styles.closeBtnInline} onPress={goBack}>
          <Text style={styles.closeBtnInlineText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const { seriesNameById, viewerId } = feedState.feed;

  return (
    <View style={styles.feed}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar hidden />
      <FlatList
        ref={listRef}
        data={deck}
        keyExtractor={(slide) => slide.key}
        renderItem={({ item: slide, index: i }) => (
          <View style={{ height: windowHeight, width: '100%' }}>
            {slide.kind === 'episode' ? (
              <>
                <ReelPlayer
                  src={srcByEpisodeId[slide.episode.id] || null}
                  active={i === activeIndex}
                  muted={muted}
                  onToggleMute={() => setMuted((m) => !m)}
                  thumbnail={slide.episode.thumbnail}
                  onEnded={() => {
                    if (i + 1 < deck.length) {
                      listRef.current?.scrollToIndex({ index: i + 1, animated: true });
                    }
                  }}
                />
                <Pressable style={[styles.closeBtn, { top: insets.top + 10 }]} onPress={goBack}>
                  <CloseIconSvg size={16} />
                </Pressable>

                <View style={[styles.actionRail, { bottom: insets.bottom + 140 }]}>
                  <Pressable style={styles.actionBtn} onPress={() => toggleWishlist(slide.episode.id)}>
                    <HeartIcon active={wishlistSet.has(slide.episode.id)} size={22} />
                  </Pressable>
                  <Pressable style={styles.actionBtn} onPress={() => share(slide)}>
                    {shareCopiedKey === slide.key ? <CheckIcon size={22} /> : <ShareIcon size={22} />}
                  </Pressable>
                </View>

                <View style={[styles.caption, { paddingBottom: insets.bottom + 30 }]} pointerEvents="none">
                  {slide.seriesId ? (
                    <Text style={styles.captionSeries}>{(seriesNameById[slide.seriesId] || '').toUpperCase()}</Text>
                  ) : null}
                  {slide.episode.title ? <Text style={styles.captionTitle}>{slide.episode.title}</Text> : null}
                  {slide.positionInSeries ? (
                    <Text style={styles.captionProgress}>Episode {slide.positionInSeries} of {slide.seriesLength}</Text>
                  ) : null}
                </View>
              </>
            ) : (
              <View style={styles.endCard}>
                <Pressable style={[styles.closeBtn, { top: insets.top + 10 }]} onPress={goBack}>
                  <CloseIconSvg size={16} />
                </Pressable>
                <Text style={styles.endIcon}>▢</Text>
                <Text style={styles.endTitle}>That's the whole series</Text>
                <Text style={styles.endSub}>You're caught up on {seriesNameById[slide.seriesId] || 'this one'}</Text>
                <Pressable
                  style={styles.endBtnPrimary}
                  onPress={() => {
                    pendingScrollToEnd.current = true;
                    extendDeck();
                  }}
                >
                  <Text style={styles.endBtnPrimaryText}>Discover — random vertical picks</Text>
                </Pressable>
                <Pressable style={styles.endBtnSecondary} onPress={() => router.push('/watch/vertical')}>
                  <Text style={styles.endBtnSecondaryText}>Browse other vertical series</Text>
                </Pressable>
                <Pressable onPress={() => router.push('/stream')}>
                  <Text style={styles.endHome}>or go back to Home</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={windowHeight}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: windowHeight, offset: windowHeight * index, index })}
        onViewableItemsChanged={onViewableItemsChangedRef.current}
        viewabilityConfig={viewabilityConfigRef.current}
        windowSize={5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  feed: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  closeBtnInline: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline },
  closeBtnInlineText: { color: colors.ink, fontSize: 14, fontWeight: '600' },

  closeBtn: {
    position: 'absolute',
    left: 16,
    zIndex: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionRail: {
    position: 'absolute',
    right: 12,
    zIndex: 4,
    gap: 18,
    alignItems: 'center'
  },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    paddingHorizontal: 18,
    paddingTop: 60
  },
  captionSeries: { color: colors.brass, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 3 },
  captionTitle: { color: colors.ink, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  captionProgress: { color: colors.inkDim, fontSize: 11 },

  endCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.surface1
  },
  endIcon: { fontSize: 32, color: colors.inkDim, marginBottom: 16 },
  endTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  endSub: { color: colors.inkDim, fontSize: 13, marginBottom: 28, textAlign: 'center' },
  endBtnPrimary: {
    width: '100%',
    maxWidth: 300,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: colors.olive,
    alignItems: 'center',
    marginBottom: 11
  },
  endBtnPrimaryText: { color: colors.surface0, fontSize: 14, fontWeight: '700' },
  endBtnSecondary: {
    width: '100%',
    maxWidth: 300,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(251,232,211,0.4)',
    alignItems: 'center',
    marginBottom: 11
  },
  endBtnSecondaryText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  endHome: { color: colors.inkDim, fontSize: 12, textDecorationLine: 'underline', marginTop: 4 }
});
