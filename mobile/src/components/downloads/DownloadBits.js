import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, fonts, inkTint, okTint, oliveTint, surfaceTint, absoluteFill } from '../../lib/theme';
import { DOWNLOAD_WORDS } from '../../lib/downloadRules';
import { APP_WORDS } from '../../lib/downloadLogic';
import {
  artUri, downloadLogic, pauseDownload, removeDevice, removeDownload, resumeDownload, setWifiOnly, startDownload
} from '../../lib/downloads';
import { useDownload, useDownloads } from '../../lib/useDownloads';

// Downloads in the app, the pieces the screens share (Jose, 2026-11-14; the
// signed-off mockup mockups/app-downloads-v1.html): the glyphs, the ring
// with its percent, the lock card, the bottom sheets, the Download action
// on a title (components for app/episode/[id].js) and the Wi-Fi switch
// (app/downloads/index.js and Account → Preferences). The words are the
// shared rules' DOWNLOAD_WORDS and the app's own APP_WORDS, never typed here.

/* ---------------- glyphs (the mockup's own paths) ---------------- */

export function DownloadGlyph({ size = 18, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 4v11" />
      <Path d="M7 10.5l5 5 5-5" />
      <Path d="M5 20h14" />
    </Svg>
  );
}
export function CheckGlyph({ size = 18, color = colors.ok }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}
export function PauseGlyph({ size = 14, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 6v12" />
      <Path d="M15 6v12" />
    </Svg>
  );
}
export function LockGlyph({ size = 15, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="5" y="11" width="14" height="9" rx="2" />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}
export function OfflineGlyph({ size = 17, color = colors.sky }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 3l18 18" />
      <Path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <Path d="M5 12.5a10 10 0 0 1 3.2-2.2" />
      <Path d="M19 12.5a10 10 0 0 0-5-2.7" />
      <Circle cx="12" cy="20" r="0.6" />
    </Svg>
  );
}
export function RetryGlyph({ size = 15, color = colors.danger }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 12a9 9 0 1 0 3-6.7" />
      <Path d="M3 4v5h5" />
    </Svg>
  );
}
export function PlayGlyph({ size = 14, color = colors.surface0 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

// The ring: the gold arc is how much of the file is on the phone. With no
// percent yet (the file is being made, a download waiting) it turns.
const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;
export function ProgressRing({ size = 44, percent = null, children }) {
  const spin = useRef(new Animated.Value(0)).current;
  const turning = percent === null;
  useEffect(() => {
    if (!turning) return undefined;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turning, spin]);
  const part = turning ? 0.25 : Math.max(0, Math.min(1, percent / 100));
  const ring = (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r={RING_R} stroke={inkTint(0.25)} strokeWidth={2.4} />
      {part > 0 ? (
        <Circle cx="12" cy="12" r={RING_R} stroke={colors.olive} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={`${RING_C * part} ${RING_C}`} transform="rotate(-90 12 12)" />
      ) : null}
    </Svg>
  );
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {turning ? (
        <Animated.View style={[absoluteFill, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>{ring}</Animated.View>
      ) : <View style={absoluteFill}>{ring}</View>}
      {children}
    </View>
  );
}

/* ---------------- the lock card ---------------- */

// `card`: { title, body, action } from the rules' lockCard (through
// downloadLogic.pageLock / itemLock). `actions`: [{ label, onPress, ghost,
// busy }] drawn under it; `note` a line after them (what Try again found).
export function LockCard({ card, actions = [], note = null, style = null }) {
  if (!card) return null;
  return (
    <View style={[styles.lockCard, style]} accessibilityRole="alert">
      <Text style={styles.lockTitle}>{card.title}</Text>
      {card.body ? <Text style={styles.lockBody}>{card.body}</Text> : null}
      {actions.length ? (
        <View style={styles.lockActions}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              style={({ pressed }) => [a.ghost ? styles.btnGhost : styles.btn, (pressed || a.busy) && { opacity: 0.7 }]}
              onPress={a.onPress}
              disabled={Boolean(a.busy)}
              accessibilityRole="button"
            >
              {a.busy ? <ActivityIndicator size="small" color={a.ghost ? colors.inkDim : colors.onBrass} /> : <Text style={a.ghost ? styles.btnGhostText : styles.btnText}>{a.label}</Text>}
            </Pressable>
          ))}
        </View>
      ) : null}
      {note ? <Text style={styles.lockNote}>{note}</Text> : null}
    </View>
  );
}

