import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost, freshToken } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import PayoutsCard from '../../components/PayoutsCard';

// Your pitches (pages/creator/pitch/dashboard.js on the web): the Payouts
// card (components/PayoutsCard.js), every project you've submitted with
// its status, what each has earned, and a quick "post an update". Data
// from /api/creator/pitches.
const PAPER = '#241a05';

const money = (cents) => `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const STATUS = { pending: '⏳ Pending review', approved: '● Live', rejected: '✕ Not approved' };

function Earnings({ pitch, earnings }) {
  const e = earnings || { raisedCents: 0, yourShareCents: 0, backers: 0, refundedCents: 0, refundedCount: 0, recent: [] };
  const cut = Number(pitch.platform_cut_percent || 0);
  return (
    <View style={styles.earn}>
      <View style={styles.earnStats}>
        <View><Text style={styles.earnNum}>{money(e.raisedCents)}</Text><Text style={styles.earnLabel}>raised{pitch.funding_goal ? ` of $${Number(pitch.funding_goal).toLocaleString()}` : ''}</Text></View>
        <View><Text style={styles.earnNum}>{e.backers}</Text><Text style={styles.earnLabel}>backer{e.backers === 1 ? '' : 's'}</Text></View>
        <View><Text style={[styles.earnNum, { color: colors.brass }]}>{money(e.yourShareCents)}</Text><Text style={styles.earnLabel}>your share after {cut}%</Text></View>
        {e.refundedCount > 0 ? <View><Text style={styles.earnNum}>{money(e.refundedCents)}</Text><Text style={styles.earnLabel}>refunded ({e.refundedCount})</Text></View> : null}
        {e.disputedCount > 0 ? <View><Text style={styles.earnNum}>{money(e.disputedCents)}</Text><Text style={styles.earnLabel}>disputed by a bank ({e.disputedCount})</Text></View> : null}
      </View>
      {e.recent.length > 0 ? e.recent.map((r) => (
        <View key={r.id} style={styles.earnRow}>
          <Text style={[styles.earnRowText, r.status !== 'completed' && styles.dim]} numberOfLines={1}>{r.backerName}</Text>
          <Text style={[styles.earnRowText, styles.dim]}>{fmtDate(r.at)}</Text>
          <Text style={[styles.earnRowText, r.status !== 'completed' && styles.dim]}>{r.status === 'refunded' ? `${money(r.amountCents)} refunded` : r.status === 'disputed' ? `${money(r.amountCents)} disputed · share taken back` : `${money(r.amountCents)} · ${money(r.yourShareCents)} to you`}</Text>
        </View>
      )) : (
        <Text style={styles.cardBody}>{pitch.funding_enabled ? 'No backings yet — share your project page to get the first one.' : 'Backing is off for this project.'}</Text>
      )}
    </View>
  );
}

function UpdateForm({ pitchId, getToken, onPosted }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  async function submit() {
    if (!title.trim() || !body.trim()) { setError('A title and a few words are required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiPost('/api/creator/pitch-update', { pitchId, title: title.trim(), body: body.trim() }, await freshToken(getToken));
      setTitle('');
      setBody('');
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <View style={{ marginTop: 10 }}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput style={styles.input} placeholder="Update title" placeholderTextColor={colors.inkFaint} value={title} onChangeText={setTitle} />
      <TextInput style={[styles.input, styles.textarea]} placeholder="What's new?" placeholderTextColor={colors.inkFaint} value={body} onChangeText={setBody} multiline />
      <Pressable style={[styles.btnSecondary, saving && styles.btnDisabled]} disabled={saving} onPress={submit}>
        <Text style={styles.btnSecondaryText}>{saving ? 'Posting…' : 'Post update'}</Text>
      </Pressable>
    </View>
  );
}

export default function YourPitches() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [openUpdateFor, setOpenUpdateFor] = useState(null);
  const [postedFlash, setPostedFlash] = useState(null);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) { setState({ loading: false, error: null, data: null }); return; }
    try {
      const data = await apiGet('/api/creator/pitches', await freshToken(getToken));
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }, [isLoaded, isSignedIn, getToken]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!isLoaded || state.loading) {
    return <SafeAreaView style={styles.center} edges={['top', 'bottom']}><TopNav /><ActivityIndicator color={colors.brass} /></SafeAreaView>;
  }
  if (!isSignedIn) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <TopNav />
        <Text style={styles.p}>Sign in to see your pitches.</Text>
        <Pressable style={styles.btnPrimary} onPress={() => router.push('/account')}><Text style={styles.btnPrimaryText}>Sign in</Text></Pressable>
      </SafeAreaView>
    );
  }
  if (state.error) {
    const needsRole = /Creator access/i.test(state.error);
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <TopNav />
        <Text style={styles.p}>{needsRole ? 'Pitch Room projects are for creators. Apply once and your account unlocks it.' : state.error}</Text>
        <Pressable style={styles.btnPrimary} onPress={() => (needsRole ? router.push('/apply') : load())}><Text style={styles.btnPrimaryText}>{needsRole ? 'Apply to be a creator' : 'Try again'}</Text></Pressable>
      </SafeAreaView>
    );
  }

  const { pitches, earnings } = state.data;
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>Pitch Room</Text>
        <Text style={styles.h1}>Your pitches</Text>
        <Text style={styles.lede}>Track status, post progress updates, and see your live project pages.</Text>
        <Pressable style={styles.btnPrimary} onPress={() => router.push('/creator/pitch-new')}>
          <Text style={styles.btnPrimaryText}>+ Submit a project</Text>
        </Pressable>

        <View style={{ marginTop: 14 }}><PayoutsCard showEarningsLink={false} /></View>

        {pitches.length === 0 ? (
          <Text style={[styles.p, { marginTop: 18 }]}>Nothing submitted yet.</Text>
        ) : pitches.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{p.title}</Text>
                <Text style={styles.status}>{STATUS[p.status] || p.status}</Text>
              </View>
              {p.status === 'approved' ? (
                <Pressable style={styles.btnSmall} onPress={() => router.push(`/pitches/${p.id}`)}>
                  <Text style={styles.btnSmallText}>View live page →</Text>
                </Pressable>
              ) : null}
            </View>
            {p.logline ? <Text style={styles.cardBody}>{p.logline}</Text> : null}
            {p.status === 'approved' && (p.funding_enabled || earnings[p.id]) ? <Earnings pitch={p} earnings={earnings[p.id]} /> : null}
            {p.status === 'approved' ? (
              openUpdateFor === p.id ? (
                <UpdateForm pitchId={p.id} getToken={getToken} onPosted={() => { setOpenUpdateFor(null); setPostedFlash(p.id); }} />
              ) : (
                <Pressable style={[styles.btnSmall, { marginTop: 10 }]} onPress={() => setOpenUpdateFor(p.id)}>
                  <Text style={styles.btnSmallText}>+ Post an update</Text>
                </Pressable>
              )
            ) : null}
            {postedFlash === p.id ? <Text style={styles.flash}>Update posted — everyone who saved this project has been notified.</Text> : null}
            {p.status === 'pending' ? <Text style={styles.fine}>Studio Tapa hasn't reviewed this yet — check back soon.</Text> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  scrollView: { flex: 1 },
  scroll: { padding: 19, paddingBottom: 120 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.olive, marginBottom: 8 },
  h1: { fontFamily: fonts.displayBold, fontSize: 32, lineHeight: 34, color: colors.ink, marginBottom: 8 },
  lede: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.inkDim, marginBottom: 14 },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 24, color: colors.inkDim, textAlign: 'center' },
  fine: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim, marginTop: 10 },
  flash: { fontFamily: fonts.body, fontSize: 13, color: colors.brass, marginTop: 8 },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginBottom: 8 },
  dim: { color: colors.inkDim },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  btnPrimary: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center', alignSelf: 'flex-start' },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14, color: PAPER },
  btnSecondary: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 11, paddingHorizontal: 20, alignSelf: 'flex-start' },
  btnSecondaryText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  btnSmall: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, alignSelf: 'flex-start' },
  btnSmallText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  btnDisabled: { opacity: 0.45 },
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, padding: 18, marginTop: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink, marginBottom: 4 },
  cardBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim },
  status: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkDim },
  input: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline, borderRadius: 6, color: colors.ink, fontFamily: fonts.body, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  earn: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  earnStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginBottom: 8 },
  earnNum: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink },
  earnLabel: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkDim, marginTop: 2 },
  earnRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 5, borderBottomWidth: 1, borderColor: 'rgba(251,232,211,0.06)' },
  earnRowText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink }
});
