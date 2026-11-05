import { useAuth } from '@clerk/expo';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChatIcon, ClapperboardIcon, ClockIcon, CloseIcon, EyeIcon, ExternalLinkIcon,
  HeadphonesIcon, ImageIcon, LinkIcon, PencilIcon, TrashIcon, UndoIcon, WarningIcon
} from '../../components/WorkIcons';
import { apiGet, apiPost, freshToken } from '../../lib/api';
import { showCall } from '../../lib/showApi';
import { needsYou } from '../../lib/showRules';
import { episodeCode, sortEpisodes } from '../../lib/seriesResume';
import { colors, dangerTint, fonts, inkTint, oliveTint } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import SellTitleSheet, { priceState, STATE_LABEL as SELL_STATE_LABEL } from '../../components/SellTitleSheet';
import { ChevronIcon, KindChip, Sheet, StateChip, episodeEditorRoute, showRoute, ss } from '../../components/show/ShowBits';
import PayeeCard from '../../components/show/PayeeCard';
import { dollars } from '../../lib/purchaseRules';

// The www host: the bare studiotapatv.site 308-redirects there, so a
// copied link should already be the address it lands on.
const SITE_ORIGIN = 'https://www.studiotapatv.site';

// The creator path's words (2026-10-31): In review / Live / Not this time.
const STATUS_LABEL = {
  pending: { text: 'In review', color: colors.olive },
  approved: { text: 'Live', color: colors.ok },
  rejected: { text: 'Not this time', color: colors.danger }
};

const CF_STATE_LABEL = {
  pendingupload: 'Waiting on upload',
  downloading: 'Cloudflare receiving file…',
  queued: 'Queued for processing',
  inprogress: 'Processing…',
  ready: 'Ready to stream',
  error: 'Processing failed'
};

const STANDALONE_TYPE_LABELS = { movie: 'Films', short: 'Shorts', vertical: 'Vertical', podcast: 'Podcasts', bonus: 'Extras' };
const STATUS_FILTERS = ['pending', 'approved', 'rejected'];

// A show row's status pill tones (the website's yw-status classes).
const ROW_TONE = { pending: colors.olive, rejected: colors.danger, muted: colors.inkFaint, approved: colors.ok };
// The flags under a show row: what waits (gold), what's wrong (tangerine),
// what's on its way out (dim).
const FLAG_TONE = { wait: colors.olive, warn: colors.brass, muted: colors.inkDim };

// The same path is a native screen in the app (episode/[id], podcasts/[id])
// and the public page on the site (for "Copy public link").
function publicPathFor(s) {
  return s.contentType === 'podcast' && s.seriesId ? `/podcasts/${s.seriesId}` : `/episode/${s.id}`;
}
function publicUrlFor(s) {
  return `${SITE_ORIGIN}${publicPathFor(s)}`;
}

function displayTitle(s) {
  const own = typeof s.title === 'string' ? s.title.trim() : '';
  if (own) return own;
  return s.seriesOrder ? `Episode ${s.seriesOrder}` : 'Untitled';
}

// "24 min" from the stored runtime ("23:40", "1:02:15"); the text as it is
// when it isn't a clock.
function minutes(runtime) {
  if (runtime === null || runtime === undefined || runtime === '') return null;
  const parts = String(runtime).split(':').map((x) => Number(x));
  if (parts.length < 2 || parts.length > 3 || parts.some((x) => !Number.isFinite(x) || x < 0)) return String(runtime);
  const secs = parts.reduce((acc, x) => acc * 60 + x, 0);
  if (secs < 60) return `${secs} s`;
  return `${Math.round(secs / 60)} min`;
}

