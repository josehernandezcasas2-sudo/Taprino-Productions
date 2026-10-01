import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts } from '../lib/theme';
import { formatRuntimeLong, parseRuntimeToSeconds } from '../lib/runtime';
import SmartImage from './SmartImage';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus' };
const TYPE_LINE_COLOR = { series: colors.brass, movie: colors.mint, short: colors.sky, vertical: colors.rust, podcast: colors.olive, bonus: colors.inkFaint };

// Mirrors components/GenreRow.js's tierBadge classes: free-ads = olive-deep
// pill, free-noads = green, premium = brass.
function cardBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', bg: colors.brass, fg: '#241a05' };
  if (adsEnabled === false) return { label: 'Free', bg: colors.ok, fg: '#14261a' };
  return { label: 'Free with ads', bg: colors.oliveDeep, fg: colors.ink };
}

function PlayGlyph({ size = 11 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="rgba(251,232,211,0.5)">
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

function RowHeading({ title, onSeeAll }) {
  return (
    <View style={styles.rowHeadingRow}>
      <Text style={styles.rowHeading}>{title}</Text>
      {onSeeAll ? <Pressable onPress={onSeeAll} hitSlop={8}><Text style={styles.seeAll}>See all</Text></Pressable> : null}
    </View>
  );
}

// components/GenreRow.js: a 190px-wide 2:3 poster card with the tier badge
// top-left, a bottom scrim, and the title + "runtime · type" laid over the
// artwork itself. `cards` are the consolidated cards from
// lib/libraryCards.js (one per series, one per standalone title).
export function CardRow({ title, cards, onPressCard, onSeeAll }) {
  if (!cards || cards.length === 0) return null;
  return (
    <View style={styles.catRow}>
      <RowHeading title={title} onSeeAll={onSeeAll} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackContent}>
        {cards.map((card) => {
          const badge = cardBadge(card.tier, card.adsEnabled);
          const isSeries = card.type === 'series';
          const typeKey = isSeries ? 'series' : card.contentType;
          const typeLabel = isSeries ? '▤ Series' : (CONTENT_TYPE_LABEL[card.contentType] || 'Short');
          const first = isSeries ? `${card.episodeCount} episode${card.episodeCount === 1 ? '' : 's'}` : (formatRuntimeLong(card.runtime) || card.runtime || '');
          return (
            <Pressable key={card.id} style={styles.card} onPress={() => onPressCard(card)}>
              <View style={styles.thumb}>
                {card.thumbnail ? <SmartImage uri={card.thumbnail} style={StyleSheet.absoluteFillObject} /> : (
                  <Text style={styles.thumbFallback}>{card.tier === 'premium' ? 'locked' : isSeries ? '▤ series' : '▶ preview'}</Text>
                )}
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']} style={styles.scrim} pointerEvents="none" />
                {card.hasNew ? <View style={styles.newBanner}><Text style={styles.newBannerText}>New episode</Text></View> : null}
                <View style={[styles.badge, { backgroundColor: badge.bg, top: card.hasNew ? 27 : 8 }]}>
                  <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  <Text style={styles.cardMeta}>
                    {first}{first ? ' · ' : ''}<Text style={{ color: TYPE_LINE_COLOR[typeKey] || colors.inkDim }}>{typeLabel}</Text>
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// components/ContinueWatchingRow.js — same card shell, but one card per
// in-progress episode (never consolidated into a series card), with the
// artist line and a 4px resume-progress bar along the bottom edge.
export function ContinueWatchingRow({ items, onPressItem }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={styles.catRow}>
      <RowHeading title="Continue Watching" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackContent}>
        {items.slice(0, 15).map((ep) => {
          const total = parseRuntimeToSeconds(ep.runtime);
          const pct = total ? Math.min(100, Math.round((ep.resumeSeconds / total) * 100)) : null;
          return (
            <Pressable key={ep.id} style={styles.card} onPress={() => onPressItem(ep)}>
              <View style={styles.thumb}>
                {ep.thumbnail ? <SmartImage uri={ep.thumbnail} style={StyleSheet.absoluteFillObject} /> : (
                  <View style={styles.resumeFallback}><PlayGlyph /><Text style={styles.thumbFallback}> Resume</Text></View>
                )}
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']} style={styles.scrim} pointerEvents="none" />
                <View style={styles.info}>
                  <Text style={styles.cardTitle}>{ep.title}</Text>
                  {ep.artist ? <Text style={styles.cardMeta}>{ep.artist}</Text> : null}
                </View>
                {pct !== null ? (
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const CARD_W = 190;

const styles = StyleSheet.create({
  // .cat-row / .cat-row-heading / .cat-row-track
  catRow: { marginBottom: 29 },
  rowHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  rowHeading: { fontFamily: fonts.mono, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase', color: colors.inkDim },
  seeAll: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.brass },
  trackContent: { flexDirection: 'row', gap: 22, paddingTop: 32, paddingBottom: 58, paddingHorizontal: 5 },

  // .ep-card / .ep-thumb / .ep-info
  card: { width: CARD_W, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(251,232,211,0.08)', backgroundColor: colors.surface1, overflow: 'hidden' },
  thumb: { width: '100%', aspectRatio: 2 / 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.surface1 },
  thumbFallback: { fontFamily: fonts.mono, fontSize: 9.6, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(251,232,211,0.5)' },
  resumeFallback: { flexDirection: 'row', alignItems: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  badge: { position: 'absolute', left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontFamily: fonts.mono, fontSize: 8.8, letterSpacing: 0.7, textTransform: 'uppercase' },
  newBanner: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.sky, paddingVertical: 5 },
  newBannerText: { color: colors.surface0, fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center' },
  info: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, paddingHorizontal: 11, paddingBottom: 11 },
  cardTitle: { fontFamily: fonts.displaySemi, fontSize: 13.6, lineHeight: 17, color: colors.ink, textTransform: 'uppercase', marginBottom: 3 },
  cardMeta: { fontFamily: fonts.mono, fontSize: 9.6, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkDim },

  // .cw-progress-track / .cw-progress-fill
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.5)' },
  progressFill: { height: '100%', backgroundColor: colors.olive }
});
