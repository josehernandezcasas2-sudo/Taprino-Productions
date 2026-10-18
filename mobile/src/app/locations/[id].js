import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import ReportSheet from '../../components/ReportSheet';
import SmartImage from '../../components/SmartImage';
import { crew, Chip, Avatar } from '../../components/CrewBits';
import { HostedChip, StatusPill, MonthCalendar, KV, resolveToken, loc } from '../../components/LocationBits';
import { quoteFor, splitBooking, dollars, dayCount, daysBetween, hoursBetween, hoursLabel, fmtRange, todayIso, thisMonth, MIN_BOOKING_CENTS, MAX_DAYS, DEFAULT_CUT_PERCENT } from '../../lib/locationRules';

// One place (pages/locations/<id> on the web): gallery, facts, rates,
// availability, the host, and the request panel.
const TABS = ['Space', 'Light & sound', 'Logistics', 'Rules', 'Permits', 'Shot here'];

export default function ListingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, listing: null, rules: null });
  const [projects, setProjects] = useState([]);
  const [photo, setPhoto] = useState(0);
  const [tab, setTab] = useState(0);
  const [month, setMonth] = useState(thisMonth());
  const [dates, setDates] = useState({ from: '', to: '' });

  const load = useCallback(async () => {
    try {
      tokenRef.current = signedIn ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]) : null;
      const [d, r] = await Promise.all([apiGet(`/api/locations/${id}`, tokenRef.current), apiGet('/api/locations?sort=new').catch(() => null)]);
      setState({ loading: false, error: null, listing: d.listing, rules: r ? r.rules : null });
      if (tokenRef.current && !d.listing.mine) {
        try { const p = await apiGet('/api/crew/my-projects', tokenRef.current); setProjects(p.projects || []); } catch (err) { /* optional */ }
      }
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: s.listing ? null : err.message }));
    }
  }, [id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const l = state.listing;
  const rules = state.rules;
  const marks = {};
  if (l) {
    for (const d of l.blockedDays || []) marks[d] = 'blocked';
    for (const d of l.bookedDays || []) marks[d] = 'booked';
    if (dates.from) for (const d of daysBetween(dates.from, dates.to || dates.from)) if (!marks[d]) marks[d] = 'sel';
  }
  const pickDay = (iso) => {
    if (marks[iso] === 'booked' || marks[iso] === 'blocked') return;
    setDates((d) => (!d.from || (d.from && d.to) || iso < d.from ? { from: iso, to: '' } : { from: d.from, to: iso }));
  };

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push('/locations'))} hitSlop={8}><Text style={crew.mono}>‹ Locations</Text></Pressable>
        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {l ? (
          <>
            {l.mine ? (
              <View style={[crew.panel, { borderColor: 'rgba(242,193,78,0.5)', marginTop: 10 }]}>
                <View style={[crew.row, { flexWrap: 'wrap' }]}><StatusPill status={l.status} /><Text style={crew.meta}>This is how producers see your place.</Text></View>
                <View style={crew.row}>
                  <Pressable style={crew.btnSm} onPress={() => router.push(`/locations/new?edit=${l.id}`)}><Text style={crew.btnSmText}>Edit</Text></Pressable>
                  <Pressable style={crew.btnSm} onPress={() => router.push('/locations/mine')}><Text style={crew.btnSmText}>Your places</Text></Pressable>
                </View>
              </View>
            ) : null}
            <Gallery photos={l.photos.length ? l.photos : [{ url: l.coverUrl, caption: '' }]} index={photo} onPick={setPhoto} />
            <Text style={[crew.eyebrow, { marginTop: 12, color: colors.olive }]}>{l.kindLabel} · {l.place ? l.place.label : ''}{l.miles != null ? ` · ${l.miles} mi` : ''}</Text>
            <Text style={crew.h1}>{l.title}</Text>
            <View style={[crew.row, { marginBottom: 10 }]}>
              <View style={loc.tile}><Text style={loc.tileB}>{l.sqFt ? `${l.sqFt.toLocaleString()} sq ft` : '—'}</Text><Text style={loc.tileS}>Inside</Text></View>
              <View style={loc.tile}><Text style={loc.tileB}>{l.crewMax ? `Crew ≤ ${l.crewMax}` : 'Any crew'}</Text><Text style={loc.tileS}>People</Text></View>
            </View>
            <View style={[crew.row, { marginBottom: 10 }]}>
              <View style={loc.tile}><Text style={loc.tileB}>{l.bestLight || l.windowsFace || (l.features.includes('natural_light') ? 'Natural light' : '—')}</Text><Text style={loc.tileS}>Light</Text></View>
              <View style={loc.tile}><Text style={loc.tileB}>{hoursLabel(l.hoursFrom, l.hoursTo)}</Text><Text style={loc.tileS}>Hours</Text></View>
            </View>
            {l.description ? <Text style={[crew.bio, { color: colors.inkDim, marginBottom: 10 }]}>{l.description}</Text> : null}
            {l.mine && l.address ? <View style={loc.money}><Text style={loc.moneyText}>Private: {l.address}{l.accessNotes ? ` · ${l.accessNotes}` : ''} — only you, admins and a paid booking see this.</Text></View> : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow}>
              {TABS.map((t, i) => <Chip key={t} label={i === 5 ? `${t} · ${l.credits.length}` : t} on={tab === i} onPress={() => setTab(i)} />)}
            </ScrollView>
            <View style={[crew.panel, { paddingVertical: 4 }]}>
              <TabBody l={l} tab={tab} rules={rules} onOpenProject={(c) => router.push(c.projectType === 'pitch' ? `/pitches/${c.projectId}` : `/series/${c.projectId}`)} />
            </View>

            <View style={crew.panel}>
              <Text style={[crew.label, { color: colors.olive }]}>Rates</Text>
              {l.hourlyCents ? <KV k="Hourly" v={`${dollars(l.hourlyCents, { whole: true })} · ${l.minHours} hr min`} /> : null}
              {l.halfDayCents ? <KV k="Half day" v={dollars(l.halfDayCents, { whole: true })} /> : null}
              {l.dayCents ? <KV k="Full day" v={`${dollars(l.dayCents, { whole: true })} · ${l.dayHours} hrs`} /> : null}
              {l.overtimeCents ? <KV k="Overtime" v={`${dollars(l.overtimeCents, { whole: true })}/hr`} /> : null}
              {l.cleaningCents ? <KV k="Cleaning" v={dollars(l.cleaningCents, { whole: true })} /> : null}
              {l.weekendPct > 0 ? <KV k="Weekends" v={`+${l.weekendPct}%`} /> : null}
              {!l.hourlyCents && !l.dayCents ? <KV k="No posted rate" v="Make a deal" /> : null}
              <Text style={crew.mono}>{l.dealsOk ? 'Also open to a deal — send your own number.' : 'Posted rates only.'} {rules && rules.cancellation[l.cancellation] ? `${rules.cancellation[l.cancellation].label} cancellation.` : ''}</Text>
            </View>

            <View style={crew.panel}>
              <Text style={crew.label}>Availability · tap a first day, then a last day</Text>
              <MonthCalendar month={month} onMonth={setMonth} marks={marks} min={todayIso()} onPick={pickDay} />
            </View>

            {!l.mine ? (signedIn
              ? <RequestPanel listing={l} projects={projects} dates={dates} setDates={setDates} token={getToken} onDone={(r) => router.push(`/locations/requests/${r.id}`)} />
              : (
                <View style={[crew.panel, { borderColor: 'rgba(255,140,66,0.45)' }]}>
                  <Text style={crew.label}>Request to book</Text>
                  <Text style={crew.muted}>Pick dates, say what you’re shooting, pay the posted rate or make an offer. Nothing is charged until the host accepts.</Text>
                  <Pressable style={[crew.btn, crew.btnPrimary]} onPress={() => router.push('/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in to request dates</Text></Pressable>
                </View>
              )) : null}

            <View style={crew.panel}>
              <Pressable style={crew.row} onPress={() => router.push(l.host.profilePath)}>
                <Avatar userId={l.host.userId} name={l.host.displayName} src={l.host.avatarUrl} position={l.host.avatarPosition} zoom={l.host.avatarZoom || 1} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={crew.nameRow}><Text style={crew.name}>{l.host.displayName}</Text><HostedChip host={l.host} />{l.verified ? <Chip label="✓ verified" tone="ok" /> : null}</View>
                  <Text style={crew.mono}>{l.host.listings || 1} {l.host.listings === 1 ? 'place' : 'places'} listed{l.host.wouldAgain ? ` · ${l.host.wouldAgain} would shoot here again` : ''}</Text>
                </View>
              </Pressable>
              {!l.mine ? (
                <View style={crew.row}>
                  {signedIn ? <Pressable style={crew.btnSm} onPress={() => router.push(`/messages?to=${encodeURIComponent(l.host.userId)}&kind=location&label=${encodeURIComponent(l.title)}`)}><Text style={crew.btnSmText}>Ask about a date</Text></Pressable> : null}
                  <Pressable style={crew.btnSm} onPress={() => router.push(l.host.profilePath)}><Text style={crew.btnSmText}>Profile</Text></Pressable>
                </View>
              ) : null}
            </View>
            {l.rules ? <View style={[crew.panel, { borderStyle: 'dashed', backgroundColor: 'transparent' }]}><Text style={crew.label}>House rules</Text><Text style={crew.muted}>{l.rules}</Text></View> : null}
            {signedIn && !l.mine ? <View style={{ alignItems: 'flex-start' }}><ReportSheet targetType="location" targetId={l.id} title={l.title} /></View> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Gallery({ photos, index, onPick }) {
  const p = photos[index] || photos[0];
  return (
    <View style={{ gap: 6, marginTop: 10 }}>
      <View style={styles.main}>
        {p && p.url ? <SmartImage uri={p.url} style={StyleSheet.absoluteFill} /> : null}
        {p && p.caption ? <Text style={loc.k}>{p.caption}</Text> : null}
        <Text style={[loc.k, { left: undefined, right: 8 }]}>{index + 1} / {photos.length}</Text>
      </View>
      {photos.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 6 }}>
          {photos.map((x, i) => (
            <Pressable key={x.url} style={[loc.thumb, i === index && { borderWidth: 2, borderColor: colors.brass }]} onPress={() => onPick(i)}>
              <SmartImage uri={x.url} style={StyleSheet.absoluteFill} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function TabBody({ l, tab, rules, onOpenProject }) {
  const has = (k) => l.features.includes(k);
  const join = (pairs) => pairs.filter(([ok]) => ok).map(([, label]) => label).join(' · ') || null;
  if (tab === 0) return <>{[['Rooms', l.rooms], ['Inside', l.sqFt ? `${l.sqFt.toLocaleString()} sq ft` : null], ['Outside', l.outdoorSqFt ? `${l.outdoorSqFt.toLocaleString()} sq ft` : null], ['Ceilings', l.ceilingFt ? `${l.ceilingFt} ft` : null], ['Crew max', l.crewMax], ['Hours', hoursLabel(l.hoursFrom, l.hoursTo)], ['Furniture', has('furniture_moves') ? 'May move; photograph first' : null], ['Green room', has('green_room') ? 'Yes' : null]].map(([k, v]) => <KV key={k} k={k} v={v} />)}</>;
  if (tab === 1) return <>{[['Windows face', l.windowsFace], ['Best light', l.bestLight], ['Natural light', has('natural_light') ? 'Yes' : 'Little'], ['Blackout', has('blackout') ? 'Possible' : 'No'], ['Power', l.power || join([[has('power_tiein'), 'tie-in'], [has('power_50a'), '50A+'], [has('household_power'), 'household']])], ['Sound', l.sound || join([[has('soundproof'), 'soundproofed'], [has('quiet'), 'quiet'], [has('flight_path'), 'flight path']])]].map(([k, v]) => <KV key={k} k={k} v={v} />)}</>;
  if (tab === 2) return <>{[['Parking', join([[has('driveway'), 'driveway'], [has('street_parking'), 'street'], [has('truck_access'), 'truck access']])], ['Load-in', join([[has('ground_loadin'), 'ground level'], [has('elevator'), 'elevator'], [has('loading_dock'), 'loading dock']])], ['Bathrooms', has('bathrooms') ? 'Crew may use' : null], ['Kitchen', has('kitchen') ? 'Usable' : null], ['Wifi', has('wifi') ? 'Yes' : null], ['Overnight', has('overnight') ? 'OK' : 'No'], ['Access', l.accessNotes || (l.mine ? null : 'Shared once a booking is paid')]].map(([k, v]) => <KV key={k} k={k} v={v} />)}</>;
  if (tab === 3) return <>{[['Cancellation', rules && rules.cancellation[l.cancellation] ? `${rules.cancellation[l.cancellation].label} · ${rules.cancellation[l.cancellation].text}` : l.cancellation], ['Crew max', l.crewMax], ['House rules', l.rules || 'None posted']].map(([k, v]) => <KV key={k} k={k} v={v} />)}</>;
  if (tab === 4) return <>{[['Film permit', rules ? rules.permitHelp[l.permitHelp] : l.permitHelp], ['Insurance', l.coiRequired ? 'Crews must carry a COI naming the host' : 'No COI required'], ['Host', rules ? rules.ownership[l.ownership] : l.ownership], ['Verified', l.verified ? '✓ Checked by Studio Tapa' : 'Not yet']].map(([k, v]) => <KV key={k} k={k} v={v} />)}</>;
  return (
    <View style={[crew.chips, { paddingVertical: 6 }]}>
      {l.credits.length === 0 ? <Text style={crew.muted}>No credits yet. A shoot that goes as agreed adds the production here.</Text> : null}
      {l.credits.map((c, i) => <Chip key={i} label={`${c.projectType === 'pitch' ? 'Pitch Room · ' : c.projectType === 'series' ? 'Series · ' : ''}${c.title}`} tone={c.projectId ? 'ok' : undefined} onPress={c.projectId ? () => onOpenProject(c) : undefined} />)}
    </View>
  );
}

function RequestPanel({ listing: l, projects, dates, setDates, token, onDone }) {
  const [form, setForm] = useState({ hoursFrom: '08:00', hoursTo: '18:00', crewSize: '', vehicles: '', project: '', shooting: '', message: '', pricing: l.hourlyCents || l.dayCents ? 'posted' : 'offer', offer: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const hasRates = Boolean(l.hourlyCents || l.dayCents);
  const endsOn = dates.to || dates.from;
  const days = dayCount(dates.from, endsOn);
  const hoursPerDay = hoursBetween(form.hoursFrom, form.hoursTo) || l.dayHours;

  const est = useMemo(() => {
    if (!dates.from) return null;
    let subtotal = null;
    let how = '';
    if (form.pricing === 'posted' && hasRates) {
      const q = quoteFor(l, { startsOn: dates.from, endsOn, hoursPerDay });
      if (q) { subtotal = q.subtotalCents; how = q.allDay ? `${days} × day rate` : `${q.hours} hrs × hourly`; }
    } else {
      const cents = Math.round(Number(form.offer) * 100);
      if (cents > 0) { subtotal = cents; how = 'your offer'; }
    }
    if (subtotal == null) return null;
    return { ...splitBooking({ subtotalCents: subtotal, cleaningCents: l.cleaningCents || 0, cutPercent: DEFAULT_CUT_PERCENT }), how };
  }, [dates.from, endsOn, hoursPerDay, form.pricing, form.offer, hasRates, l, days]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const [type, pid] = form.project ? form.project.split(':') : [null, null];
      const data = await apiPost(`/api/locations/${l.id}/requests`, { startsOn: dates.from, endsOn, hoursFrom: form.hoursFrom, hoursTo: form.hoursTo, crewSize: form.crewSize, vehicles: form.vehicles, project: type ? { type, id: pid } : null, shooting: form.shooting, message: form.message, pricing: form.pricing, offer: form.offer }, await resolveToken(token));
      onDone(data.request);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const first = l.host.displayName.split(' ')[0];
  const canSend = dates.from && days <= MAX_DAYS && form.shooting.trim().length >= 3 && (form.pricing !== 'offer' || Number(form.offer) > 0) && !busy;
  return (
    <View style={[crew.panel, { borderColor: 'rgba(255,140,66,0.45)' }]}>
      <Text style={crew.label}>Request to book</Text>
      <Text style={crew.mono}>{dates.from ? `${fmtRange(dates.from, endsOn)} · ${days} ${days === 1 ? 'day' : 'days'}` : 'Pick your dates on the calendar above.'}</Text>
      <Text style={crew.label}>Hours (HH:MM)</Text>
      <View style={crew.row}>
        <TextInput style={[crew.input, { flex: 1 }]} value={form.hoursFrom} onChangeText={(v) => set({ hoursFrom: v })} placeholder="08:00" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
        <TextInput style={[crew.input, { flex: 1 }]} value={form.hoursTo} onChangeText={(v) => set({ hoursTo: v })} placeholder="18:00" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
      </View>
      <View style={crew.row}>
        <TextInput style={[crew.input, { flex: 1 }]} value={form.crewSize} onChangeText={(v) => set({ crewSize: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="Crew size" placeholderTextColor={colors.inkFaint} />
        <TextInput style={[crew.input, { flex: 1 }]} value={form.vehicles} onChangeText={(v) => set({ vehicles: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="Vehicles" placeholderTextColor={colors.inkFaint} />
      </View>
      {projects.length > 0 ? (
        <>
          <Text style={crew.label}>Project (optional)</Text>
          <View style={crew.chips}>
            <Chip label="Independent" on={!form.project} onPress={() => set({ project: '' })} />
            {projects.map((p) => <Chip key={p.value} label={p.label} on={form.project === p.value} onPress={() => set({ project: p.value })} />)}
          </View>
        </>
      ) : null}
      <TextInput style={crew.input} value={form.shooting} onChangeText={(v) => set({ shooting: v })} placeholder="What you’re shooting" placeholderTextColor={colors.inkFaint} maxLength={200} />
      <Text style={crew.label}>Pay</Text>
      <View style={crew.toggle}>
        {hasRates ? <Pressable style={[crew.toggleBtn, form.pricing === 'posted' && crew.toggleOn]} onPress={() => set({ pricing: 'posted' })}><Text style={[crew.toggleText, form.pricing === 'posted' && crew.toggleTextOn]}>Posted rate</Text></Pressable> : null}
        {l.dealsOk ? <Pressable style={[crew.toggleBtn, form.pricing === 'offer' && crew.toggleOn]} onPress={() => set({ pricing: 'offer' })}><Text style={[crew.toggleText, form.pricing === 'offer' && crew.toggleTextOn]}>Make an offer</Text></Pressable> : null}
      </View>
      {form.pricing === 'offer' ? <TextInput style={crew.input} value={form.offer} onChangeText={(v) => set({ offer: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" placeholder={`Your number for the whole booking (from $${MIN_BOOKING_CENTS / 100})`} placeholderTextColor={colors.inkFaint} /> : null}
      <TextInput style={[crew.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.message} onChangeText={(v) => set({ message: v })} placeholder={`A note to ${first}: generator, night work, how you found them.`} placeholderTextColor={colors.inkFaint} multiline maxLength={2000} />
      <View style={loc.money}>
        <Text style={loc.moneyText}>
          {est ? `Est. ${dollars(est.bookingCents)} for ${days} ${days === 1 ? 'day' : 'days'} (${est.how}${est.cleaningCents ? ` + ${dollars(est.cleaningCents)} cleaning` : ''}), ${dollars(est.totalChargedCents)} with the card fee. Nothing is charged until ${first} accepts; the address is shared then.`
            : dates.from ? (form.pricing === 'offer' ? 'Enter your offer to see the total.' : 'This place has no posted rate — make an offer.') : 'Pick your dates to see an estimate.'}
        </Text>
      </View>
      {days > MAX_DAYS ? <Text style={crew.error}>Up to {MAX_DAYS} days per request.</Text> : null}
      {error ? <Text style={crew.error}>{error}</Text> : null}
      <Pressable style={[crew.btn, crew.btnPrimary, !canSend && { opacity: 0.5 }]} disabled={!canSend} onPress={submit}><Text style={[crew.btnText, crew.btnPrimaryText]}>{busy ? 'Sending…' : 'Send request'}</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hrow: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  main: { aspectRatio: 16 / 10, borderRadius: 12, backgroundColor: colors.surface2, overflow: 'hidden', borderWidth: 1, borderColor: colors.oceanInk }
});
