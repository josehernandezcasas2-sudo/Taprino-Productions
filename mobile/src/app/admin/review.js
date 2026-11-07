import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as WebBrowser from 'expo-web-browser';
import { apiGet, apiPost, freshToken } from '../../lib/api';
import { colors, fonts, oliveTint, surfaceTint } from '../../lib/theme';
import { useCaptureBlock } from '../../lib/captureBlock';
import { KIND_LABEL, approvedFlash, blockedLine, decisionBody, deckItems, deckKind, eyebrowFor, fmtDuration, kickerFor, metaRows, noVideoWords, ownerLine, showOf, slotLine, tierFor } from '../../lib/reviewDeckRules';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';

const SITE_ORIGIN = 'https://www.studiotapatv.site';
const SWIPE_THRESHOLD = 90;
const TONE = { plain: colors.ink, ok: colors.ok, danger: colors.danger, faint: colors.inkFaint };

// Review on the go (2026-10-08): one item at a time as a card. The video
// plays inline, the fields that matter are listed, Approve / Reject
// (with a reason sheet) at the bottom, swipe left to skip to the next.
// Ads need the web (the billing rate), so their cards deep-link there
// instead of approving blind.
// Places (Locations listings) approve here too; the host's proof opens in
// the in-app browser when it's a web address.
// Applications (the creator path, 2026-10-31): a film sent through /apply
// with its master, which plays here as a signed HLS stream. Accept puts it
// live (Free, or Tapa + from the chips) and grants Creator Studio; Hold
// sends one thing to fix; Decline deletes the file.
// A show's episode (the series revamp, slice 5; the website's queue since
// slice 3a): its show's name and how many of its episodes are in review
// over the title, its place and whether the number is free under it, the
// show's card (where it stands, who runs it), and Approve off with the
// reason while its number is taken or missing or its file isn't ready.
// Approving one never makes the show public: its owner does that
// (decision 2), so the old "series" cards (a show ready to go public, sent
// to the website) are gone, and so is ?kind=series.
// ?kind=submission|channel|ad|location|price|application narrows the deck.
// The words and small rules live in lib/reviewDeckRules.js.
export default function AdminReview() {
  const router = useRouter();
  const { kind } = useLocalSearchParams();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(0);
  const [tiers, setTiers] = useState({});
  const [flash, setFlash] = useState(null);

  // A fresh token for every request: one kept from when the queue opened
  // has expired a minute later, and Approve/Reject then failed.
  // A kind the deck doesn't know (an old ?kind=series link) shows
  // everything.
  const only = deckKind(kind);

  // Only the newest read lands: a reload started before a later decision
  // never puts back a card that decision took away.
  const loadSeq = useRef(0);
  async function load({ keepIndex = false } = {}) {
    const seq = ++loadSeq.current;
    try {
      const token = await freshToken(getToken);
      const data = await apiGet('/api/admin/review-queue', token);
      if (seq !== loadSeq.current) return;
      const items = deckItems(data.items, only);
      setState({ loading: false, error: null, items });
      setIndex((i) => (keepIndex ? Math.min(i, Math.max(0, items.length - 1)) : 0));
    } catch (err) {
      if (seq !== loadSeq.current) return;
      // A refresh that fails keeps the deck as it is; only the first
      // read shows the error.
      if (keepIndex) return;
      setState({ loading: false, error: err.message, items: [] });
    }
  }

  useEffect(() => { load(); }, [only]);

  const items = state.items;
  const item = items[index] || null;

  async function decide(decision) {
    if (!item || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await apiPost('/api/admin/review-queue', decisionBody(item, decision, { reason, tiers }), await freshToken(getToken));
      if (item.kind === 'application' && decision === 'approve') {
        Alert.alert(res.mode === 'live' ? 'Live' : 'Accepted', res.mode === 'live' ? `“${item.title}” is live at ${res.episode.href}${res.roleGranted ? ', and Creator Studio is granted' : ''}. They’ve been emailed.` : 'Creator Studio is theirs; they upload the master there. They’ve been emailed.');
      } else if (item.kind === 'submission' && decision === 'approve') {
        setFlash(approvedFlash(item));
      }
      setRejecting(false);
      setHolding(false);
      setReason('');
      setDone((d) => d + 1);
      setState((s) => ({ ...s, items: s.items.filter((i) => !(i.kind === item.kind && i.id === item.id)) }));
      setIndex((i) => Math.min(i, Math.max(0, items.length - 2)));
      // Then the queue as it is now, as the website's does after every
      // decision: the show's count, where it stands and a number another
      // card was blocked on all change with this one.
      load({ keepIndex: true });
    } catch (err) {
      // A refusal (a taken number, a file still processing, the show
      // pulled…): say why and show the queue as it is now.
      Alert.alert('Could not update this', err.message || 'Could not update this.');
      if (err.status === 409) {
        setRejecting(false);
        setHolding(false);
        load({ keepIndex: true });
      }
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
        <Text style={styles.barTitle}>{only ? `${KIND_LABEL[only]}s` : 'Review queue'}</Text>
        <Text style={styles.progress}>{items.length ? `${index + 1} of ${items.length}` : done ? `${done} done` : ''}</Text>
      </View>

      {flash ? <Text style={styles.flash} accessibilityLiveRegion="polite">{flash}</Text> : null}
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
          getToken={getToken}
          busy={busy}
          onApprove={() => decide('approve')}
          onReject={() => setRejecting(true)}
          onHold={() => setHolding(true)}
          tier={tierFor(item, tiers)}
          onTier={(t) => setTiers((m) => ({ ...m, [item.id]: t }))}
          onSkip={skip}
          canSkip={items.length > 1}
          dots={items.slice(0, 8).map((_, i) => i === index)}
        />
      )}

      <Modal visible={rejecting || holding} transparent animationType="fade" onRequestClose={() => { setRejecting(false); setHolding(false); }}>
        <Pressable style={styles.backdrop} onPress={() => { setRejecting(false); setHolding(false); }}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={[styles.eyebrow, holding && { color: colors.olive }]}>{holding ? 'Hold' : item && item.kind === 'application' ? 'Decline' : 'Reject'}</Text>
            <Text style={styles.sheetTitle}>{item ? item.title : ''}</Text>
            <Text style={styles.sheetBody}>{holding ? 'The one thing to fix. They read it, replace the file, and it comes back here.' : 'The reason is shown to whoever submitted it.'}</Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder={holding ? 'What needs fixing?' : 'What needs to change?'}
              placeholderTextColor={colors.inkFaint}
              multiline
              autoFocus
            />
            <View style={styles.acts}>
              <Pressable style={styles.btnSecondary} onPress={() => { setRejecting(false); setHolding(false); }}><Text style={styles.btnSecondaryText}>Cancel</Text></Pressable>
              {holding ? (
                <Pressable style={[styles.btnOk, { flex: 0, paddingHorizontal: 18 }, (!reason.trim() || busy) && { opacity: 0.5 }]} disabled={!reason.trim() || busy} onPress={() => decide('hold')}>
                  {busy ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.btnOkText}>Send the hold</Text>}
                </Pressable>
              ) : (
                <Pressable style={[styles.btnDanger, (!reason.trim() || busy) && { opacity: 0.5 }]} disabled={!reason.trim() || busy} onPress={() => decide('reject')}>
                  {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.btnDangerText}>{item && item.kind === 'application' ? 'Decline' : 'Reject'}</Text>}
                </Pressable>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ReviewCard({ item, getToken, busy, onApprove, onReject, onHold, onSkip, canSkip, dots, tier, onTier }) {
  const { width } = useWindowDimensions();
  const [previewSrc, setPreviewSrc] = useState(item.media.src || null);
  const needsWeb = item.kind === 'ad';
  const isApplication = item.kind === 'application';
  const isSubmission = item.kind === 'submission';
  const meta = item.meta || {};
  const showInfo = showOf(item);
  const eyebrow = eyebrowFor(item);
  const blocked = blockedLine(item);
  const slot = slotLine(item);

  // Channel uploads need a signed URL from the server.
  useEffect(() => {
    if (item.kind !== 'channel' || !item.media.previewId) return undefined;
    let cancelled = false;
    freshToken(getToken)
      .then((t) => apiGet(`/api/admin/channel-media?preview=${encodeURIComponent(item.media.previewId)}`, t))
      .then((d) => { if (!cancelled && d.src) setPreviewSrc(d.src); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.id]);

  const player = useVideoPlayer(previewSrc || null, (p) => { p.loop = false; });
  // Unreleased work plays here: no screenshots or recordings, like every
  // other player in the app (2026-10-28).
  useCaptureBlock(Boolean(previewSrc));

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

  const rows = metaRows(meta);
  // Why nothing plays (the website's words for an episode).
  const noVideo = noVideoWords(item);
  const kicker = kickerFor(item);

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[styles.cardWrap, { transform: [{ translateX: x }, { rotate: x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-6deg', '0deg', '6deg'] }) }] }]} {...pan.panHandlers}>
        <ScrollView style={styles.card} contentContainerStyle={{ paddingBottom: 16 }} bounces={false}>
          <View style={styles.media}>
            {previewSrc ? (
              <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
            ) : item.media.poster ? (
              <View>
                <SmartImage uri={item.media.poster} style={styles.video} resizeMode="cover" />
                {isSubmission && noVideo ? <View style={styles.videoNote}><Text style={styles.videoNoteText}>{noVideo}</Text></View> : null}
              </View>
            ) : (
              <View style={[styles.video, styles.videoEmpty]}><Text style={styles.videoEmptyText}>{noVideo || 'No video'}</Text></View>
            )}
            <View style={styles.kindChip}>
              <Text style={[styles.kindChipText, { color: TONE[eyebrow.tone] || colors.ink }]}>{eyebrow.text}{meta.durationSeconds ? ` · ${fmtDuration(meta.durationSeconds)}` : ''}</Text>
            </View>
          </View>
          <View style={styles.body}>
            {kicker ? <Text style={styles.kicker} numberOfLines={2}>{kicker}</Text> : null}
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.sub}>{item.subtitle}{item.createdAt ? ` · ${timeAgo(item.createdAt)}` : ''}</Text>
            {slot ? <Text style={[styles.slot, { color: slot.free ? colors.ok : colors.olive }]}>{slot.words}</Text> : null}
            {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
            {showInfo ? <ShowBlock show={showInfo} eyebrow={eyebrow} sameDescription={showInfo.description === item.description} /> : null}
            {rows.length > 0 && (
              <View style={styles.kv}>
                {rows.map(([k, label, value]) => (
                  <View key={k} style={styles.kvRow}>
                    <Text style={styles.kvKey}>{label}</Text>
                    {(k === 'proofUrl' || k === 'filesLink') && isWebUrl(meta[k]) ? (
                      <Pressable style={{ flex: 1 }} onPress={() => WebBrowser.openBrowserAsync(String(meta[k])).catch(() => {})} accessibilityRole="link">
                        <Text style={[styles.kvVal, styles.kvLink]}>{k === 'filesLink' ? 'Open their link ↗' : 'Open the proof ↗'}</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.kvVal}>{value}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
            {needsWeb ? (
              <Pressable style={styles.btnPrimary} onPress={() => Linking.openURL(`${SITE_ORIGIN}/admin/review`)}>
                <Text style={styles.btnPrimaryText}>Set the rate on the web ↗</Text>
              </Pressable>
            ) : (
              <>
                {isApplication || isSubmission ? (
                  <View style={styles.tierRow}>
                    <Text style={styles.kvKey}>Who can watch</Text>
                    {[['free', 'Free with ads'], ['premium', 'Tapa + members']].map(([v, label]) => (
                      <Pressable key={v} style={[styles.tierChip, tier === v && styles.tierChipOn]} onPress={() => onTier(v)} accessibilityRole="radio" accessibilityState={{ checked: tier === v }}><Text style={[styles.tierChipText, tier === v && { color: colors.olive }]}>{label}</Text></Pressable>
                    ))}
                  </View>
                ) : null}
                <View style={styles.decide}>
                  <Pressable style={[styles.btnDanger, busy && { opacity: 0.5 }]} disabled={busy} onPress={onReject}><Text style={styles.btnDangerText}>{isApplication ? 'Decline…' : 'Reject…'}</Text></Pressable>
                  {isApplication ? <Pressable style={[styles.btnHold, busy && { opacity: 0.5 }]} disabled={busy} onPress={onHold}><Text style={styles.btnHoldText}>Hold…</Text></Pressable> : null}
                  <Pressable style={[styles.btnOk, (busy || blocked) && { opacity: 0.5 }]} disabled={busy || Boolean(blocked)} onPress={onApprove} accessibilityState={{ disabled: busy || Boolean(blocked) }} accessibilityHint={blocked || undefined}>
                    {busy ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.btnOkText}>{isApplication ? (meta.masterReady ? 'Accept · live' : 'Accept') : 'Approve'}</Text>}
                  </Pressable>
                </View>
                {blocked ? <Text style={styles.blocked}>{blocked}</Text> : null}
              </>
            )}
          </View>
        </ScrollView>
      </Animated.View>
      <View style={styles.dots}>{dots.map((on, i) => <View key={i} style={[styles.dot, on && styles.dotOn]} />)}</View>
      <Text style={styles.hint}>{canSkip ? 'Swipe left to skip for now' : ' '}</Text>
    </View>
  );
}

// The episode's show, as the website's .rq-show card: where it stands, its
// name and kind, who runs it and how old their account is, its defaults,
// how many more of its episodes wait, who makes it public, and its admin
// page on the website.
function ShowBlock({ show, eyebrow, sameDescription }) {
  const kindWord = show.kind === 'podcast' ? 'Podcast' : show.kind === 'vertical' ? 'Vertical' : 'Series';
  const waiting = Number(show.waitingCount) || 0;
  return (
    <View style={styles.show}>
      {show.poster ? <SmartImage uri={show.poster} style={styles.showPoster} resizeMode="cover" /> : <View style={styles.showPoster} />}
      <View style={styles.showBody}>
        <Text style={[styles.showEyebrow, { color: TONE[eyebrow.tone] || colors.ink }]}>{eyebrow.text}</Text>
        <Text style={styles.showName}>{show.name || 'A show'} <Text style={styles.showKind}>{kindWord}</Text></Text>
        <Text style={styles.showLine}>{ownerLine(show)}</Text>
        {show.description && !sameDescription ? <Text style={styles.showDesc} numberOfLines={4}>{show.description}</Text> : null}
        {show.defaultsLine ? <Text style={styles.showLine}>{show.defaultsLine}</Text> : null}
        {waiting > 0 ? <Text style={styles.showLine}>{waiting} more episode{waiting === 1 ? '' : 's'} waiting</Text> : null}
        {show.makesPublic ? <Text style={[styles.showLine, { color: colors.olive }]}>{show.makesPublic}</Text> : null}
        {show.href ? (
          <Pressable onPress={() => Linking.openURL(`${SITE_ORIGIN}${show.href}`)} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.showLink}>Open show page ↗</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// Only a real web address becomes a link (the proof field can also read
// "no proof attached").
function isWebUrl(v) {
  return /^https?:\/\//i.test(String(v || ''));
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
  kindChip: { position: 'absolute', left: 10, top: 10, backgroundColor: surfaceTint(0.8), borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  kindChipText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink },
  body: { padding: 14, gap: 8 },
  title: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink },
  sub: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.brass },
  slot: { fontFamily: fonts.mono, fontSize: 12 },
  blocked: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.danger, marginTop: 2 },
  flash: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ok, marginHorizontal: 16, marginBottom: 8 },
  videoNote: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: surfaceTint(0.82), paddingVertical: 6, paddingHorizontal: 10 },
  videoNoteText: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.ink },
  show: { flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 10, backgroundColor: colors.surface2 },
  showPoster: { width: 56, height: 84, borderRadius: 6, backgroundColor: colors.surface3 },
  showBody: { flex: 1, gap: 3 },
  showEyebrow: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.ink },
  showName: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  showKind: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint },
  showLine: { fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 16, color: colors.inkDim },
  showDesc: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  showLink: { fontFamily: fonts.mono, fontSize: 12, color: colors.brass, textDecorationLine: 'underline', marginTop: 4 },
  desc: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkDim },
  kv: { borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 10, gap: 5 },
  kvRow: { flexDirection: 'row', gap: 10 },
  kvKey: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint, width: 90 },
  kvVal: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink, flex: 1 },
  kvLink: { color: colors.brass, textDecorationLine: 'underline' },
  decide: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tierRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  tierChip: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.hairline },
  tierChipOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.16) },
  tierChipText: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  btnHold: { flex: 1, borderWidth: 1, borderColor: colors.olive, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  btnHoldText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.olive },
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
