import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '../lib/theme';
import { crew, Chip, Avatar, TierChip, PlaceBox } from './CrewBits';

// Pieces for the Productions screens (pages/productions/* on the web,
// components/productions/* there). Vocabularies mirror lib/productionRules.js;
// the screens also fetch /api/productions/options for the live lists.

export const KINDS = { short: 'Short film', feature: 'Feature', series: 'Series', documentary: 'Documentary', podcast: 'Podcast', music_video: 'Music video', commercial: 'Commercial / branded', vertical: 'Vertical / Snippets', other: 'Other' };
export const STATUS = { prep: 'In prep', shooting: 'Shooting', post: 'In post', released: 'Released', archived: 'Archived', removed: 'Removed' };
export const OWNER_STATUSES = ['prep', 'shooting', 'post', 'released', 'archived'];
export const VISIBILITY = { public: 'Public', crew: 'Crew only', private: 'Just me' };
const STATUS_COLOR = { shooting: colors.brass, prep: colors.olive, post: colors.sky, released: colors.ok };

export function fmtRange(a, b) {
  const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!a) return 'Dates to confirm';
  return !b || b === a ? f(a) : `${f(a)}–${f(b)}`;
}
export function fmtDay(d) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
}

export function StatusPill({ status, label }) {
  const c = STATUS_COLOR[status] || colors.inkFaint;
  return (
    <View style={[crew.tier, { borderColor: c }]}>
      <View style={[crew.tierDot, { backgroundColor: c }]} />
      <Text style={[crew.tierText, { color: c }]}>{(label || STATUS[status] || status).toUpperCase()}</Text>
    </View>
  );
}

export function ProductionCard({ p, roles = null, onOpen }) {
  return (
    <Pressable style={crew.panel} onPress={onOpen}>
      <View style={crew.nameRow}>
        <StatusPill status={p.status} label={p.statusLabel} />
        <Chip label={p.kindLabel} />
        {p.release ? <Chip label="on Studio Tapa" tone="ok" /> : null}
        {p.mine ? <Chip label="yours" tone="role" /> : null}
        {p.visibility && p.visibility !== 'public' ? <Chip label={p.visibility === 'crew' ? 'crew only' : 'private'} tone="mute" /> : null}
      </View>
      <Text style={crew.name}>{p.title}</Text>
      {p.logline ? <Text style={crew.muted} numberOfLines={2}>{p.logline}</Text> : null}
      <View style={crew.metaRow}>
        <Text style={crew.meta}>{fmtRange(p.startsOn, p.endsOn)}</Text>
        {p.place ? <Text style={crew.meta}>{p.place.label}</Text> : null}
        {p.membersCount != null ? <Text style={crew.meta}>{p.membersCount} crew</Text> : null}
        {p.openCalls > 0 ? <Text style={[crew.meta, { color: colors.brass }]}>{p.openCalls} open {p.openCalls === 1 ? 'call' : 'calls'}</Text> : null}
        {roles && roles.length ? <Text style={crew.meta}>you: {roles.join(', ')}</Text> : null}
      </View>
      {p.owner ? (
        <View style={crew.row}>
          <Avatar userId={p.owner.userId} name={p.owner.displayName} src={p.owner.avatarUrl} position={p.owner.avatarPosition} zoom={p.owner.avatarZoom || 1} size={26} />
          <Text style={crew.meta}>{p.owner.displayName}</Text>
          <TierChip person={p.owner} />
        </View>
      ) : null}
    </Pressable>
  );
}

