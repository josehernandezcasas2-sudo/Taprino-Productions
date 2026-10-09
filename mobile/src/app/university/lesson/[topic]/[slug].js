import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiGet } from '../../../../lib/api';
import { colors } from '../../../../lib/theme';
import { useDoneMap } from '../../../../lib/universityDone';
import LessonVideo from '../../../../components/LessonVideo';
import { LessonRow, LessonThumb, DoneButton, Btn, needsLabel, uni } from '../../../../components/UniversityBits';

// One lesson (pages/university/[topic]/[lesson].js on the web, fed by
// /api/university/lesson): full-width player, or the document opened in
// the system viewer with a share/save option; the exercise right under
// it, the attached document, what's next.
export default function Lesson() {
  const { topic, slug } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [done, toggleDone] = useDoneMap();

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    apiGet(`/api/university/lesson?topic=${encodeURIComponent(topic)}&slug=${encodeURIComponent(slug)}`)
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, data: null }); });
    return () => { cancelled = true; };
  }, [topic, slug]);

  const data = state.data;
  const lesson = data ? data.lesson : null;

  return (
    <SafeAreaView style={uni.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: lesson ? lesson.title : 'Lesson' }} />
      <ScrollView contentContainerStyle={uni.stage}>
        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {data && (
          <>
            <Pressable onPress={() => router.push({ pathname: '/university/topic/[slug]', params: { slug: data.topic.slug } })}>
              <Text style={[uni.eyebrow, { marginBottom: 10 }]}>‹ {data.topic.name} · {lesson.number} of {data.total}</Text>
            </Pressable>

            {lesson.kind === 'video' ? (
              lesson.hasVideo ? (
                <LessonVideo lessonId={lesson.id} initialPlayback={data.playback} thumbnailUrl={lesson.thumbnailUrl} />
              ) : (
                <Text style={uni.empty}>This video is still being prepared — check back in a few minutes.</Text>
              )
            ) : lesson.documentUrl ? (
              <Pressable onPress={() => WebBrowser.openBrowserAsync(lesson.documentUrl)}>
                <LessonThumb lesson={lesson} />
                <Btn label="Open PDF" primary block style={{ marginTop: 10 }} onPress={() => WebBrowser.openBrowserAsync(lesson.documentUrl)} />
              </Pressable>
            ) : (
              <Text style={uni.empty}>This document isn't uploaded yet.</Text>
            )}

            <Text style={[uni.h1, { fontSize: 22, lineHeight: 26, marginTop: 12 }]}>{lesson.title}</Text>
            {lesson.description ? <Text style={uni.lead}>{lesson.description}</Text> : null}

            {data.exercises.map((ex) => (
              <View key={ex.id} style={[uni.box, uni.boxEx]}>
                <Text style={[uni.eyebrow, uni.eyebrowOlive]}>Exercise{ex.minutes ? ` · ${ex.minutes} min` : ''}</Text>
                <Text style={uni.boxTitle}>{ex.title}</Text>
                {ex.summary ? <Text style={[uni.boxText, { color: colors.ink }]}>{ex.summary}</Text> : null}
                {needsLabel(ex.needs) ? <Text style={uni.meta}>{needsLabel(ex.needs)}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <DoneButton slug={ex.slug} done={Boolean(done[ex.slug])} onToggle={toggleDone} block={false} />
                  <Btn label="Steps →" onPress={() => router.push({ pathname: '/university/exercise/[slug]', params: { slug: ex.slug } })} />
                </View>
              </View>
            ))}

            {data.attachment ? (
              <View style={uni.box}>
                <Text style={uni.eyebrow}>Attached document</Text>
                <Text style={uni.boxTitle}>{data.attachment.title}</Text>
                {data.attachment.description ? <Text style={[uni.boxText, { marginBottom: 8 }]}>{data.attachment.description}</Text> : null}
                <Btn label="Open PDF" onPress={() => WebBrowser.openBrowserAsync(data.attachment.documentUrl)} />
              </View>
            ) : null}

            {data.next ? (
              <View style={uni.box}>
                <Text style={uni.eyebrow}>Up next</Text>
                <LessonRow lesson={data.next} />
              </View>
            ) : (
              <View style={uni.box}>
                <Text style={uni.eyebrow}>That's the last one in {data.topic.name}</Text>
                <Btn label="Back to the Workshop →" style={{ marginTop: 8 }} onPress={() => router.push('/university')} />
              </View>
            )}
            {data.previous ? (
              <View style={uni.box}>
                <Text style={uni.eyebrow}>Before this</Text>
                <LessonRow lesson={data.previous} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
