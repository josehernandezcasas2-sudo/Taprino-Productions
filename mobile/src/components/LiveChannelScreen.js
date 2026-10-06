import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { addDays, clockLabel, dayLabel, pacificLabel, pacificOffset } from '../lib/channelTime';
import TopNav from './TopNav';
import ChannelPlayer from './ChannelPlayer';
import ReportSheet from './ReportSheet';
import SmartImage from './SmartImage';

const HALF_HOUR = 110; // guide width of 30 minutes, in px
const LABEL_EVERY = HALF_HOUR * 4; // two hours
const DAY = 86400;
const pad = (n) => String(n).padStart(2, '0');

// Where "Go to series/film page" leads, as app routes.
function titlePageFor(p) {
  if (!p) return null;
  if (p.seriesId) return { href: p.contentType === 'podcast' ? `/podcasts/${p.seriesId}` : `/series/${p.seriesId}`, label: p.contentType === 'podcast' ? 'Go to podcast page' : 'Go to series page' };
  if (p.episodeId) return { href: `/episode/${p.episodeId}`, label: p.contentType === 'movie' ? 'Go to film page' : 'Go to title page' };
  return null;
}
const heading = (p) => (p ? p.seriesName || p.title : '');

// Mirrors pages/live (components/LiveChannelsPage.js) at phone width: the
// channel list as a row of chips, the player, what's on (or the guide slot
// you tapped), and the guide for today through a week out. Everyone sees
// the same thing at the same time.
export default function LiveChannelScreen({ initialSlug }) {
  const router = useRouter();
  const [channels, setChannels] = useState(null);
  const [slug, setSlug] = useState(initialSlug || null);
  const [now, setNow] = useState(null);
  // The snapshot the player tunes in from; only changes with the channel.
  // (now itself keeps updating as programs change.)
  const [playerSeed, setPlayerSeed] = useState(null);
  const [guide, setGuide] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const [, setTick] = useState(0);
  const nowAt = useRef(Date.now());
  const guideScroll = useRef(null);

  // Channel list, then default to the main channel.
  useEffect(() => {
    apiGet('/api/channel/list')
      .then((d) => {
        setChannels(d.channels);
        if (!slug && d.channels[0]) setSlug(d.channels[0].slug);
        if (!d.channels.length) setError('No channels are on the air right now.');
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What's on + today's guide whenever the channel changes.
  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    setNow(null);
    setPlayerSeed(null);
    setGuide(null);
    setSelected(null);
    Promise.all([
      apiGet(`/api/channel/now?channel=${encodeURIComponent(slug)}`),
      apiGet(`/api/channel/guide?channel=${encodeURIComponent(slug)}`)
    ])
      .then(([n, g]) => {
        if (cancelled) return;
        nowAt.current = Date.now();
        setNow(n);
        setPlayerSeed(n);
        setGuide(g);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [slug]);

  // Keep the guide's "now" line moving.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const onNowChange = useCallback((fresh) => {
    nowAt.current = Date.now();
    setNow(fresh);
    // Keep this channel's chip in step with what's on.
    if (fresh && fresh.channel) {
      const title = fresh.live ? fresh.live.title : fresh.program ? (fresh.program.seriesName || fresh.program.title) : null;
      setChannels((list) => (list || []).map((c) => (c.slug === fresh.channel.slug ? { ...c, nowTitle: title, isLive: !!fresh.live } : c)));
    }
  }, []);

  const clockSec = now && now.channelSec != null ? now.channelSec + (Date.now() - nowAt.current) / 1000 : null;
  const offset = pacificOffset(now);
  const isToday = guide && guide.date === guide.today;

  // Put "now" near the left edge of the guide.
  useEffect(() => {
    if (!guide || !guideScroll.current) return;
    const x = isToday && clockSec != null ? (clockSec / 1800) * HALF_HOUR - HALF_HOUR : 19 * 2 * HALF_HOUR - HALF_HOUR;
    setTimeout(() => guideScroll.current && guideScroll.current.scrollTo({ x: Math.max(0, x), animated: false }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide && guide.date, slug]);

  async function loadDay(date) {
    setGuideLoading(true);
    try {
      setGuide(await apiGet(`/api/channel/guide?channel=${encodeURIComponent(slug)}&date=${date}`));
      setSelected(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuideLoading(false);
    }
  }

  const channel = channels && slug ? channels.find((c) => c.slug === slug) : null;
  const days = guide ? [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(guide.today, n)) : [];

  if (error && !now) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={styles.scroll}>
        {channels && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {channels.map((c) => (
              <Pressable key={c.slug} onPress={() => setSlug(c.slug)} style={[styles.chip, c.slug === slug && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: c.slug === slug }}>
                <Text style={[styles.chipNum, c.slug === slug && styles.chipNumOn]}>{pad(c.number)}</Text>
                {c.logoUrl ? <SmartImage uri={c.logoUrl} style={styles.chipLogo} /> : null}
                <View style={{ maxWidth: 150 }}>
                  <Text style={styles.chipName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.chipNow} numberOfLines={1}>{c.isLive ? '● Live · ' : ''}{c.nowTitle || 'Off air'}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.stage}>
          {playerSeed ? (
            <ChannelPlayer key={slug} channelSlug={slug} initialNow={playerSeed} onNowChange={onNowChange} />
          ) : (
            <View style={styles.playerSkeleton}><ActivityIndicator color={colors.brass} /></View>
          )}

          <View style={styles.panel}>
            {selected
              ? <SegmentInfo seg={selected} channel={channel} isToday={isToday} clockSec={clockSec} date={guide.date} today={guide.today} onBack={() => setSelected(null)} onGo={(href) => router.push(href)} />
              : <NowInfo now={now} channel={channel} offset={offset} onGo={(href) => router.push(href)} />}
          </View>

          {guide && (
            <View style={styles.panel}>
              <Text style={styles.guideTitle}>{channel ? channel.name : ''} guide</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
                {days.map((d) => (
                  <Pressable key={d} onPress={() => loadDay(d)} disabled={guideLoading} style={[styles.day, guide.date === d && styles.dayOn]} accessibilityRole="tab" accessibilityState={{ selected: guide.date === d }}>
                    <Text style={[styles.dayText, guide.date === d && styles.dayTextOn]}>{dayLabel(d, guide.today)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScrollView horizontal ref={guideScroll} showsHorizontalScrollIndicator={false}>
                <View style={{ width: 48 * HALF_HOUR }}>
                  <View style={styles.times}>
                    {Array.from({ length: 48 }, (_, i) => <Text key={i} style={[styles.time, { width: HALF_HOUR }]}>{clockLabel(i * 1800)}</Text>)}
                  </View>
                  <View style={styles.track}>
                    {guide.segments.map((s) => {
                      const left = (s.start / 1800) * HALF_HOUR;
                      const width = Math.max(4, ((s.end - s.start) / 1800) * HALF_HOUR - 3);
                      const past = isToday && clockSec != null && s.end <= clockSec;
                      const onNow = isToday && clockSec != null && s.start <= clockSec && clockSec < s.end;
                      const isSel = selected && selected.start === s.start;
                      return (
                        <Pressable
                          key={`${s.start}-${s.kind}`}
                          onPress={() => setSelected(s)}
                          style={[styles.blk, kindStyle(s.kind), { left, width }, past && styles.blkPast, onNow && styles.blkNow, isSel && styles.blkSel]}
                          accessibilityLabel={`${s.seriesName ? `${s.seriesName}, ` : ''}${s.title}, ${clockLabel(s.start)}`}
                        >
                          {(s.kind === 'loop' || s.kind === 'off_air') && width > LABEL_EVERY * 2 ? (
                            // Long stretches repeat their label every two hours, so
                            // it's visible wherever the guide is scrolled to.
                            Array.from({ length: Math.ceil(width / LABEL_EVERY) }, (_, k) => k * LABEL_EVERY).filter((x) => x < width - 70).map((x) => (
                              <View key={x} pointerEvents="none" style={[styles.blkRepeat, { left: 7 + x }]}>
                                <Text style={[styles.blkTitle, { color: colors.olive }]} numberOfLines={1}>{s.title}</Text>
                                <Text style={styles.blkSub} numberOfLines={1}>{clockLabel(s.start + (x / HALF_HOUR) * 1800)}</Text>
                              </View>
                            ))
                          ) : width > 44 ? (
                            <>
                              <Text style={[styles.blkTitle, s.kind === 'loop' && { color: colors.olive }]} numberOfLines={1}>{s.kind === 'live_slot' ? '● ' : ''}{s.seriesName || s.title}</Text>
                              <Text style={styles.blkSub} numberOfLines={1}>{clockLabel(s.start)}{s.label ? ` · ${s.label}` : ''}</Text>
                            </>
                          ) : null}
                        </Pressable>
                      );
                    })}
                    {isToday && clockSec != null ? <View pointerEvents="none" style={[styles.nowLine, { left: (clockSec / 1800) * HALF_HOUR }]} /> : null}
                  </View>
                </View>
              </ScrollView>
              <Text style={styles.legend}>Shows · ● Live · striped = ads & bumpers or the channel loop · all times Pacific</Text>
            </View>
          )}

          <Text style={styles.foot}>
            {channel ? channel.name : 'Live TV'} plays like TV: everyone sees the same thing at the same time. Want to pick what you watch? Every show here has its own page, ready on demand.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function kindStyle(kind) {
  if (kind === 'live_slot') return styles.blkLive;
  if (kind === 'ad_break') return styles.blkAds;
  if (kind === 'loop' || kind === 'off_air') return styles.blkLoop;
  return null;
}

function Chips({ p }) {
  const items = [];
  if (p.layer === 'loop') items.push(['Channel loop', null]);
  if (p.contentType) items.push([p.contentType === 'movie' ? 'Film' : p.contentType[0].toUpperCase() + p.contentType.slice(1), null]);
  if (p.tier === 'premium') items.push(['Tapa +', 'prem']);
  if (p.tier === 'free') items.push(['Free', 'free']);
  if (p.rating) items.push([p.rating, null]);
  if (p.genre) items.push([p.genre, null]);
  return (
    <View style={styles.chipsRow}>
      {items.map(([label, kind]) => (
        <Text key={label} style={[styles.tag, kind === 'prem' && styles.tagPrem, kind === 'free' && styles.tagFree]}>{label}</Text>
      ))}
    </View>
  );
}

function NowInfo({ now, channel, offset, onGo }) {
  const ch = channel ? `CH ${pad(channel.number)}` : '';
  if (!now) return <ActivityIndicator color={colors.brass} />;
  if (now.live) {
    return (
      <View style={styles.info}>
        <Text style={styles.eyebrow}><Text style={styles.livePill}> ● LIVE </Text>  {ch}</Text>
        <Text style={styles.h2}>{now.live.title}</Text>
        {now.live.description ? <Text style={styles.desc}>{now.live.description}</Text> : null}
        <UpNext next={now.next} offset={offset} />
      </View>
    );
  }
  const p = now.program;
  if (!p) {
    return (
      <View style={styles.info}>
        <Text style={styles.eyebrow}>{ch}</Text>
        <Text style={styles.h2}>{channel ? channel.name : 'This channel'} is off the air</Text>
        <Text style={styles.desc}>Nothing is on right now. Pick a day in the guide to see what&rsquo;s coming up.</Text>
        <UpNext next={now.next} offset={offset} />
      </View>
    );
  }
  if (p.kind === 'ad_break') {
    return (
      <View style={styles.info}>
        <Text style={styles.eyebrow}>On now · {ch}</Text>
        <Text style={styles.h2}>Ad break</Text>
        <Text style={styles.desc}>Back to {channel ? channel.name : 'the channel'} at {pacificLabel(p.endsAt, offset)}.</Text>
        <UpNext next={now.next} offset={offset} />
      </View>
    );
  }
  const page = titlePageFor(p);
  return (
    <View style={styles.info}>
      <Text style={styles.eyebrow}>On now · {ch}</Text>
      <Text style={styles.h2}>{heading(p)}</Text>
      {p.seriesName ? <Text style={styles.sub}>{p.label ? `${p.label} · ` : ''}{p.title}</Text> : null}
      <Text style={styles.when}>Until {pacificLabel(p.endsAt, offset)} PT</Text>
      <Chips p={p} />
      {p.description ? <Text style={styles.desc}>{p.description}</Text> : null}
      <View style={styles.acts}>
        {page ? <Pressable style={styles.goBtn} onPress={() => onGo(page.href)}><Text style={styles.goText}>{page.label} {'→'}</Text></Pressable> : null}
        {p.kind === 'episode' && p.episodeId ? <ReportSheet targetType="episode" targetId={p.episodeId} title={p.seriesName ? `${p.seriesName} · ${p.title}` : p.title} /> : null}
      </View>
      <UpNext next={now.next} offset={offset} />
    </View>
  );
}

function SegmentInfo({ seg, channel, isToday, clockSec, date, today, onBack, onGo }) {
  const state = !isToday || clockSec == null ? 'later' : seg.end <= clockSec ? 'earlier' : seg.start <= clockSec ? 'now' : 'later';
  const page = titlePageFor(seg);
  let body = null;
  if (seg.kind === 'loop') body = 'Nothing is booked here, so the channel loop fills the time.';
  else if (seg.kind === 'ad_break') body = seg.filler ? 'Ads and bumpers fill out the rest of this block.' : 'A scheduled ad break.';
  else if (seg.kind === 'off_air') body = `Nothing is on ${channel ? channel.name : 'the channel'} at this time.`;
  else if (seg.kind === 'live_slot') body = "A live broadcast is planned here. If it doesn't start, the channel loop plays instead.";
  return (
    <View style={styles.info}>
      <Text style={styles.eyebrow}>{state === 'now' ? 'On now' : state === 'earlier' ? 'Aired earlier' : 'Coming up'} · CH {channel ? pad(channel.number) : ''}</Text>
      <Text style={styles.h2}>{seg.kind === 'live_slot' ? `● ${seg.title}` : heading(seg)}</Text>
      {seg.seriesName ? <Text style={styles.sub}>{seg.label ? `${seg.label} · ` : ''}{seg.title}</Text> : null}
      <Text style={styles.when}>{clockLabel(seg.start)} – {seg.end >= DAY ? 'midnight' : clockLabel(seg.end)} PT{date !== today ? ` · ${dayLabel(date, today)}` : ''}</Text>
      {seg.kind === 'episode' || seg.kind === 'media' ? <Chips p={seg} /> : null}
      {seg.description ? <Text style={styles.desc}>{seg.description}</Text> : null}
      {body ? <Text style={styles.desc}>{body}</Text> : null}
      <View style={styles.acts}>
        {page ? <Pressable style={styles.goBtn} onPress={() => onGo(page.href)}><Text style={styles.goText}>{page.label} {'→'}</Text></Pressable> : null}
        <Pressable style={styles.backBtn} onPress={onBack}><Text style={styles.backText}>Back to what&rsquo;s on</Text></Pressable>
        {seg.kind === 'episode' && seg.episodeId ? <ReportSheet targetType="episode" targetId={seg.episodeId} title={seg.seriesName ? `${seg.seriesName} · ${seg.title}` : seg.title} /> : null}
      </View>
    </View>
  );
}

function UpNext({ next, offset }) {
  if (!next || !next.length) return null;
  return (
    <View style={styles.upnext}>
      <Text style={styles.eyebrow}>After this</Text>
      {next.map((n, i) => (
        <View key={i} style={styles.upRow}>
          <Text style={styles.upTitle} numberOfLines={1}>{n.seriesName ? `${n.seriesName}${n.label ? ` · ${n.label}` : ''}` : n.title}</Text>
          <Text style={styles.upTime}>{pacificLabel(n.startsAt, offset)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scroll: { paddingBottom: 130 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.danger, fontFamily: fonts.display, fontSize: 15, textAlign: 'center' },

  chips: { paddingHorizontal: 16, paddingTop: 14, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11 },
  chipOn: { borderColor: colors.brass, backgroundColor: colors.surface2 },
  chipNum: { fontFamily: fonts.mono, fontSize: 17, color: colors.inkFaint },
  chipNumOn: { color: colors.brass },
  chipLogo: { width: 24, height: 24, borderRadius: 5 },
  chipName: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  chipNow: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint },

  stage: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },
  playerSkeleton: { aspectRatio: 16 / 9, width: '100%', borderRadius: 12, backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center' },
  panel: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 12, padding: 14, gap: 10 },

  info: { gap: 8 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint },
  livePill: { backgroundColor: colors.brass, color: colors.onBrass, fontFamily: fonts.monoBold },
  h2: { fontFamily: fonts.displayBold, fontSize: 21, color: colors.ink },
  sub: { fontFamily: fonts.display, fontSize: 15, color: colors.inkDim },
  when: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  desc: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.inkDim },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkDim, backgroundColor: colors.surface3, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 7, overflow: 'hidden' },
  tagPrem: { color: colors.brass, backgroundColor: 'rgba(248,95,115,0.16)' },
  tagFree: { color: colors.ok, backgroundColor: 'rgba(132,205,152,0.18)' },
  acts: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  goBtn: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
  goText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.oliveShadow },
  backBtn: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  backText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.ink },
  upnext: { borderTopWidth: 1, borderTopColor: colors.oceanInk, paddingTop: 10, marginTop: 4, gap: 6 },
  upRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  upTitle: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: colors.ink },
  upTime: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint },

  guideTitle: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink },
  dayRow: { gap: 6 },
  day: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  dayOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  dayText: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  dayTextOn: { color: colors.surface0 },
  times: { flexDirection: 'row', marginBottom: 4 },
  time: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint, borderLeftWidth: 1, borderLeftColor: colors.oceanInk, paddingLeft: 4 },
  track: { height: 64, backgroundColor: colors.surface0, borderRadius: 6 },
  blk: { position: 'absolute', top: 4, bottom: 4, borderRadius: 5, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, paddingHorizontal: 7, justifyContent: 'center', overflow: 'hidden' },
  blkTitle: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  blkSub: { fontFamily: fonts.mono, fontSize: 9.5, color: colors.inkFaint },
  blkRepeat: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', width: 150 },
  blkLive: { backgroundColor: 'rgba(248,95,115,0.18)', borderColor: colors.brass },
  blkAds: { backgroundColor: colors.surface1, borderStyle: 'dashed' },
  blkLoop: { backgroundColor: 'rgba(231,162,85,0.08)', borderColor: colors.oliveDeep, borderStyle: 'dashed' },
  blkPast: { opacity: 0.55 },
  blkNow: { borderColor: colors.brass },
  blkSel: { borderColor: colors.ink, borderWidth: 2 },
  nowLine: { position: 'absolute', top: -4, bottom: -4, width: 2, backgroundColor: colors.brass },
  legend: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint },
  foot: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkFaint, paddingHorizontal: 2 }
});
