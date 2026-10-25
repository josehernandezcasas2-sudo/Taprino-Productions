import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '../lib/theme';
import { apiPost } from '../lib/api';
import { crew, Avatar, Chip, TierChip } from './CrewBits';
import SmartImage from './SmartImage';
import { pickImage, resolveToken } from './LocationBits';

// Casting (migration 106; components/crew/CastingBits.js on the web):
// the performer side of a card, the Cast tab's cards, the self-tape link.
export const UNION = { non_union: 'Non-union', sag_aftra: 'SAG-AFTRA', sag_eligible: 'SAG-eligible', other: 'Other union' };
export const SKILLS = ['Improv', 'Stage combat', 'Stunts', 'Dance', 'Singing', 'Accents', 'Spanish', 'Instruments', 'Comedy', 'Drama', 'Horseback', 'Driving (manual)', 'Swimming', 'Martial arts', 'Sign language', 'Puppetry', 'Voice-over'];
export const MAX_HEADSHOTS = 6;

export function playingAge(min, max) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? `plays ${min}` : `plays ${min}–${max}`;
  return `plays ${min != null ? `${min}+` : `up to ${max}`}`;
}

export function PerformerFacts({ card }) {
  if (!card || !card.performer) return null;
  const facts = [playingAge(card.playingAgeMin, card.playingAgeMax), card.unionLabel].filter(Boolean);
  return (
    <View style={{ gap: 6 }}>
      {card.headshots && card.headshots.length ? (
        <View style={styles.shots}>{card.headshots.map((h) => <View key={h.id || h.url} style={styles.shot}><SmartImage uri={h.url} style={StyleSheet.absoluteFill} /></View>)}</View>
      ) : null}
      <View style={crew.metaRow}>
        <Chip label="Performer" tone="gear" />
        {facts.map((f) => <Text key={f} style={crew.meta}>{f}</Text>)}
        {card.reelUrl ? <Pressable onPress={() => Linking.openURL(card.reelUrl)}><Text style={[crew.meta, { color: colors.olive }]}>Reel ↗</Text></Pressable> : null}
      </View>
      {card.skills && card.skills.length ? <View style={crew.chips}>{card.skills.map((s) => <Chip key={s} label={s} />)}</View> : null}
    </View>
  );
}

export function CastCard({ p, onOpen, onMessage }) {
  const shot = p.headshots && p.headshots[0] ? p.headshots[0].url : null;
  const where = [p.place, p.miles != null ? `${p.miles} mi` : null].filter(Boolean).join(' · ');
  return (
    <Pressable style={[crew.panel, { padding: 0, overflow: 'hidden' }]} onPress={onOpen}>
      <View style={styles.cardShot}>
        {shot ? <SmartImage uri={shot} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom || 1} size={72} /></View>}
        {p.freeNow ? <View style={[crew.chip, crew.chipUrgent, { position: 'absolute', left: 8, bottom: 8 }]}><Text style={[crew.chipText, { color: colors.danger }]}>⚡ free right now</Text></View> : null}
      </View>
      <View style={{ padding: 12, gap: 6 }}>
        <View style={crew.nameRow}><Text style={crew.name}>{p.displayName}</Text>{p.verified ? <Text style={crew.ver}>✓ CREATOR</Text> : null}<TierChip person={p} /></View>
        <View style={crew.metaRow}>
          {playingAge(p.playingAgeMin, p.playingAgeMax) ? <Text style={crew.meta}>{playingAge(p.playingAgeMin, p.playingAgeMax)}</Text> : null}
          {p.unionLabel ? <Text style={crew.meta}>{p.unionLabel}</Text> : null}
          {where ? <Text style={crew.meta}>{where}</Text> : null}
        </View>
        <View style={crew.chips}>{p.roles.slice(0, 3).map((r) => <Chip key={r} label={r} tone="role" />)}{(p.skills || []).slice(0, 4).map((s) => <Chip key={s} label={s} />)}</View>
        <View style={[crew.row, { marginTop: 2 }]}>
          {p.reelUrl ? <Pressable style={crew.btnSm} onPress={() => Linking.openURL(p.reelUrl)}><Text style={crew.btnSmText}>Reel ↗</Text></Pressable> : null}
          <Pressable style={crew.btnSm} onPress={onOpen}><Text style={crew.btnSmText}>View profile</Text></Pressable>
          {onMessage ? <Pressable style={[crew.btnSm, crew.btnPrimary]} onPress={onMessage}><Text style={[crew.btnSmText, crew.btnPrimaryText]}>Message</Text></Pressable> : null}
        </View>
      </View>
    </Pressable>
  );
}

