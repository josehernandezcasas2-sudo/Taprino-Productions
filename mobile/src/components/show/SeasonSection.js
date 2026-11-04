import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { rowPill } from '../../lib/showRules';
import { brassTint, colors, fonts, inkTint, oliveTint } from '../../lib/theme';
import SmartImage from '../SmartImage';
import { ExternalLinkIcon, PencilIcon, TrashIcon, WarningIcon } from '../WorkIcons';
import {
  ActionSheet, ArrowDownIcon, ArrowUpIcon, ChevronIcon, KebabIcon, LinkText, Pill, PlusIcon, SendIcon, SmallButton, UploadIcon,
  ago, minutesOf, ss
} from './ShowBits';

// A season of the show page in the app (the series revamp, slice 5; the
// website's components/show/SeasonSection.js): the header (the label, the
// count, "Send N for review", the season's menu: name it, Renumber from
// 1…, start the next season), its rows in play order — episodes, the
// viewer's drafts and dashed gap rows — and whatever the screen puts at
// its foot. Presentational: the screen owns the data and every request.
//
// A row: ↑/↓ (no drag in the app), the E-badge (tap → type a number; a
// taken one offers Swap | Insert here), the 16:9 thumb (its own still,
// else the show's), the title (or "Episode N"), the pill (lib/showRules.js
// rowPill) and the meta line, the kebab (the screen's action sheet). A tap
// on the row opens the editor.
//
// ctx (from the screen): { kind, showName, showStill, showPoster,
//   showPublic, isOwner, team, canRun, shows118, drafts116, canReorder,
//   reorderOpen, reorderLine, canAdd, canOpen(row), canMove(row), uploads,
//   conflicts, rowNotes, busyRow, flashId, sending, confirm, lastSeason,
//   defaultTier, premiumWord, rowRef(id) }
// actions: { open(row), menu(row), moveBy(row, delta), setNumber(row, n),
//   resolveConflict(row, 'swap' | 'insert'), clearConflict(row),
//   send(season, draftIds), renameSeason(season, name), askRenumber(season),
//   renumber(season), cancelConfirm(), addSeason(), addAt(season, number) }

// What the meta line says: [{ text, tone: null | 'warn' | 'ok' | 'wait' }].
export function rowMeta(row, ctx, upload) {
  const parts = [];
  const add = (text, tone = null) => { if (text) parts.push({ text, tone }); };
  if (row.kind === 'draft') {
    const runtime = minutesOf((row.video && row.video.runtimeSeconds) || null);
    if (upload && (upload.status === 'uploading' || upload.status === 'starting')) add(upload.eta || (upload.status === 'starting' ? 'starting…' : 'uploading'));
    else if (upload && upload.status === 'queued') add(upload.after ? `after ${upload.after}` : 'waits its turn');
    else if (upload && upload.status === 'stopped') add(upload.error || 'The upload stopped — pick the same file to resume', 'warn');
    else if (runtime) add(runtime);
    if (upload && upload.status === 'uploaded' && row.master !== 'ready') add('uploaded · processing');
    else if (!upload || !['queued', 'starting', 'uploading', 'stopped'].includes(upload.status)) {
      if (row.blocker && row.master === 'uploading') add('The upload stopped — pick the same file to resume', 'warn');
      else if (row.master === 'error') add('The file failed — replace it', 'warn');
      else if (row.master === 'none' && row.file) add('Not uploaded yet — pick the same file to resume', 'warn');
      else if (row.master === 'none' && !row.audio) add('No file yet', 'warn');
      else if (row.ready) add('ready to send', 'ok');
      else if (row.blocker && row.master !== 'processing') add(row.blocker, 'warn');
    }
    return parts;
  }
  add(minutesOf(row.runtime));
  if (row.status === 'pending' && row.createdAt) add(`sent ${ago(row.createdAt)}`);
  if (row.status === 'pending' && ['uploading', 'processing'].includes(row.master)) add(row.master === 'uploading' ? 'the upload never finished' : 'processing', row.master === 'uploading' ? 'warn' : null);
  if (row.master === 'error') add('The file failed — replace it', 'warn');
  if (row.status === 'rejected' && row.rejectionReason) add(row.rejectionReason, 'warn');
  if (row.status === 'approved' && ctx.kind !== 'podcast' && row.hasCaptions === false) add('Needs captions', 'warn');
  if (row.captionsStale) add('Captions may be out of sync', 'warn');
  const st = row.staged || {};
  if (st.title) add('Title change waiting', 'wait');
  if (st.poster || st.thumbnail) add('Art waiting for approval', 'wait');
  if (st.newVideo) add('New file waiting', 'wait');
  if (row.hasPageChoice === true) add('its own page');
  if (row.tier && ctx.defaultTier && row.tier !== ctx.defaultTier) add(row.tier === 'free' ? 'free' : ctx.premiumWord);
  if (row.uploaderName) add(`uploaded by ${row.uploaderName}`);
  return parts;
}