function ago(iso) {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// On the site now: approved, not pulled, not on its way out, and in no
// show or a public one (decision 2: an approved episode of a private show
// isn't Live yet). An extra has no show status of its own on the row:
// `show`, the summary of the show it is attached to, answers for it.
function isLive(s, show) {
  if (s.status !== 'approved' || s.held || s.deletionRequested) return false;
  if (s.seriesId) return !s.seriesHeld && (s.seriesStatus === 'approved' || s.seriesStatus == null);
  return !show || show.isPublic !== false;
}

// The words on a show row's status pill.
function showRowStatus(s, live) {
  if (s.status === 'pending') return { text: 'In review', tone: 'pending' };
  if (s.status === 'rejected') return { text: 'Not this time', tone: 'rejected' };
  if (s.held) return { text: 'Pulled', tone: 'rejected' };
  if (s.deletionRequested) return { text: 'Removal requested', tone: 'muted' };
  if (s.seriesHeld) return { text: 'Show pulled', tone: 'rejected' };
  if (!live) return { text: 'Approved · not public yet', tone: 'pending' };
  return { text: 'Live', tone: 'approved' };
}

// The lines under a show row: what waits for approval, why it was pulled
// or sent back, what the file is missing.
function showRowFlags(s) {
  const flags = [];
  if (s.status === 'rejected') flags.push({ key: 'rejected', tone: 'warn', Icon: WarningIcon, text: s.rejectionReason ? `Not this time: ${s.rejectionReason}` : 'Not this time' });
  if (s.held) flags.push({ key: 'held', tone: 'warn', Icon: WarningIcon, text: s.holdReason ? `Pulled: ${s.holdReason}` : 'Pulled while an admin looks at it' });
  if (s.deletionRequested) flags.push({ key: 'removal', tone: 'muted', Icon: TrashIcon, text: s.deletionReason ? `Removal requested: ${s.deletionReason}` : 'Removal requested' });
  if (s.pendingTitle) flags.push({ key: 'title', tone: 'wait', Icon: ClockIcon, text: 'Title change waiting' });
  if (s.pendingDescription) flags.push({ key: 'desc', tone: 'wait', Icon: ClockIcon, text: 'Description change waiting' });
  if (s.pendingSrc) flags.push({ key: 'video', tone: 'wait', Icon: ClockIcon, text: s.pendingVideoState && s.pendingVideoState !== 'ready' ? 'New video waiting · still processing' : 'New video waiting' });
  if (s.artworkPending) flags.push({ key: 'art', tone: 'wait', Icon: ClockIcon, text: 'Art waiting for approval' });
  if (s.cloudflareState === 'error') flags.push({ key: 'cf', tone: 'warn', Icon: WarningIcon, text: 'The file failed to process — replace it' });
  else if (s.cloudflareState === 'pendingupload') flags.push({ key: 'cf', tone: 'warn', Icon: WarningIcon, text: 'The upload never finished' });
  if (s.status === 'approved' && s.contentType !== 'podcast' && s.contentType !== 'bonus' && !s.captionsUrl) flags.push({ key: 'captions', tone: 'warn', Icon: ChatIcon, text: 'No captions' });
  else if (s.captionsStale) flags.push({ key: 'stale', tone: 'warn', Icon: ChatIcon, text: 'Captions may be out of sync' });
  return flags;
}

const firstParam = (v) => (Array.isArray(v) ? v[0] : v);

// The action sheet slides away before the next modal (Edit, Delete, Sell)
// comes up: iOS won't present a modal while another is still closing.
const SHEET_HANDOFF_MS = 400;

// Mirrors pages/creator/my-work.js — same stats, same grouped, filterable
// list. Grouped by project: a show's titles sit under the show (the series
// revamp, slice 5; the website's YourWork board) — a header that opens
// its show screen ("Open show page →"; the old show menu's Edit show
// details / Sell the whole series / Add bonus content live on the show
// screen now), "Season N" sub-headings when it has more than one, rows in
// play order with their "S1 E3" code, the changes waiting for approval and
// why a title was pulled, a pencil that opens the episode editor screen,
// and its extras under it. Films, shorts and Snippets keep their rows: an
// edit request and a deletion request are built in here; artwork, video
// and captions open the website. ?status=pending|approved|rejected and
// ?attention=1 (the hub's piles) set the filters.
export default function MyWork() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { getToken: clerkGetToken } = useAuth();
  // One getter for the screen's life (Clerk's may change identity).
  const tokenRef = useRef(clerkGetToken);
  tokenRef.current = clerkGetToken;
  const getToken = useCallback((...a) => tokenRef.current(...a), []);
  const [feedState, setFeedState] = useState({ loading: true, error: null, forbidden: false, submissions: null });
  // The viewer's shows (GET /api/show?mine=1) for the group headers: art,
  // kind, where the show stands, its count line and season names. The
  // headers fall back to what the rows say when it can't load.
  const [shows, setShows] = useState([]);
  const paramStatus = firstParam(params.status);
  const paramAttention = firstParam(params.attention);
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTERS.includes(paramStatus) ? paramStatus : 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(paramAttention === '1');
  // Opened again from the hub with other filters (the screen stays mounted).
  useEffect(() => {
    if (STATUS_FILTERS.includes(paramStatus)) setStatusFilter(paramStatus);
    if (paramAttention === '1') setNeedsAttentionOnly(true);
  }, [paramStatus, paramAttention]);
  const [actionSheet, setActionSheet] = useState(null); // { type: 'episode' | 'show', item, showId }
  const [editModal, setEditModal] = useState(null); // { type, currentValues }
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null); // episode item
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [actionError, setActionError] = useState(null);
  // Buy to own: this creator's prices keyed "episode:<id>" / "series:<id>"
  // (/api/creator/pricing) and the title the Sell sheet is open for.
  const [pricing, setPricing] = useState({ prices: {}, settings: {} });
  const [sellModal, setSellModal] = useState(null); // { type, id, title, sub }
  // "Who gets paid" for a title of its own (slice 3b): GET /api/payees'
  // block, drawn by PayeeCard in a sheet (a show's episode opens its
  // editor instead, where the same card sits under More info).
  const [payeeSheet, setPayeeSheet] = useState(null); // { id, title, block, error, words }

  async function loadPricing() {
    try {
      setPricing(await apiGet('/api/creator/pricing', await freshToken(getToken)));
    } catch (err) {
      // The rows just show no price.
    }
  }

  // Every request asks Clerk for a fresh token: a token kept from when the
  // screen opened has expired a minute later (edits/deletion requests then
  // failed as "signed out").
  async function loadSubmissions() {
    try {
      const token = await freshToken(getToken);
      const data = await apiGet('/api/creator/my-submissions', token);
      setFeedState({ loading: false, error: null, forbidden: false, submissions: data.submissions });
      loadPricing();
    } catch (err) {
      const forbidden = /creator access required/i.test(err.message || '');
      // A read on coming back that fails keeps the list already shown.
      setFeedState((st) => (st.submissions && !forbidden ? st : { loading: false, error: err.message, forbidden, submissions: null }));
    }
  }

  async function loadShows() {
    const r = await showCall('GET', '/api/show?mine=1', undefined, getToken);
    if (r.ok && Array.isArray(r.data.shows)) setShows(r.data.shows);
  }

  // Read on every visit: the pencil and "Edit episode" open the episode
  // editor and "Open on the show page" the show screen, and what changed
  // there shows here on the way back (the list stays up meanwhile).
  useFocusEffect(useCallback(() => {
    loadSubmissions();
    loadShows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  async function copyPublicLink(s) {
    try {
      await Clipboard.setStringAsync(publicUrlFor(s));
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((current) => (current === s.id ? null : current)), 2000);
    } catch {
      // Not worth surfacing — same reasoning as the website.
    }
  }

  async function submitEdit(nameValue, description) {
    setEditSaving(true);
    setEditError(null);
    try {
      await apiPost('/api/creator/request-episode-edit', { episodeId: editModal.currentValues.id, title: nameValue, description }, await freshToken(getToken));
      setEditModal(null);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function requestDeletion() {
    if (!deleteReason.trim()) {
      setDeleteError('A reason is required.');
      return;
    }
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await apiPost('/api/creator/request-episode-deletion', { episodeId: deleteModal.id, action: 'request', reason: deleteReason.trim() }, await freshToken(getToken));
      setDeleteModal(null);
      setDeleteReason('');
      loadSubmissions();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteSaving(false);
    }
  }

  async function openPayee(s) {
    setPayeeSheet({ id: s.id, title: s.title || 'this title', block: null, error: null, words: null });
    const r = await showCall('GET', `/api/payees?type=episode&id=${encodeURIComponent(s.id)}`, undefined, getToken);
    setPayeeSheet((cur) => (cur && cur.id === s.id ? { ...cur, block: r.ok ? r.data.payee || null : null, error: r.ok ? (r.data.payee ? null : 'Couldn’t read who gets paid.') : r.error } : cur));
  }

  async function cancelDeletion(episodeId) {
    setActionError(null);
    try {
      await apiPost('/api/creator/request-episode-deletion', { episodeId, action: 'cancel' }, await freshToken(getToken));
      loadSubmissions();
    } catch (err) {
      setActionError(err.message);
    }
  }

  if (feedState.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }

  if (feedState.forbidden) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}>
          <Text style={styles.title}>Creator access required</Text>
          <Text style={styles.note}>This section is only for accounts with creator or admin access.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (feedState.error || !feedState.submissions) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load your work: {feedState.error || 'unknown error'}</Text></View>
      </SafeAreaView>
    );
  }

  const submissions = feedState.submissions;
  const byId = new Map(submissions.map((s) => [s.id, s]));
  const showById = new Map(shows.map((sh) => [sh.id, sh]));

  // The show a title sits under: its own, or for an extra the show it is
  // attached to (directly, or through the episode it follows when that
  // episode is one of these titles).
  function showIdOf(s) {
    if (s.seriesId) return s.seriesId;
    if (s.contentType !== 'bonus') return null;
    if (s.bonusParentType === 'series' && s.bonusParentId) return s.bonusParentId;
    if (s.bonusParentType === 'episode' && s.bonusParentId) {
      const parent = byId.get(s.bonusParentId);
      return parent && parent.seriesId ? parent.seriesId : null;
    }
    return null;
  }
  const live = (s) => isLive(s, showIdOf(s) ? showById.get(showIdOf(s)) : null);

  const total = submissions.length;
  const liveCount = submissions.filter(live).length;
  const approvedCount = submissions.filter((s) => s.status === 'approved').length;
  const pendingCount = submissions.filter((s) => s.status === 'pending').length;
  const reviewedCount = approvedCount + submissions.filter((s) => s.status === 'rejected').length;
  const approvalRate = reviewedCount > 0 ? Math.round((approvedCount / reviewedCount) * 100) : null;
  const turnaroundHoursList = submissions
    .filter((s) => s.reviewedAt && s.createdAt)
    .map((s) => (new Date(s.reviewedAt).getTime() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60));
  const avgTurnaroundHours = turnaroundHoursList.length > 0
    ? Math.round(turnaroundHoursList.reduce((a, b) => a + b, 0) / turnaroundHoursList.length)
    : null;
  const missingArtworkCount = submissions.filter((s) => s.status !== 'rejected' && s.missingArtwork).length;

  const query = searchQuery.trim().toLowerCase();
  const filteredSubmissions = submissions.filter((s) => {
    if (statusFilter === 'approved' && !live(s)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'approved' && s.status !== statusFilter) return false;
    if (query) {
      const sid = showIdOf(s);
      const hay = `${displayTitle(s)} ${s.seriesName || ''} ${(sid && showById.get(sid) && showById.get(sid).name) || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (needsAttentionOnly && !needsYou(s)) return false;
    return true;
  });

  // Grouped by project always — a show (series or podcast) gets its own
  // section with its episodes and its extras, and anything without one
  // (films, shorts, Snippets) is grouped by content type.
  const groupsByKey = {};
  for (const s of filteredSubmissions) {
    const sid = showIdOf(s);
    const key = sid ? `series:${sid}` : `type:${s.contentType}`;
    if (!groupsByKey[key]) {
      const summary = sid ? showById.get(sid) : null;
      groupsByKey[key] = {
        key,
        isShow: Boolean(sid),
        showId: sid,
        summary,
        label: sid ? ((summary && summary.name) || s.seriesName || 'A show') : (STANDALONE_TYPE_LABELS[s.contentType] || 'Other'),
        kind: sid ? ((summary && summary.kind) || s.seriesKind || (s.contentType === 'podcast' ? 'podcast' : 'series')) : null,
        items: []
      };
    }
    groupsByKey[key].items.push(s);
  }
  // Shows first (alphabetical), then the standalone groups in the fixed
  // Films / Shorts / Vertical / Podcasts / Extras order.
  const typeOrder = Object.keys(STANDALONE_TYPE_LABELS);
  const projectGroups = Object.values(groupsByKey).sort((a, b) => {
    if (a.isShow !== b.isShow) return a.isShow ? -1 : 1;
    if (!a.isShow && !b.isShow) return typeOrder.indexOf(a.items[0].contentType) - typeOrder.indexOf(b.items[0].contentType);
    return a.label.localeCompare(b.label);
  });

  function showRowMeta(s) {
    const parts = [];
    if (s.cloudflareState && !['ready', 'error', 'pendingupload'].includes(s.cloudflareState)) parts.push(CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState);
    else if (s.runtime) parts.push(minutes(s.runtime));
    if (s.contentType === 'bonus') {
      if (s.bonusParentType === 'episode') {
        const parent = byId.get(s.bonusParentId);
        parts.push(parent && episodeCode(parent) ? `after ${episodeCode(parent)}` : 'after an episode');
      } else {
        parts.push('with the show');
      }
    }
    if (s.status === 'pending') parts.push(`sent ${ago(s.createdAt)}`);
    if (live(s)) parts.push(`${s.viewCount || 0} view${s.viewCount === 1 ? '' : 's'}`);
    return parts.filter(Boolean).join(' · ');
  }

  function renderShowRow(s, group) {
    const code = s.contentType === 'bonus' ? null : episodeCode(s);
    const status = showRowStatus(s, live(s));
    const flags = showRowFlags(s);
    const meta = showRowMeta(s);
    const extra = s.contentType === 'bonus';
    return (
      <View key={s.id} style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.showRowMain, pressed && styles.pressed]}
          onPress={() => setActionSheet({ type: 'show', item: s, showId: group.showId, onSite: live(s) })}
          accessibilityRole="button"
          accessibilityLabel={`${code ? `${code}, ` : ''}${displayTitle(s)}, ${status.text}. Options`}
        >
          {s.thumbnail || s.poster ? <SmartImage uri={s.thumbnail || s.poster} style={styles.rowThumb} /> : <View style={styles.rowThumb} />}
          <View style={styles.rowMain}>
            <View style={styles.rowTitleLine}>
              {code ? <Text style={styles.code}>{code}</Text> : null}
              <Text style={styles.rowTitle} numberOfLines={1}>{displayTitle(s)}</Text>
            </View>
            <View style={styles.showMetaLine}>
              <Text style={[styles.statusPill, { color: ROW_TONE[status.tone] || colors.inkDim }]}>{status.text}</Text>
              {meta ? <Text style={styles.rowMeta} numberOfLines={1}>{`· ${meta}`}</Text> : null}
            </View>
            {flags.map((f) => (
              <View key={f.key} style={styles.flagLine}>
                <f.Icon size={11} color={FLAG_TONE[f.tone] || colors.inkDim} />
                <Text style={[styles.flagText, { color: FLAG_TONE[f.tone] || colors.inkDim }]} numberOfLines={2}>{f.text}</Text>
              </View>
            ))}
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
          onPress={() => router.push(episodeEditorRoute(group.showId, s.id))}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${extra ? 'Edit extra' : 'Edit episode'}: ${displayTitle(s)}`}
        >
          <PencilIcon size={15} color={colors.ink} />
        </Pressable>
      </View>
    );
  }

  function renderShowGroup(group) {
    const sh = group.summary;
    const episodes = sortEpisodes(group.items.filter((s) => s.contentType !== 'bonus'));
    const extras = group.items.filter((s) => s.contentType === 'bonus').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const seasons = [...new Set(episodes.map((s) => Number(s.season) || 1))];
    const labelFor = (n) => {
      const entry = sh && Array.isArray(sh.seasons) ? sh.seasons.find((x) => x.number === n) : null;
      return (entry && entry.label) || `Season ${n}`;
    };
    const fallbackStatus = group.items.find((s) => s.seriesStatus) || null;
    const state = sh ? sh.state : fallbackStatus && fallbackStatus.seriesHeld ? 'pulled' : fallbackStatus && fallbackStatus.seriesStatus === 'pending' ? 'review' : fallbackStatus && fallbackStatus.seriesStatus === 'rejected' ? 'declined' : 'live';
    const statusLabel = sh ? sh.statusLabel : { pulled: 'Pulled', review: 'Not public yet', declined: 'Not this time', live: 'Live' }[state];
    const poster = (sh && (sh.poster || sh.thumbnail)) || null;
    const countLine = sh ? sh.countLine : `${episodes.length} episode${episodes.length === 1 ? '' : 's'}${extras.length ? ` · ${extras.length} extra${extras.length === 1 ? '' : 's'}` : ''}`;
    return (
      <View key={group.key} style={styles.projectGroup}>
        <Pressable
          style={({ pressed }) => [styles.showHead, pressed && styles.pressed]}
          onPress={() => router.push(showRoute(group.showId))}
          accessibilityRole="link"
          accessibilityLabel={`${group.label}. ${statusLabel || ''}. ${countLine}. Open show page`}
        >
          {poster ? <SmartImage uri={poster} style={styles.showPoster} /> : <View style={[styles.showPoster, styles.showPosterEmpty]}><Text style={styles.showPosterName} numberOfLines={3}>{group.label}</Text></View>}
          <View style={styles.projectTitleWrap}>
            <Text style={styles.projectTitle} numberOfLines={2}>{group.label}</Text>
            <View style={styles.showChips}>
              <KindChip kind={group.kind} />
              {state !== 'live' && statusLabel ? <StateChip state={state} label={statusLabel} /> : null}
            </View>
            <Text style={styles.projectSub}>{countLine}</Text>
            <View style={styles.openRow}>
              <Text style={styles.openText}>Open show page</Text>
              <ChevronIcon size={12} color={colors.olive} />
            </View>
          </View>
        </Pressable>
        {episodes.length > 0 && seasons.length > 1
          ? seasons.map((n) => (
            <View key={n}>
              <Text style={styles.seasonHead} accessibilityRole="header">{labelFor(n)}</Text>
              {episodes.filter((s) => (Number(s.season) || 1) === n).map((s) => renderShowRow(s, group))}
            </View>
          ))
          : episodes.map((s) => renderShowRow(s, group))}
        {extras.length > 0 ? (
          <View>
            <Text style={styles.seasonHead} accessibilityRole="header">Extras</Text>
            {extras.map((s) => renderShowRow(s, group))}
          </View>
        ) : null}
      </View>
    );
  }

  function renderStandaloneGroup(group) {
    const pendingInGroup = group.items.filter((s) => s.status === 'pending').length;
    const missingArtworkInGroup = group.items.filter((s) => s.missingArtwork && s.status !== 'rejected').length;
    const groupArt = group.items.find((s) => s.thumbnail || s.poster);
    return (
      <View key={group.key} style={styles.projectGroup}>
        <View style={styles.projectHeader}>
          {groupArt ? <SmartImage uri={groupArt.thumbnail || groupArt.poster} style={styles.projectArt} /> : <View style={styles.projectArt} />}
          <View style={styles.projectTitleWrap}>
            <Text style={styles.projectTitle} numberOfLines={1}>{group.label}</Text>
            <Text style={styles.projectSub}>{group.items.length} title{group.items.length === 1 ? '' : 's'}</Text>
          </View>
          <View style={styles.projectBadges}>
            {pendingInGroup > 0 ? <Text style={[styles.badge, styles.badgePending]}>{pendingInGroup} in review</Text> : null}
            {missingArtworkInGroup > 0 ? <Text style={[styles.badge, styles.badgeMissing]}>{missingArtworkInGroup} needs artwork</Text> : null}
          </View>
        </View>
        {group.items.map((s) => {
          const flags = [];
          if (s.missingArtwork && s.status !== 'rejected') flags.push({ key: 'artwork', Icon: ImageIcon });
          if (s.contentType !== 'podcast' && !s.captionsUrl && s.status === 'approved') flags.push({ key: 'captions', Icon: ChatIcon });
          if (s.artworkPending) flags.push({ key: 'pending', Icon: ClockIcon });
          if (s.pendingTitle) flags.push({ key: 'title', Icon: ClockIcon });
          if (s.pendingSrc) flags.push({ key: 'video', Icon: ClockIcon });
          if (s.deletionRequested) flags.push({ key: 'deletion', Icon: TrashIcon });
          return (
            <Pressable key={s.id} style={styles.row} onPress={() => setActionSheet({ type: 'episode', item: s })}>
              {s.thumbnail ? <SmartImage uri={s.thumbnail} style={styles.rowThumb} /> : <View style={styles.rowThumb} />}
              <View style={styles.rowMain}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                  {s.hasVideo ? <ClapperboardIcon size={11} color={colors.inkDim} /> : null}
                  {s.hasAudio ? <HeadphonesIcon size={11} color={colors.inkDim} /> : null}
                </View>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {s.cloudflareState && s.cloudflareState !== 'ready' ? (CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState) : (s.runtime || s.description || '')}
                </Text>
                {s.status === 'rejected' && s.rejectionReason ? <Text style={styles.rowRejection}>Admin's note: {s.rejectionReason}</Text> : null}
                {s.held && s.holdReason ? <Text style={styles.rowRejection}>Pulled: {s.holdReason}</Text> : null}
                {s.deletionRequested ? <Text style={styles.rowRejection}>Deletion reason: {s.deletionReason}</Text> : null}
                {s.status === 'approved' && pricing.prices[`episode:${s.id}`] ? (() => {
                  const row = pricing.prices[`episode:${s.id}`];
                  const st = priceState(row);
                  return <Text style={[styles.rowPrice, { color: st === 'on' ? colors.ok : st === 'pending' ? colors.olive : colors.inkFaint }]}>{st === 'on' ? `On sale · ${dollars(row.price_cents)}` : st === 'pending' ? `Price in review · ${dollars(row.pending_cents)}` : SELL_STATE_LABEL[st]}</Text>;
                })() : null}
              </View>
              <View style={styles.rowRight}>
                {s.held && s.status === 'approved'
                  ? <Text style={[styles.statusPill, { color: colors.danger }]}>Pulled for review</Text>
                  : <Text style={[styles.statusPill, { color: (STATUS_LABEL[s.status] || {}).color || colors.inkDim }]}>{(STATUS_LABEL[s.status] || {}).text || s.status}</Text>}
                {s.status === 'approved' ? (
                  <View style={styles.viewsRow}><EyeIcon size={11} color={colors.inkFaint} /><Text style={styles.viewsText}> {s.viewCount}</Text></View>
                ) : null}
                {flags.length > 0 ? (
                  <View style={styles.flagsRow}>
                    {flags.map((f) => <f.Icon key={f.key} size={12} color={colors.inkFaint} />)}
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Text style={styles.eyebrow}>Creator Studio</Text>
          <Text style={styles.title}>Your work</Text>
          <Text style={styles.sub}>Everything you've sent us, in review or live. A show's episodes sit under the show.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.push('/creator/submit')}>
            <Text style={styles.primaryBtnText}>+ Submit a title</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.push('/creator/numbers')}>
          <Text style={styles.analyticsLink}>Want to see how they're doing? View your numbers →</Text>
        </Pressable>

        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        {submissions.length === 0 ? (
          <Text style={styles.note}>
            Nothing submitted yet — <Text style={styles.link} onPress={() => router.push('/creator/submit')}>submit your first one</Text>.
          </Text>
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={styles.stat}><Text style={styles.statValue}>{total}</Text><Text style={styles.statLabel}>Total</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{pendingCount}</Text><Text style={styles.statLabel}>In review</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{liveCount}</Text><Text style={styles.statLabel}>Live</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{approvalRate === null ? '—' : `${approvalRate}%`}</Text><Text style={styles.statLabel}>Approval rate</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{avgTurnaroundHours === null ? '—' : `${avgTurnaroundHours}h`}</Text><Text style={styles.statLabel}>Avg. review</Text></View>
            </View>

            {missingArtworkCount > 0 ? (
              <View style={styles.nudge}>
                <ImageIcon size={13} color={colors.olive} />
                <Text style={styles.nudgeText}>
                  {' '}{missingArtworkCount} title{missingArtworkCount === 1 ? '' : 's'} still missing a poster or a still — a show's episodes take theirs on its show page, a film's from Your work on the website.
                </Text>
              </View>
            ) : null}

            <TextInput
              style={styles.search}
              placeholder="Search your titles…"
              placeholderTextColor={colors.inkFaint}
              value={searchQuery}
              onChangeText={setSearchQuery}
              accessibilityLabel="Search your titles"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow} contentContainerStyle={styles.pillRowContent}>
              {['all', ...STATUS_FILTERS].map((f) => (
                <Pressable key={f} style={[styles.pill, statusFilter === f && styles.pillOn]} onPress={() => setStatusFilter(f)} accessibilityRole="button" accessibilityState={{ selected: statusFilter === f }}>
                  <Text style={[styles.pillText, statusFilter === f && styles.pillTextOn]}>{f === 'all' ? 'All' : STATUS_LABEL[f].text}</Text>
                </Pressable>
              ))}
              <Pressable style={[styles.pill, needsAttentionOnly && styles.pillOn]} onPress={() => setNeedsAttentionOnly((v) => !v)} accessibilityRole="button" accessibilityState={{ selected: needsAttentionOnly }}>
                <WarningIcon size={12} color={needsAttentionOnly ? colors.onBrass : colors.ink} />
                <Text style={[styles.pillText, needsAttentionOnly && styles.pillTextOn]}> Needs attention</Text>
              </Pressable>
            </ScrollView>

            {filteredSubmissions.length === 0 ? <Text style={styles.note}>Nothing matches this filter.</Text> : null}

            {projectGroups.map((group) => (group.isShow ? renderShowGroup(group) : renderStandaloneGroup(group)))}
          </>
        )}
      </ScrollView>

      {/* Action sheet — a film's / short's options, or a show episode's */}
      <Modal visible={!!actionSheet} transparent animationType="slide" onRequestClose={() => setActionSheet(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionSheet(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {actionSheet ? <ActionSheetContent
              actionSheet={actionSheet}
              onClose={() => setActionSheet(null)}
              onEdit={(target) => { setActionSheet(null); setEditError(null); setTimeout(() => setEditModal(target), SHEET_HANDOFF_MS); }}
              onDelete={(item) => { setActionSheet(null); setDeleteReason(''); setDeleteError(null); setTimeout(() => setDeleteModal(item), SHEET_HANDOFF_MS); }}
              onCancelDeletion={(id) => { setActionSheet(null); cancelDeletion(id); }}
              onCopyLink={copyPublicLink}
              onOpenPublic={(item) => { setActionSheet(null); router.push(publicPathFor(item)); }}
              onOpenEditor={(showId, item) => { setActionSheet(null); router.push(episodeEditorRoute(showId, item.id)); }}
              onOpenShow={(showId, item) => { setActionSheet(null); router.push(showRoute(showId, { ep: item.id })); }}
              copiedId={copiedId}
              pricing={pricing}
              onSell={(target) => { setActionSheet(null); setTimeout(() => setSellModal(target), SHEET_HANDOFF_MS); }}
              onPayee={(item) => { setActionSheet(null); setTimeout(() => openPayee(item), SHEET_HANDOFF_MS); }}
            /> : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Buy to own: Sell this title / Run a sale (components/SellTitleSheet.js) */}
      <Modal visible={!!sellModal} transparent animationType="fade" onRequestClose={() => setSellModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSellModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {sellModal ? <SellTitleSheet
              target={sellModal}
              price={pricing.prices[`${sellModal.type}:${sellModal.id}`] || null}
              blocked={pricing.blocked ? pricing.blocked[`${sellModal.type}:${sellModal.id}`] || null : null}
              settings={pricing.settings}
              getToken={() => freshToken(getToken)}
              onClose={() => setSellModal(null)}
              onSaved={loadPricing}
            /> : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Who gets paid for a title of its own (slice 3b) */}
      {payeeSheet ? (
        <Sheet title={`Who gets paid for “${payeeSheet.title}”`} onClose={() => setPayeeSheet(null)}>
          {payeeSheet.words ? <Text style={ss.okText} accessibilityLiveRegion="polite">{payeeSheet.words}</Text> : null}
          {payeeSheet.error ? <Text style={ss.error}>{payeeSheet.error}</Text> : !payeeSheet.block ? <ActivityIndicator color={colors.olive} /> : (
            <PayeeCard
              payee={payeeSheet.block}
              mode="modal"
              onChanged={(next, words) => {
                // (null, null): the block was out of date — read it again.
                if (!next && !words) openPayee({ id: payeeSheet.id, title: payeeSheet.title });
                else setPayeeSheet((cur) => (cur ? { ...cur, block: next || cur.block, words } : cur));
                loadSubmissions();
              }}
            />
          )}
        </Sheet>
      ) : null}

      {/* Edit a film's title/description (sent for approval) */}
      <Modal visible={!!editModal} transparent animationType="fade" onRequestClose={() => setEditModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {editModal ? <EditModalContent
              editModal={editModal}
              saving={editSaving}
              error={editError}
              onCancel={() => setEditModal(null)}
              onSubmit={submitEdit}
            /> : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Request deletion */}
      <Modal visible={!!deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDeleteModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderText}>Request deletion</Text>
              <Pressable onPress={() => setDeleteModal(null)}><CloseIcon size={16} /></Pressable>
            </View>
            {deleteModal ? (
              <Text style={styles.modalNote}>"{deleteModal.title}" will be hidden from the site right away. An admin still has to confirm the actual removal — you can cancel this request any time before then.</Text>
            ) : null}
            <Text style={styles.label}>Reason — required</Text>
            <TextInput
              style={styles.textarea}
              value={deleteReason}
              onChangeText={setDeleteReason}
              multiline
              numberOfLines={3}
              placeholder=""
              placeholderTextColor={colors.inkFaint}
            />
            {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={[styles.primaryBtn, deleteSaving && styles.btnDisabled]} disabled={deleteSaving} onPress={requestDeletion}>
                <Text style={styles.primaryBtnText}>{deleteSaving ? 'Submitting…' : 'Request deletion'}</Text>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => setDeleteModal(null)} disabled={deleteSaving}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ActionSheetContent({ actionSheet, onClose, onEdit, onDelete, onCancelDeletion, onCopyLink, onOpenPublic, onOpenEditor, onOpenShow, copiedId, pricing, onSell, onPayee }) {
  const { type, item: s } = actionSheet;

  // A show's episode or extra: the editor and the show screen do the rest
  // (art, the file, captions, its place, removal).
  if (type === 'show') {
    const extra = s.contentType === 'bonus';
    const price = pricing.prices[`episode:${s.id}`];
    return (
      <>
        <Text style={styles.sheetTitle} numberOfLines={1}>{[episodeCode(s), displayTitle(s)].filter(Boolean).join(' · ')}</Text>
        <Pressable style={styles.sheetRow} onPress={() => onOpenEditor(actionSheet.showId, s)}>
          <PencilIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>{extra ? 'Edit extra' : 'Edit episode'}</Text>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={() => onOpenShow(actionSheet.showId, s)}>
          <ChevronIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Open on the show page</Text>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={() => onOpenEditor(actionSheet.showId, s)} accessibilityHint="Opens its editor; Who gets paid is under More info">
          <Text style={[styles.sheetRowText, styles.dollar]}>$</Text><Text style={styles.sheetRowText}>Who gets paid</Text>
        </Pressable>
        {actionSheet.onSite ? (
          <>
            <Pressable style={styles.sheetRow} onPress={() => onOpenPublic(s)}>
              <ExternalLinkIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>View page</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => onCopyLink(s)}>
              <LinkIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>{copiedId === s.id ? 'Link copied!' : 'Copy link'}</Text>
            </Pressable>
            {!extra && s.canPrice !== false ? (
              <Pressable style={styles.sheetRow} onPress={() => onSell({ type: 'episode', id: s.id, title: displayTitle(s), sub: [episodeCode(s), minutes(s.runtime), s.seriesName].filter(Boolean).join(' · ') })}>
                <Text style={[styles.sheetRowText, styles.dollar]}>$</Text>
                <Text style={styles.sheetRowText}>{price ? 'Price and sales' : 'Sell'}{price && price.price_cents ? ` · ${dollars(price.price_cents)}` : ''}</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
        <Pressable style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Close</Text></Pressable>
      </>
    );
  }

  return (
    <>
      <Text style={styles.sheetTitle} numberOfLines={1}>{s.title}</Text>
      {s.status === 'approved' ? (
        <>
          <Pressable style={styles.sheetRow} onPress={() => onOpenPublic(s)}>
            <ExternalLinkIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>View public page</Text>
          </Pressable>
          <Pressable style={styles.sheetRow} onPress={() => onCopyLink(s)}>
            <LinkIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>{copiedId === s.id ? 'Link copied!' : 'Copy public link'}</Text>
          </Pressable>
          {!s.deletionRequested && !s.held && s.contentType !== 'bonus' && s.canPrice !== false ? (
            <Pressable style={styles.sheetRow} onPress={() => onSell({ type: 'episode', id: s.id, title: s.title, sub: [s.contentType, s.runtime, s.seriesName].filter(Boolean).join(' · ') })}>
              <Text style={[styles.sheetRowText, styles.dollar]}>$</Text><Text style={styles.sheetRowText}>{pricing.prices[`episode:${s.id}`] ? 'Price and sales' : 'Sell this title'}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {!s.deletionRequested ? (
        <Pressable style={styles.sheetRow} onPress={() => onEdit({ type: 'episode', currentValues: { id: s.id, title: s.title, description: s.description || '' } })}>
          <PencilIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Edit title &amp; description</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.sheetRow} onPress={() => onPayee(s)}>
        <Text style={[styles.sheetRowText, styles.dollar]}>$</Text><Text style={styles.sheetRowText}>Who gets paid</Text>
      </Pressable>
      <Pressable style={styles.sheetRow} onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator/my-work`)}>
        <ImageIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Manage artwork, video &amp; captions (on website)</Text>
      </Pressable>
      {s.deletionRequested ? (
        <Pressable style={styles.sheetRow} onPress={() => onCancelDeletion(s.id)}>
          <UndoIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Cancel deletion request</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.sheetRow} onPress={() => onDelete(s)}>
          <TrashIcon size={16} color={colors.danger} /><Text style={[styles.sheetRowText, { color: colors.danger }]}>Request deletion</Text>
        </Pressable>
      )}
      <Pressable style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Close</Text></Pressable>
    </>
  );
}

function EditModalContent({ editModal, saving, error, onCancel, onSubmit }) {
  const isEpisode = editModal.type === 'episode';
  const [nameValue, setNameValue] = useState(isEpisode ? editModal.currentValues.title : editModal.currentValues.name);
  const [description, setDescription] = useState(editModal.currentValues.description || '');

  return (
    <>
      <View style={styles.modalHeader}>
        <Text style={styles.modalHeaderText}>Request an edit — {isEpisode ? 'episode' : 'show'}</Text>
        <Pressable onPress={onCancel}><CloseIcon size={16} /></Pressable>
      </View>
      <Text style={styles.modalNote}>
        This goes to Studio Tapa for approval before it changes anything visitors see — the current {isEpisode ? 'title/description' : 'name/description'} stay live until then.
      </Text>
      <Text style={styles.label}>{isEpisode ? 'Title' : 'Show name'}</Text>
      <TextInput style={styles.input} value={nameValue} onChangeText={setNameValue} />
      <Text style={styles.label}>Description</Text>
      <TextInput style={styles.textarea} value={description} onChangeText={setDescription} multiline numberOfLines={4} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.modalActions}>
        <Pressable style={[styles.primaryBtn, saving && styles.btnDisabled]} disabled={saving} onPress={() => onSubmit(nameValue, description)}>
          <Text style={styles.primaryBtnText}>{saving ? 'Sending…' : 'Send for approval'}</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={onCancel} disabled={saving}>
          <Text style={styles.secondaryBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // A show's group (the series revamp, slice 5)
  pressed: { opacity: 0.75 },
  showHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: inkTint(0.12), backgroundColor: colors.surface1 },
  showPoster: { width: 56, height: 84, borderRadius: 6, backgroundColor: colors.surface2 },
  showPosterEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25), backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 4 },
  showPosterName: { fontFamily: fonts.displaySemi, fontSize: 10, lineHeight: 13, color: colors.inkDim, textAlign: 'center' },
  showChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  openText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, color: colors.olive, textTransform: 'uppercase' },
  seasonHead: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.inkDim, textTransform: 'uppercase', marginTop: 12, marginBottom: 2 },
  showRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  code: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.olive },
  showMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  flagLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  flagText: { flex: 1, fontSize: 10.5, lineHeight: 14 },
  editBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center' },
  dollar: { color: colors.olive, fontWeight: '700' },

  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 6, marginBottom: 6 },
  note: { color: colors.inkDim, fontSize: 14, lineHeight: 20, marginTop: 8 },
  link: { color: colors.olive },

  head: { marginBottom: 14 },
  eyebrow: { color: colors.olive, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sub: { color: colors.inkDim, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', alignSelf: 'flex-start' },
  primaryBtnText: { color: colors.onBrass, fontSize: 14, fontWeight: '700' },
  secondaryBtn: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', borderWidth: 1, borderColor: colors.hairline },
  secondaryBtnText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  analyticsLink: { color: colors.olive, fontSize: 13, marginBottom: 14 },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  stat: { minWidth: 90, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', flexGrow: 1 },
  statValue: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.inkDim, fontSize: 10, marginTop: 2, textAlign: 'center' },

  nudge: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface2, borderRadius: 10, padding: 10, marginBottom: 14 },
  nudgeText: { color: colors.inkDim, fontSize: 12, flex: 1, lineHeight: 17 },

  search: { backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, color: colors.ink, fontSize: 14, marginBottom: 10 },
  pillRow: { marginBottom: 16 },
  pillRowContent: { gap: 8, paddingRight: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  pillOn: { backgroundColor: colors.brass },
  pillText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  pillTextOn: { color: colors.onBrass },

  projectGroup: { marginBottom: 20 },
  projectHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  projectArt: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surface2 },
  projectTitleWrap: { flex: 1 },
  projectTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  projectSub: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },
  projectBadges: { gap: 4, alignItems: 'flex-end' },
  badge: { fontSize: 9, fontWeight: '700', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 999, overflow: 'hidden' },
  badgePending: { color: colors.olive, backgroundColor: oliveTint(0.15) },
  badgeMissing: { color: colors.danger, backgroundColor: dangerTint(0.15) },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  rowThumb: { width: 54, height: 40, borderRadius: 6, backgroundColor: colors.surface2 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowTitle: { color: colors.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  rowMeta: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },
  rowRejection: { color: colors.danger, fontSize: 10, marginTop: 2 },
  rowPrice: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 3 },
  statusPill: { fontSize: 10, fontWeight: '700' },
  viewsRow: { flexDirection: 'row', alignItems: 'center' },
  viewsText: { color: colors.inkFaint, fontSize: 10 },
  flagsRow: { flexDirection: 'row', gap: 4 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 30 },
  sheetTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  sheetRowText: { color: colors.ink, fontSize: 14 },
  sheetCancel: { marginTop: 8, paddingVertical: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.hairline },
  sheetCancelText: { color: colors.inkDim, fontSize: 14, fontWeight: '600' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.surface1, borderRadius: 14, padding: 18, width: '100%', maxWidth: 420 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalHeaderText: { color: colors.ink, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  modalNote: { color: colors.inkDim, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  label: { color: colors.inkDim, fontSize: 12, fontWeight: '600', marginBottom: 5, marginTop: 8 },
  input: { backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 14 },
  textarea: { backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 }
});