// The card editor's performer section. `form`/`set` are the screen's;
// `token` is getToken for the headshot upload.
export function PerformerEditor({ form, set, token, onError }) {
  const [skill, setSkill] = useState('');
  const [busy, setBusy] = useState(false);
  const addSkill = (raw) => {
    const parts = String(raw || skill).split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    set({ skills: [...new Set([...form.skills, ...parts])].slice(0, 12) });
    setSkill('');
  };
  async function addHeadshot() {
    if (form.headshots.length >= MAX_HEADSHOTS) return;
    setBusy(true);
    try {
      const picked = await pickImage(1600);
      if (!picked) return;
      const data = await apiPost('/api/crew/headshot', { base64: picked.base64, fileName: 'headshot.jpg' }, await resolveToken(token));
      set({ headshots: [...form.headshots, { url: data.url }] });
    } catch (err) {
      if (onError) onError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={crew.panel}>
      <Text style={crew.h3}>Performer · acting, voice, background, dance…</Text>
      <Pressable style={crew.row} onPress={() => set({ performer: !form.performer })}>
        <View style={[styles.box, form.performer && styles.boxOn]}>{form.performer ? <Text style={styles.tick}>✓</Text> : null}</View>
        <Text style={[crew.rowText, { flex: 1 }]}>I perform — list me on the Cast tab and send me casting calls</Text>
      </Pressable>
      {form.performer ? (
        <>
          <Text style={[crew.label, { marginTop: 6 }]}>Playing age</Text>
          <View style={crew.row}>
            <TextInput style={[crew.input, { flex: 1 }]} value={form.playingAgeMin} onChangeText={(v) => set({ playingAgeMin: v.replace(/[^0-9]/g, '') })} placeholder="from" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" />
            <TextInput style={[crew.input, { flex: 1 }]} value={form.playingAgeMax} onChangeText={(v) => set({ playingAgeMax: v.replace(/[^0-9]/g, '') })} placeholder="to" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" />
          </View>
          <Text style={[crew.label, { marginTop: 6 }]}>Union</Text>
          <View style={crew.chips}>
            <Chip label="Prefer not to say" on={!form.unionStatus} onPress={() => set({ unionStatus: '' })} />
            {Object.entries(UNION).map(([k, v]) => <Chip key={k} label={v} on={form.unionStatus === k} onPress={() => set({ unionStatus: k })} />)}
          </View>
          <Text style={[crew.label, { marginTop: 6 }]}>Reel</Text>
          <TextInput style={crew.input} value={form.reelUrl} onChangeText={(v) => set({ reelUrl: v })} placeholder="https://vimeo.com/… or an unlisted YouTube link" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} />
          <Text style={[crew.label, { marginTop: 6 }]}>Skills</Text>
          {form.skills.length ? <View style={crew.chips}>{form.skills.map((s) => <Chip key={s} label={`${s} ✕`} onPress={() => set({ skills: form.skills.filter((x) => x !== s) })} />)}</View> : null}
          <View style={crew.chips}>{SKILLS.filter((s) => !form.skills.includes(s)).slice(0, 10).map((s) => <Chip key={s} label={`+ ${s}`} onPress={() => addSkill(s)} />)}</View>
          <View style={crew.row}>
            <TextInput style={[crew.input, { flex: 1 }]} value={skill} onChangeText={setSkill} placeholder="Anything else (accents, instruments…)" placeholderTextColor={colors.inkFaint} onSubmitEditing={() => addSkill()} />
            <Pressable style={crew.btnSm} onPress={() => addSkill()}><Text style={crew.btnSmText}>Add</Text></Pressable>
          </View>
          <Text style={[crew.label, { marginTop: 6 }]}>Headshots · up to {MAX_HEADSHOTS}</Text>
          <View style={styles.shots}>
            {form.headshots.map((h, i) => (
              <Pressable key={h.url} style={styles.shot} onLongPress={() => set({ headshots: form.headshots.filter((_, j) => j !== i) })}>
                <SmartImage uri={h.url} style={StyleSheet.absoluteFill} />
                <Pressable style={styles.x} onPress={() => set({ headshots: form.headshots.filter((_, j) => j !== i) })}><Text style={{ color: '#fff', fontSize: 12 }}>✕</Text></Pressable>
              </Pressable>
            ))}
            {form.headshots.length < MAX_HEADSHOTS ? <Pressable style={styles.shotAdd} onPress={addHeadshot} disabled={busy}><Text style={crew.meta}>{busy ? '…' : '+ Add'}</Text></Pressable> : null}
          </View>
          <Text style={crew.mono}>The first one is your card photo on the Cast tab.</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  shot: { width: 72, height: 92, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface2 },
  shotAdd: { width: 72, height: 92, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.oceanInk, alignItems: 'center', justifyContent: 'center' },
  x: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 },
  cardShot: { aspectRatio: 4 / 5, backgroundColor: colors.surface2 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: colors.oceanInk, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  tick: { color: colors.onBrass, fontFamily: fonts.displayBold, fontSize: 13 }
});
