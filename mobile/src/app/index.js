import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet } from '../lib/api';
import { colors } from '../lib/theme';

// Mirrors pages/index.js section for section, fed by the same ranking
// rules (lib/homeFeed.js) via the public GET /api/home-feed route — no
// separate "mobile version" of what belongs on the homepage.
export default function Home() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, feed: null });

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/home-feed')
      .then((feed) => {
        if (!cancelled) setState({ loading: false, error: null, feed });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, feed: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }

  if (state.error) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.error}>Couldn't load the homepage: {state.error}</Text>
      </SafeAreaView>
    );
  }

  const {
    heroItem, trending, announcements, featuredCreators,
    filmsAndShorts, seriesRows, podcasts, pitches, liveStream
  } = state.feed;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <View style={styles.masthead}>
          <Text style={styles.mastheadTitle}>Studio Tapa TV</Text>
          <Text style={styles.mastheadTag}>SCREENING ROOM EDITION</Text>
        </View>

        {liveStream && (
          <View style={styles.liveBanner}>
            <View style={styles.liveDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.liveLabel}>Special bulletin — live now</Text>
              <Text style={styles.liveTitle}>{liveStream.title}</Text>
            </View>
          </View>
        )}

        {heroItem && (
          <View style={styles.hero}>
            {(heroItem.poster || heroItem.heroImage) ? (
              <Image source={{ uri: heroItem.poster || heroItem.heroImage }} style={styles.heroImage} />
            ) : null}
            <View style={styles.heroTagPill}>
              <Text style={styles.heroTagText}>NOW STREAMING</Text>
            </View>
            <Text style={styles.heroTitle}>{heroItem.title}</Text>
            {heroItem.desc ? <Text style={styles.heroDesc}>{heroItem.desc}</Text> : null}
            <Pressable style={styles.watchBtn} onPress={() => router.push(`/episode/${heroItem.id}`)}>
              <Text style={styles.watchBtnText}>▶ WATCH</Text>
            </Pressable>
          </View>
        )}

        {trending.length > 0 && (
          <Section label="TRENDING NOW" color={colors.brass}>
            <PosterRow
              items={trending.map((t, i) => ({ ...t, rank: i + 1 }))}
              subtitle={(item) => item.tag}
              showRank
              onPressItem={(item) => !item.isSeries && router.push(`/episode/${item.id}`)}
            />
          </Section>
        )}

        {announcements.length > 0 && (
          <Section label="ANNOUNCEMENTS" color={colors.mint}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
              {announcements.map((a) => (
                <View key={a.id} style={styles.announceCard}>
                  <Text style={styles.announceDate}>
                    {new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()}
                  </Text>
                  <Text style={styles.announceTitle}>{a.title}</Text>
                  {a.body ? <Text style={styles.announceBody} numberOfLines={3}>{a.body}</Text> : null}
                </View>
              ))}
            </ScrollView>
          </Section>
        )}

        {featuredCreators.length > 0 && (
          <Section label="THE FACES BEHIND IT" color={colors.sky}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
              {featuredCreators.map((c) => (
                <View key={c.userId} style={styles.creatorCard}>
                  <View style={styles.creatorPhotoWrap}>
                    {c.avatarUrl ? <Image source={{ uri: c.avatarUrl }} style={styles.creatorPhoto} /> : null}
                  </View>
                  <Text style={styles.creatorName}>{c.displayName}</Text>
                  <Text style={styles.creatorCredit} numberOfLines={1}>{c.credits.slice(0, 2).join(', ')}</Text>
                </View>
              ))}
            </ScrollView>
          </Section>
        )}

        {filmsAndShorts.length > 0 && (
          <Section label="FILMS & SHORTS" color={colors.rust}>
            <PosterRow
              items={filmsAndShorts}
              subtitle={(item) => `${item.contentType === 'movie' ? 'FILM' : 'SHORT'}${item.runtime ? ` · ${item.runtime}` : ''}`}
              onPressItem={(item) => router.push(`/episode/${item.id}`)}
            />
          </Section>
        )}

        {seriesRows.length > 0 && (
          <Section label="SERIES" color={colors.sky}>
            <PosterRow
              items={seriesRows}
              subtitle={(item) => `${item.count} episode${item.count === 1 ? '' : 's'}`}
            />
          </Section>
        )}

        {podcasts.length > 0 && (
          <Section label="ON AIR" color={colors.brass}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
              {podcasts.map((p) => (
                <View key={p.id} style={styles.cassette}>
                  <Text style={styles.cassetteText} numberOfLines={2}>{p.title}</Text>
                </View>
              ))}
            </ScrollView>
          </Section>
        )}

        {pitches.length > 0 && (
          <Section label="PITCH ROOM" color={colors.mint}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
              {pitches.map((p) => (
                <View key={p.id} style={styles.flyerCard}>
                  <Text style={styles.flyerTitle}>{p.title}</Text>
                  {p.logline ? <Text style={styles.flyerLogline} numberOfLines={3}>{p.logline}</Text> : null}
                  {p.creatorName ? <Text style={styles.flyerBy}>by {p.creatorName}</Text> : null}
                  {p.fundingRaised != null ? (
                    <Text style={styles.flyerRaised}>${Number(p.fundingRaised).toLocaleString()} raised</Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </Section>
        )}

        <View style={styles.membershipCard}>
          <Text style={styles.membershipEyebrow}>Classifieds — Membership</Text>
          <Text style={styles.membershipTitle}>WANTED: ad-free viewers to back the creators directly.</Text>
          <Text style={styles.membershipBody}>Early episodes, gated series, and a direct line to what you fund. Inquire within.</Text>
          <Text style={styles.membershipCta}>Join Tapa + →</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ label, color, children }) {
  return (
    <View style={styles.section}>
      <View style={[styles.sectionLabelPill, { backgroundColor: color }]}>
        <Text style={styles.sectionLabelText}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function PosterRow({ items, subtitle, showRank, onPressItem }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
      {items.map((item) => {
        const Wrapper = onPressItem ? Pressable : View;
        return (
          <Wrapper key={item.id} style={styles.posterItem} onPress={onPressItem ? () => onPressItem(item) : undefined}>
            <View style={styles.posterWrap}>
              {item.poster ? <Image source={{ uri: item.poster }} style={styles.poster} /> : null}
              {showRank ? (
                <View style={styles.rankBadge}>
                  <Text style={styles.rankText}>#{item.rank}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.posterTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.posterSubtitle}>{subtitle(item)}</Text>
          </Wrapper>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },

  masthead: { padding: 16, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: colors.surface2 },
  mastheadTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  mastheadTag: { color: colors.inkFaint, fontSize: 11, fontWeight: '600', letterSpacing: 1, marginTop: 2 },

  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.brassDeep, margin: 16, marginBottom: 0, padding: 12, borderRadius: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brass },
  liveLabel: { color: colors.ink, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  liveTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', marginTop: 2 },

  hero: { padding: 16 },
  heroImage: { width: '100%', height: 220, borderRadius: 16, backgroundColor: colors.surface2 },
  heroTagPill: { position: 'absolute', top: 24, left: 24, backgroundColor: colors.brass, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  heroTagText: { color: colors.onBrass, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  heroTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginTop: 12 },
  heroDesc: { color: colors.inkDim, fontSize: 14, marginTop: 4, lineHeight: 20 },
  watchBtn: { backgroundColor: colors.brass, alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, marginTop: 12 },
  watchBtnText: { color: colors.onBrass, fontWeight: '800', fontSize: 13 },

  section: { marginTop: 20 },
  sectionLabelPill: { alignSelf: 'flex-start', marginLeft: 16, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  sectionLabelText: { color: colors.onBrass, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  rowContent: { paddingHorizontal: 16, gap: 12 },

  posterItem: { width: 130 },
  posterWrap: { width: 130, height: 175, borderRadius: 10, backgroundColor: colors.surface2, overflow: 'hidden' },
  poster: { width: '100%', height: '100%' },
  rankBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(12,19,31,0.85)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  rankText: { color: colors.brass, fontSize: 11, fontWeight: '800' },
  posterTitle: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 6 },
  posterSubtitle: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },

  announceCard: { width: 220, backgroundColor: colors.surface2, borderRadius: 12, padding: 14 },
  announceDate: { color: colors.mint, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  announceTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginTop: 6 },
  announceBody: { color: colors.inkDim, fontSize: 12, marginTop: 4, lineHeight: 17 },

  creatorCard: { width: 110, alignItems: 'center' },
  creatorPhotoWrap: { width: 90, height: 90, borderRadius: 45, backgroundColor: colors.surface2, overflow: 'hidden' },
  creatorPhoto: { width: '100%', height: '100%' },
  creatorName: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  creatorCredit: { color: colors.inkFaint, fontSize: 10, marginTop: 2, textAlign: 'center' },

  cassette: { width: 150, height: 70, backgroundColor: colors.surface2, borderRadius: 10, borderWidth: 1, borderColor: colors.oceanInk, justifyContent: 'center', padding: 12 },
  cassetteText: { color: colors.ink, fontSize: 13, fontWeight: '700' },

  flyerCard: { width: 220, backgroundColor: colors.surface2, borderRadius: 12, padding: 14 },
  flyerTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  flyerLogline: { color: colors.inkDim, fontSize: 12, marginTop: 4, lineHeight: 17 },
  flyerBy: { color: colors.inkFaint, fontSize: 11, marginTop: 6 },
  flyerRaised: { color: colors.brass, fontSize: 12, fontWeight: '700', marginTop: 4 },

  membershipCard: { margin: 16, marginTop: 24, backgroundColor: colors.surface2, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: colors.oceanInk },
  membershipEyebrow: { color: colors.brass, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  membershipTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: 8, lineHeight: 22 },
  membershipBody: { color: colors.inkDim, fontSize: 13, marginTop: 6, lineHeight: 19 },
  membershipCta: { color: colors.brass, fontSize: 13, fontWeight: '700', marginTop: 10 }
});
