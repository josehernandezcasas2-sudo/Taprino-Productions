import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { brassTint, colors, fonts, inkTint } from '../../lib/theme';
import { CREW_WORDS, DEFAULT_WITHIN, WITHIN_STEPS, moreLabel, showButton, urgentChip, withinLabel } from '../../lib/crewDirectoryRules';
import { PlaceBox } from '../CrewBits';
import MessageSheet from '../messages/MessageSheet';
import { CrewGlyph } from './CrewIcons';

// Crew Call's Filters (Crew Call, simpler, 2026-11-18): one bottom sheet
// for every tab (MessageSheet: the dimmed screen, ×, Android's back and a
// tap outside close it; every orientation), opened by the Filters chip or
// by a chip that names one section ("Pay ▾" opens it at Pay). Filters
// apply as they change; the "Show N …" button only closes it. Sections:
//   Calls  Near · Kind · Role · Pay · Urgent / Matches my card / Remote
//   People Near · Role (pick any) · Has gear · Free / Open / Verified
//   Cast   Near · Playing age · Union · Free / Open / Verified
//   Gear   Near
export const PAY_TYPES = { paid: 'Paid', union: 'Union', deferred: 'Deferred', unpaid: 'Unpaid', other: 'Other' };
const FIRST_ROLES = 10;