// The line across the top when there's no connection.
export function OfflineBanner({ locked = false }) {
  const words = locked ? DOWNLOAD_WORDS.offlineBannerLocked : DOWNLOAD_WORDS.offlineBanner;
  const cut = words.indexOf('. ');
  const first = cut > 0 ? words.slice(0, cut + 1) : words;
  const rest = cut > 0 ? words.slice(cut + 1) : '';
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <OfflineGlyph />
      <Text style={styles.bannerText}><Text style={styles.bannerStrong}>{first}</Text>{rest}</Text>
    </View>
  );
}

/* ---------------- bottom sheets ---------------- */

// Every orientation: a sheet may be up when the phone turns and the player
// goes full screen (a portrait-only Modal over a turned screen is an iOS
// crash; components/TipSheet.js).
export function Sheet({ visible, onClose, title, body, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
            {body ? <Text style={styles.sheetBody}>{body}</Text> : null}
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function SheetButton({ label, onPress, tone = 'plain', busy = false }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.sheetBtn, tone === 'primary' && styles.sheetBtnPrimary, tone === 'danger' && styles.sheetBtnDanger, (pressed || busy) && { opacity: 0.7 }]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator size="small" color={tone === 'primary' ? colors.onBrass : colors.ink} /> : (
        <Text style={[styles.sheetBtnText, tone === 'primary' && styles.sheetBtnTextPrimary, tone === 'danger' && styles.sheetBtnTextDanger]}>{label}</Text>
      )}
    </Pressable>
  );
}

