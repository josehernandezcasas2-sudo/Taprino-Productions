import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiGet } from '../lib/api';

// Mirrors pages/index.js section for section, fed by the same ranking
// rules (lib/homeFeed.js) via the public GET /api/home-feed route — no
// separate "mobile version" of what belongs on the homepage.
export default function Home() {
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
        <ActivityIndicator color="#e8b923" />
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
      <ScrollView contentContainerStyle={styles.scroll}>
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
            <View style={styles.watchBtn}>
              <Text style={styles.watchBtnText}>▶ WATCH</Text>
            </View>
          </View>
        )}

        {trending.length > 0 && (
          <Section label="TRENDING NOW" color="#e8b923">
            <PosterRow
              items={trending.map((t, i) => ({ ...t, rank: i + 1 }))}
              subtitle={(item) => item.tag}
              showRank
            />
          </Section>
        )}

        {announcements.length > 0 && (
          <Section label="ANNOUNCEMENTS" color="#8fd1b0">
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
          <Section label="THE FACES BEHIND IT" color="#8fbfe0">
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
          <Section label="FILMS & SHORTS" color="#d98a63">
            <PosterRow
              items={filmsAndShorts}
              subtitle={(item) => `${item.contentType === 'movie' ? 'FILM' : 'SHORT'}${item.runtime ? ` · ${item.runtime}` : ''}`}
            />
          </Section>
        )}

        {seriesRows.length > 0 && (
          <Section label="SERIES" color="#8fbfe0">
            <PosterRow
              items={seriesRows}
              subtitle={(item) => `${item.count} episode${item.count === 1 ? '' : 's'}`}
            />
          </Section>
        )}

        {podcasts.length > 0 && (
          <Section label="ON AIR" color="#e8b923">
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
          <Section label="PITCH ROOM" color="#8fd1b0">
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

function PosterRow({ items, subtitle, showRank }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowContent}>
      {items.map((item) => (
        <View key={item.id} style={styles.posterItem}>
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
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#161005' },
  center: { flex: 1, backgroundColor: '#161005', alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#e2745a', fontSize: 15, textAlign: 'center' },
  scroll: { paddingBottom: 32 },

  masthead: { padding: 16, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: '#2a2213' },
  mastheadTitle: { color: '#f5e9d3', fontSize: 22, fontWeight: '800' },
  mastheadTag: { color: '#8a7f6a', fontSize: 11, fontWeight: '600', letterSpacing: 1, marginTop: 2 },

  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#2a1414', margin: 16, marginBottom: 0, padding: 12, borderRadius: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e2745a' },
  liveLabel: { color: '#e2a08f', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  liveTitle: { color: '#f5e9d3', fontSize: 14, fontWeight: '600', marginTop: 2 },

  hero: { padding: 16 },
  heroImage: { width: '100%', height: 220, borderRadius: 16, backgroundColor: '#221c11' },
  heroTagPill: { position: 'absolute', top: 24, left: 24, backgroundColor: '#e8b923', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  heroTagText: { color: '#161005', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  heroTitle: { color: '#f5e9d3', fontSize: 22, fontWeight: '800', marginTop: 12 },
  heroDesc: { color: '#b8ab8f', fontSize: 14, marginTop: 4, lineHeight: 20 },
  watchBtn: { backgroundColor: '#e8b923', alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, marginTop: 12 },
  watchBtnText: { color: '#161005', fontWeight: '800', fontSize: 13 },

  section: { marginTop: 20 },
  sectionLabelPill: { alignSelf: 'flex-start', marginLeft: 16, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  sectionLabelText: { color: '#161005', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  rowContent: { paddingHorizontal: 16, gap: 12 },

  posterItem: { width: 130 },
  posterWrap: { width: 130, height: 175, borderRadius: 10, backgroundColor: '#221c11', overflow: 'hidden' },
  poster: { width: '100%', height: '100%' },
  rankBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(22,16,5,0.85)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  rankText: { color: '#e8b923', fontSize: 11, fontWeight: '800' },
  posterTitle: { color: '#f5e9d3', fontSize: 13, fontWeight: '700', marginTop: 6 },
  posterSubtitle: { color: '#8a7f6a', fontSize: 11, marginTop: 1 },

  announceCard: { width: 220, backgroundColor: '#221c11', borderRadius: 12, padding: 14 },
  announceDate: { color: '#8fd1b0', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  announceTitle: { color: '#f5e9d3', fontSize: 15, fontWeight: '700', marginTop: 6 },
  announceBody: { color: '#b8ab8f', fontSize: 12, marginTop: 4, lineHeight: 17 },

  creatorCard: { width: 110, alignItems: 'center' },
  creatorPhotoWrap: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#221c11', overflow: 'hidden' },
  creatorPhoto: { width: '100%', height: '100%' },
  creatorName: { color: '#f5e9d3', fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  creatorCredit: { color: '#8a7f6a', fontSize: 10, marginTop: 2, textAlign: 'center' },

  cassette: { width: 150, height: 70, backgroundColor: '#221c11', borderRadius: 10, borderWidth: 1, borderColor: '#3a3120', justifyContent: 'center', padding: 12 },
  cassetteText: { color: '#f5e9d3', fontSize: 13, fontWeight: '700' },

  flyerCard: { width: 220, backgroundColor: '#221c11', borderRadius: 12, padding: 14 },
  flyerTitle: { color: '#f5e9d3', fontSize: 15, fontWeight: '700' },
  flyerLogline: { color: '#b8ab8f', fontSize: 12, marginTop: 4, lineHeight: 17 },
  flyerBy: { color: '#8a7f6a', fontSize: 11, marginTop: 6 },
  flyerRaised: { color: '#e8b923', fontSize: 12, fontWeight: '700', marginTop: 4 },

  membershipCard: { margin: 16, marginTop: 24, backgroundColor: '#221c11', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#3a3120' },
  membershipEyebrow: { color: '#e8b923', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  membershipTitle: { color: '#f5e9d3', fontSize: 16, fontWeight: '800', marginTop: 8, lineHeight: 22 },
  membershipBody: { color: '#b8ab8f', fontSize: 13, marginTop: 6, lineHeight: 19 },
  membershipCta: { color: '#e8b923', fontSize: 13, fontWeight: '700', marginTop: 10 }
});
