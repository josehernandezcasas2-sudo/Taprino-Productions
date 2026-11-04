import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { planMove, showNoun } from '../../lib/showRules';
import { showCall, showPath } from '../../lib/showApi';
import { colors, fonts, inkTint, oliveTint } from '../../lib/theme';
import { Chip, PlusIcon, Sheet, SmallButton, ss } from './ShowBits';

// "Move to…" in the app (the series revamp, slice 5; the website's
// components/show/MoveSheet.js, spec "Move to… picker"): where an episode
// or a draft goes — a season of this show (or a new one), a slot (the end
// of the season, a free number, or a number typed with the live line
// "E4 is taken — Swap | Insert here"), or another of the viewer's shows of
// the same kind (the ones it can't go into greyed with the reason). Before
// anything moves the sheet says what will (planMove's words, and the
// server's lines for another show). Move posts to /api/show/<id>/move; a
// refusal is shown and nothing moves. A bottom sheet.
//
//   show     { id, name, kind, seasons: [{ number, label }] }
//   episode  { id, kind: 'episode' | 'draft', title, displayTitle, season,
//              seriesOrder, code, status }
//   myShows  the shows it could go to (null while the host reads them): the
//            episode editor's moveTargets ({ id, name, kind, statusLabel,
//            ok, reason, tag, lines }) or GET /api/show summaries ({ …,
//            pickable, pickReason })
//   onMoved(result)  after a move: the route's answer + { toShowId, season, number }
//   onClose()

function rowsFrom(pos, seriesId, { drafts, contentType }) {
  if (!pos || !pos.taken) return [];
  return Object.entries(pos.taken)
    .filter(([, h]) => h && (drafts || h.kind !== 'draft'))
    .map(([n, h]) => ({
      id: h.id,
      title: h.title || null,
      seriesId,
      season: pos.season,
      seriesOrder: Number(n),
      contentType,
      ...(h.kind === 'draft' ? { kind: 'draft' } : { status: h.status || 'approved' })
    }));
}

function targetTag(t, show) {
  const sameKind = !t.kind || !show.kind || t.kind === show.kind;
  if (!sameKind) return { ok: false, tag: t.kind === 'vertical' ? '(vertical — studio only)' : `(${t.kind === 'podcast' ? 'podcast' : 'series'} — an episode joins its own kind)`, reason: t.reason || 'It only joins a show of its own kind.' };
  const ok = t.ok !== undefined ? t.ok !== false : t.pickable !== false;
  if (ok) return { ok: true, tag: null, reason: null };
  return { ok: false, tag: t.tag || (t.pickReason ? `(${String(t.pickReason).toLowerCase()})` : '(can’t take it)'), reason: t.reason || t.pickReason || 'It can’t go there.' };
}