// Start / edit a production. `onSubmit(body)` does the request.
export function ProductionForm({ initial = null, projects = [], busy, error, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    title: initial ? initial.title : '',
    logline: initial ? initial.logline : '',
    kind: initial ? initial.kind : 'short',
    startsOn: initial ? initial.startsOn || '' : '',
    endsOn: initial ? initial.endsOn || '' : '',
    place: initial && initial.place ? initial.place : null,
    project: initial && initial.projectType ? `${initial.projectType}:${initial.projectId}` : '',
    notes: initial ? initial.notes || '' : '',
    visibility: initial ? initial.visibility : 'public'
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const submit = () => {
    const [type, id] = form.project ? form.project.split(':') : [null, null];
    onSubmit({ ...form, project: type ? { type, id } : null });
  };
  return (
    <>
      <View style={crew.panel}>
        <Text style={crew.label}>Title</Text>
        <TextInput style={crew.input} value={form.title} onChangeText={(v) => set({ title: v })} placeholder="The Long Night Shift" placeholderTextColor={colors.inkFaint} maxLength={90} />
        <Text style={[crew.label, { marginTop: 6 }]}>Logline</Text>
        <TextInput style={crew.input} value={form.logline} onChangeText={(v) => set({ logline: v })} placeholder="One line on what it is." placeholderTextColor={colors.inkFaint} maxLength={300} />
        <Text style={[crew.label, { marginTop: 6 }]}>Kind</Text>
        <View style={crew.chips}>{Object.entries(KINDS).map(([k, v]) => <Chip key={k} label={v} on={form.kind === k} onPress={() => set({ kind: k })} />)}</View>
      </View>
      <View style={crew.panel}>
        <Text style={crew.label}>Shoot days (YYYY-MM-DD)</Text>
        <View style={crew.row}>
          <TextInput style={[crew.input, { flex: 1 }]} value={form.startsOn} onChangeText={(v) => set({ startsOn: v })} placeholder="First day" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
          <TextInput style={[crew.input, { flex: 1 }]} value={form.endsOn} onChangeText={(v) => set({ endsOn: v })} placeholder="Last day" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
        </View>
        <Text style={[crew.label, { marginTop: 6 }]}>Home base</Text>
        <PlaceBox value={form.place} onChange={(p) => set({ place: p })} placeholder="City (pick from the suggestions)" />
      </View>
      {projects.length > 0 ? (
        <View style={crew.panel}>
          <Text style={crew.label}>Grew out of (optional)</Text>
          <View style={crew.chips}>
            <Chip label="Nothing yet" on={!form.project} onPress={() => set({ project: '' })} />
            {projects.map((p) => <Chip key={p.value} label={p.label} on={form.project === p.value} onPress={() => set({ project: p.value })} />)}
          </View>
        </View>
      ) : null}
      <View style={crew.panel}>
        <Text style={crew.label}>Who sees it</Text>
        <View style={crew.chips}>{Object.entries(VISIBILITY).map(([k, v]) => <Chip key={k} label={v} on={form.visibility === k} onPress={() => set({ visibility: k })} />)}</View>
        <Text style={[crew.label, { marginTop: 6 }]}>Notes for the crew</Text>
        <TextInput style={[crew.input, { minHeight: 90, textAlignVertical: 'top' }]} value={form.notes} onChangeText={(v) => set({ notes: v })} placeholder="How the shoot runs, comms, who to call. The crew sees this; the public doesn’t." placeholderTextColor={colors.inkFaint} multiline maxLength={4000} />
      </View>
      {error ? <Text style={crew.error}>{error}</Text> : null}
      <View style={crew.row}>
        <Pressable style={[crew.btn, crew.btnPrimary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy || form.title.trim().length < 2}><Text style={[crew.btnText, crew.btnPrimaryText]}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Start the production'}</Text></Pressable>
        {onCancel ? <Pressable style={[crew.btn, crew.btnGhost]} onPress={onCancel}><Text style={[crew.btnText, { color: colors.inkDim }]}>Cancel</Text></Pressable> : null}
      </View>
    </>
  );
}

// Add / edit a shoot day. `onSubmit(body)` does the PUT.
export function DayForm({ initial = null, bookedPlaces = [], busy, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    shootOn: initial ? initial.shootOn : '',
    callTime: initial ? initial.callTime : '07:00',
    wrapTime: initial ? initial.wrapTime : '19:00',
    locationId: initial && initial.locationId ? initial.locationId : '',
    placeLabel: initial ? initial.placeLabel : '',
    address: initial ? initial.address || '' : '',
    parking: initial ? initial.parking || '' : '',
    scenes: initial ? initial.scenes || '' : '',
    notes: initial ? initial.notes || '' : ''
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  return (
    <View style={[crew.panel, { borderStyle: 'dashed' }]}>
      <Text style={crew.label}>Date (YYYY-MM-DD)</Text>
      <TextInput style={crew.input} value={form.shootOn} onChangeText={(v) => set({ shootOn: v })} placeholder="2026-11-02" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
      <View style={crew.row}>
        <View style={{ flex: 1 }}><Text style={crew.label}>Call</Text><TextInput style={crew.input} value={form.callTime} onChangeText={(v) => set({ callTime: v })} placeholder="07:00" placeholderTextColor={colors.inkFaint} /></View>
        <View style={{ flex: 1 }}><Text style={crew.label}>Wrap</Text><TextInput style={crew.input} value={form.wrapTime} onChangeText={(v) => set({ wrapTime: v })} placeholder="19:00" placeholderTextColor={colors.inkFaint} /></View>
      </View>
      <Text style={[crew.label, { marginTop: 6 }]}>Where</Text>
      {bookedPlaces.length > 0 ? (
        <View style={crew.chips}>
          <Chip label="A place I type in" on={!form.locationId} onPress={() => set({ locationId: '' })} />
          {bookedPlaces.map((b) => <Chip key={b.value} label={`Booked · ${b.label}`} on={form.locationId === b.value} onPress={() => set({ locationId: b.value })} />)}
        </View>
      ) : null}
      {!form.locationId ? (
        <>
          <TextInput style={crew.input} value={form.placeLabel} onChangeText={(v) => set({ placeLabel: v })} placeholder="Place name" placeholderTextColor={colors.inkFaint} maxLength={120} />
          <TextInput style={crew.input} value={form.address} onChangeText={(v) => set({ address: v })} placeholder="Street address — the crew sees this, nobody else" placeholderTextColor={colors.inkFaint} maxLength={300} />
        </>
      ) : <Text style={crew.mono}>The address, access notes and house rules come from the listing.</Text>}
      <Text style={[crew.label, { marginTop: 6 }]}>Parking & arrival</Text>
      <TextInput style={crew.input} value={form.parking} onChangeText={(v) => set({ parking: v })} placeholder="Street parking on Fargo; load in through the side gate." placeholderTextColor={colors.inkFaint} maxLength={600} />
      <Text style={[crew.label, { marginTop: 6 }]}>Scenes / what we’re shooting</Text>
      <TextInput style={crew.input} value={form.scenes} onChangeText={(v) => set({ scenes: v })} placeholder="Sc. 4, 7, 12 — kitchen day interiors" placeholderTextColor={colors.inkFaint} maxLength={1000} />
      <Text style={[crew.label, { marginTop: 6 }]}>Notes</Text>
      <TextInput style={[crew.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.notes} onChangeText={(v) => set({ notes: v })} placeholder="Weather, meals, wardrobe, anything the crew needs to know." placeholderTextColor={colors.inkFaint} multiline />
      <View style={[crew.row, { marginTop: 4 }]}>
        <Pressable style={[crew.btn, crew.btnPrimary, (busy || !form.shootOn) && { opacity: 0.6 }]} disabled={busy || !form.shootOn} onPress={() => onSubmit({ ...form, dayId: initial ? initial.id : undefined, locationId: form.locationId || null })}><Text style={[crew.btnText, crew.btnPrimaryText]}>{initial ? 'Save the day' : 'Add the day'}</Text></Pressable>
        {onCancel ? <Pressable style={[crew.btn, crew.btnGhost]} onPress={onCancel}><Text style={[crew.btnText, { color: colors.inkDim }]}>Cancel</Text></Pressable> : null}
      </View>
      <Text style={crew.mono}>The crew is told when a day goes up or changes.</Text>
    </View>
  );
}

export const prod = StyleSheet.create({
  day: { backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  dayNo: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  member: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  memberWorked: { borderWidth: 1, borderColor: 'rgba(132,205,152,0.45)' },
  bigTime: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink },
  timeBox: { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, padding: 10, gap: 2 },
  place: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink },
  addr: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink, lineHeight: 20 },
  dept: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.brass, marginTop: 6, marginBottom: 2 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.hairline }
});
