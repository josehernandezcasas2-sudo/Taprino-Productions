import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, absoluteFill } from '../lib/theme';
import SmartImage from './SmartImage';

// Shared pieces for the Film University screens (mobile/src/app/university/*),
// mirroring components/university/LessonBits.js on the website.

export function lessonRoute(lesson) {
  return { pathname: '/university/lesson/[topic]/[slug]', params: { topic: lesson.topicSlug, slug: lesson.slug } };
}

export function needsLabel(needs) {
  const map = { nothing: 'Needs nothing', phone: 'Needs a phone', camera: 'Needs a camera', scene: 'Needs a scene you wrote', person: 'Needs another person', footage: 'Needs footage to cut' };
  if (!needs || needs.length === 0) return null;
  if (needs.length === 1) return map[needs[0]] || null;
  const words = needs.map((n) => (map[n] || '').replace(/^Needs (a |another )?/, '')).filter(Boolean);
  return `Needs ${words.join(' + ')}`;
}

export function LessonThumb({ lesson, style, badge = true }) {
  const doc = lesson.kind === 'document';
  return (
    <View style={[styles.thumb, style]}>
      {lesson.kind === 'video' && lesson.thumbnailUrl ? (
        <SmartImage uri={lesson.thumbnailUrl} style={absoluteFill} resizeMode="cover" />
      ) : (
        <LinearGradient colors={doc ? ['#1f3b3a', '#0f1f2f'] : ['#3a2a4f', '#1b2740']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={absoluteFill} />
      )}
      {(!lesson.thumbnailUrl || doc) && <Text style={[styles.glyph, doc && { color: colors.mint }]}>{doc ? '¶' : '▶'}</Text>}
      {badge && lesson.kind === 'video' && lesson.duration ? (
        <View style={styles.badge}><Text style={styles.badgeText}>▶ {lesson.duration}</Text></View>
      ) : null}
    </View>
  );
}

export function LessonRow({ lesson, label }) {
  const router = useRouter();
  if (!lesson) return null;
  return (
    <Pressable style={styles.row} onPress={() => router.push(lessonRoute(lesson))}>
      <LessonThumb lesson={lesson} style={styles.rowThumb} badge={false} />
      <View style={{ flex: 1 }}>
        {label ? <Text style={styles.eyebrow}>{label}</Text> : null}
        <Text style={styles.rowTitle} numberOfLines={2}>{lesson.title}</Text>
        <Text style={styles.meta}>{lesson.meta}</Text>
      </View>
    </Pressable>
  );
}

export function TopicCard({ topic }) {
  const router = useRouter();
  return (
    <Pressable style={styles.topic} onPress={() => router.push({ pathname: '/university/topic/[slug]', params: { slug: topic.slug } })}>
      <View style={[styles.topicBlob, { backgroundColor: topic.accentColor }]} />
      <Text style={styles.topicName}>{topic.name}</Text>
      <Text style={styles.meta}>{topic.lessonCount} lesson{topic.lessonCount === 1 ? '' : 's'}</Text>
    </Pressable>
  );
}

export function ExerciseCard({ exercise, done }) {
  const router = useRouter();
  const head = [exercise.topicName, exercise.minutes ? `${exercise.minutes} min` : null].filter(Boolean).join(' · ') || 'Exercise';
  return (
    <Pressable style={[styles.excard, done && { opacity: 0.7 }]} onPress={() => router.push({ pathname: '/university/exercise/[slug]', params: { slug: exercise.slug } })}>
      <Text style={[styles.eyebrow, { color: colors.olive }]}>{head}{done ? <Text style={{ color: colors.ok }}> · done ✓</Text> : null}</Text>
      <Text style={styles.excardTitle}>{exercise.title}</Text>
      {exercise.summary ? <Text style={styles.excardSummary} numberOfLines={3}>{exercise.summary}</Text> : null}
      {needsLabel(exercise.needs) ? <Text style={styles.meta}>{needsLabel(exercise.needs)}</Text> : null}
      {exercise.lesson ? (
        <View style={styles.teach}>
          <LessonThumb lesson={exercise.lesson} style={styles.teachThumb} badge={false} />
          <Text style={styles.teachText} numberOfLines={1}>{exercise.lesson.title}{exercise.lesson.duration ? ` · ${exercise.lesson.duration}` : ''}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function DoneButton({ slug, done, onToggle, block = true }) {
  return (
    <Pressable style={[styles.btn, done ? styles.btnOutline : styles.btnPrimary, block && { alignSelf: 'stretch' }]} onPress={() => onToggle(slug)}>
      <Text style={[styles.btnText, done ? { color: colors.ink } : { color: colors.onBrass }]}>{done ? 'Done ✓ · undo' : 'I did it ✓'}</Text>
    </Pressable>
  );
}

export function Btn({ label, onPress, primary = false, block = false, style }) {
  return (
    <Pressable style={[styles.btn, primary ? styles.btnPrimary : styles.btnOutline, block && { alignSelf: 'stretch' }, style]} onPress={onPress}>
      <Text style={[styles.btnText, { color: primary ? colors.onBrass : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Steps({ steps }) {
  if (!steps || steps.length === 0) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      {steps.map((s, i) => (
        <View key={i} style={styles.step}>
          <View style={styles.stepN}><Text style={styles.stepNText}>{i + 1}</Text></View>
          <Text style={styles.stepText}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

export const uni = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  stage: { padding: 16, paddingBottom: 130 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint },
  eyebrowPink: { color: colors.brass },
  eyebrowOlive: { color: colors.olive },
  h1: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 31, color: colors.ink, marginTop: 4, marginBottom: 8 },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim, marginBottom: 14 },
  label: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ink, marginTop: 20, marginBottom: 10 },
  labelSmall: { color: colors.inkFaint, textTransform: 'none', letterSpacing: 0 },
  meta: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint, marginTop: 3, lineHeight: 16 },
  box: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 14, marginBottom: 10 },
  boxEx: { borderLeftWidth: 3, borderLeftColor: colors.olive, backgroundColor: 'rgba(231,162,85,0.08)' },
  boxTitle: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink, marginTop: 4, marginBottom: 6 },
  boxText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  chips: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  chip: { fontFamily: fonts.mono, fontSize: 11.5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.surface2, color: colors.inkDim, overflow: 'hidden' },
  chipOn: { color: colors.brass, backgroundColor: 'rgba(248,95,115,0.14)' },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: 12, padding: 16, color: colors.inkDim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 14, marginTop: 20 }
});

const styles = StyleSheet.create({
  thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink, opacity: 0.9 },
  badge: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(12,19,31,0.82)', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 },
  badgeText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.surface2, borderRadius: 10, padding: 8, marginTop: 8 },
  rowThumb: { width: 84, borderRadius: 6 },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, lineHeight: 18 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.inkFaint },
  meta: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  topic: { width: '48%', flexGrow: 1, minHeight: 96, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 14, overflow: 'hidden', justifyContent: 'flex-end' },
  topicBlob: { position: 'absolute', right: -24, bottom: -30, width: 90, height: 90, borderRadius: 45, opacity: 0.25 },
  topicName: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  excard: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 14, marginBottom: 8 },
  excardTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink, marginTop: 4, marginBottom: 4 },
  excardSummary: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  teach: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface2, borderRadius: 8, padding: 6, marginTop: 8 },
  teachThumb: { width: 40, borderRadius: 4 },
  teachText: { flex: 1, fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  btn: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1 },
  btnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  btnOutline: { backgroundColor: 'transparent', borderColor: 'rgba(251,232,211,0.3)' },
  btnText: { fontFamily: fonts.monoBold, fontSize: 13 },
  step: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  stepN: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.olive, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNText: { fontFamily: fonts.mono, fontSize: 11, color: colors.olive },
  stepText: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.ink }
});
