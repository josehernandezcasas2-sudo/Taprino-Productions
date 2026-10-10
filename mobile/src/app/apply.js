import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import { API_BASE_URL, apiGet, apiPost } from '../lib/api';
import { colors, fonts } from '../lib/theme';

// Mirrors pages/apply.js, the creator onboarding page: what we take, the
// five-question rights check with its live verdict, the application, and
// what happens next. Everything that is copy-with-rules (the questions,
// the numbers, the option lists) comes from GET /api/apply so the two
// apps can't drift. Sending needs a signed-in account; the Account tab
// has the sign-in form. "You're in" points at Creator Studio on the
// website, since the app has no Creator Studio yet.

const PAPER = colors.oliveShadow;

// Fallbacks for an API that predates these lists (the questions always come).
const DEFAULT_STATUSES = [
  { value: 'finished', label: 'Finished and ready' },
  { value: 'festival', label: 'Finished, festival run ongoing' },
  { value: 'in_post', label: 'Still in post' }
];
const DEFAULT_GENRES = ['Comedy', 'Drama', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime', 'Other'];
const DEFAULT_TYPES = [
  { value: 'short', label: 'Short (under 40 min)' }, { value: 'film', label: 'Film (40 min+)' }, { value: 'series', label: 'Series' },
  { value: 'podcast', label: 'Podcast' }, { value: 'vertical', label: 'Vertical / Snippet' }
];
const DEFAULT_RATINGS = ['All ages', 'TV-14', 'TV-MA / R'];

const EMPTY_FORM = {
  name: '', portfolioUrl: '', title: '', logline: '', contentType: 'short', mainGenre: DEFAULT_GENRES[0],
  runtime: '', rating: DEFAULT_RATINGS[0], completionStatus: 'finished', mediaLink: '', mediaNotes: ''
};

// Same rules as lib/creatorRights.js rightsVerdict + rightsVerdictCopy.
function verdictFor(questions, answers) {
  const answered = questions.filter((q) => answers[q.id]).length;
  const blocked = questions.some((q) => q.block && answers[q.id] === 'no');
  const holds = questions.filter((q) => !q.block && answers[q.id] === 'no').map((q) => q.hold);
  const complete = answered === questions.length;
  let result;
  if (blocked) result = 'blocked';
  else if (!complete) result = 'incomplete';
  else if (holds.length) result = 'held';
  else result = 'clear';
  let copy;
  if (answered === 0) copy = { level: 'neutral', tag: 'Not started', title: 'Answer the five questions', body: 'Your answers stay on this screen. Nothing is sent until you apply.' };
  else if (result === 'blocked') copy = { level: 'bad', tag: 'Can’t accept', title: 'We can’t take this one', body: 'Only the rights holder can submit a film. If that’s a collaborator, ask them to apply, or apply together.' };
  else if (result === 'held') copy = { level: 'warn', tag: 'Will be held in review', title: 'You can apply, but it won’t go live yet', body: 'Your film would sit in review until we have the paperwork below. Send it with the application and it clears faster.' };
  else if (result === 'incomplete') copy = { level: 'neutral', tag: 'Looking good', title: `${answered} of ${questions.length} answered`, body: 'Keep going.' };
  else copy = { level: 'ok', tag: 'Clear to submit', title: 'Nothing here would hold it', body: 'Rights look clean. Review then comes down to picture, sound and fit.' };
  return { result, answered, holds, complete, copy };
}

const LEVEL_COLOR = { neutral: colors.inkDim, ok: colors.ok, warn: colors.warn, bad: colors.danger };
const LEVEL_BG = { neutral: 'rgba(202,181,158,0.06)', ok: 'rgba(132,205,152,0.08)', warn: 'rgba(224,134,60,0.08)', bad: 'rgba(214,124,81,0.08)' };

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const openSite = (path) => WebBrowser.openBrowserAsync(`${API_BASE_URL}${path}`);

export default function Apply() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const scrollRef = useRef(null);
  const sectionY = useRef({});
  const tokenRef = useRef(null);

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [answers, setAnswers] = useState({});
  const [attest, setAttest] = useState({ rights: false, check: false, terms: false });
  const [form, setForm] = useState(EMPTY_FORM);
  const [reapply, setReapply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null);

  const load = useCallback(async () => {
    // The guidelines and rights check are public, so never wait on Clerk
    // for them: load anonymously if it hasn't finished (or can't, as in
    // the web preview), and this reruns with a token once it has. Same
    // timeout guard as the Account screen so a stuck token can't hang us.
    tokenRef.current = isLoaded && isSignedIn
      ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
      : null;
    try {
      const data = await apiGet('/api/apply', tokenRef.current);
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState((s) => ({ loading: false, error: s.data ? null : err.message, data: s.data }));
    }
  }, [isLoaded, isSignedIn]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const data = state.data;
  const questions = data ? data.questions : [];
  const onboarding = (data && data.onboarding) || { shortMaxMinutes: 40, minResolution: '1080p', replyWindow: 'two weeks' };
  const types = (data && data.types) || DEFAULT_TYPES;
  const ratings = (data && data.ratings) || DEFAULT_RATINGS;
  const statuses = (data && data.statuses) || DEFAULT_STATUSES;
  const genres = (data && data.genres) || DEFAULT_GENRES;
  const app = data ? data.application : null;
  const creator = Boolean(data && data.isCreator);
  const signedIn = Boolean(isSignedIn && data && data.isSignedIn);

  const verdict = verdictFor(questions, answers);
  const attested = attest.rights && attest.check && attest.terms;
  const showForm = Boolean(data) && !creator && (!app || (app.status === 'declined' && reapply));

  let blocker = null;
  if (!verdict.complete) blocker = `Answer all five rights questions above (${verdict.answered} of 5 so far).`;
  else if (verdict.result === 'blocked') blocker = 'Only the rights holder can apply.';
  else if (!signedIn) blocker = 'Sign in (free) so we can attach this to your account.';
  else if (!attested) blocker = 'Tick the three rights statements.';

  function jumpTo(key) {
    const y = sectionY.current[key];
    if (scrollRef.current && y != null) scrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }
  const onLayoutFor = (key) => (e) => { sectionY.current[key] = e.nativeEvent.layout.y; };
  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  async function send() {
    if (blocker) { setSendError(blocker); return; }
    setBusy(true);
    setSendError(null);
    try {
      const res = await apiPost('/api/apply', { ...form, rightsAnswers: answers, rightsAttested: true }, tokenRef.current);
      setState((s) => ({ ...s, data: { ...s.data, application: res.application } }));
      setReapply(false);
      setForm(EMPTY_FORM);
      jumpTo('apply');
    } catch (err) {
      setSendError(err.message);
      // The server may have told us why (an application already open, or
      // Creator Studio already granted): refresh so the screen shows it.
      load();
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}><ActivityIndicator color={colors.brass} /></SafeAreaView>
    );
  }
  if (state.error && !data) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.errorText}>{state.error}</Text>
        <Pressable style={styles.btnSecondary} onPress={() => { setState({ loading: true, error: null, data: null }); load(); }}><Text style={styles.btnSecondaryText}>Try again</Text></Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView ref={scrollRef} style={styles.scrollView} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* hero */}
        <Text style={styles.eyebrow}>FOR CREATORS</Text>
        <Text style={styles.h1}>Put your film in front of an audience that funds what it loves.</Text>
        <Text style={styles.lede}>
          Studio Tapa TV is a small, curated platform. We don&rsquo;t run open uploads: read how it works below, check
          your rights, then apply. If it&rsquo;s a fit, you get a Creator Studio account and we handle encoding,
          captions and publishing.
        </Text>
        <View style={styles.ctaRow}>
          {creator ? (
            <Pressable style={styles.btnPrimary} onPress={() => openSite('/creator')}><Text style={styles.btnPrimaryText}>Open Creator Studio ↗</Text></Pressable>
          ) : (
            <Pressable style={styles.btnPrimary} onPress={() => jumpTo('apply')}><Text style={styles.btnPrimaryText}>{app ? 'See your application' : 'Start your application'}</Text></Pressable>
          )}
          <Pressable style={styles.btnSecondary} onPress={() => jumpTo('guidelines')}><Text style={styles.btnSecondaryText}>Read the guidelines first</Text></Pressable>
        </View>
        <View style={styles.perks}>
          <Perk title="You keep your copyright" body="Non-exclusive licence. Put the same work anywhere else." />
          <Perk title="Audience funding" body="Pitch Room lets viewers back your next project." />
          <Perk title="We do the heavy lifting" body="Encoding, captions, artwork sizing, publishing." />
          <Perk title="Reach beyond on-demand" body="Opt in and TapaTV can air your work live, with ads." />
        </View>

        {/* the four parts */}
        <View style={styles.steps}>
          {[['01', 'What we’re looking for', 'guidelines'], ['02', 'Rights check', 'rights'], ['03', 'Apply', 'apply'], ['04', 'What happens next', 'next']].map(([n, label, key]) => (
            <Pressable key={key} style={styles.step} onPress={() => jumpTo(key)}>
              <Text style={styles.stepNum}>{n}</Text>
              <Text style={styles.stepLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {/* 01 guidelines */}
        <View onLayout={onLayoutFor('guidelines')} style={styles.section}>
          <Text style={styles.eyebrow}>01 — WHAT WE&rsquo;RE LOOKING FOR</Text>
          <Text style={styles.h2}>Finished films and shorts, made by you.</Text>
          <Text style={styles.p}>
            We&rsquo;re a home for independent work that&rsquo;s done and ready to watch. Series, podcasts and vertical
            Snippets are welcome too, but this page is about films and shorts.
          </Text>
          <Card title="Shorts" body={`Under ${onboarding.shortMaxMinutes} minutes. Any genre. Student and first films welcome if they’re finished.`} />
          <Card title="Films" body={`${onboarding.shortMaxMinutes} minutes and up. Narrative or documentary. Festival runs are fine as long as you still hold streaming rights.`} />
          <Card title="What we pass on" body="Trailers, works in progress, re-uploads of other people’s work, compilations, and anything you can’t clear in the rights check below." />
          <View style={styles.card}>
            <Spec label="Master file" body={`Highest quality you have. MP4 or MOV, ${onboarding.minResolution} minimum, 4K welcome. We encode for streaming.`} />
            <Spec label="Picture & sound" body="16:9 for films and shorts (9:16 is for Snippets). Stereo mix, no burnt-in subtitles." />
            <Spec label="Captions & rating" body="An SRT if you have one; we caption what we can. Tell us the rating and any flashing-light warnings." />
            <Spec label="Artwork" body="A 2:3 poster and a 16:9 still, no text baked in. We can make these if you don’t have them." last />
          </View>
        </View>

        {/* 02 rights check */}
        <View onLayout={onLayoutFor('rights')} style={styles.section}>
          <Text style={styles.eyebrow}>02 — RIGHTS CHECK</Text>
          <Text style={styles.h2}>Five questions, so you know before you apply.</Text>
          <Text style={styles.p}>
            Every submission is reviewed before it goes live. Most things that hold a film in review are rights problems,
            and unlicensed music is the most common one. Answer honestly and this tells you where you&rsquo;d stand.
          </Text>
          <View style={[styles.card, { paddingVertical: 4 }]}>
            {questions.map((q, i) => (
              <View key={q.id} style={[styles.rightsRow, i === questions.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.rightsQRow}>
                  <Text style={styles.rightsNum}>{i + 1}</Text>
                  <Text style={styles.rightsQ}>{q.text}</Text>
                </View>
                <Text style={styles.rightsHint}>{q.hint}</Text>
                <View style={styles.choices}>
                  {['yes', 'no'].map((v) => {
                    const on = answers[q.id] === v;
                    return (
                      <Pressable
                        key={v}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        style={[styles.choice, on && styles.choiceOn]}
                        onPress={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                      >
                        <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
          <VerdictCard level={verdict.copy.level} tag={verdict.copy.tag} title={verdict.copy.title} body={verdict.copy.body}
            holds={verdict.result === 'held' ? verdict.holds : []} holdsLabel="What we’d ask for" />
          <Text style={styles.fine}>
            The full version of what you&rsquo;re promising us is in{' '}
            <Text style={styles.link} onPress={() => openSite('/terms#submit-work')}>Terms, section 5</Text>: you keep your copyright,
            we get a non-exclusive licence to stream and promote, and you&rsquo;re responsible for anything you upload without
            the rights to it.
          </Text>
        </View>

        {/* 03 apply */}
        <View onLayout={onLayoutFor('apply')} style={styles.section}>
          <Text style={styles.eyebrow}>03 — APPLY</Text>

          {creator ? (
            <VerdictCard level="ok" tag="Creator Studio" title="You already have Creator Studio." body="No need to apply. Submit films, shorts and everything else on the website, and track their review there.">
              <Pressable style={styles.btnPrimary} onPress={() => openSite('/creator')}><Text style={styles.btnPrimaryText}>Open Creator Studio ↗</Text></Pressable>
            </VerdictCard>
          ) : null}

          {!creator && app ? <ApplicationStatus app={app} onboarding={onboarding} reapplying={reapply} onReapply={() => setReapply(true)} /> : null}

          {showForm ? (
            <View style={styles.card}>
              {!app ? (
                <>
                  <Text style={styles.h2}>Tell us about the work.</Text>
                  <Text style={[styles.p, { marginBottom: 14 }]}>No upload here. Link to wherever the files already live. You&rsquo;ll need a free Studio Tapa TV account so we can attach the application to you and show you its status.</Text>
                </>
              ) : null}

              <View style={[styles.signinStrip, signedIn && styles.signinStripOn]}>
                {signedIn ? (
                  <Text style={styles.signinText}>Signed in. This application will be attached to your account.</Text>
                ) : (
                  <>
                    <Text style={styles.signinText}>You&rsquo;ll need a free account to send this.</Text>
                    <Pressable style={styles.btnSmall} onPress={() => router.push('/account')}><Text style={styles.btnSmallText}>Sign in on Account</Text></Pressable>
                  </>
                )}
              </View>

              <Text style={styles.eyebrow}>ABOUT YOU</Text>
              <Field label="Your name"><TextInput style={styles.input} value={form.name} onChangeText={(v) => update('name', v)} placeholder="As you want it credited" placeholderTextColor={colors.inkFaint} /></Field>
              <Field label="Portfolio or reel" note="optional"><TextInput style={styles.input} value={form.portfolioUrl} onChangeText={(v) => update('portfolioUrl', v)} placeholder="https://" placeholderTextColor={colors.inkFaint} autoCapitalize="none" keyboardType="url" /></Field>

              <Text style={styles.eyebrow}>THE WORK</Text>
              <Field label="Title"><TextInput style={styles.input} value={form.title} onChangeText={(v) => update('title', v)} /></Field>
              <Field label="Type"><Chips options={types} value={form.contentType} onChange={(v) => update('contentType', v)} /></Field>
              <Field label="Logline, one sentence"><TextInput style={styles.input} value={form.logline} onChangeText={(v) => update('logline', v)} maxLength={200} /></Field>
              <Field label="Genre"><Chips options={genres.map((g) => ({ value: g, label: g }))} value={form.mainGenre} onChange={(v) => update('mainGenre', v)} /></Field>
              <Field label="Runtime"><TextInput style={styles.input} value={form.runtime} onChangeText={(v) => update('runtime', v)} placeholder="e.g. 12 min, or 6 × 20 min" placeholderTextColor={colors.inkFaint} /></Field>
              <Field label="Rating you’d give it"><Chips options={ratings.map((r) => ({ value: r, label: r }))} value={form.rating} onChange={(v) => update('rating', v)} /></Field>
              <Field label="Where it stands"><Chips options={statuses} value={form.completionStatus} onChange={(v) => update('completionStatus', v)} /></Field>
              <Field label="Link to the files"><TextInput style={styles.input} value={form.mediaLink} onChangeText={(v) => update('mediaLink', v)} placeholder="Google Drive, Dropbox, WeTransfer, Frame.io…" placeholderTextColor={colors.inkFaint} autoCapitalize="none" keyboardType="url" /></Field>
              <Field label="Anything we should know" note="optional"><TextInput style={[styles.input, styles.textarea]} value={form.mediaNotes} onChangeText={(v) => update('mediaNotes', v)} placeholder="Where it's screened, who made it, link password, whether captions exist." placeholderTextColor={colors.inkFaint} multiline /></Field>

              <Text style={styles.eyebrow}>RIGHTS</Text>
              <Check on={attest.rights} onPress={() => setAttest((a) => ({ ...a, rights: !a.rights }))}>I made this, or I hold the rights to distribute it, and everything in it (footage, music, fonts, people, locations) is mine or licensed.</Check>
              <Check on={attest.check} onPress={() => setAttest((a) => ({ ...a, check: !a.check }))}>I&rsquo;ve done the rights check above and I&rsquo;ll send licences for anything it flagged.</Check>
              <Check on={attest.terms} onPress={() => setAttest((a) => ({ ...a, terms: !a.terms }))}>
                I&rsquo;ve read <Text style={styles.link} onPress={() => openSite('/terms#submit-work')}>Terms, section 5</Text>: I keep my copyright and grant a non-exclusive licence to stream and promote.
              </Check>

              {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
              <Pressable style={[styles.btnPrimary, { alignSelf: 'stretch', marginTop: 6 }, (busy || blocker) && styles.btnDisabled]} disabled={busy || Boolean(blocker)} onPress={send}>
                {busy ? <ActivityIndicator color={PAPER} /> : <Text style={styles.btnPrimaryText}>Send application</Text>}
              </Pressable>
              <Text style={styles.why}>{blocker || `We read everything. Expect a reply within ${onboarding.replyWindow}.`}</Text>
            </View>
          ) : null}
        </View>

        {/* 04 what happens next */}
        <View onLayout={onLayoutFor('next')} style={styles.section}>
          <Text style={styles.eyebrow}>04 — WHAT HAPPENS NEXT</Text>
          <Text style={styles.h2}>From application to live, in four steps.</Text>
          <Card step="Step 1" title="We read it" body={`Within ${onboarding.replyWindow}. Come back here any time to see your status.`} plain />
          <Card step="Step 2" title="You’re in" body="Accepted applicants get Creator Studio on their account the same moment, plus an email." plain />
          <Card step="Step 3" title="You submit the film" body="Upload the master in Creator Studio on the website with artwork, rating and captions. It lands in our review queue." plain />
          <Card step="Step 4" title="Review, then live" body="We check picture, sound and rights. Approved titles go live; anything held gets a reason you can fix." plain />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ApplicationStatus({ app, onboarding, reapplying, onReapply }) {
  if (app.isOpen) {
    return (
      <VerdictCard level="warn" tag="Under review" title={app.title}
        body={`Sent ${fmtDate(app.createdAt)}. We aim to reply within ${onboarding.replyWindow}, and we’ll email you when there’s news.`}
        holds={app.holds || []} holdsLabel="Still to send us">
        {app.holds && app.holds.length ? <Text style={styles.cardBody}>Reply to your confirmation email with these.</Text> : null}
      </VerdictCard>
    );
  }
  if (app.status === 'accepted') {
    return (
      <VerdictCard level="ok" tag="You’re in" title={app.title}
        body={`Accepted${app.reviewedAt ? ` ${fmtDate(app.reviewedAt)}` : ''}. Creator Studio is on your account: upload the master, artwork, rating and captions on the website and it goes into our review queue.`}>
        {app.decisionNote ? <Text style={styles.cardBody}><Text style={styles.strong}>A note from us: </Text>{app.decisionNote}</Text> : null}
        <Pressable style={styles.btnPrimary} onPress={() => openSite('/creator')}><Text style={styles.btnPrimaryText}>Open Creator Studio ↗</Text></Pressable>
      </VerdictCard>
    );
  }
  return (
    <VerdictCard level="neutral" tag="Not this time" title={app.title}
      body={`Not a fit for Studio Tapa TV right now${app.reviewedAt ? ` (${fmtDate(app.reviewedAt)})` : ''}.`}>
      {app.decisionNote ? <Text style={styles.cardBody}><Text style={styles.strong}>A note from us: </Text>{app.decisionNote}</Text> : null}
      {!reapplying ? <Pressable style={styles.btnSecondary} onPress={onReapply}><Text style={styles.btnSecondaryText}>Apply again with new work</Text></Pressable> : null}
    </VerdictCard>
  );
}

function VerdictCard({ level, tag, title, body, holds = [], holdsLabel, children }) {
  const color = LEVEL_COLOR[level] || colors.inkDim;
  return (
    <View style={[styles.verdict, { borderColor: color, backgroundColor: LEVEL_BG[level] || LEVEL_BG.neutral }]}>
      <View style={[styles.tag, { backgroundColor: color }]}><Text style={styles.tagText}>{tag}</Text></View>
      <Text style={styles.verdictTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
      {holds.length > 0 ? (
        <>
          <Text style={styles.holdsLabel}>{holdsLabel}</Text>
          {holds.map((h) => <Text key={h} style={styles.hold}>• {h}</Text>)}
        </>
      ) : null}
      {children}
    </View>
  );
}

function Perk({ title, body }) {
  return (
    <View style={styles.perk}>
      <Text style={styles.perkTitle}>{title}</Text>
      <Text style={styles.perkBody}>{body}</Text>
    </View>
  );
}

function Card({ title, body, step, plain }) {
  return (
    <View style={styles.card}>
      {step ? <Text style={styles.stepTag}>{step.toUpperCase()}</Text> : null}
      <Text style={[styles.cardTitle, plain && { color: colors.ink }]}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function Spec({ label, body, last }) {
  return (
    <View style={{ marginBottom: last ? 0 : 14 }}>
      <Text style={styles.specLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function Field({ label, note, children }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label.toUpperCase()}{note ? <Text style={styles.labelNote}>  {note}</Text> : null}</Text>
      {children}
    </View>
  );
}

function Chips({ options, value, onChange }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Check({ on, onPress, children }) {
  return (
    <Pressable style={styles.check} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[styles.checkBox, on && styles.checkBoxOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <Text style={styles.checkText}>{children}</Text>
    </Pressable>
  );
}

// From the .onboard-* / .rights-* rules in styles/globals.css at phone width.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  scrollView: { flex: 1 },
  scroll: { padding: 19, paddingBottom: 120 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.olive, marginBottom: 8 },
  h1: { fontFamily: fonts.displayBold, fontSize: 32, lineHeight: 34, color: colors.ink, marginBottom: 12 },
  h2: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 28, color: colors.ink, marginBottom: 8 },
  lede: { fontFamily: fonts.body, fontSize: 16, lineHeight: 25, color: colors.inkDim, marginBottom: 16 },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 24, color: colors.inkDim, marginBottom: 10 },
  fine: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.inkDim, marginTop: 12 },
  link: { color: colors.olive, textDecorationLine: 'underline' },
  strong: { fontFamily: fonts.bodyBold, color: colors.ink },

  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  btnPrimary: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center', alignSelf: 'flex-start' },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14, color: PAPER },
  btnDisabled: { opacity: 0.45 },
  btnSecondary: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 11, paddingHorizontal: 20, alignSelf: 'flex-start' },
  btnSecondaryText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  btnSmall: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  btnSmallText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },

  perks: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  perk: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, padding: 14 },
  perkTitle: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.mint, marginBottom: 4 },
  perkBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim },

  steps: { marginTop: 30, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(251,232,211,0.1)' },
  step: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  stepNum: { fontFamily: fonts.mono, fontSize: 10, color: colors.olive },
  stepLabel: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },

  section: { paddingTop: 40 },
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, padding: 18, marginTop: 12 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.brass, marginBottom: 5 },
  cardBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim },
  specLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: colors.inkDim, marginBottom: 4 },
  stepTag: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: colors.olive, marginBottom: 6 },

  rightsRow: { paddingVertical: 14, borderBottomWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  rightsQRow: { flexDirection: 'row', gap: 9, alignItems: 'baseline' },
  rightsNum: { fontFamily: fonts.mono, fontSize: 10, color: colors.olive },
  rightsQ: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 15, lineHeight: 20, color: colors.ink },
  rightsHint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim, marginTop: 3, paddingLeft: 19 },
  choices: { flexDirection: 'row', gap: 8, marginTop: 10, paddingLeft: 19 },
  choice: { minWidth: 64, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
  choiceOn: { backgroundColor: colors.olive, borderColor: colors.olive },
  choiceText: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink },
  choiceTextOn: { color: PAPER },

  verdict: { borderWidth: 1, borderRadius: 4, padding: 18, marginTop: 14, gap: 6 },
  tag: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  tagText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.6, color: colors.surface0 },
  verdictTitle: { fontFamily: fonts.displayBold, fontSize: 19, lineHeight: 24, color: colors.ink, marginTop: 4 },
  holdsLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: colors.inkDim, marginTop: 6 },
  hold: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink },

  signinStrip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 12, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', backgroundColor: 'rgba(251,232,211,0.04)', marginBottom: 18 },
  signinStripOn: { borderColor: 'rgba(74,168,162,0.35)', backgroundColor: 'rgba(74,168,162,0.08)' },
  signinText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, flexShrink: 1 },
  label: { fontFamily: fonts.mono, fontSize: 10.4, letterSpacing: 0.6, color: colors.inkDim, marginBottom: 6 },
  labelNote: { textTransform: 'none', letterSpacing: 0, opacity: 0.7 },
  input: { backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', borderRadius: 4, paddingVertical: 10, paddingHorizontal: 13, fontFamily: fonts.body, fontSize: 14.4, color: colors.ink },
  textarea: { minHeight: 84, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)' },
  chipOn: { backgroundColor: 'rgba(231,162,85,0.16)', borderColor: colors.olive },
  chipText: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  chipTextOn: { color: colors.olive },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  checkBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(251,232,211,0.3)', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkBoxOn: { backgroundColor: colors.olive, borderColor: colors.olive },
  checkMark: { color: PAPER, fontSize: 13, fontFamily: fonts.displayBold },
  checkText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink },
  why: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: colors.inkDim, marginTop: 10 },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.danger, marginBottom: 8, textAlign: 'center' }
});
