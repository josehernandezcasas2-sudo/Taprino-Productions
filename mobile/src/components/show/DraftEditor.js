import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { fileMatches, joinDescription, saveSummary, splitDescription } from '../../lib/showRules';
import { changedFields } from '../../lib/draftPatch';
import { bytesLabel, runtimeClock } from '../../lib/submitRules';
import { migrationRefusal, showPath } from '../../lib/showApi';
import { assetFile, assetRuntime, cancelShowUpload, enqueueShowUploads, useShowQueue } from '../../lib/showUploadQueue';
import { colors } from '../../lib/theme';
import { AccountFrame } from '../account/AccountBits';
import { pickVideo } from '../CreatorBits';
import { ClockIcon, TrashIcon, WarningIcon } from '../WorkIcons';
import MoveSheet from './MoveSheet';
import {
  Banner, DIRECT, EdInput, EditorFoot, EditorHead, FieldHead, FieldNote, FootNote, SaveButton, SectionHead, StatusLine, UploadLine,
  masterWords, useFootSpace, useInFront, useKeyboardShown, useLeaveGuard
} from './EditorBits';
import { AboutField, MoreOptions, OneLineField, PlaceBlock, SameAsShow, TitleField } from './EpisodeFields';
import { RoomToast, SmallButton, UploadIcon, episodeEditorRoute, shortDate, showRoute, ss, useRoomToast } from './ShowBits';
import ExtraKindField from '../ExtraKindField';
import FlashingLightsField from '../FlashingLightsField';
import { extraKindChoice } from '../../lib/extraKinds';

// The editor for a draft in the app (the series revamp, slice 5; the
// website's components/show/DraftEditor.js, the same words): an episode
// that isn't sent yet, a creator_drafts row whose form holds the show,
// season and number. The same screen as the episode editor, everything
// applies at once (nothing is live), saved with PATCH /api/creator/drafts —
// only the fields the person changed (lib/draftPatch.js), so the upload
// queue, which puts the file on the same draft meanwhile, and this screen
// never put back each other's older copy — and "Send for review" posts it
// to /api/show/<id>/send. The draft's file goes
// through the show page's upload queue (mobile/src/lib/showUploadQueue.js:
// one upload at a time, saved onto the draft as it goes; the same file
// picked again resumes). The poster and still, captions, a trailer, its
// own page and the credits come after it is sent.

const DESC_MAX = 4000;
const POLL_MS = 15000;
const POLL_MAX = 40;
const enc = (x) => encodeURIComponent(String(x));

function draftFormOf(d) {
  const f = (d && d.form) || {};
  const desc = splitDescription(f.description || '');
  return {
    title: f.title || '',
    oneLine: desc.oneLine,
    about: desc.about,
    mainGenre: f.mainGenre || '',
    genre: f.genre || '',
    artist: f.artist || '',
    releaseYear: f.releaseYear ? String(f.releaseYear) : '',
    rating: f.rating || '',
    tier: f.tier === 'premium' ? 'premium' : 'free',
    runtime: f.runtime || (d && d.video && d.video.runtimeSeconds ? runtimeClock(d.video.runtimeSeconds) || '' : ''),
    fundingUrl: f.fundingUrl || '',
    adsEnabled: f.adsEnabled !== false,
    adBreaksText: f.adBreaksText || '0:00',
    channelOptIn: f.channelOptIn === true,
    featured: f.featured === true,
    isOriginal: f.isOriginal === true,
    hasFlashingLights: f.hasFlashingLights === true,
    season: Number(f.season) || 1,
    number: f.seriesOrder ? String(f.seriesOrder) : '',
    // An extra's kind (migration 121), kept in the draft as the field holds
    // it (the submit screen's keys); a draft with only `extraKind` opens on that.
    extraKindChoice: typeof f.extraKindChoice === 'string' ? f.extraKindChoice : extraKindChoice(f.extraKind).choice,
    extraKindOther: typeof f.extraKindOther === 'string' ? f.extraKindOther : extraKindChoice(f.extraKind).other
  };
}

