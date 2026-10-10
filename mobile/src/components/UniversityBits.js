import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, absoluteFill } from '../lib/theme';
import SmartImage from './SmartImage';

// Shared pieces for the Film University screens (mobile/src/app/university/*),
// mirroring components/university/LessonBits.js on the website.

export function courseRoute(course) {
  return { pathname: '/university/course/[slug]', params: { slug: course.slug } };
}
export function lessonRoute(lesson) {
  return { pathname: '/university/lesson/[course]/[slug]', params: { course: lesson.courseSlug, slug: lesson.slug } };
}

export function CourseCard({ course, doneCount = 0 }) {
  const router = useRouter();
  const started = doneCount > 0;
  const finished = started && doneCount >= course.lessonCount;
  const pct = course.lessonCount ? Math.round((doneCount / course.lessonCount) * 100) : 0;
  return (
    <Pressable style={styles.course} onPress={() => router.push(courseRoute(course))}>
      <View style={styles.cover}>
        {course.coverUrl
          ? <SmartImage uri={course.coverUrl} style={absoluteFill} resizeMode="cover" />
          : <LinearGradient colors={[`${course.accentColor}66`, colors.surface2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={absoluteFill} />}
      </View>
      <View style={styles.courseBody}>
        <Text style={[uni.eyebrow, uni.eyebrowOlive]}>{course.topicName} · {course.levelLabel}</Text>
        <Text style={styles.courseTitle}>{course.title}</Text>
        {course.description ? <Text style={styles.courseDesc} numberOfLines={2}>{course.description}</Text> : null}
        {started ? <Progress pct={pct} /> : null}
        <View style={styles.courseFoot}>
          <Text style={uni.meta}>{course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'}{course.length ? ` · ${course.length}` : ''}{course.materialCount ? ` · ¶ ${course.materialCount} file${course.materialCount === 1 ? '' : 's'}` : ''}</Text>
          <Text style={[styles.pill, started && !finished && styles.pillPrimary]}>{finished ? 'Done ✓' : started ? 'Continue' : 'Start'}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function Progress({ pct }) {
  return <View style={styles.prog}><View style={[styles.progFill, { width: `${pct}%` }]} /></View>;
}

const FILE_LABEL = { pdf: 'PDF', xlsx: 'XLSX', csv: 'CSV', docx: 'DOCX', txt: 'TXT', fdx: 'FDX', pptx: 'PPTX', zip: 'ZIP', img: 'IMG', lut: 'LUT', audio: 'AUD', project: 'PRJ', video: 'VID', other: 'FILE' };
const FILE_BG = { xlsx: '#d7efe0', csv: '#d7efe0', docx: '#dfe6f7', txt: '#dfe6f7', fdx: '#dfe6f7', zip: '#e9dcc9', project: '#e9dcc9', img: '#efd9e0', lut: '#efd9e0', audio: '#e6dff5' };

// A file row: downloads open in the in-app browser (where iOS offers
// share / save to Files); video examples call onPlay.
export function FileRow({ file, showCourse = false, onPlay }) {
  const t = file.kind === 'video' ? 'video' : file.fileType || 'other';
  const meta = [showCourse ? file.topicName : null, file.meta, file.lessonTitle ? `“${file.lessonTitle}”` : null].filter(Boolean).join(' · ');
  const press = () => (file.kind === 'video' ? onPlay && onPlay(file) : WebBrowser.openBrowserAsync(file.fileUrl));
  return (
    <Pressable style={styles.file} onPress={press}>
      {file.thumbnailUrl
        ? <SmartImage uri={file.thumbnailUrl} style={styles.fileThumb} resizeMode="cover" />
        : <View style={[styles.fileIc, t === 'video' ? styles.fileIcVideo : { backgroundColor: FILE_BG[t] || colors.ink }]}><Text style={[styles.fileIcText, t === 'video' && { color: colors.ink }]}>{FILE_LABEL[t] || 'FILE'}</Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.fileTitle} numberOfLines={2}>{file.title}</Text>
        <Text style={uni.meta}>{meta}</Text>
      </View>
      <Text style={styles.fileAct}>{file.kind === 'video' ? '▶' : 'Open'}</Text>
    </Pressable>
  );
}

// The syllabus: module headings, numbered lessons with tick / "you are
// here" ring.
export function Syllabus({ syllabus, isDone, currentId, compact = false }) {
  const router = useRouter();
  return (
    <View style={styles.syl}>
      {syllabus.map((group, gi) => (
        <View key={group.id || `g${gi}`}>
          {group.title ? <Text style={styles.mod}>{group.title}</Text> : null}
          {group.lessons.map((l, i) => {
            const done = isDone(l.id);
            const now = l.id === currentId;
            return (
              <Pressable key={l.id} style={[styles.srow, (gi > 0 || i > 0 || group.title) && styles.srowBorder, now && styles.srowNow]} onPress={() => router.push(lessonRoute(l))}>
                <View style={[styles.cb, done && styles.cbOn, now && !done && styles.cbNow]}>
                  <Text style={[styles.cbText, done && { color: '#0f1f12' }, now && !done && { color: colors.olive }]}>{done ? '✓' : now ? '●' : ''}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.srowT, done && { color: colors.inkDim }, compact && { fontSize: 13.5 }]}>{compact ? l.title : `${String(l.number).padStart(2, '0')}  ${l.title}`}</Text>
                  {!compact ? <Text style={uni.meta}>{l.meta}</Text> : null}
                </View>
                <Text style={styles.srowK}>{compact ? (l.kind === 'video' ? l.duration || '▶' : '¶') : now ? 'up next' : done ? 'done' : l.kind === 'video' ? '▶' : '¶'}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function Btn({ label, onPress, primary = false, block = false, style, small = false }) {
  return (
    <Pressable style={[styles.btn, primary ? styles.btnPrimary : styles.btnOutline, block && { alignSelf: 'stretch' }, small && { paddingVertical: 8, paddingHorizontal: 14 }, style]} onPress={onPress}>
      <Text style={[styles.btnText, { color: primary ? colors.onBrass : colors.ink }, small && { fontSize: 12 }]}>{label}</Text>
    </Pressable>
  );
}

export function Tabs({ tabs, active, onPick }) {
  return (
    <View style={styles.tabs}>
      {tabs.map((t) => (
        <Pressable key={t.key} onPress={() => onPick(t.key)} style={[styles.tab, active === t.key && styles.tabOn]}>
          <Text style={[styles.tabText, active === t.key && { color: colors.ink }]}>{t.label}{t.count != null ? ` · ${t.count}` : ''}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Steps({ steps }) {
  if (!steps || steps.length === 0) return null;
  return (
    <View style={{ marginTop: 10 }}>
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
  eyebrowMint: { color: colors.mint },
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
  empty: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: 12, padding: 16, color: colors.inkDim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 14, marginTop: 20 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.hairline },
  factK: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  factV: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.ink, flexShrink: 1, textAlign: 'right' }
});

const styles = StyleSheet.create({
  course: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface2 },
  courseBody: { padding: 12, gap: 4 },
  courseTitle: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 21, color: colors.ink },
  courseDesc: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  courseFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6 },
  pill: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.ink, borderWidth: 1, borderColor: 'rgba(251,232,211,0.3)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, overflow: 'hidden' },
  pillPrimary: { backgroundColor: colors.brass, borderColor: colors.brass, color: colors.onBrass },
  prog: { height: 4, borderRadius: 999, backgroundColor: colors.surface3, overflow: 'hidden', marginTop: 6 },
  progFill: { height: 4, backgroundColor: colors.ok },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 10, marginBottom: 8 },
  fileThumb: { width: 64, aspectRatio: 16 / 9, borderRadius: 5, backgroundColor: colors.surface2 },
  fileIc: { width: 36, height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 },
  fileIcVideo: { backgroundColor: '#2a2340' },
  fileIcText: { fontFamily: fonts.monoBold, fontSize: 8.5, color: '#1a1408' },
  fileTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink, lineHeight: 18 },
  fileAct: { fontFamily: fonts.mono, fontSize: 12, color: colors.brass },
  syl: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, overflow: 'hidden' },
  mod: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.inkFaint, backgroundColor: colors.surface2, paddingHorizontal: 14, paddingVertical: 8 },
  srow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
  srowBorder: { borderTopWidth: 1, borderTopColor: colors.hairline },
  srowNow: { backgroundColor: 'rgba(231,162,85,0.07)' },
  srowT: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  srowK: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim },
  cb: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.inkFaint, alignItems: 'center', justifyContent: 'center' },
  cbOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  cbNow: { borderColor: colors.olive },
  cbText: { fontFamily: fonts.monoBold, fontSize: 9, color: colors.inkFaint },
  btn: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1 },
  btnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  btnOutline: { backgroundColor: 'transparent', borderColor: 'rgba(251,232,211,0.3)' },
  btnText: { fontFamily: fonts.monoBold, fontSize: 13 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.hairline, marginTop: 8, marginBottom: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.brass },
  tabText: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  step: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  stepN: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.olive, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNText: { fontFamily: fonts.mono, fontSize: 11, color: colors.olive },
  stepText: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.ink }
});
