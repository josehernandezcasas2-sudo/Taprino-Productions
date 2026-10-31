import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiDelete, apiGet, apiPost, freshToken } from '../../lib/api';
import { startTusUpload } from '../../lib/tusUpload';
import {
  SUBMIT_TYPES, MAIN_GENRES, STEPS, EMPTY_SUBMIT_FORM, typeNeedsShow, typeIsNumbered, showNoun, stepBlocker, toSubmitBody, formatRuntime, bytesLabel
} from '../../lib/submitRules';
import { useContentRatings } from '../../lib/contentAdvisory';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import {
  cp, pickVideo, pickImageAsDataUrl, useUploadProgress, ProgressCard, factsFor, Field, Input, Chips, Switch, PrimaryButton, GhostButton, SecondaryButton
} from '../../components/CreatorBits';
import { BackArrowIcon } from '../../components/account/AccountBits';

// Creator Studio's submit, three steps (mirrors pages/creator/submit.js,
// 2026-10-31): the file (uploading from the moment it's picked), about it
// (with "+ New show" inline), artwork with the options folded away. Saved
// as a draft as the creator goes (/api/creator/drafts), reopened at the
// same step from the hub; the stopped upload resumes when the same file
// is picked again. Captions are the website's (no document picker here).

function initialForm(draft, type, series) {
  const base = { ...EMPTY_SUBMIT_FORM, ...(draft ? draft.form : {}) };
  if (!draft && type && SUBMIT_TYPES.some((t) => t.value === type)) base.contentType = type;
  if (!draft && series) base.seriesId = series;
  if (!draft && type === 'bonus') base.cutArtwork = false;
  return base;
}

