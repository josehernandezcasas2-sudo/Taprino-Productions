import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiGet } from '../lib/api';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { pacificOffset, pacificLabel } from '../lib/channelTime';
import SmartImage from './SmartImage';

const PAPER_INK = '#241a05';

// Mirrors components/HomeOnNow.js on the website: the homepage's "On the
// telly" TV set showing what the main channel (TapaTV) is airing now, plus
// the next two programs. Polls GET /api/channel/now — refreshing right
// after the current program ends — and renders nothing when off air.
export default function HomeOnNow({ gutter }) {
  const router = useRouter();
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async () => {
      let next = 60000;
      try {
        const data = await apiGet('/api/channel/now');
        if (cancelled) return;
        setState(data);
        const endsAt = data.program && Date.parse(data.program.endsAt);
        if (endsAt) next = Math.min(next, Math.max(5000, endsAt - Date.now() + 2000));
      } catch {
        // Keep whatever we showed last; try again shortly.
      }
      if (!cancelled) timer = setTimeout(load, next);
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  if (!state || !state.onAir || !state.channel) return null;

  const { channel, live, program } = state;
  const offset = pacificOffset(state);
  const chNumber = String(channel.number || 1).padStart(2, '0');

  let title;
  let sub;
  if (live) {
    title = live.title;
    sub = 'Live broadcast';
  } else if (program.kind === 'episode' && program.seriesName) {
    title = program.seriesName;
    sub = [program.label, program.title].filter(Boolean).join(' · ');
  } else {
    title = program.kind === 'ad_break' ? 'Back after the break' : program.title;
    sub = null;
  }
  const until = !live && program.endsAt && offset != null ? `until ${pacificLabel(program.endsAt, offset)} PT` : null;
  const still = !live ? program.thumbnail : null;

  // Same as the website: a short loop repeats one title back to back, so
  // drop repeats rather than list "Next: X, Then: X" under X.
  const nextName = (n) => (n.seriesName ? `${n.seriesName}${n.label ? ` · ${n.label}` : ''}` : n.title);
  const upNext = [];
  let prevName = live ? live.title : program.kind === 'episode' && program.seriesName ? `${program.seriesName}${program.label ? ` · ${program.label}` : ''}` : program.title;
  for (const n of state.next || []) {
    if (n.kind === 'off_air' || upNext.length === 2) continue;
    const name = nextName(n);
    if (name !== prevName) upNext.push({ ...n, name });
    prevName = name;
  }

  return (
    <View style={styles.dept}>
      <View style={[styles.labelWrap, { paddingHorizontal: gutter }]}>
        <View style={styles.sticker}><Text style={styles.stickerText}>ON THE TELLY</Text></View>
      </View>
      <View style={{ paddingHorizontal: gutter }}>
        <Pressable
          onPress={() => router.push('/live')}
          accessibilityRole="button"
          accessibilityLabel={`Watch ${channel.name}: ${title}`}
          style={styles.tv}
        >
          <View style={styles.tvBody}>
            <View style={styles.screen}>
              {still ? <SmartImage uri={still} style={absoluteFill} /> : null}
              <Text style={styles.ch}>CH {chNumber}</Text>
              <View style={styles.bug}>
                <View style={styles.bugDot} />
                <Text style={styles.bugText}>{live ? 'LIVE' : 'ON NOW'}</Text>
              </View>
              <View style={styles.caption}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
                {(sub || until) ? <Text style={styles.sub} numberOfLines={1}>{[sub, until].filter(Boolean).join(' · ')}</Text> : null}
              </View>
            </View>
            <View style={styles.panel}>
              <Text style={styles.name}>{channel.name.toUpperCase()}</Text>
              <View style={styles.knobs}><View style={styles.knob} /><View style={styles.knob} /></View>
            </View>
          </View>
          <View style={styles.legs}><View style={styles.leg} /><View style={styles.leg} /></View>
        </Pressable>
        {upNext.length > 0 ? (
          <View style={styles.nextSlip}>
            {upNext.map((n, i) => (
              <Text key={`${n.startsAt}-${i}`} style={styles.nextLine}>
                <Text style={styles.nextTime}>{i === 0 ? 'NEXT' : 'THEN'} {pacificLabel(n.startsAt, offset)}  </Text>
                {n.name}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// From the .zine-tv-* rules in styles/globals.css (≤640px).
const styles = StyleSheet.create({
  dept: { paddingVertical: 17.6 },
  labelWrap: { marginBottom: 17.6 },
  sticker: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, transform: [{ rotate: '-2deg' }], backgroundColor: colors.mint },
  stickerText: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 0.3, color: PAPER_INK },

  tv: { marginHorizontal: 8, transform: [{ rotate: '1.5deg' }] },
  tvBody: { backgroundColor: colors.oceanInk, borderRadius: 18, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  screen: { aspectRatio: 16 / 9, backgroundColor: colors.surface3, borderWidth: 3, borderColor: colors.surface0, borderRadius: 12, overflow: 'hidden' },
  ch: { position: 'absolute', top: 10, right: 12, fontFamily: fonts.monoBold, fontSize: 14.4, color: colors.mint, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  bug: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.rust, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 2 },
  bugDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ink },
  bugText: { fontFamily: fonts.mono, fontSize: 9.3, color: colors.ink },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 19, paddingHorizontal: 12, paddingBottom: 10, backgroundColor: 'rgba(12,19,31,0.82)' },
  title: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 11.2, color: colors.inkDim, marginTop: 2 },
  panel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  name: { fontFamily: fonts.displayBold, fontSize: 12.8, letterSpacing: 0.5, color: colors.ink },
  knobs: { flexDirection: 'row', gap: 8 },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.surface0, borderWidth: 2, borderColor: colors.sky },
  legs: { flexDirection: 'row', justifyContent: 'center', gap: 70 },
  leg: { width: 6, height: 14, backgroundColor: colors.oceanInk },

  nextSlip: { marginTop: 19, backgroundColor: colors.ink, paddingVertical: 9.6, paddingHorizontal: 12.8, borderRadius: 2, transform: [{ rotate: '-1deg' }], gap: 3 },
  nextLine: { fontFamily: fonts.body, fontSize: 12.5, color: PAPER_INK },
  nextTime: { fontFamily: fonts.monoBold, fontSize: 9.9, color: PAPER_INK }
});
