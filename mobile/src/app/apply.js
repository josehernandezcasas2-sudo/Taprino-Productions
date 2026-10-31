import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import * as WebBrowser from 'expo-web-browser';
import { API_BASE_URL, apiGet, apiPost, freshToken } from '../lib/api';
import { hostedAuthParams } from '../lib/hostedAuth';
import { startTusUpload } from '../lib/tusUpload';
import { APPLICATION_STATUS_LABEL, videoStateLine } from '../lib/submitRules';
import { colors } from '../lib/theme';
import TopNav from '../components/TopNav';
import {
  cp, pickVideo, pickImageAsDataUrl, useUploadProgress, ProgressCard, factsFor, Field, Input, Chips, Check, PrimaryButton, GhostButton, SecondaryButton, StatusCard
} from '../components/CreatorBits';

// Mirrors pages/apply.js (2026-10-31): one short screen. The master
// starts uploading the moment it's picked (tus to Cloudflare, like the
// website) and keeps going while the six fields, the five rights
// questions and the one sentence are filled in; Accept on our side puts
// it live. The same screen shows where the application stands afterwards.
// Everything that is copy-with-rules (the questions, the lists, the
// sentence) comes from GET /api/apply so the two apps can't drift.

const DEFAULT_GENRES = ['Comedy', 'Drama', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime', 'Other'];
const TYPE_PILLS = [
  { value: 'short', label: 'Short' }, { value: 'film', label: 'Film' }, { value: 'series', label: 'Series' }, { value: 'podcast', label: 'Podcast' }, { value: 'vertical', label: 'Snippet' }
];
const DEFAULT_RATINGS = ['All ages', 'TV-14', 'TV-MA / R'];
const DEFAULT_STATUSES = [
  { value: 'finished', label: 'Finished and ready' }, { value: 'festival', label: 'Finished, festival run ongoing' }, { value: 'in_post', label: 'Still in post' }
];
const EMPTY = { title: '', contentType: 'short', logline: '', mainGenre: 'Drama', rating: DEFAULT_RATINGS[0], completionStatus: 'finished', name: '', portfolioUrl: '', mediaLink: '' };
const CONTACT = 'hello@studiotapatv.site';

function verdictFor(questions, answers) {
  const answered = questions.filter((q) => answers[q.id]).length;
  const blocked = questions.some((q) => q.block && answers[q.id] === 'no');
  const holds = questions.filter((q) => !q.block && answers[q.id] === 'no').map((q) => q.hold);
  const complete = questions.length > 0 && answered === questions.length;
  let result;
  if (blocked) result = 'blocked';
  else if (!complete) result = 'incomplete';
  else if (holds.length) result = 'held';
  else result = 'clear';
  let copy;
  if (answered === 0) copy = { level: 'neutral', tag: 'Not started', body: 'Nothing is sent until you apply.' };
  else if (result === 'blocked') copy = { level: 'warn', tag: 'Can’t accept', body: 'Only the rights holder can submit a film. If that’s a collaborator, ask them to apply, or apply together.' };
  else if (result === 'held') copy = { level: 'review', tag: 'Will be held in review', body: `We’d need ${holds.map((h) => h.toLowerCase()).join('; ')}. Send them with this, or reply to the email.` };
  else if (result === 'incomplete') copy = { level: 'neutral', tag: `${answered} of ${questions.length} answered`, body: 'Keep going.' };
  else copy = { level: 'ok', tag: 'Clear to submit', body: 'Rights look clean. Review then comes down to picture, sound and fit.' };
  return { result, answered, holds, complete, copy };
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const openSite = (path) => WebBrowser.openBrowserAsync(`${API_BASE_URL}${path}`);

export default function Apply() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { startHostedAuth } = useHostedAuth();
  const upload = useUploadProgress();
  const tusUrlRef = useRef(null);
  const appRef = useRef(null);

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [answers, setAnswers] = useState({});
  const [attested, setAttested] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [video, setVideo] = useState(null); // { uid, uploadUrl, name, bytes, runtimeSeconds, width, height }
  const [linkMode, setLinkMode] = useState(false);
  const [reapply, setReapply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const token = isLoaded && isSignedIn ? await freshToken(getToken) : null;
    try {
      const data = await apiGet('/api/apply', token);
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState((s) => ({ loading: false, error: s.data ? null : err.message, data: s.data }));
    }
  }, [isLoaded, isSignedIn]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const data = state.data;
  const questions = data ? data.questions : [];
  const onboarding = (data && data.onboarding) || { shortMaxMinutes: 40, minResolution: '1080p', replyWindow: 'two weeks' };
  const ratings = (data && data.ratings) || DEFAULT_RATINGS;
  const statuses = (data && data.statuses) || DEFAULT_STATUSES;
  const genres = (data && data.genres) || DEFAULT_GENRES;
  const statusLabels = (data && data.statusLabels) || APPLICATION_STATUS_LABEL;
  const app = data ? data.application : null;
  appRef.current = app;
  const creator = Boolean(data && data.isCreator);
  const signedIn = Boolean(isSignedIn && data && data.isSignedIn);

  // Keeps the row's resumable address current once the application exists.
  const storeUploadUrl = useCallback(async (uid, url) => {
    const current = appRef.current;
    if (!current || !current.video || current.video.uid !== uid || current.video.uploadUrl === url) return;
    try {
      const res = await apiPost('/api/apply/video', { id: current.id, videoUid: uid, uploadUrl: url, videoName: current.video.name, videoBytes: current.video.bytes, runtimeSeconds: current.video.runtimeSeconds }, await freshToken(getToken));
      setState((s) => ({ ...s, data: { ...s.data, application: res.application } }));
    } catch {
      // Best effort.
    }
  }, [getToken]);

  async function beginUpload(asset, { resumeUrl = null } = {}) {
    setError(null);
    try {
      const started = await startTusUpload({
        asset,
        urlPath: '/api/apply/upload-url',
        token: await freshToken(getToken),
        resumeUrl,
        onUrl: (url) => { tusUrlRef.current = url; storeUploadUrl(started.uid, url); }
      });
      const info = { uid: started.uid, uploadUrl: resumeUrl || null, name: asset.fileName || 'video', bytes: asset.fileSize || null, runtimeSeconds: asset.duration ? Math.round(asset.duration / 1000) : null, width: asset.width || null, height: asset.height || null, state: 'uploading' };
      setVideo(info);
      started.done.then(() => { setVideo((v) => (v && v.uid === started.uid ? { ...v, state: 'uploaded' } : v)); load(); }).catch(() => {});
      return info;
    } catch (err) {
      setError(err.message || 'Could not start the upload.');
      return null;
    }
  }

  async function pickMaster() {
    if (!signedIn) { setError('Sign in (free) first: the upload needs an account to belong to.'); return; }
    try {
      const asset = await pickVideo();
      if (!asset) return;
      if (!form.title.trim() && asset.fileName) update('title', asset.fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      await beginUpload(asset);
    } catch (err) {
      setError(err.message);
    }
  }

  // While Cloudflare is still receiving or processing the master, ask
  // every few seconds where it stands.
  const uploadingHere = Boolean(upload && app && app.video && upload.uid === app.video.uid && ['requesting-url', 'uploading'].includes(upload.status));
  const waiting = Boolean(app && app.isOpen && app.video && ['uploading', 'processing'].includes(app.video.state) && !uploadingHere);
  useEffect(() => {
    if (!waiting) return undefined;
    let n = 0;
    const t = setInterval(() => { n += 1; if (n > 100) { clearInterval(t); return; } load(); }, 6000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const verdict = verdictFor(questions, answers);
  const showForm = Boolean(data) && !creator && (!app || (app.status === 'declined' && reapply));
  const hasFile = Boolean(video) || Boolean(form.mediaLink.trim());

  let blocker = null;
  if (!hasFile) blocker = 'Pick the master, or paste a link to it.';
  else if (!form.title.trim()) blocker = 'Give it a title.';
  else if (!form.logline.trim()) blocker = 'One line about it.';
  else if (!verdict.complete) blocker = `Answer all five rights questions (${verdict.answered} of 5 so far).`;
  else if (verdict.result === 'blocked') blocker = 'Only the rights holder can apply.';
  else if (!signedIn) blocker = 'Sign in (free) so we can attach this to your account.';
  else if (!form.name.trim()) blocker = 'Your name, as credited.';
  else if (!attested) blocker = 'Tick the rights sentence.';

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  async function send() {
    if (blocker) { setError(blocker); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, rightsAnswers: answers, rightsAttested: true, ...(video ? { videoUid: video.uid, videoName: video.name, videoBytes: video.bytes, runtimeSeconds: video.runtimeSeconds, uploadUrl: tusUrlRef.current || video.uploadUrl || null } : {}) };
      const res = await apiPost('/api/apply', body, await freshToken(getToken));
      setState((s) => ({ ...s, data: { ...s.data, application: res.application } }));
      setReapply(false);
      setForm(EMPTY);
      setAnswers({});
      setAttested(false);
      setVideo(null);
    } catch (err) {
      setError(err.message);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function replaceFile({ resume = false } = {}) {
    if (!app) return;
    try {
      const asset = await pickVideo();
      if (!asset) return;
      const same = resume && app.video && app.video.uploadUrl && app.video.bytes === asset.fileSize;
      const info = await beginUpload(asset, { resumeUrl: same ? app.video.uploadUrl : null });
      if (!info || same) return;
      const res = await apiPost('/api/apply/video', { id: app.id, videoUid: info.uid, videoName: info.name, videoBytes: info.bytes, runtimeSeconds: info.runtimeSeconds, uploadUrl: tusUrlRef.current || null }, await freshToken(getToken));
      setState((s) => ({ ...s, data: { ...s.data, application: res.application } }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendArtwork(kind) {
    if (!app) return;
    setBusy(true);
    setError(null);
    try {
      const img = await pickImageAsDataUrl({ width: kind === 'poster' ? 600 : 1280 });
      if (!img) return;
      const res = await apiPost('/api/apply/artwork', kind === 'poster' ? { id: app.id, posterBase64: img.base64, posterFileName: img.fileName } : { id: app.id, thumbnailBase64: img.base64, thumbnailFileName: img.fileName }, await freshToken(getToken));
      setState((s) => ({ ...s, data: { ...s.data, application: res.application } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) {
    return <SafeAreaView style={cp.screen} edges={['top', 'bottom']}><TopNav /><View style={cp.center}><ActivityIndicator color={colors.brass} /></View></SafeAreaView>;
  }
  if (state.error && !data) {
    return (
      <SafeAreaView style={cp.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={cp.center}>
          <Text style={cp.error}>{state.error}</Text>
          <SecondaryButton label="Try again" onPress={() => { setState({ loading: true, error: null, data: null }); load(); }} />
        </View>
      </SafeAreaView>
    );
  }

  const uploadNow = upload && video && upload.uid === video.uid ? upload : null;

  return (
    <SafeAreaView style={cp.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={cp.scroll} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={cp.eyebrow}>For creators</Text>
          <Text style={cp.h1}>{app && !showForm ? 'Your application' : 'Send us your film.'}</Text>
          {showForm ? (
            <Text style={cp.lede}>
              One page. The master uploads while you fill in the rest, we watch it, and if it&rsquo;s a fit it goes live with you keeping every right.{' '}
              <Text style={cp.link} onPress={() => openSite('/terms#submit-work')}>Terms, section 5</Text>
            </Text>
          ) : null}
        </View>

        {creator ? (
          <StatusCard level="ok" tag="Creator Studio" title="You already have Creator Studio.">
            <Text style={cp.p}>No need to apply. Submit films, shorts and everything else there, and track their review.</Text>
            <View style={cp.actions}><PrimaryButton label="Open Creator Studio" onPress={() => router.push('/creator')} /></View>
          </StatusCard>
        ) : null}

        {!creator && app ? (
          <ApplicationStatus
            app={app}
            labels={statusLabels}
            onboarding={onboarding}
            upload={uploadingHere ? upload : null}
            busy={busy}
            reapplying={reapply}
            onReapply={() => setReapply(true)}
            onReplace={() => replaceFile()}
            onResume={() => replaceFile({ resume: true })}
            onArtwork={sendArtwork}
            onView={() => router.push(app.episodeHref)}
            onStudio={() => router.push('/creator')}
          />
        ) : null}

        {error && !showForm ? <Text style={cp.error}>{error}</Text> : null}

        {showForm ? (
          <>
            <View style={cp.card}>
              <Text style={cp.cardK}>1 · The film</Text>
              {!video && !linkMode ? (
                <View style={cp.drop}>
                  <Text style={cp.dropTitle}>Pick the master</Text>
                  <Text style={cp.dropSub}>MP4 or MOV, any size. It starts uploading right away and keeps going while you type.</Text>
                  {signedIn
                    ? <GhostButton label="Choose a video" onPress={pickMaster} />
                    : <GhostButton label="Sign in to upload" onPress={() => startHostedAuth(hostedAuthParams('sign-in')).catch(() => {})} />}
                  <Text style={cp.link} onPress={() => setLinkMode(true)}>or paste a link to it (Drive, Dropbox, WeTransfer)</Text>
                </View>
              ) : null}
              {video ? <ProgressCard video={video} upload={uploadNow} facts={factsFor(video)} onRemove={() => { setVideo(null); tusUrlRef.current = null; }} /> : null}
              {linkMode && !video ? (
                <Field label="Link to the files">
                  <Input value={form.mediaLink} onChangeText={(v) => update('mediaLink', v)} placeholder="https://" autoCapitalize="none" keyboardType="url" />
                  <Text style={cp.help}>A share link we can open. <Text style={cp.link} onPress={() => setLinkMode(false)}>Upload the file instead</Text></Text>
                </Field>
              ) : null}
              <Field label="Title"><Input value={form.title} onChangeText={(v) => update('title', v)} maxLength={300} /></Field>
              <Field label="What is it">
                <Chips options={TYPE_PILLS} value={form.contentType} onChange={(v) => update('contentType', v)} />
                {form.contentType === 'series' || form.contentType === 'podcast' ? <Text style={cp.help}>Send the first episode. The show is created around it when it goes live; the rest follow from Creator Studio.</Text> : null}
              </Field>
              <Field label="One line about it"><Input value={form.logline} onChangeText={(v) => update('logline', v)} maxLength={200} /></Field>
              <Field label="Genre"><Chips small options={genres.map((g) => ({ value: g, label: g }))} value={form.mainGenre} onChange={(v) => update('mainGenre', v)} /></Field>
              <Field label="Rating"><Chips small options={ratings.map((r) => ({ value: r, label: r }))} value={form.rating} onChange={(v) => update('rating', v)} /></Field>
              <Field label="Where it stands"><Chips small options={statuses} value={form.completionStatus} onChange={(v) => update('completionStatus', v)} /></Field>
            </View>

            <View style={cp.card}>
              <Text style={cp.cardK}>2 · Rights, five questions</Text>
              {questions.map((q, i) => (
                <View key={q.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 13.5, lineHeight: 18, color: colors.ink }}>{i + 1}. {q.text}</Text>
                    <Chips small options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                  </View>
                  <Text style={cp.help}>{q.hint}</Text>
                </View>
              ))}
              <StatusCard level={verdict.copy.level} tag={verdict.copy.tag}><Text style={cp.p}>{verdict.copy.body}</Text></StatusCard>
            </View>

            <View style={cp.card}>
              <Text style={cp.cardK}>3 · You</Text>
              <View style={[cp.signed, signedIn && cp.signedOn]}>
                {signedIn ? (
                  <Text style={cp.signedText}>Signed in as <Text style={cp.strong}>{data.email || 'you'}</Text></Text>
                ) : (
                  <>
                    <Text style={cp.signedText}>A free account, so the application is yours and the reply finds you.</Text>
                    <GhostButton label="Sign in or create one" onPress={() => startHostedAuth(hostedAuthParams('sign-in')).catch(() => {})} />
                  </>
                )}
              </View>
              <Field label="Your name, as credited"><Input value={form.name} onChangeText={(v) => update('name', v)} maxLength={200} /></Field>
              <Field label="Portfolio or reel" note="optional"><Input value={form.portfolioUrl} onChangeText={(v) => update('portfolioUrl', v)} placeholder="https://" autoCapitalize="none" keyboardType="url" /></Field>
              <Check mono on={attested} onPress={() => setAttested((a) => !a)}>
                {data.attestation || 'I made this or hold the rights, I’ve done the check above and will send licences for anything it flagged, and I’ve read Terms, section 5: I keep my copyright and grant a non-exclusive licence to stream and promote.'}
              </Check>
            </View>

            {error ? <Text style={cp.error}>{error}</Text> : null}
            <PrimaryButton label="Send it in" onPress={send} busy={busy} disabled={Boolean(blocker)} />
            <Text style={cp.note}>{blocker || (uploadNow && uploadNow.status === 'uploading' ? 'The upload keeps going after you send; keep the app open until it finishes, or pick the same file again later to resume.' : `We watch it and reply within ${onboarding.replyWindow}.`)}</Text>
          </>
        ) : null}

        <View style={{ gap: 10, marginTop: 10 }}>
          <Text style={cp.cardK}>What we take and what we pass on</Text>
          <View style={cp.card}>
            <Text style={[cp.strong, { fontSize: 15 }]}>Shorts and films</Text>
            <Text style={cp.p}>Finished and ready to watch, made by you. Under {onboarding.shortMaxMinutes} minutes is a short; narrative or documentary; student and first films welcome. Festival runs are fine as long as you still hold streaming rights.</Text>
            <Text style={[cp.strong, { fontSize: 15 }]}>Series, podcasts, Snippets</Text>
            <Text style={cp.p}>Send the first episode here and the rest from Creator Studio once you&rsquo;re in. Snippets are vertical, 9:16.</Text>
            <Text style={[cp.strong, { fontSize: 15 }]}>What we pass on</Text>
            <Text style={cp.p}>Trailers on their own, works in progress, re-uploads of other people&rsquo;s work, compilations, and anything you can&rsquo;t clear in the rights check.</Text>
            <Text style={cp.p}>The master: the best you have, MP4 or MOV, {onboarding.minResolution} minimum. Artwork and captions are optional; we cut a poster and a still from the film and caption what we can. You keep your copyright; we get a non-exclusive licence to stream and promote.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ApplicationStatus({ app, labels, onboarding, upload, busy, reapplying, onReapply, onReplace, onResume, onArtwork, onView, onStudio }) {
  const label = labels[app.status] || app.status;
  const mailto = `mailto:${CONTACT}?subject=${encodeURIComponent(`${app.title}: what you asked for`)}`;
  if (app.status === 'accepted') {
    const live = Boolean(app.episodeHref);
    return (
      <StatusCard level="ok" tag={live ? 'You’re in · Live' : 'You’re in'} title={live ? `${app.title} is on Studio Tapa TV` : app.title}>
        <Text style={cp.p}>{live ? `Accepted ${fmtDate(app.reviewedAt)}. Creator Studio is on your account: your numbers, your money, the next title.` : `Accepted ${fmtDate(app.reviewedAt)}. Creator Studio is on your account: upload the master there and it goes into our review queue.`}</Text>
        {app.decisionNote ? <Text style={cp.p}><Text style={cp.strong}>A note from us: </Text>{app.decisionNote}</Text> : null}
        <View style={cp.actions}>
          {live ? <PrimaryButton label="View the page" onPress={onView} /> : null}
          {live ? <SecondaryButton label="Open Creator Studio" onPress={onStudio} /> : <PrimaryButton label="Open Creator Studio" onPress={onStudio} />}
        </View>
      </StatusCard>
    );
  }
  if (app.status === 'declined') {
    return (
      <StatusCard level="neutral" tag={label} title={app.title}>
        <Text style={cp.p}>Not a fit for Studio Tapa TV right now{app.reviewedAt ? ` (${fmtDate(app.reviewedAt)})` : ''}.{app.video && app.video.state === 'deleted' ? ' The file is deleted from our side.' : ''} You&rsquo;re welcome to send new work any time.</Text>
        {app.decisionNote ? <Text style={cp.p}><Text style={cp.strong}>A note from us: </Text>{app.decisionNote}</Text> : null}
        {!reapplying ? <View style={cp.actions}><GhostButton label="Send something new" onPress={onReapply} /></View> : null}
      </StatusCard>
    );
  }
  if (app.status === 'held') {
    return (
      <StatusCard level="warn" tag={label} title={app.title}>
        {app.decisionNote ? <Text style={cp.p}><Text style={cp.strong}>From us: </Text>{app.decisionNote}</Text> : null}
        {upload ? <ProgressCard video={{ ...app.video, name: upload.name, bytes: upload.bytes }} upload={upload} /> : null}
        <Text style={cp.p}>Replace the file, or send what&rsquo;s missing, and it comes straight back to us.</Text>
        <View style={cp.actions}>
          <GhostButton label="Replace the file" onPress={onReplace} />
          <SecondaryButton label="Send it by email" onPress={() => Linking.openURL(mailto).catch(() => {})} />
        </View>
      </StatusCard>
    );
  }
  const stalled = app.video && app.video.state === 'uploading' && !upload;
  return (
    <StatusCard level="review" tag={label} title={app.title}>
      {upload
        ? <ProgressCard video={{ ...app.video, name: upload.name, bytes: upload.bytes }} upload={upload} />
        : <Text style={cp.p}>Sent {fmtDate(app.createdAt)}. {app.video ? videoStateLine(app.video) : app.hasLink ? 'We open your link from here.' : ''} We watch everything and reply within {onboarding.replyWindow}, by email and here.</Text>}
      {upload ? <Text style={cp.p}>Keep the app open until it finishes. Close it and the upload stops; pick the same file again later and it carries on.</Text> : null}
      {stalled ? (
        <View style={cp.actions}>
          <GhostButton label="Pick the same file to resume" onPress={onResume} />
          <GhostButton label="Replace the file" onPress={onReplace} />
        </View>
      ) : null}
      {app.holds && app.holds.length ? (
        <>
          <Text style={cp.statusK}>STILL TO SEND US</Text>
          {app.holds.map((h) => <Text key={h} style={cp.p}>• {h} — <Text style={cp.link} onPress={() => Linking.openURL(mailto).catch(() => {})}>send it by email</Text></Text>)}
        </>
      ) : null}
      <Text style={cp.statusK}>OPTIONAL</Text>
      <Text style={cp.p}>{app.poster || app.thumbnail ? `Artwork received${app.poster && app.thumbnail ? ' (poster and still)' : app.poster ? ' (poster; we cut the still from the film)' : ' (still; we cut the poster from the film)'}. Swap it any time from Your work once it’s live.` : 'A 2:3 poster and a 16:9 still, no text baked in. Skip them and we cut both from the film.'}</Text>
      <View style={cp.actions}>
        <GhostButton label={app.poster ? 'Change the poster' : 'Add a poster'} disabled={busy} onPress={() => onArtwork('poster')} />
        <GhostButton label={app.thumbnail ? 'Change the still' : 'Add a still'} disabled={busy} onPress={() => onArtwork('still')} />
        {!stalled && app.video ? <GhostButton label="Replace the file" onPress={onReplace} /> : null}
      </View>
    </StatusCard>
  );
}

