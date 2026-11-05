import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { freshToken } from '../../lib/api';
import { currentUpload, startTusUpload } from '../../lib/tusUpload';
import { MAIN_GENRES } from '../../lib/submitRules';
import { fieldPolicy, fieldPolicyLine, joinDescription, saveSummary, splitDescription } from '../../lib/showRules';
import { useContentRatings } from '../../lib/contentAdvisory';
import { showPath } from '../../lib/showApi';
import { assetName } from '../../lib/showUploadQueue';
import { colors, fonts } from '../../lib/theme';
import { AccountFrame } from '../account/AccountBits';
import { pickImageAsDataUrl, pickVideo, useUploadProgress } from '../CreatorBits';
import { ClockIcon, WarningIcon } from '../WorkIcons';
import CreditsFields, { creditsFormBody, creditsFormKey, creditsToForm } from './CreditsFields';
import {
  ArtSlot, Banner, CancelButton, ChoiceChips, EdInput, EditorFoot, EditorHead, FieldHead, FieldNote, FootNote, NEEDS_118, NOT_SAVED_WORDS,
  SaveButton, StagedBox, SwitchRow, TabRow, UploadLine, isOpen, useFootSpace, useKeyboardShown, useLeaveGuard, useShowAuth
} from './EditorBits';
import { AboutField, OneLineField } from './EpisodeFields';
import { PaidLine } from './PayeeCard';
import { InfoIcon, LinkText, PREMIUM_WORD, RoomToast, SmallButton, UploadIcon, askUs, publicRoute, shortDate, showRoute, ss, useRoomToast } from './ShowBits';

// Edit show in the app (the series revamp, slice 5; the website's
// components/show/ShowEditor.js, amendment 13, boards ShowEditor and
// ShowEditorArt, the same words). Two tabs:
//   Details  the name (it waits for approval once an episode is approved),
//            one line + about (the show's one description), year, funding
//            link, the defaults for episodes added from now on (genre,
//            rating, Who can watch, Made by, ads), the season names, the
//            Studio / Producer credits, "Let channels air the whole show",
//            and the kind while the show is still empty;
//   Art      poster, still, hero image, title image and trailer, each Live,
//            Waiting for approval (Cancel) or None — a podcast has the
//            poster and the still only.
// Reads GET /api/show/<id> and saves with PATCH (lib/showRules.js
// fieldPolicy decides what applies at once and what waits, the same rule
// the route runs); a waiting change is taken back with DELETE …/staged.
// The app's habit: a picture is saved the moment it's picked and a trailer
// the moment its upload ends; the Details tab saves with the Save bar.
//
// Props: { showId, tab: 'details' | 'art' }.

const ABOUT_MAX = 2000;
const enc = (x) => encodeURIComponent(String(x));
const ART = [
  { field: 'poster', kind: 'poster', label: 'Poster 2:3', live: 'poster', words: 'On cards, rows and the show page.', width: 600, name: 'The poster' },
  { field: 'thumbnail', kind: 'still', label: 'Still 16:9', live: 'thumbnail', words: 'Behind the show in rows and on the episode strip.', width: 1280, name: 'The still' },
  { field: 'heroImage', kind: 'hero', label: 'Hero image', live: 'heroImage', words: 'The wide picture behind the name at the top of the show page.', notPodcast: true, width: 1600, name: 'The hero image' },
  { field: 'titleImage', kind: 'title', label: 'Title image · PNG', live: 'titleImageUrl', words: 'The name set as a picture, shown on the art.', notPodcast: true, width: 1200, png: true, name: 'The title image' }
];

function seasonsOfView(view) {
  const labels = {};
  for (const l of view.show.seasonLabels || []) labels[Number(l.number)] = l.name || '';
  const nums = [...new Set([...(view.seasons || []).map((s) => Number(s.number)), ...Object.keys(labels).map(Number)])].filter(Boolean).sort((a, b) => a - b);
  return nums.map((n) => ({ number: n, name: labels[n] || '' }));
}

function showForm(view) {
  const s = view.show;
  const d = splitDescription(s.description || '');
  const defs = s.defaults || {};
  return {
    name: s.name || '',
    oneLine: d.oneLine,
    about: d.about,
    releaseYear: s.year ? String(s.year) : '',
    fundingUrl: s.fundingUrl || '',
    channelOptIn: Boolean(s.channelOptIn),
    kind: s.kind === 'podcast' ? 'podcast' : 'series',
    mainGenre: defs.mainGenre || '',
    genre: defs.genre || '',
    rating: defs.rating || '',
    tier: defs.tier || '',
    artist: defs.artist || '',
    adsEnabled: defs.adsEnabled !== false,
    seasons: seasonsOfView(view),
    credits: creditsToForm(s.credits, { inherit: false })
  };
}

