import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPut, apiDelete, freshToken } from '../../../../lib/api';
import { colors } from '../../../../lib/theme';
import TopNav from '../../../../components/TopNav';
import SmartImage from '../../../../components/SmartImage';
import { crew, Chip, Avatar, TierChip } from '../../../../components/CrewBits';
import { StatusPill, DayForm, fmtDay, prod } from '../../../../components/ProductionBits';

// The call sheet for one shoot day (pages/productions/<id>/day/<n> on the
// web): who, where, when — with the address, access notes and house
// rules when the place is a Studio Tapa listing. Crew, owner, admins.
export default function CallSheetScreen() {
  const router = useRouter();
  const { id, n } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const [dayNo, setDayNo] = useState(Number(n) || 1);
  const [state, setState] = useState({ loading: true, error: null, sheet: null });
  const [bookedPlaces, setBookedPlaces] = useState([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const tokenRef = useRef(null);

  const load = useCallback(async (which = dayNo) => {
    if (!signedIn) { setState({ loading: false, error: 'The call sheet is for the crew. Sign in from Account.', sheet: null }); return; }
    try {
      tokenRef.current = await freshToken(getToken);
      const sheet = await apiGet(`/api/productions/${id}/sheet?day=${which}`, tokenRef.current);
      setState({ loading: false, error: null, sheet });
      setEditing(false);
      if (sheet.canEdit) {
        try { const m = await apiGet('/api/productions/mine', tokenRef.current); setBookedPlaces(m.bookedPlaces || []); } catch (err) { /* optional */ }
      }
    } catch (err) {
      setState((s) => ({ loading: false, error: s.sheet ? null : err.message, sheet: s.sheet }));
    }
  }, [id, dayNo, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saveDay(body) {
    setBusy(true);
    setNote(null);
    try {
      await apiPut(`/api/productions/${id}/days`, body, await freshToken(getToken));
      await load(dayNo);
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  const s = state.sheet;
  const p = s ? s.production : null;
  const day = s ? s.day : null;

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push(`/productions/${id}`)} hitSlop={8}><Text style={crew.mono}>‹ Back to the production</Text></Pressable>
        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {s && p && day ? (
          <>
            <Text style={[crew.eyebrow, { marginTop: 10 }]}>Call sheet · {p.kindLabel}</Text>
            <Text style={crew.h1}>{p.title}</Text>
            <Text style={[crew.lead, { marginBottom: 10 }]}>Day {day.dayNo} of {s.days.length} · {fmtDay(day.shootOn)}</Text>
            <View style={[crew.row, { marginBottom: 10 }]}>
              <View style={prod.timeBox}><Text style={crew.label}>Crew call</Text><Text style={prod.bigTime}>{day.callTime || '—'}</Text></View>
              <View style={prod.timeBox}><Text style={crew.label}>Wrap</Text><Text style={prod.bigTime}>{day.wrapTime || '—'}</Text></View>
              <View style={prod.timeBox}><Text style={crew.label}>On the crew</Text><Text style={prod.bigTime}>{s.crewCount}</Text></View>
            </View>
            {s.days.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
                {s.days.map((d) => <Chip key={d.id} label={`Day ${d.dayNo} · ${d.label.replace(/^\w+, /, '')}`} on={d.dayNo === day.dayNo} onPress={() => { setDayNo(d.dayNo); load(d.dayNo); }} />)}
              </ScrollView>
            ) : null}
            {note ? <Text style={crew.error}>{note}</Text> : null}

            <View style={crew.panel}>
              <Text style={crew.h3}>Where</Text>
              <Text style={prod.place}>{day.placeLabel || 'Place to confirm'}</Text>
              {day.address ? <Text style={prod.addr} selectable>{day.address}</Text> : null}
              {s.listing ? (
                <View style={{ gap: 6 }}>
                  <View style={crew.row}>
                    {s.listing.coverUrl ? <View style={{ width: 84, aspectRatio: 4 / 3, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface2 }}><SmartImage uri={s.listing.coverUrl} style={{ width: '100%', height: '100%' }} /></View> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={crew.mono}>Booked through Locations{s.listing.hostName ? ` · hosted by ${s.listing.hostName}` : ''}</Text>
                      <Pressable onPress={() => router.push(`/locations/${s.listing.id}`)}><Text style={[crew.mono, { color: colors.olive }]}>Open the listing ›</Text></Pressable>
                    </View>
                  </View>
                  {s.listing.accessNotes ? <Text style={crew.bio}><Text style={{ color: colors.ink }}>Getting in. </Text>{s.listing.accessNotes}</Text> : null}
                  {s.listing.rules ? <Text style={crew.bio}><Text style={{ color: colors.ink }}>House rules. </Text>{s.listing.rules}</Text> : null}
                  <View style={crew.metaRow}>
                    {s.listing.hoursFrom && s.listing.hoursTo ? <Text style={crew.meta}>Hours {s.listing.hoursFrom}–{s.listing.hoursTo}</Text> : null}
                    {s.listing.crewMax ? <Text style={crew.meta}>Crew up to {s.listing.crewMax}</Text> : null}
                    {s.listing.power ? <Text style={crew.meta}>Power: {s.listing.power}</Text> : null}
                    {s.listing.sound ? <Text style={crew.meta}>Sound: {s.listing.sound}</Text> : null}
                    {s.listing.coiRequired ? <Text style={crew.meta}>COI required</Text> : null}
                    {s.listing.permitHelp ? <Text style={crew.meta}>Permits: {s.listing.permitHelp}</Text> : null}
                  </View>
                </View>
              ) : null}
              {day.parking ? <Text style={crew.bio}><Text style={{ color: colors.ink }}>Parking & arrival. </Text>{day.parking}</Text> : null}
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>The day</Text>
              {day.scenes ? <Text style={crew.bio}><Text style={{ color: colors.ink }}>Shooting. </Text>{day.scenes}</Text> : null}
              {day.notes ? <Text style={crew.bio}>{day.notes}</Text> : null}
              {!day.scenes && !day.notes ? <Text style={crew.muted}>No notes for this day yet.</Text> : null}
              {p.notes ? <><Text style={[crew.h4, { marginTop: 6 }]}>Production notes</Text><Text style={crew.bio}>{p.notes}</Text></> : null}
              <View style={[crew.row, { flexWrap: 'wrap' }]}><Text style={crew.mono}>Run by {p.owner.displayName}{p.place ? ` · based in ${p.place.label}` : ''}</Text><StatusPill status={p.status} label={p.statusLabel} /></View>
            </View>

            <View style={crew.panel}>
              <Text style={crew.h3}>Crew · {s.crewCount}</Text>
              {s.departments.length === 0 ? <Text style={crew.muted}>Nobody on the list yet.</Text> : null}
              {s.departments.map((d) => (
                <View key={d.name}>
                  <Text style={prod.dept}>{d.name}</Text>
                  {d.members.map((m) => (
                    <Pressable key={m.id} style={prod.person} onPress={() => router.push(m.person.profilePath)}>
                      <Avatar userId={m.person.userId} name={m.person.displayName} src={m.person.avatarUrl} position={m.person.avatarPosition} zoom={m.person.avatarZoom || 1} size={28} />
                      <Text style={[crew.rowText, { flex: 1 }]}>{m.person.displayName}</Text>
                      <TierChip person={m.person} />
                      <Text style={crew.meta}>{m.role}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>

            {s.canEdit ? (
              <View style={[crew.row, { flexWrap: 'wrap' }]}>
                {!editing ? <Pressable style={crew.btn} onPress={() => setEditing(true)}><Text style={crew.btnText}>Edit this day</Text></Pressable> : null}
                <Pressable style={[crew.btn, crew.btnGhost]} disabled={busy} onPress={() => Alert.alert(`Remove Day ${day.dayNo} from the sheet?`, '', [{ text: 'Keep' }, { text: 'Remove', style: 'destructive', onPress: async () => { try { await apiDelete(`/api/productions/${id}/days`, { dayId: day.id }, await freshToken(getToken)); router.replace(`/productions/${id}`); } catch (err) { setNote(err.message); } } }])}><Text style={[crew.btnText, { color: colors.inkDim }]}>Remove this day</Text></Pressable>
              </View>
            ) : null}
            {s.canEdit && editing ? <View style={{ marginTop: 10 }}><DayForm initial={day} bookedPlaces={bookedPlaces} busy={busy} onSubmit={saveDay} onCancel={() => setEditing(false)} /></View> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
