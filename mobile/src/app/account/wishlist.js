import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { apiGet, apiPost, apiDelete } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}

// Mirrors pages/wishlist.js: Continue Watching (removable), Previously
// Watched (removable), then the wishlist itself (series + standalone
// episodes, heart to un-save) — via a new lib/wishlistFeed.js +
// GET /api/wishlist-feed, and the site's existing /api/wishlist,
// /api/watch-progress, /api/watch-history (now CORS-open).
//
// Deliberate scope cut, unlike the website: signed-out visitors get a
// localStorage-backed wishlist there (lib/useWishlist.js); this screen
// just asks signed-out users to sign in instead of building an
// AsyncStorage equivalent — added to the backlog, not done now.
export default function Wishlist() {
  const { getToken } = useAuth();
  const { startHostedAuth } = useHostedAuth();
  const router = useRouter();
  const [busyMode, setBusyMode] = useState(null);
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [removingId, setRemovingId] = useState(null);

  async function withToken() {
    return Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
  }

  async function load() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const token = await withToken();
      const feed = await apiGet('/api/wishlist-feed', token);
      setState({ loading: false, error: null, feed });
    } catch (err) {
      setState({ loading: false, error: err.message, feed: null });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleStartAuth(mode) {
    setBusyMode(mode);
    try {
      await startHostedAuth({ mode });
      load();
    } catch (err) {
      // Swallow — the screen just stays on the sign-in prompt.
    } finally {
      setBusyMode(null);
    }
  }

  async function removeContinueWatching(episodeId) {
    setRemovingId(episodeId);
    try {
      const token = await withToken();
      await apiDelete('/api/watch-progress', { episodeId }, token);
      setState((s) => ({ ...s, feed: { ...s.feed, continueWatching: s.feed.continueWatching.filter((e) => e.id !== episodeId) } }));
    } catch {
      // Non-fatal, same as web.
    } finally {
      setRemovingId(null);
    }
  }

  async function removeWatchHistory(episodeId) {
    setRemovingId(episodeId);
    try {
      const token = await withToken();
      await apiDelete('/api/watch-history', { episodeId }, token);
      setState((s) => ({ ...s, feed: { ...s.feed, watchHistory: s.feed.watchHistory.filter((e) => e.id !== episodeId) } }));
    } catch {
      // Non-fatal, same as web.
    } finally {
      setRemovingId(null);
    }
  }

  // Same toggle the Pitch Room grid and Discover's Save button use —
  // /api/pitch-save flips the row, so one call here unsaves it.
  async function removeSavedPitch(pitchId) {
    setRemovingId(pitchId);
    try {
      const token = await withToken();
      await apiPost('/api/pitch-save', { pitchId }, token);
      setState((s) => ({ ...s, feed: { ...s.feed, savedPitches: (s.feed.savedPitches || []).filter((p) => p.id !== pitchId) } }));
    } catch {
      // Non-fatal.
    } finally {
      setRemovingId(null);
    }
  }

  async function removeFromWishlist(id, isSeries) {
    setRemovingId(id);
    try {
      const token = await withToken();
      await apiPost('/api/wishlist', { episodeId: id, action: 'remove' }, token);
      setState((s) => ({
        ...s,
        feed: {
          ...s.feed,
          wishlistedSeries: isSeries ? s.feed.wishlistedSeries.filter((x) => x.id !== id) : s.feed.wishlistedSeries,
          wishlistedEpisodes: isSeries ? s.feed.wishlistedEpisodes : s.feed.wishlistedEpisodes.filter((x) => x.id !== id),
          totalCount: s.feed.totalCount - 1
        }
      }));
    } catch {
      // Non-fatal.
    } finally {
      setRemovingId(null);
    }
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }
  if (state.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load My List: {state.error}</Text></View>
      </SafeAreaView>
    );
  }
  if (!state.feed.isSignedIn) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}>
          <Text style={styles.title}>Sign in to see your list</Text>
          <Text style={styles.subtitle}>Wishlist, Continue Watching, and Previously Watched all live on your account.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => handleStartAuth('sign-in')} disabled={!!busyMode}>
            {busyMode === 'sign-in' ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
          </Pressable>
          <Pressable style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={() => handleStartAuth('sign-up')} disabled={!!busyMode}>
            {busyMode === 'sign-up' ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.secondaryBtnText}>Create a free account</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { continueWatching, watchHistory, wishlistedSeries, wishlistedEpisodes, totalCount } = state.feed;
  const savedPitches = state.feed.savedPitches || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        {continueWatching.length > 0 && (
          <Section title="Continue Watching">
            <Grid>
              {continueWatching.map((ep) => (
                <GridCard
                  key={ep.id}
                  item={ep}
                  subtitle={ep.runtime}
                  removing={removingId === ep.id}
                  onPress={() => router.push(`/episode/${ep.id}`)}
                  onRemove={() => removeContinueWatching(ep.id)}
                />
              ))}
            </Grid>
          </Section>
        )}

        {watchHistory.length > 0 && (
          <Section title="Previously Watched">
            <Grid>
              {watchHistory.map((ep) => (
                <GridCard
                  key={ep.id}
                  item={ep}
                  subtitle={ep.runtime}
                  removing={removingId === ep.id}
                  onPress={() => router.push(`/episode/${ep.id}`)}
                  onRemove={() => removeWatchHistory(ep.id)}
                />
              ))}
            </Grid>
          </Section>
        )}

        {savedPitches.length > 0 && (
          <Section title="Saved Pitches">
            <Text style={styles.sectionSub}>{savedPitches.length} saved · you'll get an email when a project posts an update</Text>
            <Grid>
              {savedPitches.map((p) => (
                <GridCard
                  key={p.id}
                  item={{ id: p.id, title: p.title, thumbnail: p.thumbnail }}
                  subtitle={p.fundingPct != null ? `${p.fundingPct}% funded` : (p.creatorName || 'Pitch Room')}
                  tagOverride={p.tag || 'Pitch'}
                  removing={removingId === p.id}
                  onPress={() => router.push(`/pitches/${p.id}`)}
                  onRemove={() => removeSavedPitch(p.id)}
                  removeGlyph="▮"
                />
              ))}
            </Grid>
          </Section>
        )}

        <View style={styles.libraryHeading}>
          <Text style={styles.libraryTitle}>My Wishlist</Text>
          <Text style={styles.librarySub}>{totalCount} saved</Text>
        </View>

        {totalCount === 0 ? (
          <Text style={styles.emptyText}>Nothing here yet — tap ♡ on a series, movie, or short to save it for later.</Text>
        ) : (
          <Grid>
            {wishlistedSeries.map((s) => (
              <GridCard
                key={s.id}
                item={{ id: s.id, title: s.name, thumbnail: s.thumbnail }}
                subtitle="You'll get an email when a new episode drops"
                tagOverride="Series"
                removing={removingId === s.id}
                onPress={() => router.push(`/series/${s.id}`)}
                onRemove={() => removeFromWishlist(s.id, true)}
                heart
              />
            ))}
            {wishlistedEpisodes.map((ep) => (
              <GridCard
                key={ep.id}
                item={ep}
                subtitle={ep.runtime}
                removing={removingId === ep.id}
                onPress={() => router.push(`/episode/${ep.id}`)}
                onRemove={() => removeFromWishlist(ep.id, false)}
                heart
              />
            ))}
          </Grid>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Grid({ children }) {
  return <View style={styles.grid}>{children}</View>;
}

function GridCard({ item, subtitle, tagOverride, removing, onPress, onRemove, heart, removeGlyph }) {
  const badge = tagOverride ? { label: tagOverride, color: colors.sky, text: colors.onBrass } : tierBadge(item.tier, item.adsEnabled);
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Pressable style={styles.removeBtn} onPress={onRemove} disabled={removing} hitSlop={8}>
        {removing ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={styles.removeBtnText}>{removeGlyph || (heart ? '♥' : '✕')}</Text>}
      </Pressable>
      {item.thumbnail ? <SmartImage uri={item.thumbnail} style={styles.cardImg} /> : <View style={styles.cardImg} />}
      <View style={[styles.badge, { backgroundColor: badge.color }]}>
        <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        {subtitle ? <Text style={styles.cardSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  emptyText: { color: colors.inkDim, fontSize: 14, lineHeight: 20 },

  title: { color: colors.ink, fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: colors.inkDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28, minWidth: 140, alignItems: 'center' },
  primaryBtnText: { color: colors.onBrass, fontSize: 15, fontWeight: '700' },
  secondaryBtn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28, minWidth: 140, alignItems: 'center' },
  secondaryBtnText: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  section: { marginBottom: 20 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  sectionSub: { color: colors.inkFaint, fontSize: 12, marginTop: -6, marginBottom: 10 },
  libraryHeading: { marginBottom: 4 },
  libraryTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  librarySub: { color: colors.inkFaint, fontSize: 12, marginTop: 2, marginBottom: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '31%' },
  cardImg: { width: '100%', aspectRatio: 2 / 3, borderRadius: 10, backgroundColor: colors.surface2 },
  cardInfo: { marginTop: 6 },
  cardTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  cardSubtitle: { color: colors.inkFaint, fontSize: 10, marginTop: 1 },

  badge: { position: 'absolute', top: 6, left: 6, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 8, fontWeight: '800' },

  removeBtn: { position: 'absolute', top: 6, right: 6, zIndex: 2, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(12,19,31,0.75)', alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { color: colors.ink, fontSize: 12, fontWeight: '700' }
});
