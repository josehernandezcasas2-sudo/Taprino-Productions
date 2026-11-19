import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../lib/stableAuth';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, freshToken, pathId } from '../../../lib/api';
import { brassTint, colors, fonts } from '../../../lib/theme';
import { DASH_WORDS, MANAGER_STATUSES, PITCH_WORDS, isProducerRole, productionFundingCard } from '../../../lib/productionDashRules';
import TopNav from '../../../components/TopNav';
import ReportSheet from '../../../components/ReportSheet';
import { hrefToRoute } from '../../../components/PushListener';
import { crew, Chip, Avatar, TierChip, CallCard } from '../../../components/CrewBits';
import { StatusPill, DayForm, OWNER_STATUSES, STATUS, fmtRange, prod } from '../../../components/ProductionBits';
import { startConversation } from '../../../components/messages/MessageBits';
import AddMember from '../../../components/productions/AddMember';
import { Bar } from '../../../components/productions/DashBits';

// One production (pages/productions/<id> on the web): what it is, who's
// on it, the shoot days, the open calls, the release. The people running
// it (its owner, a crew member listed as a producer, full admins:
// `canManage` / `canEdit`) run it from here, and get "Dashboard ›" at the
// top (2026-11-19); the owner keeps archiving, the release link and
// distribution (`canOwn`). The crew open the call sheet from here. When it
// grew out of a pitch, everyone who can see it gets the small Funding card
// (lib/productionDashRules.js productionFundingCard).
export default function ProductionScreen() {
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams();
  const id = pathId(rawId);
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
      // A listed producer attaches the places they booked themselves too.
      if ((data.isOwner || data.canManage) && tokenRef.current) {
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
  // Messages from the production (2026-11-18): the people on it write to
  // each other about it — whoever runs it to anyone on the crew list,
  // someone on the crew to the producer. The conversation says it is about
  // this production and links back here (lib/messageContext.js checks both
  // are on it). Since the review of 2026-11-19, as on the website, the
  // Message buttons on the crew rows are for someone running it who is ON
  // it (the owner, a listed producer): a full admin who isn't gets none.
  const canMessage = (m) => Boolean(signedIn && data && (data.isOwner || data.isMember) && data.canEdit && !m.mine && m.person && m.person.userId && m.person.userId !== userId);
  const canMessageProducer = Boolean(signedIn && data && !data.isOwner && data.isMember && p && p.owner && p.owner.userId && p.owner.userId !== userId);
  const messageAbout = (to) => startConversation(router, { to, kind: 'production', ref: p.id, label: p.title });
  // What only the owner (and full admins) do; an older server without
  // canOwn answers for its owner alone.
  const canOwn = Boolean(data && (data.canOwn !== undefined ? data.canOwn : data.isOwner));
  // A listed producer moves it between prep and released; only the owner
  // archives it, or reopens an archived one.
  const statusChoices = canOwn ? OWNER_STATUSES : [...MANAGER_STATUSES, ...(p && !MANAGER_STATUSES.includes(p.status) ? [p.status] : [])];
  const statusLocked = Boolean(p && !canOwn && ['archived', 'removed'].includes(p.status));
  // The owner's row, and a producer's, come off only by the owner's hand.
  const canRemove = (m) => canOwn || (m.person && p && p.owner && m.person.userId !== p.owner.userId && !isProducerRole(m.role));
  const fundingCard = data ? productionFundingCard(data.funding) : null;
  function follow(href) {
    const where = hrefToRoute(href);
    if (!where) return;
    if (where.route) router.push(where.route);
    else Linking.openURL(where.url).catch(() => {});
  }

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <View style={pr.crumbs}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push('/productions'))} hitSlop={8}><Text style={crew.mono}>‹ Productions</Text></Pressable>
          {data && data.dashboardHref ? (
            <Pressable onPress={() => follow(data.dashboardHref)} hitSlop={8} style={pr.dashLink} accessibilityRole="link">
              <Text style={pr.dashLinkText}>{DASH_WORDS.link} ›</Text>
            </Pressable>
          ) : null}
        </View>
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

            {/* The pitch it grew out of, still taking backing (2026-11-19). */}
            {fundingCard ? (
              <View style={[crew.panel, pr.funding]} accessibilityLabel={PITCH_WORDS.fundingCard}>
                <View style={[crew.row, { justifyContent: 'space-between' }]}>
                  <Text style={[crew.mono, { flexShrink: 1 }]}>{fundingCard.kicker}</Text>
                  {fundingCard.percent != null ? <Text style={pr.fundingPct}>{fundingCard.percent}%</Text> : null}
                </View>
                <Text style={pr.fundingLine}>{fundingCard.line}</Text>
                <Bar percent={fundingCard.percent} />
                <Pressable style={[crew.btn, fundingCard.button.primary && crew.btnPrimary, { alignSelf: 'flex-start', minHeight: 44 }]} onPress={() => follow(fundingCard.button.href)} accessibilityRole="link">
                  <Text style={[crew.btnText, fundingCard.button.primary && crew.btnPrimaryText]}>{fundingCard.button.label} ›</Text>
                </Pressable>
              </View>
            ) : null}

            {data.canEdit ? (
              <View style={[crew.panel, { marginTop: 10 }]}>
                <Text style={crew.label}>Status</Text>
                <View style={crew.chips}>{statusChoices.map((s) => <Chip key={s} label={STATUS[s]} on={p.status === s} onPress={statusLocked ? undefined : () => p.status !== s && act((t) => apiPatch(`/api/productions/${id}`, { status: s }, t))} />)}</View>
                <View style={[crew.row, { flexWrap: 'wrap', marginTop: 4 }]}>
                  <Pressable style={crew.btn} onPress={() => router.push(`/productions/${id}/edit`)}><Text style={crew.btnText}>Edit details</Text></Pressable>
                  <Pressable style={[crew.btn, crew.btnPrimary]} onPress={() => router.push({ pathname: '/crew/calls/new', params: { production: id } })}><Text style={[crew.btnText, crew.btnPrimaryText]}>+ Post a call</Text></Pressable>
                  <Pressable style={crew.btn} onPress={() => router.push('/locations')}><Text style={crew.btnText}>Book a place</Text></Pressable>
                  {canOwn ? <Pressable style={crew.btn} onPress={() => router.push(`/productions/${id}/distribution`)}><Text style={crew.btnText}>Distribution & screeners</Text></Pressable> : null}
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
              {data.members.length === 0 ? <Text style={crew.muted}>Nobody on it yet.{data.canEdit ? ' Book people through a call posted for this production, or add them below.' : ''}</Text> : null}
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
                      {data.canEdit || canMessage(m) ? (
                        <View style={{ gap: 4 }}>
                          {canMessage(m) ? <Pressable style={crew.btnSm} onPress={() => messageAbout(m.person.userId)} accessibilityRole="button" accessibilityLabel={`Message ${m.person.displayName}`}><Text style={crew.btnSmText}>Message</Text></Pressable> : null}
                          {data.canEdit && !m.worked && !m.mine && data.canConfirm ? <Pressable style={[crew.btnSm, { backgroundColor: colors.brass, borderColor: colors.brass }]} disabled={busy} onPress={() => act((t) => apiPatch(`/api/productions/${id}/members`, { memberId: m.id, worked: true }, t), '✓ Confirmed.')}><Text style={[crew.btnSmText, { color: colors.onBrass }]}>Worked it</Text></Pressable> : null}
                          {data.canEdit && canRemove(m) ? <Pressable style={crew.btnSm} disabled={busy} onPress={() => Alert.alert('Remove from the crew list?', m.person.displayName, [{ text: 'Keep' }, { text: 'Remove', style: 'destructive', onPress: () => act((t) => apiDelete(`/api/productions/${id}/members`, { memberId: m.id }, t)) }])}><Text style={crew.btnSmText}>Remove</Text></Pressable> : null}
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
              {canMessageProducer || (!data.canEdit && data.isMember) ? (
                <View style={[crew.row, { flexWrap: 'wrap' }]}>
                  {canMessageProducer ? <Pressable style={crew.btn} onPress={() => messageAbout(p.owner.userId)} accessibilityRole="button"><Text style={crew.btnText}>Message the producer</Text></Pressable> : null}
                  {!data.canEdit && data.isMember ? <Pressable style={[crew.btn, crew.btnGhost]} disabled={busy} onPress={() => Alert.alert('Take yourself off this production?', 'Your credit on it goes too.', [{ text: 'Stay' }, { text: 'Take me off', style: 'destructive', onPress: () => act((t) => apiPost(`/api/productions/${id}/members`, { op: 'leave' }, t)) }])}><Text style={[crew.btnText, { color: colors.inkDim }]}>Take me off this</Text></Pressable> : null}
                </View>
              ) : null}
            </View>

            {/* ---- shoot days ---- */}
            <View style={crew.panel}>
              <Text style={crew.h3}>Shoot days · {data.days.length}</Text>
              {data.days.length === 0 ? <Text style={crew.muted}>No shoot days on the sheet yet.{data.canEdit ? ' Add them below, or book a place under this production and its dates land here.' : ''}</Text> : null}
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
                    {canOwn ? <Pressable style={[crew.btn, crew.btnGhost]} disabled={busy} onPress={() => Alert.alert('Unlink the release?', 'The crew’s credits for it come off their profiles until you link it again.', [{ text: 'Keep' }, { text: 'Unlink', style: 'destructive', onPress: () => act((t) => apiPatch(`/api/productions/${id}`, { release: null }, t)) }])}><Text style={[crew.btnText, { color: colors.inkDim }]}>Unlink</Text></Pressable> : null}
                  </View>
                </>
              ) : canOwn ? (
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
              {canOwn && p.status !== 'archived' ? <Pressable style={[crew.btn, crew.btnGhost]} disabled={busy} onPress={() => Alert.alert('Archive this production?', 'It leaves the public list; you keep it.', [{ text: 'Keep' }, { text: 'Archive', onPress: () => act((t) => apiPatch(`/api/productions/${id}`, { status: 'archived' }, t)) }])}><Text style={[crew.btnText, { color: colors.inkDim }]}>Archive</Text></Pressable> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const pr = StyleSheet.create({
  crumbs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  dashLink: { minHeight: 44, justifyContent: 'center' },
  dashLinkText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.brass },
  funding: { marginTop: 10, borderColor: brassTint(0.4) },
  fundingPct: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.mint },
  fundingLine: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink }
});
