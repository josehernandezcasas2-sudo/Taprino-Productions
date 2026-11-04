import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { FILES_PER_DROP, planBatch, positionsFor } from '../../lib/showRules';
import { assetFile } from '../../lib/showUploadQueue';
import { brassTint, colors, fonts, inkTint, oliveTint } from '../../lib/theme';
import { PrimaryButton } from '../CreatorBits';
import { LinkIcon, WarningIcon } from '../WorkIcons';
import { Behind, Chip, LinkText, PlusIcon, Sheet, SmallButton, UploadIcon, bytesShort, ss } from './ShowBits';

// The show page's Add bar and everything around adding, in the app (the
// series revamp, slice 5; the website's components/show/AddEpisodesBar.js):
// "+ Add episode" (the three-step submit, prefilled with the show, the
// season and the next free number), "+ Add several" (up to 30 videos
// picked at once, each a draft at once, uploading one after another) and
// "Paste a link" (a video link, or an MP3 link for a podcast). Under it,
// while files upload, the one moving in full, the next ones as short
// lines, and "Keep the app open until the uploads finish".
// Presentational: the screen does the requests; the queue is
// mobile/src/lib/showUploadQueue.js.

export default function AddEpisodesBar({ view, ctx, onAddOne, onAddSeveral, onLink, busy = false }) {
  const show = view.show;
  const podcast = show.kind === 'podcast';
  const bar = view.addBar || {};
  if (!ctx.canAdd) {
    if (!ctx.closedLine) return null;
    return (
      <View style={[ss.row, st.closed]}>
        <WarningIcon size={14} color={colors.brass} />
        <Text style={[ss.small, { flex: 1 }]}>{ctx.closedLine}</Text>
      </View>
    );
  }
  // Behind on 116: the page says so (addBar.drafts116), or a request just
  // answered 503 migration-116 (ctx.drafts116 false, ctx.behind116Line).
  const behind116 = bar.drafts116 === false || ctx.drafts116 === false;
  return (
    <View style={st.bar}>
      <PrimaryButton label="+  Add episode" onPress={onAddOne} />
      <View style={ss.wrap}>
        <SmallButton label="Add several" icon={<PlusIcon size={14} color={colors.ink} />} disabled={behind116 || busy} busy={busy} onPress={onAddSeveral} />
        <SmallButton label={podcast ? 'Paste an MP3 link' : 'Paste a link'} icon={<LinkIcon size={14} color={colors.ink} />} disabled={behind116} onPress={onLink} />
      </View>
      {podcast && !behind116 ? <Text style={ss.small}>Audio comes in by an MP3 link; a video podcast&rsquo;s files can be added like any episode.</Text> : null}
      {behind116 ? (
        <View style={{ gap: 6 }}>
          <Behind line={ctx.behind116Line || 'Adding episodes here needs a database update (migration 116)'} />
          <LinkText onPress={onAddOne}>Submit one at a time instead</LinkText>
        </View>
      ) : null}
      {bar.draftsUsed > bar.draftsCap - 10 && !behind116 ? <Text style={ss.small}>You have {bar.draftsUsed} of {bar.draftsCap} drafts — send or discard some to add more.</Text> : null}
    </View>
  );
}

// The upload in progress in full; the next ones as short lines (two, the
// rest folded behind "N more queued").
const QUEUED_SHOWN = 2;

