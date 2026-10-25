import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import { crew, Chip, PlaceBox } from '../../components/CrewBits';
import { pickImage, uploadPicked, uploadPickedFull, resolveToken, loc, Req } from '../../components/LocationBits';
import { splitBooking, dollars, DEFAULT_CUT_PERCENT, MAX_PHOTOS } from '../../lib/locationRules';

// List a place (pages/locations/new on the web), or edit one
// (?edit=<id>). The same seven sections, one save. Vocabularies come
// from the API's rules so the app never drifts from the site.
const EMPTY = {
  title: '', kind: 'home', description: '', place: null, address: '', accessNotes: '',
  photos: [],
  sqFt: '', outdoorSqFt: '', rooms: '', ceilingFt: '', crewMax: '', hoursFrom: '07:00', hoursTo: '22:00', features: [], windowsFace: '', bestLight: '', power: '', sound: '',
  hourly: '', minHours: '4', halfDay: '', day: '', dayHours: '10', overtime: '', cleaning: '', weekendPct: '0', dealsOk: true, studioRate: '', studioRateNote: '',
  cancellation: 'moderate', rules: '', permitHelp: 'you_handle', coiRequired: false,
  ownership: 'owner', proofUrl: null, proofPreview: null, proofNote: ''
};
const d = (c) => (c == null ? '' : String(c / 100));
function fromListing(l) {
  return {
    title: l.title, kind: l.kind, description: l.description, place: l.place, address: l.address || '', accessNotes: l.accessNotes || '',
    photos: l.photos.map((p) => ({ url: p.url, caption: p.caption || '' })),
    sqFt: l.sqFt == null ? '' : String(l.sqFt), outdoorSqFt: l.outdoorSqFt == null ? '' : String(l.outdoorSqFt), rooms: l.rooms, ceilingFt: l.ceilingFt == null ? '' : String(l.ceilingFt), crewMax: l.crewMax == null ? '' : String(l.crewMax),
    hoursFrom: l.hoursFrom || '', hoursTo: l.hoursTo || '', features: l.features, windowsFace: l.windowsFace, bestLight: l.bestLight, power: l.power, sound: l.sound,
    hourly: d(l.hourlyCents), minHours: String(l.minHours), halfDay: d(l.halfDayCents), day: d(l.dayCents), dayHours: String(l.dayHours), overtime: d(l.overtimeCents), cleaning: d(l.cleaningCents), weekendPct: String(l.weekendPct), dealsOk: l.dealsOk, studioRate: d(l.studioRateCents), studioRateNote: l.studioRateNote || '',
    cancellation: l.cancellation, rules: l.rules, permitHelp: l.permitHelp, coiRequired: l.coiRequired,
    ownership: l.ownership, proofUrl: l.proofUrl, proofPreview: l.proofPreview || null, proofNote: l.proofNote
  };
}