// What a change to the show does now: the same fieldPolicy the route runs.
function policyCtx(view) {
  const rows = (view.seasons || []).flatMap((s) => s.rows || []);
  const eps = rows.filter((r) => r.kind === 'episode');
  return {
    target: 'show',
    isAdmin: Boolean(view.viewer && view.viewer.teamEdits),
    isRunner: Boolean(view.viewer && view.viewer.isOwner),
    status: view.show.status || 'approved',
    held: Boolean(view.show.held),
    deletionRequested: Boolean(view.show.deletion && view.show.deletion.requested),
    approvedEpisodes: eps.filter((r) => r.status === 'approved').length,
    episodeCount: eps.filter((r) => r.inRunningOrder !== false).length + Number((view.counts && view.counts.drafts) || 0)
  };
}

const LEVEL_TONE = { ok: 'ok', review: 'review', warn: 'warn', neutral: 'neutral' };

export default function ShowEditor({ showId, tab = 'details' }) {
  const auth = useShowAuth();
  const { call, isLoaded, isSignedIn } = auth;
  const [state, setState] = useState({ phase: 'loading' });
  const load = useCallback(async () => {
    const r = await call('GET', showPath(showId));
    setState(r.ok ? { phase: 'ready', view: r.data } : { phase: 'error', status: r.status, error: r.error });
  }, [call, showId]);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    setState({ phase: 'loading' });
    load();
  }, [isLoaded, isSignedIn, load]);
  if (state.phase === 'ready') return <ShowEditorReady key={showId} initial={state.view} startTab={tab} auth={auth} />;
  const notThere = state.status === 404;
  return (
    <AccountFrame title={state.phase === 'loading' ? null : notThere ? 'Not here' : 'Couldn’t open it'} dashboard={auth.dashboard} back={{ href: showRoute(showId), label: 'The show' }}>
      {state.phase === 'loading' ? (
        <View style={{ gap: 12 }} accessibilityLabel="Loading the show">
          <View style={se.skeleton} /><View style={[se.skeleton, { height: 90 }]} />
        </View>
      ) : (
        <View style={ss.card} accessibilityRole="alert">
          <Text style={ss.p}>{state.error}</Text>
          {!notThere ? <SmallButton label="Try again" onPress={() => { setState({ phase: 'loading' }); load(); }} /> : null}
        </View>
      )}
    </AccountFrame>
  );
}

