import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import ReelPlayer from '../../components/ReelPlayer';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import { buildVerticalUnits, expandUnitToSlides, pickNextUnit, unitKey } from '../../lib/verticalFeed';

const SITE_ORIGIN = 'https://studiotapatv.site';

function ShareIconSvg({ size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 15V4" />
      <Path d="M8 8l4-4 4 4" />
      <Path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </Svg>
  );
}
function CheckIconSvg({ size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}
function MenuIconSvg({ size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 7h16M4 12h16M4 17h16" />
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

const REPORT_REASONS = ['Spam', 'Harassment', 'Off-topic', 'Other'];

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Mirrors pages/snippets/discover.js — a reel feed scoped to just what
// people have posted (lib/posts.js, kind:'video'), no catalog episodes
// mixed in. Simpler than Vertical Discover in every way that feature
// isn't: no entitlement filtering, no curated/personal lanes (plain
// pickNextUnit, not the 3-random/1-curated/3-personal picker), no
// end-cards (a post is always a standalone unit). No house-ad slides,
// same reasoning as Vertical Discover (mobile ads are paused).
//
// Deliberately NOT built: the composer (website's CreatePostModal) —
// that's explicitly an admin-only test tool on the website itself (see
// its own top comment, gated behind MobileTabBar's admin-only "+"
// button), not a feature regular users can reach, so a whole mobile
// upload subsystem for it isn't worth building right now.
export default function SnippetsDiscover() {
  const router = useRouter();
  const { post: requestedPostId } = useLocalSearchParams();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const tokenRef = useRef(null);
  const listRef = useRef(null);

  const [feedState, setFeedState] = useState({ loading: true, error: null, feed: null });
  const [deck, setDeck] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [shareCopiedKey, setShareCopiedKey] = useState(null);
  const [menuSlide, setMenuSlide] = useState(null);
  const [menuMode, setMenuMode] = useState('menu');
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const unitsRef = useRef([]);
  const seenKeys = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        tokenRef.current = token;
        const feed = await apiGet('/api/snippets-feed', token);
        if (cancelled) return;
        setFeedState({ loading: false, error: null, feed });

        unitsRef.current = buildVerticalUnits(feed.snippetEpisodes);
        const requested = requestedPostId
          ? unitsRef.current.find((u) => u.episodes[0].postId === requestedPostId)
          : null;
        const first = requested || pickNextUnit(unitsRef.current, seenKeys.current);
        if (!first) return;
        seenKeys.current.add(unitKey(first));
        setDeck(expandUnitToSlides(first));
      } catch (err) {
        if (!cancelled) setFeedState({ loading: false, error: err.message, feed: null });
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function extendDeck() {
    const next = pickNextUnit(unitsRef.current, seenKeys.current);
    if (!next) return;
    seenKeys.current.add(unitKey(next));
    setDeck((d) => [...d, ...expandUnitToSlides(next)]);
  }

  useEffect(() => {
    if (deck.length === 0) return;
    if (activeIndex >= deck.length - 2) extendDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, deck]);

  const onViewableItemsChangedRef = useRef(({ viewableItems }) => {
    const visible = viewableItems.find((v) => v.isViewable);
    if (visible) setActiveIndex(visible.index);
  });
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 60 });

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.push('/stream');
  }

  function share(slide) {
    const url = `${SITE_ORIGIN}/snippets/discover?post=${slide.episode.postId}`;
    Share.share({ message: url, url, title: slide.episode.title || 'A snippet' }).catch(() => {});
    setShareCopiedKey(slide.key);
    setTimeout(() => setShareCopiedKey(null), 2000);
  }

  function openMenu(slide) {
    setMenuSlide(slide);
    setMenuMode('menu');
    setEditText(slide.episode.title || '');
    setEditError(null);
  }
  function closeMenu() {
    setMenuSlide(null);
    setMenuMode('menu');
  }

  async function handleDelete() {
    if (!menuSlide) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/posts/${menuSlide.episode.postId}`, {}, tokenRef.current);
      const postId = menuSlide.episode.postId;
      setDeck((d) => d.filter((s) => !(s.kind === 'episode' && s.episode.postId === postId)));
      closeMenu();
    } catch {
      Alert.alert("Couldn't delete that post", 'Try again.');
    } finally {
      setDeleting(false);
    }
  }
  function confirmDelete() {
    Alert.alert('Delete this post?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: handleDelete }
    ]);
  }

  async function handleSaveCaption() {
    if (!menuSlide) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const postId = menuSlide.episode.postId;
      await apiPatch(`/api/posts/${postId}`, { caption: editText.trim() }, tokenRef.current);
      setDeck((d) => d.map((s) => (
        s.kind === 'episode' && s.episode.postId === postId
          ? { ...s, episode: { ...s.episode, title: editText.trim() } }
          : s
      )));
      closeMenu();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleReport(reason) {
    if (!menuSlide) return;
    setMenuMode('reported');
    apiPost('/api/posts/report', { postId: menuSlide.episode.postId, reason }, tokenRef.current).catch(() => {});
  }

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
        <Text style={styles.errorText}>Couldn't load Snippets: {feedState.error || 'unknown error'}</Text>
        <Pressable style={styles.closeBtnInline} onPress={goBack}>
          <Text style={styles.closeBtnInlineText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const { snippetEpisodes, isSignedIn, viewerId } = feedState.feed;

  if (snippetEpisodes.length === 0) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <Pressable style={[styles.closeBtn, { top: insets.top + 10 }]} onPress={goBack}>
          <CloseIconSvg size={16} />
        </Pressable>
        <Text style={styles.endIcon}>▢</Text>
        <Text style={styles.endTitle}>No snippets yet</Text>
        <Text style={styles.endSub}>Be the first to post one from the website.</Text>
        <Pressable onPress={() => router.push('/stream')}>
          <Text style={styles.endHome}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

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
            <ReelSlide
              slide={slide}
              active={i === activeIndex}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onEnded={() => {
                if (i + 1 < deck.length) listRef.current?.scrollToIndex({ index: i + 1, animated: true });
              }}
              onClose={goBack}
              onShare={() => share(slide)}
              shareCopied={shareCopiedKey === slide.key}
              onOpenMenu={isSignedIn ? () => openMenu(slide) : null}
              insets={insets}
            />
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

      <Modal visible={!!menuSlide} transparent animationType="slide" onRequestClose={closeMenu}>
        <Pressable style={styles.sheetBackdrop} onPress={closeMenu}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {menuSlide ? (
              <MenuContent
                mode={menuMode}
                setMode={setMenuMode}
                isOwner={Boolean(viewerId) && viewerId === menuSlide.episode.ownerId}
                editText={editText}
                setEditText={setEditText}
                editError={editError}
                editSaving={editSaving}
                deleting={deleting}
                onSave={handleSaveCaption}
                onDelete={confirmDelete}
                onReport={handleReport}
                onClose={closeMenu}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ReelSlide({ slide, active, muted, onToggleMute, onEnded, onClose, onShare, shareCopied, onOpenMenu, insets }) {
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <ReelPlayer
        src={slide.episode.videoSrc}
        active={active}
        muted={muted}
        onToggleMute={onToggleMute}
        thumbnail={slide.episode.thumbnail}
        onEnded={onEnded}
      />
      <Pressable style={[styles.closeBtn, { top: insets.top + 10 }]} onPress={onClose}>
        <CloseIconSvg size={16} />
      </Pressable>
      {onOpenMenu ? (
        <Pressable style={[styles.menuBtn, { top: insets.top + 10 }]} onPress={onOpenMenu}>
          <MenuIconSvg size={15} />
        </Pressable>
      ) : null}
      <View style={[styles.actionRail, { bottom: insets.bottom + 140 }]}>
        <Pressable style={styles.actionBtn} onPress={onShare}>
          {shareCopied ? <CheckIconSvg size={22} /> : <ShareIconSvg size={22} />}
        </Pressable>
      </View>
      <View style={[styles.caption, { paddingBottom: insets.bottom + 30 }]} pointerEvents="none">
        <Text style={styles.captionAuthor}>{slide.episode.authorName}</Text>
        {slide.episode.title ? <Text style={styles.captionTitle}>{slide.episode.title}</Text> : null}
      </View>
    </View>
  );
}

function MenuContent({ mode, setMode, isOwner, editText, setEditText, editError, editSaving, deleting, onSave, onDelete, onReport, onClose }) {
  if (mode === 'reported') {
    return <Text style={styles.sheetNote}>Reported — thank you.</Text>;
  }
  if (mode === 'edit') {
    return (
      <>
        <Text style={styles.sheetTitle}>Edit caption</Text>
        <TextInput style={styles.textarea} value={editText} onChangeText={setEditText} multiline maxLength={2200} />
        {editError ? <Text style={styles.errorTextSm}>{editError}</Text> : null}
        <View style={styles.sheetActions}>
          <Pressable style={styles.sheetPrimaryBtn} disabled={editSaving} onPress={onSave}>
            <Text style={styles.sheetPrimaryBtnText}>{editSaving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
          <Pressable style={styles.sheetSecondaryBtn} onPress={() => setMode('menu')}>
            <Text style={styles.sheetSecondaryBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </>
    );
  }
  if (mode === 'report') {
    return (
      <>
        {REPORT_REASONS.map((r) => (
          <Pressable key={r} style={styles.sheetRow} onPress={() => onReport(r)}>
            <Text style={styles.sheetRowText}>{r}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.sheetCancel} onPress={() => setMode('menu')}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
      </>
    );
  }
  return (
    <>
      {isOwner ? (
        <>
          <Pressable style={styles.sheetRow} onPress={() => setMode('edit')}>
            <Text style={styles.sheetRowText}>Edit caption</Text>
          </Pressable>
          <Pressable style={styles.sheetRow} onPress={onDelete} disabled={deleting}>
            <Text style={[styles.sheetRowText, { color: colors.danger }]}>{deleting ? 'Deleting…' : 'Delete'}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={styles.sheetRow} onPress={() => setMode('report')}>
          <Text style={styles.sheetRowText}>Report</Text>
        </Pressable>
      )}
      <Pressable style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Close</Text></Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  feed: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  closeBtnInline: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline },
  closeBtnInlineText: { color: colors.ink, fontSize: 14, fontWeight: '600' },

  endIcon: { fontSize: 32, color: colors.inkDim, marginBottom: 16 },
  endTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  endSub: { color: colors.inkDim, fontSize: 13, marginBottom: 20, textAlign: 'center' },
  endHome: { color: colors.olive, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },

  closeBtn: {
    position: 'absolute', left: 16, zIndex: 4, width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center'
  },
  menuBtn: {
    position: 'absolute', right: 16, zIndex: 4, width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center'
  },
  actionRail: { position: 'absolute', right: 12, zIndex: 4, gap: 18, alignItems: 'center' },
  actionBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, paddingHorizontal: 18, paddingTop: 60 },
  captionAuthor: { color: colors.brass, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 3, textTransform: 'uppercase' },
  captionTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 30 },
  sheetTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  sheetRow: { paddingVertical: 13 },
  sheetRowText: { color: colors.ink, fontSize: 14 },
  sheetCancel: { marginTop: 8, paddingVertical: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.hairline },
  sheetCancelText: { color: colors.inkDim, fontSize: 14, fontWeight: '600' },
  sheetNote: { color: colors.inkDim, fontSize: 13, textAlign: 'center', paddingVertical: 10 },
  textarea: { backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 14, minHeight: 70, textAlignVertical: 'top' },
  errorTextSm: { color: colors.danger, fontSize: 12, marginTop: 6 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  sheetPrimaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
  sheetPrimaryBtnText: { color: colors.onBrass, fontSize: 13, fontWeight: '700' },
  sheetSecondaryBtn: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: colors.hairline },
  sheetSecondaryBtnText: { color: colors.ink, fontSize: 13, fontWeight: '600' }
});