export default function ListAPlace() {
  const router = useRouter();
  const { edit } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleFeature = (k) => set({ features: form.features.includes(k) ? form.features.filter((x) => x !== k) : [...form.features, k] });

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      tokenRef.current = signedIn ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]) : null;
      try { const r = await apiGet('/api/locations?sort=new'); if (alive) setRules(r.rules); } catch (err) { /* chips stay empty */ }
      if (edit && tokenRef.current) {
        try { const l = await apiGet(`/api/locations/${edit}`, tokenRef.current); if (alive && l.listing && l.listing.mine) { setEditing(l.listing); setForm(fromListing(l.listing)); } } catch (err) { if (alive) setError(err.message); }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [signedIn, edit])); // eslint-disable-line react-hooks/exhaustive-deps

  // The picked photo shows at once (local uri, "Uploading…" over it) and
  // is swapped for the stored copy when the upload lands. A failed upload
  // drops it again with the reason.
  const [pending, setPending] = useState(null); // { uri, purpose }
  async function addPhoto() {
    setError(null);
    let picked;
    try { picked = await pickImage(1600); } catch (err) { setError(err.message); return; }
    if (!picked) return;
    setPending({ uri: picked.uri, purpose: 'photo' });
    setUploading(true);
    try {
      const url = await uploadPicked(picked, 'photo', getToken);
      setForm((f) => ({ ...f, photos: [...f.photos, { url, caption: '', localUri: picked.uri }].slice(0, MAX_PHOTOS) }));
    } catch (err) { setError(`Photo upload failed: ${err.message}`); } finally { setUploading(false); setPending(null); }
  }
  async function addProof() {
    setError(null);
    let picked;
    try { picked = await pickImage(2000); } catch (err) { setError(err.message); return; }
    if (!picked) return;
    setPending({ uri: picked.uri, purpose: 'proof' });
    setUploading(true);
    try {
      const proof = await uploadPickedFull(picked, 'proof', getToken);
      set({ proofUrl: proof.url, proofPreview: proof.preview, proofLocalUri: picked.uri });
    } catch (err) { setError(`Proof upload failed: ${err.message}`); } finally { setUploading(false); setPending(null); }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const token = await resolveToken(getToken);
      const body = { ...form, photos: form.photos.map(({ localUri, ...p }) => p) };
      delete body.proofLocalUri;
      if (editing) await apiPatch(`/api/locations/${editing.id}`, body, token);
      else await apiPost('/api/locations', body, token);
      router.replace('/locations/mine');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const preview = (() => {
    const day = Math.round(Number(form.day) * 100) || 0;
    const hourly = Math.round(Number(form.hourly) * 100) || 0;
    const base = day || (hourly ? hourly * Math.max(10, Number(form.minHours) || 1) : 0);
    if (!base) return null;
    const withWeekend = base + Math.round((base * (Number(form.weekendPct) || 0)) / 100);
    return splitBooking({ subtotalCents: withWeekend, cleaningCents: Math.round(Number(form.cleaning) * 100) || 0, cutPercent: DEFAULT_CUT_PERCENT });
  })();

  const num = (key, placeholder, extra = {}) => (
    <TextInput style={[crew.input, { flex: 1 }]} value={form[key]} onChangeText={(v) => set({ [key]: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={colors.inkFaint} {...extra} />
  );

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push('/locations/mine')} hitSlop={8}><Text style={crew.mono}>‹ Your places</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Connect · Locations</Text>
        <Text style={crew.h1}>{editing ? 'Edit your place' : 'List a place'}</Text>
        {!signedIn ? (
          <View style={crew.panel}>
            <Text style={crew.lead}>If you hold the keys, productions near you will pay to shoot there. Set your rates or take offers; the site handles the booking and the money.</Text>
            <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in or create an account</Text></Pressable>
          </View>
        ) : loading || !rules ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : (
          <>
            <Text style={crew.lead}>{editing ? 'Changes to the address, who you are or the proof send the place back to review; everything else updates straight away.' : 'Seven short sections. A new place goes to review first: we check you’re the owner or can book it, then it’s public.'}</Text>
            {error ? <Text style={[crew.error, { marginBottom: 8 }]}>{error}</Text> : null}
            {editing && editing.status === 'rejected' && editing.rejectionReason ? <Text style={[crew.error, { marginBottom: 8 }]}>Not approved last time: {editing.rejectionReason} — fix it and save to resubmit.</Text> : null}

            <View style={crew.panel}>
              <Text style={crew.h3}>1 · Basics</Text>
              <Text style={crew.mono}><Req /> marks what a listing needs before it can go to review.</Text>
              <Text style={crew.label}>Title<Req /></Text>
              <TextInput style={crew.input} value={form.title} onChangeText={(v) => set({ title: v })} placeholder="Mid-century bungalow with a big back yard" placeholderTextColor={colors.inkFaint} maxLength={90} />
              <Text style={crew.label}>What it is<Req /></Text>
              <View style={crew.chips}>{Object.entries(rules.types).map(([k, v]) => <Chip key={k} label={v} on={form.kind === k} onPress={() => set({ kind: k })} />)}</View>
              <Text style={crew.label}>Neighbourhood or city (shows publicly)<Req /></Text>
              <PlaceBox value={form.place} onChange={(p) => set({ place: p })} placeholder="Highland Park, Los Angeles" />
              <TextInput style={[crew.input, { minHeight: 90, textAlignVertical: 'top' }]} value={form.description} onChangeText={(v) => set({ description: v })} placeholder="Year built, materials, what the light does, who lives or works there, what has shot here before." placeholderTextColor={colors.inkFaint} multiline maxLength={2000} />
              <Text style={crew.label}>Street address (private until a booking is paid)<Req /></Text>
              <TextInput style={crew.input} value={form.address} onChangeText={(v) => set({ address: v })} placeholder="1234 Avenue 56, Los Angeles, CA 90042" placeholderTextColor={colors.inkFaint} maxLength={200} />
              <TextInput style={crew.input} value={form.accessNotes} onChangeText={(v) => set({ accessNotes: v })} placeholder="Access notes (private): gate code, where the truck parks" placeholderTextColor={colors.inkFaint} maxLength={1000} />
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>2 · Photos<Req /> · {form.photos.length} of {MAX_PHOTOS} · the first is the cover</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
                {form.photos.map((p, i) => (
                  <View key={p.url} style={{ gap: 4, width: 120 }}>
                    <View style={loc.photo}><SmartImage uri={p.localUri || p.url} style={StyleSheet.absoluteFill} />{i === 0 ? <Text style={[loc.k, { top: 6, bottom: undefined }]}>Cover</Text> : null}</View>
                    <TextInput style={[crew.input, { paddingVertical: 5, fontSize: 11 }]} value={p.caption} onChangeText={(v) => set({ photos: form.photos.map((x, j) => (j === i ? { ...x, caption: v } : x)) })} placeholder="Caption" placeholderTextColor={colors.inkFaint} maxLength={80} />
                    <View style={crew.row}>
                      {i > 0 ? <Pressable onPress={() => set({ photos: [p, ...form.photos.filter((_, j) => j !== i)] })}><Text style={crew.mono}>Cover</Text></Pressable> : null}
                      <Pressable onPress={() => set({ photos: form.photos.filter((_, j) => j !== i) })}><Text style={[crew.mono, { color: colors.danger }]}>Remove</Text></Pressable>
                    </View>
                  </View>
                ))}
                {pending && pending.purpose === 'photo' ? (
                  <View style={[loc.photo, { alignItems: 'center', justifyContent: 'center' }]}><SmartImage uri={pending.uri} style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} /><ActivityIndicator color={colors.brass} /><Text style={[crew.mono, { color: colors.ink }]}>Uploading…</Text></View>
                ) : null}
                {form.photos.length < MAX_PHOTOS ? <Pressable style={loc.photoAdd} disabled={uploading} onPress={addPhoto}><Text style={[crew.mono, { color: colors.brass }]}>{uploading ? '…' : '+ Add photo'}</Text></Pressable> : null}
              </ScrollView>
              <Text style={crew.mono}>One frame per room at the time of day the light is best; say the time in the caption.</Text>
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>3 · The space</Text>
              <View style={crew.row}>{num('sqFt', 'Inside sq ft')}{num('outdoorSqFt', 'Outside sq ft')}</View>
              <TextInput style={crew.input} value={form.rooms} onChangeText={(v) => set({ rooms: v })} placeholder="Rooms crews may use: Living · kitchen · yard" placeholderTextColor={colors.inkFaint} maxLength={200} />
              <View style={crew.row}>{num('ceilingFt', 'Ceilings (ft)')}{num('crewMax', 'Crew max')}</View>
              <Text style={crew.label}>Hours (HH:MM)</Text>
              <View style={crew.row}>
                <TextInput style={[crew.input, { flex: 1 }]} value={form.hoursFrom} onChangeText={(v) => set({ hoursFrom: v })} placeholder="07:00" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
                <TextInput style={[crew.input, { flex: 1 }]} value={form.hoursTo} onChangeText={(v) => set({ hoursTo: v })} placeholder="22:00" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
              </View>
              {rules.featureGroups.map((g) => (
                <View key={g.label}>
                  <Text style={[crew.label, { marginBottom: 6 }]}>{g.label}</Text>
                  <View style={crew.chips}>{g.items.map(([k, label]) => <Chip key={k} label={label} on={form.features.includes(k)} onPress={() => toggleFeature(k)} />)}</View>
                </View>
              ))}
              <View style={crew.row}>
                <TextInput style={[crew.input, { flex: 1 }]} value={form.windowsFace} onChangeText={(v) => set({ windowsFace: v })} placeholder="Windows face" placeholderTextColor={colors.inkFaint} maxLength={80} />
                <TextInput style={[crew.input, { flex: 1 }]} value={form.bestLight} onChangeText={(v) => set({ bestLight: v })} placeholder="Best light" placeholderTextColor={colors.inkFaint} maxLength={80} />
              </View>
              <TextInput style={crew.input} value={form.power} onChangeText={(v) => set({ power: v })} placeholder="Power: household 20A · no tie-in" placeholderTextColor={colors.inkFaint} maxLength={120} />
              <TextInput style={crew.input} value={form.sound} onChangeText={(v) => set({ sound: v })} placeholder="Sound: quiet street · no flight path" placeholderTextColor={colors.inkFaint} maxLength={120} />
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>4 · Rates<Req /> · hourly, a day rate, or open to deals — at least one</Text>
              <View style={crew.row}>{num('hourly', 'Hourly $')}{num('minHours', 'Min hours')}</View>
              <View style={crew.row}>{num('day', 'Full day $')}{num('dayHours', 'A day is (hrs)')}</View>
              <View style={crew.row}>{num('halfDay', 'Half day $')}{num('overtime', 'Overtime $/hr')}</View>
              <View style={crew.row}>{num('cleaning', 'Cleaning fee $')}{num('weekendPct', 'Weekend +%')}</View>
              <View style={crew.row}>
                <Switch value={form.dealsOk} onValueChange={(v) => set({ dealsOk: v })} trackColor={{ true: colors.brass }} />
                <Text style={[crew.rowText, { flex: 1 }]}>Open to deals — producers can send their own number</Text>
              </View>
              <View style={{ gap: 6, padding: 8, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(242,193,78,0.5)' }}>
                <Text style={crew.label}>Studio Tapa rate ($/day) · optional</Text>
                <View style={crew.row}>{num('studioRate', '350')}<TextInput style={[crew.input, { flex: 2 }]} value={form.studioRateNote} onChangeText={(v) => set({ studioRateNote: v })} placeholder="Fine print (weekdays, crews up to 8)" placeholderTextColor={colors.inkFaint} maxLength={200} /></View>
                <Text style={crew.mono}>A deal for productions on Studio Tapa: a request linked to a production is quoted at this flat day rate, and the listing shows it.</Text>
              </View>
              <View style={loc.money}>
                <Text style={loc.moneyText}>{preview ? `A 10-hour Saturday shows producers ${dollars(preview.bookingCents)}${preview.cleaningCents ? ` incl. ${dollars(preview.cleaningCents)} cleaning` : ''}, plus the card fee. You receive ${dollars(preview.hostPayoutCents)} after Studio Tapa’s ${DEFAULT_CUT_PERCENT}% cut.` : `No rates: every request will be an offer you accept, counter or decline. Studio Tapa keeps ${DEFAULT_CUT_PERCENT}% of whatever you agree.`}</Text>
              </View>
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>5 · Rules</Text>
              <Text style={crew.label}>Cancellation</Text>
              {Object.entries(rules.cancellation).map(([k, v]) => (
                <Pressable key={k} style={[styles.radio, form.cancellation === k && { borderColor: colors.olive }]} onPress={() => set({ cancellation: k })}>
                  <Text style={crew.rowText}>{form.cancellation === k ? '● ' : '○ '}{v.label}</Text><Text style={crew.mono}>{v.text}</Text>
                </Pressable>
              ))}
              <TextInput style={[crew.input, { minHeight: 80, textAlignVertical: 'top' }]} value={form.rules} onChangeText={(v) => set({ rules: v })} placeholder="House rules: shoes off, quiet after 9pm, nothing taped to the wood." placeholderTextColor={colors.inkFaint} multiline maxLength={2000} />
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>6 · Permits &amp; insurance</Text>
              <View style={crew.chips}>{Object.entries(rules.permitHelp).map(([k, v]) => <Chip key={k} label={v} on={form.permitHelp === k} onPress={() => set({ permitHelp: k })} />)}</View>
              <View style={crew.row}>
                <Switch value={form.coiRequired} onValueChange={(v) => set({ coiRequired: v })} trackColor={{ true: colors.brass }} />
                <Text style={[crew.rowText, { flex: 1 }]}>Crews must carry a certificate of insurance (COI) naming me</Text>
              </View>
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>7 · Who you are to this place<Req /> · checked by an admin</Text>
              {Object.entries(rules.ownership).map(([k, v]) => (
                <Pressable key={k} style={[styles.radio, form.ownership === k && { borderColor: colors.olive }]} onPress={() => set({ ownership: k })}><Text style={crew.rowText}>{form.ownership === k ? '● ' : '○ '}{v}</Text></Pressable>
              ))}
              <View style={[crew.row, { alignItems: 'flex-start' }]}>
                {pending && pending.purpose === 'proof' ? (
                  <View style={[loc.photo, { alignItems: 'center', justifyContent: 'center' }]}><SmartImage uri={pending.uri} style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} /><ActivityIndicator color={colors.brass} /></View>
                ) : form.proofUrl ? <View style={loc.photo}><SmartImage uri={form.proofLocalUri || form.proofPreview || form.proofUrl} style={StyleSheet.absoluteFill} /><Text style={[loc.k, { top: 6, bottom: undefined }]}>Proof</Text></View> : null}
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={crew.row}>
                    <Pressable style={crew.btnSm} disabled={uploading} onPress={addProof}><Text style={crew.btnSmText}>{form.proofUrl ? 'Replace proof' : uploading ? 'Uploading…' : 'Upload proof'}</Text></Pressable>
                    {form.proofUrl ? <Pressable style={[crew.btnSm, crew.btnGhost]} onPress={() => set({ proofUrl: null, proofPreview: null, proofLocalUri: null })}><Text style={[crew.btnSmText, { color: colors.inkDim }]}>Remove</Text></Pressable> : null}
                  </View>
                  <Text style={crew.mono}>A deed or tax bill, a lease, a utility bill in your name, or a letter from the owner. Only admins see it.</Text>
                </View>
              </View>
              <TextInput style={crew.input} value={form.proofNote} onChangeText={(v) => set({ proofNote: v })} placeholder="Anything the reviewer should know" placeholderTextColor={colors.inkFaint} maxLength={300} />
            </View>

            {error ? <Text style={crew.error}>{error}</Text> : null}
            <View style={crew.row}>
              <Pressable style={[crew.btn, crew.btnPrimary, (busy || uploading) && { opacity: 0.6 }]} disabled={busy || uploading} onPress={save}><Text style={[crew.btnText, crew.btnPrimaryText]}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Submit for review'}</Text></Pressable>
              <Pressable style={[crew.btn, crew.btnGhost]} onPress={() => router.back()}><Text style={[crew.btnText, { color: colors.inkDim }]}>Cancel</Text></Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  radio: { gap: 2, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }
});
