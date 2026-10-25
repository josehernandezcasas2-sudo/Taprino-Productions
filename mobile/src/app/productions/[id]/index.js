import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, freshToken } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import ReportSheet from '../../../components/ReportSheet';
import { crew, Chip, Avatar, TierChip, CallCard } from '../../../components/CrewBits';
import { StatusPill, DayForm, OWNER_STATUSES, STATUS, fmtRange, prod } from '../../../components/ProductionBits';

// One production (pages/productions/<id> on the web): what it is, who's
// on it, the shoot days, the open calls, the release. The owner runs it
// from here; the crew open the call sheet from here.
export default function ProductionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [extras, setExtras] = useState({ releases: [], bookedPlaces: [] });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const [releasePick, setReleasePick] = useState('');

  const load = useCallback(async () => {
    try {
      tokenRef.current = signedIn ? await freshToken(getToken) : null;
      const data = await apiGet(`/api/productions/${id}`, tokenRef.current);
      setState({ loading: false, error: null, data });
      if (data.isOwner && tokenRef.current) {
        try { const m = await apiGet('/api/productions/mine', tokenRef.current); setExtras({ releases: m.releases || [], bookedPlaces: m.bookedPlaces || [] }); } catch (err) { /* optional */ }
      }
    } catch (err) {
      setState((s) => ({ loading: false, error: s.data ? null : err.message, data: s.data }));
    }
  }, [id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn, okNote) {
    setBusy(true);
    setNote(null);
    try {
      const data = await fn(await freshToken(getToken));
      if (data && data.production) setState((s) => ({ ...s, data }));
      else await load();
      if (okNote) setNote(okNote);
      return data || true;
    } catch (err) {
      setNote(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const data = state.data;
  const p = data ? data.production : null;
  const inside = Boolean(data && (data.isOwner || data.isMember));
  const byDept = {};
  if (data) for (const m of data.members) (byDept[m.department] = byDept[m.department] || []).push(m);

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push('/productions'))} hitSlop={8}><Text style={crew.mono}>‹ Productions</Text></Pressable>
        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {p ? (
          <>
            <View style={[crew.nameRow, { marginTop: 10 }]}>
              <StatusPill status={p.status} label={p.statusLabel} />
              <Chip label={p.kindLabel} />
              {p.visibility !== 'public' ? <Chip label={p.visibility === 'crew' ? 'crew only' : 'private'} tone="mute" /> : null}
            </View>
            <Text style={crew.h1}>{p.title}</Text>
            {p.logline ? <Text style={crew.lead}>{p.logline}</Text> : null}
            <View style={crew.metaRow}>
              <Text style={crew.meta}>{fmtRange(p.startsOn, p.endsOn)}</Text>
              {p.place ? <Text style={crew.meta}>{p.place.label}</Text> : null}
              {data.days.length ? <Text style={crew.meta}>{data.days.length} shoot {data.days.length === 1 ? 'day' : 'days'}</Text> : null}
            </View>
            <Pressable style={[crew.row, { marginTop: 8 }]} onPress={() => router.push(p.owner.profilePath)}>
              <Avatar userId={p.owner.userId} name={p.owner.displayName} src={p.owner.avatarUrl} position={p.owner.avatarPosition} zoom={p.owner.avatarZoom || 1} size={28} />
              <Text style={crew.meta}>Run by {p.owner.displayName}</Text>
              <TierChip person={p.owner} />
            </Pressable>
            {p.projectTitle ? <Chip label={`${p.projectType === 'pitch' ? 'Pitch Room' : 'Series'} · ${p.projectTitle}`} tone="ok" style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => router.push(p.projectType === 'pitch' ? `/pitches/${p.projectId}` : `/series/${p.projectId}`)} /> : null}

            {note ? <Text style={[crew.error, note.startsWith('✓') && { color: colors.ok }]}>{note}</Text> : null}

            {data.canEdit ? (
              <View style={[crew.panel, { marginTop: 10 }]}>
                <Text style={crew.label}>Status</Text>
                <View style={crew.chips}>{OWNER_STATUSES.map((s) => <Chip key={s} label={STATUS[s]} on={p.status === s} onPress={() => p.status !== s && act((t) => apiPatch(`/api/productions/${id}`, { status: s }, t))} />)}</View>
                <View style={[crew.row, { flexWrap: 'wrap', marginTop: 4 }]}>
                  <Pressable style={crew.btn} onPress={() => router.push(`/productions/${id}/edit`)}><Text style={crew.btnText}>Edit details</Text></Pressable>
                  <Pressable style={[crew.btn, crew.btnPrimary]} onPress={() => router.push({ pathname: '/crew/calls/new', params: { production: id } })}><Text style={[crew.btnText, crew.btnPrimaryText]}>+ Post a call</Text></Pressable>
                  <Pressable style={crew.btn} onPress={() => router.push('/locations')}><Text style={crew.btnText}>Book a place</Text></Pressable>
                  <Pressable style={crew.btn} onPress={() => router.push(`/productions/${id}/distribution`)}><Text style={crew.btnText}>Distribution & screeners</Text></Pressable>
                  <Pressable style={crew.btn} onPress={() => router.push({ pathname: '/resources', params: { kind: 'paperwork' } })}><Text style={crew.btnText}>Paperwork templates</Text></Pressable>
                </View>
              </View>
            ) : null}

            {/* ---- crew ---- */}
            <View style={[crew.panel, { marginTop: 10 }]}>
              <View style={[crew.row, { justifyContent: 'space-between' }]}>
                <Text style={crew.h3}>Crew · {data.members.length}</Text>
                <Text style={crew.mono}>{data.members.filter((m) => m.worked).length} confirmed worked</Text>
              </View>
              {data.members.length === 0 ? <Text style={crew.muted}>Nobody on it yet.{data.isOwner ? ' Book people through a call posted for this production, or add them below.' : ''}</Text> : null}
              {data.isOwner || data.isMember ? <Pressable onPress={() => router.push({ pathname: '/resources', params: { kind: 'paperwork' } })}><Text style={crew.mono}>Release forms, deal memos, NDAs, location agreements: Paperwork & legal in Resources ›</Text></Pressable> : null}
              {Object.entries(byDept).map(([dept, list]) => (
                <View key={dept} style={{ gap: 6 }}>
                  <Text style={crew.h4}>{dept}</Text>
                  {list.map((m) => (
                    <View key={m.id} style={[prod.member, m.worked && prod.memberWorked]}>
                      <Pressable onPress={() => router.push(m.person.profilePath)}><Avatar userId={m.person.userId} name={m.person.displayName} src={m.person.avatarUrl} position={m.person.avatarPosition} zoom={m.person.avatarZoom || 1} size={34} /></Pressable>
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <View style={crew.nameRow}><Text style={crew.name}>{m.person.displayName}</Text><TierChip person={m.person} /></View>
                        <View style={crew.chips}>
                          <Chip label={m.role} tone="role" />
                          {m.viaCall ? <Chip label="via a call" tone="mute" /> : null}
                          {m.worked ? <Chip label="✓ worked it" tone="ok" /> : null}
                          {m.mine ? <Chip label="you" tone="role" /> : null}
                        </View>
                      </View>
                      {data.canEdit ? (
                        <View style={{ gap: 4 }}>
                          {!m.worked && !m.mine && data.canConfirm ? <Pressable style={[crew.btnSm, { backgroundColor: colors.brass, borderColor: colors.brass }]} disabled={busy} onPress={() => act((t) => apiPatch(`/api/productions/${id}/members`, { memberId: m.id, worked: true }, t), '✓ Confirmed.')}><Text style={[crew.btnSmText, { color: colors.onBrass }]}>Worked it</Text></Pressable> : null}
                          <Pressable style={crew.btnSm} disabled={busy} onPress={() => Alert.alert('Remove from the crew list?', m.person.displayName, [{ text: 'Keep' }, { text: 'Remove', style: 'destructive', onPress: () => act((t) => apiDelete(`/api/productions/${id}/members`, { memberId: m.id }, t)) }])}><Text style={crew.btnSmText}>Remove</Text></Pressable>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ))}
              {data.canEdit && data.confirmHint && data.members.some((m) => !m.worked && !m.mine) ? <Text style={crew.mono}>{data.confirmHint}</Text> : null}
              {data.canEdit ? (adding
                ? <AddMember id={id} busy={busy} onDone={(r) => { setAdding(false); if (r && r.production) setState((s) => ({ ...s, data: r })); }} act={act} />
                : <Pressable style={[crew.btn, { alignSelf: 'flex-start' }]} onPress={() => setAdding(true)}><Text style={crew.btnText}>+ Add someone</Text></Pressable>) : null}
              {!data.canEdit && data.isMember ? <Pressable style={[crew.btn, crew.btnGhost, { alignSelf: 'flex-start' }]} disabled={busy} onPress={() => Alert.alert('Take yourself off this production?', 'Your credit on it goes too.', [{ text: 'Stay' }, { text: 'Take me off', style: 'destructive', onPress: () => act((t) => apiPost(`/api/productions/${id}/members`, { op: 'leave' }, t)) }])}><Text style={[crew.btnText, { color: colors.inkDim }]}>Take me off this</Text></Pressable> : null}
            </View>

            {/* ---- shoot days ---- */}
            <View style={crew.panel}>
              <Text style={crew.h3}>Shoot days · {data.days.length}</Text>
              {data.days.length === 0 ? <Text style={crew.muted}>No shoot days on the sheet yet.{data.isOwner ? ' Add them below, or book a place under this production and its dates land here.' : ''}</Text> : null}
              {data.days.map((d) => (
                <Pressable key={d.id} style={[prod.day, d.past && { opacity: 0.7 }]} disabled={!inside} onPress={() => router.push(`/productions/${id}/day/${d.dayNo}`)}>
                  <View style={[crew.row, { justifyContent: 'space-between' }]}>
                    <Text style={prod.dayNo}>Day {d.dayNo} · {d.label}</Text>
                    {inside ? <Text style={[crew.mono, { color: colors.brass }]}>Call sheet ›</Text> : null}
                  </View>
                  <Text style={crew.meta}>{d.callTime ? `call ${d.callTime}` : ''}{d.wrapTime ? ` · wrap ${d.wrapTime}` : ''}{d.placeLabel ? ` · ${d.placeLabel}` : ''}</Text>
                </Pressable>
              ))}
              {data.canEdit ? (addingDay
                ? <DayForm bookedPlaces={extras.bookedPlaces} busy={busy} onSubmit={(body) => act((t) => apiPut(`/api/productions/${id}/days`, body, t)).then((r) => r && setAddingDay(false))} onCancel={() => setAddingDay(false)} />
                : <Pressable style={[crew.btn, { alignSelf: 'flex-start' }]} onPress={() => setAddingDay(true)}><Text style={crew.btnText}>+ Add a shoot day</Text></Pressable>) : null}
              {!inside && data.days.length ? <Text style={crew.mono}>Call times, addresses and house rules are on the call sheet, for the crew.</Text> : null}
            </View>

            {inside && p.notes ? <View style={crew.panel}><Text style={crew.h3}>Notes for the crew</Text><Text style={crew.bio}>{p.notes}</Text></View> : null}

            {/* ---- open calls ---- */}
            <View style={crew.panel}>
              <Text style={crew.h3}>Crew needed</Text>
              {data.calls.length === 0 ? <Text style={crew.muted}>No open calls for this production right now.</Text> : null}
              {data.calls.map((c) => <CallCard key={c.id} c={c} onOpen={() => router.push(`/crew/calls/${c.id}`)} />)}
            </View>

            {/* ---- release ---- */}
            <View style={crew.panel}>
              <Text style={crew.h3}>The release</Text>
              {p.release ? (
                <>
                  <Text style={crew.muted}>Out on Studio Tapa as <Text style={{ color: colors.ink }}>{p.release.title}</Text>. Everyone confirmed above has it on their profile with their role.</Text>
                  <View style={crew.row}>
                    <Pressable style={crew.btn} onPress={() => router.push(p.release.type === 'series' ? `/series/${p.release.id}` : `/episode/${p.release.id}`)}><Text style={crew.btnText}>▶ Open it</Text></Pressable>
                    {data.isOwner ? <Pressable style={[crew.btn, crew.btnGhost]} disabled={busy} onPress={() => Alert.alert('Unlink the release?', 'The crew’s credits for it come off their profiles until you link it again.', [{ text: 'Keep' }, { text: 'Unlink', style: 'destructive', onPress: () => act((t) => apiPatch(`/api/productions/${id}`, { release: null }, t)) }])}><Text style={[crew.btnText, { color: colors.inkDim }]}>Unlink</Text></Pressable> : null}
                  </View>
                </>
              ) : data.isOwner ? (
                extras.releases.length === 0
                  ? <Text style={crew.muted}>When the finished title is live on Studio Tapa (uploaded by you and approved), it shows up here to link — and everyone confirmed on the crew gets the credit.</Text>
                  : (
                    <>
                      <Text style={crew.label}>Released on Studio Tapa as</Text>
                      <View style={crew.chips}>{extras.releases.map((r) => <Chip key={r.value} label={r.label} on={releasePick === r.value} onPress={() => setReleasePick(r.value)} />)}</View>
                      <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }, (!releasePick || busy) && { opacity: 0.6 }]} disabled={!releasePick || busy} onPress={() => { const [type, rid] = releasePick.split(':'); act((t) => apiPatch(`/api/productions/${id}`, { release: { type, id: rid } }, t), '✓ Linked — the crew has been told.'); }}><Text style={[crew.btnText, crew.btnPrimaryText]}>Link it</Text></Pressable>
                    </>
                  )
              ) : <Text style={crew.muted}>Not released on Studio Tapa yet. When it is, the people confirmed above get the credit.</Text>}
            </View>

            <View style={[crew.row, { flexWrap: 'wrap' }]}>
              {signedIn && !data.isOwner ? <ReportSheet targetType="production" targetId={p.id} title={p.title} /> : null}
              {data.isOwner && p.status !== 'archived' ? <Pressable style={[crew.btn, crew.btnGhost]} disabled={busy} onPress={() => Alert.alert('Archive this production?', 'It leaves the public list; you keep it.', [{ text: 'Keep' }, { text: 'Archive', onPress: () => act((t) => apiPatch(`/api/productions/${id}`, { status: 'archived' }, t)) }])}><Text style={[crew.btnText, { color: colors.inkDim }]}>Archive</Text></Pressable> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AddMember({ id, busy, onDone, act }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState(null);
  const [people, setPeople] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (picked || q.trim().length < 2 || q.trim().startsWith('@')) { setPeople([]); return undefined; }
    timer.current = setTimeout(async () => {
      try { const d = await apiGet(`/api/crew/people?q=${encodeURIComponent(q.trim())}`); setPeople((d.people || []).slice(0, 6)); } catch (err) { /* nothing */ }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q, picked]);

  const submit = () => act((t) => apiPost(`/api/productions/${id}/members`, picked ? { userId: picked.userId, role } : { handle: q.trim(), role }, t)).then((r) => { if (r) onDone(r); });

  return (
    <View style={[crew.panel, { borderStyle: 'dashed', marginBottom: 0 }]}>
      <Text style={crew.label}>Who</Text>
      <TextInput style={crew.input} value={picked ? picked.displayName : q} onChangeText={(v) => { setPicked(null); setQ(v); }} placeholder="Name on Crew Call, or @handle" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} />
      {people.length > 0 && !picked ? (
        <View style={crew.suggest}>
          {people.map((x) => (
            <Pressable key={x.userId} style={[crew.suggestRow, crew.row]} onPress={() => { setPicked({ userId: x.userId, displayName: x.displayName }); setPeople([]); }}>
              <Avatar userId={x.userId} name={x.displayName} src={x.avatarUrl} position={x.avatarPosition} zoom={x.avatarZoom || 1} size={26} />
              <Text style={crew.suggestText}>{x.displayName}{x.handle ? <Text style={crew.handle}> @{x.handle}</Text> : null}</Text>
              <Text style={[crew.mono, { flex: 1, textAlign: 'right' }]}>{(x.roles || []).slice(0, 2).join(', ')}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={[crew.label, { marginTop: 6 }]}>Role</Text>
      <TextInput style={crew.input} value={role} onChangeText={setRole} placeholder="Gaffer" placeholderTextColor={colors.inkFaint} maxLength={40} />
      <View style={[crew.row, { marginTop: 4 }]}>
        <Pressable style={[crew.btn, crew.btnPrimary, (busy || (!picked && q.trim().length < 2) || role.trim().length < 2) && { opacity: 0.6 }]} disabled={busy || (!picked && q.trim().length < 2) || role.trim().length < 2} onPress={submit}><Text style={[crew.btnText, crew.btnPrimaryText]}>Add</Text></Pressable>
        <Pressable style={[crew.btn, crew.btnGhost]} onPress={() => onDone(null)}><Text style={[crew.btnText, { color: colors.inkDim }]}>Cancel</Text></Pressable>
      </View>
      <Text style={crew.mono}>They get a notification and can take themselves off.</Text>
    </View>
  );
}