const META_COLOR = { warn: colors.brass, ok: colors.ok, wait: colors.olive };

function MetaLine({ parts }) {
  if (!parts.length) return null;
  return (
    <Text style={st.meta} numberOfLines={3}>
      {parts.map((p, i) => (
        <Text key={i}>
          <Text style={p.tone ? { color: META_COLOR[p.tone] } : null}>{p.text}</Text>
          {i < parts.length - 1 ? <Text style={st.dot}>{'  ·  '}</Text> : null}
        </Text>
      ))}
    </Text>
  );
}

// The E-badge: tap → a number field; Done keeps it, leaving it empty
// keeps the old one.
function NumberBadge({ row, editable, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  // Done then the blur that follows it: only the first one counts.
  const closed = useRef(false);
  const label = row.seriesOrder ? `E${row.seriesOrder}` : 'E–';
  if (!editable) return <View style={[st.badge, st.badgeStatic]}><Text style={st.badgeText}>{label}</Text></View>;
  if (!editing) {
    return (
      <Pressable style={st.badge} onPress={() => { closed.current = false; setValue(row.seriesOrder ? String(row.seriesOrder) : ''); setEditing(true); }} accessibilityRole="button" accessibilityLabel={`${row.code || label}: change the number`} hitSlop={6}>
        <Text style={[st.badgeText, st.badgeTextEditable]}>{label}</Text>
      </Pressable>
    );
  }
  const done = (keep) => {
    if (closed.current) return;
    closed.current = true;
    setEditing(false);
    const n = Number(value);
    if (keep && Number.isInteger(n) && n > 0 && n !== row.seriesOrder) onCommit(n);
  };
  return (
    <View style={[st.badge, st.badgeEditing]}>
      <Text style={st.badgeText}>E</Text>
      <TextInput
        style={st.badgeInput}
        value={value}
        autoFocus
        keyboardType="number-pad"
        returnKeyType="done"
        maxLength={4}
        selectTextOnFocus
        accessibilityLabel="Episode number"
        onChangeText={(t) => setValue(t.replace(/[^0-9]/g, ''))}
        onSubmitEditing={() => done(true)}
        onBlur={() => done(true)}
      />
    </View>
  );
}

function EpisodeRow({ row, index, count, ctx, actions }) {
  const isDraft = row.kind === 'draft';
  const upload = isDraft ? (ctx.uploads || {})[row.id] || null : null;
  const pill = rowPill(row, { showPublic: ctx.showPublic, upload: upload ? { status: upload.status, pct: upload.pct } : null });
  const openable = ctx.canOpen(row);
  const reorderable = ctx.canReorder && row.inRunningOrder !== false && row.status !== 'rejected' && !row.withdrawnAt;
  const thumb = row.thumbnail || ctx.showStill || ctx.showPoster || null;
  const conflict = (ctx.conflicts || {})[row.id] || null;
  const note = (ctx.rowNotes || {})[row.id] || null;
  const busy = ctx.busyRow === row.id;
  const pct = upload && (upload.status === 'uploading' || upload.status === 'starting') ? Math.max(2, Math.min(100, upload.pct || 0)) : null;
  const title = row.displayTitle || row.title || (row.seriesOrder ? `Episode ${row.seriesOrder}` : 'Untitled');
  const upOff = !ctx.reorderOpen || index <= 0 || busy;
  const downOff = !ctx.reorderOpen || index < 0 || index >= count - 1 || busy;
  return (
    <View ref={ctx.rowRef ? ctx.rowRef(row.id) : undefined} collapsable={false} style={[st.row, isDraft && st.rowDraft, ctx.flashId === row.id && st.rowFlash]}>
      <View style={st.rowLine}>
        {reorderable ? (
          <View style={st.arrows}>
            <Pressable style={[st.arrow, upOff && ss.disabled]} disabled={upOff} onPress={() => actions.moveBy(row, -1)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Move ${title} up`} accessibilityState={{ disabled: upOff }}>
              <ArrowUpIcon size={14} color={colors.ink} />
            </Pressable>
            <Pressable style={[st.arrow, downOff && ss.disabled]} disabled={downOff} onPress={() => actions.moveBy(row, 1)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Move ${title} down`} accessibilityState={{ disabled: downOff }}>
              <ArrowDownIcon size={14} color={colors.ink} />
            </Pressable>
          </View>
        ) : <View style={st.arrowsSpace} />}
        <NumberBadge row={row} editable={reorderable && ctx.reorderOpen && !busy} onCommit={(n) => actions.setNumber(row, n)} />
        <Pressable style={st.main} disabled={!openable} onPress={() => actions.open(row)} accessibilityRole="button" accessibilityLabel={`${row.code ? `${row.code}, ` : ''}${title}${pill ? `, ${pill.label}` : ''}`}>
          <View style={st.thumbWrap}>
            {thumb ? <SmartImage uri={thumb} style={st.thumb} resizeMode="cover" /> : <View style={[st.thumb, st.thumbEmpty]}><Text style={st.thumbName} numberOfLines={2}>{ctx.showName}</Text></View>}
            {pct !== null ? <View style={st.thumbBar}><View style={[st.thumbBarFill, { width: `${pct}%` }]} /></View> : null}
          </View>
          <View style={st.text}>
            <Text style={st.title} numberOfLines={2}>{title}</Text>
            <View style={st.sub}>
              {pill ? <Pill label={pill.label} tone={pill.tone} /> : null}
              {busy ? <ActivityIndicator size="small" color={colors.olive} /> : null}
            </View>
            <MetaLine parts={rowMeta(row, ctx, upload)} />
          </View>
        </Pressable>
        <Pressable style={st.kebab} onPress={() => actions.menu(row)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`More for ${title}`}>
          <KebabIcon size={18} color={colors.inkDim} />
        </Pressable>
      </View>
      {conflict ? (
        <View style={st.conflict} accessibilityLiveRegion="polite">
          <View style={ss.row}>
            <WarningIcon size={14} color={colors.brass} />
            <Text style={[ss.p, { flex: 1, color: colors.ink }]}><Text style={ss.strong}>E{conflict.number}</Text> is {conflict.holderTitle ? <Text style={ss.strong}>{conflict.holderTitle}</Text> : 'taken'}{conflict.choices.length ? ' —' : ''}</Text>
          </View>
          <View style={ss.wrap}>
            {conflict.choices.includes('swap') ? <SmallButton label="Swap" disabled={busy} onPress={() => actions.resolveConflict(row, 'swap')} /> : null}
            {conflict.choices.includes('insert') ? <SmallButton label="Insert here" disabled={busy} onPress={() => actions.resolveConflict(row, 'insert')} /> : null}
            {conflict.nextFree ? <SmallButton label={`Use E${conflict.nextFree}`} disabled={busy} onPress={() => actions.setNumber(row, conflict.nextFree)} /> : null}
            <LinkText onPress={() => actions.clearConflict(row)}>Cancel</LinkText>
          </View>
          {(conflict.lines || []).map((l, i) => <Text key={`${i}-${l}`} style={ss.small}>{l}</Text>)}
        </View>
      ) : null}
      {note ? <Text style={[st.note, note.tone === 'ok' ? { color: colors.ok } : null]}>{note.text}</Text> : null}
    </View>
  );
}

function GapRow({ row, ctx, actions }) {
  return (
    <View ref={ctx.rowRef ? ctx.rowRef(`gap-${row.season}-${row.from}`) : undefined} collapsable={false} style={[st.row, st.gap]}>
      <View style={st.rowLine}>
        <View style={st.arrowsSpace} />
        <View style={[st.badge, st.badgeGap]}><Text style={[st.badgeText, { color: colors.inkDim }]}>E{row.from}</Text></View>
        <Text style={[ss.small, { flex: 1 }]}>
          {row.words}
          {ctx.canAdd ? (
            <Text>
              {' — '}
              <Text style={ss.link} onPress={() => actions.addAt(row.season, row.from)}>add here</Text>
              {ctx.canReorder ? (
                <Text>
                  {' or '}
                  <Text style={[ss.link, !ctx.reorderOpen && ss.disabled]} onPress={ctx.reorderOpen ? () => actions.askRenumber(row.season) : undefined}>renumber</Text>
                </Text>
              ) : null}
            </Text>
          ) : null}
        </Text>
      </View>
    </View>
  );
}

export default function SeasonSection({ season, ctx, actions, children = null }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const labelName = season.label && season.label.includes(' · ') ? season.label.slice(season.label.indexOf(' · ') + 3) : '';
  const rows = season.rows || [];
  const items = rows.filter((r) => r.kind !== 'gap');
  const order = items.filter((r) => r.inRunningOrder !== false && r.status !== 'rejected' && !r.withdrawnAt);
  const episodes = items.filter((r) => r.kind === 'episode');
  const inReview = episodes.filter((r) => r.status === 'pending').length;
  const drafts = items.filter((r) => r.kind === 'draft');
  const ready = drafts.filter((r) => r.mine && r.ready);
  const counts = [];
  if (episodes.length || !drafts.length) counts.push(`${episodes.length} episode${episodes.length === 1 ? '' : 's'}`);
  if (inReview) counts.push(`${inReview} in review`);
  if (drafts.length) counts.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'}`);
  if (ready.length) counts.push(`${ready.length} ready to send`);
  const sending = ctx.sending && ctx.sending.season === season.number ? ctx.sending : null;
  const menu = ctx.canRun ? [
    { key: 'rename', label: labelName ? 'Rename season' : 'Name this season', icon: <PencilIcon size={15} color={colors.ink} />, disabled: !ctx.shows118, note: ctx.shows118 ? null : 'Season names need a database update (migration 118).', onPress: () => { setName(labelName); setRenaming(true); } },
    { key: 'renumber', label: 'Renumber from 1…', icon: <Text style={st.menuGlyph}>1→</Text>, disabled: !ctx.reorderOpen, note: ctx.reorderOpen ? null : ctx.reorderLine, onPress: () => actions.askRenumber(season.number) },
    season.number === ctx.lastSeason && ctx.canAdd ? { key: 'next', label: `Start Season ${season.number + 1}`, icon: <PlusIcon size={15} color={colors.ink} />, onPress: () => actions.addSeason() } : null
  ] : [];
  const confirming = ctx.confirm && ctx.confirm.season === season.number ? ctx.confirm : null;
  return (
    <View style={st.season} accessibilityLabel={`Season ${season.number}`}>
      <View style={st.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.headTitle} accessibilityRole="header">
            Season {season.number}{labelName ? <Text style={st.headLabel}> · {labelName}</Text> : null}
          </Text>
          <Text style={ss.mono}>{season.empty ? 'Kept once its first episode lands' : counts.join(' · ')}</Text>
        </View>
        {menu.filter(Boolean).length ? (
          <Pressable style={st.kebab} onPress={() => setMenuOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`More for Season ${season.number}`}>
            <KebabIcon size={18} color={colors.inkDim} />
          </Pressable>
        ) : null}
      </View>
      {ready.length > 0 ? (
        <SmallButton
          tone="primary"
          icon={<SendIcon size={14} color={colors.oliveShadow} />}
          label={sending ? sending.label : `Send ${ready.length} for review`}
          busy={Boolean(sending)}
          disabled={Boolean(ctx.sending) || !ctx.drafts116}
          onPress={() => actions.send(season.number, ready.map((r) => r.id))}
        />
      ) : null}
      {renaming ? (
        <View style={st.rename}>
          <Text style={ss.sheetLabel}>Season {season.number}&rsquo;s name</Text>
          <TextInput style={ss.input} value={name} maxLength={80} autoFocus placeholder="Optional name" placeholderTextColor={colors.inkFaint} onChangeText={setName} returnKeyType="done" onSubmitEditing={() => { setRenaming(false); actions.renameSeason(season.number, name); }} />
          <View style={ss.wrap}>
            <SmallButton label="Save" onPress={() => { setRenaming(false); actions.renameSeason(season.number, name); }} />
            <LinkText onPress={() => setRenaming(false)}>Cancel</LinkText>
          </View>
        </View>
      ) : null}
      {confirming ? (
        <View style={st.confirm} accessibilityLiveRegion="polite">
          <Text style={ss.p}><Text style={ss.strong}>Renumber Season {season.number} from E1?</Text> {confirming.words}</Text>
          <Text style={ss.small}>Every other place keeps its number otherwise; this fills the gaps. Visitors see the new numbers within a few minutes.</Text>
          <View style={ss.wrap}>
            <SmallButton tone="primary" label={ctx.busyRow === `renumber-${season.number}` ? 'Renumbering…' : 'Renumber'} busy={ctx.busyRow === `renumber-${season.number}`} onPress={() => actions.renumber(season.number)} />
            <LinkText onPress={() => actions.cancelConfirm()}>Cancel</LinkText>
          </View>
        </View>
      ) : null}
      {rows.length > 0 ? (
        <View style={st.rows}>
          {rows.map((r) => (r.kind === 'gap'
            ? <GapRow key={r.id} row={r} ctx={ctx} actions={actions} />
            : <EpisodeRow key={`${r.kind}-${r.id}`} row={r} index={order.indexOf(r)} count={order.length} ctx={ctx} actions={actions} />))}
        </View>
      ) : null}
      {children}
      <ActionSheet visible={menuOpen} title={season.label || `Season ${season.number}`} eyebrow={ctx.showName} items={menu} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

// The row's kebab, as the items of an action sheet (the website's row
// menu): Edit, Move to…, Its own page on/off, Replace file, View page,
// Pick the same file to resume, Discard / Remove…. `actions` here are the
// screen's: { open, openMove, togglePage, pickFile, discard, askRemove,
// viewPublic }.
export function rowMenuItems(row, ctx, actions) {
  const isDraft = row.kind === 'draft';
  const mine = row.mine || ctx.team;
  const openable = ctx.canOpen(row);
  const upload = isDraft ? (ctx.uploads || {})[row.id] || null : null;
  const items = [];
  if (openable) items.push({ key: 'edit', label: 'Edit', icon: <PencilIcon size={15} color={colors.ink} />, onPress: () => actions.open(row) });
  if (ctx.canMove(row)) items.push({ key: 'move', label: 'Move to…', icon: <ChevronIcon size={15} color={colors.ink} />, onPress: () => actions.openMove(row) });
  if (!isDraft && (ctx.isOwner || mine) && row.status !== 'rejected') {
    items.push({ key: 'page', label: row.hasPage ? 'Use the player only' : 'Give it its own page', icon: <ExternalLinkIcon size={15} color={colors.ink} />, disabled: !ctx.shows118, note: ctx.shows118 ? null : 'Needs a database update (migration 118).', onPress: () => actions.togglePage(row) });
  }
  if (!isDraft && mine && openable) items.push({ key: 'replace', label: 'Replace file', icon: <UploadIcon size={15} color={colors.ink} />, onPress: () => actions.open(row) });
  if (!isDraft && row.status === 'approved' && ctx.showPublic && !row.held && !row.deletionRequested) items.push({ key: 'view', label: 'View page', icon: <ExternalLinkIcon size={15} color={colors.ink} />, onPress: () => actions.viewPublic(row) });
  if (isDraft && row.mine) {
    const stopped = (upload && upload.status === 'stopped') || row.master === 'uploading' || row.master === 'none' || row.master === 'error';
    if (stopped && !(upload && ['queued', 'starting', 'uploading'].includes(upload.status))) {
      items.push({ key: 'pick', label: row.master === 'none' && !row.video ? 'Pick the file' : 'Pick the same file to resume', icon: <UploadIcon size={15} color={colors.ink} />, onPress: () => actions.pickFile(row) });
    }
    items.push({ divider: true });
    items.push({ key: 'discard', label: 'Discard', icon: <TrashIcon size={15} color={colors.danger} />, danger: true, onPress: () => actions.discard(row) });
  } else if (!isDraft && row.mine && !row.deletionRequested && !row.withdrawnAt) {
    items.push({ divider: true });
    items.push({ key: 'remove', label: 'Remove…', icon: <TrashIcon size={15} color={colors.danger} />, danger: true, onPress: () => actions.askRemove(row) });
  }
  return items;
}

const st = StyleSheet.create({
  season: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: inkTint(0.12) },
  headTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink, paddingTop: 6 },
  headLabel: { fontFamily: fonts.display, color: colors.inkDim },
  rename: { gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: inkTint(0.12) },
  confirm: { gap: 8, padding: 12, borderRadius: 10, backgroundColor: oliveTint(0.08), borderWidth: 1, borderColor: oliveTint(0.4) },
  rows: { gap: 8 },
  row: { padding: 8, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.1), backgroundColor: colors.surface1, gap: 8 },
  rowDraft: { borderStyle: 'dashed', borderColor: inkTint(0.22) },
  rowFlash: { borderColor: colors.olive, backgroundColor: oliveTint(0.08) },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gap: { borderStyle: 'dashed', backgroundColor: 'transparent', borderColor: brassTint(0.35) },
  arrows: { gap: 4 },
  arrowsSpace: { width: 28 },
  arrow: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 40, height: 30, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1, borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  badgeStatic: { borderColor: inkTint(0.12) },
  badgeEditing: { borderColor: colors.olive, backgroundColor: colors.surface0 },
  badgeGap: { borderStyle: 'dashed', borderColor: brassTint(0.45) },
  badgeText: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.ink },
  badgeTextEditable: { color: colors.olive },
  badgeInput: { minWidth: 28, paddingVertical: 0, color: colors.ink, fontFamily: fonts.monoMedium, fontSize: 13 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 9, minWidth: 0 },
  thumbWrap: { width: 88, height: 50, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.surface2 },
  thumb: { width: 88, height: 50 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  thumbName: { fontFamily: fonts.mono, fontSize: 9, color: colors.inkDim, textAlign: 'center' },
  thumbBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: inkTint(0.2) },
  thumbBarFill: { height: 4, backgroundColor: colors.olive },
  text: { flex: 1, gap: 4, minWidth: 0 },
  title: { fontFamily: fonts.displaySemi, fontSize: 14, lineHeight: 18, color: colors.ink },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, color: colors.inkDim },
  dot: { color: colors.inkFaint },
  kebab: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 },
  menuGlyph: { fontFamily: fonts.monoMedium, fontSize: 11, color: colors.ink },
  conflict: { gap: 8, padding: 10, borderRadius: 8, backgroundColor: brassTint(0.08), borderWidth: 1, borderColor: brassTint(0.35) },
  note: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.brass, paddingHorizontal: 4 }
});