export function QueuePanel({ items, uploads, paused, stopped, onRetry, onResumePick }) {
  const [all, setAll] = useState(false);
  const live = items.filter((it) => ['queued', 'starting', 'uploading'].includes(it.status));
  const stoppedHere = items.filter((it) => it.status === 'stopped');
  if (!live.length && !stoppedHere.length && !stopped && !paused) return null;
  const moving = live.filter((it) => it.status !== 'queued');
  const waiting = live.filter((it) => it.status === 'queued');
  const shown = all ? waiting : waiting.slice(0, QUEUED_SHOWN);
  const more = waiting.length - shown.length;
  const nameOf = (it) => (it.asset ? assetFile(it.asset).name : null);
  return (
    <View style={st.queue} accessibilityLiveRegion="polite">
      {moving.map((it) => {
        const u = uploads[it.draftId] || {};
        const pct = u.pct || 0;
        return (
          <View key={it.key} style={st.progress}>
            <View style={st.progressRow}>
              <Text style={st.progressName} numberOfLines={1}>{it.label || nameOf(it)}{it.label && nameOf(it) ? ` · ${nameOf(it)}` : ''} · uploading</Text>
              <Text style={st.progressRight}>{`${pct}%`}</Text>
            </View>
            <View style={st.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}><View style={[st.fill, { width: `${Math.max(2, pct)}%` }]} /></View>
            <Text style={st.progressMeta}>{u.eta || (it.status === 'starting' ? 'Starting…' : '')}</Text>
          </View>
        );
      })}
      {shown.map((it) => {
        const before = live[live.indexOf(it) - 1];
        return (
          <View key={it.key} style={st.queued}>
            <View style={{ flex: 1 }}>
              <Text style={st.queuedName} numberOfLines={1}>{it.label || nameOf(it)}</Text>
              <Text style={ss.mono} numberOfLines={1}>{before ? `after ${before.label || nameOf(before)}` : 'starts in a moment'}</Text>
            </View>
            <Text style={st.queuedState}>Queued</Text>
          </View>
        );
      })}
      {more > 0 || (all && waiting.length > QUEUED_SHOWN) ? (
        <LinkText onPress={() => setAll((x) => !x)}>{all ? 'Show fewer' : `${more} more queued — they start one after another`}</LinkText>
      ) : null}
      {stoppedHere.map((it) => (
        <View key={it.key} style={[st.progress, st.progressError]}>
          <View style={st.progressRow}><Text style={st.progressName} numberOfLines={1}>{it.label || nameOf(it)}</Text><Text style={st.progressRight}>Stopped</Text></View>
          <Text style={st.progressMeta}>{it.error || 'The upload stopped.'}</Text>
        </View>
      ))}
      {paused ? (
        <View style={[ss.wrap, st.paused]}>
          <WarningIcon size={14} color={colors.brass} />
          <Text style={[ss.small, { flex: 1 }]}>Uploads paused: {paused}</Text>
          <LinkText onPress={onRetry}>Try again</LinkText>
        </View>
      ) : null}
      {!paused && stoppedHere.length > 0 ? (
        <View style={ss.wrap}>
          <Text style={ss.small}>{stoppedHere.length === 1 ? 'One upload stopped.' : `${stoppedHere.length} uploads stopped.`}</Text>
          <LinkText onPress={onRetry}>Try again</LinkText>
        </View>
      ) : null}
      {stopped > 0 && live.length === 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={ss.small}>{stopped === 1 ? 'An upload stopped before it finished.' : `${stopped} uploads stopped before they finished.`} Pick the same file{stopped === 1 ? '' : 's'} to resume.</Text>
          <SmallButton label="Pick files" icon={<UploadIcon size={14} color={colors.ink} />} onPress={onResumePick} />
        </View>
      ) : null}
      {live.length > 0 ? (
        <View style={[ss.row, st.banner]}>
          <WarningIcon size={15} color={colors.olive} />
          <Text style={[ss.small, { flex: 1, color: colors.ink }]}>Keep the app open until the uploads finish</Text>
        </View>
      ) : null}
    </View>
  );
}

