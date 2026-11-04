import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { showCall, showPath } from '../../lib/showApi';
import { SUBMIT_TYPES, bytesLabel } from '../../lib/submitRules';
import { needsYou } from '../../lib/showRules';
import { episodeCode } from '../../lib/seriesResume';
import { brassTint, colors, fonts, inkTint, okTint, oliveTint } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import { cp, PrimaryButton, SecondaryButton } from '../../components/CreatorBits';
import { ClockIcon } from '../../components/WorkIcons';
import { KindChip, PlusIcon, StateChip, showRoute } from '../../components/show/ShowBits';

// Creator Studio's hub (mirrors pages/creator.js): Submit a title, the
// types under it, "Your shows", the drafts in flight, and the three piles
// (In review / Needs you / Live) from /api/creator/my-submissions.
//
// The series revamp (slice 5, the app; the website's slice 2 Hub board):
// "Your shows" — one card per show from GET /api/show?mine=1 with its
// kind, where it stands in decision 2's words (Live / Ready to go public /
// Not public yet / Pulled / Removal requested / Not this time), its count
// line and a clock when a change waits for approval; the dashed "+ New
// show" card; "Start a show" when there are none; hidden when the list
// can't load (the piles still show). A row of a show in the piles reads
// "Night Bus · S1 E3" and opens the show screen at that row. An approved
// episode of a show that isn't public yet is never Live: it waits in Needs
// you as "Ready to go public", once per show, with Make it public on the
// row. A show's drafts share one row that opens the show.
const PILE_LIMIT = 4;
// A show's numbering lines worth a row in Needs you (the rest of its
// problems are rows of their own already: a failed file, no captions).
const NUMBERING = { gap: 'Add it or renumber', duplicate: 'Pick one', parked: 'Give it its own number', unnumbered: 'Give each one a number' };

// The show a title row belongs to: its own (an episode), or the one an
// extra is attached to — directly, or through the episode it follows when
// that episode is one of these titles (byId).
function showOf(s, byId) {
  if (s.seriesId) return s.seriesId;
  if (s.contentType !== 'bonus' || !s.bonusParentId) return null;
  if (s.bonusParentType === 'series') return s.bonusParentId;
  const parent = s.bonusParentType === 'episode' && byId ? byId.get(s.bonusParentId) : null;
  return parent && parent.seriesId ? parent.seriesId : null;
}

function displayTitle(s) {
  const own = typeof s.title === 'string' ? s.title.trim() : '';
  if (own) return own;
  return s.seriesOrder ? `Episode ${s.seriesOrder}` : 'Untitled';
}

// On the site: approved, not pulled or on its way out, and in no show or a
// public one. An extra carries no show status of its own: the show it is
// attached to answers for it, when the strip has it.
function onSite(s, byId, showById) {
  if (s.status !== 'approved' || s.held || s.deletionRequested) return false;
  if (s.seriesId) return !s.seriesHeld && (s.seriesStatus === 'approved' || s.seriesStatus == null);
  const sid = showOf(s, byId);
  const sh = sid && showById ? showById.get(sid) : null;
  return !sh || sh.isPublic !== false;
}

function draftFileLine(d) {
  if (d.video) {
    const state = d.video.state === 'uploading' ? 'the upload stopped' : d.video.state === 'processing' ? 'the file is processing' : d.video.state === 'ready' ? 'ready to send' : 'the file failed to process';
    return `${state}${d.video.bytes ? ` · ${bytesLabel(d.video.bytes)}` : ''}`;
  }
  if (d.form && d.form.audioUrl) return 'ready to send';
  return 'no file yet';
}

function cfLabel(state) {
  return { pendingupload: 'upload not finished', downloading: 'receiving', queued: 'queued', inprogress: 'processing', error: 'failed to process' }[state] || state;
}