export default function MoveSheet({ show, episode, myShows = [], onMoved, onClose, visible = true }) {
  const { getToken: clerkGetToken } = useAuth();
  const tokenRef = useRef(clerkGetToken);
  tokenRef.current = clerkGetToken;
  const getToken = useCallback((...a) => tokenRef.current(...a), []);
  const isDraft = episode.kind === 'draft' || episode.status === 'draft';
  const fromSeason = Number(episode.season) || 1;
  const fromNumber = Number(episode.seriesOrder) || null;
  const contentType = show.kind === 'podcast' ? 'podcast' : 'series';
  const [targetId, setTargetId] = useState(show.id);
  const [season, setSeason] = useState(fromSeason);
  const [slot, setSlot] = useState('end'); // end | gap | typed
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState(null); // swap | insert
  const [positions, setPositions] = useState({});
  const asked = useRef(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState(null);

  const targets = useMemo(() => (myShows || [])
    .filter((t) => t && t.id && t.id !== show.id)
    .map((t) => ({ ...t, ...targetTag(t, show) })), [myShows, show]);
  const target = targetId === show.id ? null : targets.find((t) => t.id === targetId) || null;

  const key = (sid, s) => `${sid}|${s}`;
  const load = useCallback(async (sid, s) => {
    const k = key(sid, s);
    if (asked.current.has(k)) return;
    asked.current.add(k);
    setPositions((p) => ({ ...p, [k]: { state: 'loading' } }));
    const r = await showCall('GET', `${showPath(sid)}/positions?season=${encodeURIComponent(s)}&exclude=${encodeURIComponent(episode.id)}`, undefined, getToken);
    if (!r.ok) asked.current.delete(k);
    setPositions((p) => ({ ...p, [k]: r.ok ? { state: 'ready', data: r.data } : { state: 'error', error: r.error } }));
  }, [episode.id, getToken]);

  useEffect(() => { load(show.id, fromSeason); }, [load, show.id, fromSeason]);
  useEffect(() => { load(targetId, season); }, [load, targetId, season]);

  const sourcePos = positions[key(show.id, fromSeason)];
  const targetPos = positions[key(targetId, season)];
  const tp = targetPos && targetPos.state === 'ready' ? targetPos.data : null;
  const sp = sourcePos && sourcePos.state === 'ready' ? sourcePos.data : null;

  // The target show's seasons: this show's from the caller, another's from
  // its positions answer; plus the next new one.
  const seasonList = useMemo(() => {
    let nums = [];
    const labels = {};
    if (targetId === show.id) {
      nums = (show.seasons || []).map((s) => Number(s.number)).filter(Boolean);
      for (const s of show.seasons || []) labels[Number(s.number)] = s.label;
      nums.push(fromSeason);
    } else {
      const found = Object.entries(positions).find(([k, p]) => k.startsWith(`${targetId}|`) && p && p.state === 'ready');
      const data = found ? found[1].data : null;
      if (data && Array.isArray(data.seasons)) {
        for (const s of data.seasons) {
          nums.push(Number(s.number));
          labels[Number(s.number)] = s.label;
        }
      }
    }
    nums.push(season);
    nums = [...new Set(nums.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
    return { nums, labels, next: Math.max(...nums) + 1 };
  }, [targetId, show, fromSeason, season, positions]);

  const taken = tp ? tp.taken || {} : {};
  const parked = new Set(tp && Array.isArray(tp.parked) ? tp.parked : []);
  const others = Object.keys(taken).map(Number).filter((n) => taken[n] && taken[n].id !== episode.id && !parked.has(n));
  const endNumber = (others.length ? Math.max(...others) : 0) + 1;
  const gap = tp && Array.isArray(tp.gaps) && tp.gaps.length ? tp.gaps[0].from : null;
  const typedN = /^\d{1,4}$/.test(typed.trim()) && Number(typed.trim()) > 0 ? Number(typed.trim()) : null;
  const number = slot === 'gap' ? gap : slot === 'typed' ? typedN : null;
  const holder = number && taken[number] && taken[number].id !== episode.id ? taken[number] : null;
  const crossShow = targetId !== show.id;
  const needSource = crossShow || season !== fromSeason;

  // What will move, by the same rule the server runs.
  const plan = useMemo(() => {
    if (!tp || (needSource && !sp)) return null;
    if (slot === 'typed' && !typedN) return null;
    const rows = [];
    const seen = new Set();
    const add = (r) => { if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } };
    add({ id: episode.id, title: episode.title || null, seriesId: show.id, season: fromSeason, seriesOrder: fromNumber, contentType, ...(isDraft ? { kind: 'draft' } : { status: episode.status || 'approved' }) });
    for (const r of rowsFrom(sp, show.id, { drafts: isDraft, contentType })) add(r);
    for (const r of rowsFrom(tp, targetId, { drafts: isDraft, contentType })) add(r);
    const spec = { ...(crossShow ? { seriesId: targetId, showName: target ? target.name : null } : {}), season, ...(number ? { number, ...(mode ? { mode } : {}) } : {}) };
    return planMove(rows, episode.id, spec);
  }, [tp, sp, needSource, slot, typedN, episode, show.id, fromSeason, fromNumber, contentType, isDraft, targetId, crossShow, target, season, number, mode]);

  const draftPushesEpisode = Boolean(isDraft && plan && plan.ok && plan.writes && plan.writes.some((w) => w.kind === 'episode'));
  const blockedByTarget = Boolean(target && !target.ok);
  let preview = null;
  if (plan && plan.ok) preview = plan.code === 'same' || !plan.writes.length ? 'Nothing moves.' : `${plan.words}.`;
  const choices = plan && !plan.ok && plan.code === 'taken' ? plan.choices || ['insert'] : null;
  const canMove = Boolean(plan && plan.ok && plan.writes.length && !draftPushesEpisode && !blockedByTarget && !busy);

  function pickSeason(n) {
    setSeason(n);
    setSlot('end');
    setTyped('');
    setMode(null);
    setAnswer(null);
    setError(null);
  }
  function pickTarget(id) {
    setTargetId(id);
    setSeason(id === show.id ? fromSeason : 1);
    setSlot('end');
    setTyped('');
    setMode(null);
    setAnswer(null);
    setError(null);
  }

  async function move(chosenMode = mode) {
    setBusy(true);
    setError(null);
    setAnswer(null);
    const body = {
      [isDraft ? 'draftId' : 'episodeId']: episode.id,
      ...(crossShow ? { toShowId: targetId } : {}),
      toSeason: season,
      ...(number ? { toNumber: number } : {}),
      ...(number && chosenMode ? { mode: chosenMode } : {})
    };
    const r = await showCall('POST', `${showPath(show.id)}/move`, body, getToken);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 409 && r.data && r.data.code === 'taken') setAnswer(r.data);
      setError(r.error);
      return;
    }
    if (onMoved) onMoved({ ...r.data, toShowId: crossShow ? targetId : null, season, number: number || null });
    onClose();
  }

  const noun = showNoun(show.kind);
  const code = episode.code || (fromNumber ? `S${fromSeason} E${fromNumber}` : null);
  const name = episode.title || episode.displayTitle || 'this episode';

  return (
    <Sheet
      visible={visible}
      eyebrow={[show.name, code ? `now ${code}` : null, isDraft ? 'draft' : null].filter(Boolean).join(' · ')}
      title={`Move ${code ? `${code.split(' ').pop()} · ` : ''}${name}`}
      onClose={onClose}
      foot={(
        <>
          {plan && !plan.ok && plan.code !== 'taken' ? <Text style={ss.small}>{plan.reason}</Text> : null}
          {draftPushesEpisode ? <Text style={ss.small}>An episode holds that place — a draft doesn’t move episodes along. Pick a free number, or send the draft first.</Text> : null}
          {preview && !draftPushesEpisode ? (
            <View style={ms.preview} accessibilityLiveRegion="polite"><Text style={ms.previewText}>→ {preview}</Text></View>
          ) : null}
          {target && target.ok && Array.isArray(target.lines) && target.lines.length > 0 ? (
            <View style={{ gap: 2 }}>{target.lines.map((l, i) => <Text key={`${i}-${l}`} style={ss.small}>· {l}</Text>)}</View>
          ) : null}
          {answer && answer.code === 'taken' && Array.isArray(answer.choices) ? (
            <View style={ss.wrap}>
              {answer.choices.map((c) => <SmallButton key={c} label={c === 'swap' ? 'Swap them' : 'Insert it there'} onPress={() => { setMode(c); move(c); }} />)}
              {answer.nextFree ? <SmallButton label={`Use E${answer.nextFree}`} onPress={() => { setSlot('typed'); setTyped(String(answer.nextFree)); setMode(null); setAnswer(null); setError(null); }} /> : null}
            </View>
          ) : null}
          {error ? <Text style={ss.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
          <View style={ss.sheetActions}>
            <SmallButton tone="primary" label={busy ? 'Moving…' : 'Move'} busy={busy} disabled={!canMove} onPress={() => move()} />
            <SmallButton label="Cancel" onPress={onClose} />
          </View>
        </>
      )}
    >
      <View style={{ gap: 8 }}>
        <Text style={ss.sheetLabel}>Season{crossShow && target ? ` · ${target.name}` : ''}</Text>
        <View style={ss.chips}>
          {seasonList.nums.map((n) => <Chip key={n} on={season === n} label={seasonList.labels[n] || `Season ${n}`} onPress={() => pickSeason(n)} />)}
          <Chip dashed icon={<PlusIcon size={12} color={colors.ink} />} label={`New season ${seasonList.next}`} onPress={() => pickSeason(seasonList.next)} />
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={ss.sheetLabel}>Number</Text>
        <View style={ss.chips}>
          <Chip on={slot === 'end'} label={`End of season${tp ? ` (E${endNumber})` : ''}`} onPress={() => { setSlot('end'); setMode(null); setAnswer(null); }} />
          {gap ? <Chip on={slot === 'gap'} label={`E${gap} · free`} onPress={() => { setSlot('gap'); setMode(null); setAnswer(null); }} /> : null}
          <View style={[ss.chip, slot === 'typed' && ss.chipOn]}>
            <Text style={ss.chipText}>E</Text>
            <TextInput
              style={ms.typed}
              value={typed}
              placeholder="…"
              placeholderTextColor={colors.inkFaint}
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel="Episode number"
              onFocus={() => setSlot('typed')}
              onChangeText={(t) => { setTyped(t.replace(/[^0-9]/g, '')); setSlot('typed'); setMode(null); setAnswer(null); }}
            />
          </View>
        </View>
        {targetPos && targetPos.state === 'loading' ? <Text style={ss.small}>Reading the numbers…</Text> : null}
        {targetPos && targetPos.state === 'error' ? <Text style={ss.small}>{targetPos.error}</Text> : null}
        {number && !holder && slot === 'typed' ? <Text style={ss.okText}>E{number} is free</Text> : null}
        {holder ? (isDraft && holder.kind === 'episode' ? (
          <Text style={ss.small}>E{number} is {holder.title ? `“${holder.title}”` : 'taken'} — an episode holds that place; pick a free number, or send the draft first.</Text>
        ) : (
          <View style={ms.conflict}>
            <Text style={[ss.small, { color: colors.ink }]}>E{number} is {holder.title ? `“${holder.title}”` : 'taken'}{holder.kind === 'draft' ? ' (a draft)' : ''} —</Text>
            <View style={ss.chips}>
              {(choices || (crossShow ? ['insert'] : ['swap', 'insert'])).map((c) => <Chip key={c} on={mode === c} label={c === 'swap' ? 'Swap' : 'Insert here'} onPress={() => setMode(c)} />)}
            </View>
          </View>
        )) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={ss.sheetLabel}>{crossShow ? 'Show' : `Another ${noun}`}</Text>
        <ShowChoice on={!crossShow} name={show.name} sub={`This ${noun}`} onPress={() => pickTarget(show.id)} />
        {targets.map((t) => (
          <ShowChoice key={t.id} on={targetId === t.id} off={!t.ok} name={t.name} sub={[t.statusLabel, t.tag].filter(Boolean).join(' ')} onPress={() => { if (t.ok) pickTarget(t.id); else setError(t.reason); }} />
        ))}
        {myShows === null ? <Text style={ss.small}>Reading your shows…</Text> : targets.length === 0 ? <Text style={ss.small}>No other {noun === 'show' ? 'shows' : 'series'} of yours to move it to.</Text> : null}
      </View>
    </Sheet>
  );
}

function ShowChoice({ on, off = false, name, sub, onPress }) {
  return (
    <Pressable style={({ pressed }) => [ms.show, on && ms.showOn, off && ms.showOff, pressed && ss.pressed]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: Boolean(on), disabled: Boolean(off) }}>
      <View style={[ms.radio, on && ms.radioOn]}>{on ? <View style={ms.radioDot} /> : null}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={ms.showName} numberOfLines={1}>{name}</Text>
        {sub ? <Text style={ss.small} numberOfLines={2}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const ms = StyleSheet.create({
  typed: { minWidth: 36, paddingVertical: 4, color: colors.ink, fontFamily: fonts.monoMedium, fontSize: 13 },
  conflict: { gap: 6, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: oliveTint(0.4), backgroundColor: oliveTint(0.06) },
  preview: { padding: 10, borderRadius: 8, backgroundColor: oliveTint(0.12) },
  previewText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  show: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.15) },
  showOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.08) },
  showOff: { opacity: 0.5 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: inkTint(0.4), alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.olive },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.olive },
  showName: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink }
});