function ShowEditorReady({ initial, startTab, auth }) {
  const router = useRouter();
  const { call, getToken, dashboard } = auth;
  const upload = useUploadProgress();
  const ratings = useContentRatings() || [];
  const keyboard = useKeyboardShown();
  const { toast, say } = useRoomToast();
  const foot = useFootSpace();
  const [view, setView] = useState(initial);
  const show = view.show;
  const viewer = view.viewer || {};
  const ctx = useMemo(() => policyCtx(view), [view]);
  const pol = useCallback((field) => {
    const m = fieldPolicy(field, ctx);
    return { mode: m, line: m === 'direct' ? null : fieldPolicyLine(field, ctx) };
  }, [ctx]);
  const podcast = show.kind === 'podcast';
  // Edit show calls a series and a podcast alike "show" (the boards' words).
  const noun = 'show';
  const has118 = !view.migration || view.migration.shows118 !== false;
  const canEdit = Boolean(viewer.canEditShow);
  // Taking back a waiting change is the owner's (the team decides it on
  // the website's admin page, where Deny tells them).
  const canCancel = Boolean(viewer.isOwner);
  const path = showPath(show.id);

  const [form, setForm] = useState(() => showForm(initial));
  const [init, setInit] = useState(() => showForm(initial));
  const [trailerUp, setTrailerUp] = useState(null);
  const [tab, setTab] = useState(startTab === 'art' ? 'art' : 'details');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const set = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);
  const applyView = useCallback((v) => {
    setView(v);
    const f = showForm(v);
    setForm(f);
    setInit(f);
  }, []);
  const reload = useCallback(async () => {
    const r = await call('GET', path);
    if (r.ok) setView(r.data);
    return r;
  }, [call, path]);

  const computed = useMemo(() => {
    const body = {};
    const changes = [];
    const add = (field, key, value, policyField) => {
      body[key] = value;
      changes.push({ field, mode: pol(policyField || field).mode });
    };
    if (form.name.trim() !== init.name.trim()) add('name', 'name', form.name.trim());
    const desc = joinDescription(form.oneLine, form.about);
    if (desc !== joinDescription(init.oneLine, init.about)) add('description', 'description', desc);
    if (form.releaseYear.trim() !== init.releaseYear.trim()) add('releaseYear', 'releaseYear', form.releaseYear.trim() || null);
    if (form.fundingUrl.trim() !== init.fundingUrl.trim()) add('fundingUrl', 'fundingUrl', form.fundingUrl.trim());
    if (form.channelOptIn !== init.channelOptIn) add('channelOptIn', 'channelOptIn', form.channelOptIn);
    if (form.kind !== init.kind) add('kind', 'kind', form.kind);
    const defaults = {};
    for (const key of ['mainGenre', 'genre', 'rating', 'tier', 'artist']) if (String(form[key]).trim() !== String(init[key]).trim()) defaults[key] = String(form[key]).trim();
    if (form.adsEnabled !== init.adsEnabled) defaults.adsEnabled = form.adsEnabled;
    if (Object.keys(defaults).length) add('defaults', 'defaults', defaults);
    const seasons = form.seasons.map((s) => ({ number: s.number, name: s.name.trim() })).filter((s) => s.name);
    const seasonsBefore = init.seasons.map((s) => ({ number: s.number, name: s.name.trim() })).filter((s) => s.name);
    if (JSON.stringify(seasons) !== JSON.stringify(seasonsBefore)) add('seasons', 'seasons', seasons);
    if (creditsFormKey(form.credits) !== creditsFormKey(init.credits)) add('credits', 'credits', creditsFormBody(form.credits));
    return { body, changes };
  }, [form, init, pol]);
  const summary = saveSummary(computed.changes);
  const dirty = computed.changes.length > 0;
  useLeaveGuard(dirty);
  const edited = (field) => computed.changes.some((c) => c.field === field);

  async function save({ resubmit = false } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const body = { ...computed.body };
    if (resubmit) body.resubmit = true;
    const r = await call('PATCH', path, body);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      if (r.data && r.data.field) setTab(['poster', 'thumbnail', 'heroImage', 'titleImage', 'trailer'].includes(r.data.field) ? 'art' : 'details');
      return;
    }
    applyView(r.data.view);
    const lines = [...(r.data.notices || [])];
    for (const ns of r.data.notSaved || []) lines.push(`Not saved — ${NOT_SAVED_WORDS[ns.field] || ns.field}: ${ns.reason}`);
    const stagedN = (r.data.staged || []).length;
    say({
      tone: (r.data.notSaved || []).length ? 'warn' : 'ok',
      title: r.data.unchanged ? 'Nothing to save' : resubmit ? 'Sent again — it’s not public yet' : stagedN ? `Saved — ${stagedN === 1 ? '1 change waits' : `${stagedN} changes wait`} for approval` : 'Saved',
      lines
    }, 7000);
  }

  async function cancelStaged(field) {
    setBusy(`cancel-${field}`);
    setError(null);
    const r = await call('DELETE', `${path}/staged?field=${enc(field)}`);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    say({ tone: 'ok', title: 'Taken back', lines: ['What was live stays live.'] });
    await reload();
  }

  async function cancelRemoval() {
    setBusy('removal');
    const r = await call('POST', `${path}/removal`, { action: 'cancel' });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    say({ tone: 'ok', title: 'Removal cancelled' });
    const g = await reload();
    if (g.ok) applyView(g.data);
  }

  // --- the art: saved the moment it's picked ------------------------------------
  async function saveArt(a, body, words = a.name) {
    setBusy(`art-${a.field}`);
    setError(null);
    const r = await call('PATCH', path, body);
    setBusy(null);
    if (!r.ok) {
      say({ tone: 'warn', title: `${words} wasn’t saved`, lines: [r.error] }, 8000);
      return;
    }
    setView(r.data.view);
    const waits = (r.data.staged || []).length > 0;
    say({ tone: 'ok', title: waits ? `${words} waits for approval` : `${words} is saved`, lines: [waits ? 'Visitors see the live one until we approve it.' : null, ...(r.data.notices || [])].filter(Boolean) });
  }
  async function pickArt(a) {
    let img = null;
    try {
      img = await pickImageAsDataUrl({ width: a.width, format: a.png ? 'png' : 'jpeg' });
    } catch (err) {
      setError(err.message);
      return;
    }
    if (!img) return;
    saveArt(a, { [`${a.field}Base64`]: img.base64, [`${a.field}FileName`]: img.fileName });
  }
  function removeTitleImage(a) {
    Alert.alert('Remove the title image?', 'The name shows as text again.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => saveArt(a, { removeTitleImage: true }, 'Removing the title image') }
    ]);
  }

  // --- the trailer: attached the moment its upload ends ----------------------------
  const busyUpload = Boolean(upload && ['requesting-url', 'uploading'].includes(upload.status));
  const trailerUploading = Boolean(trailerUp && upload && upload.uid === trailerUp.uid && busyUpload);
  const pct = upload && upload.total ? Math.min(100, Math.round((upload.sent / upload.total) * 100)) : 0;
  async function attachTrailer(uid) {
    setTrailerUp((t) => (t && t.uid === uid ? { ...t, state: 'saving' } : t));
    const r = await call('PATCH', path, { trailerUid: uid });
    if (!r.ok) {
      setTrailerUp((t) => (t && t.uid === uid ? { ...t, state: 'failed', error: r.error } : t));
      return;
    }
    setTrailerUp(null);
    setView(r.data.view);
    const waits = (r.data.staged || []).includes('trailer');
    say({ tone: 'ok', title: waits ? 'The trailer waits for approval' : 'Trailer saved', lines: [waits ? 'The current one keeps playing until we approve it.' : 'It plays on the show page once it’s ready.', ...(r.data.notices || [])] });
  }
  async function pickTrailer() {
    setError(null);
    const cur = currentUpload();
    if (cur && ['requesting-url', 'uploading'].includes(cur.status)) {
      setError('Another upload is running — pick the trailer once it has finished.');
      return;
    }
    let asset = null;
    try {
      asset = await pickVideo();
    } catch (err) {
      setError(err.message);
      return;
    }
    if (!asset) return;
    try {
      const started = await startTusUpload({ asset, urlPath: `/api/creator/get-upload-url?seriesId=${enc(show.id)}`, token: await freshToken(getToken), kind: 'trailer' });
      setTrailerUp({ uid: started.uid, name: assetName(asset), state: 'uploading' });
      started.done
        .then(() => attachTrailer(started.uid))
        .catch(() => setTrailerUp((t) => (t && t.uid === started.uid ? { ...t, state: 'stopped' } : t)));
    } catch (err) {
      setError((err && err.message) || 'Could not start the trailer upload.');
    }
  }

  // --- banners -----------------------------------------------------------------
  const st = show.staged || {};
  const stagedList = [
    st.name ? { field: 'name', words: `the name “${st.name}”` } : null,
    st.description ? { field: 'description', words: 'an edited description' } : null,
    st.poster ? { field: 'poster', words: 'the poster' } : null,
    st.thumbnail ? { field: 'thumbnail', words: 'the still' } : null,
    st.heroImage ? { field: 'heroImage', words: 'the hero image' } : null,
    st.titleImageUrl || st.titleImageRemoval ? { field: 'titleImage', words: st.titleImageRemoval ? 'removing the title image' : 'the title image' } : null,
    st.trailer ? { field: 'trailer', words: 'the trailer' } : null
  ].filter(Boolean);
  const declined = show.status === 'rejected' && !show.held;
  const banners = (
    <>
      {!canEdit ? <Banner level="neutral" icon={<InfoIcon size={16} />} title={`Only ${show.ownerName || 'the show’s owner'} can change the ${noun}.`} /> : null}
      {show.held ? (
        <Banner level="danger" icon={<WarningIcon size={16} color={colors.danger} />} title={`Pulled by an admin${show.holdReason ? `: ${show.holdReason}` : ''}`}>
          <Text style={ss.small}>Nothing about the {noun} can change while an admin looks at it. <LinkText onPress={() => askUs(`Pulled: ${show.name}`)}>Email us</LinkText></Text>
        </Banner>
      ) : null}
      {show.deletion && show.deletion.requested ? (
        <Banner
          level="neutral"
          title={`Removal requested${show.deletion.at ? ` on ${shortDate(show.deletion.at)}` : ''}`}
          action={viewer.isOwner || viewer.isAdmin ? <CancelButton busy={busy === 'removal'} onPress={cancelRemoval} /> : null}
        >
          {show.deletion.reason ? <Text style={ss.p}>{show.deletion.reason}</Text> : null}
          <Text style={ss.small}>The {noun} is off the site while it waits; nothing can change until the request is cancelled.</Text>
        </Banner>
      ) : null}
      {declined ? (
        <Banner
          level="warn"
          icon={<WarningIcon size={16} color={colors.brass} />}
          title={`An admin declined this ${noun}`}
          action={canEdit ? <SmallButton label={saving ? 'Sending…' : 'Resubmit'} busy={saving} onPress={() => save({ resubmit: true })} /> : null}
        >
          {show.decisionNote ? <Text style={ss.p}>{show.decisionNote}</Text> : null}
          <Text style={ss.small}>Fix what it needs and press Resubmit; it comes back as not public yet.</Text>
        </Banner>
      ) : null}
      {stagedList.length > 0 ? (
        <Banner level="review" icon={<ClockIcon size={16} color={colors.olive} />} title="Changes awaiting review:">
          {stagedList.map((s) => (
            <View key={s.field} style={se.bannerItem}>
              <Text style={[ss.p, { flex: 1 }]}>{s.words}</Text>
              {canCancel ? <CancelButton busy={busy === `cancel-${s.field}`} onPress={() => cancelStaged(s.field)} /> : null}
            </View>
          ))}
        </Banner>
      ) : null}
      {!has118 ? <Banner level="neutral" title="The defaults, the season names, the credits and the kind wait for a database update (migration 118)." /> : null}
    </>
  );

  // --- Details ------------------------------------------------------------------
  const namePolicy = canEdit ? pol('name') : { mode: 'locked', line: 'Only the show’s owner can change this' };
  const lockAll = (field) => (canEdit ? pol(field) : namePolicy);
  const aboutMax = ABOUT_MAX - (form.oneLine.trim() ? form.oneLine.trim().length + 2 : 0);
  const defaultsPolicy = has118 ? lockAll('defaults') : NEEDS_118;
  const seasonsPolicy = has118 ? lockAll('seasons') : NEEDS_118;
  const creditsPolicy = has118 ? lockAll('credits') : NEEDS_118;
  const kindPolicy = has118 ? lockAll('kind') : NEEDS_118;
  const makerLine = (show.creditLines || []).find((l) => l.key === 'maker');
  const ratingOptions = [{ value: '', label: 'Not set' }, ...ratings.map((r) => ({ value: r.code, label: r.code }))];
  if (form.rating && !ratingOptions.some((o) => o.value === form.rating)) ratingOptions.push({ value: form.rating, label: form.rating });
  const named = form.seasons.find((s) => s.name.trim());

  const details = (
    <>
      {/* Slice 3b: who runs it and who it pays; the choice itself lives on
          the show page's "Who gets paid" card. */}
      {view.payee && view.payee.line ? (
        <View style={ss.card}>
          <Text style={ss.cardK}>Who gets paid</Text>
          <PaidLine payee={view.payee} />
          <LinkText onPress={() => router.dismissTo(showRoute(show.id))}>Change it on the show page</LinkText>
        </View>
      ) : null}
      <View style={ss.card}>
        <View style={{ gap: 6 }}>
          <FieldHead label="Name" staged={namePolicy.mode === 'staged'} locked={namePolicy.mode === 'locked'} count={form.name.length} max={form.name.length > 90 ? 120 : null} />
          <EdInput style={se.name} value={form.name} maxLength={120} disabled={!isOpen(namePolicy)} onChangeText={(t) => set('name', t)} accessibilityLabel="Name" />
          {namePolicy.mode === 'staged' ? <Text style={ss.small}>Changing a live {noun}’s name goes to us first.</Text> : null}
          {st.name ? <StagedBox title="Waiting for approval:" value={st.name} onCancel={canCancel ? () => cancelStaged('name') : null} busy={busy === 'cancel-name'} /> : null}
          <FieldNote policy={namePolicy.mode === 'staged' ? null : namePolicy} edited={edited('name') && namePolicy.mode !== 'staged'} />
        </View>
        <OneLineField value={form.oneLine} onChange={(v) => set('oneLine', v)} policy={lockAll('description')} edited={edited('description')} />
        <AboutField value={form.about} onChange={(v) => set('about', v)} max={aboutMax} policy={lockAll('description')} edited={edited('description')} placeholder={`Everything else about the ${noun}.`} />
        <View style={se.grid2}>
          <View style={{ flex: 1, gap: 6, minWidth: 110 }}>
            <FieldHead label="Year" />
            <EdInput value={form.releaseYear} keyboardType="number-pad" maxLength={4} placeholder={String(new Date().getFullYear())} disabled={!isOpen(lockAll('releaseYear'))} onChangeText={(t) => set('releaseYear', t.replace(/[^0-9]/g, ''))} accessibilityLabel="Year" />
          </View>
          <View style={{ flex: 2, gap: 6, minWidth: 180 }}>
            <FieldHead label="Funding link" hint="optional" />
            <EdInput value={form.fundingUrl} keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={500} placeholder="https://" disabled={!isOpen(lockAll('fundingUrl'))} onChangeText={(t) => set('fundingUrl', t)} accessibilityLabel="Funding link" />
          </View>
        </View>
        {kindPolicy.mode === 'direct' || form.kind !== init.kind ? (
          <View style={{ gap: 6 }}>
            <FieldHead label="What it is" />
            <ChoiceChips options={[{ value: 'series', label: 'Series' }, { value: 'podcast', label: 'Podcast' }]} value={form.kind} disabled={!isOpen(kindPolicy)} onChange={(k) => set('kind', k)} />
            <Text style={ss.small}>Set once it has episodes.</Text>
          </View>
        ) : null}
      </View>

      <View style={ss.card}>
        <Text style={ss.p}><Text style={ss.strong}>Defaults</Text> · applies to episodes added from now on</Text>
        <View style={{ gap: 6 }}>
          <FieldHead label="Genre" />
          <ChoiceChips options={MAIN_GENRES.map((g) => ({ value: g, label: g }))} value={form.mainGenre} disabled={!isOpen(defaultsPolicy)} onChange={(g) => set('mainGenre', form.mainGenre === g ? '' : g)} />
        </View>
        <View style={{ gap: 6 }}>
          <FieldHead label="Specific genre" hint="optional" />
          <EdInput value={form.genre} maxLength={60} placeholder="e.g. Cosmic Horror" disabled={!isOpen(defaultsPolicy)} onChangeText={(t) => set('genre', t)} accessibilityLabel="Specific genre" />
        </View>
        <View style={{ gap: 6 }}>
          <FieldHead label="Rating" hint="not set = treated as 17+" />
          <ChoiceChips options={ratingOptions} value={form.rating} disabled={!isOpen(defaultsPolicy)} onChange={(v) => set('rating', v)} />
        </View>
        <View style={{ gap: 6 }}>
          <FieldHead label="Who can watch" />
          <ChoiceChips options={[{ value: 'free', label: 'Free with ads' }, { value: 'premium', label: PREMIUM_WORD }]} value={form.tier} disabled={!isOpen(defaultsPolicy)} onChange={(v) => set('tier', v)} />
        </View>
        <View style={{ gap: 6 }}>
          <FieldHead label={podcast ? 'Hosted by' : 'Made by'} />
          <EdInput value={form.artist} maxLength={120} placeholder={show.ownerName || 'Your name, as credited'} disabled={!isOpen(defaultsPolicy)} onChangeText={(t) => set('artist', t)} accessibilityLabel={podcast ? 'Hosted by' : 'Made by'} />
        </View>
        <SwitchRow title="Ads between scenes" on={form.adsEnabled} onChange={(v) => set('adsEnabled', v)} disabled={!isOpen(defaultsPolicy)} />
        <View style={ss.row}><InfoIcon size={13} /><Text style={[ss.small, { flex: 1 }]}>Episodes already added keep their own rating and who can watch.</Text></View>
        <FieldNote policy={defaultsPolicy} edited={edited('defaults')} />
      </View>

      {form.seasons.length > 0 ? (
        <View style={ss.card}>
          <Text style={ss.cardK}>Season names</Text>
          {form.seasons.map((s, i) => (
            <View key={s.number} style={se.seasonRow}>
              <Text style={se.seasonLabel}>Season {s.number}</Text>
              <EdInput style={{ flex: 1 }} value={s.name} maxLength={80} placeholder="Optional name" disabled={!isOpen(seasonsPolicy)} onChangeText={(t) => setForm((f) => ({ ...f, seasons: f.seasons.map((x, j) => (j === i ? { ...x, name: t } : x)) }))} accessibilityLabel={`Season ${s.number} name`} />
            </View>
          ))}
          <Text style={ss.small}>{named ? `The show page reads “Season ${named.number} · ${named.name.trim()}”.` : 'A name shows beside the number: “Season 2 · The Return”.'}</Text>
          <FieldNote policy={seasonsPolicy} edited={edited('seasons')} />
        </View>
      ) : null}

      <View style={ss.card}>
        <Text style={ss.cardK}>Credits</Text>
        <CreditsFields value={form.credits} onChange={(v) => set('credits', v)} makerName={form.artist.trim() || (makerLine ? makerLine.name : null) || show.ownerName || null} makerLabel={podcast ? 'Hosted by' : 'Made by'} policy={creditsPolicy} />
      </View>

      <View style={ss.card}>
        <SwitchRow title={`Let channels air the whole ${noun}`} on={form.channelOptIn} onChange={(v) => set('channelOptIn', v)} disabled={!isOpen(lockAll('channelOptIn'))} policy={lockAll('channelOptIn').mode === 'locked' ? lockAll('channelOptIn') : null}>
          TapaTV can schedule every episode live, with ads.
        </SwitchRow>
      </View>
    </>
  );

  // --- Art ---------------------------------------------------------------------
  const anyArtStaged = Boolean(st.poster || st.thumbnail || st.heroImage || st.titleImageUrl || st.titleImageRemoval || st.trailer);
  const artPolicyStaged = canEdit && pol('poster').mode === 'staged';
  const art = show.art || {};
  const trailerPolicy = canEdit ? pol('trailer') : namePolicy;
  const artTab = (
    <>
      {artPolicyStaged ? (
        <View style={se.legend}><ClockIcon size={13} color={colors.olive} /><Text style={[ss.small, { flex: 1 }]}>New art on a live {noun} goes to us first; the current art stays until we approve it.</Text></View>
      ) : null}
      <View style={ss.card}>
        {ART.filter((a) => !(podcast && a.notPodcast)).map((a) => {
          const p = canEdit ? pol(a.field) : namePolicy;
          const live = art[a.live] || null;
          const staged = a.field === 'titleImage' ? st.titleImageUrl || null : st[a.field] || null;
          const waitingRemoval = a.field === 'titleImage' && st.titleImageRemoval;
          const status = staged || waitingRemoval ? 'waiting' : live ? 'live' : 'none';
          return (
            <ArtSlot
              key={a.field}
              kind={a.kind}
              label={a.label}
              status={status}
              policy={p}
              live={live}
              staged={staged}
              stagedNote={`Visitors see the live ${a.label.split(' ')[0].toLowerCase()} until we approve this one.`}
              onCancelStaged={canCancel ? () => cancelStaged(a.field) : null}
              cancelBusy={busy === `cancel-${a.field}`}
              emptyTitle={waitingRemoval ? 'Removal waits for approval' : a.field === 'heroImage' ? 'No hero image yet' : 'None'}
              emptyText={a.words}
              caption={live ? a.words : null}
              busy={busy === `art-${a.field}`}
              actions={isOpen(p) ? (
                <>
                  <SmallButton label={live || staged ? 'Replace' : 'Upload'} disabled={Boolean(busy)} onPress={() => pickArt(a)} />
                  {a.field === 'titleImage' && live && !waitingRemoval ? <SmallButton label="Remove" disabled={Boolean(busy)} onPress={() => removeTitleImage(a)} /> : null}
                </>
              ) : null}
            />
          );
        })}
        <Text style={ss.small}>A picture is saved the moment you pick it.</Text>
      </View>
      {!podcast ? (
        <View style={ss.card}>
          <View style={se.headRow}>
            <View style={ss.row}>
              {pol('trailer').mode === 'staged' ? <ClockIcon size={12} color={colors.olive} /> : null}
              <Text style={ss.cardK}>Trailer</Text>
            </View>
            <Text style={[ss.mono, { color: st.trailer ? colors.olive : art.trailer ? colors.ok : colors.inkDim }]}>{trailerUp ? (trailerUp.state === 'stopped' ? 'STOPPED' : trailerUp.state === 'failed' ? 'NOT SAVED' : 'UPLOADING') : st.trailer ? 'WAITING FOR APPROVAL' : art.trailer ? 'LIVE' : 'NONE'}</Text>
          </View>
          {trailerUp ? (
            <UploadLine
              name={trailerUp.name}
              right={trailerUploading ? `${pct}%` : trailerUp.state === 'saving' ? 'saving…' : trailerUp.state}
              pct={trailerUploading ? pct : trailerUp.state === 'saving' ? 100 : 0}
              failed={trailerUp.state === 'failed'}
              meta={trailerUp.state === 'failed' ? trailerUp.error : trailerUp.state === 'stopped' ? 'The upload stopped — pick it again.' : 'It’s attached once it’s up. Keep the app open until then.'}
            >
              {trailerUp.state === 'failed' ? <LinkText onPress={() => attachTrailer(trailerUp.uid)}>Try again</LinkText> : null}
              {['stopped', 'failed'].includes(trailerUp.state) ? <LinkText onPress={() => setTrailerUp(null)}>Not this one</LinkText> : null}
            </UploadLine>
          ) : st.trailer ? (
            <StagedBox title="A new trailer waits for approval" onCancel={canCancel ? () => cancelStaged('trailer') : null} busy={busy === 'cancel-trailer'}>
              <Text style={ss.small}>The {art.trailer ? 'current one keeps playing' : 'show page shows its art'} until then.</Text>
            </StagedBox>
          ) : (
            <Text style={ss.small}>{art.trailer ? 'It plays behind the name at the top of the show page.' : 'A short clip, 15–30 seconds, behind the name at the top of the show page.'}</Text>
          )}
          {isOpen(trailerPolicy) && (!trailerUp || ['stopped', 'failed'].includes(trailerUp.state)) ? (
            <SmallButton label={art.trailer || st.trailer ? 'Replace the trailer' : 'Add a trailer'} icon={<UploadIcon size={15} color={colors.ink} />} disabled={busyUpload} onPress={pickTrailer} />
          ) : null}
          <FieldNote policy={canEdit ? (pol('trailer').mode === 'staged' ? null : pol('trailer')) : namePolicy} />
        </View>
      ) : null}
    </>
  );

  const canSave = canEdit && computed.changes.length > 0 && !saving;
  const pill = { text: show.statusLabel || (show.isPublic ? 'Live' : 'Not public yet'), tone: LEVEL_TONE[show.level] || (show.isPublic ? 'ok' : 'neutral') };

  return (
    <AccountFrame
      title={null}
      dashboard={dashboard}
      back={{ href: showRoute(show.id), label: show.name || 'The show' }}
      overlay={(
        <>
          {!keyboard ? (
            <EditorFoot onHeight={foot.setFootH}>
              {summary.note ? <FootNote>{summary.note}</FootNote> : null}
              {error ? <Text style={ss.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
              <SaveButton label={summary.label} busy={saving} disabled={!canSave} onPress={() => save()} />
              <View style={se.footMeta}>
                <Text style={[ss.mono, { flex: 1 }]} numberOfLines={2}>{show.isPublic ? 'Changes reach visitors within a few minutes' : 'It isn’t public yet — only you and the team see it'}</Text>
                {show.isPublic ? <LinkText onPress={() => router.push(publicRoute(show))}>View page</LinkText> : null}
              </View>
            </EditorFoot>
          ) : null}
          <RoomToast toast={toast} onClose={() => say(null)} bottom={keyboard ? null : foot.toastBottom} />
        </>
      )}
    >
      <View style={se.body}>
        <EditorHead eyebrow={`Edit ${noun}`} pill={pill} title={show.name || 'Untitled'} />
        {banners}
        <TabRow
          tabs={[
            { key: 'details', label: 'Details' },
            { key: 'art', label: 'Art', glyph: anyArtStaged ? <ClockIcon size={12} color={colors.olive} /> : null, glyphLabel: anyArtStaged ? 'something waits for approval' : null }
          ]}
          active={tab}
          onTab={setTab}
        />
        {tab === 'art' ? artTab : details}
        <View style={{ height: foot.spacer }} />
      </View>
    </AccountFrame>
  );
}

const se = StyleSheet.create({
  body: { gap: 14 },
  skeleton: { height: 160, borderRadius: 12, backgroundColor: colors.surface1 },
  bannerItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: fonts.bodyBold, fontSize: 18, minHeight: 48 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seasonLabel: { width: 74, fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  legend: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  footMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 }
});