// "Add 6 episodes to Night Bus": the plan before anything is made — the
// season, each file's number (a number in its name kept when free, the
// rest next free in file-name order or the order they were picked), the
// ones that fill a gap or land past a taken number. Files that are a
// stopped draft's own resume it.
//   assets   the picked videos (expo-image-picker assets)
//   resumes  [{ asset, row }] the ones that resume a stopped draft
//   onConfirm({ assets, sortBy })
export function AddSeveralSheet({ assets, resumes = [], season, seasons, rows, showName, onSeason, onConfirm, onClose, busy, error }) {
  const [sortBy, setSortBy] = useState('name');
  const kept = assets.slice(0, FILES_PER_DROP);
  const over = assets.length - kept.length;
  const plan = useMemo(() => planBatch(kept.map((a) => ({ name: assetFile(a).name })), { season, rows, sortBy, showName }), [kept, season, rows, sortBy, showName]);
  const gaps = useMemo(() => {
    const out = new Map();
    for (const s of new Set(plan.items.map((p) => p.season))) out.set(s, positionsFor(rows, s).gaps);
    return out;
  }, [plan, rows]);
  const holderOf = (s, n) => {
    const r = (rows || []).find((x) => (Number(x.season) || 1) === s && Number(x.seriesOrder) === n && x.status !== 'rejected');
    return r ? r.displayTitle || r.title || null : null;
  };
  const count = plan.items.filter((p) => p.seriesOrder).length;
  const nextSeason = Math.max(0, ...seasons.map((s) => s.number)) + 1;
  return (
    <Sheet
      title={`Add ${count} episode${count === 1 ? '' : 's'} to ${showName}`}
      onClose={onClose}
      foot={(
        <>
          <Text style={ss.mono}>Up to {FILES_PER_DROP} files at a time · they upload one after another · keep the app open</Text>
          {error ? <Text style={ss.error}>{error}</Text> : null}
          <View style={ss.sheetActions}>
            <SmallButton tone="primary" label={busy ? 'Adding…' : `Add ${count} episode${count === 1 ? '' : 's'}`} busy={busy} disabled={count === 0} onPress={() => onConfirm({ assets: kept, sortBy })} />
            <SmallButton label="Cancel" onPress={onClose} />
          </View>
        </>
      )}
    >
      <View style={{ gap: 8 }}>
        <Text style={ss.sheetLabel}>Season</Text>
        <View style={ss.chips}>
          {seasons.map((s) => (
            <Chip key={s.number} on={season === s.number} label={s.label || `Season ${s.number}`} onPress={() => onSeason(s.number)} />
          ))}
          <Chip on={season === nextSeason} dashed label={`+ Season ${nextSeason}`} onPress={() => onSeason(nextSeason)} />
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={ss.sheetLabel}>Order</Text>
        <View style={ss.chips}>
          {[['name', 'File name'], ['given', 'The order I picked them']].map(([v, l]) => <Chip key={v} on={sortBy === v} label={l} onPress={() => setSortBy(v)} />)}
        </View>
        <Text style={ss.small}>A number in a file&rsquo;s name is kept when it is free; the rest take the next free numbers, in {sortBy === 'given' ? 'the order you picked them' : 'file-name order'}. You can change any number before sending.</Text>
      </View>
      {resumes.length > 0 ? (
        <Text style={[ss.small, { color: colors.ok }]}>{resumes.length === 1 ? `${assetFile(resumes[0].asset).name} resumes its draft (${resumes[0].row.code || 'a draft'}).` : `${resumes.length} files resume their drafts.`}</Text>
      ) : null}
      <View style={{ gap: 6 }}>
        {plan.items.map((p) => {
          const fills = p.seriesOrder && (gaps.get(p.season) || []).some((g) => p.seriesOrder >= g.from && p.seriesOrder <= g.to);
          const taken = p.note && /is taken/.test(p.note) ? Number((/E(\d+) is taken/.exec(p.note) || [])[1]) : null;
          const asset = kept[p.index];
          const size = asset ? bytesShort(assetFile(asset).size) : null;
          return (
            <View key={p.index} style={[st.batchRow, p.note && st.batchRowNote]}>
              <Text style={st.batchFile} numberOfLines={1}>{p.name}{size ? ` · ${size}` : ''}</Text>
              <View style={ss.wrap}>
                <Text style={ss.mono}>→</Text>
                <Text style={[st.batchN, p.note && { color: colors.brass }]}>{p.seriesOrder ? `${p.season !== season ? `S${p.season} ` : ''}E${p.seriesOrder}` : '—'}</Text>
                <Text style={st.batchTitle} numberOfLines={1}>{p.title || (p.seriesOrder ? `Episode ${p.seriesOrder}` : 'Untitled')}</Text>
                {fills ? <Text style={st.batchChip}>Fills the gap</Text> : null}
              </View>
              {p.note ? (
                <View style={ss.row}>
                  <WarningIcon size={13} color={colors.brass} />
                  <Text style={[ss.small, { flex: 1 }]}>{taken && p.seriesOrder ? `E${taken} is taken${holderOf(p.season, taken) ? ` by ${holderOf(p.season, taken)}` : ''} — this one goes to E${p.seriesOrder}` : p.note}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {over > 0 ? <Text style={[ss.small, { color: colors.brass }]}>Up to {FILES_PER_DROP} files at a time — {over} more {over === 1 ? 'wasn’t' : 'weren’t'} added; add {over === 1 ? 'it' : 'them'} after these.</Text> : null}
    </Sheet>
  );
}

// "Paste a link" (a video link) or "Paste an MP3 link" (a podcast).
export function LinkSheet({ podcast, showName, onSubmit, onClose, busy, error }) {
  const [url, setUrl] = useState('');
  const ok = /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <Sheet
      title={podcast ? 'Paste an MP3 link' : 'Paste a link'}
      eyebrow={showName}
      onClose={onClose}
      foot={(
        <>
          {error ? <Text style={ss.error}>{error}</Text> : null}
          <View style={ss.sheetActions}>
            <SmallButton tone="primary" label={busy ? 'Fetching it…' : 'Add it as a draft'} busy={busy} disabled={!ok} onPress={() => onSubmit(url.trim())} />
            <SmallButton label="Cancel" onPress={onClose} />
          </View>
        </>
      )}
    >
      <View style={{ gap: 8 }}>
        <Text style={ss.sheetLabel}>{podcast ? 'The MP3’s address' : 'The video’s address'}</Text>
        <TextInput
          style={ss.input}
          value={url}
          onChangeText={setUrl}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="go"
          onSubmitEditing={() => { if (ok && !busy) onSubmit(url.trim()); }}
        />
        <Text style={ss.small}>{podcast ? 'We fetch the file and it lands as a draft at the next free number. Send it for review from its row.' : 'A direct link to the file (Dropbox, Google Drive, your own site). We fetch it on our side — nothing uploads from your phone — and it lands as a draft at the next free number.'}</Text>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  bar: { gap: 10 },
  closed: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: brassTint(0.35), backgroundColor: brassTint(0.06) },
  queue: { gap: 8 },
  progress: { padding: 12, borderRadius: 8, backgroundColor: oliveTint(0.08), gap: 6 },
  progressError: { backgroundColor: 'transparent', borderWidth: 1, borderColor: brassTint(0.4) },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  progressName: { flex: 1, fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  progressRight: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  progressMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkDim },
  track: { height: 5, borderRadius: 3, backgroundColor: inkTint(0.15), overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.olive },
  queued: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.2) },
  queuedName: { fontFamily: fonts.display, fontSize: 13, color: colors.ink },
  queuedState: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.4, color: colors.inkDim, textTransform: 'uppercase' },
  paused: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: brassTint(0.4) },
  banner: { padding: 10, borderRadius: 8, backgroundColor: oliveTint(0.12) },
  batchRow: { gap: 4, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: inkTint(0.1) },
  batchRowNote: { borderColor: brassTint(0.4) },
  batchFile: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  batchN: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.ink },
  batchTitle: { flexShrink: 1, fontFamily: fonts.display, fontSize: 13.5, color: colors.ink },
  batchChip: { fontFamily: fonts.mono, fontSize: 10, color: colors.ok }
});
