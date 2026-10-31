import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { colors, fonts } from '../lib/theme';
import { subscribeUpload } from '../lib/tusUpload';
import { bytesLabel, runtimeClock } from '../lib/submitRules';

// The creator path's shared pieces (2026-10-31): the apply screen and
// Creator Studio's hub + three-step submit draw from here, the way the
// website's pages share the apl-* / sub-* styles. Phone-first, the site's
// tokens (mobile/src/lib/theme.js).

export const PAPER = colors.oliveShadow;

// A video from the library: { uri, fileName, fileSize, mimeType, duration (ms), width, height }.
export async function pickVideo() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Library access is needed to pick the file.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1, videoExportPreset: ImagePicker.VideoExportPreset ? ImagePicker.VideoExportPreset.Passthrough : undefined });
  if (result.canceled || !result.assets || !result.assets[0]) return null;
  return result.assets[0];
}

// An image as a JPEG data URL, sized for a poster (900 tall) or a still
// (1280 wide), like the website's forms send them.
export async function pickImageAsDataUrl({ width }) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library access is needed to pick an image.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets || !result.assets[0]) return null;
  const rendered = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  return { uri: saved.uri, base64: `data:image/jpeg;base64,${saved.base64}`, fileName: 'image.jpg' };
}

// The one upload in flight (mobile/src/lib/tusUpload.js), re-rendered as
// it moves; a tick a second keeps the time-left estimate honest.
export function useUploadProgress() {
  const [u, setU] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => subscribeUpload(setU), []);
  useEffect(() => {
    if (!u || u.status !== 'uploading') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [u && u.status]);
  return u;
}

// The master's (or the trailer's) card: name · size, the bar, what we know.
export function ProgressCard({ video, upload, facts = [], onRemove, onResume }) {
  const live = upload && video && upload.uid === video.uid ? upload : null;
  const pct = live && live.total ? Math.min(100, Math.round((live.sent / live.total) * 100)) : 0;
  const elapsed = live ? Math.max(1, (Date.now() - live.startedAt) / 1000) : 0;
  const speed = live ? live.sent / elapsed : 0;
  const left = live && speed > 0 && live.status === 'uploading' ? Math.round((live.total - live.sent) / speed) : null;
  const leftLabel = left == null ? '' : left < 60 ? 'under a minute left' : `${Math.round(left / 60)} min left`;
  const state = live && live.status === 'uploading' ? 'uploading' : live && live.status === 'requesting-url' ? 'starting' : live && live.status === 'error' ? 'error' : video.state;
  const right = state === 'uploading' ? `${pct}%${leftLabel ? ` · ${leftLabel}` : ''}` : state === 'starting' ? 'starting…' : state === 'error' ? 'stopped' : state === 'processing' ? 'uploaded · processing' : state === 'ready' ? 'ready ✓' : state === 'uploaded' ? 'uploaded ✓' : state === 'uploading' ? 'upload stopped' : state || '';
  const lines = facts.filter(Boolean);
  return (
    <View style={[cp.progress, state === 'error' && cp.progressError]}>
      <View style={cp.progressRow}>
        <Text style={cp.progressName} numberOfLines={1}>{video.name}{video.bytes ? ` · ${bytesLabel(video.bytes)}` : ''}</Text>
        <Text style={cp.progressRight}>{right}</Text>
      </View>
      <View style={cp.bar}><View style={[cp.barFill, { width: `${state === 'uploading' || state === 'starting' ? pct : 100}%` }]} /></View>
      <View style={cp.progressMeta}>
        {state === 'error' ? (
          <Text style={cp.metaText}>{(live && live.error) || 'The upload stopped.'} {onResume ? <Text style={cp.link} onPress={onResume}>Pick the same file again</Text> : null}</Text>
        ) : video.state === 'uploading' && !live ? (
          <Text style={cp.metaText}>The upload stopped. {onResume ? <Text style={cp.link} onPress={onResume}>Pick the same file again to resume</Text> : null}</Text>
        ) : lines.length ? (
          <Text style={cp.metaText}>Runtime read from the file: <Text style={cp.metaStrong}>{lines[0]}</Text>{lines[1] ? ` · ${lines[1]}` : ''}</Text>
        ) : (
          <Text style={cp.metaText}>{state === 'uploading' ? 'Keeps going while you fill in the rest.' : 'Cloudflare is working on it; nothing more to do here.'}</Text>
        )}
        {onRemove ? <Text style={cp.link} onPress={onRemove}>Not this file</Text> : null}
      </View>
    </View>
  );
}

