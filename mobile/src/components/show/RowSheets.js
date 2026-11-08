import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, inkTint, oliveTint } from '../../lib/theme';
import { Sheet, SmallButton, ss } from './ShowBits';
import { extraKindLabel } from '../../lib/extraKinds';

// Two small sheets of the show page in the app (the series revamp, slice
// 5; the website's RemoveEpisodeSheet and "Place <extra>" RoomSheet in
// components/show/ShowControlRoom.js).

// "Remove <episode>?": a reason, then POST /api/show/episode/<id>/removal
// (by the caller, through onSubmit(reason)). `live` says it leaves the
// site at once.
export function RemoveEpisodeSheet({ row, live, busy, error, onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <Sheet
      title={`Remove ${row.displayTitle || 'this episode'}?`}
      eyebrow={row.code || null}
      onClose={onClose}
      foot={(
        <>
          {error ? <Text style={ss.error}>{error}</Text> : null}
          <View style={ss.sheetActions}>
            <SmallButton tone="danger" label={busy ? 'Asking…' : 'Ask us to remove it'} busy={busy} disabled={!reason.trim()} onPress={() => onSubmit(reason.trim())} />
            <SmallButton label="Keep it" onPress={onClose} />
          </View>
        </>
      )}
    >
      <Text style={ss.p}>{live ? 'It is hidden from the site right away while we confirm it. Anyone who bought it keeps it.' : 'We confirm it soon; anyone who bought it keeps it.'}</Text>
      <View style={{ gap: 6 }}>
        <Text style={ss.sheetLabel}>Why?</Text>
        <TextInput style={[ss.input, ss.textarea]} multiline maxLength={1000} value={reason} onChangeText={setReason} placeholder="A line for us" placeholderTextColor={colors.inkFaint} autoFocus />
      </View>
    </Sheet>
  );
}

// "Place <extra>": with the show, or after one of its episodes
// (PATCH /api/show/episode/<extra id> { bonusParentType, bonusParentId },
// by the caller through onPlace(type, id)).
export function PlaceExtraSheet({ extra, showId, episodes, busy, error, onPlace, onClose }) {
  const anchorId = extra.anchor ? extra.anchor.episodeId : null;
  return (
    <Sheet
      title={`Place ${extra.displayTitle}`}
      eyebrow={extraKindLabel(extra.extraKind)}
      onClose={onClose}
      foot={error ? <Text style={ss.error}>{error}</Text> : null}
    >
      <View style={{ gap: 8 }}>
        <Choice on={!anchorId} title="With the show" sub="On the show’s Extras shelf" disabled={busy} onPress={() => onPlace('series', showId)} />
        {episodes.map((r) => (
          <Choice key={r.id} on={anchorId === r.id} title={`After ${r.code}`} sub={r.displayTitle} disabled={busy} onPress={() => onPlace('episode', r.id)} />
        ))}
      </View>
    </Sheet>
  );
}

function Choice({ on, title, sub, onPress, disabled }) {
  return (
    <Pressable style={({ pressed }) => [rs.choice, on && rs.choiceOn, pressed && ss.pressed, disabled && ss.disabled]} disabled={disabled} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: Boolean(on) }}>
      <View style={[rs.radio, on && rs.radioOn]}>{on ? <View style={rs.radioDot} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={rs.title}>{title}</Text>
        {sub ? <Text style={ss.small} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const rs = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.15) },
  choiceOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.08) },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: inkTint(0.4), alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.olive },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.olive },
  title: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink }
});
