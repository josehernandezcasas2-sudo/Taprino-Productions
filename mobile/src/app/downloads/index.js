import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import TopNav from '../../components/TopNav';
import { colors, fonts, inkTint, okTint, absoluteFill } from '../../lib/theme';
import { DOWNLOAD_WORDS } from '../../lib/downloadRules';
import { APP_WORDS } from '../../lib/downloadLogic';
import {
  dismissNotice, downloadLogic, loadAccount, pageOpened, pauseDownload, removeDownload, removeMany, resumeDownload, retryConnection, startDownload
} from '../../lib/downloads';
import { useDownloadRows } from '../../lib/useDownloads';
import { BackArrowIcon } from '../../components/account/AccountBits';
import {
  CheckGlyph, DownloadArt, DownloadGlyph, LockCard, LockGlyph, OfflineBanner, PauseGlyph, PlayGlyph, ProgressRing, RetryGlyph, Sheet, SheetButton, WifiOnlySwitch
} from '../../components/downloads/DownloadBits';

// Downloads (Jose, 2026-11-14; mockups/app-downloads-v1.html, screens 3–6):
// what is on this phone, how much room it takes and the day it all plays
// offline until. Watch → Downloads; with no connection the app opens here
// by itself.
//
// This screen reads the index file and the stored files and nothing else
// (mobile/src/lib/downloads.js): no fetch, no Clerk, no gate has to answer
// before it draws. Online and signed in it also checks in when it opens
// and reads the account's plan.
const RETRY_LINE = { offline: APP_WORDS.stillOffline, nosession: APP_WORDS.noSession, network: APP_WORDS.checkFailed, server: APP_WORDS.checkFailed, changed: APP_WORDS.checkFailed };

