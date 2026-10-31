import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiDelete, apiGet, freshToken } from '../../lib/api';
import { SUBMIT_TYPES, bytesLabel } from '../../lib/submitRules';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import { cp, PrimaryButton, SecondaryButton } from '../../components/CreatorBits';

// Creator Studio's hub (mirrors pages/creator.js, 2026-10-31): Submit a
// title, the types under it, the drafts in flight, and the three piles
// (In review / Needs you / Live) from /api/creator/my-submissions.
const PILE_LIMIT = 4;

function needsYou(s) {
  if (s.status === 'rejected') return s.rejectionReason ? `Not this time: ${s.rejectionReason}` : 'Not this time';
  if (s.deletionRequested) return null;
  if (s.held && s.status === 'approved') return 'Pulled while an admin looks at it';
  if (s.missingArtwork) return 'Missing a poster or a still';
  if (s.status === 'approved' && s.contentType !== 'podcast' && !s.captionsUrl) return 'No captions yet';
  if (s.cloudflareState === 'error') return 'The video failed to process';
  if (s.cloudflareState === 'pendingupload') return 'The upload never finished';
  return null;
}

function ago(iso) {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export default function CreatorStudio() {
  const router = useRouter();
  const { submitted } = useLocalSearchParams();
  const { isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, forbidden: false, subs: [], drafts: [] });

  const load = useCallback(async () => {
    if (!isSignedIn) { setState({ loading: false, error: null, forbidden: true, subs: [], drafts: [] }); return; }
    try {
      const token = await freshToken(getToken);
      const [work, drafts] = await Promise.all([apiGet('/api/creator/my-submissions', token), apiGet('/api/creator/drafts', token).catch(() => ({ drafts: [] }))]);
      setState({ loading: false, error: null, forbidden: false, subs: work.submissions || [], drafts: drafts.drafts || [] });
    } catch (err) {
      const forbidden = /creator access required/i.test(err.message || '');
      setState({ loading: false, error: forbidden ? null : err.message, forbidden, subs: [], drafts: [] });
    }
  }, [isSignedIn]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function discardDraft(id) {
    Alert.alert('Discard this draft?', 'Its uploaded file is deleted too.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => {
        try {
          await apiDelete('/api/creator/drafts', { id }, await freshToken(getToken));
          setState((s) => ({ ...s, drafts: s.drafts.filter((d) => d.id !== id) }));
        } catch (err) {
          Alert.alert('Could not discard it', err.message);
        }
      } }
    ]);
  }

  const inReview = state.subs.filter((s) => s.status === 'pending');
  const needs = state.subs.map((s) => ({ s, why: needsYou(s) })).filter((x) => x.why);
  const live = state.subs.filter((s) => s.status === 'approved' && !s.held).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

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
              <View style={s.flash}><Text style={cp.p}><Text style={cp.strong}>“{submitted}” is in.</Text> It sits under In review until we&rsquo;ve watched it.</Text></View>
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

            {state.drafts.length > 0 ? (
              <Pile k="Drafts" count={state.drafts.length} dashed>
                {state.drafts.map((d) => (
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

            <Pile k="In review" count={inReview.length} empty="Nothing waiting on us." onAll={() => router.push('/account/my-work')}>
              {inReview.slice(0, PILE_LIMIT).map((x) => <Row key={x.id} s={x} meta={`${x.seriesName ? `${x.seriesName} · ` : ''}sent ${ago(x.createdAt)}`} onPress={() => router.push('/account/my-work')} />)}
            </Pile>
            <Pile k="Needs you" count={needs.length} empty="Nothing to fix." tone="warn" onAll={() => router.push('/account/my-work')}>
              {needs.slice(0, PILE_LIMIT).map(({ s: x, why }) => <Row key={x.id} s={x} meta={why} onPress={() => router.push('/account/my-work')} />)}
            </Pile>
            <Pile k="Live" count={live.length} empty="Nothing live yet. The first one is the hardest." tone="ok" onAll={() => router.push('/account/my-work')}>
              {live.slice(0, PILE_LIMIT).map((x) => <Row key={x.id} s={x} meta={`${x.seriesName ? `${x.seriesName} · ` : ''}${x.viewCount} view${x.viewCount === 1 ? '' : 's'}`} onPress={() => router.push(`/episode/${x.id}`)} />)}
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

function Pile({ k, count, empty, tone, dashed, onAll, children }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <View style={[s.pile, tone === 'warn' && s.pileWarn, tone === 'ok' && s.pileOk, dashed && s.pileDashed]}>
      <View style={s.pileHead}><Text style={cp.cardK}>{k}</Text><Text style={s.count}>{count}</Text></View>
      {rows.length === 0 ? <Text style={cp.help}>{empty}</Text> : rows}
      {count > PILE_LIMIT && onAll ? <Text style={cp.link} onPress={onAll}>All {count} in Your work</Text> : null}
    </View>
  );
}

function Row({ s: x, meta, onPress }) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      {x.thumbnail || x.poster ? <SmartImage uri={x.thumbnail || x.poster} style={s.thumb} resizeMode="cover" /> : <View style={s.thumb} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{x.title}</Text>
        <Text style={s.rowMeta} numberOfLines={2}>{meta}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  flash: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(132,205,152,0.5)', backgroundColor: 'rgba(132,205,152,0.1)' },
  submit: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(242,193,78,0.4)', backgroundColor: 'rgba(242,193,78,0.08)', gap: 10 },
  pile: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(251,232,211,0.12)', backgroundColor: colors.surface1, gap: 8 },
  pileWarn: { borderColor: 'rgba(255,140,66,0.45)' },
  pileOk: { borderColor: 'rgba(132,205,152,0.4)' },
  pileDashed: { borderStyle: 'dashed' },
  pileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.08)' },
  thumb: { width: 56, height: 34, borderRadius: 4, backgroundColor: colors.surface2 },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  rowMeta: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkDim },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10 },
  linkText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, color: colors.inkDim }
});