export default function CrewFilters({ visible, onClose, tab, filters, onChange, onPlace, onClear, options, hasCard, total, at }) {
  const scroll = useRef(null);
  const spots = useRef({});
  const [allRoles, setAllRoles] = useState(false);

  // Opened at a section: scroll it into view once it has been laid out.
  useEffect(() => {
    if (!visible) { setAllRoles(false); return undefined; }
    if (!at || at === 'near') return undefined;
    const t = setTimeout(() => {
      const y = spots.current[at];
      if (scroll.current && typeof y === 'number') scroll.current.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }, 280);
    return () => clearTimeout(t);
  }, [visible, at, tab]);

  const mark = (name) => (e) => { spots.current[name] = e.nativeEvent.layout.y; };
  // The playing-age fields: brought up over the keyboard when one is
  // tapped (the sheet shrinks above the keyboard; the list keeps its place).
  const ageFocus = () => setTimeout(() => {
    const y = spots.current.age;
    if (scroll.current && typeof y === 'number') scroll.current.scrollTo({ y: Math.max(0, y - 8), animated: true });
  }, 320);

  const f = filters;
  const set = (patch) => onChange(patch);
  const roleList = f.kind === 'cast' ? (options.castRoles || []) : (options.roles || []);

  return (
    <MessageSheet visible={visible} onClose={onClose} label={CREW_WORDS.filters} fill={tab !== 'gear'}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header">{CREW_WORDS.filters}</Text>
        <View style={s.headRight}>
          {tab !== 'gear' ? (
            <Pressable onPress={onClear} style={({ pressed }) => [s.clear, pressed && s.pressed]} accessibilityRole="button" hitSlop={4}>
              <Text style={s.clearText}>{CREW_WORDS.clearAll}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} style={({ pressed }) => [s.close, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={CREW_WORDS.close} hitSlop={4}>
            <CrewGlyph name="close" size={14} strokeWidth={2.4} color={colors.inkDim} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scroll}
        style={tab === 'gear' ? s.scrollShort : s.scroll}
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={s.section} onLayout={mark('near')}>
          <Text style={s.label}>{CREW_WORDS.near}</Text>
          <PlaceBox
            value={f.near}
            onChange={(p) => onPlace(p, p && !f.within ? DEFAULT_WITHIN : f.within)}
            placeholder={CREW_WORDS.nearPlaceholder}
            look={{
              field: s.field,
              input: s.fieldInput,
              leading: <CrewGlyph name="pin" size={15} strokeWidth={2.2} color={colors.brass} />,
              button: s.fieldBtn,
              locateIcon: <CrewGlyph name="locate" size={18} color={colors.ink} />,
              clearIcon: <CrewGlyph name="close" size={14} strokeWidth={2.4} color={colors.ink} />,
              locateLabel: CREW_WORDS.useMyLocation
            }}
          />
          {f.near ? (
            <View style={s.wrap}>
              {WITHIN_STEPS.map((n) => <Choice key={n} label={withinLabel(n)} on={(Number(f.within) || 0) === n} onPress={() => onPlace(f.near, n)} />)}
            </View>
          ) : null}
        </View>

        {tab === 'calls' ? (
          <>
            <View style={s.section} onLayout={mark('kind')}>
              <Text style={s.label}>{CREW_WORDS.kind}</Text>
              <View style={s.wrap}>
                {Object.entries(CREW_WORDS.kinds).map(([k, v]) => (
                  // A role from the other list no longer fits: it goes with the kind.
                  <Choice key={k || 'all'} label={v} on={f.kind === k} onPress={() => set({ kind: k, callRole: ((k === 'cast' ? options.castRoles : options.roles) || []).includes(f.callRole) ? f.callRole : '' })} />
                ))}
              </View>
            </View>
            <View style={s.section} onLayout={mark('role')}>
              <Text style={s.label}>{CREW_WORDS.role}</Text>
              <View style={s.wrap}>
                <Choice label={CREW_WORDS.roleAny} on={!f.callRole} onPress={() => set({ callRole: '' })} />
                {roleList.map((r) => <Choice key={r} label={r} on={f.callRole === r} onPress={() => set({ callRole: f.callRole === r ? '' : r })} />)}
              </View>
            </View>
            <View style={s.section} onLayout={mark('pay')}>
              <Text style={s.label}>{CREW_WORDS.pay}</Text>
              <View style={s.wrap}>
                {Object.entries(PAY_TYPES).map(([k, v]) => {
                  const on = f.pay.includes(k);
                  return <Choice key={k} label={on ? `${v} ✓` : v} on={on} multi onPress={() => set({ pay: on ? f.pay.filter((x) => x !== k) : [...f.pay, k] })} />;
                })}
              </View>
            </View>
            <View style={s.switches} onLayout={mark('switches')}>
              <SwitchRow label={urgentChip(0)} line={CREW_WORDS.urgentLine} value={f.urgent} onChange={(v) => set({ urgent: v })} />
              {hasCard ? <SwitchRow label={CREW_WORDS.matches} line={CREW_WORDS.matchesLine} value={f.matches} onChange={(v) => set({ matches: v })} /> : null}
              <SwitchRow label={CREW_WORDS.remote} line={CREW_WORDS.remoteLine} value={f.remote} onChange={(v) => set({ remote: v })} last />
            </View>
          </>
        ) : null}

        {tab === 'people' ? (
          <>
            <View style={s.section} onLayout={mark('role')}>
              <Text style={s.label}>{CREW_WORDS.rolePickAny}</Text>
              <View style={s.wrap}>
                {(() => {
                  const all = options.roles || [];
                  const shown = allRoles ? all : all.filter((r, i) => i < FIRST_ROLES || f.roles.includes(r));
                  const more = all.length - shown.length;
                  return (
                    <>
                      {shown.map((r) => {
                        const on = f.roles.includes(r);
                        return <Choice key={r} label={on ? `${r} ✓` : r} on={on} multi onPress={() => set({ roles: on ? f.roles.filter((x) => x !== r) : [...f.roles, r] })} />;
                      })}
                      {more > 0 ? (
                        <Pressable onPress={() => setAllRoles(true)} style={({ pressed }) => [s.choice, s.more, pressed && s.pressed]} accessibilityRole="button">
                          <Text style={[s.choiceText, { color: colors.ink }]}>{moreLabel(more)}</Text>
                        </Pressable>
                      ) : null}
                    </>
                  );
                })()}
              </View>
            </View>
            <View style={s.section} onLayout={mark('gear')}>
              <Text style={s.label}>{CREW_WORDS.hasGear}</Text>
              <View style={s.wrap}>
                <Choice label={CREW_WORDS.anyGear} on={!f.gear} onPress={() => set({ gear: '' })} />
                {(options.gearCategories || []).map((c) => <Choice key={c} label={c} on={f.gear === c} onPress={() => set({ gear: f.gear === c ? '' : c })} />)}
              </View>
            </View>
          </>
        ) : null}

        {tab === 'cast' ? (
          <>
            <View style={s.section} onLayout={mark('age')}>
              <Text style={s.label}>{CREW_WORDS.playingAge}</Text>
              <View style={s.ageRow}>
                <AgeField value={f.ageMin} placeholder={CREW_WORDS.ageFrom} onChange={(v) => set({ ageMin: v })} onFocus={ageFocus} />
                <Text style={s.ageDash}>–</Text>
                <AgeField value={f.ageMax} placeholder={CREW_WORDS.ageTo} onChange={(v) => set({ ageMax: v })} onFocus={ageFocus} />
              </View>
            </View>
            <View style={s.section} onLayout={mark('union')}>
              <Text style={s.label}>{CREW_WORDS.union}</Text>
              <View style={s.wrap}>
                <Choice label={CREW_WORDS.unionAny} on={!f.union} onPress={() => set({ union: '' })} />
                {Object.entries(options.unionStatus || {}).map(([k, v]) => <Choice key={k} label={v} on={f.union === k} onPress={() => set({ union: f.union === k ? '' : k })} />)}
              </View>
            </View>
          </>
        ) : null}

        {tab === 'people' || tab === 'cast' ? (
          <View style={s.switches} onLayout={mark('switches')}>
            <SwitchRow label={CREW_WORDS.freeNowLong} line={CREW_WORDS.freeNowLine} value={f.free} onChange={(v) => set({ free: v })} />
            <SwitchRow label={CREW_WORDS.openToWork} line={CREW_WORDS.openToWorkLine} value={f.open} onChange={(v) => set({ open: v })} />
            <SwitchRow label={CREW_WORDS.verified} line={CREW_WORDS.verifiedLine} value={f.verified} onChange={(v) => set({ verified: v })} last />
          </View>
        ) : null}
      </ScrollView>

      <View style={s.foot}>
        <Pressable onPress={onClose} style={({ pressed }) => [s.show, pressed && s.pressed]} accessibilityRole="button">
          <Text style={s.showText}>{showButton(tab, total)}</Text>
        </Pressable>
      </View>
    </MessageSheet>
  );
}

function Choice({ label, on, onPress, multi = false }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.choice, on && s.choiceOn, pressed && s.pressed]}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: on } : { selected: on }}
    >
      <Text style={[s.choiceText, on && s.choiceTextOn]}>{label}</Text>
    </Pressable>
  );
}