export default function Downloads() {
  const router = useRouter();
  const { state, rows, now } = useDownloadRows();
  const [menu, setMenu] = useState(null); // the row whose menu is open
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState(null);

  // Each time the page opens: the clock, the files, a check-in when online.
  useFocusEffect(useCallback(() => {
    pageOpened().catch(() => {});
    loadAccount().catch(() => {});
  }, []));

  const offline = state.offline;
  const { index } = state;
  const lock = downloadLogic.pageLock(index, rows, { now });
  const sum = downloadLogic.summary(index, rows, { offline, now });
  const fine = downloadLogic.finePrint(index, rows, { now });
  const menuRow = menu ? rows.find((r) => r.item.episodeId === menu) || null : null;

  async function retry() {
    setRetrying(true);
    setRetryNote(null);
    const r = await retryConnection();
    setRetrying(false);
    // It connected and the copies still can't play: the admin switch is off,
    // so their dates aren't renewed for now.
    setRetryNote(r.ok ? (r.enabled === false ? DOWNLOAD_WORDS.off : null) : RETRY_LINE[r.reason] || APP_WORDS.checkFailed);
  }
  function removeAllLocked(ids) {
    Alert.alert(APP_WORDS.removeAll, `${ids.length} ${ids.length === 1 ? 'title' : 'titles'}`, [
      { text: APP_WORDS.cancel, style: 'cancel' },
      { text: APP_WORDS.remove, style: 'destructive', onPress: () => removeMany(ids) }
    ]);
  }
  function open(row) {
    const { item, status } = row;
    if (status.kind === 'play') router.push(`/downloads/${encodeURIComponent(item.episodeId)}`);
    else if (status.kind === 'downloading') pauseDownload(item.episodeId);
    else if (status.kind === 'failed' || (status.kind === 'paused' && status.reason !== 'offline')) resumeDownload(item.episodeId);
    else setMenu(item.episodeId);
  }
  // A copy the phone cleared: the same title again, from what the row knows.
  async function downloadAgain(item) {
    setMenu(null);
    const meta = { ...item, art: item.artUrl || null };
    removeDownload(item.episodeId);
    const r = await startDownload(item.episodeId, meta);
    if (!r.ok) {
      const say = downloadLogic.refusal(r);
      Alert.alert(say.title, say.kind === 'plan' ? DOWNLOAD_WORDS.planBody : say.body || APP_WORDS.cantDownload);
    }
  }

  const lockActions = !lock ? [] : lock.action === 'retry'
    ? [{ label: APP_WORDS.retry, onPress: retry, busy: retrying }]
    : lock.action === 'plans'
      ? [{ label: DOWNLOAD_WORDS.planAction, onPress: () => router.push('/account/membership') }, { label: APP_WORDS.removeAll, ghost: true, onPress: () => removeAllLocked(lock.ids) }]
      : [];

  let body;
  if (!state.supported) {
    body = <Text style={styles.empty}>{APP_WORDS.unsupported}</Text>;
  } else if (state.hidden) {
    // Clerk says this phone is signed out: the copies wait for their account.
    body = (
      <LockCard
        card={{ title: APP_WORDS.signInTitle, body: APP_WORDS.signInBody }}
        actions={[{ label: APP_WORDS.signInAction, onPress: () => router.push('/account') }]}
      />
    );
  } else {
    const planKnown = index.plan && typeof index.plan.carries === 'boolean';
    body = (
      <>
        {state.notices.map((n) => {
          const card = downloadLogic.noticeCard(n);
          return card ? <LockCard key={`${n.reason}:${n.episodeId}:${n.at}`} card={card} actions={[{ label: APP_WORDS.dismiss, ghost: true, onPress: () => dismissNotice(n) }]} /> : null;
        })}
        {lock ? <LockCard card={lock} actions={lockActions} note={retryNote} /> : null}

        {rows.length > 0 ? (
          <>
            <View style={styles.sum}>
              <Text style={styles.sumText}>{sum.line}</Text>
              {sum.chip ? <View style={styles.chip}><Text style={styles.chipText}>{sum.chip}</Text></View> : null}
            </View>
            <View>
              {rows.map((row) => <Row key={row.item.episodeId} row={row} offline={offline} lockShown={Boolean(lock)} onPress={() => open(row)} onMenu={() => setMenu(row.item.episodeId)} />)}
            </View>
          </>
        ) : planKnown && !index.plan.carries ? (
          // An account whose plan has no downloads.
          <LockCard
            card={{ title: DOWNLOAD_WORDS.planTitle, body: DOWNLOAD_WORDS.planBody }}
            actions={[{ label: DOWNLOAD_WORDS.planAction, onPress: () => router.push('/account/membership') }]}
          />
        ) : index.enabled === false ? (
          <Text style={styles.empty}>{DOWNLOAD_WORDS.off}</Text>
        ) : (
          <View style={styles.emptyBox}>
            <DownloadGlyph size={26} color={colors.inkDim} />
            <Text style={styles.empty}>{DOWNLOAD_WORDS.empty}</Text>
          </View>
        )}

        <WifiOnlySwitch />
        {fine ? <Text style={styles.fine}>{fine}</Text> : null}
        {rows.length > 0 ? <Text style={styles.fine}>{APP_WORDS.holdToRemove}</Text> : null}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      {offline ? <OfflineBanner locked={Boolean(lock)} /> : null}
      <ScrollView contentContainerStyle={styles.stage}>
        {router.canGoBack() ? (
          <Pressable style={styles.backBtn} onPress={() => router.back()} accessibilityRole="button">
            <BackArrowIcon /><Text style={styles.backText}>Back</Text>
          </Pressable>
        ) : null}
        <Text style={styles.title} accessibilityRole="header">{DOWNLOAD_WORDS.nav}</Text>
        {body}
      </ScrollView>

      <Sheet visible={Boolean(menuRow)} onClose={() => setMenu(null)} title={menuRow ? menuRow.item.title || DOWNLOAD_WORDS.nav : ''} body={menuRow ? menuText(menuRow) : ''}>
        {menuRow && menuRow.status.kind === 'play' ? (
          <SheetButton tone="primary" label={APP_WORDS.playHere} onPress={() => { const id = menuRow.item.episodeId; setMenu(null); router.push(`/downloads/${encodeURIComponent(id)}`); }} />
        ) : null}
        {menuRow && menuRow.status.kind === 'missing' && !offline ? (
          <SheetButton tone="primary" label={APP_WORDS.downloadAgain} onPress={() => downloadAgain(menuRow.item)} />
        ) : null}
        {menuRow && !offline ? (
          <SheetButton label={APP_WORDS.openTitle} onPress={() => { const id = menuRow.item.episodeId; setMenu(null); router.push(`/episode/${encodeURIComponent(id)}`); }} />
        ) : null}
        {menuRow ? (
          <SheetButton tone="danger" label={APP_WORDS.removeDownload} onPress={() => { const id = menuRow.item.episodeId; setMenu(null); removeDownload(id); }} />
        ) : null}
        <SheetButton label={APP_WORDS.cancel} onPress={() => setMenu(null)} />
      </Sheet>
    </SafeAreaView>
  );
}

// What the menu says under the title: why a copy can't play, or its line.
function menuText(row) {
  if (row.status.kind === 'missing') return downloadLogic.itemLock(null, row.item, 'missing').body;
  const text = downloadLogic.rowText(row.item, row.status, {});
  return [text.sub, text.note].filter(Boolean).join('\n');
}

function Row({ row, offline, lockShown, onPress, onMenu }) {
  const { item, status } = row;
  const text = downloadLogic.rowText(item, status, { offline, lockShown });
  const locked = status.kind === 'locked' || status.kind === 'missing';
  const right = status.kind === 'play'
    ? (offline || lockShown
      ? <View style={styles.go}><PlayGlyph size={13} /></View>
      // Online: the tick, which opens the menu (Play from this phone / Remove).
      : <Pressable onPress={onMenu} hitSlop={12} accessibilityRole="button" accessibilityLabel={`${DOWNLOAD_WORDS.done}. ${APP_WORDS.playHere} or ${APP_WORDS.remove.toLowerCase()}.`}><CheckGlyph size={22} /></Pressable>)
    : status.kind === 'downloading' ? <ProgressRing size={34} percent={status.percent}><PauseGlyph size={10} color={colors.inkDim} /></ProgressRing>
    : status.kind === 'preparing' ? <ProgressRing size={34} percent={null} />
    : status.kind === 'failed' ? <View style={styles.small}><RetryGlyph size={14} /></View>
    : status.kind === 'paused' || status.kind === 'waiting' || status.kind === 'queued' ? <View style={styles.small}><PauseGlyph size={13} /></View>
    : null;
  const label = [item.title, text.sub, text.note, locked ? 'Locked' : null].filter(Boolean).join('. ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
      onPress={onPress}
      onLongPress={onMenu}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: APP_WORDS.removeDownload }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? onMenu() : onPress())}
    >
      <DownloadArt item={item} style={styles.thumb} dim={locked}>
        {locked ? <View style={[absoluteFill, styles.thumbLock]}><LockGlyph size={16} /></View> : null}
      </DownloadArt>
      <View style={[styles.rowMain, locked && { opacity: 0.55 }]}>
        <Text style={styles.rowTitle} numberOfLines={2}>{item.title || 'Untitled'}</Text>
        {text.sub ? <Text style={styles.rowSub} numberOfLines={1}>{text.sub}</Text> : null}
        {text.note ? <Text style={[styles.rowNote, text.tone === 'danger' && { color: colors.danger }, text.tone === 'dim' && { color: colors.inkDim }]} numberOfLines={2}>{text.note}</Text> : null}
      </View>
      <View style={styles.rowRight}>{right}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  stage: { paddingTop: 18, paddingHorizontal: 19, paddingBottom: 140, gap: 14 },
  // .backpill
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },
  // .h
  title: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 31, letterSpacing: -0.3, color: colors.ink },
  // .sum / .chip.good
  sum: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sumText: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  chip: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: okTint(0.14), borderWidth: 1, borderColor: okTint(0.4) },
  chipText: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.ok },
  // .row / .thumb / .row-main
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.hairline },
  thumb: { width: 96, aspectRatio: 16 / 9, borderRadius: 6 },
  thumbLock: { alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 15.5, lineHeight: 19, color: colors.ink },
  rowSub: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  rowNote: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 15, color: colors.olive },
  rowRight: { minWidth: 36, alignItems: 'center', justifyContent: 'center' },
  // .go: the cream play button
  go: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  small: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: inkTint(0.25), alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim },
  // .fine
  fine: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 16, color: colors.inkFaint }
});
