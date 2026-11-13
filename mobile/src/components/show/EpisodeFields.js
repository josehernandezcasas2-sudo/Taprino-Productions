import { useState } from 'react';
import { Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import { MAIN_GENRES } from '../../lib/submitRules';
import { ONE_LINE_MAX } from '../../lib/showRules';
import { PODCASTS_AD_FREE } from '../../lib/adBreakRules';
import { useContentRatings } from '../../lib/contentAdvisory';
import { brassTint, colors, fonts, inkTint, oliveTint } from '../../lib/theme';
import { ClockIcon } from '../WorkIcons';
import { ChoiceChips, EdInput, FieldHead, FieldNote, LockIcon, StagedBox, SwitchRow, isOpen } from './EditorBits';
import { ChevronIcon, Chip, LinkText, PREMIUM_WORD, PlusIcon, SmallButton, askUs, ss } from './ShowBits';

// The fields the app's episode editor and draft editor share (the series
// revamp, slice 5; the website's components/show/EpisodeFields.js, the
// same words): the title with what waits for approval, the description as
// "One line about it" + "About it", the "Same as the show" rows (genre,
// Made by, year, rating, Who can watch), the season and number with the
// taken line, and the folded "More options".

export function TitleField({ value, onChange, policy, placeholder, liveTitle = null, stagedTitle = null, onCancelStaged = null, cancelBusy = false, edited = false }) {
  const staged = policy && policy.mode === 'staged';
  return (
    <View style={{ gap: 6 }}>
      <FieldHead label="Title" hint={staged ? '· goes to review on a live episode' : null} staged={staged} locked={policy && policy.mode === 'locked'} count={value.length} max={value.length > 150 ? 200 : null} />
      <EdInput style={ef.title} value={value} maxLength={200} placeholder={placeholder} disabled={!isOpen(policy)} onChangeText={onChange} accessibilityLabel="Title" />
      {edited && staged ? (
        <StagedBox title="Goes to review when you save" onCancel={() => onChange(liveTitle || '')} cancelLabel="Undo">
          <Text style={ss.small}>Live now: <Text style={ss.strong}>{liveTitle || placeholder}</Text></Text>
        </StagedBox>
      ) : null}
      {stagedTitle ? <StagedBox title="Waiting for approval:" value={stagedTitle} onCancel={onCancelStaged} busy={cancelBusy} /> : null}
      <FieldNote policy={policy} edited={edited && !staged} />
    </View>
  );
}

// The description (one line + about) waits for approval on a live title
// or show (2026-11-12): the clock on the label, and under About the
// description that waits, with Cancel (the website's EpisodeFields).
export function OneLineField({ value, onChange, policy, edited = false }) {
  return (
    <View style={{ gap: 6 }}>
      <FieldHead label="One line about it" count={value.length} max={ONE_LINE_MAX} staged={Boolean(policy && policy.mode === 'staged')} locked={policy && policy.mode === 'locked'} />
      <EdInput
        multiline
        style={{ minHeight: 60 }}
        value={value}
        maxLength={ONE_LINE_MAX}
        disabled={!isOpen(policy)}
        placeholder="What a card says about it, in a line."
        onChangeText={(t) => onChange(t.replace(/\s*\n\s*/g, ' '))}
        accessibilityLabel="One line about it"
      />
      <FieldNote policy={policy} edited={edited} />
    </View>
  );
}

export function AboutField({ value, onChange, max, policy, edited = false, label = 'About it', placeholder = 'Everything else: what happens, who’s in it, how it was made.', stagedValue = null, onCancelStaged = null, cancelBusy = false }) {
  const waiting = typeof stagedValue === 'string' && stagedValue.trim() ? stagedValue.trim() : null;
  return (
    <View style={{ gap: 6 }}>
      <FieldHead label={label} count={value.length} max={max} staged={Boolean(policy && policy.mode === 'staged')} locked={policy && policy.mode === 'locked'} />
      <EdInput multiline style={{ minHeight: 120 }} value={value} maxLength={Math.max(0, max)} disabled={!isOpen(policy)} placeholder={placeholder} onChangeText={onChange} accessibilityLabel={label} />
      {waiting ? (
        <StagedBox title="A new description waits for approval:" value={waiting.length > 240 ? `${waiting.slice(0, 240)}…` : waiting} onCancel={onCancelStaged} busy={cancelBusy} />
      ) : null}
      <FieldNote policy={policy} edited={edited} />
    </View>
  );
}

// A podcast carries no ads of ours (mobile/src/lib/adBreakRules.js): its
// free tier is just "Free".
function tierWord(t, adFree = false) {
  return t === 'premium' ? PREMIUM_WORD : adFree ? 'Free' : 'Free with ads';
}

// "Same as the show": one row per inherited field. Tap a row to open its
// field; a value of its own reads "Differs from the show · Reset". Who can
// watch and the rating are the team's on a live title ("Locked while
// live" and the line to ask us).
//   ctx = { form, set(key, value), defaults (the show's), showYear,
//           resets (a Set), reset(key), pol(field), titleForAsk }
export function SameAsShow({ ctx, inShow = true }) {
  const [open, setOpen] = useState(null);
  const ratings = useContentRatings() || [];
  const { form, set, defaults = {}, showYear = null, resets, reset, pol, adFree = false } = ctx;
  const d = defaults || {};
  // Genre label, Made by and the year borrow the show's when blank (on
  // every page); the main genre, the rating and Who can watch were copied
  // when the episode was added, so a blank one is its own (unrated is 17+).
  const BORROWS = ['genre', 'artist', 'releaseYear'];
  const stateOf = (key, own, def) => {
    if (!inShow) return null;
    if (resets.has(key)) return 'same';
    const blankOwn = own === '' || own === null || own === undefined;
    if (def === null || def === undefined || def === '') return blankOwn ? null : 'own';
    if (blankOwn) return BORROWS.includes(key) ? 'same' : 'differs';
    return String(own) === String(def) ? 'same' : 'differs';
  };
  const ratingOptions = [{ value: '', label: 'Not set' }, ...ratings.map((r) => ({ value: r.code, label: r.code }))];
  if (form.rating && !ratingOptions.some((o) => o.value === form.rating)) ratingOptions.push({ value: form.rating, label: form.rating });
  const rows = [
    {
      key: 'mainGenre',
      label: 'Genre',
      policy: pol('mainGenre'),
      value: [form.mainGenre || d.mainGenre || 'Not set', form.genre && form.genre !== (form.mainGenre || d.mainGenre) ? `· ${form.genre}` : null].filter(Boolean).join(' '),
      state: (() => {
        const a = stateOf('mainGenre', form.mainGenre, d.mainGenre);
        const b = stateOf('genre', form.genre, d.genre);
        return a === 'differs' || b === 'differs' ? 'differs' : a || b;
      })(),
      resetKeys: ['mainGenre', 'genre'],
      editor: (
        <View style={{ gap: 10 }}>
          <ChoiceChips options={MAIN_GENRES.map((g) => ({ value: g, label: g }))} value={form.mainGenre} disabled={!isOpen(pol('mainGenre'))} onChange={(g) => set('mainGenre', g)} />
          <View style={{ gap: 6 }}>
            <FieldHead label="Specific" hint="optional" />
            <EdInput value={form.genre} maxLength={60} placeholder={d.genre || 'e.g. Cosmic Horror'} disabled={!isOpen(pol('genre'))} onChangeText={(t) => set('genre', t)} accessibilityLabel="Specific genre" />
          </View>
        </View>
      )
    },
    {
      key: 'artist',
      label: 'Made by',
      policy: pol('artist'),
      value: form.artist || d.artist || 'Not set',
      state: stateOf('artist', form.artist, d.artist),
      resetKeys: ['artist'],
      editor: <EdInput value={form.artist} maxLength={120} placeholder={d.artist || 'Your name, as credited'} disabled={!isOpen(pol('artist'))} onChangeText={(t) => set('artist', t)} accessibilityLabel="Made by" />
    },
    {
      key: 'releaseYear',
      label: 'Year',
      policy: pol('releaseYear'),
      value: form.releaseYear || (showYear ? String(showYear) : 'Not set'),
      state: stateOf('releaseYear', form.releaseYear, showYear),
      resetKeys: ['releaseYear'],
      editor: <EdInput value={form.releaseYear} keyboardType="number-pad" maxLength={4} placeholder={showYear ? String(showYear) : String(new Date().getFullYear())} disabled={!isOpen(pol('releaseYear'))} onChangeText={(t) => set('releaseYear', t.replace(/[^0-9]/g, ''))} accessibilityLabel="Year" />
    },
    {
      key: 'rating',
      label: 'Rating',
      policy: pol('rating'),
      value: form.rating || 'Not rated (17+)',
      boxed: true,
      state: stateOf('rating', form.rating, d.rating),
      resetKeys: ['rating'],
      editor: (
        <View style={{ gap: 6 }}>
          <ChoiceChips options={ratingOptions} value={form.rating} disabled={!isOpen(pol('rating'))} onChange={(v) => set('rating', v)} />
          <Text style={ss.small}>Not set is treated as 17+.</Text>
        </View>
      ),
      ask: 'Ask us to change the rating'
    },
    {
      key: 'tier',
      label: 'Who can watch',
      policy: pol('tier'),
      value: tierWord(form.tier, adFree),
      tier: form.tier,
      state: stateOf('tier', form.tier, d.tier),
      resetKeys: ['tier'],
      editor: <ChoiceChips options={[{ value: 'free', label: tierWord('free', adFree) }, { value: 'premium', label: tierWord('premium', adFree) }]} value={form.tier} disabled={!isOpen(pol('tier'))} onChange={(t) => set('tier', t)} />,
      ask: 'Ask us to change who can watch'
    }
  ];
  const lockedAsk = rows.filter((r) => r.policy && r.policy.mode === 'locked' && r.ask);
  return (
    <View style={ss.card}>
      {inShow ? (
        <View style={{ gap: 3 }}>
          <Text style={ss.cardK}>Same as the show</Text>
          <Text style={ss.small}>Tap one to give this episode its own.</Text>
        </View>
      ) : null}
      <View>
        {rows.map((r, i) => {
          const locked = r.policy && r.policy.mode === 'locked';
          const isOpenRow = open === r.key && !locked;
          return (
            <View key={r.key} style={[ef.sameRow, i > 0 && ef.sameDivider]}>
              <Pressable
                style={({ pressed }) => [ef.sameHead, pressed && !locked && ss.pressed]}
                disabled={locked}
                onPress={() => setOpen(isOpenRow ? null : r.key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: locked ? undefined : isOpenRow, disabled: Boolean(locked) }}
                accessibilityLabel={`${r.label}: ${r.value}`}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={ss.sheetLabel}>{r.label}</Text>
                  {r.boxed ? (
                    <View style={ef.ratingBox}><Text style={ef.ratingText}>{r.value}</Text></View>
                  ) : r.tier ? (
                    <Text style={[ef.sameValue, r.tier === 'premium' && { color: colors.brass }]}>{r.value}</Text>
                  ) : (
                    <Text style={ef.sameValue} numberOfLines={2}>{r.value}</Text>
                  )}
                </View>
                {locked ? (
                  <View style={ef.lockedChip}><LockIcon size={10} /><Text style={ef.chipText}>Locked while live</Text></View>
                ) : r.state === 'same' ? (
                  <View style={ef.sameChip}><Text style={ef.chipText}>Same as the show</Text></View>
                ) : r.state === 'differs' ? (
                  <View style={[ef.sameChip, ef.differsChip]}><Text style={[ef.chipText, { color: colors.brass }]}>Differs from the show</Text></View>
                ) : null}
                {!locked ? <View style={{ transform: [{ rotate: isOpenRow ? '90deg' : '0deg' }] }}><ChevronIcon size={14} color={colors.inkDim} /></View> : null}
              </Pressable>
              {r.state === 'differs' && !locked ? (
                <LinkText style={{ alignSelf: 'flex-start' }} onPress={() => { for (const k of r.resetKeys) reset(k); setOpen(null); }}>Reset to the show’s</LinkText>
              ) : null}
              {isOpenRow ? <View style={ef.sameEdit}>{r.editor}</View> : null}
              {locked && r.policy.line && !r.ask ? <FieldNote policy={r.policy} /> : null}
            </View>
          );
        })}
      </View>
      {lockedAsk.length > 0 ? (
        <Text style={ss.small}>
          {lockedAsk.map((r, i) => (
            <Text key={r.key}>{i > 0 ? ' · ' : ''}<LinkText onPress={() => askUs(`${r.ask}: ${ctx.titleForAsk || ''}`.trim())}>{r.policy.line || r.ask}</LinkText></Text>
          ))}
        </Text>
      ) : null}
    </View>
  );
}

// The season chips and the number stepper, with the line for a taken
// number and what Swap / Insert here would do (planMove's words).
//   place = { seasons: [{ number, label }], season, number, wasCode,
//             nextFree, holder ({ id, title, kind }), loading,
//             swapWords, insertWords, policy, onSeason(n), onNumber(v),
//             onSwap, onInsert, busy, isDraft, moveNote }
export function PlaceBlock({ place }) {
  const { seasons = [], season, number, wasCode, nextFree, holder, loading, swapWords, insertWords, policy, onSeason, onNumber, onSwap, onInsert, busy, isDraft = false, moveNote = null } = place;
  const open = isOpen(policy) && !busy;
  const nums = [...new Set([...seasons.map((s) => Number(s.number)), Number(season)])].filter(Boolean).sort((a, b) => a - b);
  const labels = Object.fromEntries(seasons.map((s) => [Number(s.number), s.label]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const n = Number(number) || 0;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        <FieldHead label="Season" />
        <View style={ss.chips} accessibilityRole="radiogroup">
          {nums.map((s) => <Chip key={s} on={Number(season) === s} label={labels[s] || `Season ${s}`} disabled={!open} onPress={() => onSeason(s)} />)}
          <Chip dashed label="New season" icon={<PlusIcon size={12} color={colors.ink} />} disabled={!open} onPress={() => onSeason(next)} />
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <FieldHead label="Number" />
        <View style={ef.numberRow}>
          <View style={[ef.stepper, holder && ef.stepperTaken]}>
            <Pressable style={[ef.stepBtn, (!open || n <= 1) && ss.disabled]} disabled={!open || n <= 1} onPress={() => onNumber(String(Math.max(1, n - 1)))} accessibilityRole="button" accessibilityLabel="One lower" hitSlop={4}>
              <Text style={ef.stepText}>−</Text>
            </Pressable>
            <Text style={ef.stepE}>E</Text>
            <TextInput
              style={[ef.stepInput, !open && ss.disabled]}
              value={String(number || '')}
              keyboardType="number-pad"
              maxLength={4}
              editable={open}
              onChangeText={(t) => onNumber(t.replace(/[^0-9]/g, ''))}
              accessibilityLabel="Episode number"
              placeholderTextColor={colors.inkFaint}
            />
            <Pressable style={[ef.stepBtn, (!open || n >= 9999) && ss.disabled]} disabled={!open || n >= 9999} onPress={() => onNumber(String(Math.min(9999, n + 1)))} accessibilityRole="button" accessibilityLabel="One higher" hitSlop={4}>
              <Text style={ef.stepText}>+</Text>
            </Pressable>
          </View>
          <Text style={[ss.small, { flex: 1 }]}>
            {[wasCode ? `Was ${wasCode}` : null, loading ? 'reading the numbers…' : nextFree ? `E${nextFree} is the next free number` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {holder ? (holder.kind === 'draft' && !isDraft ? (
          <Text style={ss.small}>E{n} is also your draft {holder.title ? `“${holder.title}”` : ''} — it keeps that number until you move it.</Text>
        ) : isDraft && holder.kind === 'episode' ? (
          <View style={ef.conflict} accessibilityLiveRegion="polite">
            <Text style={ef.conflictText}><Text style={ss.strong}>E{n}</Text> is {holder.title ? `“${holder.title}”` : 'taken'} — an episode holds that place.</Text>
            {nextFree ? <View style={ss.wrap}><SmallButton label={`Use E${nextFree}`} onPress={() => onNumber(String(nextFree))} /></View> : null}
          </View>
        ) : (
          <View style={ef.conflict} accessibilityLiveRegion="polite">
            <Text style={ef.conflictText}><Text style={ss.strong}>E{n}</Text> is {holder.title ? holder.title : 'taken'} —</Text>
            <View style={ss.wrap}>
              {onSwap ? <SmallButton label="Swap" disabled={busy} onPress={onSwap} /> : null}
              {onInsert ? <SmallButton label="Insert here" disabled={busy} onPress={onInsert} /> : null}
              {nextFree ? <SmallButton label={`Use E${nextFree}`} disabled={busy} onPress={() => onNumber(String(nextFree))} /> : null}
            </View>
            {(onSwap || onInsert) && (swapWords || insertWords) ? (
              onSwap && onInsert && swapWords && swapWords === insertWords ? (
                <Text style={ss.small}>Either way: {swapWords}</Text>
              ) : (
                <View style={{ gap: 2 }}>
                  {onSwap && swapWords ? <Text style={ss.small}>Swap: {swapWords}</Text> : null}
                  {onInsert && insertWords ? <Text style={ss.small}>Insert here: {insertWords}</Text> : null}
                </View>
              )
            ) : null}
            {moveNote ? <Text style={ss.small}>{moveNote}</Text> : null}
          </View>
        )) : null}
        <FieldNote policy={policy} />
      </View>
    </View>
  );
}

// The folded options: runtime, ad breaks, ads, channels, the hero spot,
// Tapa Original (the last two are the studio's on a live title).
// A podcast (`adFree`, mobile/src/lib/adBreakRules.js) has no ad breaks and
// no ads switch: it says it is ad-free instead.
export function MoreOptions({ form, set, pol, live = false, adFree = false }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={ss.card}>
      <Pressable style={ef.moreHead} onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ef.moreTitle}>More options</Text>
          <Text style={ss.small}>Runtime, {adFree ? '' : 'ad breaks, '}let channels air it{live ? ', the hero spot and Tapa Original (the last two are set by the studio)' : ', the hero spot, Tapa Original'}</Text>
        </View>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><ChevronIcon size={16} color={colors.inkDim} /></View>
      </Pressable>
      {open ? (
        <View style={{ gap: 14, marginTop: 4 }}>
          <View style={ef.grid2}>
            <View style={{ flex: 1, gap: 6, minWidth: 130 }}>
              <FieldHead label="Runtime" hint="MM:SS" locked={pol('runtime').mode === 'locked'} />
              <EdInput value={form.runtime} placeholder="22:04" maxLength={9} disabled={!isOpen(pol('runtime'))} onChangeText={(t) => set('runtime', t)} accessibilityLabel="Runtime" />
            </View>
            {adFree ? null : (
              <View style={{ flex: 1, gap: 6, minWidth: 130 }}>
                <FieldHead label="Ad breaks" hint="MM:SS, commas" locked={pol('adBreakSeconds').mode === 'locked'} />
                <EdInput value={form.adBreaksText} placeholder="0:00, 10:00" disabled={!isOpen(pol('adBreakSeconds'))} onChangeText={(t) => set('adBreaksText', t)} accessibilityLabel="Ad breaks" />
              </View>
            )}
          </View>
          {adFree ? (
            <Text style={ss.small}>{PODCASTS_AD_FREE} No ad of ours plays in one; a sponsor read in your own audio is yours.</Text>
          ) : (
            <SwitchRow title="Ads in it" on={form.adsEnabled} onChange={(v) => set('adsEnabled', v)} disabled={!isOpen(pol('adsEnabled'))} policy={pol('adsEnabled').mode === 'locked' ? pol('adsEnabled') : null}>
              Off plays it without ad breaks for everyone.
            </SwitchRow>
          )}
          <SwitchRow title="Let channels air it" on={form.channelOptIn} onChange={(v) => set('channelOptIn', v)} disabled={!isOpen(pol('channelOptIn'))} policy={pol('channelOptIn').mode === 'locked' ? pol('channelOptIn') : null}>
            TapaTV can schedule it live, with ads.
          </SwitchRow>
          <SwitchRow title="Ask for the home page hero" on={form.featured} onChange={(v) => set('featured', v)} disabled={!isOpen(pol('featured'))} policy={pol('featured').mode === 'locked' ? pol('featured') : null}>
            The studio decides what rotates.
          </SwitchRow>
          <SwitchRow title="Tapa Original" on={form.isOriginal} onChange={(v) => set('isOriginal', v)} disabled={!isOpen(pol('isOriginal'))} policy={pol('isOriginal').mode === 'locked' ? pol('isOriginal') : null}>
            Made with or for the studio.
          </SwitchRow>
        </View>
      ) : null}
    </View>
  );
}

// The line at the top of More info on a live title.
export function StagedLegend() {
  return (
    <View style={ef.legend}>
      <ClockIcon size={13} color={colors.olive} />
      <Text style={[ss.small, { flex: 1 }]}>Marked fields go to review on a live episode. Everything else saves at once.</Text>
    </View>
  );
}

const ef = StyleSheet.create({
  title: { fontFamily: fonts.bodyBold, fontSize: 18, minHeight: 48 },
  sameRow: { paddingVertical: 10, gap: 8 },
  sameDivider: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  sameHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sameValue: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink },
  sameChip: { borderWidth: 1, borderColor: inkTint(0.2), borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  differsChip: { borderColor: brassTint(0.5) },
  lockedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: inkTint(0.2), borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  chipText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.4, color: colors.inkDim, textTransform: 'uppercase' },
  sameEdit: { padding: 12, borderRadius: 10, backgroundColor: colors.surface0, borderWidth: 1, borderColor: inkTint(0.1) },
  ratingBox: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: colors.ink, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 1 },
  ratingText: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.ink },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: inkTint(0.25), borderRadius: 10, backgroundColor: colors.surface0, overflow: 'hidden' },
  stepperTaken: { borderColor: brassTint(0.7) },
  stepBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  stepE: { fontFamily: fonts.monoBold, fontSize: 14, color: colors.inkDim },
  stepInput: { width: 54, height: 44, textAlign: 'center', fontFamily: fonts.monoBold, fontSize: 16, color: colors.ink },
  conflict: { gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: brassTint(0.5), backgroundColor: brassTint(0.08) },
  conflictText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  moreHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moreTitle: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legend: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8, backgroundColor: oliveTint(0.07), borderWidth: 1, borderColor: oliveTint(0.3) }
});
