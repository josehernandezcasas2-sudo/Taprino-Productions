import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors, fonts, absoluteFill } from '../lib/theme';
import TopNav from '../components/TopNav';
import SmartImage from '../components/SmartImage';

const PAPER_INK = '#241a05';
const PAPER_MUTED = '#6b6248';
const CASSETTE_COLORS = [colors.mint, colors.sky, colors.rust, colors.brass];

// Mirrors pages/index.js — the "zine" homepage — using the same data
// (lib/homeFeed.js via GET /api/home-feed) and the .zine-* styles from
// styles/globals.css at its ≤640px breakpoint: rotated stickers, the
// bordered hero art, the film-strip panel, polaroids, cream briefs/flyers,
// cassettes and the classifieds box. The one place this deviates: the
// website's "See all →" buttons and classified box sit flush against the
// screen edge (the .zine-dept wrapper has no horizontal padding), which
// looks like a CSS slip rather than a design choice, so they get the same
// 17.6px gutter as everything else here.
export default function Home() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [isSubscriber, setIsSubscriber] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/home-feed')
      .then((feed) => { if (!cancelled) setState({ loading: false, error: null, feed }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, feed: null }); });
    return () => { cancelled = true; };
  }, []);

  // The public home feed carries no per-viewer data, so (like the website,
  // which hides the Membership classified from subscribers) ask the account
  // endpoint — best effort and non-blocking; signed-out or slow just means
  // the classified stays visible.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      if (!token) return;
      const info = await apiGet('/api/account/dashboard-info', token).catch(() => null);
      if (!cancelled && info && info.isSubscriber) setIsSubscriber(true);
    })();
    return () => { cancelled = true; };
  }, []);

  function openAnnouncement(url) {
    if (/^https?:\/\//i.test(url)) Linking.openURL(url); else router.push(url);
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
        <View style={styles.center}><Text style={styles.error}>Couldn't load the homepage: {state.error}</Text></View>
      </SafeAreaView>
    );
  }

  const {
    heroItem, trending, announcements, featuredCreators,
    filmsAndShorts, seriesRows, podcasts, pitches, liveStream
  } = state.feed;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        <View style={styles.masthead}>
          <View style={styles.mastheadRow}>
            <View style={{ transform: [{ rotate: '-2deg' }] }}><Text style={styles.mastheadTitle}>Studio Tapa TV</Text></View>
            <View style={styles.mastheadTag}><Text style={styles.mastheadTagText}>SCREENING ROOM EDITION</Text></View>
          </View>
        </View>

        {liveStream && (
          <View style={[styles.hero, { paddingBottom: 0 }]}>
            <View style={styles.liveFlash}>
              <View style={styles.liveDot} />
              <Text style={styles.liveLabel}>Special bulletin — live now</Text>
              <Text style={styles.liveTitle}>{liveStream.title}</Text>
            </View>
          </View>
        )}

        {heroItem && (
          <View style={styles.hero}>
            <View style={styles.heroArtWrap}>
              <View style={styles.heroArt}>
                {(heroItem.poster || heroItem.heroImage) ? (
                  <SmartImage uri={heroItem.poster || heroItem.heroImage} style={absoluteFill} />
                ) : null}
              </View>
              <View style={styles.heroArtTag}><Text style={styles.heroArtTagText}>NOW STREAMING</Text></View>
            </View>
            <View style={styles.heroText}>
              <View style={{ transform: [{ rotate: '1deg' }] }}><Text style={styles.heroTitle}>{heroItem.title}</Text></View>
              {heroItem.desc ? <Text style={styles.heroDesc}>{heroItem.desc}</Text> : null}
              <Pressable onPress={() => router.push(`/episode/${heroItem.id}`)} style={{ alignSelf: 'flex-start' }}>
                <Sticker color={colors.brass} underline>{'▶ WATCH'}</Sticker>
              </Pressable>
            </View>
          </View>
        )}

        {trending.length > 0 && (
          <Dept label="TRENDING NOW" color={colors.brass}>
            <Filmstrip
              items={trending}
              showRank
              meta={(item) => item.tag}
              onPressItem={(item) => router.push(item.isSeries ? `/series/${item.id}` : `/episode/${item.id}`)}
            />
          </Dept>
        )}

        {announcements.length > 0 && (
          <Dept label="ANNOUNCEMENTS" color={colors.mint}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.briefRow}>
              {announcements.map((a, i) => {
                const n = i + 1;
                const rotate = n === 2 ? '1deg' : n % 3 === 0 ? '-0.5deg' : '-1deg';
                const Wrapper = a.linkUrl ? Pressable : View;
                return (
                  <Wrapper key={a.id} style={[styles.briefCard, { transform: [{ rotate }] }]} onPress={a.linkUrl ? () => openAnnouncement(a.linkUrl) : undefined}>
                    <Text style={styles.briefDate}>
                      {new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()}
                    </Text>
                    <Text style={styles.briefTitle}>{a.title}</Text>
                    {a.body ? <Text style={styles.briefBody}>{a.body}</Text> : null}
                  </Wrapper>
                );
              })}
            </ScrollView>
          </Dept>
        )}

        {featuredCreators.length > 0 && (
          <Dept label="THE FACES BEHIND IT" color={colors.sky}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
              {featuredCreators.map((c, i) => {
                const n = i + 1;
                let rotate = '2deg';
                let marginTop = 0;
                if (n % 2 === 0) { rotate = '-3deg'; marginTop = 12.8; }
                if (n % 3 === 0) rotate = '1.5deg';
                if (n % 4 === 0) { rotate = '-1deg'; marginTop = 8; }
                return (
                  <Pressable key={c.userId} style={[styles.polaroid, { marginTop, transform: [{ rotate }] }]} onPress={() => router.push(`/profile/${c.userId}`)}>
                    <View style={styles.polaroidPhoto}>
                      {c.avatarUrl ? <SmartImage uri={c.avatarUrl} style={absoluteFill} /> : null}
                    </View>
                    <Text style={styles.polaroidName}>{c.displayName}</Text>
                    <Text style={styles.polaroidCredit}>{c.credits.slice(0, 2).join(', ')}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Dept>
        )}

        {filmsAndShorts.length > 0 && (
          <Dept label="FILMS & SHORTS" color={colors.rust} labelTextColor={colors.ink}>
            <Filmstrip
              items={filmsAndShorts}
              meta={(item) => `${item.contentType === 'movie' ? 'FILM' : 'SHORT'}${item.runtime ? ` · ${item.runtime}` : ''}`}
              onPressItem={(item) => router.push(`/episode/${item.id}`)}
            />
            <SeeAll label="See the full library →" onPress={() => router.push('/watch/movies')} />
          </Dept>
        )}

        {seriesRows.length > 0 && (
          <Dept label="SERIES" color={colors.sky}>
            <Filmstrip
              items={seriesRows}
              meta={(item) => `${item.count} episode${item.count === 1 ? '' : 's'}`}
              onPressItem={(item) => router.push(`/series/${item.id}`)}
            />
            <SeeAll label="See all series →" onPress={() => router.push('/watch/series')} />
          </Dept>
        )}

        {podcasts.length > 0 && (
          <Dept label="ON AIR" color={colors.brass}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cassetteRow}>
              {podcasts.map((p, i) => (
                <Pressable key={p.id} style={[styles.cassette, { backgroundColor: CASSETTE_COLORS[i % CASSETTE_COLORS.length] }]} onPress={() => router.push(`/podcasts/${p.seriesId}`)}>
                  <View style={styles.cassetteLabel}><Text style={styles.cassetteLabelText}>{p.title}</Text></View>
                </Pressable>
              ))}
            </ScrollView>
            <SeeAll label="See all podcasts →" onPress={() => router.push('/watch/podcasts')} />
          </Dept>
        )}

        {pitches.length > 0 && (
          <Dept label="PITCH ROOM" color={colors.mint}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flyerRow}>
              {pitches.map((p, i) => {
                const n = i + 1;
                const rotate = n === 2 ? '-1.5deg' : n % 3 === 0 ? '0.5deg' : '1deg';
                return (
                  <Pressable key={p.id} style={[styles.flyer, { transform: [{ rotate }] }]} onPress={() => router.push(`/pitches/${p.id}`)}>
                    <Text style={styles.flyerTitle}>{p.title}</Text>
                    {p.logline ? <Text style={styles.flyerLogline}>{p.logline}</Text> : null}
                    {p.creatorName ? (
                      p.creatorUserId
                        ? <Text style={styles.flyerBy} onPress={() => router.push(`/profile/${p.creatorUserId}`)}>by {p.creatorName}</Text>
                        : <Text style={styles.flyerBy}>by {p.creatorName}</Text>
                    ) : null}
                    {p.fundingRaised != null ? <Text style={styles.flyerRaised}>${Number(p.fundingRaised).toLocaleString()} raised</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <SeeAll label="See all projects →" onPress={() => router.push('/pitches')} />
          </Dept>
        )}

        {!isSubscriber && (
          <View style={styles.dept}>
            <Pressable style={styles.classified} onPress={() => router.push('/account')}>
              <Text style={styles.classifiedEyebrow}>Classifieds — Membership</Text>
              <Text style={styles.classifiedTitle}>WANTED: ad-free viewers to back the creators directly.</Text>
              <Text style={styles.classifiedBody}>Early episodes, gated series, and a direct line to what you fund. Inquire within.</Text>
              <Text style={styles.classifiedCta}>Join Tapa + {'→'}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// .zine-sticker
function Sticker({ color, labelColor = PAPER_INK, underline, children }) {
  return (
    <View style={[styles.sticker, { backgroundColor: color }]}>
      <Text style={[styles.stickerText, { color: labelColor }, underline && { textDecorationLine: 'underline' }]}>{children}</Text>
    </View>
  );
}

// .zine-dept + .zine-dept-label
function Dept({ label, color, labelTextColor, children }) {
  return (
    <View style={styles.dept}>
      <View style={styles.deptLabel}><Sticker color={color} labelColor={labelTextColor}>{label}</Sticker></View>
      {children}
    </View>
  );
}

// .account-btn-secondary, auto width
function SeeAll({ label, onPress }) {
  return (
    <View style={styles.seeAllWrap}>
      <Pressable style={styles.seeAll} onPress={onPress}><Text style={styles.seeAllText}>{label}</Text></Pressable>
    </View>
  );
}

// .zine-filmstrip: a slightly rotated surface-1 panel of 150px 2:3 posters.
function Filmstrip({ items, meta, showRank, onPressItem }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filmstrip} contentContainerStyle={styles.filmstripContent}>
      {items.map((item, i) => (
        <Pressable key={`${item.isSeries ? 's' : 'e'}-${item.id}`} style={styles.filmItem} onPress={() => onPressItem(item)}>
          <View style={styles.filmPoster}>
            {item.poster ? <SmartImage uri={item.poster} style={absoluteFill} /> : null}
            {showRank ? <View style={styles.rankBadge}><Text style={styles.rankText}>#{i + 1}</Text></View> : null}
          </View>
          <Text style={styles.filmTitle}>{item.title}</Text>
          <Text style={styles.filmMeta}>{meta(item)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const GUTTER = 17.6;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center', fontFamily: fonts.display },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },

  // .zine-masthead
  masthead: { paddingTop: 19, paddingHorizontal: GUTTER, paddingBottom: 11 },
  mastheadRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 8 },
  mastheadTitle: { fontFamily: fonts.body, fontSize: 27, color: colors.ink },
  mastheadTag: { backgroundColor: colors.brass, paddingHorizontal: 9.6, paddingVertical: 4, marginLeft: 11, borderRadius: 2, transform: [{ rotate: '3deg' }] },
  mastheadTagText: { fontFamily: fonts.mono, fontSize: 9.9, color: PAPER_INK },

  // .zine-sticker
  sticker: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, transform: [{ rotate: '-2deg' }] },
  stickerText: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 0.3 },

  // .zine-live-flash
  liveFlash: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 9, backgroundColor: colors.rust, paddingVertical: 14, paddingHorizontal: 19, borderRadius: 3, transform: [{ rotate: '-0.6deg' }], shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink },
  liveLabel: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ink, opacity: 0.85 },
  liveTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, flex: 1, minWidth: 120 },

  // .zine-hero (≤640px)
  hero: { paddingTop: 5, paddingHorizontal: GUTTER, paddingBottom: 19 },
  heroArtWrap: { alignSelf: 'stretch', marginTop: 13 },
  heroArt: { width: '100%', height: 200, borderWidth: 6, borderColor: colors.ink, backgroundColor: colors.surface2, overflow: 'hidden', transform: [{ rotate: '-3deg' }] },
  heroArtTag: { position: 'absolute', top: -13, left: 17.6, backgroundColor: colors.rust, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 2, transform: [{ rotate: '-6deg' }] },
  heroArtTagText: { fontFamily: fonts.mono, fontSize: 9.9, color: colors.ink },
  heroText: { paddingTop: 22, alignItems: 'flex-start' },
  heroTitle: { fontFamily: fonts.bodyBold, fontSize: 30.4, lineHeight: 34, color: colors.ink, marginBottom: 10 },
  heroDesc: { fontFamily: fonts.body, fontSize: 14.4, lineHeight: 23, color: colors.inkDim, marginBottom: 14 },

  // .zine-dept
  dept: { paddingVertical: 17.6 },
  deptLabel: { paddingHorizontal: GUTTER, marginBottom: 17.6 },
  seeAllWrap: { paddingHorizontal: GUTTER, marginTop: 16, alignItems: 'flex-start' },
  seeAll: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, padding: 11 },
  seeAllText: { fontFamily: fonts.display, fontSize: 13.6, color: colors.ink },

  // .zine-filmstrip
  filmstrip: { backgroundColor: colors.surface1, transform: [{ rotate: '-0.4deg' }], flexGrow: 0 },
  filmstripContent: { padding: 16, gap: 14.4 },
  filmItem: { width: 150 },
  filmPoster: { width: '100%', aspectRatio: 2 / 3, backgroundColor: colors.surface2, marginBottom: 9.6, borderWidth: 3, borderColor: colors.surface0, overflow: 'hidden' },
  filmTitle: { fontFamily: fonts.bodyBold, fontSize: 13.6, color: colors.ink, marginBottom: 2.4 },
  filmMeta: { fontFamily: fonts.mono, fontSize: 9.9, color: colors.inkDim },
  rankBadge: { position: 'absolute', top: 6.4, left: 6.4, backgroundColor: colors.brass, paddingHorizontal: 7, paddingVertical: 2.4, borderRadius: 3, zIndex: 1 },
  rankText: { fontFamily: fonts.monoBold, fontSize: 11.2, color: PAPER_INK },

  // .zine-brief-*
  briefRow: { flexDirection: 'row', gap: 17.6, paddingTop: 8, paddingBottom: 9.6, paddingHorizontal: GUTTER },
  briefCard: { width: 260, backgroundColor: colors.ink, paddingVertical: 14.4, paddingHorizontal: 17.6, borderRadius: 2 },
  briefDate: { fontFamily: fonts.mono, fontSize: 9.6, color: colors.rust, marginBottom: 5.6 },
  briefTitle: { fontFamily: fonts.bodyBold, fontSize: 14.7, color: PAPER_INK, marginBottom: 5.6 },
  briefBody: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16.7, color: PAPER_INK, opacity: 0.75 },

  // .zine-polaroid
  peopleRow: { flexDirection: 'row', gap: 22.4, paddingTop: 9.6, paddingBottom: 11, paddingHorizontal: GUTTER },
  polaroid: { width: 140, backgroundColor: colors.ink, paddingTop: 9.6, paddingHorizontal: 9.6, paddingBottom: 22.4 },
  polaroidPhoto: { width: '100%', height: 110, backgroundColor: colors.surface2, marginBottom: 9.6, overflow: 'hidden' },
  polaroidName: { fontFamily: fonts.displayBold, fontSize: 13, color: PAPER_INK, marginBottom: 2.4 },
  polaroidCredit: { fontFamily: fonts.body, fontSize: 9.9, color: PAPER_MUTED, fontStyle: 'italic', marginTop: 4 },

  // .zine-cassette
  cassetteRow: { flexDirection: 'row', gap: 16, paddingTop: 4.8, paddingBottom: 6.4, paddingHorizontal: GUTTER },
  cassette: { width: 190, height: 90, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  cassetteLabel: { backgroundColor: colors.ink, paddingVertical: 6.4, paddingHorizontal: 11, borderRadius: 2, transform: [{ rotate: '-2deg' }], maxWidth: 170 },
  cassetteLabelText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: PAPER_INK },

  // .zine-flyer
  flyerRow: { flexDirection: 'row', gap: 19.2, paddingTop: 8, paddingBottom: 9.6, paddingHorizontal: GUTTER },
  flyer: { width: 250, backgroundColor: colors.ink, padding: 17.6, borderRadius: 2 },
  flyerTitle: { fontFamily: fonts.bodyBold, fontSize: 16.8, color: PAPER_INK, marginBottom: 6.4 },
  flyerLogline: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 17, color: PAPER_INK, opacity: 0.75, marginBottom: 9.6 },
  flyerBy: { fontFamily: fonts.body, fontSize: 10.6, fontStyle: 'italic', color: PAPER_MUTED, marginBottom: 8, alignSelf: 'flex-start' },
  flyerRaised: { fontFamily: fonts.monoBold, fontSize: 11.2, color: colors.rust },

  // .zine-classified
  classified: { marginHorizontal: GUTTER, maxWidth: 420, backgroundColor: colors.ink, paddingVertical: 17.6, paddingHorizontal: 20.8, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(36,26,5,0.35)', borderRadius: 2, transform: [{ rotate: '0.7deg' }] },
  classifiedEyebrow: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.rust, marginBottom: 8 },
  classifiedTitle: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 21, color: PAPER_INK, marginBottom: 8 },
  classifiedBody: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19, color: PAPER_INK, opacity: 0.8, marginBottom: 11 },
  classifiedCta: { fontFamily: fonts.monoBold, fontSize: 12.2, color: PAPER_INK }
});
