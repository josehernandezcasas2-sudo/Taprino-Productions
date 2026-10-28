import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Clipboard from 'expo-clipboard';
import { API_BASE_URL, apiGet, apiPost, freshToken } from '../lib/api';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { LANES, LANE_ORDER, dollars } from '../lib/creatorMoneyRules';
import TopNav from '../components/TopNav';
import SmartImage from '../components/SmartImage';
import PositionedImage from '../components/PositionedImage';
import HomeOnNow from '../components/HomeOnNow';
import { Avatar, TierChip } from '../components/CrewBits';
import { hrefToRoute } from '../components/PushListener';
import { readStayInStream, takeLaunchCheck } from '../lib/stayInStream';
import { useUnreadMessages } from '../lib/useUnread';

const PAPER_INK = '#241a05';
const PAPER_MUTED = '#6b6248';
const PAPER_GREEN = '#2f7d4c';
const FREE_NOW_HOURS = 4; // AVAILABLE_NOW_CHOICES[0] in lib/crewCallRules.js

// The Connect home: "The Notice Board" (mirrors pages/index.js, 2026-10-28,
// direction I of the signed-off canvas, the PhoneCombo board). One scroll:
// masthead → your desk (working card, free-now switch, what needs you) →
// live → the board (what the community pinned this week, from
// /api/home-feed) → more from your desk (this month's money, your link,
// faces to follow, this week's counts, your course) → the Stream strip.
// Signed out, the desk is the invitation to pin yourself to the board.
export default function Home() {
  const router = useRouter();
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [isSubscriber, setIsSubscriber] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const messagesUnread = useUnreadMessages();

  // "Here only for the stream?" on: the app opens on Stream.
  useEffect(() => {
    if (!takeLaunchCheck()) return;
    readStayInStream().then((on) => { if (on) router.replace('/stream'); });
  }, []);

  // Signed in, the feed measures the board from the viewer's own card and
  // carries their desk (the 4 s guard keeps a slow Clerk from holding up
  // the home page). Reloaded whenever the screen comes back into focus so
  // a call answered or a card edited elsewhere shows at once. getToken
  // goes through a ref so the focus effect never re-runs on a render.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const load = useCallback(() => {
    let cancelled = false;
    freshToken(getTokenRef.current)
      .then((token) => apiGet('/api/home-feed', token))
      .then((feed) => { if (!cancelled) setState({ loading: false, error: null, feed }); })
      .catch((err) => { if (!cancelled) setState((s) => ({ loading: false, error: s.feed ? null : err.message, feed: s.feed })); });
    return () => { cancelled = true; };
  }, []);
  useFocusEffect(load);

  // A notification's href is the website's; open the app's screen for it
  // when there is one, else the page in the browser.
  function openHref(href) {
    const where = hrefToRoute(href || '/account');
    if (!where) router.push('/account');
    else if (where.route) router.push(where.route);
    else Linking.openURL(where.url);
  }

  // Who is looking: the classified hides for subscribers, the money and
  // link cards show for creators (and admins). Best effort, non-blocking.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await freshToken(getToken);
      if (!token) return;
      const [info, role] = await Promise.all([apiGet('/api/account/dashboard-info', token).catch(() => null), apiGet('/api/my-role', token).catch(() => null)]);
      if (cancelled) return;
      if (info && info.isSubscriber) setIsSubscriber(true);
      if (role && (role.isCreator || role.isAdmin)) setIsCreator(true);
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  function openAnnouncement(url) {
    if (/^https?:\/\//i.test(url)) Linking.openURL(url); else router.push(url);
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }

  if (state.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.error}>Couldn't load the board: {state.error}</Text></View>
      </SafeAreaView>
    );
  }

  const {
    liveStream, announcements = [], featuredCreators = [], urgentCalls = [], castingCalls = [], newCalls = [],
    pitches = [], places = [], shooting = [], freeNow = [], course = null, deal = null,
    counts = {}, facesToFollow = [], crewNearLabel = null, desk = null
  } = state.feed;
  const signedIn = Boolean(isSignedIn && desk);
  const nearSuffix = crewNearLabel ? ' near you' : '';
  const hasBoard = urgentCalls.length || featuredCreators.length || pitches.length || castingCalls.length || shooting.length || places.length || announcements.length || freeNow.length || newCalls.length || course || deal;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        <View style={styles.masthead}>
          <Text style={styles.kicker}>{todayLine(crewNearLabel)}</Text>
          <View style={{ transform: [{ rotate: '-1.5deg' }], alignSelf: 'flex-start' }}><Text style={styles.title}>The Notice Board</Text></View>
          <Text style={styles.blurb}>Who needs a hand, what's raising money, where to shoot and who's free. Pinned by the people making things here.</Text>
        </View>

        {signedIn && (
          <View style={styles.gutter}>
            <Text style={[styles.deskLabel, styles.deskLabelStrong]}>Your desk</Text>
            <DeskCard desk={desk} counts={counts} messagesUnread={messagesUnread} getToken={getToken} onOpen={(href) => router.push(href)} />
            {desk.needs.length > 0 && (
              <View style={styles.deskCard}>
                <Text style={[styles.deskLabel, { color: colors.brass }]}>Needs you · {desk.unreadCount}</Text>
                {desk.needs.map((n) => (
                  <Pressable key={n.id} style={styles.need} onPress={() => openHref(n.href)}>
                    <View style={[styles.needDot, { backgroundColor: needColor(n.type) }]} />
                    <Text style={styles.needText} numberOfLines={2}>{n.message}</Text>
                    <Text style={styles.needWhen}>{whenLabel(n.createdAt)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {liveStream && (
          <View style={styles.gutter}>
            <Pressable style={styles.liveFlash} onPress={() => router.push('/live')}>
              <View style={styles.liveDot} />
              <Text style={styles.liveLabel}>Live on TapaTV · CH 01</Text>
              <Text style={styles.liveTitle}>{liveStream.title}</Text>
              <Text style={styles.liveCta}>Tune in →</Text>
            </Pressable>
          </View>
        )}

        <HomeOnNow gutter={GUTTER} />

        <View style={styles.gutter}>
          <Text style={[styles.deskLabel, styles.deskLabelStrong, { marginTop: 12 }]}>The board</Text>
          {!hasBoard && <Text style={styles.empty}>Nothing is pinned yet. The first calls, pitches and places will show here.</Text>}

          {urgentCalls.map((c) => (
            <Pressable key={c.id} style={[styles.pin, styles.paper, tilt(-1)]} onPress={() => router.push(`/crew/calls/${c.id}`)}>
              <View style={styles.tape} />
              <Text style={[styles.kick, { color: colors.danger }]}>URGENT{c.neededLabel ? ` · ${c.neededLabel.toUpperCase()}` : ''}</Text>
              <Text style={styles.paperTitle}>{c.title}</Text>
              <Text style={styles.paperBody}>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''} · {c.remote ? 'Remote' : c.place}{c.miles != null ? ` · ${c.miles} mi` : ''} · {c.payLabel}{c.paySecured ? ' · Pay secured' : ''}</Text>
              <View style={styles.byRow}><Text style={styles.by}>Posted by {c.posterName}</Text>{c.posterTier ? <TierChip person={{ tier: c.posterTier, done: c.posterDone }} /> : null}</View>
              <View style={styles.actions}>
                <View style={[styles.btn, styles.btnDark]}><Text style={styles.btnDarkText}>I can do it</Text></View>
                <View style={[styles.btn, styles.btnOutline]}><Text style={styles.btnOutlineText}>See the call</Text></View>
              </View>
            </Pressable>
          ))}

          {featuredCreators.length > 0 && (
            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.kick, { color: colors.sky }]}>THE FACES BEHIND IT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
                {featuredCreators.map((c, i) => (
                  <Pressable key={c.userId} style={[styles.polaroid, { marginTop: i % 2 ? 10 : 0, transform: [{ rotate: i % 2 ? '-3deg' : '2deg' }] }]} onPress={() => router.push(`/profile/${c.userId}`)}>
                    <View style={styles.polaroidPhoto}>
                      {c.avatarUrl ? <PositionedImage uri={c.avatarUrl} position={c.avatarPosition} zoom={c.avatarZoom || 1} style={absoluteFill} /> : null}
                    </View>
                    <Text style={styles.polaroidName} numberOfLines={1}>{c.displayName}</Text>
                    <Text style={styles.polaroidCredit} numberOfLines={2}>{c.credits.slice(0, 2).join(', ')}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {pitches.map((p) => {
            const pct = p.fundingGoal && p.fundingRaised != null ? Math.min(100, Math.round((p.fundingRaised / p.fundingGoal) * 100)) : null;
            return (
              <Pressable key={p.id} style={[styles.pin, styles.dark, tilt(0.8)]} onPress={() => router.push(`/pitches/${p.id}`)}>
                <View style={styles.band}><Text style={styles.bandText} numberOfLines={1}>{p.title}</Text></View>
                <View style={styles.pinBody}>
                  <Text style={[styles.kick, { color: colors.olive }]}>PITCH ROOM{p.creatorName ? ` · BY ${p.creatorName.toUpperCase()}` : ''}</Text>
                  {p.logline ? <Text style={[styles.darkBody, { fontStyle: 'italic' }]}>{p.logline}</Text> : null}
                  {pct != null && <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>}
                  {p.fundingRaised != null && <Text style={styles.monoLine}>${Number(p.fundingRaised).toLocaleString()} raised{p.fundingGoal ? ` of $${Number(p.fundingGoal).toLocaleString()}` : ''}</Text>}
                  <View style={styles.actions}>
                    <View style={[styles.btn, styles.btnGold]}><Text style={styles.btnGoldText}>Back it</Text></View>
                    {p.creatorUserId ? <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => router.push(`/profile/${p.creatorUserId}`)}><Text style={styles.btnGhostText}>The maker</Text></Pressable> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}

          {castingCalls.map((c) => (
            <Pressable key={c.id} style={[styles.pin, styles.paper, tilt(0.8)]} onPress={() => router.push(`/crew/calls/${c.id}`)}>
              <Text style={[styles.kick, { color: colors.rust }]}>CASTING{c.projectTitle ? ` · ${c.projectTitle.toUpperCase()}` : ''}</Text>
              <Text style={styles.paperTitle}>{c.characterName || c.title}{c.playingAge ? `, ${c.playingAge}` : ''}</Text>
              <Text style={styles.paperBody}>{c.role}{c.unionLabel ? ` · ${c.unionLabel}` : ''} · {c.payLabel}{c.selfTapeDue ? ` · self-tape due ${dateLabel(c.selfTapeDue)}` : ''}</Text>
              <Text style={[styles.link, { color: colors.rust }]}>{c.selfTapeDue ? 'Send a self-tape →' : 'See the role →'}</Text>
            </Pressable>
          ))}

          {shooting.map((p) => (
            <Pressable key={p.id} style={[styles.pin, styles.outline, tilt(0.8)]} onPress={() => router.push(`/productions/${p.id}`)}>
              <View style={styles.kickRow}><View style={styles.pulse} /><Text style={[styles.kick, { color: colors.sky, marginBottom: 0 }]}>NOW SHOOTING</Text></View>
              <Text style={styles.darkTitle}>{p.title}</Text>
              <Text style={styles.darkBody}>{[p.membersCount ? `${p.membersCount} crew` : null, p.daysCount ? `${p.daysCount} ${p.daysCount === 1 ? 'day' : 'days'}` : null, p.placeLabel].filter(Boolean).join(' · ')}</Text>
              <View style={styles.actions}>
                {p.openCalls > 0 ? <View style={[styles.chip, { backgroundColor: colors.brass }]}><Text style={styles.chipText}>{p.openCalls} {p.openCalls === 1 ? 'spot' : 'spots'} still open</Text></View> : null}
                <Text style={styles.link}>See the production →</Text>
              </View>
            </Pressable>
          ))}

          {places.map((l) => (
            <Pressable key={l.id} style={[styles.pin, styles.dark, tilt(-1)]} onPress={() => router.push(`/locations/${l.id}`)}>
              <View style={styles.photo}>
                {l.photo ? <SmartImage uri={l.photo} style={absoluteFill} /> : <Text style={styles.photoEmpty}>{String(l.kindLabel || 'Location').toUpperCase()}</Text>}
              </View>
              <View style={styles.pinBody}>
                <Text style={[styles.kick, { color: colors.mint }]}>LOCATION{l.placeLabel ? ` · ${l.placeLabel.toUpperCase()}` : ''}{l.miles != null ? ` · ${l.miles} MI` : ''}</Text>
                <Text style={styles.darkTitle}>{l.title}</Text>
                <Text style={styles.darkBody}>{[l.rateLine, l.studioRateLine, l.shootsCount ? `Hosted ${l.shootsCount}` : null, l.titlesShotHere ? `${l.titlesShotHere} ${l.titlesShotHere === 1 ? 'title' : 'titles'} shot here` : null].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
          ))}

          {announcements.map((a) => (
            <Pressable key={a.id} style={[styles.pin, styles.gold, tilt(-1)]} onPress={a.linkUrl ? () => openAnnouncement(a.linkUrl) : undefined} disabled={!a.linkUrl}>
              <Text style={[styles.kick, { color: PAPER_INK, opacity: 0.75 }]}>FROM THE STUDIO · {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</Text>
              <Text style={styles.paperTitle}>{a.title}</Text>
              {a.body ? <Text style={styles.paperBody}>{a.body}</Text> : null}
            </Pressable>
          ))}

          {freeNow.length > 0 && (
            <View style={[styles.pin, styles.dark, styles.pinBody]}>
              <Text style={[styles.kick, { color: colors.olive }]}>FREE RIGHT NOW{nearSuffix.toUpperCase()}</Text>
              {freeNow.map((p) => (
                <Pressable key={p.userId} style={styles.row} onPress={() => router.push(p.profilePath)}>
                  <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom || 1} size={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>{p.roles.join(' · ')}{p.miles != null ? ` · ${p.miles} mi` : ''}</Text>
                  </View>
                  <Text style={styles.rowEnd}>{p.availableNowUntil ? `till ${timeLabel(p.availableNowUntil)}` : 'today'}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => router.push('/crew?free=1')}><Text style={styles.link}>Everyone free now →</Text></Pressable>
            </View>
          )}

          {newCalls.map((c) => (
            <Pressable key={c.id} style={[styles.pin, styles.paper, tilt(0.8)]} onPress={() => router.push(`/crew/calls/${c.id}`)}>
              <Text style={[styles.kick, { color: colors.rust }]}>CREW CALL{c.projectTitle ? ` · ${c.projectTitle.toUpperCase()}` : ''}</Text>
              <Text style={styles.paperTitle}>{c.title}</Text>
              <Text style={styles.paperBody}>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''} · {c.remote ? 'Remote' : c.place}{c.miles != null ? ` · ${c.miles} mi` : ''}{c.startsOn ? ` · ${dateLabel(c.startsOn)}` : ''}</Text>
              <View style={styles.byRow}><Text style={styles.by}>by {c.posterName}</Text>{c.posterTier ? <TierChip person={{ tier: c.posterTier, done: c.posterDone }} /> : null}</View>
              <Text style={styles.paperMono}>{c.payLabel}{c.paySecured ? ' · pay secured' : ''}{c.payNote ? ` · ${c.payNote}` : ''} · {c.responsesCount} {c.responsesCount === 1 ? 'response' : 'responses'}</Text>
            </Pressable>
          ))}

          {course && (
            <Pressable style={[styles.pin, styles.paper, tilt(0.8)]} onPress={() => router.push(course.lessonSlug ? `/university/lesson/${course.slug}/${course.lessonSlug}` : `/university/course/${course.slug}`)}>
              <Text style={[styles.kick, { color: PAPER_GREEN }]}>FILM UNIVERSITY · {course.started ? 'CLASS IS IN' : 'NEW COURSE'}</Text>
              <Text style={styles.paperTitle}>{course.title}</Text>
              <Text style={styles.paperBody}>{course.started ? `Lesson ${course.doneCount + 1} of ${course.total}${course.remaining ? ` · ${course.remaining} left` : ''}` : [course.levelLabel, course.total ? `${course.total} ${course.total === 1 ? 'lesson' : 'lessons'}` : null, 'free'].filter(Boolean).join(' · ')}</Text>
              <Text style={[styles.link, { color: PAPER_GREEN }]}>{course.started ? `Pick up at ${course.lessonTitle} →` : 'Start the course →'}</Text>
            </Pressable>
          )}

          {deal && (
            <Pressable style={[styles.pin, styles.dashed]} onPress={() => router.push('/resources')}>
              <Text style={[styles.kick, { color: colors.olive }]}>RESOURCES · PARTNER DEAL</Text>
              <Text style={styles.darkTitle}>{deal.deal}</Text>
              <Text style={styles.darkBody}>{deal.name}{deal.kindLabel ? ` · ${deal.kindLabel}` : ''}{deal.hasCode && !deal.canReveal && deal.gateLabel ? ` · the code opens for ${deal.gateLabel.toLowerCase()}` : ''}</Text>
              <Text style={styles.link}>{deal.hasCode ? 'Show the code →' : 'See the deal →'}</Text>
            </Pressable>
          )}

          <Text style={[styles.deskLabel, styles.deskLabelStrong, { marginTop: 10 }]}>{signedIn ? 'More from your desk' : 'Your desk'}</Text>

          {signedIn && isCreator && <DeskMoney getToken={getToken} onOpen={() => router.push('/creator/money')} />}
          {signedIn && isCreator && <DeskLink getToken={getToken} />}

          {!signedIn && (
            <View style={[styles.deskCard, styles.goldCard, tilt(-1)]}>
              <Text style={[styles.kick, { color: PAPER_INK, opacity: 0.75 }]}>PIN YOURSELF TO THE BOARD</Text>
              <Text style={styles.goldTitle}>Make a working card. Calls near you find you.</Text>
              <Text style={styles.paperBody}>Your roles, your gear, how far you'll travel. Free, and it only takes a couple of minutes.</Text>
              <View style={styles.actions}>
                <Pressable style={[styles.btn, styles.btnDark]} onPress={() => router.push(isSignedIn ? '/crew/card' : '/account')}><Text style={styles.btnDarkText}>{isSignedIn ? 'Make my card' : 'Sign in'}</Text></Pressable>
                <Pressable style={[styles.btn, styles.btnOutline]} onPress={() => router.push('/crew')}><Text style={styles.btnOutlineText}>See Crew Call</Text></Pressable>
              </View>
            </View>
          )}

          <FollowList people={facesToFollow} signedIn={Boolean(isSignedIn)} getToken={getToken} onOpen={(path) => router.push(path)} onSignIn={() => router.push('/account')} />

          <View style={styles.deskCard}>
            <Text style={styles.deskLabel}>THIS WEEK{nearSuffix.toUpperCase()}</Text>
            <WeekRow label="Open calls" n={counts.openCalls} color={colors.brass} onPress={() => router.push('/crew/calls')} />
            <WeekRow label="Projects raising" n={counts.raising} color={colors.olive} onPress={() => router.push('/pitches')} />
            <WeekRow label={counts.newPlaces ? 'New places' : 'Places to shoot'} n={counts.newPlaces || counts.places} color={colors.mint} onPress={() => router.push('/locations')} />
            <WeekRow label="Shooting" n={counts.shooting} color={colors.sky} onPress={() => router.push('/productions')} />
            <WeekRow label="Free right now" n={counts.freeNow} color={colors.olive} onPress={() => router.push('/crew?free=1')} last />
          </View>

          {signedIn && course && course.started && (
            <Pressable style={[styles.deskCard, { backgroundColor: colors.ink }]} onPress={() => router.push(`/university/lesson/${course.slug}/${course.lessonSlug}`)}>
              <Text style={[styles.deskLabel, { color: PAPER_GREEN }]}>YOUR COURSE</Text>
              <Text style={styles.paperTitle}>{course.title}</Text>
              <View style={[styles.bar, { backgroundColor: 'rgba(36,26,5,0.15)' }]}><View style={[styles.barFill, { backgroundColor: PAPER_GREEN, width: `${Math.round((course.doneCount / Math.max(1, course.total)) * 100)}%` }]} /></View>
              <Text style={[styles.foot, { color: PAPER_MUTED }]}>Lesson {course.doneCount + 1} of {course.total} · Continue</Text>
            </Pressable>
          )}

          <View style={styles.stream}>
            <Text style={[styles.kick, { color: colors.inkFaint }]}>OVER ON STREAM</Text>
            <Text style={styles.streamBody}>Films, series and podcasts made by the people on this board.</Text>
            <Pressable style={[styles.btn, styles.btnBrass]} onPress={() => router.push('/stream')}><Text style={styles.btnBrassText}>Go to Stream</Text></Pressable>
          </View>

          {!isSubscriber && (
            <Pressable style={styles.classified} onPress={() => router.push('/account')}>
              <Text style={styles.classifiedEyebrow}>Classifieds — Membership</Text>
              <Text style={styles.classifiedTitle}>WANTED: ad-free viewers to back the creators directly.</Text>
              <Text style={styles.classifiedBody}>Early episodes, gated series, and a direct line to what you fund. Inquire within.</Text>
              <Text style={styles.classifiedCta}>Join Tapa + {'→'}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// The working card at the top of the desk: who you are on the board, the
// three counts (needs you / unread / free now near you) and the free-now
// switch (POST /api/crew/available-now, migration 105).
function DeskCard({ desk, counts, messagesUnread, getToken, onOpen }) {
  const card = desk.card;
  const [until, setUntil] = useState(card ? card.availableNowUntil : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setUntil(card ? card.availableNowUntil : null); }, [card && card.availableNowUntil]);
  const on = Boolean(until) && Date.parse(until) > Date.now();
  async function toggle() {
    setBusy(true); setError(null);
    try {
      const d = await apiPost('/api/crew/available-now', { hours: on ? 0 : FREE_NOW_HOURS }, await freshToken(getToken));
      setUntil(d.availableNowUntil || null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <View style={styles.deskCard}>
      <View style={styles.who}>
        <Avatar userId={desk.userId} name={desk.displayName || 'You'} src={desk.avatarUrl} position={desk.avatarPosition} zoom={desk.avatarZoom || 1} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.whoName} numberOfLines={1}>{desk.displayName || 'Your working card'}</Text>
          {card ? (
            <View style={styles.whoTier}>{card.tier ? <TierChip person={{ tier: card.tier, done: card.done }} /> : null}{card.availability === 'open' ? <Text style={styles.whoSmall}>open to work</Text> : null}</View>
          ) : <Text style={styles.whoSmall}>No working card yet</Text>}
        </View>
        <Pressable onPress={() => onOpen('/crew/card')} hitSlop={8}><Text style={styles.cardLink}>{card ? 'Card →' : 'Make one →'}</Text></Pressable>
      </View>
      {card ? (
        <>
          <Text style={styles.whoLine}>{card.roles.join(' · ') || 'No roles yet'}</Text>
          <Text style={styles.whoSub}>{[card.placeLabel, card.travelMiles ? `travels ${card.travelMiles} mi` : null, card.remoteOk ? 'remote OK' : null].filter(Boolean).join(' · ')}</Text>
        </>
      ) : null}
      <View style={styles.counts}>
        <Count n={desk.unreadCount} label="Need you" color={colors.brass} />
        <Count n={messagesUnread} label="Unread" color={colors.sky} />
        <Count n={counts.freeNow || 0} label="Free now" color={colors.olive} />
      </View>
      {card ? (
        <Pressable style={[styles.freeBtn, on && styles.freeBtnOn]} onPress={toggle} disabled={busy} accessibilityState={{ selected: on }}>
          <View style={[styles.freeDot, { backgroundColor: on ? PAPER_INK : colors.olive }]} />
          <Text style={[styles.freeBtnText, on && { color: PAPER_INK }]}>{on ? `Free until ${timeLabel(until)} · stop` : "I'm free right now"}</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.freeBtn} onPress={() => onOpen('/crew/card')}><Text style={styles.freeBtnText}>Make a working card →</Text></Pressable>
      )}
      {error ? <Text style={styles.errorLine}>{error}</Text> : null}
      <View style={styles.deskLinks}>
        <Pressable onPress={() => onOpen('/crew/card')}><Text style={styles.deskLinkText}>{card ? 'Edit your card' : 'Why a card?'}</Text></Pressable>
        <Pressable onPress={() => onOpen('/crew/calls/new')}><Text style={styles.deskLinkText}>Post a call</Text></Pressable>
      </View>
    </View>
  );
}

function Count({ n, label, color }) {
  return (
    <View style={styles.count}>
      <Text style={[styles.countN, { color }]}>{n || 0}</Text>
      <Text style={styles.countLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

// This month's money from the creator's own Money screen data (403 for
// anyone without a lane of their own, and the card then doesn't render).
function DeskMoney({ getToken, onOpen }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    freshToken(getToken).then((token) => (token ? apiGet('/api/creator/money', token) : null)).then((d) => { if (!cancelled && d && !d.error) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  const all = LANE_ORDER.filter((k) => k !== 'payouts' && data.lanes && data.lanes[k] && (k !== 'bookings' || data.lanes[k].shows));
  const withMoney = all.filter((k) => data.lanes[k].monthCents > 0);
  const lanes = (withMoney.length ? withMoney : all.slice(0, 3)).slice(0, 4);
  const next = data.top && data.top.nextPayout;
  return (
    <Pressable style={styles.deskCard} onPress={onOpen}>
      <Text style={styles.deskLabel}>THIS MONTH</Text>
      <Text style={styles.moneyTotal}>{dollars(data.top.monthCents)}</Text>
      {lanes.map((k) => (
        <View key={k} style={[styles.moneyRow, { borderLeftColor: LANE_COLOR[k] || colors.inkFaint }]}>
          <Text style={styles.moneyLane}>{LANES[k] ? LANES[k].label : k}</Text>
          <Text style={styles.moneyAmt}>{dollars(data.lanes[k].monthCents)}</Text>
        </View>
      ))}
      <Text style={styles.foot}>{data.top.owedCents > 0 ? `${dollars(data.top.owedCents)} owed` : 'Nothing owed yet'}{next && next.willPay ? ' · pays on the 1st' : ''} · Money →</Text>
    </Pressable>
  );
}
const LANE_COLOR = { member_support: colors.brass, ad_share: colors.sky, tips: colors.olive, sales: colors.ink, backing: colors.rust, bookings: colors.mint };

// The creator's own link (/api/creator/referrals → getReferralStats).
function DeskLink({ getToken }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    freshToken(getToken).then((token) => (token ? apiGet('/api/creator/referrals', token) : null)).then((d) => { if (!cancelled && d && d.linkPath && d.available !== false) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  const full = `${API_BASE_URL}${data.linkPath}`;
  async function copy() {
    try { await Clipboard.setStringAsync(full); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (err) { /* no clipboard */ }
  }
  return (
    <View style={styles.deskCard}>
      <Text style={styles.deskLabel}>YOUR LINK</Text>
      <View style={styles.linkRow}>
        <Text style={styles.linkText} numberOfLines={1}>{full.replace(/^https?:\/\/(www\.)?/, '')}</Text>
        <Pressable style={styles.linkCopy} onPress={copy}><Text style={styles.linkCopyText}>{copied ? 'Copied' : 'Copy'}</Text></Pressable>
      </View>
      <Text style={styles.foot}>{data.joined === 1 ? '1 person joined' : `${data.joined || 0} people joined`} through it{data.joined ? ` · ${data.active} still ${data.active === 1 ? 'a member' : 'members'}` : ''}</Text>
    </View>
  );
}

// Faces to follow: one Follow per person through /api/profile-follow.
function FollowList({ people, signedIn, getToken, onOpen, onSignIn }) {
  const [following, setFollowing] = useState({});
  const [busy, setBusy] = useState(null);
  if (!people.length) return null;
  async function toggle(userId) {
    if (!signedIn) { onSignIn(); return; }
    setBusy(userId);
    try {
      const d = await apiPost('/api/profile-follow', { followedId: userId }, await freshToken(getToken));
      setFollowing((f) => ({ ...f, [userId]: Boolean(d.following) }));
    } catch (err) { /* leave as is */ } finally { setBusy(null); }
  }
  return (
    <View style={styles.deskCard}>
      <Text style={[styles.deskLabel, { color: colors.sky }]}>FACES TO FOLLOW</Text>
      {people.map((p, i) => (
        <View key={p.userId} style={[styles.row, i === people.length - 1 && { borderBottomWidth: 0 }]}>
          <Pressable style={styles.rowWho} onPress={() => onOpen(p.profilePath)}>
            <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom || 1} size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowName} numberOfLines={1}>{p.displayName}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>{p.why}</Text>
            </View>
          </Pressable>
          <Pressable style={[styles.followBtn, following[p.userId] && styles.followBtnOn]} onPress={() => toggle(p.userId)} disabled={busy === p.userId}>
            <Text style={[styles.followText, following[p.userId] && { color: PAPER_INK }]}>{following[p.userId] ? 'Following' : 'Follow'}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function WeekRow({ label, n, color, onPress, last }) {
  return (
    <Pressable style={[styles.weekRow, last && { borderBottomWidth: 0 }]} onPress={onPress}>
      <Text style={styles.weekLabel}>{label}</Text>
      <Text style={[styles.weekN, { color }]}>{n || 0}</Text>
    </Pressable>
  );
}

const tilt = (deg) => ({ transform: [{ rotate: `${deg}deg` }] });
const timeLabel = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dateLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
function whenLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days < 1 && d.getDate() === now.getDate()) return timeLabel(iso);
  if (days < 2) return 'yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function todayLine(place) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return [today, place].filter(Boolean).join(' · ').toUpperCase();
}
function needColor(type) {
  if (type === 'message') return colors.sky;
  if (type === 'payout' || type === 'tip' || type === 'purchase') return colors.olive;
  if (/^call/.test(type || '')) return colors.danger;
  return colors.brass;
}

const GUTTER = 17.6;
const HAIRLINE = 'rgba(251,232,211,0.08)';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center', fontFamily: fonts.display },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  gutter: { paddingHorizontal: GUTTER },

  // .hb-masthead
  masthead: { paddingTop: 19, paddingHorizontal: GUTTER, paddingBottom: 12, gap: 5 },
  kicker: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 1.2, color: colors.brass },
  title: { fontFamily: fonts.bodyBold, fontSize: 30, lineHeight: 34, color: colors.ink },
  blurb: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim, marginTop: 4 },

  // .hb-live
  liveFlash: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 6, backgroundColor: colors.rust, paddingVertical: 13, paddingHorizontal: 17, borderRadius: 3, transform: [{ rotate: '-0.5deg' }], shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6, marginBottom: 14 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink },
  liveLabel: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ink, opacity: 0.85 },
  liveTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, flex: 1, minWidth: 120 },
  liveCta: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.ink },

  // the desk
  deskLabel: { fontFamily: fonts.mono, fontSize: 9.6, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.inkFaint, marginBottom: 9 },
  deskLabelStrong: { color: colors.ink, fontSize: 10.8 },
  deskCard: { backgroundColor: colors.surface1, borderRadius: 10, paddingTop: 14, paddingHorizontal: 15, paddingBottom: 15, marginBottom: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8 },
  whoName: { fontFamily: fonts.displayBold, fontSize: 15.5, color: colors.ink },
  whoTier: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3 },
  whoSmall: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint },
  whoLine: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink, marginBottom: 2 },
  whoSub: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint, marginBottom: 8 },
  cardLink: { fontFamily: fonts.mono, fontSize: 11, color: colors.brass },
  counts: { flexDirection: 'row', gap: 10, marginBottom: 11, marginTop: 4 },
  count: { flex: 1, backgroundColor: colors.surface0, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  countN: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 24 },
  countLabel: { fontFamily: fonts.mono, fontSize: 8.6, letterSpacing: 1, color: colors.inkFaint, marginTop: 2 },
  freeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.olive, borderRadius: 7, paddingVertical: 10 },
  freeBtnOn: { backgroundColor: colors.olive },
  freeDot: { width: 8, height: 8, borderRadius: 4 },
  freeBtnText: { fontFamily: fonts.monoBold, fontSize: 11.5, color: colors.olive },
  errorLine: { fontFamily: fonts.body, fontSize: 12, color: colors.danger, marginTop: 6 },
  deskLinks: { flexDirection: 'row', gap: 16, marginTop: 11 },
  deskLinkText: { fontFamily: fonts.mono, fontSize: 10.8, color: colors.inkDim },
  need: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: HAIRLINE },
  needDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  needText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink },
  needWhen: { fontFamily: fonts.mono, fontSize: 9.6, color: colors.inkFaint, marginTop: 3 },
  goldCard: { backgroundColor: colors.olive, borderRadius: 2 },
  goldTitle: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 23, color: PAPER_INK, marginBottom: 6 },
  moneyTotal: { fontFamily: fonts.displayBold, fontSize: 27, lineHeight: 30, color: colors.ink, marginBottom: 9 },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', borderLeftWidth: 3, paddingLeft: 9, paddingVertical: 2, marginBottom: 4 },
  moneyLane: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink },
  moneyAmt: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.ink },
  foot: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint, marginTop: 7 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface0, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 10 },
  linkText: { flex: 1, fontFamily: fonts.mono, fontSize: 11.5, color: colors.brass },
  linkCopy: { backgroundColor: colors.brass, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 10 },
  linkCopyText: { fontFamily: fonts.monoBold, fontSize: 10, color: PAPER_INK },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  rowWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 },
  rowName: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink },
  rowMeta: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint },
  rowEnd: { fontFamily: fonts.mono, fontSize: 10, color: colors.olive },
  followBtn: { borderWidth: 1, borderColor: colors.sky, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 11 },
  followBtnOn: { backgroundColor: colors.sky },
  followText: { fontFamily: fonts.mono, fontSize: 10, color: colors.sky },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  weekLabel: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
  weekN: { fontFamily: fonts.monoBold, fontSize: 15 },

  // the board pins
  empty: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkFaint, paddingVertical: 20, textAlign: 'center' },
  pin: { borderRadius: 2, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  paper: { backgroundColor: colors.ink, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16 },
  dark: { backgroundColor: colors.surface1, overflow: 'hidden' },
  outline: { borderWidth: 2, borderColor: colors.sky, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, shadowOpacity: 0, elevation: 0 },
  gold: { backgroundColor: colors.olive, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16 },
  dashed: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(242,193,78,0.6)', paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, shadowOpacity: 0, elevation: 0 },
  pinBody: { paddingTop: 13, paddingHorizontal: 16, paddingBottom: 16 },
  tape: { position: 'absolute', top: -9, left: '50%', marginLeft: -35, width: 70, height: 18, backgroundColor: 'rgba(239,91,91,0.75)', transform: [{ rotate: '-2deg' }], borderRadius: 1 },
  kick: { fontFamily: fonts.mono, fontSize: 9.6, letterSpacing: 1.2, marginBottom: 7 },
  kickRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.sky },
  paperTitle: { fontFamily: fonts.bodyBold, fontSize: 16.5, lineHeight: 21, color: PAPER_INK, marginBottom: 5 },
  paperBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: PAPER_INK, opacity: 0.8, marginBottom: 7 },
  paperMono: { fontFamily: fonts.monoBold, fontSize: 10.6, color: colors.rust },
  darkTitle: { fontFamily: fonts.bodyBold, fontSize: 16.5, lineHeight: 21, color: colors.ink, marginBottom: 5 },
  darkBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.inkDim, marginBottom: 7 },
  band: { backgroundColor: colors.rust, paddingVertical: 11, paddingHorizontal: 16 },
  bandText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  photo: { height: 130, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  photoEmpty: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1, color: colors.inkFaint },
  byRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: 8 },
  by: { fontFamily: fonts.body, fontSize: 10.8, fontStyle: 'italic', color: PAPER_MUTED },
  monoLine: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.ink, marginBottom: 6 },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginVertical: 6 },
  barFill: { height: '100%', backgroundColor: colors.olive, borderRadius: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 4 },
  btn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 3, borderWidth: 1, borderColor: 'transparent' },
  btnDark: { backgroundColor: PAPER_INK },
  btnDarkText: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.ink },
  btnOutline: { borderColor: 'rgba(36,26,5,0.5)' },
  btnOutlineText: { fontFamily: fonts.mono, fontSize: 10.5, color: PAPER_INK },
  btnGold: { backgroundColor: colors.olive },
  btnGoldText: { fontFamily: fonts.monoBold, fontSize: 10.5, color: PAPER_INK },
  btnGhost: { borderColor: 'rgba(251,232,211,0.3)' },
  btnGhostText: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.ink },
  btnBrass: { backgroundColor: colors.brass, paddingVertical: 9, paddingHorizontal: 16, alignSelf: 'flex-start' },
  btnBrassText: { fontFamily: fonts.monoBold, fontSize: 11.5, color: PAPER_INK },
  chip: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 20 },
  chipText: { fontFamily: fonts.mono, fontSize: 10, color: PAPER_INK },
  link: { fontFamily: fonts.monoBold, fontSize: 11, color: colors.brass, marginTop: 3 },

  // polaroids
  peopleRow: { flexDirection: 'row', gap: 14, paddingTop: 6, paddingBottom: 10, paddingHorizontal: 4 },
  polaroid: { width: 112, backgroundColor: colors.ink, paddingTop: 7, paddingHorizontal: 7, paddingBottom: 14 },
  polaroidPhoto: { width: '100%', height: 90, backgroundColor: colors.surface2, marginBottom: 7, overflow: 'hidden' },
  polaroidName: { fontFamily: fonts.displayBold, fontSize: 12, color: PAPER_INK, marginBottom: 2 },
  polaroidCredit: { fontFamily: fonts.body, fontSize: 9.5, color: PAPER_MUTED, fontStyle: 'italic' },

  // Over on Stream
  stream: { backgroundColor: colors.surface1, borderRadius: 8, padding: 16, marginTop: 4, marginBottom: 14, gap: 4 },
  streamBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim, marginBottom: 8 },

  // .zine-classified
  classified: { backgroundColor: colors.ink, paddingVertical: 17.6, paddingHorizontal: 20.8, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(36,26,5,0.35)', borderRadius: 2, transform: [{ rotate: '-0.6deg' }] },
  classifiedEyebrow: { fontFamily: fonts.mono, fontSize: 9.9, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.rust, marginBottom: 8 },
  classifiedTitle: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 21, color: PAPER_INK, marginBottom: 8 },
  classifiedBody: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19, color: PAPER_INK, opacity: 0.8, marginBottom: 11 },
  classifiedCta: { fontFamily: fonts.monoBold, fontSize: 12.2, color: PAPER_INK }
});
