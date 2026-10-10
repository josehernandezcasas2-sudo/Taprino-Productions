import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import { apiGet } from '../../../../lib/api';
import { colors } from '../../../../lib/theme';
import { useProgress } from '../../../../lib/universityProgress';
import LessonVideo from '../../../../components/LessonVideo';
import { Syllabus, FileRow, Tabs, Btn, Steps, lessonRoute, uni } from '../../../../components/UniversityBits';

// One lesson (pages/university/[course]/[lesson].js on the web, fed by
// /api/university/lesson): full-width player or the reading opened in the
// system viewer; tabs Overview / Files / Examples / Assignment (only the
// ones with content); the course syllabus in miniature; Mark done · next.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

export default function Lesson() {
  const { course, slug } = useLocalSearchParams();
  const router = useRouter();
  const { isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tab, setTab] = useState('overview');
  const [playing, setPlaying] = useState(null);
  const data = state.data;
  const { isDone, toggle } = useProgress(data ? data.doneIds : null);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    setTab('overview');
    setPlaying(null);
    (async () => {
      try {
        const token = isSignedIn ? await withTimeout(getToken().catch(() => null), 4000) : null;
        const next = await apiGet(`/api/university/lesson?course=${encodeURIComponent(course)}&slug=${encodeURIComponent(slug)}`, token);
        if (!cancelled) setState({ loading: false, error: null, data: next });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [course, slug, isSignedIn]);

  const lesson = data ? data.lesson : null;
  const done = lesson ? isDone(lesson.id) : false;
  const tabs = lesson ? [
    { key: 'overview', label: 'Overview' },
    ...(data.files.length ? [{ key: 'files', label: 'Files', count: data.files.length }] : []),
    ...(data.examples.length ? [{ key: 'examples', label: 'Examples', count: data.examples.length }] : []),
    ...(lesson.assignment ? [{ key: 'assignment', label: 'Assignment' }] : [])
  ] : [];

  function markDoneAndNext() {
    if (!done) toggle(lesson.id);
    if (data.next) router.replace(lessonRoute(data.next));
    else router.replace({ pathname: '/university/course/[slug]', params: { slug: data.course.slug } });
  }

  return (
    <SafeAreaView style={uni.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: lesson ? lesson.title : 'Lesson' }} />
      <ScrollView contentContainerStyle={uni.stage}>
        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {data && lesson && (
          <>
            <Pressable onPress={() => router.push({ pathname: '/university/course/[slug]', params: { slug: data.course.slug } })}>
              <Text style={[uni.eyebrow, { marginBottom: 10 }]}>‹ {data.course.title} · {lesson.number} of {data.total}</Text>
            </Pressable>

            {lesson.kind === 'video' ? (
              lesson.hasVideo ? <LessonVideo lessonId={lesson.id} initialPlayback={data.playback} /> : <Text style={uni.empty}>This video is still being prepared — check back in a few minutes.</Text>
            ) : lesson.documentUrl ? (
              <Btn label="¶ Open the reading (PDF)" primary block onPress={() => WebBrowser.openBrowserAsync(lesson.documentUrl)} />
            ) : (
              <Text style={uni.empty}>This reading isn't uploaded yet.</Text>
            )}

            <Text style={[uni.eyebrow, { marginTop: 12 }]}>{[data.moduleTitle, `lesson ${lesson.number} of ${data.total}`, lesson.kind === 'video' ? lesson.duration : lesson.documentPages ? `${lesson.documentPages} pages` : null].filter(Boolean).join(' · ')}</Text>
            <Text style={[uni.h1, { fontSize: 22, lineHeight: 26 }]}>{lesson.title}</Text>

            <Tabs tabs={tabs} active={tab} onPick={setTab} />
            {tab === 'overview' && (
              <>
                {lesson.description ? <Text style={uni.lead}>{lesson.description}</Text> : <Text style={uni.meta}>No notes for this lesson.</Text>}
                {lesson.assignment ? (
                  <View style={[uni.box, uni.boxEx]}>
                    <Text style={[uni.eyebrow, uni.eyebrowOlive]}>Assignment{lesson.assignment.minutes ? ` · ${lesson.assignment.minutes} min` : ''}</Text>
                    <Text style={uni.boxTitle}>{lesson.assignment.title}</Text>
                    <Text style={[uni.boxText, { color: colors.ink }]}>{lesson.assignment.summary}</Text>
                    {lesson.assignment.steps.length ? <Btn label="Steps →" small style={{ marginTop: 10 }} onPress={() => setTab('assignment')} /> : null}
                  </View>
                ) : null}
                {data.files.slice(0, 2).map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />)}
              </>
            )}
            {tab === 'files' && data.files.map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />)}
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
            {tab === 'assignment' && lesson.assignment ? (
              <View style={[uni.box, uni.boxEx]}>
                <Text style={[uni.eyebrow, uni.eyebrowOlive]}>Assignment{lesson.assignment.minutes ? ` · ${lesson.assignment.minutes} min` : ''}</Text>
                <Text style={uni.boxTitle}>{lesson.assignment.title}</Text>
                <Text style={[uni.boxText, { color: colors.ink }]}>{lesson.assignment.summary}</Text>
                <Steps steps={lesson.assignment.steps} />
                <Btn label={done ? 'Done ✓ · undo' : 'Mark done ✓'} primary={!done} style={{ marginTop: 6 }} onPress={() => toggle(lesson.id)} />
              </View>
            ) : null}

            <Btn
              label={done ? (data.next ? 'Next lesson →' : 'Back to the course →') : data.next ? 'Mark done · next lesson →' : 'Mark done · finish course ✓'}
              primary={!done}
              block
              style={{ marginTop: 14 }}
              onPress={markDoneAndNext}
            />
            {done ? <Btn label="Un-mark this lesson" small style={{ marginTop: 8 }} onPress={() => toggle(lesson.id)} /> : null}

            <Text style={uni.label}>{data.course.title} <Text style={uni.labelSmall}>{data.syllabus.reduce((n, g) => n + g.lessons.filter((l) => isDone(l.id)).length, 0)} of {data.total} done</Text></Text>
            <Syllabus syllabus={data.syllabus} isDone={isDone} currentId={lesson.id} compact />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