function ago(iso) {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

export default function CreatorStudio() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const submitted = typeof first(params.submitted) === 'string' ? first(params.submitted) : null;
  const submittedShow = typeof first(params.show) === 'string' && first(params.show) ? first(params.show) : null;
  const { isSignedIn, getToken: clerkGetToken } = useAuth();
  // One getter for the screen's life (Clerk's may change identity), so the
  // loaders below don't change every render.
  const tokenRef = useRef(clerkGetToken);
  tokenRef.current = clerkGetToken;
  const getToken = useCallback((...a) => tokenRef.current(...a), []);
  const [state, setState] = useState({ loading: true, error: null, forbidden: false, subs: null, drafts: [] });
  // null while loading; the strip hides when it can't load.
  const [shows, setShows] = useState(null);
  const [showsFailed, setShowsFailed] = useState(false);
  const [busyShow, setBusyShow] = useState(null);
  const [publicNote, setPublicNote] = useState(null); // { ok, text, showId }

  const loadSubs = useCallback(async () => {
    const [work, drafts] = await Promise.all([
      showCall('GET', '/api/creator/my-submissions', undefined, getToken),
      showCall('GET', '/api/creator/drafts', undefined, getToken)
    ]);
    if (!work.ok) {
      const forbidden = work.status === 403 && /creator access required/i.test(work.error || '');
      setState((st) => ({ ...st, loading: false, error: forbidden ? null : work.error, forbidden }));
      return;
    }
    setState({
      loading: false,
      error: null,
      forbidden: false,
      subs: Array.isArray(work.data.submissions) ? work.data.submissions : [],
      // Drafts before migration 116 answer 503: no drafts, nothing to say.
      drafts: drafts.ok && Array.isArray(drafts.data.drafts) ? drafts.data.drafts : []
    });
  }, [getToken]);

  const loadShows = useCallback(async () => {
    const r = await showCall('GET', '/api/show?mine=1', undefined, getToken);
    if (!r.ok || !Array.isArray(r.data.shows)) {
      setShowsFailed(true);
      return;
    }
    // Vertical series are the studio's; the strip is series and podcasts.
    setShows(r.data.shows.filter((sh) => sh && sh.kind !== 'vertical'));
    setShowsFailed(false);
  }, [getToken]);

  const load = useCallback(async () => {
    if (!isSignedIn) {
      setState({ loading: false, error: null, forbidden: true, subs: null, drafts: [] });
      return;
    }
    await Promise.all([loadSubs(), loadShows()]);
  }, [isSignedIn, loadSubs, loadShows]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function discardDraft(id) {
    Alert.alert('Discard this draft?', 'Its uploaded file is deleted too.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => {
        const r = await showCall('DELETE', '/api/creator/drafts', { id }, getToken);
        if (!r.ok) {
          Alert.alert('Could not discard it', r.error);
          return;
        }
        setState((st) => ({ ...st, drafts: st.drafts.filter((d) => d.id !== id) }));
      } }
    ]);
  }

  // Decision 2: the show's owner (or a full admin) makes it public once an
  // episode is approved. One-way, so it asks first and says so.
  function makePublic(showId, name, kind) {
    const label = name || 'this show';
    const noun = kind === 'podcast' ? 'show' : 'series';
    Alert.alert(`Make ${label} public?`, `Its approved episodes go on the site now, and the ones approved later go live as they’re approved. This is one-way: a public ${noun} only comes down if you remove it.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Make it public', onPress: async () => {
        setBusyShow(showId);
        setPublicNote(null);
        const r = await showCall('POST', `${showPath(showId)}/public`, {}, getToken);
        setPublicNote(r.ok ? { ok: true, text: `${label} is public.`, showId } : { ok: false, text: r.error || 'Could not make it public.' });
        await Promise.all([loadSubs(), loadShows()]);
        setBusyShow(null);
      } }
    ]);
  }

  const list = state.subs || [];
  const titleById = new Map(list.map((x) => [x.id, x]));
  const showById = new Map((shows || []).map((sh) => [sh.id, sh]));
  // The name of a show (a draft's, an extra's): the strip's, else a row's.
  const nameFromRows = (id) => {
    const row = list.find((x) => x.seriesId === id && x.seriesName);
    return row ? row.seriesName : null;
  };
  const showName = (id, fallback) => (showById.get(id) && showById.get(id).name) || fallback || nameFromRows(id) || 'a show';

  const inReview = list.filter((x) => x.status === 'pending');

  // Needs you: one "Ready to go public" row per private show (its approved
  // episodes, or the show alone when someone else uploaded them), the
  // titles' own reasons, then a show's numbering lines.
  const ready = new Map();
  const titleNeeds = [];
  for (const x of list) {
    const why = needsYou(x);
    if (!why) continue;
    if (why === 'Ready to go public' && x.seriesId) {
      const g = ready.get(x.seriesId) || { showId: x.seriesId, name: x.seriesName, kind: x.seriesKind, rows: [] };
      g.rows.push(x);
      ready.set(x.seriesId, g);
      continue;
    }
    titleNeeds.push({ s: x, why });
  }
  for (const sh of shows || []) {
    if (sh.state === 'ready' && !ready.has(sh.id)) ready.set(sh.id, { showId: sh.id, name: sh.name, kind: sh.kind, rows: [] });
  }
  const showNeeds = [];
  for (const sh of shows || []) {
    for (const p of sh.problems || []) if (NUMBERING[p.code]) showNeeds.push({ sh, p });
  }
  const readyRows = [...ready.values()].map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => (a.season || 1) - (b.season || 1) || (a.seriesOrder || 0) - (b.seriesOrder || 0)) }));
  const needsCount = readyRows.length + titleNeeds.length + showNeeds.length;

  const live = list
    .filter((x) => onSite(x, titleById, showById))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Drafts: one row each, but a show's drafts (Add several makes up to
  // thirty at a time) share one row that opens the show.
  const drafts = state.drafts || [];
  const looseDrafts = drafts.filter((d) => !(d.form && d.form.seriesId));
  const draftsByShow = new Map();
  for (const d of drafts) {
    const sid = d.form && d.form.seriesId ? String(d.form.seriesId) : null;
    if (!sid) continue;
    if (!draftsByShow.has(sid)) draftsByShow.set(sid, []);
    draftsByShow.get(sid).push(d);
  }

  const titleRow = (x, meta, fallback) => {
    const sid = showOf(x, titleById);
    if (!sid) return <Row key={x.id} s={x} title={displayTitle(x)} meta={meta} onPress={fallback} />;
    const code = x.contentType === 'bonus' ? 'extra' : episodeCode(x);
    return <Row key={x.id} s={x} eyebrow={<Eyebrow name={x.seriesName || showName(sid)} code={code} />} title={displayTitle(x)} meta={meta} onPress={() => router.push(showRoute(sid, { ep: x.id }))} />;
  };
  const toWork = (q) => () => router.push(`/account/my-work${q ? `?${q}` : ''}`);

  let room = PILE_LIMIT;
  const readyShown = readyRows.slice(0, room);
  room -= readyShown.length;
  const titleNeedsShown = titleNeeds.slice(0, Math.max(0, room));
  room -= titleNeedsShown.length;
  const showNeedsShown = showNeeds.slice(0, Math.max(0, room));

  return (
    <SafeAreaView style={cp.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={cp.scroll}>
        <View style={{ gap: 6 }}>
          <Text style={cp.eyebrow}>Creator Studio</Text>
          <Text style={cp.h1}>Your titles, in one place.</Text>
        </View>

        {state.forbidden ? (
          <View style={cp.card}>
            <Text style={cp.p}>Creator Studio opens once an application is accepted.</Text>
            <View style={cp.actions}><PrimaryButton label="Send us your film" onPress={() => router.push('/apply')} /></View>
          </View>
        ) : (
          <>
            {submitted ? (
              <View style={s.flash} accessibilityLiveRegion="polite">
                <Text style={cp.p}><Text style={cp.strong}>“{submitted}” is in.</Text> It sits under In review until we&rsquo;ve watched it.</Text>
                {submittedShow ? <Text style={cp.link} onPress={() => router.push(showRoute(submittedShow))}>Open the show page</Text> : null}
              </View>
            ) : null}
            <View style={s.submit}>
              <PrimaryButton label="Submit a title" onPress={() => router.push('/creator/submit')} />
              <View style={cp.chips}>
                {SUBMIT_TYPES.map((t) => (
                  <Pressable key={t.value} style={cp.chip} onPress={() => router.push(`/creator/submit?type=${t.value}`)}><Text style={cp.chipText}>{t.label}</Text></Pressable>
                ))}
                <Pressable style={cp.chip} onPress={() => router.push('/creator/pitch-new')}><Text style={cp.chipText}>Pitch a project</Text></Pressable>
              </View>
              <Text style={cp.help}>Three steps: the file (it uploads while you type), a few words about it, artwork. Saved as a draft as you go.</Text>
            </View>

            {!showsFailed ? <ShowsStrip shows={shows} onOpen={(sh) => router.push(showRoute(sh.id))} onNew={() => router.push('/creator/show/new')} /> : null}

            {publicNote ? (
              publicNote.ok ? (
                <View style={s.flash} accessibilityLiveRegion="polite">
                  <Text style={cp.p}><Text style={cp.strong}>{publicNote.text}</Text> Its approved episodes are on the site; the next ones go live as they&rsquo;re approved.</Text>
                  <Text style={cp.link} onPress={() => router.push(showRoute(publicNote.showId))}>Open the show page</Text>
                </View>
              ) : <Text style={cp.error} accessibilityRole="alert">{publicNote.text}</Text>
            ) : null}

            {drafts.length > 0 ? (
              <Pile k="Drafts" count={drafts.length} dashed>
                {[...draftsByShow.entries()].map(([sid, group]) => {
                  const only = group.length === 1 ? group[0] : null;
                  const code = only && only.form && only.form.seriesOrder ? `S${Number(only.form.season) || 1} E${only.form.seriesOrder}` : null;
                  const title = only ? ((only.form && String(only.form.title || '').trim()) || (code ? `Episode ${only.form.seriesOrder}` : (only.video && only.video.name) || 'Untitled draft')) : `${group.length} drafts`;
                  const readyCount = group.filter((d) => d.video && d.video.state === 'ready').length;
                  return (
                    <View key={`show-${sid}`} style={s.row}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
                        <Text style={s.rowMeta}>in {showName(sid)}{code ? ` · ${code}` : ''} · {only ? draftFileLine(only) : `${readyCount} ready to send`}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <SecondaryButton label="Open show" onPress={() => router.push(showRoute(sid, only ? { draft: only.id } : null))} style={{ height: 34 }} />
                        {only && only.form && only.form.addedFrom !== 'show' ? <Text style={cp.link} onPress={() => router.push(`/creator/submit?draft=${encodeURIComponent(only.id)}`)}>Continue here</Text> : null}
                        {only ? <Text style={cp.link} onPress={() => discardDraft(only.id)}>Discard</Text> : null}
                      </View>
                    </View>
                  );
                })}
                {looseDrafts.map((d) => (
                  <View key={d.id} style={s.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>{(d.form && d.form.title) || (d.video && d.video.name) || 'Untitled draft'}</Text>
                      <Text style={s.rowMeta}>{d.video ? `${d.video.state === 'uploading' ? 'the master’s upload stopped' : d.video.state === 'processing' ? 'the master is processing' : d.video.state === 'ready' ? 'the master is in' : 'the master failed to process'}${d.video.bytes ? ` · ${bytesLabel(d.video.bytes)}` : ''}` : 'no file yet'} · step {d.form && d.form.step ? d.form.step : 1} of 3</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <SecondaryButton label="Continue" onPress={() => router.push(`/creator/submit?draft=${encodeURIComponent(d.id)}`)} style={{ height: 34 }} />
                      <Text style={cp.link} onPress={() => discardDraft(d.id)}>Discard</Text>
                    </View>
                  </View>
                ))}
              </Pile>
            ) : null}

            {state.error ? <Text style={cp.error}>{state.error}</Text> : null}
            {state.loading ? <ActivityIndicator color={colors.brass} /> : null}

            <Pile k="In review" count={inReview.length} empty={state.subs ? 'Nothing waiting on us.' : 'Loading…'} onAll={toWork('status=pending')}>
              {inReview.slice(0, PILE_LIMIT).map((x) => titleRow(x, `sent ${ago(x.createdAt)}${x.cloudflareState && x.cloudflareState !== 'ready' ? ` · ${cfLabel(x.cloudflareState)}` : ''}`, toWork()))}
            </Pile>
            <Pile k="Needs you" count={needsCount} empty={state.subs ? 'Nothing to fix.' : 'Loading…'} tone="warn" onAll={toWork('attention=1')}>
              {readyShown.map((g) => {
                const sh = showById.get(g.showId);
                const top = g.rows[0] || null;
                const canPublish = Boolean(sh && sh.makePublic && sh.makePublic.ok);
                const name = g.name || showName(g.showId);
                const art = (top && (top.thumbnail || top.poster)) || (sh && (sh.thumbnail || sh.poster)) || null;
                return (
                  <View key={`ready-${g.showId}`} style={s.readyRow}>
                    <Pressable style={({ pressed }) => [s.readyLink, pressed && s.pressed]} onPress={() => router.push(showRoute(g.showId, top ? { ep: top.id } : null))} accessibilityRole="link">
                      {art ? <SmartImage uri={art} style={s.thumb} resizeMode="cover" /> : <View style={s.thumb} />}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Eyebrow name={name} code={top ? episodeCode(top) : null} />
                        <Text style={s.rowTitle} numberOfLines={1}>{top ? displayTitle(top) : name}</Text>
                        <Text style={s.rowMeta}>Ready to go public{g.rows.length > 1 ? ` · ${g.rows.length} episodes approved` : ''}</Text>
                      </View>
                    </Pressable>
                    {canPublish ? (
                      <PrimaryButton
                        label="Make it public"
                        busy={busyShow === g.showId}
                        disabled={Boolean(busyShow)}
                        onPress={() => makePublic(g.showId, name, (sh && sh.kind) || g.kind)}
                        style={s.readyBtn}
                      />
                    ) : null}
                  </View>
                );
              })}
              {titleNeedsShown.map(({ s: x, why }) => titleRow(x, why, toWork()))}
              {showNeedsShown.map(({ sh, p }) => (
                <Pressable key={`${sh.id}-${p.code}-${p.words}`} style={({ pressed }) => [s.row, pressed && s.pressed]} onPress={() => router.push(showRoute(sh.id))} accessibilityRole="link">
                  <View style={[s.thumb, s.thumbGap]}><Text style={s.thumbGapText}>{p.code === 'gap' ? (/E\d+/.exec(p.words) || [''])[0] : '#'}</Text></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.eyebrow} numberOfLines={1}>{sh.name}</Text>
                    <Text style={s.rowTitle} numberOfLines={2}>{p.words}</Text>
                    <Text style={s.rowMeta}>{NUMBERING[p.code]}</Text>
                  </View>
                </Pressable>
              ))}
            </Pile>
            <Pile k="Live" count={live.length} empty={state.subs ? 'Nothing live yet. The first one is the hardest.' : 'Loading…'} tone="ok" onAll={toWork('status=approved')}>
              {live.slice(0, PILE_LIMIT).map((x) => titleRow(x, `${x.viewCount || 0} view${x.viewCount === 1 ? '' : 's'}`, () => router.push(`/episode/${encodeURIComponent(x.id)}`)))}
            </Pile>

            <View style={s.links}>
              {[['Your work', '/account/my-work'], ['Your numbers', '/creator/numbers'], ['Money', '/creator/money'], ['Pitch Room', '/creator/pitches']].map(([label, href]) => (
                <Pressable key={href} onPress={() => router.push(href)}><Text style={s.linkText}>{label.toUpperCase()}</Text></Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const SKELETONS = [{ id: 'sk0', skeleton: true }, { id: 'sk1', skeleton: true }, { id: 'sk2', skeleton: true }];

// "Your shows": a horizontal strip of cards, "+ New show" last; skeletons
// while it loads; "Start a show" when there are none.
function ShowsStrip({ shows, onOpen, onNew }) {
  const loading = shows === null;
  const list = shows || [];
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.stripHead} accessibilityRole="header">Your shows{!loading && list.length > 0 ? <Text style={s.count}>{`  · ${list.length}`}</Text> : null}</Text>
      {!loading && list.length === 0 ? (
        <Pressable style={({ pressed }) => [s.start, pressed && s.pressed]} onPress={onNew} accessibilityRole="button">
          <View style={s.startPlus}><PlusIcon size={18} color={colors.olive} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.startK}>Start a show</Text>
            <Text style={s.rowMeta}>A series or a podcast gets its own page: its episodes in order, its art, one place to run it.</Text>
          </View>
        </Pressable>
      ) : (
        <FlatList
          horizontal
          data={loading ? SKELETONS : [...list, { id: '__new__', isNew: true }]}
          keyExtractor={(item) => String(item.id)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.stripRow}
          renderItem={({ item }) => {
            if (item.skeleton) {
              return (
                <View style={s.showCard} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <View style={[s.poster, s.posterEmpty]} />
                  <View style={s.skel} />
                  <View style={[s.skel, { width: '60%' }]} />
                </View>
              );
            }
            if (item.isNew) {
              return (
                <Pressable style={({ pressed }) => [s.showCard, pressed && s.pressed]} onPress={onNew} accessibilityRole="button" accessibilityLabel="New show">
                  <View style={[s.poster, s.posterNew]}>
                    <PlusIcon size={20} color={colors.inkDim} />
                    <Text style={s.posterNewText}>New show</Text>
                  </View>
                </Pressable>
              );
            }
            return <ShowCardSmall sh={item} onPress={() => onOpen(item)} />;
          }}
        />
      )}
    </View>
  );
}

function ShowCardSmall({ sh, onPress }) {
  const poster = sh.poster || null;
  const waiting = Boolean(sh.staged && sh.staged.any);
  return (
    <Pressable
      style={({ pressed }) => [s.showCard, pressed && s.pressed]}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={[sh.name, sh.kind === 'podcast' ? 'Podcast' : 'Series', sh.statusLabel, sh.countLine, waiting ? 'A change waits for approval' : null].filter(Boolean).join(', ')}
    >
      <View style={[s.poster, !poster && s.posterEmpty]}>
        {poster ? <SmartImage uri={poster} style={s.posterImg} resizeMode="cover" /> : <Text style={s.posterName} numberOfLines={4}>{sh.name}</Text>}
        {waiting ? <View style={s.clock}><ClockIcon size={13} color={colors.olive} /></View> : null}
      </View>
      <Text style={s.showName} numberOfLines={2}>{sh.name}</Text>
      <View style={s.showChips}>
        <KindChip kind={sh.kind} />
        {sh.statusLabel ? <StateChip state={sh.state} label={sh.statusLabel} /> : null}
      </View>
      <Text style={s.showCount} numberOfLines={2}>{sh.countLine}</Text>
    </Pressable>
  );
}

function Pile({ k, count, empty, tone, dashed, onAll, children }) {
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View style={[s.pile, tone === 'warn' && s.pileWarn, tone === 'ok' && s.pileOk, dashed && s.pileDashed]}>
      <View style={s.pileHead}><Text style={cp.cardK}>{k}</Text><Text style={s.count}>{count}</Text></View>
      {rows.length === 0 ? <Text style={cp.help}>{empty}</Text> : rows}
      {count > PILE_LIMIT && onAll ? <Text style={cp.link} onPress={onAll}>All {count} in Your work</Text> : null}
    </View>
  );
}

// "NIGHT BUS · S1 E3" over a pile row: a long show name is cut, never the
// episode's code.
function Eyebrow({ name, code }) {
  return (
    <View style={s.eyebrowRow}>
      <Text style={[s.eyebrow, { flexShrink: 1 }]} numberOfLines={1}>{name}</Text>
      {code ? <Text style={s.eyebrow}>{` · ${code}`}</Text> : null}
    </View>
  );
}

function Row({ s: x, eyebrow = null, title, meta, onPress }) {
  return (
    <Pressable style={({ pressed }) => [s.row, pressed && s.pressed]} onPress={onPress} accessibilityRole="link">
      {x.thumbnail || x.poster ? <SmartImage uri={x.thumbnail || x.poster} style={s.thumb} resizeMode="cover" /> : <View style={s.thumb} />}
      <View style={{ flex: 1, gap: 2 }}>
        {eyebrow}
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={s.rowMeta} numberOfLines={2}>{meta}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  flash: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: okTint(0.5), backgroundColor: okTint(0.1), gap: 6 },
  submit: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: oliveTint(0.4), backgroundColor: oliveTint(0.08), gap: 10 },
  pile: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: inkTint(0.12), backgroundColor: colors.surface1, gap: 8 },
  pileWarn: { borderColor: brassTint(0.45) },
  pileOk: { borderColor: okTint(0.4) },
  pileDashed: { borderStyle: 'dashed' },
  pileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  pressed: { opacity: 0.75 },
  thumb: { width: 56, height: 34, borderRadius: 4, backgroundColor: colors.surface2 },
  thumbGap: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.3), backgroundColor: 'transparent' },
  thumbGapText: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: colors.olive, textTransform: 'uppercase' },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  rowMeta: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkDim },
  readyRow: { gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  readyLink: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  readyBtn: { height: 40, alignSelf: 'flex-start' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10 },
  linkText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, color: colors.inkDim },

  // Your shows
  stripHead: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink },
  stripRow: { gap: 12, paddingRight: 8 },
  start: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.3) },
  startPlus: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center' },
  startK: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  showCard: { width: 128, gap: 6 },
  poster: { width: 128, height: 192, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface2 },
  posterImg: { width: '100%', height: '100%' },
  posterEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25), backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center', padding: 10 },
  posterName: { fontFamily: fonts.displaySemi, fontSize: 14, lineHeight: 18, color: colors.inkDim, textAlign: 'center' },
  posterNew: { borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.3), backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 6 },
  posterNewText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, color: colors.inkDim, textTransform: 'uppercase' },
  clock: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: inkTint(0.2) },
  showName: { fontFamily: fonts.displaySemi, fontSize: 13.5, lineHeight: 17, color: colors.ink },
  showChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  showCount: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 15, color: colors.inkDim },
  skel: { height: 10, borderRadius: 5, backgroundColor: inkTint(0.08), width: '90%' }
});
