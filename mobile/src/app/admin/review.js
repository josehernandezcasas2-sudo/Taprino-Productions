import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';

const SITE_ORIGIN = 'https://www.studiotapatv.site';
const KIND_LABEL = { submission: 'Episode', ad: 'Ad', series: 'Series', channel: 'Channel upload' };
const SWIPE_THRESHOLD = 90;

// Review on the go (2026-10-08): one item at a time as a card. The video
// plays inline, the fields that matter are listed, Approve / Reject
// (with a reason sheet) at the bottom, swipe left to skip to the next.
// Ads and series need the web (billing rate, artwork), so their cards
// deep-link there instead of approving blind.
// ?kind=submission|channel|ad|series narrows the deck.
export default function AdminReview() {
  const router = useRouter();
  const { kind } = useLocalSearchParams();
  const { getToken } = useAuth();
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(0);

  async function withToken() {
    const t = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
    tokenRef.current = t;
    return t;
  }

  async function load() {
    try {
      const token = await withToken();
      const data = await apiGet('/api/admin/review-queue', token);
      const items = (data.items || []).filter((i) => !kind || i.kind === kind);
      setState({ loading: false, error: null, items });
      setIndex(0);
    } catch (err) {
      setState({ loading: false, error: err.message, items: [] });
    }
  }

  useEffect(() => { load(); }, [kind]);

  const items = state.items;
  const item = items[index] || null;

  async function decide(decision) {
    if (!item || busy) return;
    setBusy(true);
    try {
      await apiPost('/api/admin/review-queue', { kind: item.kind, id: item.id, decision, reason: decision === 'reject' ? reason : undefined, tierOverride: item.kind === 'submission' ? item.meta.tier : undefined }, tokenRef.current);
      setRejecting(false);
      setReason('');
      setDone((d) => d + 1);
      setState((s) => ({ ...s, items: s.items.filter((i) => !(i.kind === item.kind && i.id === item.id)) }));
      setIndex((i) => Math.min(i, Math.max(0, items.length - 2)));
    } catch (err) {
      Alert.alert('Could not update this', err.message);
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (items.length <= 1) return;
    setIndex((i) => (i + 1) % items.length);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <View style={styles.bar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin'))} hitSlop={8}><Text style={styles.back}>‹ Admin</Text></Pressable>
        <Text style={styles.barTitle}>{kind ? `${KIND_LABEL[kind] || 'Review'}s` : 'Review queue'}</Text>
        <Text style={styles.progress}>{items.length ? `${index + 1} of ${items.length}` : done ? `${done} done` : ''}</Text>
      </View>

      {state.loading ? (
        <ActivityIndicator color={colors.brass} style={{ marginTop: 40 }} />
      ) : state.error ? (
        <Text style={styles.error}>Couldn&rsquo;t load the queue: {state.error}</Text>
      ) : !item ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={styles.emptyBody}>{done ? `You cleared ${done} item${done === 1 ? '' : 's'}.` : 'Nothing waiting on review right now.'}</Text>
          <Pressable style={styles.btnSecondary} onPress={() => router.replace('/admin')}><Text style={styles.btnSecondaryText}>Back to admin</Text></Pressable>
        </View>
      ) : (
        <ReviewCard
          key={`${item.kind}-${item.id}`}
          item={item}
          token={tokenRef.current}
          busy={busy}
          onApprove={() => decide('approve')}
          onReject={() => setRejecting(true)}
          onSkip={skip}
          canSkip={items.length > 1}
          dots={items.slice(0, 8).map((_, i) => i === index)}
        />
      )}

      <Modal visible={rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRejecting(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.eyebrow}>Reject</Text>
            <Text style={styles.sheetTitle}>{item ? item.title : ''}</Text>
            <Text style={styles.sheetBody}>The reason is shown to whoever submitted it.</Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="What needs to change?"
              placeholderTextColor={colors.inkFaint}
              multiline
              autoFocus
            />
            <View style={styles.acts}>
              <Pressable style={styles.btnSecondary} onPress={() => setRejecting(false)}><Text style={styles.btnSecondaryText}>Cancel</Text></Pressable>
              <Pressable style={[styles.btnDanger, (!reason.trim() || busy) && { opacity: 0.5 }]} disabled={!reason.trim() || busy} onPress={() => decide('reject')}>
                {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.btnDangerText}>Reject</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ReviewCard({ item, token, busy, onApprove, onReject, onSkip, canSkip, dots }) {
  const { width } = useWindowDimensions();
  const [previewSrc, setPreviewSrc] = useState(item.media.src || null);
  const needsWeb = item.kind === 'ad' || item.kind === 'series';

  // Channel uploads need a signed URL from the server.
  useEffect(() => {
    if (item.kind !== 'channel' || !item.media.previewId) return undefined;
    let cancelled = false;
    apiGet(`/api/admin/channel-media?preview=${encodeURIComponent(item.media.previewId)}`, token)
      .then((d) => { if (!cancelled && d.src) setPreviewSrc(d.src); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.id]);

  const player = useVideoPlayer(previewSrc || null, (p) => { p.loop = false; });

  // Swipe left = skip. Kept simple: translate while dragging, snap back
  // or fly off.
  const x = useRef(new Animated.Value(0)).current;
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => canSkip && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_, g) => x.setValue(g.dx),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -SWIPE_THRESHOLD) {
        Animated.timing(x, { toValue: -width, duration: 180, useNativeDriver: true }).start(() => { x.setValue(0); onSkip(); });
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
      }
    }
  }), [canSkip, width, onSkip]);

  const meta = Object.entries(item.meta || {}).filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object');

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[styles.cardWrap, { transform: [{ translateX: x }, { rotate: x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-6deg', '0deg', '6deg'] }) }] }]} {...pan.panHandlers}>
        <ScrollView style={styles.card} contentContainerStyle={{ paddingBottom: 16 }} bounces={false}>
          <View style={styles.media}>
            {previewSrc ? (
              <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
            ) : item.media.poster ? (
              <SmartImage uri={item.media.poster} style={styles.video} resizeMode="cover" />
            ) : (
              <View style={[styles.video, styles.videoEmpty]}><Text style={styles.videoEmptyText}>{item.kind === 'channel' ? 'Loading preview…' : 'No video'}</Text></View>
            )}
            <View style={styles.kindChip}><Text style={styles.kindChipText}>{KIND_LABEL[item.kind]}{item.meta.durationSeconds ? ` · ${fmtDuration(item.meta.durationSeconds)}` : ''}</Text></View>
          </View>
          <View style={styles.body}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.sub}>{item.subtitle}{item.createdAt ? ` · ${timeAgo(item.createdAt)}` : ''}</Text>
            {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
            {meta.length > 0 && (
              <View style={styles.kv}>
                {meta.map(([k, v]) => (
                  <View key={k} style={styles.kvRow}>
                    <Text style={styles.kvKey}>{labelFor(k)}</Text>
                    <Text style={styles.kvVal}>{fmtValue(k, v)}</Text>
                  </View>
                ))}
              </View>
            )}
            {needsWeb ? (
              <Pressable style={styles.btnPrimary} onPress={() => Linking.openURL(`${SITE_ORIGIN}/admin/review`)}>
                <Text style={styles.btnPrimaryText}>{item.kind === 'ad' ? 'Set the rate on the web ↗' : 'Check artwork on the web ↗'}</Text>
              </Pressable>
            ) : (
              <View style={styles.decide}>
                <Pressable style={[styles.btnDanger, busy && { opacity: 0.5 }]} disabled={busy} onPress={onReject}><Text style={styles.btnDangerText}>Reject…</Text></Pressable>
                <Pressable style={[styles.btnOk, busy && { opacity: 0.5 }]} disabled={busy} onPress={onApprove}>
                  {busy ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.btnOkText}>Approve</Text>}
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </Animated.View>
      <View style={styles.dots}>{dots.map((on, i) => <View key={i} style={[styles.dot, on && styles.dotOn]} />)}</View>
      <Text style={styles.hint}>{canSkip ? 'Swipe left to skip for now' : ' '}</Text>
    </View>
  );
}

function labelFor(k) {
  return { contentType: 'Type', hasCaptions: 'Captions', durationSeconds: 'Duration', budgetTotalCents: 'Budget', clickUrl: 'Click URL', accountContactEmail: 'Advertiser' }[k]
    || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
function fmtValue(k, v) {
  if (k === 'hasCaptions') return v ? 'Yes' : 'No';
  if (k === 'durationSeconds') return fmtDuration(v);
  if (k === 'budgetTotalCents') return `$${(v / 100).toFixed(2)}`;
  return String(v);
}
function fmtDuration(s) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}
function timeAgo(iso) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  back: { fontFamily: fonts.mono, fontSize: 13, color: colors.inkDim },
  barTitle: { flex: 1, fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink, textAlign: 'center' },
  progress: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint, minWidth: 54, textAlign: 'right' },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.danger, margin: 20 },
  empty: { alignItems: 'center', padding: 28, marginTop: 40, gap: 8 },
  emptyTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink },
  emptyBody: { fontFamily: fonts.body, fontSize: 14.5, color: colors.inkDim, textAlign: 'center', marginBottom: 10 },

  cardWrap: { flex: 1, marginHorizontal: 12 },
  card: { flex: 1, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 16, overflow: 'hidden' },
  media: { backgroundColor: '#000' },
  video: { width: '100%', aspectRatio: 16 / 9 },
  videoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  videoEmptyText: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint },
  kindChip: { position: 'absolute', left: 10, top: 10, backgroundColor: 'rgba(12,19,31,0.8)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  kindChipText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink },
  body: { padding: 14, gap: 8 },
  title: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink },
  sub: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint },
  desc: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkDim },
  kv: { borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 10, gap: 5 },
  kvRow: { flexDirection: 'row', gap: 10 },
  kvKey: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint, width: 90 },
  kvVal: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink, flex: 1 },
  decide: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btnOk: { flex: 1, backgroundColor: colors.ok, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  btnOkText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.onBrass },
  btnDanger: { flex: 1, borderWidth: 1, borderColor: colors.danger, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  btnDangerText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.danger },
  btnPrimary: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  btnPrimaryText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.onBrass },
  btnSecondary: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center' },
  btnSecondaryText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.surface3 },
  dotOn: { backgroundColor: colors.brass },
  hint: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, textAlign: 'center', paddingTop: 6, paddingBottom: 110 },

  backdrop: { flex: 1, backgroundColor: 'rgba(5,8,14,0.72)', justifyContent: 'center', padding: 18 },
  sheet: { backgroundColor: colors.surface1, borderRadius: 14, borderWidth: 1, borderColor: colors.oceanInk, padding: 18, gap: 10 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.danger },
  sheetTitle: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.ink },
  sheetBody: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
  input: { backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', borderRadius: 8, padding: 12, minHeight: 80, fontFamily: fonts.body, fontSize: 14.5, color: colors.ink, textAlignVertical: 'top' },
  acts: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }
});