const lastSeenWords = (value) => {
  const at = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(at)) return '';
  return `last here ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};

// "Downloads are already on 2 phones": each with Remove. Removing one
// lets this phone in — `onFreed` then tries the download again.
export function DevicesSheet({ visible, devices, onClose, onFreed }) {
  const [list, setList] = useState(devices || []);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (visible) { setList(devices || []); setError(null); } }, [visible, devices]);
  async function remove(d) {
    setBusy(d.deviceId);
    setError(null);
    const r = await removeDevice(d.deviceId);
    setBusy(null);
    if (!r.ok) { setError(APP_WORDS.checkFailed); return; }
    setList((cur) => cur.filter((x) => x.deviceId !== d.deviceId));
    if (onFreed) onFreed();
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={APP_WORDS.phonesTitle} body={DOWNLOAD_WORDS.deviceLimit}>
      {list.map((d) => (
        <View key={d.deviceId} style={styles.deviceRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.deviceName} numberOfLines={1}>{d.name || (d.platform === 'android' ? 'Android phone' : 'iPhone')}{d.current ? ` · ${APP_WORDS.thisPhone}` : ''}</Text>
            <Text style={styles.deviceSub} numberOfLines={1}>{[`${Number(d.count) || 0} ${Number(d.count) === 1 ? 'title' : 'titles'}`, lastSeenWords(d.lastSeenAt)].filter(Boolean).join(' · ')}</Text>
          </View>
          <Pressable style={({ pressed }) => [styles.deviceBtn, (pressed || busy === d.deviceId) && { opacity: 0.7 }]} onPress={() => remove(d)} disabled={Boolean(busy)} accessibilityRole="button" accessibilityLabel={`${APP_WORDS.remove} ${d.name || 'this phone'}`}>
            {busy === d.deviceId ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={styles.deviceBtnText}>{APP_WORDS.remove}</Text>}
          </Pressable>
        </View>
      ))}
      {error ? <Text style={styles.sheetError}>{error}</Text> : null}
      <SheetButton label={APP_WORDS.cancel} onPress={onClose} />
    </Sheet>
  );
}

/* ---------------- the Download action on a title ---------------- */

// What the button is, from the copy on this phone (when there is one) or
// the server's offer (`download` on /api/episode-page).
// → null (nothing drawn) | { kind, label, percent }
export function downloadActionFor(item, offer) {
  if (item) {
    if (item.state === 'ready') return { kind: 'done', label: DOWNLOAD_WORDS.done, percent: 100 };
    const status = downloadLogic.rowStatus({ lastSeenAt: null }, item, { now: 0 });
    if (status.kind === 'downloading') return { kind: 'downloading', label: `${status.percent}%`, percent: status.percent };
    if (status.kind === 'preparing') return { kind: 'preparing', label: DOWNLOAD_WORDS.preparing, percent: null };
    if (status.kind === 'waiting') return { kind: 'waiting', label: DOWNLOAD_WORDS.waitingWifi, percent: status.percent };
    if (status.kind === 'failed') return { kind: 'failed', label: APP_WORDS.retry, percent: 0 };
    if (status.kind === 'paused') return { kind: 'paused', label: DOWNLOAD_WORDS.paused, percent: status.percent };
    return { kind: 'queued', label: APP_WORDS.queued, percent: status.percent };
  }
  const state = offer && offer.state;
  if (state === 'ok') return { kind: 'offer', label: DOWNLOAD_WORDS.button, percent: 0 };
  if (state === 'plan') return { kind: 'plan', label: DOWNLOAD_WORDS.button, percent: 0 };
  if (state === 'signin') return { kind: 'signin', label: DOWNLOAD_WORDS.button, percent: 0 };
  return null;
}

// The Download action (the mockup's fourth round button): Download → a ring
// with the percent (a tap pauses) → a tick (a tap: Play from this phone /
// Remove). A plan without downloads shows the button with a small lock and
// opens the "Downloads come with Premium" sheet; signed out, it asks them
// to sign in; `hidden` draws nothing — unless a copy is already here.
//   variant 'round': the ring with the label under it (the playing view)
//   variant 'pill':  a pill beside Play / Save / Tip (the landing)
// `meta`: what the screen knows about the title, kept with the copy until
// the server's own item arrives (and its flashing-lights mark for good).
export function DownloadAction({ episodeId, offer, meta, router, variant = 'round', style, ringStyle, labelStyle, pillTextStyle }) {
  const item = useDownload(episodeId);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null); // { kind, title, body, devices }
  const action = downloadActionFor(item, offer);
  if (!action) return null;

  async function begin() {
    if (busy) return;
    setBusy(true);
    const r = await startDownload(episodeId, meta || {});
    setBusy(false);
    if (r.ok) return;
    const say = downloadLogic.refusal(r);
    if (say.kind === 'signin') { askSignIn(); return; }
    setSheet(say);
  }
  function askSignIn() {
    Alert.alert(DOWNLOAD_WORDS.signIn, DOWNLOAD_WORDS.planBody, [
      { text: APP_WORDS.notNow, style: 'cancel' },
      { text: APP_WORDS.signInAction, onPress: () => router.push('/account') }
    ]);
  }
  function press() {
    if (action.kind === 'offer') begin();
    else if (action.kind === 'plan') setSheet({ kind: 'plan', title: DOWNLOAD_WORDS.planTitle, body: DOWNLOAD_WORDS.planBody });
    else if (action.kind === 'signin') askSignIn();
    else if (action.kind === 'downloading') pauseDownload(episodeId);
    else if (action.kind === 'paused' || action.kind === 'failed') resumeDownload(episodeId);
    else if (action.kind === 'done') setSheet({ kind: 'done', title: item.title || DOWNLOAD_WORDS.done, body: '' });
    else setSheet({ kind: 'waiting', title: item && item.title ? item.title : DOWNLOAD_WORDS.button, body: action.label });
  }
  function close() { setSheet(null); }

  const tint = action.kind === 'done' ? colors.ok : action.kind === 'failed' ? colors.danger : colors.ink;
  const inFlight = ['downloading', 'preparing', 'waiting', 'queued', 'paused'].includes(action.kind);
  const glyph = action.kind === 'done' ? <CheckGlyph size={variant === 'pill' ? 16 : 18} />
    : action.kind === 'failed' ? <RetryGlyph size={variant === 'pill' ? 15 : 17} />
    : action.kind === 'paused' ? <PauseGlyph size={variant === 'pill' ? 14 : 15} />
    : action.kind === 'downloading' ? <PauseGlyph size={variant === 'pill' ? 11 : 12} color={colors.inkDim} />
    : action.kind === 'preparing' ? null
    : inFlight ? <DownloadGlyph size={variant === 'pill' ? 11 : 15} color={colors.inkDim} />
    : <DownloadGlyph size={variant === 'pill' ? 16 : 18} />;
  const ringPercent = action.kind === 'preparing' || busy ? null : action.percent;
  const a11y = action.kind === 'downloading' ? `Downloading, ${action.percent} percent. Tap to pause.`
    : action.kind === 'done' ? `${DOWNLOAD_WORDS.done}. Tap to play or remove.`
    : action.kind === 'plan' ? `${DOWNLOAD_WORDS.button}. ${DOWNLOAD_WORDS.planTitle}.`
    : action.label;

  const body = variant === 'pill' ? (
    <>
      {inFlight || busy ? <ProgressRing size={20} percent={ringPercent}>{null}</ProgressRing> : glyph}
      <Text style={[pillTextStyle, action.kind === 'done' && { color: colors.ok }]} numberOfLines={1}>{busy ? DOWNLOAD_WORDS.button : action.label}</Text>
      {action.kind === 'plan' ? <LockGlyph size={12} color={colors.inkDim} /> : null}
    </>
  ) : (
    <>
      {inFlight || busy ? (
        <ProgressRing size={44} percent={ringPercent}>{busy ? null : glyph}</ProgressRing>
      ) : (
        <View style={[ringStyle, action.kind === 'done' && { borderColor: okTint(0.7) }, action.kind === 'failed' && { borderColor: colors.danger }]}>
          {glyph}
          {action.kind === 'plan' ? <View style={styles.lockBadge}><LockGlyph size={9} color={colors.inkDim} /></View> : null}
        </View>
      )}
      <Text style={[labelStyle, { color: action.kind === 'done' || action.kind === 'failed' ? tint : labelStyle && labelStyle.color }]} numberOfLines={2}>{String(busy ? DOWNLOAD_WORDS.button : action.label).toUpperCase()}</Text>
    </>
  );

  return (
    <>
      <Pressable
        style={({ pressed }) => [style, pressed && { opacity: 0.75 }]}
        onPress={press}
        onLongPress={item && action.kind !== 'done' ? () => setSheet({ kind: 'waiting', title: item.title || DOWNLOAD_WORDS.button, body: action.label }) : undefined}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        {body}
      </Pressable>

      <Sheet visible={Boolean(sheet && sheet.kind === 'plan')} onClose={close} title={DOWNLOAD_WORDS.planTitle} body={DOWNLOAD_WORDS.planBody}>
        <SheetButton tone="primary" label={DOWNLOAD_WORDS.planAction} onPress={() => { close(); router.push('/account/membership'); }} />
        <SheetButton label={APP_WORDS.notNow} onPress={close} />
      </Sheet>
      <Sheet visible={Boolean(sheet && sheet.kind === 'titles')} onClose={close} title={DOWNLOAD_WORDS.nav} body={DOWNLOAD_WORDS.titleLimit}>
        <SheetButton tone="primary" label={APP_WORDS.openDownloads} onPress={() => { close(); router.push('/downloads'); }} />
        <SheetButton label={APP_WORDS.cancel} onPress={close} />
      </Sheet>
      <DevicesSheet visible={Boolean(sheet && sheet.kind === 'devices')} devices={sheet && sheet.devices} onClose={close} onFreed={() => { close(); begin(); }} />
      <Sheet visible={Boolean(sheet && sheet.kind === 'message')} onClose={close} title={sheet ? sheet.title : ''} body={sheet ? sheet.body : ''}>
        <SheetButton label={APP_WORDS.dismiss} onPress={close} />
      </Sheet>
      <Sheet visible={Boolean(sheet && sheet.kind === 'done')} onClose={close} title={sheet ? sheet.title : ''} body={DOWNLOAD_WORDS.done}>
        <SheetButton tone="primary" label={APP_WORDS.playHere} onPress={() => { close(); router.push(`/downloads/${encodeURIComponent(episodeId)}`); }} />
        <SheetButton tone="danger" label={APP_WORDS.removeDownload} onPress={() => { close(); removeDownload(episodeId); }} />
        <SheetButton label={APP_WORDS.cancel} onPress={close} />
      </Sheet>
      <Sheet visible={Boolean(sheet && sheet.kind === 'waiting')} onClose={close} title={sheet ? sheet.title : ''} body={sheet ? sheet.body : ''}>
        <SheetButton tone="danger" label={APP_WORDS.removeDownload} onPress={() => { close(); removeDownload(episodeId); }} />
        <SheetButton label={APP_WORDS.cancel} onPress={close} />
      </Sheet>
    </>
  );
}

/* ---------------- the Wi-Fi switch ---------------- */

// "Download on Wi-Fi only" (on by default; the Downloads page and Account →
// Preferences). `Row` is the account screens' row when one is handed in.
export function WifiOnlySwitch({ Row = null }) {
  const { index, supported } = useDownloads();
  if (!supported) return null;
  const on = index.wifiOnly !== false;
  const control = (
    <Switch
      value={on}
      onValueChange={(v) => setWifiOnly(v)}
      trackColor={{ false: colors.surface3, true: colors.olive }}
      thumbColor={on ? colors.onBrass : colors.inkDim}
      ios_backgroundColor={colors.surface3}
      accessibilityLabel={DOWNLOAD_WORDS.wifiOnly}
    />
  );
  const note = on ? DOWNLOAD_WORDS.wifiOnlyNote : APP_WORDS.wifiOffNote;
  if (Row) return <Row label={DOWNLOAD_WORDS.wifiOnly} detail={note} divider>{control}</Row>;
  return (
    <View style={styles.wifiRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.wifiLabel}>{DOWNLOAD_WORDS.wifiOnly}</Text>
        <Text style={styles.wifiNote}>{note}</Text>
      </View>
      {control}
    </View>
  );
}

// A copy's picture from the phone (never the network), or the blank tile.
export function DownloadArt({ item, style, dim = false, children }) {
  const uri = artUri(item);
  return (
    <View style={[styles.art, style]}>
      {uri ? <Image source={{ uri }} style={[absoluteFill, dim && { opacity: 0.35 }]} resizeMode="cover" /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // .card.warn
  lockCard: { borderRadius: 12, padding: 16, gap: 9, backgroundColor: oliveTint(0.1), borderWidth: 1, borderColor: oliveTint(0.45) },
  lockTitle: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 21, color: colors.ink },
  lockBody: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  lockActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 3 },
  lockNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim },
  btn: { minHeight: 40, borderRadius: 999, paddingHorizontal: 18, backgroundColor: colors.olive, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrass },
  btnGhost: { minHeight: 40, borderRadius: 999, paddingHorizontal: 16, borderWidth: 1, borderColor: inkTint(0.25), alignItems: 'center', justifyContent: 'center' },
  btnGhostText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.inkDim },

  // .banner
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 19, backgroundColor: 'rgba(132,153,220,0.16)', borderBottomWidth: 1, borderBottomColor: 'rgba(132,153,220,0.35)' },
  bannerText: { flex: 1, fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  bannerStrong: { fontFamily: fonts.displaySemi },

  backdrop: { ...absoluteFill, backgroundColor: surfaceTint(0.6) },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '86%', backgroundColor: colors.surface1, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: inkTint(0.12), paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: inkTint(0.25), marginBottom: 14 },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 19, lineHeight: 23, color: colors.ink },
  sheetBody: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkDim },
  sheetError: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  sheetBtn: { minHeight: 46, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  sheetBtnPrimary: { backgroundColor: colors.olive, borderColor: colors.olive },
  sheetBtnDanger: { borderColor: 'rgba(239,91,91,0.5)' },
  sheetBtnText: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  sheetBtnTextPrimary: { fontFamily: fonts.displayBold, color: colors.onBrass },
  sheetBtnTextDanger: { color: colors.danger },

  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  deviceName: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  deviceSub: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim, marginTop: 2 },
  deviceBtn: { minHeight: 36, minWidth: 78, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(239,91,91,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  deviceBtnText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.danger },

  lockBadge: { position: 'absolute', right: -2, bottom: -2, width: 17, height: 17, borderRadius: 9, backgroundColor: colors.surface0, borderWidth: 1, borderColor: inkTint(0.25), alignItems: 'center', justifyContent: 'center' },

  // .switch
  wifiRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline },
  wifiLabel: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  wifiNote: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim, marginTop: 2 },

  art: { backgroundColor: colors.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }
});
