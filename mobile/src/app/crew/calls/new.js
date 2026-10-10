import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import { crew, Chip, PlaceBox } from '../../../components/CrewBits';

// Post a call (pages/crew/calls/new on the web). Everyone whose working
// card lists the role and whose place + travel radius reaches it gets told.
const PAY = { paid: 'Paid', union: 'Union', deferred: 'Deferred', unpaid: 'Unpaid', other: 'Other' };
const PAY_HINT = { paid: '$350/day', union: 'SAG-AFTRA micro-budget, IATSE scale…', deferred: 'deferred + credit, points…', unpaid: 'meals + credit', other: 'say what the deal is' };

export default function PostCall() {
  const router = useRouter();
  const { project: preselect } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [roles, setRoles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', role: '', spots: '1', payType: 'paid', payNote: '', startsOn: '', endsOn: '', remote: false, place: null, project: preselect ? String(preselect) : '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      tokenRef.current = signedIn ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]) : null;
      try {
        const o = await apiGet('/api/crew/options');
        if (alive) { setRoles(o.roles); setForm((f) => ({ ...f, role: f.role || o.roles[0] })); }
      } catch (err) { /* keep going */ }
      if (tokenRef.current) {
        try {
          const [p, card] = await Promise.all([apiGet('/api/crew/my-projects', tokenRef.current), apiGet('/api/crew/card', tokenRef.current)]);
          if (alive) {
            setProjects(p.projects || []);
            if (card.card && card.card.place) setForm((f) => ({ ...f, place: f.place || card.card.place }));
          }
        } catch (err) { /* optional */ }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [signedIn])); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const [type, id] = form.project ? form.project.split(':') : [null, null];
      const data = await apiPost('/api/crew/calls', { ...form, project: type ? { type, id } : null }, tokenRef.current);
      router.replace(`/crew/calls/${data.call.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push('/crew/calls')} hitSlop={8}><Text style={crew.mono}>‹ Calls</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Crew Call</Text>
        <Text style={crew.h1}>Post a call</Text>

        {!signedIn ? (
          <View style={crew.panel}>
            <Text style={crew.lead}>Say who you need, when, where and how it pays. Everyone whose working card matches gets told.</Text>
            <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in or create an account</Text></Pressable>
          </View>
        ) : loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : (
          <>
            <View style={crew.panel}>
              <Text style={crew.label}>Title</Text>
              <TextInput style={crew.input} value={form.title} onChangeText={(v) => set({ title: v })} placeholder="Gaffer for two nights" placeholderTextColor={colors.inkFaint} maxLength={80} />
              <Text style={[crew.label, { marginTop: 6 }]}>Role needed</Text>
              <View style={crew.chips}>{roles.map((r) => <Chip key={r} label={r} on={form.role === r} onPress={() => set({ role: r })} />)}</View>
              <Text style={[crew.label, { marginTop: 6 }]}>Spots</Text>
              <TextInput style={[crew.input, { width: 90 }]} value={form.spots} onChangeText={(v) => set({ spots: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.inkFaint} />
            </View>

            <View style={crew.panel}>
              <Text style={crew.label}>Pay</Text>
              <View style={crew.chips}>{Object.entries(PAY).map(([k, v]) => <Chip key={k} label={v} on={form.payType === k} onPress={() => set({ payType: k })} />)}</View>
              <Text style={[crew.label, { marginTop: 6 }]}>Pay details</Text>
              <TextInput style={crew.input} value={form.payNote} onChangeText={(v) => set({ payNote: v })} placeholder={PAY_HINT[form.payType]} placeholderTextColor={colors.inkFaint} maxLength={120} />
            </View>

            <View style={crew.panel}>
              <Text style={crew.label}>When (YYYY-MM-DD)</Text>
              <View style={crew.row}>
                <TextInput style={[crew.input, { flex: 1 }]} value={form.startsOn} onChangeText={(v) => set({ startsOn: v })} placeholder="First day" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
                <TextInput style={[crew.input, { flex: 1 }]} value={form.endsOn} onChangeText={(v) => set({ endsOn: v })} placeholder="Last day" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
              </View>
              <Text style={[crew.label, { marginTop: 6 }]}>Where</Text>
              {!form.remote ? <PlaceBox value={form.place} onChange={(p) => set({ place: p })} placeholder="City (pick from the suggestions)" /> : null}
              <View style={[crew.row, { marginTop: 4 }]}>
                <Switch value={form.remote} onValueChange={(v) => set({ remote: v })} trackColor={{ true: colors.brass }} />
                <Text style={[crew.rowText, { flex: 1 }]}>Remote — anyone with the role, anywhere</Text>
              </View>
            </View>

            {projects.length > 0 ? (
              <View style={crew.panel}>
                <Text style={crew.label}>Project (optional)</Text>
                <View style={crew.chips}>
                  <Chip label="Independent" on={!form.project} onPress={() => set({ project: '' })} />
                  {projects.map((p) => <Chip key={p.value} label={p.label} on={form.project === p.value} onPress={() => set({ project: p.value })} />)}
                </View>
                <Text style={crew.mono}>Linking a project puts "Crew needed" on its page.</Text>
              </View>
            ) : null}

            <View style={crew.panel}>
              <Text style={crew.label}>Details</Text>
              <TextInput style={[crew.input, { minHeight: 110, textAlignVertical: 'top' }]} value={form.details} onChangeText={(v) => set({ details: v })} placeholder="What the days look like, what you have already, what they should bring." placeholderTextColor={colors.inkFaint} multiline maxLength={2000} />
            </View>

            {error ? <Text style={crew.error}>{error}</Text> : null}
            <View style={crew.row}>
              <Pressable style={[crew.btn, crew.btnPrimary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}><Text style={[crew.btnText, crew.btnPrimaryText]}>{busy ? 'Posting…' : 'Post the call'}</Text></Pressable>
              <Pressable style={[crew.btn, crew.btnGhost]} onPress={() => router.back()}><Text style={[crew.btnText, { color: colors.inkDim }]}>Cancel</Text></Pressable>
            </View>
            <Text style={[crew.muted, { marginTop: 12 }]}>Everyone whose card lists {form.role || 'the role'} within their travel radius of {form.remote ? 'anywhere' : form.place ? form.place.label : 'the place you pick'} gets a notification and an email. After the last day you'll be asked who worked it — that's what builds people's track record.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({});
