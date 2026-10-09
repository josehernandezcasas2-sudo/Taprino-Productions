import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiGet } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import { useDoneMap } from '../../../lib/universityDone';
import LessonVideo from '../../../components/LessonVideo';
import { ExerciseCard, LessonRow, LessonThumb, DoneButton, Btn, Steps, needsLabel, lessonRoute, uni } from '../../../components/UniversityBits';

// One exercise (pages/university/exercise/[slug].js on the web, fed by
// /api/university/exercise): the steps, the lesson that teaches it played
// right here, the template to use with it, "I did it".
export default function Exercise() {
  const { slug } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [done, toggleDone] = useDoneMap();

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    apiGet(`/api/university/exercise?slug=${encodeURIComponent(slug)}`)
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, data: null }); });
    return () => { cancelled = true; };
  }, [slug]);

  const exercise = state.data ? state.data.exercise : null;
  const playback = state.data ? state.data.playback : null;
  const others = state.data ? state.data.others.slice(0, 3) : [];

  return (
    <SafeAreaView style={uni.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: exercise ? exercise.title : 'Exercise' }} />
      <ScrollView contentContainerStyle={uni.stage}>
        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {exercise && (
          <>
            <Pressable onPress={() => router.push('/university')}><Text style={uni.eyebrow}>‹ Workshop</Text></Pressable>
            <Text style={[uni.eyebrow, uni.eyebrowOlive, { marginTop: 10 }]}>
              {[exercise.topicName, exercise.minutes ? `${exercise.minutes} min` : null].filter(Boolean).join(' · ') || 'Exercise'}
            </Text>
            <Text style={uni.h1}>{exercise.title}</Text>
            {exercise.summary ? <Text style={uni.lead}>{exercise.summary}</Text> : null}
            <Steps steps={exercise.steps} />
            {needsLabel(exercise.needs) ? <Text style={[uni.meta, { marginBottom: 12 }]}>{needsLabel(exercise.needs)}</Text> : null}

            {exercise.lesson ? (
              <>
                <Text style={uni.label}>Watch to do it</Text>
                {exercise.lesson.kind === 'video' ? (
                  <LessonVideo lessonId={exercise.lesson.id} initialPlayback={playback} thumbnailUrl={exercise.lesson.thumbnailUrl} />
                ) : (
                  <Pressable onPress={() => router.push(lessonRoute(exercise.lesson))}><LessonThumb lesson={exercise.lesson} /></Pressable>
                )}
                <LessonRow lesson={exercise.lesson} label={exercise.lesson.kind === 'video' ? 'Lesson' : 'Read'} />
                {exercise.extraLessons.map((l) => <LessonRow key={l.id} lesson={l} label="Also" />)}
              </>
            ) : exercise.extraLessons.length > 0 ? (
              <>
                <Text style={uni.label}>Watch to do it</Text>
                {exercise.extraLessons.map((l) => <LessonRow key={l.id} lesson={l} />)}
              </>
            ) : null}

            {exercise.template ? (
              <View style={[uni.box, { marginTop: 14 }]}>
                <Text style={uni.eyebrow}>Use with</Text>
                <Text style={uni.boxTitle}>{exercise.template.title}</Text>
                <Text style={[uni.meta, { marginBottom: 10 }]}>{exercise.template.meta}</Text>
                <Btn label="Open PDF" onPress={() => WebBrowser.openBrowserAsync(exercise.template.documentUrl)} />
              </View>
            ) : null}

            <View style={{ marginTop: 14 }}>
              <DoneButton slug={exercise.slug} done={Boolean(done[exercise.slug])} onToggle={toggleDone} />
            </View>

            {others.length > 0 && (
              <>
                <Text style={uni.label}>More exercises</Text>
                {others.map((e) => <ExerciseCard key={e.id} exercise={e} done={Boolean(done[e.slug])} />)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({});