function SwitchRow({ label, line, value, onChange, last = false }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[s.switchRow, !last && s.switchRule]} accessibilityRole="switch" accessibilityState={{ checked: Boolean(value) }} accessibilityLabel={label}>
      <View style={s.switchText}>
        <Text style={s.switchLabel}>{label}</Text>
        <Text style={s.switchLine}>{line}</Text>
      </View>
      <Switch
        value={Boolean(value)}
        onValueChange={onChange}
        trackColor={{ false: inkTint(0.18), true: colors.brass }}
        thumbColor={colors.ink}
        ios_backgroundColor={inkTint(0.18)}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

function AgeField({ value, placeholder, onChange, onFocus }) {
  return (
    <TextInput
      style={s.age}
      value={String(value || '')}
      onChangeText={(v) => onChange(v.replace(/[^0-9]/g, '').slice(0, 3))}
      onFocus={onFocus}
      placeholder={placeholder}
      placeholderTextColor={colors.inkFaint}
      accessibilityLabel={`${CREW_WORDS.playingAge} ${placeholder}`}
      keyboardType="number-pad"
      returnKeyType="done"
      maxLength={3}
    />
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 },
  title: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.ink },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clear: { height: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.brass },
  close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollShort: { flexGrow: 0, flexShrink: 1 },
  body: { paddingTop: 6, paddingBottom: 16, gap: 18 },
  section: { gap: 8 },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.inkDim },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  field: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: inkTint(0.14), backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  fieldInput: { flex: 1, minWidth: 0, height: 42, paddingVertical: 0, color: colors.ink, fontFamily: fonts.display, fontSize: 16 },
  fieldBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: inkTint(0.14), alignItems: 'center', justifyContent: 'center' },

  choice: { minHeight: 32, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.16), alignItems: 'center', justifyContent: 'center' },
  choiceOn: { borderColor: brassTint(0.6), backgroundColor: brassTint(0.16) },
  choiceText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.inkDim },
  choiceTextOn: { color: colors.brass },
  more: { borderStyle: 'dashed', borderColor: inkTint(0.24) },

  ageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  age: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: inkTint(0.14), backgroundColor: colors.surface2, paddingHorizontal: 12, paddingVertical: 0, color: colors.ink, fontFamily: fonts.display, fontSize: 16 },
  ageDash: { fontFamily: fonts.display, fontSize: 16, color: colors.inkFaint },

  switches: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  switchRule: { borderBottomWidth: 1, borderBottomColor: inkTint(0.08) },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  switchLabel: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  switchLine: { fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },

  foot: { paddingTop: 12, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  show: { height: 50, borderRadius: 14, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  showText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrass }
});