export function factsFor(video) {
  if (!video) return [];
  return [runtimeClock(video.runtimeSeconds), video.width && video.height ? `${video.width} × ${video.height}` : null].filter(Boolean);
}

export function Field({ label, note, children, style }) {
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={cp.label}>{String(label).toUpperCase()}{note ? <Text style={cp.labelNote}>  {note}</Text> : null}</Text>
      {children}
    </View>
  );
}

export function Input(props) {
  return <TextInput placeholderTextColor={colors.inkFaint} {...props} style={[cp.input, props.multiline && cp.textarea, props.style]} />;
}

export function Chips({ options, value, onChange, small = false }) {
  return (
    <View style={cp.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} style={[cp.chip, small && cp.chipSmall, on && cp.chipOn]} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <Text style={[cp.chipText, small && cp.chipTextSmall, on && cp.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Check({ on, onPress, children, mono = false }) {
  return (
    <Pressable style={cp.check} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[cp.checkBox, on && cp.checkBoxOn]}>{on ? <Text style={cp.checkMark}>✓</Text> : null}</View>
      <Text style={[cp.checkText, mono && cp.checkTextMono]}>{children}</Text>
    </Pressable>
  );
}

export function Switch({ on, onPress, label, hint }) {
  return (
    <Pressable style={cp.switchRow} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={cp.switchLabel}>{label}</Text>
        {hint ? <Text style={cp.switchHint}>{hint}</Text> : null}
      </View>
      <View style={[cp.checkBox, on && cp.checkBoxOn]}>{on ? <Text style={cp.checkMark}>✓</Text> : null}</View>
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled, busy, style }) {
  return (
    <Pressable style={[cp.btnPrimary, (disabled || busy) && cp.btnDisabled, style]} disabled={disabled || busy} onPress={onPress}>
      {busy ? <ActivityIndicator color={PAPER} /> : <Text style={cp.btnPrimaryText}>{label}</Text>}
    </Pressable>
  );
}

export function GhostButton({ label, onPress, disabled, style, on = false }) {
  return (
    <Pressable style={[cp.btnGhost, on && cp.btnGhostOn, disabled && cp.btnDisabled, style]} disabled={disabled} onPress={onPress}>
      <Text style={[cp.btnGhostText, on && cp.btnGhostTextOn]}>{String(label).toUpperCase()}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, disabled, style }) {
  return (
    <Pressable style={[cp.btnSecondary, disabled && cp.btnDisabled, style]} disabled={disabled} onPress={onPress}>
      <Text style={cp.btnSecondaryText}>{label}</Text>
    </Pressable>
  );
}

// A status card (the apply screen) with the level colour.
const LEVEL = {
  review: { border: 'rgba(242,193,78,0.4)', bg: 'rgba(242,193,78,0.08)', tag: 'rgba(242,193,78,0.2)' },
  ok: { border: 'rgba(132,205,152,0.5)', bg: 'rgba(132,205,152,0.08)', tag: 'rgba(132,205,152,0.22)' },
  warn: { border: 'rgba(255,140,66,0.5)', bg: 'rgba(255,140,66,0.08)', tag: 'rgba(255,140,66,0.22)' },
  neutral: { border: 'rgba(251,232,211,0.18)', bg: colors.surface1, tag: 'rgba(251,232,211,0.12)' }
};

export function StatusCard({ level = 'neutral', tag, title, children }) {
  const c = LEVEL[level] || LEVEL.neutral;
  return (
    <View style={[cp.status, { borderColor: c.border, backgroundColor: c.bg }]}>
      <View style={[cp.statusTag, { backgroundColor: c.tag }]}><Text style={cp.statusTagText}>{String(tag).toUpperCase()}</Text></View>
      {title ? <Text style={cp.statusTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export const cp = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scroll: { padding: 19, paddingBottom: 140, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.brass, textTransform: 'uppercase' },
  h1: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 31, color: colors.ink },
  lede: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim },
  p: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim },
  strong: { fontFamily: fonts.bodyBold, color: colors.ink },
  link: { color: colors.olive, textDecorationLine: 'underline', fontFamily: fonts.body, fontSize: 13 },
  help: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim },
  card: { padding: 16, borderWidth: 1, borderColor: 'rgba(251,232,211,0.12)', borderRadius: 12, backgroundColor: colors.surface1, gap: 12 },
  cardK: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.olive, textTransform: 'uppercase' },
  drop: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.4)', borderRadius: 10, padding: 18, paddingHorizontal: 14, alignItems: 'center', gap: 8 },
  dropTitle: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  dropSub: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim, textAlign: 'center', maxWidth: 280 },
  progress: { padding: 12, borderRadius: 8, backgroundColor: 'rgba(242,193,78,0.08)', gap: 6 },
  progressError: { backgroundColor: 'rgba(239,91,91,0.1)' },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  progressName: { flex: 1, fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  progressRight: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  bar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(251,232,211,0.15)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: colors.olive },
  progressMeta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  metaText: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim },
  metaStrong: { color: colors.ink, fontFamily: fonts.bodyBold },
  label: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.inkDim },
  labelNote: { color: '#8a7b66', letterSpacing: 0 },
  input: { height: 42, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', backgroundColor: colors.surface0, color: colors.ink, fontFamily: fonts.body, fontSize: 15 },
  textarea: { height: undefined, minHeight: 90, paddingVertical: 10, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', justifyContent: 'center' },
  chipSmall: { height: 28, paddingHorizontal: 10 },
  chipOn: { borderColor: colors.olive, backgroundColor: 'rgba(242,193,78,0.18)' },
  chipText: { fontFamily: fonts.display, fontSize: 12.5, color: colors.ink },
  chipTextSmall: { fontSize: 12 },
  chipTextOn: { color: colors.ink },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  checkBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(251,232,211,0.3)', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkBoxOn: { backgroundColor: colors.olive, borderColor: colors.olive },
  checkMark: { color: PAPER, fontSize: 13, fontFamily: fonts.displayBold },
  checkText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink },
  checkTextMono: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 16, letterSpacing: 0.2, textTransform: 'uppercase' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  switchLabel: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  switchHint: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, color: colors.inkDim },
  btnPrimary: { height: 48, borderRadius: 999, backgroundColor: colors.olive, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 15, color: PAPER },
  btnDisabled: { opacity: 0.45 },
  btnGhost: { height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.4)', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  btnGhostOn: { borderColor: colors.olive },
  btnGhostText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, color: colors.ink },
  btnGhostTextOn: { color: colors.olive },
  btnSecondary: { height: 40, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.4)', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  btnSecondaryText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.ink },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  note: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 16, color: colors.inkDim, textAlign: 'center' },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.danger },
  status: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 8 },
  statusTag: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  statusTagText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.ink },
  statusTitle: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 24, color: colors.ink },
  statusK: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.olive, marginTop: 4 },
  signed: { padding: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(251,232,211,0.05)', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  signedOn: { backgroundColor: 'rgba(132,205,152,0.12)' },
  signedText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink }
});
