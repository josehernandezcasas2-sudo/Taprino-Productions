import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import { crew, Avatar } from '../CrewBits';

// Add someone to a production's crew list by name (Crew Call's directory)
// or @handle, with their role. The production screen and its dashboard
// both use it (the website's components/productions/AddMember.js, moved
// out of the production page on 2026-11-19 for the same reason).
//
// `act(fn)` is the screen's write wrapper: it hands `fn` a fresh token,
// shows the server's line on a refusal and answers null, else the result.
// `onDone(result | null)` closes the form (null after Cancel).
export default function AddMember({ id, busy, act, onDone }) {
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
  const blocked = busy || (!picked && q.trim().length < 2) || role.trim().length < 2;

  return (
    <View style={[crew.panel, { borderStyle: 'dashed', marginBottom: 0 }]}>
      <Text style={crew.label}>Who</Text>
      <TextInput style={crew.input} value={picked ? picked.displayName : q} onChangeText={(v) => { setPicked(null); setQ(v); }} placeholder="Name on Crew Call, or @handle" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Who" />
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
      <TextInput style={crew.input} value={role} onChangeText={setRole} placeholder="Gaffer" placeholderTextColor={colors.inkFaint} maxLength={40} accessibilityLabel="Role" />
      <View style={[crew.row, { marginTop: 4 }]}>
        <Pressable style={[crew.btn, crew.btnPrimary, blocked && { opacity: 0.6 }]} disabled={blocked} onPress={submit} accessibilityRole="button"><Text style={[crew.btnText, crew.btnPrimaryText]}>Add</Text></Pressable>
        <Pressable style={[crew.btn, crew.btnGhost]} onPress={() => onDone(null)} accessibilityRole="button"><Text style={[crew.btnText, { color: colors.inkDim }]}>Cancel</Text></Pressable>
      </View>
      <Text style={crew.mono}>They get a notification and can take themselves off.</Text>
    </View>
  );
}