export default function SubmitTitle() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { getToken } = useAuth();
  const upload = useUploadProgress();
  const ratings = useContentRatings();
  const [loading, setLoading] = useState(Boolean(params.draft));
  const [allSeries, setAllSeries] = useState([]);
  const [form, setForm] = useState(() => initialForm(null, params.type, params.series));
  const [video, setVideo] = useState(null);
  const [trailer, setTrailer] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [step, setStep] = useState(1);
  const [poster, setPoster] = useState(null);
  const [still, setStill] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef(null);
  const latest = useRef({ form, video, trailer, draftId });
  latest.current = { form, video, trailer, draftId };

  // The creator's shows for the picker, and the draft when resuming one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await freshToken(getToken);
      apiGet('/api/creator/list-series', token).then((d) => { if (alive) setAllSeries((d.series || []).map((x) => ({ id: x.id, name: x.name, status: x.status || 'approved' }))); }).catch(() => {});
      if (params.draft) {
        try {
          const d = await apiGet(`/api/creator/drafts?id=${encodeURIComponent(params.draft)}`, token);
          if (!alive) return;
          setForm(initialForm(d.draft, null, null));
          setVideo(d.draft.video);
          setTrailer(d.draft.trailer);
          setDraftId(d.draft.id);
          setStep(d.draft.form && d.draft.form.step ? Math.min(3, Math.max(1, Number(d.draft.form.step))) : 1);
        } catch (err) {
          if (alive) setError(err.message);
        } finally {
          if (alive) setLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [params.draft]);

  const media = useMemo(() => ({ video, trailer, audioUrl: form.audioUrl || null, audioBytes: form.audioBytes || null }), [video, trailer, form.audioUrl, form.audioBytes]);
  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const saveDraft = useCallback(async () => {
    const { form: f, video: v, trailer: t, draftId: id } = latest.current;
    if (!v && !t && !String(f.title || '').trim() && !f.audioUrl) return;
    setSaveState('saving');
    try {
      const data = await apiPost('/api/creator/drafts', { id, form: f, video: v, trailer: t }, await freshToken(getToken));
      if (!id) setDraftId(data.draft.id);
      setSaveState('saved');
    } catch (err) {
      setSaveState('failed');
    }
  }, [getToken]);

  useEffect(() => {
    if (loading) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveDraft, 1000);
    return () => clearTimeout(saveTimer.current);
  }, [form, video, trailer, loading, saveDraft]);

  useEffect(() => { update('step', step); }, [step]);

  useEffect(() => {
    if (video && video.runtimeSeconds && !String(form.runtime || '').trim()) update('runtime', formatRuntime(video.runtimeSeconds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video && video.runtimeSeconds]);

  // A link import: ask every few seconds until Cloudflare has it.
  const polling = video && video.state === 'processing' && !video.bytes;
  useEffect(() => {
    if (!polling) return undefined;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n > 200) { clearInterval(t); return; }
      try {
        const st = await apiGet(`/api/creator/video-status?uid=${encodeURIComponent(video.uid)}`, await freshToken(getToken));
        if (st.state === 'ready' || st.readyToStream) setVideo((v) => (v ? { ...v, state: 'ready', runtimeSeconds: v.runtimeSeconds || (st.duration ? Math.round(st.duration) : null) } : v));
        else if (st.state === 'error') { setVideo((v) => (v ? { ...v, state: 'error' } : v)); setError(st.errorReasonText || 'Cloudflare could not process that link.'); }
      } catch {
        // next tick
      }
    }, 4000);
    return () => clearInterval(t);
  }, [polling, video && video.uid]);

  const anyUploading = Boolean(upload && ['requesting-url', 'uploading'].includes(upload.status));
  const masterUploading = Boolean(upload && video && upload.uid === video.uid && anyUploading);
  const trailerUploading = Boolean(upload && trailer && upload.uid === trailer.uid && anyUploading);

  async function beginMaster(asset, { resumeUrl = null } = {}) {
    setError(null);
    try {
      const started = await startTusUpload({
        asset, urlPath: '/api/creator/get-upload-url', token: await freshToken(getToken), resumeUrl, kind: 'main',
        onUrl: (url) => setVideo((v) => (v && v.uid === started.uid ? { ...v, uploadUrl: url } : v))
      });
      setVideo({ uid: started.uid, state: 'uploading', name: asset.fileName || 'video', bytes: asset.fileSize || null, uploadUrl: resumeUrl || null, runtimeSeconds: asset.duration ? Math.round(asset.duration / 1000) : null, width: asset.width || null, height: asset.height || null });
      if (!String(latest.current.form.title || '').trim() && asset.fileName) update('title', asset.fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      started.done.then(() => setVideo((v) => (v && v.uid === started.uid ? { ...v, state: 'processing' } : v))).catch(() => {});
    } catch (err) {
      setError(err.message || 'Could not start the upload.');
    }
  }

  async function pickMaster() {
    if (anyUploading) { setError('An upload is already running. Let it finish first.'); return; }
    try {
      const asset = await pickVideo();
      if (!asset) return;
      const resume = video && video.uploadUrl && video.state === 'uploading' && video.bytes === asset.fileSize;
      await beginMaster(asset, { resumeUrl: resume ? video.uploadUrl : null });
    } catch (err) {
      setError(err.message);
    }
  }

  async function pickTrailer() {
    if (anyUploading) { setError('The master is still uploading. Pick the trailer once it has finished.'); return; }
    try {
      const asset = await pickVideo();
      if (!asset) return;
      const started = await startTusUpload({ asset, urlPath: '/api/creator/get-upload-url', token: await freshToken(getToken), kind: 'trailer' });
      setTrailer({ uid: started.uid, state: 'uploading', name: asset.fileName || 'trailer' });
      started.done.then(() => setTrailer((t) => (t && t.uid === started.uid ? { ...t, state: 'processing' } : t))).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  }

  async function importLink() {
    const url = link.trim();
    if (!url) return;
    setImporting(true);
    setError(null);
    try {
      const token = await freshToken(getToken);
      if (form.contentType === 'podcast' && /\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(url)) {
        const data = await apiPost('/api/creator/import-audio-url', { audioUrl: url }, token);
        setForm((f) => ({ ...f, audioUrl: data.audioUrl, audioBytes: data.audioBytes || null }));
      } else {
        const data = await apiPost('/api/creator/import-video-url', { videoUrl: url, fileName: form.title ? `${form.title}.mp4` : undefined }, token);
        setVideo({ uid: data.uid, state: 'processing', name: url.replace(/^https?:\/\//, '').slice(0, 60), bytes: null, uploadUrl: null, runtimeSeconds: null });
      }
      setLinkMode(false);
      setLink('');
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function pickArt(kind) {
    try {
      const img = await pickImageAsDataUrl({ width: kind === 'poster' ? 600 : 1280 });
      if (!img) return;
      if (kind === 'poster') setPoster(img); else setStill(img);
      update('cutArtwork', false);
    } catch (err) {
      setError(err.message);
    }
  }

  function discardDraft() {
    Alert.alert('Discard this draft?', 'The uploaded file is deleted too.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => {
        try {
          if (draftId) await apiDelete('/api/creator/drafts', { id: draftId }, await freshToken(getToken));
          if (saveTimer.current) clearTimeout(saveTimer.current);
          router.replace('/creator');
        } catch (err) {
          setError(err.message);
        }
      } }
    ]);
  }

  function next() {
    const why = stepBlocker(step, form, media);
    if (why) { setError(why); return; }
    setError(null);
    setStep((s) => Math.min(3, s + 1));
  }

  async function submit() {
    for (const n of [1, 2]) {
      const why = stepBlocker(n, form, media);
      if (why) { setError(why); setStep(n); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = toSubmitBody(form, media, {
        ...(!form.cutArtwork && poster ? { posterBase64: poster.base64, posterFileName: poster.fileName } : {}),
        ...(!form.cutArtwork && still ? { thumbnailBase64: still.base64, thumbnailFileName: still.fileName } : {}),
        ...(draftId ? { draftId } : {})
      });
      await apiPost('/api/creator/submit-episode', body, await freshToken(getToken));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      latest.current = { form: EMPTY_SUBMIT_FORM, video: null, trailer: null, draftId: null };
      router.replace(`/creator?submitted=${encodeURIComponent(form.title.trim())}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return <SafeAreaView style={cp.screen} edges={['top', 'bottom']}><TopNav /><View style={cp.center}><ActivityIndicator color={colors.brass} /></View></SafeAreaView>;
  }

  const stepInfo = STEPS[step - 1];
  const pct = upload && upload.total ? Math.min(100, Math.round((upload.sent / upload.total) * 100)) : 0;
  const strip = video
    ? `${video.name}${video.bytes ? ` · ${bytesLabel(video.bytes)}` : ''} · ${masterUploading ? `${pct}% uploading` : video.state === 'uploading' ? 'upload stopped' : video.state === 'processing' ? 'uploaded, processing' : video.state === 'ready' ? 'ready' : video.state === 'error' ? 'failed to process' : video.state}`
    : form.audioUrl ? 'Audio imported' : null;
  const showOptions = allSeries;

  return (
    <SafeAreaView style={cp.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={[cp.scroll, { paddingTop: 8 }]} keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <Pressable onPress={() => router.navigate('/creator')} hitSlop={8} style={s.back}><BackArrowIcon size={16} color={colors.inkDim} /></Pressable>
          <Text style={s.headTitle}>Submit a title</Text>
          <Text style={s.headStep}>STEP {step} OF 3</Text>
        </View>
        <View style={s.progress}><View style={[s.progressFill, { width: `${(step / 3) * 100}%` }]} /></View>
        {step > 1 && strip ? (
          <View style={[s.strip, video && video.state === 'error' && s.stripError]}>
            <Text style={s.stripText} numberOfLines={1}>{strip}</Text>
            <Text style={s.stripText}>{masterUploading ? `${pct}%` : video && (video.state === 'ready' || video.state === 'processing') ? '✓' : ''}</Text>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={{ gap: 14 }}>
            <Text style={cp.h1}>{stepInfo.title}</Text>
            <Text style={cp.lede}>Pick the master. It starts uploading now and keeps going while you fill in the next two steps; close the app and it stops, pick the same file again and it carries on.</Text>
            {!linkMode ? (
              <Field label="What is it"><Chips options={SUBMIT_TYPES} value={form.contentType} onChange={(v) => update('contentType', v)} /></Field>
            ) : null}
            {!video && !form.audioUrl && !linkMode ? (
              <View style={cp.drop}>
                <Text style={cp.dropTitle}>Pick the master</Text>
                <Text style={cp.dropSub}>{form.contentType === 'vertical' ? '9:16, MP4 or MOV, any size.' : 'MP4 or MOV, 1080p or better, any size.'}</Text>
                <GhostButton label="Choose a video" onPress={pickMaster} />
              </View>
            ) : null}
            {video ? <ProgressCard video={video} upload={masterUploading ? upload : null} facts={factsFor(video)} onRemove={() => setVideo(null)} onResume={video.state === 'uploading' && !masterUploading ? pickMaster : null} /> : null}
            {form.audioUrl ? (
              <View style={cp.progress}>
                <View style={cp.progressRow}><Text style={cp.progressName}>Audio imported{form.audioBytes ? ` · ${bytesLabel(form.audioBytes)}` : ''}</Text><Text style={cp.progressRight}>ready ✓</Text></View>
                <View style={cp.progressMeta}><Text style={cp.metaText}>An audio-only episode. Add a video too, or go on.</Text><Text style={cp.link} onPress={() => setForm((f) => ({ ...f, audioUrl: null, audioBytes: null }))}>Remove</Text></View>
              </View>
            ) : null}
            {!linkMode ? (
              <Text style={cp.link} onPress={() => setLinkMode(true)}>The file is somewhere else</Text>
            ) : (
              <View style={cp.card}>
                <Text style={cp.cardK}>A link to the file</Text>
                <Text style={cp.help}>A direct file link (a signed download link from Drive, Dropbox, WeTransfer, Frame.io or S3) and Cloudflare fetches it. A page that only shows a player has no file to fetch.{form.contentType === 'podcast' ? ' Audio only: paste the MP3 the same way.' : ''}</Text>
                <Input value={link} onChangeText={setLink} placeholder="https://" autoCapitalize="none" keyboardType="url" />
                <View style={cp.actions}>
                  <SecondaryButton label={importing ? 'Fetching…' : 'Fetch it'} disabled={importing || !link.trim()} onPress={importLink} />
                  <GhostButton label="Pick the file instead" onPress={() => setLinkMode(false)} />
                </View>
              </View>
            )}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={{ gap: 14 }}>
            <Text style={cp.h1}>{stepInfo.title}</Text>
            <Text style={cp.lede}>What viewers read on the page. Short is fine.</Text>
            <Field label="Title"><Input value={form.title} onChangeText={(v) => update('title', v)} maxLength={300} /></Field>
            <Field label="About it"><Input multiline value={form.description} onChangeText={(v) => update('description', v)} maxLength={4000} /></Field>
            <Field label="Your name, as credited"><Input value={form.artist} onChangeText={(v) => update('artist', v)} maxLength={200} /></Field>
            {typeNeedsShow(form.contentType) ? (
              <Field label={form.contentType === 'bonus' ? 'Which show is it for' : `The ${showNoun(form.contentType)}`}>
                <Chips small
                  options={[...showOptions.map((x) => ({ value: x.id, label: `${x.name}${x.status === 'pending' ? ' (in review)' : ''}` })), ...(form.contentType !== 'bonus' ? [{ value: '__new__', label: `+ New ${showNoun(form.contentType)}` }] : [])]}
                  value={String(form.newSeriesName || '').trim() || form.newSeriesName === ' ' ? '__new__' : form.seriesId}
                  onChange={(v) => { if (v === '__new__') setForm((f) => ({ ...f, seriesId: '', newSeriesName: f.newSeriesName || ' ' })); else setForm((f) => ({ ...f, seriesId: v, newSeriesName: '', newSeriesDescription: '' })); }}
                />
                {String(form.newSeriesName || '').length > 0 && form.contentType !== 'bonus' ? (
                  <View style={s.newShow}>
                    <Field label={`New ${showNoun(form.contentType)} name`}><Input value={form.newSeriesName.trimStart()} onChangeText={(v) => update('newSeriesName', v || ' ')} maxLength={120} placeholder="The show this episode belongs to" /></Field>
                    <Field label={`About the ${showNoun(form.contentType)}`} note="optional"><Input multiline value={form.newSeriesDescription} onChangeText={(v) => update('newSeriesDescription', v)} maxLength={2000} style={{ minHeight: 64 }} /></Field>
                    <Text style={cp.help}>The {showNoun(form.contentType)} is created with this episode. Its own poster and trailer come later, from the website&rsquo;s Series management.</Text>
                  </View>
                ) : null}
              </Field>
            ) : null}
            {typeIsNumbered(form.contentType) ? (
              <View style={s.two}>
                <Field label="Season" style={{ flex: 1 }}><Input value={String(form.season)} onChangeText={(v) => update('season', v)} keyboardType="number-pad" /></Field>
                <Field label="Episode number" style={{ flex: 1 }}><Input value={String(form.seriesOrder)} onChangeText={(v) => update('seriesOrder', v)} keyboardType="number-pad" /></Field>
              </View>
            ) : null}
            <Field label="Genre"><Chips small options={MAIN_GENRES.map((g) => ({ value: g, label: g }))} value={form.mainGenre} onChange={(v) => update('mainGenre', v)} /></Field>
            <Field label="Rating" note="not set = treated as 17+"><Chips small options={[{ value: '', label: 'Not set' }, ...ratings.map((r) => ({ value: r.code, label: r.code }))]} value={form.rating} onChange={(v) => update('rating', v)} /></Field>
            <View style={s.two}>
              <Field label="Runtime" note={video && video.runtimeSeconds ? 'read from the file' : 'MM:SS'} style={{ flex: 1 }}><Input value={form.runtime} onChangeText={(v) => update('runtime', v)} placeholder="12:04" /></Field>
              <Field label="Year" note="optional" style={{ flex: 1 }}><Input value={String(form.releaseYear || '')} onChangeText={(v) => update('releaseYear', v)} keyboardType="number-pad" placeholder={String(new Date().getFullYear())} /></Field>
            </View>
            <Field label="Specific genre" note="optional, e.g. “Cosmic Horror”"><Input value={form.genre} onChangeText={(v) => update('genre', v)} maxLength={60} /></Field>
          </View>
        ) : null}

        {step === 3 ? (
          <View style={{ gap: 14 }}>
            <Text style={cp.h1}>{stepInfo.title}</Text>
            <Text style={cp.lede}>A poster and a still. No text baked in. Skip them and we cut both from the film itself; swap them any time from Your work.</Text>
            <View style={s.art}>
              <Pressable style={[s.slotPoster, form.cutArtwork && s.slotOff]} onPress={() => pickArt('poster')}>
                {poster && !form.cutArtwork ? <Image source={{ uri: poster.uri }} style={s.slotImg} /> : <Text style={s.slotText}>POSTER{'\n'}2:3</Text>}
              </Pressable>
              <View style={{ flex: 1, gap: 10 }}>
                <Pressable style={[s.slotStill, form.cutArtwork && s.slotOff]} onPress={() => pickArt('still')}>
                  {still && !form.cutArtwork ? <Image source={{ uri: still.uri }} style={s.slotImg} /> : <Text style={s.slotText}>STILL · 16:9</Text>}
                </Pressable>
                <GhostButton on={form.cutArtwork} label={form.cutArtwork ? '✓ Cutting both from the film' : 'Cut both from the film for me'} onPress={() => update('cutArtwork', !form.cutArtwork)} style={{ alignSelf: 'stretch' }} />
              </View>
            </View>
            <Field label="Trailer" note="optional · 15–30 s">
              {trailer
                ? <ProgressCard video={{ ...trailer, bytes: null }} upload={trailerUploading ? upload : null} facts={[]} onRemove={() => setTrailer(null)} />
                : <GhostButton label={anyUploading ? 'Once the master has finished' : 'Pick a clip, or skip'} disabled={anyUploading} onPress={pickTrailer} style={{ alignSelf: 'stretch' }} />}
            </Field>
            <Text style={cp.help}>Captions (SRT or VTT) are added from Your work on the website once it&rsquo;s in; otherwise we caption what we can.</Text>

            <View style={s.options}>
              <Pressable onPress={() => setOptionsOpen((o) => !o)}><Text style={s.optionsSummary}>{optionsOpen ? '▾' : '▸'} More options <Text style={cp.help}>· the defaults are fine for most titles</Text></Text></Pressable>
              {optionsOpen ? (
                <View style={{ gap: 12, marginTop: 12 }}>
                  <View style={{ gap: 6 }}>
                    <Text style={s.optLabel}>Who can watch</Text>
                    <Text style={cp.help}>Free with ads, or Tapa + members only. The studio has the final say.</Text>
                    <Chips small options={[{ value: 'free', label: 'Free' }, { value: 'premium', label: 'Tapa +' }]} value={form.tier === 'premium' ? 'premium' : 'free'} onChange={(v) => update('tier', v)} />
                  </View>
                  <Field label="Ad breaks" note="MM:SS, comma-separated"><Input value={form.adBreaksText} onChangeText={(v) => update('adBreaksText', v)} /></Field>
                  <Switch on={form.channelOptIn} onPress={() => update('channelOptIn', !form.channelOptIn)} label="Let channels air it" hint="TapaTV can schedule it live, with ads." />
                  <Switch on={form.featured} onPress={() => update('featured', !form.featured)} label="Ask for the home page hero" hint="The studio decides what rotates." />
                  <Switch on={form.isOriginal} onPress={() => update('isOriginal', !form.isOriginal)} label="Tapa Original" hint="Made with or for the studio." />
                  <Field label="Funding link" note="optional"><Input value={form.fundingUrl} onChangeText={(v) => update('fundingUrl', v)} placeholder="https://" autoCapitalize="none" keyboardType="url" /></Field>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {error ? <Text style={cp.error}>{error}</Text> : null}

        <View style={s.foot}>
          {step < 3
            ? <PrimaryButton label={step === 1 ? 'Next: about it' : 'Next: artwork'} onPress={next} />
            : <PrimaryButton label="Submit for review" onPress={submit} busy={submitting} />}
          <View style={s.footRow}>
            {step > 1 ? <Text style={cp.link} onPress={() => { setError(null); setStep((x) => x - 1); }}>Back</Text> : <Text> </Text>}
            <Text style={[cp.note, { flex: 1 }]}>
              {step === 3 ? 'We watch it and reply, usually within a few days. You’ll see it under In review.' : saveState === 'saved' ? 'Saved as a draft.' : saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Draft not saved; check the connection.' : 'Saved as a draft as you go.'}
            </Text>
            {draftId || video ? <Text style={cp.link} onPress={discardDraft}>Discard</Text> : <Text> </Text>}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  headTitle: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  headStep: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.inkDim },
  progress: { height: 3, borderRadius: 2, backgroundColor: 'rgba(251,232,211,0.12)', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.olive },
  strip: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, backgroundColor: 'rgba(132,205,152,0.08)' },
  stripError: { backgroundColor: 'rgba(239,91,91,0.1)' },
  stripText: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkDim, flexShrink: 1 },
  two: { flexDirection: 'row', gap: 10 },
  newShow: { gap: 10, padding: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.25)' },
  art: { flexDirection: 'row', gap: 12 },
  slotPoster: { width: 110, height: 165, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.4)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.surface0 },
  slotStill: { flex: 1, minHeight: 90, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.4)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.surface0 },
  slotOff: { opacity: 0.45 },
  slotImg: { width: '100%', height: '100%' },
  slotText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1, color: colors.inkDim, textAlign: 'center', lineHeight: 14 },
  options: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(251,232,211,0.15)' },
  optionsSummary: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  optLabel: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  foot: { gap: 8, marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.1)' },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }
});
