import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { crew, Chip, PlaceBox, GearRows, CreditRows, GEAR_FLAGS } from '../../components/CrewBits';

// Your Crew Call working card (pages/crew/card.js on the web): roles,
// where you're based and how far you'll go, availability, gear, outside
// credits, rate. Loads and saves through /api/crew/card.
const EMPTY = {
  roles: [], place: null, travelMiles: '25', remoteOk: false, availability: 'open', bookedUntil: '',
  rateMin: '', rateMax: '', languages: [], listed: true, gear: [], credits: []
};
const FALLBACK_OPTIONS = { roles: [], gearCategories: [], maxRoles: 6, maxTravelMiles: 500 };

function fromCard(card) {
  if (!card) return EMPTY;
  return {
    roles: card.roles,
    place: card.place,
    travelMiles: String(card.travelMiles),
    remoteOk: card.remoteOk,
    availability: card.availability,
    bookedUntil: card.bookedUntil || '',
    rateMin: card.rateMin == null ? '' : String(card.rateMin),
    rateMax: card.rateMax == null ? '' : String(card.rateMax),
    languages: card.languages,
    listed: card.listed,
    gear: card.gear.map((g) => ({ category: g.category, name: g.name, flag: g.flag })),
    credits: card.credits.map((c) => ({ title: c.title, role: c.role || '', year: c.year ? String(c.year) : '' }))
  };
}

