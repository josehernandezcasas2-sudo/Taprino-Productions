import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiGet } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import { useDoneMap } from '../../lib/universityDone';
import TopNav from '../../components/TopNav';
import { ExerciseCard, TopicCard, LessonThumb, LessonRow, DoneButton, Btn, Steps, needsLabel, lessonRoute, uni } from '../../components/UniversityBits';

// Film University — the Workshop (pages/university/index.js on the web,
// fed by /api/university/feed): one exercise to try today with the video
// to watch right under it, every exercise with filters, then the lessons
// by topic and the templates shelf. Free, no sign-in.
const TIME_FILTERS = [
  { key: 'short', label: 'Under 15 min', test: (m) => m != null && m < 15 },
  { key: 'mid', label: '15–30 min', test: (m) => m != null && m >= 15 && m <= 30 },
  { key: 'long', label: '30+ min', test: (m) => m != null && m > 30 }
];
const NEED_FILTERS = [
  { key: 'nothing', label: 'Needs nothing' },
  { key: 'phone', label: 'A phone' },
  { key: 'camera', label: 'A camera' },
  { key: 'scene', label: 'A scene' },
  { key: 'person', label: 'Another person' },
  { key: 'footage', label: 'Footage' }
];

export default function University() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState({ kind: 'all', value: null });
  const [todayIndex, setTodayIndex] = useState(-1);
  const [done, toggleDone] = useDoneMap();

  const load = useCallback(async () => {
    try {
      const feed = await apiGet('/api/university/feed');
      setState({ loading: false, error: null, feed });
    } catch (err) {
      setState((s) => ({ loading: false, error: s.feed ? null : err.message, feed: s.feed }));
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const feed = state.feed || { today: null, exercises: [], topics: [], templates: [], lessonCount: 0 };
  const today = useMemo(() => {
    if (!feed.today) return null;
    if (todayIndex < 0) return feed.today;
    const others = feed.exercises.filter((e) => e.id !== feed.today.id);
    return others.length ? others[todayIndex % others.length] : feed.today;
  }, [feed, todayIndex]);

  const topicsInUse = feed.topics.filter((t) => feed.exercises.some((e) => e.topicId === t.id));
  const needsInUse = NEED_FILTERS.filter((n) => feed.exercises.some((e) => e.needs.includes(n.key)));
  const timesInUse = TIME_FILTERS.filter((t) => feed.exercises.some((e) => t.test(e.minutes)));
  const visible = feed.exercises.filter((e) => {
    if (filter.kind === 'all') return true;
    if (filter.kind === 'time') return TIME_FILTERS.find((t) => t.key === filter.value).test(e.minutes);
    if (filter.kind === 'need') return e.needs.includes(filter.value);
    if (filter.kind === 'topic') return e.topicId === filter.value;
    return true;
  });

  const chip = (kind, value, label) => {
    const on = filter.kind === kind && filter.value === value;
    return (
      <Pressable key={`${kind}-${value}`} onPress={() => setFilter({ kind, value })}>
        <Text style={[uni.chip, on && uni.chipOn]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={uni.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={uni.stage} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} />}>
        <Text style={[uni.eyebrow, uni.eyebrowPink]}>Film University · Free</Text>
        <Text style={uni.h1}>Workshop</Text>
        <Text style={uni.lead}>Pick an exercise, do it today, watch what you need along the way.</Text>

        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {!state.loading && !state.error && feed.exercises.length === 0 && feed.topics.length === 0 && (
          <Text style={uni.empty}>Nothing here yet — the first lessons and exercises are on their way.</Text>
        )}

        {today && (
          <View style={styles.today}>
            <Text style={[uni.eyebrow, uni.eyebrowOlive]}>
              {todayIndex < 0 ? 'Today' : 'Another one'}{today.topicName ? ` · ${today.topicName}` : ''}{today.minutes ? ` · ${today.minutes} min` : ''}
            </Text>
            <Text style={styles.todayTitle}>{today.title}</Text>
            {today.summary ? <Text style={styles.todayText}>{today.summary}</Text> : null}
            <Steps steps={today.steps} />
            {needsLabel(today.needs) ? <Text style={[uni.meta, { marginBottom: 10 }]}>{needsLabel(today.needs)}</Text> : null}
            <Btn label="Start →" primary block onPress={() => router.push({ pathname: '/university/exercise/[slug]', params: { slug: today.slug } })} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <DoneButton slug={today.slug} done={Boolean(done[today.slug])} onToggle={toggleDone} block={false} />
              {feed.exercises.length > 1 && <Btn label="Show me another" onPress={() => setTodayIndex((i) => (i < 0 ? Math.floor(Math.random() * Math.max(1, feed.exercises.length - 1)) : i + 1))} />}
            </View>
            {today.lesson ? (
              <>
                <Text style={[uni.label, { marginTop: 14 }]}>Watch to do it</Text>
                <Pressable onPress={() => router.push(lessonRoute(today.lesson))}>
                  <LessonThumb lesson={today.lesson} />
                  <Text style={[uni.meta, { marginTop: 6 }]}>{today.lesson.kind === 'video' ? '▶' : '¶'} {today.lesson.title}{today.lesson.duration ? ` · ${today.lesson.duration}` : ''}</Text>
                </Pressable>
              </>
            ) : null}
            {today.extraLessons.map((l) => <LessonRow key={l.id} lesson={l} />)}
            {today.template ? (
              <>
                <Text style={[uni.label, { marginTop: 14 }]}>Use with</Text>
                <Btn label={`¶ ${today.template.title} · open PDF`} onPress={() => WebBrowser.openBrowserAsync(today.template.documentUrl)} />
              </>
            ) : null}
          </View>
        )}

        {feed.exercises.length > 0 && (
          <>
            <Text style={uni.label}>All exercises <Text style={uni.labelSmall}>{feed.exercises.length}</Text></Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={uni.chips}>
              {chip('all', null, `All ${feed.exercises.length}`)}
              {timesInUse.map((t) => chip('time', t.key, t.label))}
              {needsInUse.map((n) => chip('need', n.key, n.label))}
              {topicsInUse.map((t) => chip('topic', t.id, t.name))}
            </ScrollView>
            {visible.map((e) => <ExerciseCard key={e.id} exercise={e} done={Boolean(done[e.slug])} />)}
            {visible.length === 0 && <Text style={uni.empty}>No exercises match that filter yet.</Text>}
          </>
        )}

        {feed.topics.length > 0 && (
          <>
            <Text style={uni.label}>Lessons by topic <Text style={uni.labelSmall}>{feed.lessonCount} lessons</Text></Text>
            <View style={uni.grid2}>
              {feed.topics.map((t) => <TopicCard key={t.id} topic={t} />)}
            </View>
          </>
        )}

        {feed.templates.length > 0 && (
          <>
            <Text style={uni.label}>Templates <Text style={uni.labelSmall}>download, fill in, shoot</Text></Text>
            {feed.templates.map((l) => (
              <Pressable key={l.id} style={styles.tpl} onPress={() => WebBrowser.openBrowserAsync(l.documentUrl)}>
                <View style={styles.tplIcon}><Text style={styles.tplIconText}>PDF</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplTitle}>{l.title}</Text>
                  <Text style={uni.meta}>{l.topicName ? `${l.topicName} · ` : ''}{l.meta}</Text>
                </View>
                <Text style={styles.tplOpen}>Open</Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  today: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.olive, borderRadius: 14, padding: 16, marginTop: 4 },
  todayTitle: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 26, color: colors.ink, marginTop: 4, marginBottom: 8 },
  todayText: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkDim, marginBottom: 12 },
  tpl: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 12, marginBottom: 8 },
  tplIcon: { width: 36, height: 46, borderRadius: 4, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 },
  tplIconText: { fontFamily: fonts.mono, fontSize: 9, color: colors.mint },
  tplTitle: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  tplOpen: { fontFamily: fonts.mono, fontSize: 12, color: colors.brass }
});
