import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, inkTint } from '../../lib/theme';
import SmartImage from '../SmartImage';
import { Switch } from '../CreatorBits';
import { ClockIcon, PencilIcon, TrashIcon, WarningIcon, ExternalLinkIcon } from '../WorkIcons';
import {
  BanIcon, CheckIcon, ChevronIcon, KebabIcon, KindChip, LinkText, NoEyeIcon, Pill, PlusIcon, SmallButton, StateChip, TONE,
  askUs, countLine, minutesOf, shortDate, ss
} from './ShowBits';
import { PaidLine } from './PayeeCard';

// The show page's cards in the app (the series revamp, slice 5; the
// website's components/show/ShowCards.js): the show card, the status card,
// the Sell card, the channels switch, "Remove this show…" and the Extras
// shelf. Presentational: the screen (app/creator/show/[id]/index.js) owns
// the data and every request.

// The private preview (?preview=1) is slice 4: its links stay hidden.
export const PREVIEW_BUILT = false;

// The show card: the poster (tap → Edit show, art), the name (or its
// title image), Series | Podcast, where it stands, the count line, the
// description's first paragraph, what waits for approval (each with
// Cancel), Edit show and View page. `payee` (slice 3b, the show's "Who gets
// paid" block; null for a viewer who may not see who is paid) adds
// "RUNS IT … · PAID TO …" under the count line.
export function ShowCard({ view, canEdit, onEdit, onView, onCancelStaged, busy, payee = null }) {
  const show = view.show;
  const st = show.staged || {};
  const art = show.art || {};
  const firstLine = String(show.description || '').split(/\n\s*\n/)[0].trim();
  const staged = [
    st.name ? { field: 'name', words: `New name “${st.name}” waiting` } : null,
    st.poster ? { field: 'poster', words: 'New poster waiting' } : null,
    st.thumbnail ? { field: 'thumbnail', words: 'New still waiting' } : null,
    st.heroImage ? { field: 'heroImage', words: 'New hero image waiting' } : null,
    st.titleImageUrl || st.titleImageRemoval ? { field: 'titleImage', words: st.titleImageRemoval ? 'Title image removal waiting' : 'New title image waiting' } : null,
    st.trailer ? { field: 'trailer', words: 'New trailer waiting' } : null,
    st.description ? { field: 'description', words: 'New description waiting' } : null
  ].filter(Boolean);
  const poster = art.poster ? (
    <SmartImage uri={art.poster} style={cs.poster} resizeMode="cover" />
  ) : (
    <View style={[cs.poster, cs.posterEmpty]}><Text style={cs.posterName} numberOfLines={4}>{show.name}</Text></View>
  );
  return (
    <View style={ss.card} accessibilityLabel={show.name || 'The show'}>
      <View style={cs.top}>
        {canEdit ? (
          <Pressable onPress={() => onEdit('art')} accessibilityRole="button" accessibilityLabel="Change the poster (Edit show, Art)">{poster}</Pressable>
        ) : poster}
        <View style={cs.body}>
          {art.titleImageUrl ? (
            <SmartImage uri={art.titleImageUrl} style={cs.titleImage} resizeMode="contain" accessibilityLabel={show.name || ''} />
          ) : (
            <Text style={cs.name} accessibilityRole="header">{show.name}</Text>
          )}
          <View style={ss.wrap}>
            <KindChip kind={show.kind} />
            <StateChip state={show.state} label={show.statusLabel} />
          </View>
          <Text style={cs.count}>{countLine(view.seasons)}</Text>
          <PaidLine payee={payee} />
          {firstLine ? <Text style={cs.desc} numberOfLines={2}>{firstLine}</Text> : null}
        </View>
      </View>
      {staged.length > 0 ? (
        <View style={cs.staged}>
          {staged.map((s) => (
            <View key={s.field} style={cs.stagedRow}>
              <ClockIcon size={13} color={colors.olive} />
              <Text style={cs.stagedText}>{s.words}</Text>
              {canEdit && onCancelStaged ? (
                <LinkText disabled={busy === `staged-${s.field}`} onPress={() => onCancelStaged(s.field)}>{busy === `staged-${s.field}` ? '…' : 'Cancel'}</LinkText>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={ss.wrap}>
        {canEdit ? <SmallButton label="Edit show" icon={<PencilIcon size={14} color={colors.ink} />} onPress={() => onEdit('details')} /> : null}
        {show.isPublic ? <SmallButton label="View page" icon={<ExternalLinkIcon size={14} color={colors.ink} />} onPress={onView} /> : null}
      </View>
    </View>
  );
}

function agoWords(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'for review';
  const h = Math.floor((Date.now() - t) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// The status card: the headline by where the show stands
// (lib/showRules.js showState), what it means, its buttons (Make it
// public, Cancel request, Resubmit) and the problem lines (showProblems),
// each leading to its row.
export function ShowStatusCard({ view, contributor, onProblem, onMakePublic, onCancelRemoval, onResubmit, busy }) {
  const show = view.show;
  const noun = show.kind === 'podcast' ? 'show' : 'series';
  const state = show.state;
  const problems = (view.problems || []).filter((p) => p.code !== 'delay');
  const delay = (view.problems || []).some((p) => p.code === 'delay');
  const rows = (view.seasons || []).flatMap((s) => s.rows || []);
  const eps = rows.filter((r) => r.kind === 'episode');
  const firstReview = eps.filter((r) => r.status === 'pending').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0] || null;
  const firstApproved = eps.find((r) => r.status === 'approved') || null;
  const level = state === 'pulled' ? 'danger' : state === 'declined' ? 'warn' : state === 'removal' || state === 'empty' || state === 'drafts' ? 'neutral' : state === 'review' ? 'review' : 'ok';
  const tone = TONE[level];
  const make = view.makePublic;
  let icon = <View style={[cs.dot, { backgroundColor: tone.fg }]} />;
  let body = null;
  let acts = null;
  if (state === 'empty' || state === 'drafts') {
    icon = <NoEyeIcon size={18} color={tone.fg} />;
    body = <Text style={ss.p}>Once we approve an episode, you choose when it goes public.</Text>;
  } else if (state === 'review') {
    icon = <ClockIcon size={18} color={tone.fg} />;
    body = firstReview
      ? <Text style={ss.p}><Text style={ss.strong}>{firstReview.displayTitle}</Text> ({firstReview.code}) was sent {firstReview.createdAt ? agoWords(firstReview.createdAt) : 'for review'}. Once we approve it, you choose when {show.name} goes public.</Text>
      : <Text style={ss.p}>Once we approve an episode, you choose when {show.name} goes public.</Text>;
  } else if (state === 'ready') {
    icon = <CheckIcon size={18} color={tone.fg} />;
    body = <Text style={ss.p}>{firstApproved ? <Text style={ss.strong}>{firstApproved.displayTitle} is approved. </Text> : null}{show.name} stays private until you make it public, so you can wait for more episodes and open a whole season at once. Episodes approved after that go live straight away.</Text>;
    acts = make && make.ok ? (
      <SmallButton label={busy === 'public' ? 'Making it public…' : 'Make it public'} tone="primary" busy={busy === 'public'} onPress={onMakePublic} />
    ) : make && make.reason ? <Text style={ss.small}>{make.reason}</Text> : null;
  } else if (state === 'pulled') {
    icon = <BanIcon size={18} color={tone.fg} />;
    body = <Text style={ss.p}>You can still replace the file (the new one comes to us first), add captions and edit page notes. <Text style={ss.link} onPress={() => askUs(`Pulled: ${show.name}`)}>Email us</Text></Text>;
  } else if (state === 'removal') {
    icon = <TrashIcon size={18} color={tone.fg} />;
    body = <Text style={ss.p}>Nothing on the {noun} can be changed while the request is open.{show.deletion && show.deletion.reason ? ` Your reason: “${show.deletion.reason}”` : ''}</Text>;
    acts = !contributor && onCancelRemoval ? <SmallButton label={busy === 'removal' ? 'Cancelling…' : 'Cancel request'} busy={busy === 'removal'} onPress={onCancelRemoval} /> : null;
  } else if (state === 'declined') {
    icon = <WarningIcon size={18} color={tone.fg} />;
    body = <Text style={ss.p}>{show.decisionNote ? <Text><Text style={ss.strong}>Their note:</Text> {show.decisionNote} </Text> : null}Fix what it needs and press Resubmit; it comes back as not public yet.</Text>;
    acts = !contributor && onResubmit ? <SmallButton label={busy === 'resubmit' ? 'Sending…' : 'Resubmit'} tone="primary" busy={busy === 'resubmit'} onPress={onResubmit} /> : null;
  }
  const headline = state === 'removal' && show.deletion && show.deletion.at ? `Removal requested on ${shortDate(show.deletion.at)}` : show.headline || show.statusLabel;
  return (
    <View style={[cs.status, { borderColor: tone.border, backgroundColor: tone.bg }]} accessibilityLabel="Where the show stands">
      <View style={cs.statusHead}>
        <View style={cs.statusIcon}>{icon}</View>
        <Text style={cs.statusTitle} accessibilityRole="header">{headline}</Text>
      </View>
      {body && !contributor ? body : null}
      {contributor ? (
        <Text style={ss.small}>Only {show.ownerName || 'its owner'} can change this {noun}. You can still edit your own episodes.</Text>
      ) : acts}
      {problems.length > 0 && !contributor ? (
        <View style={cs.problems}>
          <Text style={ss.cardK}>{problems.length === 1 ? '1 thing needs you' : `${problems.length} things need you`}</Text>
          {problems.map((p, i) => (
            <Pressable key={`${p.code}-${i}`} style={({ pressed }) => [cs.problem, pressed && ss.pressed]} onPress={() => onProblem(p)} accessibilityRole="button">
              {p.level === 'warn' ? <WarningIcon size={15} color={colors.brass} /> : <ClockIcon size={15} color={colors.olive} />}
              <Text style={cs.problemText}>{p.words}</Text>
              <ChevronIcon size={14} color={colors.inkDim} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {delay ? (
        <View style={ss.row}><ClockIcon size={12} color={colors.inkDim} /><Text style={ss.mono}>Changes reach visitors within a few minutes</Text></View>
      ) : null}
    </View>
  );
}

const dollars = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

// "Sell" (live shows only): the whole series' price state, the episodes'
// price when they share one, how many own the whole series, and the button
// that opens SellTitleSheet for the series.
export function SellCard({ view, episodePrices, onOpen }) {
  const price = view.price;
  const state = !price ? 'none' : price.pendingCents != null ? 'pending' : price.status || 'off';
  const pill = { on: { text: 'On sale', tone: 'ok' }, pending: { text: 'In review', tone: 'review' }, off: { text: 'Not selling', tone: 'neutral' }, rejected: { text: 'Not approved', tone: 'warn' }, none: null }[state];
  const each = (episodePrices || []).filter((c) => c > 0);
  const same = each.length > 0 && each.every((c) => c === each[0]);
  const buyers = view.cascade ? Number(view.cascade.seriesBuyers) || 0 : 0;
  const noun = view.show.kind === 'podcast' ? 'show' : 'series';
  return (
    <View style={ss.card}>
      <Text style={ss.cardK}>Sell</Text>
      <View style={cs.sellRow}>
        <View style={[ss.wrap, { flex: 1 }]}>
          <Text style={cs.sellWhat}>Whole {noun}</Text>
          {pill ? <Pill label={pill.text} tone={pill.tone} /> : null}
        </View>
        <Text style={cs.sellPrice}>{price && price.priceCents ? dollars(price.priceCents) : price && price.pendingCents ? dollars(price.pendingCents) : '—'}</Text>
      </View>
      {each.length > 0 ? (
        <View style={cs.sellRow}>
          <Text style={[cs.sellWhat, { flex: 1 }]}>Each episode</Text>
          <Text style={cs.sellPrice}>{same ? dollars(each[0]) : `from ${dollars(Math.min(...each))}`}</Text>
        </View>
      ) : null}
      {buyers > 0 ? <Text style={ss.small}>{buyers} {buyers === 1 ? 'person owns' : 'people own'} the whole {noun}</Text> : null}
      <SmallButton label={price ? 'Price and sales' : `Sell the whole ${noun}`} onPress={onOpen} />
    </View>
  );
}

// "Let channels air the whole show" (direct, the owner or the team).
export function ChannelsCard({ view, canEdit, locked, busy, onToggle }) {
  const on = Boolean(view.show.channelOptIn);
  return (
    <View style={[ss.card, (!canEdit || locked || busy) && { opacity: 0.7 }]}>
      <Switch
        on={on}
        label="Let channels air the whole show"
        hint={`${on ? 'On.' : 'Off.'} TapaTV can schedule every episode live, with ads.${locked ? ` ${locked}` : ''}`}
        onPress={() => { if (canEdit && !locked && !busy) onToggle(!on); }}
      />
    </View>
  );
}

// "Remove this show…": the cascade words, a reason, Ask us to remove it;
// once asked, "Removal requested on <date> · Cancel".
export function RemoveShowCard({ view, canRequest, busy, onRequest, onCancel }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const show = view.show;
  const deletion = show.deletion || {};
  if (deletion.requested) {
    return (
      <View style={ss.wrap}>
        <Text style={ss.small}>Removal requested{deletion.at ? ` on ${shortDate(deletion.at)}` : ''}</Text>
        {canRequest ? <LinkText disabled={busy === 'removal'} onPress={onCancel}>{busy === 'removal' ? 'Cancelling…' : 'Cancel'}</LinkText> : null}
      </View>
    );
  }
  if (!canRequest) return null;
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
        <Text style={cs.removeOpen}>Remove this show…</Text>
      </Pressable>
    );
  }
  return (
    <View style={[ss.card, { borderColor: TONE.danger.border }]}>
      <Text style={[ss.cardK, { color: colors.danger }]}>Remove this show</Text>
      <Text style={cs.removeWords}>{view.cascade ? view.cascade.words : show.name}</Text>
      <Text style={ss.small}>It leaves the site as soon as you ask; we confirm it. Anything someone bought stays theirs.</Text>
      <Text style={ss.sheetLabel}>Why?</Text>
      <TextInput style={[ss.input, ss.textarea]} multiline maxLength={1000} value={reason} onChangeText={setReason} placeholder="A line for us" placeholderTextColor={colors.inkFaint} />
      <View style={ss.wrap}>
        <SmallButton label={busy === 'removal' ? 'Asking…' : 'Ask us to remove it'} tone="danger" disabled={!reason.trim()} busy={busy === 'removal'} onPress={() => onRequest(reason.trim())} />
        <LinkText onPress={() => { setOpen(false); setReason(''); }}>Keep it</LinkText>
      </View>
    </View>
  );
}

// Extras: bonus clips with the show or after one of its episodes.
//   onOpen(extra) → the editor; onMenu(extra) → its sheet (Edit, Place
//   after…, Remove…); onAdd() → the submit screen with type bonus.
export function ExtrasShelf({ view, ctx, onOpen, onMenu, onAdd }) {
  const extras = view.extras || [];
  const still = view.show.art ? view.show.art.thumbnail || view.show.art.poster : null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={cs.extrasH} accessibilityRole="header">Extras <Text style={cs.extrasN}>· {extras.length}</Text></Text>
      {extras.map((x) => {
        const tag = x.anchor && x.anchor.code ? `After ${x.anchor.code}` : 'With the show';
        const mine = x.mine || ctx.team;
        const art = x.thumbnail || still;
        const menu = ctx.isOwner || mine;
        return (
          <View key={x.id} style={[cs.extra, ctx.flashId === x.id && cs.flash]}>
            <Pressable style={cs.extraMain} disabled={!mine} onPress={() => onOpen(x)} accessibilityRole="button" accessibilityLabel={`${x.displayTitle}, ${tag}`}>
              {art ? <SmartImage uri={art} style={cs.extraArt} resizeMode="cover" /> : <View style={[cs.extraArt, cs.posterEmpty]}><Text style={cs.thumbName} numberOfLines={2}>{x.displayTitle}</Text></View>}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={cs.extraTitle} numberOfLines={2}>{x.displayTitle}</Text>
                <View style={ss.wrap}>
                  <Text style={cs.extraTag}>{tag}</Text>
                  {minutesOf(x.runtime) ? <Text style={ss.mono}>{minutesOf(x.runtime)}</Text> : null}
                  {x.status === 'pending' ? <Text style={[ss.mono, { color: colors.olive }]}>in review</Text> : x.status === 'rejected' ? <Text style={[ss.mono, { color: colors.brass }]}>not this time</Text> : null}
                </View>
              </View>
            </Pressable>
            {menu ? (
              <Pressable style={cs.kebab} onPress={() => onMenu(x)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More for ${x.displayTitle}`}>
                <KebabIcon size={18} color={colors.inkDim} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {ctx.canAdd ? <SmallButton label="Add extra" icon={<PlusIcon size={14} color={colors.ink} />} onPress={onAdd} /> : null}
    </View>
  );
}

export const cs = StyleSheet.create({
  top: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  poster: { width: 96, height: 144, borderRadius: 8, backgroundColor: colors.surface2 },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25) },
  posterName: { fontFamily: fonts.displaySemi, fontSize: 12, color: colors.inkDim, textAlign: 'center' },
  thumbName: { fontFamily: fonts.mono, fontSize: 9, color: colors.inkDim, textAlign: 'center' },
  body: { flex: 1, gap: 7, minWidth: 0 },
  name: { fontFamily: fonts.bodyBold, fontSize: 22, lineHeight: 26, color: colors.ink },
  titleImage: { width: '100%', height: 48 },
  count: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim },
  desc: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkDim },
  staged: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stagedText: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, color: colors.ink },
  status: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 10 },
  statusHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  statusIcon: { marginTop: 2, width: 20, alignItems: 'center' },
  statusTitle: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 23, color: colors.ink },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  problems: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  problem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8, backgroundColor: inkTint(0.05) },
  problemText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 18, color: colors.ink },
  sellRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sellWhat: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  sellPrice: { fontFamily: fonts.monoMedium, fontSize: 14, color: colors.ink },
  removeOpen: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkDim, textDecorationLine: 'underline' },
  removeWords: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 21, color: colors.ink },
  extrasH: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  extrasN: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.1), backgroundColor: colors.surface1 },
  extraMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  extraArt: { width: 96, height: 54, borderRadius: 6, backgroundColor: colors.surface2 },
  extraTitle: { fontFamily: fonts.displaySemi, fontSize: 14, lineHeight: 18, color: colors.ink },
  extraTag: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.olive },
  kebab: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  flash: { borderColor: colors.olive }
});