// The form as the draft stores it (the three-step submit's shape).
function draftValues(form) {
  return {
    title: form.title.trim(),
    description: joinDescription(form.oneLine, form.about),
    mainGenre: form.mainGenre,
    genre: form.genre.trim(),
    artist: form.artist.trim(),
    releaseYear: form.releaseYear.trim(),
    rating: form.rating,
    tier: form.tier,
    runtime: form.runtime.trim(),
    fundingUrl: form.fundingUrl.trim(),
    adsEnabled: form.adsEnabled,
    adBreaksText: form.adBreaksText,
    channelOptIn: form.channelOptIn,
    featured: form.featured,
    isOriginal: form.isOriginal,
    hasFlashingLights: form.hasFlashingLights === true,
    season: String(Number(form.season) || 1),
    seriesOrder: String(form.number || '').trim(),
    extraKindChoice: form.extraKindChoice || '',
    extraKindOther: form.extraKindOther || ''
  };
}

// What a save sends: the fields changed since the draft was read (the
// season and the number go together, as one place).
function formChange(init, form) {
  const was = draftValues(init);
  const now = draftValues(form);
  const change = changedFields(was, now);
  if ('season' in change || 'seriesOrder' in change) {
    change.season = now.season;
    change.seriesOrder = now.seriesOrder;
  }
  // The kind's chip and its words go together, as one field.
  if ('extraKindChoice' in change || 'extraKindOther' in change) {
    change.extraKindChoice = now.extraKindChoice;
    change.extraKindOther = now.extraKindOther;
  }
  return change;
}

const FIELD_OF = { title: 'title', description: 'description', mainGenre: 'mainGenre', genre: 'genre', artist: 'artist', releaseYear: 'releaseYear', rating: 'rating', tier: 'tier', runtime: 'runtime', fundingUrl: 'fundingUrl', adsEnabled: 'adsEnabled', adBreaksText: 'adBreakSeconds', channelOptIn: 'channelOptIn', featured: 'featured', isOriginal: 'isOriginal', hasFlashingLights: 'hasFlashingLights', season: 'place', seriesOrder: 'place', extraKindChoice: 'extraKind', extraKindOther: 'extraKind' };

function findRow(view, id) {
  for (const s of (view && view.seasons) || []) for (const r of s.rows || []) if (r.kind === 'draft' && r.id === id) return r;
  return null;
}

