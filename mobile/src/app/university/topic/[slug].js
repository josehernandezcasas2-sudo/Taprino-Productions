import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet } from '../../../lib/api';
import { colors, fonts } from '../../../lib/theme';
import { lessonRoute, uni } from '../../../components/UniversityBits';

// A topic's lessons as a numbered path (pages/university/[topic]/index.js
// on the web, fed by /api/university/topic), with chips for just videos
// or just documents.
export default function Topic() {
  const { slug } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [kind, setKind] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    apiGet(`/api/university/topic?slug=${encodeURIComponent(slug)}`)
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, data: null }); });
    return () => { cancelled = true; };
  }, [slug]);

  const data = state.data;
  const lessons = data ? (kind === 'all' ? data.lessons : data.lessons.filter((l) => l.kind === kind)) : [];

  return (
    <SafeAreaView style={uni.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: data ? data.topic.name : 'Film University' }} />
      <ScrollView contentContainerStyle={uni.stage}>
        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {data && (
          <>
            <Pressable onPress={() => router.push('/university')}><Text style={uni.eyebrow}>‹ Film University</Text></Pressable>
            <Text style={uni.h1}>{data.topic.name}</Text>
            <Text style={uni.lead}>{data.topic.description ? `${data.topic.description} ` : ''}{data.lessons.length} lesson{data.lessons.length === 1 ? '' : 's'}.</Text>
            <View style={uni.chips}>
              <Pressable onPress={() => setKind('all')}><Text style={[uni.chip, kind === 'all' && uni.chipOn]}>All {data.lessons.length}</Text></Pressable>
              {data.videoCount > 0 && <Pressable onPress={() => setKind('video')}><Text style={[uni.chip, kind === 'video' && uni.chipOn]}>Videos {data.videoCount}</Text></Pressable>}
              {data.documentCount > 0 && <Pressable onPress={() => setKind('document')}><Text style={[uni.chip, kind === 'document' && uni.chipOn]}>Documents {data.documentCount}</Text></Pressable>}
            </View>
            {data.lessons.length === 0 && <Text style={uni.empty}>No lessons in this topic yet.</Text>}
            {lessons.map((l, i) => (
              <Pressable key={l.id} style={[styles.row, i === 0 && { borderTopWidth: 0 }]} onPress={() => router.push(lessonRoute(l))}>
                <Text style={styles.n}>{String(l.number).padStart(2, '0')}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.t}>{l.title}</Text>
                  <Text style={uni.meta}>{l.kind === 'video' ? '▶' : '¶'} {l.meta}{l.exerciseCount > 0 ? ' · exercise' : ''}</Text>
                </View>
                <Text style={styles.k}>›</Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: colors.hairline },
  n: { width: 28, fontFamily: fonts.mono, fontSize: 14, color: colors.inkFaint },
  t: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  k: { fontFamily: fonts.mono, fontSize: 18, color: colors.inkDim }
});