export default function CrewCardScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const tokenRef = useRef(null);

  const [state, setState] = useState({ loading: true, error: null, card: null, creditedWork: [], options: FALLBACK_OPTIONS });
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [lang, setLang] = useState('');
  const [gearDraft, setGearDraft] = useState({ category: '', name: '', flag: 'brings' });
  const [creditDraft, setCreditDraft] = useState({ title: '', role: '', year: '' });

  // Same rule as the Apply screen: never wait on Clerk (it can't finish
  // in the web preview) — treat "not loaded" as signed out and this
  // reruns with a token once it has.
  const signedIn = Boolean(isLoaded && isSignedIn);
  const load = useCallback(async () => {
    if (!signedIn) { setState((s) => ({ ...s, loading: false })); return; }
    tokenRef.current = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
    try {
      const data = await apiGet('/api/crew/card', tokenRef.current);
      setState({ loading: false, error: null, card: data.card, creditedWork: data.creditedWork || [], options: { ...FALLBACK_OPTIONS, ...data.options } });
      setForm(fromCard(data.card));
      setGearDraft((d) => ({ ...d, category: d.category || (data.options && data.options.gearCategories[0]) || '' }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [signedIn]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const options = state.options;

  function toggleRole(r) {
    setForm((f) => {
      if (f.roles.includes(r)) return { ...f, roles: f.roles.filter((x) => x !== r) };
      if (f.roles.length >= options.maxRoles) { setStatus({ kind: 'error', text: `Up to ${options.maxRoles} roles — drop one to add another.` }); return f; }
      return { ...f, roles: [...f.roles, r] };
    });
  }
  function addLanguage() {
    const parts = lang.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    set({ languages: [...new Set([...form.languages, ...parts])].slice(0, 8) });
    setLang('');
  }
  function addGear() {
    const name = gearDraft.name.trim();
    if (!name || !gearDraft.category) return;
    set({ gear: [...form.gear, { category: gearDraft.category, name, flag: gearDraft.flag }] });
    setGearDraft((d) => ({ ...d, name: '' }));
  }
  function addCredit() {
    const title = creditDraft.title.trim();
    if (!title) return;
    set({ credits: [...form.credits, { title, role: creditDraft.role.trim(), year: creditDraft.year.trim() }] });
    setCreditDraft({ title: '', role: '', year: '' });
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const data = await apiPost('/api/crew/card', form, tokenRef.current);
      setState((s) => ({ ...s, card: data.card }));
      setForm(fromCard(data.card));
      setStatus({ kind: 'ok', text: data.card.listed && (data.card.roles.length || data.card.gear.length) ? 'Saved — you’re on Crew Call.' : 'Saved.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert('Remove your working card?', 'Your profile and credits stay; only the card goes.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await apiDelete('/api/crew/card', {}, tokenRef.current);
            setState((s) => ({ ...s, card: null }));
            setForm(EMPTY);
            setStatus({ kind: 'ok', text: 'Card removed.' });
          } catch (err) {
            setStatus({ kind: 'error', text: err.message });
          } finally {
            setBusy(false);
          }
        }
      }
    ]);
  }

  const body = () => {
    if (state.loading) return <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} />;
    if (!signedIn) {
      return (
        <View style={crew.panel}>
          <Text style={crew.lead}>Everyone with an account gets one: what you do, what gear you have, where you’re based and how far you’ll go, whether you’re free. People find you by role, gear and distance.</Text>
          <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}>
            <Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in or create an account</Text>
          </Pressable>
        </View>
      );
    }
    if (state.error) return <Text style={crew.error}>{state.error}</Text>;
    return (
      <>
        <View style={crew.panel}>
          <Text style={crew.h3}>Roles · pick up to {options.maxRoles}</Text>
          <View style={crew.chips}>
            {options.roles.map((r) => <Chip key={r} label={r} on={form.roles.includes(r)} onPress={() => toggleRole(r)} />)}
          </View>
        </View>

        <View style={crew.panel}>
          <Text style={crew.h3}>Where</Text>
          <Text style={crew.label}>Based in</Text>
          <PlaceBox value={form.place} onChange={(p) => set({ place: p })} />
          <Text style={[crew.label, { marginTop: 6 }]}>Will travel (miles)</Text>
          <TextInput style={crew.input} value={form.travelMiles} onChangeText={(v) => set({ travelMiles: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="25" placeholderTextColor={colors.inkFaint} />
          <View style={[crew.row, { marginTop: 4 }]}>
            <Switch value={form.remoteOk} onValueChange={(v) => set({ remoteOk: v })} trackColor={{ true: colors.brass }} />
            <Text style={[crew.rowText, { flex: 1 }]}>I also work remotely (editing, color, sound, VFX…)</Text>
          </View>
          <Text style={crew.mono}>Only the place name shows on your card. The distance filter measures from it; your exact point never leaves the server.</Text>
        </View>

        <View style={crew.panel}>
          <Text style={crew.h3}>Availability</Text>
          <View style={crew.toggle}>
            {[['open', '● Open to work'], ['booked', 'Booked']].map(([k, l]) => (
              <Pressable key={k} style={[crew.toggleBtn, form.availability === k && crew.toggleOn]} onPress={() => set({ availability: k })}>
                <Text style={[crew.toggleText, form.availability === k && crew.toggleTextOn]}>{l}</Text>
              </Pressable>
            ))}
          </View>
          {form.availability === 'booked' ? (
            <>
              <Text style={crew.label}>Booked until (YYYY-MM-DD)</Text>
              <TextInput style={crew.input} value={form.bookedUntil} onChangeText={(v) => set({ bookedUntil: v })} placeholder="2026-11-03" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
            </>
          ) : null}
        </View>

        <View style={crew.panel}>
          <Text style={crew.h3}>Gear · brings it, lends it, or ask</Text>
          <GearRows gear={form.gear} onRemove={(i) => set({ gear: form.gear.filter((_, j) => j !== i) })} />
          <Text style={[crew.label, { marginTop: 6 }]}>Add gear</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow} keyboardShouldPersistTaps="handled">
            {options.gearCategories.map((c) => <Chip key={c} label={c} on={gearDraft.category === c} onPress={() => setGearDraft((d) => ({ ...d, category: c }))} />)}
          </ScrollView>
          <TextInput style={crew.input} value={gearDraft.name} onChangeText={(v) => setGearDraft((d) => ({ ...d, name: v }))} placeholder="Aputure 600d Pro" placeholderTextColor={colors.inkFaint} maxLength={80} onSubmitEditing={addGear} />
          <View style={crew.chips}>
            {Object.entries(GEAR_FLAGS).map(([k, v]) => <Chip key={k} label={v} on={gearDraft.flag === k} onPress={() => setGearDraft((d) => ({ ...d, flag: k }))} />)}
          </View>
          <Pressable style={[crew.btn, { alignSelf: 'flex-start' }]} onPress={addGear}><Text style={crew.btnText}>Add</Text></Pressable>
        </View>

        <View style={crew.panel}>
          <Text style={crew.h3}>Credits</Text>
          <CreditRows auto={state.creditedWork} manual={form.credits} onRemove={(i) => set({ credits: form.credits.filter((_, j) => j !== i) })} />
          <Text style={[crew.label, { marginTop: 6 }]}>Add an outside credit</Text>
          <TextInput style={crew.input} value={creditDraft.title} onChangeText={(v) => setCreditDraft((d) => ({ ...d, title: v }))} placeholder="Harbor Credit Union spot" placeholderTextColor={colors.inkFaint} maxLength={120} />
          <View style={crew.row}>
            <TextInput style={[crew.input, { flex: 2 }]} value={creditDraft.role} onChangeText={(v) => setCreditDraft((d) => ({ ...d, role: v }))} placeholder="Role (DP)" placeholderTextColor={colors.inkFaint} maxLength={40} />
            <TextInput style={[crew.input, { flex: 1 }]} value={creditDraft.year} onChangeText={(v) => setCreditDraft((d) => ({ ...d, year: v.replace(/[^0-9]/g, '').slice(0, 4) }))} placeholder="Year" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" />
          </View>
          <Pressable style={[crew.btn, { alignSelf: 'flex-start' }]} onPress={addCredit}><Text style={crew.btnText}>Add credit</Text></Pressable>
          <Text style={crew.mono}>Released titles on Studio Tapa are credits automatically; outside work you add yourself.</Text>
        </View>

        <View style={crew.panel}>
          <Text style={crew.h3}>Day rate · optional</Text>
          <View style={crew.row}>
            <TextInput style={[crew.input, { flex: 1 }]} value={form.rateMin} onChangeText={(v) => set({ rateMin: v.replace(/[^0-9]/g, '') })} placeholder="From ($)" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" />
            <TextInput style={[crew.input, { flex: 1 }]} value={form.rateMax} onChangeText={(v) => set({ rateMax: v.replace(/[^0-9]/g, '') })} placeholder="To ($)" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" />
          </View>
          <Text style={crew.mono}>Shown to signed-in people only.</Text>
        </View>

        <View style={crew.panel}>
          <Text style={crew.h3}>Languages</Text>
          {form.languages.length ? (
            <View style={crew.chips}>
              {form.languages.map((l) => <Chip key={l} label={`${l} ✕`} onPress={() => set({ languages: form.languages.filter((x) => x !== l) })} />)}
            </View>
          ) : null}
          <View style={crew.row}>
            <TextInput style={[crew.input, { flex: 1 }]} value={lang} onChangeText={setLang} placeholder="English, Spanish" placeholderTextColor={colors.inkFaint} onSubmitEditing={addLanguage} />
            <Pressable style={crew.btnSm} onPress={addLanguage}><Text style={crew.btnSmText}>Add</Text></Pressable>
          </View>
        </View>

        <View style={crew.panel}>
          <Text style={crew.h3}>Listing</Text>
          <View style={crew.row}>
            <Switch value={form.listed} onValueChange={(v) => set({ listed: v })} trackColor={{ true: colors.brass }} />
            <Text style={[crew.rowText, { flex: 1 }]}>Show my card in the Crew Call directory</Text>
          </View>
          <Text style={crew.mono}>Off keeps the card on your profile only. A card needs at least one role or gear item to be listed.</Text>
        </View>

        <View style={styles.savebar}>
          <Pressable style={[crew.btn, crew.btnPrimary, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
            <Text style={[crew.btnText, crew.btnPrimaryText]}>{busy ? 'Saving…' : state.card ? 'Save changes' : 'Save card'}</Text>
          </Pressable>
          {status ? <Text style={[crew.muted, { color: status.kind === 'ok' ? colors.ok : colors.danger, flex: 1 }]}>{status.text}</Text> : <View style={{ flex: 1 }} />}
          {state.card ? <Pressable onPress={remove} disabled={busy}><Text style={[crew.mono, { color: colors.danger }]}>Remove card</Text></Pressable> : null}
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push('/crew')} hitSlop={8}><Text style={crew.mono}>‹ Crew Call</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Connect · Crew Call</Text>
        <Text style={crew.h1}>Your working card</Text>
        {body()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hrow: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  savebar: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 12, padding: 12, marginTop: 4 }
});