export default function DraftEditor({ showId, initialDraft, auth }) {
  const router = useRouter();
  const { call, getToken, dashboard } = auth;
  const inFront = useInFront();
  const keyboard = useKeyboardShown();
  const { toast, say } = useRoomToast();
  const foot = useFootSpace();

  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  draftRef.current = draft;
  const theShowId = draft && draft.form && draft.form.seriesId ? String(draft.form.seriesId) : showId;
  const q = useShowQueue(theShowId);
  const [view, setView] = useState(null);
  const [viewError, setViewError] = useState(null);
  const [form, setForm] = useState(() => draftFormOf(initialDraft));
  const [init, setInit] = useState(() => draftFormOf(initialDraft));
  const [resets, setResets] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [myShows, setMyShows] = useState(null);
  const [seasonPos, setSeasonPos] = useState({});
  // Drafts need migration 116: a 503 from a drafts route is the server's
  // own line, and Send / Save grey with it.
  const [behind116, setBehind116] = useState(null);
  const noteBehind = (r) => {
    const m = migrationRefusal(r);
    if (m && m.code === 'migration-116') setBehind116(m.line);
    else if (r && r.status === 503 && /migration 116/.test(r.error || '')) setBehind116(r.error);
  };

  const loadView = useCallback(async () => {
    const r = await call('GET', showPath(theShowId));
    if (r.ok) {
      setView(r.data);
      setViewError(null);
    } else setViewError(r.error);
    return r;
  }, [call, theShowId]);
  useEffect(() => { loadView(); }, [loadView]);

  const show = view ? view.show : null;
  const row = view ? findRow(view, draft.id) : null;
  const defaults = (show && show.defaults) || {};
  const kind = show ? show.kind : 'series';

  const set = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResets((r) => {
      if (!r.has(key)) return r;
      const next = new Set(r);
      next.delete(key);
      return next;
    });
  }, []);
  const reset = useCallback((key) => {
    const value = key === 'genre' || key === 'artist' || key === 'releaseYear' ? '' : key === 'tier' ? (defaults.tier === 'premium' ? 'premium' : 'free') : defaults[key] || '';
    setForm((f) => ({ ...f, [key]: value }));
    setResets((r) => new Set(r).add(key));
  }, [defaults]);
  const pol = useCallback(() => DIRECT, []);

  const changes = useMemo(() => {
    const a = draftValues(form);
    const b = draftValues(init);
    const out = [];
    const seen = new Set();
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      const field = FIELD_OF[k] || k;
      if (seen.has(field)) continue;
      seen.add(field);
      out.push({ field, mode: 'direct' });
    }
    return out;
  }, [form, init]);
  const dirty = changes.length > 0;
  const leave = useLeaveGuard(dirty);
  const summary = saveSummary(changes);
  const edited = (field) => changes.some((c) => c.field === field);

  // --- the place ------------------------------------------------------------------
  const curSeason = Number(form.season) || 1;
  const pos = seasonPos[curSeason] && seasonPos[curSeason].state === 'ready' ? seasonPos[curSeason].data : null;
  useEffect(() => {
    if (seasonPos[curSeason]) return;
    setSeasonPos((p) => ({ ...p, [curSeason]: { state: 'loading' } }));
    call('GET', `${showPath(theShowId)}/positions?season=${curSeason}&exclude=${enc(draft.id)}`).then((r) => {
      setSeasonPos((p) => ({ ...p, [curSeason]: r.ok ? { state: 'ready', data: r.data } : { state: 'error', error: r.error } }));
      if (r.ok) setForm((f) => (Number(f.season) === curSeason && !String(f.number).trim() ? { ...f, number: String(r.data.nextFree || 1) } : f));
    });
  }, [seasonPos, curSeason, theShowId, draft.id, call]);
  const numberN = Number(form.number) || null;
  const holderRaw = pos && numberN && pos.taken ? pos.taken[numberN] : null;
  const holder = holderRaw && holderRaw.id !== draft.id ? holderRaw : null;
  const placeChanged = Number(form.season) !== Number(init.season) || String(form.number) !== String(init.number);
  const placeBlocked = Boolean(holder && holder.kind === 'episode');
  const seasons = useMemo(() => (view && view.seasons ? view.seasons : []).map((s) => ({ number: s.number, label: s.label })), [view]);

  function pickSeason(n) {
    if (n === Number(init.season)) setForm((f) => ({ ...f, season: n, number: init.number }));
    else setForm((f) => ({ ...f, season: n, number: seasonPos[n] && seasonPos[n].data ? String(seasonPos[n].data.nextFree || 1) : '' }));
  }

  const reloadDraft = useCallback(async ({ resetForm = false, place = false } = {}) => {
    const r = await call('GET', `/api/creator/drafts?id=${enc(draftRef.current.id)}`);
    if (!r.ok || !r.data.draft) return r;
    const d = r.data.draft;
    setDraft(d);
    const f = draftFormOf(d);
    if (resetForm) {
      setForm(f);
      setInit(f);
      setResets(new Set());
    } else if (place) {
      setInit((i) => ({ ...i, season: f.season, number: f.number }));
      setForm((x) => ({ ...x, season: f.season, number: f.number }));
      setSeasonPos({});
    } else {
      // The runtime the file reported, where nobody typed one.
      setInit((i) => (i.runtime.trim() ? i : { ...i, runtime: f.runtime }));
      setForm((x) => (x.runtime.trim() ? x : { ...x, runtime: f.runtime }));
    }
    return r;
  }, [call]);

  async function placeVia(how) {
    setBusy('place');
    setError(null);
    const r = await call('POST', `${showPath(theShowId)}/move`, { draftId: draft.id, toSeason: curSeason, toNumber: numberN, mode: how });
    if (!r.ok) {
      setBusy(null);
      noteBehind(r);
      setError(r.error);
      return;
    }
    await reloadDraft({ place: true });
    setBusy(null);
    say({ tone: 'ok', title: 'Moved', lines: [r.data.words].filter(Boolean) });
    loadView();
  }

  // --- the file: the show's upload queue carries it ----------------------------------
  const video = draft.video;
  const upload = q.uploads[draft.id] || null;
  const queueLive = Boolean(upload && ['queued', 'starting', 'uploading'].includes(upload.status));
  const masterState = row && row.master ? row.master : video ? video.state || 'processing' : draft.form && draft.form.audioUrl ? 'audio' : 'none';
  const watching = Boolean(video && ['uploading', 'processing'].includes(video.state) && !queueLive);
  useEffect(() => {
    if (!watching) return undefined;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n > POLL_MAX) {
        clearInterval(t);
        return;
      }
      if (!inFront()) return;
      const r = await reloadDraft({});
      if (r && r.ok && r.data.draft && r.data.draft.video && r.data.draft.video.state === 'ready') loadView();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [watching, draft.id, inFront, reloadDraft, loadView]);

  // The queue finished (or stopped) this draft's file: read it back.
  const upStatus = upload ? upload.status : null;
  useEffect(() => {
    if (upStatus === 'uploaded' || upStatus === 'stopped') {
      reloadDraft({});
      loadView();
    }
  }, [upStatus, reloadDraft, loadView]);

  async function pickFile() {
    setError(null);
    let asset = null;
    try {
      asset = await pickVideo();
    } catch (err) {
      setError(err.message);
      return;
    }
    if (!asset) return;
    const resume = fileMatches(assetFile(asset), { video, file: row ? row.file : null }) && Boolean(video && video.state === 'uploading');
    if (queueLive) cancelShowUpload(draft.id);
    const label = `${init.number ? `S${init.season} E${init.number}` : 'Draft'} · ${form.title.trim() || (init.number ? `Episode ${init.number}` : 'Untitled draft')}`;
    enqueueShowUploads([{ draftId: draft.id, asset, showId: theShowId, showName: show ? show.name : null, label, runtimeSeconds: assetRuntime(asset) || (video && video.runtimeSeconds) || null, freshStart: !resume }], getToken);
    const secs = assetRuntime(asset);
    if (secs && !form.runtime.trim()) set('runtime', runtimeClock(secs) || '');
    say({ tone: 'ok', title: resume ? 'Resuming the upload' : 'Uploading the file', lines: ['It keeps going while you move around the app. Keep the app open until it’s up.'] }, 5000);
  }

  // --- save, send, discard ---------------------------------------------------------------
  async function save({ quiet = false } = {}) {
    if (saving) return false;
    if (placeBlocked) {
      setError(`E${numberN} is held by an episode — pick another number.`);
      return false;
    }
    setSaving(true);
    setError(null);
    // Only what the person changed: the upload queue may be putting a file
    // on this draft meanwhile, and the server merges both.
    const r = await call('PATCH', '/api/creator/drafts', { id: draftRef.current.id, form: formChange(init, form) });
    setSaving(false);
    if (!r.ok) {
      noteBehind(r);
      setError(r.error);
      return false;
    }
    setDraft(r.data.draft);
    const f = draftFormOf(r.data.draft);
    setForm(f);
    setInit(f);
    setResets(new Set());
    if (placeChanged) setSeasonPos({});
    if (!quiet) say({ tone: 'ok', title: 'Saved', lines: ['A draft is only yours until you send it.'] });
    loadView();
    return true;
  }

  async function send() {
    if (dirty && !(await save({ quiet: true }))) return;
    setBusy('send');
    setError(null);
    const r = await call('POST', `${showPath(theShowId)}/send`, { draftIds: [draft.id] });
    setBusy(null);
    if (!r.ok) {
      noteBehind(r);
      setError(r.error);
      return;
    }
    const created = (r.data.created || [])[0];
    const skipped = (r.data.skipped || [])[0];
    if (created) {
      leave(() => router.replace(`${episodeEditorRoute(theShowId, created.id)}?sent=1`));
      return;
    }
    if (skipped) {
      setError(skipped.reason);
      if (skipped.nextFree) set('number', String(skipped.nextFree));
      loadView();
    }
  }

  function discard() {
    Alert.alert('Discard this draft?', 'Its uploaded file is deleted too.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => {
        cancelShowUpload(draft.id);
        setBusy('discard');
        const r = await call('DELETE', '/api/creator/drafts', { id: draft.id });
        setBusy(null);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        leave(() => router.dismissTo(showRoute(theShowId)));
      } }
    ]);
  }

  async function openMove() {
    setMoveOpen(true);
    if (myShows) return;
    const r = await call('GET', '/api/show');
    setMyShows(r.ok && Array.isArray(r.data.shows) ? r.data.shows : []);
  }

  // --- the screen ------------------------------------------------------------------------
  const code = numberN ? `S${curSeason} E${init.number || numberN}` : null;
  const title = form.title.trim() || (init.number ? `Episode ${init.number}` : 'Untitled draft');
  const blocker = row ? row.blocker : null;
  const uploadingNow = Boolean(upload && ['starting', 'uploading'].includes(upload.status));
  const mw = masterWords(uploadingNow ? 'uploading' : masterState);
  const fileRight = upload && upload.status === 'queued' ? 'queued' : uploadingNow ? `${upload.pct || 0}%${upload.eta ? ` · ${upload.eta}` : ''}` : masterState === 'ready' ? 'ready ✓' : masterState === 'uploading' ? 'stopped' : masterState === 'error' ? 'failed' : 'processing';
  const fileMeta = upload && upload.status === 'queued' ? `Waiting its turn${upload.after ? ` — after ${upload.after}` : ''}.`
    : uploadingNow ? 'Uploading — keep the app open until it’s up.'
      : upload && upload.status === 'stopped' ? (upload.error || 'The upload stopped — pick the same file again to resume.')
        : masterState === 'uploading' ? 'The upload stopped — pick the same file again to resume.'
          : masterState === 'ready' ? `Ready${video && video.runtimeSeconds ? ` · ${runtimeClock(video.runtimeSeconds)}` : ''}`
            : mw.text;
  const sendBlocked = Boolean(viewError) || !row || row.ready === false;
  const canSave = dirty && !saving && !placeBlocked && !behind116;
  const canSend = !saving && busy !== 'send' && !placeBlocked && !sendBlocked && !behind116;
  const aboutMax = DESC_MAX - (form.oneLine.trim() ? form.oneLine.trim().length + 2 : 0);

  return (
    <>
      <AccountFrame
        title={null}
        dashboard={dashboard}
        back={{ href: showRoute(theShowId, { draft: draft.id }), label: show ? show.name : 'The show' }}
        overlay={(
          <>
            {!keyboard ? (
              <EditorFoot onHeight={foot.setFootH}>
                {placeBlocked ? <FootNote tone="warn">E{numberN} is held by an episode — pick another number on Place.</FootNote> : null}
                {behind116 && behind116 !== error ? <FootNote tone="warn">{behind116}</FootNote> : null}
                {error ? <Text style={ss.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
                <SaveButton label="Send for review" busy={busy === 'send'} busyLabel="Sending…" disabled={!canSend} onPress={send} />
                <View style={ds.footMeta}>
                  <View style={{ flex: 1 }}><StatusLine tone="neutral">{`Draft${draft.updatedAt ? ` · saved ${shortDate(draft.updatedAt)}` : ''}${blocker ? '' : row && row.ready ? ' · ready to send' : ''}`}</StatusLine></View>
                  <SmallButton label={saving ? 'Saving…' : summary.count ? 'Save' : 'Saved'} busy={saving} disabled={!canSave} onPress={() => save()} />
                </View>
              </EditorFoot>
            ) : null}
            <RoomToast toast={toast} onClose={() => say(null)} bottom={keyboard ? null : foot.toastBottom} />
          </>
        )}
      >
        <View style={ds.body}>
          <EditorHead eyebrow={[show ? show.name : null, code].filter(Boolean).join(' · ')} pill={{ text: 'Draft', tone: 'neutral' }} title={title} />
          {viewError ? <Banner level="danger" icon={<WarningIcon size={16} color={colors.danger} />} title={viewError} /> : null}
          {blocker ? <Banner level="review" icon={<ClockIcon size={16} color={colors.olive} />} title="Not ready to send yet"><Text style={ss.p}>{blocker}</Text></Banner> : null}

          <SectionHead label="Basics" />
          <View style={ss.card}>
            <Text style={ss.cardK}>The file</Text>
            {video || upload ? (
              <UploadLine
                name={(video && video.name) || (upload && upload.name) || 'The master'}
                bytesLabel={bytesLabel((video && video.bytes) || (upload && upload.bytes))}
                right={fileRight}
                pct={uploadingNow ? upload.pct || 0 : masterState === 'uploading' || (upload && upload.status === 'queued') ? 0 : 100}
                failed={masterState === 'error'}
                meta={fileMeta}
              />
            ) : draft.form && draft.form.audioUrl ? (
              <Text style={ss.small}>An audio file from a link{draft.form.audioBytes ? ` · ${bytesLabel(draft.form.audioBytes)}` : ''}.</Text>
            ) : (
              <Text style={ss.small}>No file yet.</Text>
            )}
            <SmallButton
              label={video || upload ? (masterState === 'uploading' && !uploadingNow ? 'Pick the same file to resume' : 'Replace the file') : 'Add the file'}
              icon={<UploadIcon size={15} color={colors.ink} />}
              disabled={uploadingNow}
              onPress={pickFile}
            />
            {video ? <Text style={ss.small}>The old file is deleted when a new one takes its place.</Text> : null}
          </View>
          <View style={ss.card}>
            <TitleField value={form.title} onChange={(v) => set('title', v)} policy={DIRECT} placeholder={init.number ? `Episode ${init.number}` : 'Title'} edited={edited('title')} />
            <OneLineField value={form.oneLine} onChange={(v) => set('oneLine', v)} policy={DIRECT} edited={edited('description')} />
          </View>
          {draft && draft.form && draft.form.contentType === 'bonus' ? (
            <View style={ss.card}>
              <ExtraKindField
                choice={form.extraKindChoice}
                other={form.extraKindOther}
                onChange={(v) => setForm((f) => ({ ...f, extraKindChoice: v.choice, extraKindOther: v.other }))}
              >
                <FieldNote policy={DIRECT} edited={edited('extraKind')} />
              </ExtraKindField>
            </View>
          ) : null}

          <SectionHead label="More info" />
          <View style={ss.card}>
            <AboutField value={form.about} onChange={(v) => set('about', v)} max={aboutMax} policy={DIRECT} edited={edited('description')} />
          </View>
          <SameAsShow inShow={Boolean(show)} ctx={{ form, set, defaults, showYear: show ? show.year : null, resets, reset, pol, titleForAsk: title, adFree: kind === 'podcast' }} />
          {/* A draft is never live: the uploader ticks and unticks it freely. */}
          <View style={ss.card}>
            <FlashingLightsField checked={form.hasFlashingLights} onChange={(v) => set('hasFlashingLights', v)} />
          </View>
          <View style={ss.card}>
            <FieldHead label="Funding link" hint="optional" />
            <EdInput value={form.fundingUrl} placeholder="https://" maxLength={500} keyboardType="url" autoCapitalize="none" autoCorrect={false} onChangeText={(t) => set('fundingUrl', t)} accessibilityLabel="Funding link" />
          </View>
          <View style={ss.card}>
            <Text style={ss.cardK}>Once it’s sent</Text>
            <Text style={ss.small}>Its own poster and still (it uses {show ? `${show.name}’s` : 'the show’s'} art until then), captions, a trailer, its own page and the credits are added in this editor once the draft is sent for review.</Text>
          </View>
          <MoreOptions form={form} set={set} pol={pol} adFree={kind === 'podcast'} />

          <SectionHead label="Place" />
          <View style={ss.card}>
            <PlaceBlock
              place={{
                seasons,
                season: curSeason,
                number: form.number,
                wasCode: placeChanged && init.number ? `S${init.season} E${init.number}` : null,
                nextFree: pos ? pos.nextFree : null,
                holder,
                loading: Boolean(seasonPos[curSeason] && seasonPos[curSeason].state === 'loading'),
                policy: DIRECT,
                onSeason: pickSeason,
                onNumber: (v) => set('number', v),
                onSwap: holder && holder.kind === 'draft' && init.number ? () => placeVia('swap') : null,
                onInsert: holder && holder.kind === 'draft' ? () => placeVia('insert') : null,
                busy: busy === 'place',
                isDraft: true
              }}
            />
          </View>
          <View style={ss.card}>
            <Text style={ss.sheetLabel}>Another show</Text>
            <SmallButton label="Move to another show…" onPress={openMove} />
          </View>
          <View style={ss.card}>
            <SmallButton tone="danger" label={busy === 'discard' ? 'Discarding…' : 'Discard this draft…'} busy={busy === 'discard'} icon={<TrashIcon size={14} color={colors.danger} />} onPress={discard} />
            <Text style={ss.small}>Its uploaded file is deleted too.</Text>
          </View>
          <View style={{ height: foot.spacer }} />
        </View>
      </AccountFrame>
      {moveOpen ? (
        <MoveSheet
          show={{ id: theShowId, name: show ? show.name : '', kind, seasons }}
          episode={{ id: draft.id, kind: 'draft', title: form.title.trim() || null, displayTitle: title, season: init.season, seriesOrder: Number(init.number) || null, code: init.number ? `S${init.season} E${init.number}` : null, status: 'draft' }}
          myShows={myShows}
          onClose={() => setMoveOpen(false)}
          onMoved={async (result) => {
            say({ tone: 'ok', title: 'Moved', lines: [result.words].filter(Boolean) });
            if (result.toShowId && result.toShowId !== theShowId) {
              leave(() => router.replace(episodeEditorRoute(result.toShowId, draft.id, true)));
              return;
            }
            await reloadDraft({ place: true });
            loadView();
          }}
        />
      ) : null}
    </>
  );
}

const ds = StyleSheet.create({
  body: { gap: 14 },
  footMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 }
});
