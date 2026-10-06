import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet, apiPost } from '../lib/api';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { formatClock, pacificLabel, pacificOffset } from '../lib/channelTime';

const SAFETY_POLL_MS = 45000;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Mirrors components/ChannelPlayer.js on the website: plays whatever is on
// the channel right now, from wherever it is right now, and retunes when
// the next program starts. The snapshot (/api/channel/now) says what's on;
// /api/channel/play hands this viewer a playable URL for that program only.
//
// No seeking (it's TV). Scheduled ad breaks show a countdown card: ads
// aren't on mobile yet, and nothing plays in the gap. The short break the
// website runs between programs is skipped here for the same reason.
export default function ChannelPlayer({ channelSlug, initialNow, onNowChange }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const viewRef = useRef(null);
  const nowRef = useRef(initialNow);
  const pendingSeek = useRef(null);
  const endTimer = useRef(null);
  const tuneSeq = useRef(0);
  const appActive = useRef(true);

  const [now, setNow] = useState(initialNow);
  const [screen, setScreen] = useState('loading'); // null | loading | ad | age | off_air | unavailable
  const [ageInfo, setAgeInfo] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [progress, setProgress] = useState(0);
  const [adLeft, setAdLeft] = useState(null);

  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1;
  });

  const updateNow = useCallback((fresh) => {
    nowRef.current = fresh;
    setNow(fresh);
    if (onNowChange) onNowChange(fresh);
  }, [onNowChange]);

  const fetchNow = useCallback(async () => {
    try {
      return await apiGet(`/api/channel/now?channel=${encodeURIComponent(channelSlug)}`);
    } catch (err) {
      return null;
    }
  }, [channelSlug]);

  async function tune(state) {
    const seq = ++tuneSeq.current;
    const program = state && state.program;
    if (!state || (!state.onAir && !state.live)) {
      player.pause();
      setScreen('off_air');
      return;
    }
    if (program && program.kind === 'ad_break') {
      player.pause();
      setScreen('ad');
      return;
    }
    setScreen('loading');
    let play = null;
    try {
      const token = await withTimeout(getToken().catch(() => null), 4000);
      play = await apiPost('/api/channel/play', { channel: channelSlug }, token);
    } catch (err) {
      play = null;
    }
    if (seq !== tuneSeq.current) return; // a newer tune started meanwhile
    if (!play || !play.src) {
      player.pause();
      if (play && play.kind === 'age_restricted') {
        setAgeInfo({ rating: play.rating, signedIn: play.signedIn });
        setScreen('age');
      } else if (play && play.kind === 'off_air') {
        setScreen('off_air');
      } else {
        setScreen('unavailable');
      }
      return;
    }
    pendingSeek.current = play.kind === 'live' ? null : { offset: play.offsetSeconds || 0, at: Date.now() };
    try {
      await player.replaceAsync(play.src);
    } catch (err) {
      setScreen('unavailable');
      return;
    }
    if (seq !== tuneSeq.current) return;
    setScreen(null);
    player.muted = muted;
    player.play();
  }

  // Once the new program has loaded, jump to where the channel is now.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && pendingSeek.current) {
        const { offset, at } = pendingSeek.current;
        pendingSeek.current = null;
        player.currentTime = offset + (Date.now() - at) / 1000;
        player.play();
      }
    });
    const playSub = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      const p = nowRef.current && nowRef.current.program;
      if (p && p.durationSeconds) {
        setRemaining(Math.max(0, p.durationSeconds - currentTime));
        setProgress(Math.min(1, currentTime / p.durationSeconds));
      }
    });
    return () => { sub.remove(); playSub.remove(); timeSub.remove(); };
  }, [player]);

  const scheduleNextCheck = useCallback((state) => {
    if (endTimer.current) clearTimeout(endTimer.current);
    const p = state && state.program;
    if (!p || !p.endsAt) return;
    const ms = Math.max(2000, Date.parse(p.endsAt) - Date.now() + 1500);
    endTimer.current = setTimeout(async () => {
      const fresh = await fetchNow();
      if (!fresh) return;
      const prev = nowRef.current || {};
      const changed = !!fresh.live !== !!prev.live || (fresh.program && prev.program ? fresh.program.key !== prev.program.key : !!fresh.program !== !!prev.program);
      updateNow(fresh);
      if (changed) tune(fresh);
      scheduleNextCheck(fresh);
    }, ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNow, updateNow]);

  // Tune in when the screen opens or the channel changes.
  useEffect(() => {
    nowRef.current = initialNow;
    setNow(initialNow);
    tune(initialNow);
    scheduleNextCheck(initialNow);
    return () => {
      tuneSeq.current += 1;
      if (endTimer.current) clearTimeout(endTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSlug, initialNow]);

  // Coming back to the app catches up to wherever the channel is now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (st) => {
      const wasActive = appActive.current;
      appActive.current = st === 'active';
      if (st === 'active' && !wasActive) {
        const fresh = await fetchNow();
        if (fresh) { updateNow(fresh); tune(fresh); scheduleNextCheck(fresh); }
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNow]);

  // Safety net: notices a live broadcast starting/ending and corrects drift.
  useEffect(() => {
    const id = setInterval(async () => {
      if (!appActive.current || screen === 'loading') return;
      if (!playing && screen === null && !(nowRef.current && nowRef.current.live)) return; // paused on purpose
      const fresh = await fetchNow();
      if (!fresh) return;
      const cur = nowRef.current || {};
      const changed = !!fresh.live !== !!cur.live || (fresh.program && cur.program ? fresh.program.key !== cur.program.key : !!fresh.program !== !!cur.program);
      const drift = fresh.program && screen === null && !fresh.live ? Math.abs(fresh.program.offsetSeconds - player.currentTime) : 0;
      if (changed || drift > 8) {
        updateNow(fresh);
        tune(fresh);
        scheduleNextCheck(fresh);
      }
    }, SAFETY_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, playing, fetchNow]);

  // Countdown on the ad break card.
  useEffect(() => {
    if (screen !== 'ad') return undefined;
    const p = nowRef.current && nowRef.current.program;
    if (!p || !p.endsAt) return undefined;
    const tick = () => setAdLeft(Math.max(0, (Date.parse(p.endsAt) - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [screen, now]);

  async function togglePlay() {
    if (playing) {
      player.pause();
      return;
    }
    // Resuming catches back up to where the channel is now.
    const fresh = await fetchNow();
    if (fresh) { updateNow(fresh); tune(fresh); scheduleNextCheck(fresh); } else player.play();
  }
  function toggleMute() {
    player.muted = !muted;
    setMuted(!muted);
  }

  const channelName = now && now.channel ? now.channel.name : '';
  const offset = pacificOffset(now);
  const program = now && now.program;

  return (
    <View>
      <View style={styles.frame}>
        <VideoView ref={viewRef} player={player} style={styles.video} contentFit="contain" nativeControls={false} fullscreenOptions={{ enable: true }} />
        <View style={styles.badge} pointerEvents="none">
          <View style={[styles.dot, now && now.live ? styles.dotLive : null]} />
          <Text style={styles.badgeText}>{screen === 'ad' ? 'Ad break' : now && now.live ? `Live · ${channelName}` : `On air · ${channelName}`}</Text>
        </View>

        {screen && (
          <View style={styles.card}>
            {screen === 'loading' && <><ActivityIndicator color={colors.brass} /><Text style={styles.cardSub}>Tuning in…</Text></>}
            {screen === 'off_air' && <><Text style={styles.cardTitle}>{channelName || 'This channel'} is off the air</Text><Text style={styles.cardSub}>Check the guide for what&rsquo;s coming up.</Text></>}
            {screen === 'unavailable' && <><Text style={styles.cardTitle}>{program ? program.title : 'This program'} can&rsquo;t play right now</Text><Text style={styles.cardSub}>The channel moves on to the next program on schedule.</Text></>}
            {screen === 'ad' && (
              <>
                <Text style={styles.cardTitle}>Ad break</Text>
                <Text style={styles.cardSub}>{adLeft != null ? `Back to ${channelName} in ${formatClock(adLeft)}` : `Back to ${channelName} soon`}</Text>
              </>
            )}
            {screen === 'age' && ageInfo && (
              <>
                <Text style={styles.cardTitle}>Rated {ageInfo.rating}</Text>
                <Text style={styles.cardSub}>{ageInfo.signedIn ? 'Add your age on your account to watch this one.' : 'Sign in and add your age to watch this one.'}</Text>
                <Pressable style={styles.cardBtn} onPress={() => router.push('/account')}><Text style={styles.cardBtnText}>{ageInfo.signedIn ? 'Go to account' : 'Sign in'}</Text></Pressable>
                {program && program.endsAt ? <Text style={styles.cardMono}>The channel moves on at {pacificLabel(program.endsAt, offset)}.</Text> : null}
              </>
            )}
          </View>
        )}
      </View>

      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${screen === null && !(now && now.live) ? progress * 100 : 0}%` }]} /></View>
      <View style={styles.controls}>
        <Pressable onPress={togglePlay} disabled={screen !== null} style={styles.ctrl} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} hitSlop={8}>
          <Svg width={20} height={20} viewBox="0 0 24 24">
            {playing
              ? <><Rect x="6" y="5" width="4" height="14" rx="1" fill={colors.ink} /><Rect x="14" y="5" width="4" height="14" rx="1" fill={colors.ink} /></>
              : <Path d="M8 5v14l11-7z" fill={screen !== null ? colors.inkFaint : colors.ink} />}
          </Svg>
        </Pressable>
        <Pressable onPress={toggleMute} style={styles.ctrl} accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'} hitSlop={8}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M11 5L6 9H3v6h3l5 4z" />
            {muted ? <Path d="M22 9l-6 6M16 9l6 6" /> : <Path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
          </Svg>
        </Pressable>
        <Text style={styles.timeLeft}>{screen === null && remaining != null && !(now && now.live) ? `${formatClock(remaining)} left` : ''}</Text>
        <Pressable onPress={() => viewRef.current && viewRef.current.enterFullscreen()} disabled={screen !== null} style={styles.ctrl} accessibilityRole="button" accessibilityLabel="Fullscreen" hitSlop={8}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={screen !== null ? colors.inkFaint : colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, width: '100%', backgroundColor: '#000', borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: 'hidden' },
  video: { ...absoluteFill },
  badge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(10,11,15,0.7)', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.olive },
  dotLive: { backgroundColor: colors.brass },
  badgeText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink },
  card: { ...absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, backgroundColor: colors.surface0 },
  cardTitle: { fontFamily: fonts.displaySemi, fontSize: 17, color: colors.ink, textAlign: 'center' },
  cardSub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim, textAlign: 'center' },
  cardMono: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, marginTop: 4 },
  cardBtn: { marginTop: 6, backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
  cardBtnText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.oliveShadow },
  progressTrack: { height: 3, backgroundColor: 'rgba(251,232,211,0.15)' },
  progressFill: { height: 3, backgroundColor: colors.brass },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colors.surface1, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderWidth: 1, borderTopWidth: 0, borderColor: colors.oceanInk },
  ctrl: { padding: 2 },
  timeLeft: { flex: 1, textAlign: 'right', fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim }
});
