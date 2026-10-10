import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import { useProgress } from '../../../lib/universityProgress';
import LessonVideo from '../../../components/LessonVideo';
import { Syllabus, FileRow, Tabs, Btn, Progress, lessonRoute, uni } from '../../../components/UniversityBits';

// A course (pages/university/[course]/index.js on the web, fed by
// /api/university/course): the syllabus with ticks, Materials and
// Examples tabs, the course facts, and one Continue that knows where you are.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

export default function Course() {
  const { slug } = useLocalSearchParams();
  const router = useRouter();
  const { isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tab, setTab] = useState('syllabus');
  const [playing, setPlaying] = useState(null);
  const data = state.data;
  const { isDone } = useProgress(data ? data.doneIds : null);

  const load = useCallback(async () => {
    try {
      const token = isSignedIn ? await withTimeout(getToken().catch(() => null), 4000) : null;
      const next = await apiGet(`/api/university/course?slug=${encodeURIComponent(slug)}`, token);
      setState({ loading: false, error: null, data: next });
    } catch (err) {
      setState((s) => ({ loading: false, error: s.data ? null : err.message, data: s.data }));
    }
  }, [slug, isSignedIn]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const lessons = data ? data.lessons : [];
  const doneCount = lessons.filter((l) => isDone(l.id)).length;
  const next = lessons.find((l) => !isDone(l.id)) || null;
  const tabs = data ? [
    { key: 'syllabus', label: 'Syllabus' },
    { key: 'materials', label: 'Materials', count: data.materials.length },
    ...(data.examples.length ? [{ key: 'examples', label: 'Examples', count: data.examples.length }] : [])
  ] : [];

  return (
    <SafeAreaView style={uni.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: data ? data.course.title : 'Course' }} />
      <ScrollView contentContainerStyle={uni.stage}>
        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {data && (
          <>
            <Pressable onPress={() => router.push('/university')}><Text style={uni.eyebrow}>‹ Film University · {data.course.topicName}</Text></Pressable>
            <Text style={[uni.eyebrow, uni.eyebrowOlive, { marginTop: 10 }]}>{[data.course.levelLabel, `${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`, data.course.length].filter(Boolean).join(' · ')}</Text>
            <Text style={uni.h1}>{data.course.title}</Text>
            {data.course.description ? <Text style={uni.lead}>{data.course.description}</Text> : null}
            {next ? (
              <Btn label={doneCount ? `Continue · lesson ${next.number || lessons.indexOf(next) + 1} →` : 'Start the course →'} primary block onPress={() => router.push(lessonRoute(next))} />
            ) : lessons.length ? (
              <Btn label="All done ✓ · watch again" block onPress={() => router.push(lessonRoute(lessons[0]))} />
            ) : null}
            {lessons.length > 0 ? <Text style={[uni.meta, { marginTop: 8 }]}>{doneCount} of {lessons.length} done</Text> : null}
            {lessons.length > 0 ? <Progress pct={Math.round((doneCount / lessons.length) * 100)} /> : null}

            <Tabs tabs={tabs} active={tab} onPick={setTab} />
            {tab === 'syllabus' && (lessons.length ? <Syllabus syllabus={data.syllabus} isDone={isDone} currentId={next ? next.id : null} /> : <Text style={uni.empty}>No lessons published yet.</Text>)}
            {tab === 'materials' && (data.materials.length ? data.materials.map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />) : <Text style={uni.empty}>No files for this course yet.</Text>)}
            {tab === 'examples' && (
              <>
                {playing ? (
                  <View style={[uni.box, { borderColor: 'rgba(147,208,164,0.35)' }]}>
                    <Text style={[uni.eyebrow, uni.eyebrowMint]}>Example</Text>
                    <Text style={uni.boxTitle}>{playing.title}</Text>
                    <LessonVideo fileId={playing.id} />
                    <Btn label="Close" small style={{ marginTop: 10 }} onPress={() => setPlaying(null)} />
                  </View>
                ) : null}
                {data.examples.map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />)}
              </>
            )}

            <View style={[uni.box, { marginTop: 16 }]}>
              <Text style={uni.eyebrow}>About this course</Text>
              <View style={[uni.fact, { borderTopWidth: 0, marginTop: 6 }]}><Text style={uni.factK}>Level</Text><Text style={uni.factV}>{data.course.levelLabel}</Text></View>
              <View style={uni.fact}><Text style={uni.factK}>Length</Text><Text style={uni.factV}>{[data.course.length ? `${data.course.length} of video` : null, data.course.pages ? `${data.course.pages} pages` : null].filter(Boolean).join(' · ') || `${lessons.length} lessons`}</Text></View>
              {data.course.needs ? <View style={uni.fact}><Text style={uni.factK}>You'll need</Text><Text style={uni.factV}>{data.course.needs}</Text></View> : null}
              {data.course.assignmentCount ? <View style={uni.fact}><Text style={uni.factK}>Assignments</Text><Text style={uni.factV}>{data.course.assignmentCount}</Text></View> : null}
            </View>
            {data.nextCourse ? (
              <Pressable style={[uni.box, { borderStyle: 'dashed', backgroundColor: 'transparent' }]} onPress={() => router.push({ pathname: '/university/course/[slug]', params: { slug: data.nextCourse.slug } })}>
                <Text style={uni.eyebrow}>After this</Text>
                <Text style={uni.boxTitle}>{data.nextCourse.title}</Text>
                {data.nextCourse.description ? <Text style={uni.boxText}>{data.nextCourse.description}</Text> : null}
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
