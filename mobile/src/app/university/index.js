import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import { useProgress } from '../../lib/universityProgress';
import TopNav from '../../components/TopNav';
import { CourseCard, FileRow, Btn, Progress, uni } from '../../components/UniversityBits';

// Film University — the course catalogue (pages/university/index.js on the
// web, fed by /api/university/feed): continue where you left off,
// departments as a filter, courses as cards, a short Library shelf.
const INITIAL_COURSES = 6;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Where to continue from the device's ticks (signed-out viewers); the
// server does this for signed-in ones. Mirrors lib/university.js continueFrom.
function continueFrom(courses, lessonIndex, doneIds) {
  const done = new Set(doneIds);
  for (const c of courses) {
    const own = lessonIndex.filter((l) => l.courseId === c.id);
    const doneCount = own.filter((l) => done.has(l.id)).length;
    const next = own.find((l) => !done.has(l.id));
    if (doneCount > 0 && next) {
      const remaining = own.filter((l) => !done.has(l.id)).reduce((s, l) => s + (l.durationSeconds || 0), 0);
      return { course: c, lesson: next, doneCount, total: own.length, index: own.indexOf(next) + 1, remaining: remaining ? `${Math.round(remaining / 60)} min` : null };
    }
  }
  return null;
}

export default function University() {
  const router = useRouter();
  const { isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [refreshing, setRefreshing] = useState(false);
  const [dept, setDept] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const feed = state.feed || { departments: [], courses: [], library: [], lessonIndex: [], doneIds: null, continue: null };
  const { doneIds, isDone } = useProgress(feed.doneIds);

  const load = useCallback(async () => {
    try {
      const token = isSignedIn ? await withTimeout(getToken().catch(() => null), 4000) : null;
      const next = await apiGet('/api/university/feed', token);
      setState({ loading: false, error: null, feed: next });
    } catch (err) {
      setState((s) => ({ loading: false, error: s.feed ? null : err.message, feed: s.feed }));
    }
  }, [isSignedIn]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const cont = useMemo(() => {
    if (isSignedIn && feed.continue) return { ...feed.continue, lesson: { ...feed.continue.lesson, courseSlug: feed.continue.course.slug } };
    if (!doneIds.length) return null;
    const c = continueFrom(feed.courses, feed.lessonIndex, doneIds);
    return c ? { ...c, lesson: { ...c.lesson, courseSlug: c.course.slug } } : null;
  }, [isSignedIn, feed, doneIds]);

  const doneCountFor = (course) => feed.lessonIndex.filter((l) => l.courseId === course.id && isDone(l.id)).length;
  const matching = dept ? feed.courses.filter((c) => c.topicId === dept) : feed.courses;
  const visible = showAll ? matching : matching.slice(0, INITIAL_COURSES);
  const hidden = matching.length - visible.length;

  return (
    <SafeAreaView style={uni.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={uni.stage} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} />}>
        <Text style={[uni.eyebrow, uni.eyebrowPink]}>Studio Tapa · Free</Text>
        <Text style={uni.h1}>Film University</Text>
        <Text style={uni.lead}>Short courses on making films, writing them, and getting them seen. Each one comes with the files you'll use on a real shoot.</Text>

        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {!state.loading && !state.error && feed.courses.length === 0 && <Text style={uni.empty}>No courses published yet — the first ones are on their way.</Text>}

        {cont && (
          <View style={styles.cont}>
            <Text style={[uni.eyebrow, uni.eyebrowOlive]}>Continue · {cont.course.title}</Text>
            <Text style={styles.contTitle}>{cont.lesson.title}</Text>
            <Progress pct={Math.round((cont.doneCount / cont.total) * 100)} />
            <Text style={uni.meta}>Lesson {cont.index} of {cont.total}{cont.remaining ? ` · about ${cont.remaining} left` : ''}</Text>
            <Btn label="Continue →" primary block style={{ marginTop: 10 }} onPress={() => router.push({ pathname: '/university/lesson/[course]/[slug]', params: { course: cont.course.slug, slug: cont.lesson.slug } })} />
          </View>
        )}

        {feed.departments.length > 0 && (
          <>
            <Text style={uni.label}>Departments</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.depts}>
              <Pressable style={[styles.dept, !dept && styles.deptOn]} onPress={() => { setDept(null); setShowAll(false); }}><View style={[styles.dot, { backgroundColor: colors.brass }]} /><Text style={styles.deptText}>All</Text></Pressable>
              {feed.departments.map((d) => (
                <Pressable key={d.id} style={[styles.dept, dept === d.id && styles.deptOn]} onPress={() => { setDept(d.id); setShowAll(false); }}>
                  <View style={[styles.dot, { backgroundColor: d.accentColor }]} /><Text style={styles.deptText}>{d.name}</Text><Text style={styles.deptCount}>{d.courseCount}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {feed.courses.length > 0 && (
          <>
            <Text style={uni.label}>Courses <Text style={uni.labelSmall}>start anywhere</Text></Text>
            {visible.map((c) => <CourseCard key={c.id} course={c} doneCount={doneCountFor(c)} />)}
            {visible.length === 0 && <Text style={uni.empty}>No courses in this department yet.</Text>}
            {hidden > 0 && <Btn label={`See ${hidden} more`} block onPress={() => setShowAll(true)} />}
          </>
        )}

        {feed.library.length > 0 && (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={uni.label}>Library</Text>
              <Pressable onPress={() => router.push('/university/library')}><Text style={styles.link}>Open the library →</Text></Pressable>
            </View>
            {feed.library.slice(0, 4).map((f) => <FileRow key={f.id} file={f} showCourse />)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cont: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.olive, borderRadius: 14, padding: 14, marginTop: 4 },
  contTitle: { fontFamily: fonts.displayBold, fontSize: 19, lineHeight: 23, color: colors.ink, marginTop: 4, marginBottom: 4 },
  depts: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  dept: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline },
  deptOn: { borderColor: colors.brass },
  deptText: { fontFamily: fonts.displayBold, fontSize: 13.5, color: colors.ink },
  deptCount: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint },
  dot: { width: 9, height: 9, borderRadius: 5 },
  link: { fontFamily: fonts.mono, fontSize: 12, color: colors.brass }
});
