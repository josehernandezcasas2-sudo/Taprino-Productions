import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { useFocusEffect, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet, apiPost } from '../lib/api';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { formatClock, pacificLabel, pacificOffset } from '../lib/channelTime';

const SAFETY_POLL_MS = 45000;
const CONTROLS_HIDE_MS = 3000;
const { OrientationLock, Orientation } = ScreenOrientation;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}
const lock = (o) => ScreenOrientation.lockAsync(o).catch(() => {});
const isLandscape = (o) => o === Orientation.LANDSCAPE_LEFT || o === Orientation.LANDSCAPE_RIGHT;
// Turning the device sideways only means something on a phone or tablet;
// a desktop browser reports its monitor as landscape.
const CAN_ROTATE = Platform.OS === 'ios' || Platform.OS === 'android';

// Mirrors components/ChannelPlayer.js on the website: plays whatever is on
// the channel right now, from wherever it is right now, and retunes when
// the next program starts. The snapshot (/api/channel/now) says what's on;
// /api/channel/play hands this viewer a playable URL for that program only.
//
// No seeking (it's TV). Scheduled ad breaks show a countdown card: ads
// aren't on mobile yet, and nothing plays in the gap. The short break the
// website runs between programs is skipped here for the same reason.
//
// Controls sit on the video and fade out while it plays (tap to bring them
// back). Fullscreen is this component's own sideways view with an exit
// button, not the system player: turning the phone sideways on the Live
// screen goes fullscreen, turning it back comes out. The rest of the app
// stays locked to portrait (src/app/_layout.js).
export default function ChannelPlayer({ channelSlug, initialNow, onNowChange }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const nowRef = useRef(initialNow);
  const pendingSeek = useRef(null);
  const endTimer = useRef(null);
  const hideTimer = useRef(null);
  const tuneSeq = useRef(0);
  const appActive = useRef(true);
  const focused = useRef(true);
  // Turning the phone sideways goes fullscreen until someone leaves
  // fullscreen with the ✕ button; after that it waits for the button (or
  // the next visit to the screen), so a phone still held sideways doesn't
  // bounce straight back in.
  const autoRotate = useRef(true);
  const fullscreenRef = useRef(false);

  const [now, setNow] = useState(initialNow);
  const [screen, setScreen] = useState('loading'); // null | loading | ad | age | off_air | unavailable
  const [ageInfo, setAgeInfo] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [progress, setProgress] = useState(0);
  const [adLeft, setAdLeft] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [userPaused, setUserPaused] = useState(false); // paused by the viewer: stays paused until they press play
  const pausedRef = useRef(false);
  const pausedKey = useRef(null); // the program that was on when they paused

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
    if (seq !== tuneSeq.current || !focused.current) return;
    setScreen(null);
    player.play();
  }

  async function catchUp(force = false) {
    const fresh = await fetchNow();
    if (fresh) {
      updateNow(fresh);
      if (force || !pausedRef.current) tune(fresh);
      scheduleNextCheck(fresh);
    }
    return fresh;
  }

  // Once the new program has loaded, jump to where the channel is now.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && pendingSeek.current) {
        const { offset, at } = pendingSeek.current;
        pendingSeek.current = null;
        player.currentTime = offset + (Date.now() - at) / 1000;
        if (focused.current) player.play();
      }
    });
    const playSub = player.addListener('playingChange', ({ isPlaying }) => {
      setPlaying(isPlaying);
      if (isPlaying) { pausedRef.current = false; setUserPaused(false); }
    });
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
      if (!focused.current) return;
      const fresh = await fetchNow();
      if (!fresh) return;
      const prev = nowRef.current || {};
      const changed = !!fresh.live !== !!prev.live || (fresh.program && prev.program ? fresh.program.key !== prev.program.key : !!fresh.program !== !!prev.program);
      updateNow(fresh);
      // Paused by the viewer: the channel moves on, the player doesn't.
      if (changed && !pausedRef.current) tune(fresh);
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

  /* ---------------- fullscreen and rotation ---------------- */

  function rememberSpot() {
    if (screen === null) switchedAt.current = { time: player.currentTime, at: Date.now(), resume: wasPlaying.current };
  }
  function enterFullscreen(fromButton) {
    if (fullscreenRef.current) return;
    rememberSpot();
    fullscreenRef.current = true;
    setFullscreen(true);
    showControls();
    if (fromButton) lock(OrientationLock.LANDSCAPE);
  }
  function exitFullscreen(fromButton) {
    if (!fullscreenRef.current) return;
    rememberSpot();
    fullscreenRef.current = false;
    setFullscreen(false);
    showControls();
    if (fromButton) autoRotate.current = false;
    if (fromButton || !autoRotate.current) lock(OrientationLock.PORTRAIT_UP);
  }

  // The video moves between the inline view and the fullscreen view; keep
  // it playing across the move if it was playing before (some platforms
  // pause when a player's view changes).
  const wasPlaying = useRef(false);
  const switchedAt = useRef(null); // { time, at } just before the move
  useEffect(() => {
    if (!switchedAt.current || !focused.current) return undefined;
    const { time, at, resume } = switchedAt.current;
    switchedAt.current = null;
    const t = setTimeout(() => {
      // Same spot as before the move (on web each view reloads the video).
      const expected = time + (resume ? (Date.now() - at) / 1000 : 0);
      if (Math.abs(player.currentTime - expected) > 2) player.currentTime = expected;
      if (resume) player.play();
    }, 150);
    return () => clearTimeout(t);
  }, [fullscreen, player]);
  useEffect(() => {
    wasPlaying.current = playing;
  }, [playing]);

  // While the Live screen is showing: rotation allowed (sideways =
  // fullscreen). Leaving it: back to portrait, out of fullscreen, and the
  // channel stops playing behind whatever screen is on top. Coming back
  // catches up to wherever the channel is now.
  useFocusEffect(
    useCallback(() => {
      const wasAway = !focused.current;
      focused.current = true;
      autoRotate.current = CAN_ROTATE;
      if (CAN_ROTATE) ScreenOrientation.unlockAsync().catch(() => {});
      const sub = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
        const o = orientationInfo && orientationInfo.orientation;
        if (isLandscape(o) && autoRotate.current) enterFullscreen(false);
        else if (o === Orientation.PORTRAIT_UP && fullscreenRef.current && autoRotate.current) exitFullscreen(false);
      });
      if (wasAway) catchUp();
      return () => {
        focused.current = false;
        sub.remove();
        player.pause();
        if (fullscreenRef.current) {
          fullscreenRef.current = false;
          setFullscreen(false);
        }
        lock(OrientationLock.PORTRAIT_UP);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [player])
  );

  // Coming back to the app catches up to wherever the channel is now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      const wasActive = appActive.current;
      appActive.current = st === 'active';
      if (st === 'active' && !wasActive && focused.current) catchUp();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNow]);

  // Safety net: notices a live broadcast starting/ending and corrects drift.
  useEffect(() => {
    const id = setInterval(async () => {
      if (!appActive.current || !focused.current || screen === 'loading') return;
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

  /* ---------------- controls ---------------- */

  // Controls fade out a few seconds after the last tap while playing.
  function showControls() {
    setControlsShown(true);
  }
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (controlsShown && playing && screen === null && !menuOpen) {
      hideTimer.current = setTimeout(() => setControlsShown(false), CONTROLS_HIDE_MS);
    }
    return () => hideTimer.current && clearTimeout(hideTimer.current);
  }, [controlsShown, playing, screen, menuOpen]);

  async function togglePlay() {
    showControls();
    if (playing) {
      pausedRef.current = true;
      pausedKey.current = nowRef.current && nowRef.current.program ? nowRef.current.program.key : null;
      setUserPaused(true);
      player.pause();
      return;
    }
    // Resuming catches back up to where the channel is now.
    pausedRef.current = false;
    const fresh = await catchUp(true);
    if (!fresh) player.play();
  }
  function toggleMute() {
    showControls();
    player.muted = !muted;
    setMuted(!muted);
  }
  function changeVolume(delta) {
    showControls();
    const next = Math.max(0, Math.min(1, Math.round((volume + delta) * 10) / 10));
    player.volume = next;
    setVolume(next);
    if (next > 0 && muted) { player.muted = false; setMuted(false); }
  }

  const channelName = now && now.channel ? now.channel.name : '';
  const offset = pacificOffset(now);
  const program = now && now.program;
  const isLive = !!(now && now.live);
  const movedOn = userPaused && program && pausedKey.current && program.key !== pausedKey.current;

  // One overlay for both the inline player and fullscreen (a render
  // function, not a component, so it isn't remounted on every render).
  function renderOverlay(full) {
    return (
      <>
        <Pressable style={absoluteFill} onPress={() => (menuOpen ? setMenuOpen(false) : setControlsShown((v) => !v))} accessibilityLabel={menuOpen ? 'Close menu' : controlsShown ? 'Hide controls' : 'Show controls'} />
        {screen === null && userPaused && !playing && (
          <View style={styles.pausedNote} pointerEvents="none">
            <Text style={styles.pausedTitle}>Paused</Text>
            <Text style={styles.pausedSub}>{movedOn ? `${channelName} has moved on to ${program.title}.` : `${channelName} keeps going.`} Play catches up to live.</Text>
          </View>
        )}
        {(controlsShown || screen !== null) && (
          <View style={[styles.badge, full && styles.badgeFull]} pointerEvents="none">
            <View style={[styles.dot, isLive && styles.dotLive]} />
            <Text style={styles.badgeText}>{screen === 'ad' ? 'Ad break' : isLive ? `Live · ${channelName}` : `On air · ${channelName}`}</Text>
          </View>
        )}
        {full && (
          <Pressable style={styles.exit} onPress={() => exitFullscreen(true)} accessibilityRole="button" accessibilityLabel="Exit fullscreen" hitSlop={12}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round"><Path d="M6 6l12 12M18 6L6 18" /></Svg>
          </Pressable>
        )}

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
                <Pressable style={styles.cardBtn} onPress={() => { if (full) exitFullscreen(true); router.push('/account'); }}><Text style={styles.cardBtnText}>{ageInfo.signedIn ? 'Go to account' : 'Sign in'}</Text></Pressable>
                {program && program.endsAt ? <Text style={styles.cardMono}>The channel moves on at {pacificLabel(program.endsAt, offset)}.</Text> : null}
              </>
            )}
            {full && screen !== 'loading' && (
              <Pressable style={styles.cardExit} onPress={() => exitFullscreen(true)}><Text style={styles.cardExitText}>Exit fullscreen</Text></Pressable>
            )}
          </View>
        )}

        {screen === null && controlsShown && (
          <LinearGradient colors={['transparent', 'rgba(8,12,20,0.88)']} style={[styles.bar, full && styles.barFull]} pointerEvents="box-none">
            {!isLive && <View style={styles.track}><View style={[styles.trackFill, { width: `${progress * 100}%` }]} /></View>}
            <View style={styles.buttons}>
              <Pressable onPress={togglePlay} style={styles.btn} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} hitSlop={10}>
                <Svg width={full ? 28 : 24} height={full ? 28 : 24} viewBox="0 0 24 24">
                  {playing
                    ? <><Rect x="6" y="5" width="4" height="14" rx="1" fill={colors.ink} /><Rect x="14" y="5" width="4" height="14" rx="1" fill={colors.ink} /></>
                    : <Path d="M8 5v14l11-7z" fill={colors.ink} />}
                </Svg>
              </Pressable>
              <Pressable onPress={toggleMute} style={styles.btn} accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'} hitSlop={10}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M11 5L6 9H3v6h3l5 4z" />
                  {muted ? <Path d="M22 9l-6 6M16 9l6 6" /> : <Path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
                </Svg>
              </Pressable>
              <Text style={styles.timeLeft} numberOfLines={1}>
                {full && program ? `${program.seriesName || program.title}  ·  ` : ''}{!isLive && remaining != null ? `${formatClock(remaining)} left` : isLive ? 'Live' : ''}
              </Text>
              <Pressable onPress={() => { showControls(); setMenuOpen((v) => !v); }} style={styles.btn} accessibilityRole="button" accessibilityLabel={menuOpen ? 'Close menu' : 'Menu'} hitSlop={10}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill={colors.ink}><Path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" /></Svg>
              </Pressable>
              <Pressable onPress={() => (full ? exitFullscreen(true) : enterFullscreen(true))} style={styles.btn} accessibilityRole="button" accessibilityLabel={full ? 'Exit fullscreen' : 'Fullscreen'} hitSlop={10}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {full ? <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                </Svg>
              </Pressable>
            </View>
          </LinearGradient>
        )}

        {screen === null && menuOpen && (
          <View style={[styles.menu, full && styles.menuFull]}>
            <Pressable style={styles.menuRow} onPress={() => { setMenuOpen(false); togglePlay(); }} accessibilityRole="button">
              <Text style={styles.menuText}>{playing ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <View style={styles.menuRow}>
              <Text style={styles.menuText}>Volume</Text>
              <View style={styles.volCtl}>
                <Pressable style={styles.volBtn} onPress={() => changeVolume(-0.1)} accessibilityRole="button" accessibilityLabel="Lower volume" hitSlop={6}><Text style={styles.volBtnText}>−</Text></Pressable>
                <Text style={styles.volLevel}>{muted ? 'muted' : `${Math.round(volume * 100)}%`}</Text>
                <Pressable style={styles.volBtn} onPress={() => changeVolume(0.1)} accessibilityRole="button" accessibilityLabel="Raise volume" hitSlop={6}><Text style={styles.volBtnText}>+</Text></Pressable>
              </View>
            </View>
            <Pressable style={styles.menuRow} onPress={toggleMute} accessibilityRole="button">
              <Text style={styles.menuText}>{muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
            <Pressable style={styles.menuRow} onPress={() => { setMenuOpen(false); if (full) exitFullscreen(true); else enterFullscreen(true); }} accessibilityRole="button">
              <Text style={styles.menuText}>{full ? 'Exit fullscreen' : 'Fullscreen'}</Text>
            </Pressable>
          </View>
        )}
      </>
    );
  }

  return (
    <View>
      <View style={styles.frame}>
        {fullscreen ? (
          <View style={styles.elsewhere}><Text style={styles.cardSub}>Playing fullscreen</Text></View>
        ) : (
          <>
            <VideoView player={player} style={absoluteFill} contentFit="contain" nativeControls={false} />
            {renderOverlay(false)}
          </>
        )}
      </View>

      <Modal
        visible={fullscreen}
        animationType="fade"
        presentationStyle="fullScreen"
        supportedOrientations={['landscape', 'landscape-left', 'landscape-right', 'portrait']}
        onRequestClose={() => exitFullscreen(true)}
        statusBarTranslucent
      >
        <StatusBar hidden />
        <View style={styles.fullRoot}>
          {fullscreen && <VideoView player={player} style={absoluteFill} contentFit="contain" nativeControls={false} />}
          <SafeAreaView style={absoluteFill} edges={['left', 'right', 'top', 'bottom']} pointerEvents="box-none">
            <View style={styles.fullInner} pointerEvents="box-none">
              {renderOverlay(true)}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, width: '100%', backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.oceanInk },
  elsewhere: { ...absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface0 },
  fullRoot: { flex: 1, backgroundColor: '#000' },
  fullInner: { flex: 1 },
  badge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(10,11,15,0.7)', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999 },
  badgeFull: { top: 14, left: 64 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.olive },
  dotLive: { backgroundColor: colors.brass },
  badgeText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink },
  exit: { position: 'absolute', top: 8, left: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(10,11,15,0.7)', alignItems: 'center', justifyContent: 'center' },
  card: { ...absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, backgroundColor: colors.surface0 },
  cardTitle: { fontFamily: fonts.displaySemi, fontSize: 17, color: colors.ink, textAlign: 'center' },
  cardSub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim, textAlign: 'center' },
  cardMono: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, marginTop: 4 },
  cardBtn: { marginTop: 6, backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
  cardBtnText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.oliveShadow },
  cardExit: { marginTop: 10, borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 16 },
  cardExitText: { fontFamily: fonts.display, fontSize: 13, color: colors.ink },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 26, paddingHorizontal: 10, paddingBottom: 8 },
  barFull: { paddingHorizontal: 18, paddingBottom: 14 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(251,232,211,0.22)', marginBottom: 8, marginHorizontal: 4 },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: colors.brass },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  btn: { padding: 4 },
  timeLeft: { flex: 1, textAlign: 'right', fontFamily: fonts.mono, fontSize: 11.5, color: colors.ink },
  pausedNote: { position: 'absolute', alignSelf: 'center', top: '38%', alignItems: 'center', gap: 3, backgroundColor: 'rgba(10,11,15,0.78)', borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, maxWidth: '80%' },
  pausedTitle: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  pausedSub: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim, textAlign: 'center' },
  menu: { position: 'absolute', right: 10, bottom: 54, minWidth: 190, backgroundColor: 'rgba(10,11,15,0.94)', borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, paddingVertical: 4 },
  menuFull: { right: 18, bottom: 64 },
  menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9, paddingHorizontal: 12 },
  menuText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.ink },
  volCtl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  volBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(251,232,211,0.3)', alignItems: 'center', justifyContent: 'center' },
  volBtnText: { fontFamily: fonts.display, fontSize: 16, color: colors.ink, lineHeight: 18 },
  volLevel: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim, minWidth: 44, textAlign: 'center' }
});
