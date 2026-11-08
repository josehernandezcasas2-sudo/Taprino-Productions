import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getAllSeries } from '../../lib/series';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { needsYou } from '../../lib/showRules';
import { sortEpisodes, episodeCode } from '../../lib/seriesResume';
import { parseRuntimeToSeconds } from '../../lib/videoMetadata';
import HeaderNav from '../../components/HeaderNav';
import EditSubmissionModal from '../../components/EditSubmissionModal';
import AdminEditEpisodeModal from '../../components/AdminEditEpisodeModal';
import ArtworkModal from '../../components/ArtworkModal';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import CaptionUploadModal from '../../components/CaptionUploadModal';
import ReplaceVideoModal from '../../components/ReplaceVideoModal';
import RequestEditModal from '../../components/RequestEditModal';
import { pageNotesBoxShows } from '../../components/PageNotesField';
import SellTitleModal, { priceState, STATE_LABEL as SELL_STATE_LABEL } from '../../components/creator/SellTitleModal';
import { PayeeModal } from '../../components/show/PayeeCard';
import Footer from '../../components/Footer';
import { ImageIcon, ChatIcon, TrashIcon, WarningIcon, ClockIcon, ClapperboardIcon, HeadphonesIcon, SettingsIcon, PencilIcon, EyeIcon, ExternalLinkIcon, LinkIcon, UndoIcon, TicketIcon, AccountIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import { SITE } from '../../lib/siteConfig';
import { dollars } from '../../lib/purchaseRules';
import { extraKindLabel } from '../../lib/extraKinds';

// The creator path's words (2026-10-31): In review / Live / Not this time.
const STATUS_LABEL = {
  pending: { text: 'In review', color: 'var(--signal-amber)' },
  approved: { text: 'Live', color: 'var(--ok)' },
  rejected: { text: 'Not this time', color: 'var(--danger)' }
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
const SHOW_STATE_CLASS = { live: 'live', ready: 'ready', review: 'private', drafts: 'private', empty: 'private', pulled: 'pulled', removal: 'removal', declined: 'declined' };

// Your work, grouped (the series revamp, slice 2; the YourWork board): a
// show's titles sit under the show — a header that opens its show page
// (the show's gear menu is gone: the show page edits it, sells it and
// takes its extras), "Season N" sub-headings when it has more than one,
// rows in play order with their "S1 E3" code, the changes waiting for
// approval and why a title was pulled, and a pencil that opens the
// episode editor (/creator/show/<id>/episode/<episodeId>) instead of the
// old modals. Its extras follow it. Films, shorts and Snippets keep their
// rows and their modals until the editor learns them (the next pass).
// Needs attention is the hub's Needs you (lib/showRules.js needsYou).
//
// Who gets paid (the series revamp, slice 3b: mockups/series-slice3b-
// contract.md §6.3): every row's menu has it — a show's title opens its
// editor at the Who gets paid card, a title of its own opens the card in
// a sheet (components/show/PayeeCard.js PayeeModal). Prices are set by
// whoever runs a title (`canPrice` on each row from my-submissions): Sell
// is hidden on a row the viewer doesn't run, and the Sell modal says when
// the title's paid account can't take a sale yet (/api/creator/pricing
// `blocked`).
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeries(account.userId), getPublicEpisodes()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      allSeries
    }
  };
}

function showHref(id) {
  return `/creator/show/${encodeURIComponent(id)}`;
}

function editorHref(showId, episodeId) {
  return `/creator/show/${encodeURIComponent(showId)}/episode/${encodeURIComponent(episodeId)}`;
}

function bg(url) {
  return url ? { backgroundImage: `url("${String(url).replace(/"/g, '%22')}")` } : undefined;
}

function displayTitle(s) {
  const own = typeof s.title === 'string' ? s.title.trim() : '';
  if (own) return own;
  return s.seriesOrder ? `Episode ${s.seriesOrder}` : 'Untitled';
}

// "24 min" from the stored runtime ("23:40", "1:02:15"); the text as it is
// when it isn't a clock.
function minutes(runtime) {
  const secs = parseRuntimeToSeconds(runtime);
  if (secs === null) return runtime || null;
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
// isn't Live yet). An extra has no show status of its own on the row
// (my-submissions reads series_id, which an extra doesn't have): `show`,
// the summary of the show it is attached to, answers for it when known.
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

export default function MyWork({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, allSeries }) {
  const iconOverrides = usePlayerIconOverrides();
  const [submissions, setSubmissions] = useState(null);
  // The viewer's shows (GET /api/show?mine=1) for the group headers: art,
  // kind, where the show stands, its count line and season names. The
  // headers fall back to what the rows say when it can't load.
  const [shows, setShows] = useState([]);
  const [channelBusy, setChannelBusy] = useState(null);
  const [channelError, setChannelError] = useState(null);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  // The hub's piles deep-link here: ?status=pending|approved|rejected, ?attention=1.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const st = q.get('status');
    if (st && ['pending', 'approved', 'rejected'].includes(st)) setStatusFilter(st);
    if (q.get('attention') === '1') setNeedsAttentionOnly(true);
  }, []);
  const [copiedLinkId, setCopiedLinkId] = useState(null);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [fullEditSubmission, setFullEditSubmission] = useState(null);
  const [artworkSubmission, setArtworkSubmission] = useState(null);
  const [deletingSubmission, setDeletingSubmission] = useState(null);
  const [captionSubmission, setCaptionSubmission] = useState(null);
  const [replacingVideoSubmission, setReplacingVideoSubmission] = useState(null);
  const [deleteActionError, setDeleteActionError] = useState(null);
  const [extractingId, setExtractingId] = useState(null);
  const [extractProgress, setExtractProgress] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null); // 'episode:<id>' | null
  const [editRequestTarget, setEditRequestTarget] = useState(null); // { type, currentValues }
  // Buy to own: this creator's prices keyed "episode:<id>" / "series:<id>"
  // (/api/creator/pricing) and the title the Sell modal is open for.
  const [pricing, setPricing] = useState({ prices: {}, settings: {} });
  const [sellTarget, setSellTarget] = useState(null); // { type, id, title, sub }
  // Who gets paid for a title of its own (a show's title opens its editor).
  const [payeeTarget, setPayeeTarget] = useState(null); // { id, title }

  async function loadPricing() {
    try {
      const res = await fetch('/api/creator/pricing');
      if (res.ok) setPricing(await res.json());
    } catch (err) {
      // The rows just show no price.
    }
  }
  useEffect(() => { loadPricing(); }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/show?mine=1')
      .then((r) => (r.ok ? r.json() : { shows: [] }))
      .then((d) => { if (alive && d && Array.isArray(d.shows)) setShows(d.shows); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // A short pill for a row: "On sale · $4.99", "In review", …
  function pricePill(type, id) {
    const row = pricing.prices[`${type}:${id}`];
    if (!row) return null;
    const state = priceState(row);
    const live = row.price_cents ? dollars(row.price_cents) : null;
    const sale = row.sale_percent && row.sale_ends_at && new Date(row.sale_ends_at) > new Date();
    return (
      <span className={`sell-state ${state}`} style={{ marginLeft: '0.4rem' }}>
        {state === 'on' ? `On sale · ${live}${sale ? ` · ${row.sale_percent}% off` : ''}` : state === 'pending' ? `In review · ${dollars(row.pending_cents)}` : SELL_STATE_LABEL[state]}
      </span>
    );
  }

  async function extractAudio(episodeId) {
    setExtractingId(episodeId);
    setExtractProgress(null);
    // Polls every 3s, same cadence as the Cloudflare processing polls
    // used elsewhere (CloudflareHouseAdImport, etc.) — audio extraction
    // runs on Cloudflare's side and this just checks in on it.
    const poll = async () => {
      try {
        const res = await fetch('/api/creator/extract-podcast-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not extract audio.');
        if (data.status === 'ready') {
          setExtractingId(null);
          setExtractProgress(null);
          loadSubmissions();
          return;
        }
        setExtractProgress(data.percentComplete);
        setTimeout(poll, 3000);
      } catch (err) {
        setDeleteActionError(err.message);
        setExtractingId(null);
        setExtractProgress(null);
      }
    };
    poll();
  }

  // Podcast episodes don't get their own page — they're played inline from
  // their show's page — so "view live" has to point there for podcasts and
  // at the episode page itself for everything else.
  function publicUrlFor(s) {
    const path = s.contentType === 'podcast' && s.seriesId ? `/podcasts/${s.seriesId}` : `/episode/${s.id}`;
    return `${SITE.productionDomain}${path}`;
  }

  async function copyPublicLink(s) {
    try {
      await navigator.clipboard.writeText(publicUrlFor(s));
      setCopiedLinkId(s.id);
      setTimeout(() => setCopiedLinkId((current) => (current === s.id ? null : current)), 2000);
    } catch (err) {
      // Clipboard access can fail (permissions, insecure context, etc.) —
      // not worth surfacing an error for a nice-to-have convenience action.
    }
  }

  async function loadSubmissions() {
    setLoadingSubmissions(true);
    try {
      const res = await fetch('/api/creator/my-submissions');
      const data = await res.json();
      if (res.ok) setSubmissions(data.submissions);
    } catch (err) {
      // Leave submissions as whatever it already was — a failed refresh
      // shouldn't wipe out what's already showing.
    }
    setLoadingSubmissions(false);
  }

  useEffect(() => { loadSubmissions(); }, []);

  // "Let channels air this" — per standalone title (a show's channels are
  // set on its show page).
  async function setChannelOptIn(type, id, optIn) {
    setChannelBusy(`${type}:${id}`);
    setChannelError(null);
    try {
      const res = await fetch('/api/creator/channel-opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, optIn })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not change that.');
      setSubmissions((list) => (list || []).map((x) => (x.id === id ? { ...x, channelOptIn: optIn } : x)));
    } catch (err) {
      setChannelError(err.message);
    } finally {
      setChannelBusy(null);
    }
  }

  async function requestEpisodeDeletion(reason) {
    const res = await fetch('/api/creator/request-episode-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId: deletingSubmission.id, action: 'request', reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit the request.');
    setDeletingSubmission(null);
    loadSubmissions();
  }

  async function cancelEpisodeDeletion(episodeId) {
    setDeleteActionError(null);
    try {
      const res = await fetch('/api/creator/request-episode-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, action: 'cancel' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel the request.');
      loadSubmissions();
    } catch (err) {
      setDeleteActionError(err.message);
    }
  }

  const all = submissions || [];
  const byId = new Map(all.map((s) => [s.id, s]));
  const showById = new Map(shows.map((sh) => [sh.id, sh]));
  const seriesById = new Map((allSeries || []).map((s) => [s.id, s]));

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

  const total = all.length;
  const liveCount = all.filter(live).length;
  const pendingCount = all.filter((s) => s.status === 'pending').length;
  const approvedCount = all.filter((s) => s.status === 'approved').length;
  const rejectedCount = all.filter((s) => s.status === 'rejected').length;
  const reviewedCount = approvedCount + rejectedCount;
  const approvalRate = reviewedCount > 0 ? Math.round((approvedCount / reviewedCount) * 100) : null;
  const turnaroundHoursList = all
    .filter((s) => s.reviewedAt && s.createdAt)
    .map((s) => (new Date(s.reviewedAt).getTime() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60));
  const avgTurnaroundHours = turnaroundHoursList.length > 0
    ? Math.round(turnaroundHoursList.reduce((a, b) => a + b, 0) / turnaroundHoursList.length)
    : null;
  const missingArtworkCount = all.filter((s) => s.status !== 'rejected' && s.missingArtwork).length;

  const query = searchQuery.trim().toLowerCase();
  const filteredSubmissions = all.filter((s) => {
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
  // (standalone films, shorts, Snippets) is grouped by content type, so a
  // creator with several kinds of standalone work still sees it
  // organized rather than one undifferentiated pile.
  const groupsByKey = {};
  for (const s of filteredSubmissions) {
    const sid = showIdOf(s);
    const key = sid ? `series:${sid}` : `type:${s.contentType}`;
    if (!groupsByKey[key]) {
      const summary = sid ? showById.get(sid) : null;
      const series = sid ? seriesById.get(sid) : null;
      groupsByKey[key] = {
        key,
        isShow: Boolean(sid),
        showId: sid,
        summary,
        label: sid ? ((summary && summary.name) || s.seriesName || (series && series.name) || 'A show') : (STANDALONE_TYPE_LABELS[s.contentType] || 'Other'),
        kind: sid ? ((summary && summary.kind) || s.seriesKind || (s.contentType === 'podcast' ? 'podcast' : 'series')) : null,
        items: []
      };
    }
    groupsByKey[key].items.push(s);
  }
  // Shows first (alphabetical), then the standalone groups in the fixed
  // Films / Shorts / Vertical / Podcasts / Extras order used elsewhere.
  const typeOrder = Object.keys(STANDALONE_TYPE_LABELS);
  const projectGroups = Object.values(groupsByKey).sort((a, b) => {
    if (a.isShow !== b.isShow) return a.isShow ? -1 : 1;
    if (!a.isShow && !b.isShow) {
      return typeOrder.indexOf(a.items[0].contentType) - typeOrder.indexOf(b.items[0].contentType);
    }
    return a.label.localeCompare(b.label);
  });

  function gearMenu(s, { forShow = false } = {}) {
    const key = `episode:${s.id}`;
    const onSite = live(s);
    const canExtract = s.contentType === 'podcast' && s.hasVideo && !s.hasAudio;
    // A row the viewer doesn't run never shows Sell (slice 3b).
    const canSell = s.canPrice !== false;
    return (
      <span className="yw-gear-wrap">
        <button
          type="button"
          className={forShow ? 'yw-gear' : 'yw-gear-inline'}
          onClick={() => setOpenDropdown(openDropdown === key ? null : key)}
          aria-label={`Options for ${displayTitle(s)}`}
          aria-haspopup="menu"
          aria-expanded={openDropdown === key}
        >
          <SettingsIcon size={forShow ? 16 : 14} src={iconOverrides.settings} />
        </button>
        {openDropdown === key && (
          <div className="dropdown dropdown-left open yw-menu" role="menu" aria-label={displayTitle(s)}>
            {!forShow && (isAdmin ? (
              <button className="dropdown-item" role="menuitem" onClick={() => { setFullEditSubmission(s); setOpenDropdown(null); }}>
                <PencilIcon size={12} src={iconOverrides.pencil} /> Edit full details
              </button>
            ) : (
              <button
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  setEditRequestTarget({ type: 'episode', currentValues: { id: s.id, title: s.title, description: s.description || '', pageNotes: s.pageNotes || '', notesShown: pageNotesBoxShows(s) } });
                  setOpenDropdown(null);
                }}
              >
                <PencilIcon size={12} src={iconOverrides.pencil} /> {pageNotesBoxShows(s) ? 'Edit title, description & notes' : <>Edit title &amp; description</>}
              </button>
            ))}
            {onSite && (
              <>
                <a className="dropdown-item" role="menuitem" href={publicUrlFor(s)} target="_blank" rel="noopener noreferrer" onClick={() => setOpenDropdown(null)}>
                  <ExternalLinkIcon size={12} src={iconOverrides.external_link} /> View page
                </a>
                <button className="dropdown-item" role="menuitem" onClick={() => copyPublicLink(s)}>
                  <LinkIcon size={12} src={iconOverrides.link} /> {copiedLinkId === s.id ? 'Link copied!' : 'Copy link'}
                </button>
              </>
            )}
            {forShow && onSite && s.contentType !== 'bonus' && canSell && (
              <button
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  setSellTarget({ type: 'episode', id: s.id, title: displayTitle(s), sub: [episodeCode(s), minutes(s.runtime), s.seriesName].filter(Boolean).join(' · ') });
                  setOpenDropdown(null);
                }}
              >
                <TicketIcon size={12} src={iconOverrides.ticket} /> {pricing.prices[`episode:${s.id}`] ? 'Price and sales' : 'Sell'}
                {pricing.prices[`episode:${s.id}`] && pricing.prices[`episode:${s.id}`].price_cents ? <span className="yw-menu-price">{dollars(pricing.prices[`episode:${s.id}`].price_cents)}</span> : null}
              </button>
            )}
            {forShow ? (
              <Link className="dropdown-item" role="menuitem" href={`${editorHref(showIdOf(s), s.id)}#who-gets-paid`} onClick={() => setOpenDropdown(null)}>
                <AccountIcon size={12} src={iconOverrides.account} /> Who gets paid
              </Link>
            ) : (
              <button className="dropdown-item" role="menuitem" onClick={() => { setPayeeTarget({ id: s.id, title: displayTitle(s) }); setOpenDropdown(null); }}>
                <AccountIcon size={12} src={iconOverrides.account} /> Who gets paid
              </button>
            )}
            {forShow && canExtract && (
              <button className="dropdown-item" role="menuitem" disabled={extractingId === s.id} onClick={() => { setOpenDropdown(null); extractAudio(s.id); }}>
                <HeadphonesIcon size={12} src={iconOverrides.headphones} /> {extractingId === s.id ? `Extracting the audio…${extractProgress != null ? ` ${Math.round(extractProgress)}%` : ''}` : 'Extract the audio'}
              </button>
            )}
          </div>
        )}
      </span>
    );
  }

  // The lines under a show row: what waits for approval, why it was
  // pulled or sent back, what the file is missing.
  function showRowFlags(s) {
    const flags = [];
    if (s.status === 'rejected') flags.push({ key: 'rejected', tone: 'warn', Icon: WarningIcon, icon: 'warning', text: s.rejectionReason ? `Not this time: ${s.rejectionReason}` : 'Not this time' });
    if (s.held) flags.push({ key: 'held', tone: 'warn', Icon: WarningIcon, icon: 'warning', text: s.holdReason ? `Pulled: ${s.holdReason}` : 'Pulled while an admin looks at it' });
    if (s.deletionRequested) flags.push({ key: 'removal', tone: 'muted', Icon: TrashIcon, icon: 'trash', text: s.deletionReason ? `Removal requested: ${s.deletionReason}` : 'Removal requested' });
    if (s.pendingTitle) flags.push({ key: 'title', tone: 'wait', Icon: ClockIcon, icon: 'clock', text: 'Title change waiting' });
    if (s.pendingDescription) flags.push({ key: 'desc', tone: 'wait', Icon: ClockIcon, icon: 'clock', text: 'Description change waiting' });
    if (s.pendingSrc) flags.push({ key: 'video', tone: 'wait', Icon: ClockIcon, icon: 'clock', text: s.pendingVideoState && s.pendingVideoState !== 'ready' ? 'New video waiting · still processing' : 'New video waiting' });
    if (s.artworkPending) flags.push({ key: 'art', tone: 'wait', Icon: ClockIcon, icon: 'clock', text: 'Art waiting for approval' });
    if (s.cloudflareState === 'error') flags.push({ key: 'cf', tone: 'warn', Icon: WarningIcon, icon: 'warning', text: 'The file failed to process — replace it' });
    else if (s.cloudflareState === 'pendingupload') flags.push({ key: 'cf', tone: 'warn', Icon: WarningIcon, icon: 'warning', text: 'The upload never finished' });
    if (s.status === 'approved' && s.contentType !== 'podcast' && s.contentType !== 'bonus' && !s.captionsUrl) flags.push({ key: 'captions', tone: 'warn', Icon: ChatIcon, icon: 'chat', text: 'No captions' });
    else if (s.captionsStale) flags.push({ key: 'stale', tone: 'warn', Icon: ChatIcon, icon: 'chat', text: 'Captions may be out of sync' });
    return flags;
  }

  function showRowMeta(s) {
    const parts = [];
    if (s.cloudflareState && !['ready', 'error', 'pendingupload'].includes(s.cloudflareState)) parts.push(CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState);
    else if (s.runtime) parts.push(minutes(s.runtime));
    if (s.contentType === 'bonus') {
      // What kind of extra (migration 121), when it has one.
      if (s.extraKind) parts.push(extraKindLabel(s.extraKind));
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
    const titleId = `yw-t-${s.id}`;
    const status = showRowStatus(s, live(s));
    const flags = showRowFlags(s);
    return (
      <div key={s.id} className="yw-row" id={`yw-${s.id}`}>
        <span className="yw-thumb" style={bg(s.thumbnail || s.poster)} aria-hidden="true" />
        <span className="yw-main">
          <span className="yw-title" id={titleId}>{code && <span className="yw-code">{code}</span>}<span className="yw-title-text">{displayTitle(s)}</span></span>
          <span className="yw-meta">
            <span className={`yw-status ${status.tone}`}>{status.text}</span>
            <span className="yw-meta-text">{showRowMeta(s)}</span>
          </span>
          {flags.map((f) => (
            <span key={f.key} className={`yw-flag ${f.tone}`}><f.Icon size={12} src={iconOverrides[f.icon]} />{f.text}</span>
          ))}
        </span>
        <Link href={editorHref(group.showId, s.id)} className="yw-edit" aria-label={s.contentType === 'bonus' ? 'Edit extra' : 'Edit episode'} aria-describedby={titleId}>
          <PencilIcon size={15} src={iconOverrides.pencil} />
        </Link>
        {gearMenu(s, { forShow: true })}
      </div>
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
    const poster = (sh && (sh.poster || sh.thumbnail)) || (seriesById.get(group.showId) && (seriesById.get(group.showId).poster || seriesById.get(group.showId).thumbnail)) || null;
    const countLine = sh ? sh.countLine : `${episodes.length} episode${episodes.length === 1 ? '' : 's'}${extras.length ? ` · ${extras.length} extra${extras.length === 1 ? '' : 's'}` : ''}`;
    const headingId = `yw-g-${group.showId}`;
    return (
      <section key={group.key} className="project-group yw-group" aria-labelledby={headingId}>
        <Link href={showHref(group.showId)} className="yw-head">
          <span className={`yw-poster${poster ? '' : ' empty'}`} style={bg(poster)} aria-hidden="true">{!poster && <span>{group.label}</span>}</span>
          <span className="yw-head-main">
            <span className="yw-head-title">
              <h2 id={headingId} className="yw-name">{group.label}</h2>
              <span className={`cs-chip kind-${group.kind === 'podcast' ? 'podcast' : 'series'}`}>{group.kind === 'podcast' ? 'Podcast' : 'Series'}</span>
              {state !== 'live' && statusLabel && <span className={`cs-chip state-${SHOW_STATE_CLASS[state] || 'private'}`}>{statusLabel}</span>}
            </span>
            <span className="yw-count">{countLine}</span>
            <span className="yw-open">Open show page →</span>
          </span>
        </Link>
        {episodes.length > 0 && seasons.length > 1
          ? seasons.map((n) => (
            <div key={n} className="yw-season-block">
              <div className="yw-season"><h3>{labelFor(n)}</h3></div>
              {episodes.filter((s) => (Number(s.season) || 1) === n).map((s) => renderShowRow(s, group))}
            </div>
          ))
          : episodes.map((s) => renderShowRow(s, group))}
        {extras.length > 0 && (
          <div className="yw-season-block">
            <div className="yw-season"><h3>Extras</h3></div>
            {extras.map((s) => renderShowRow(s, group))}
          </div>
        )}
      </section>
    );
  }

  function renderEpisodeRow(s) {
    const flags = [];
    if (s.missingArtwork && s.status !== 'rejected') flags.push({ type: 'artwork', title: 'Missing artwork', Icon: ImageIcon, iconKey: 'image' });
    if (s.contentType !== 'podcast' && !s.captionsUrl && s.status === 'approved') flags.push({ type: 'captions', title: 'No captions', Icon: ChatIcon, iconKey: 'chat' });
    if (s.artworkPending) flags.push({ type: 'pending', title: 'Artwork change awaiting approval', Icon: ClockIcon, iconKey: 'clock' });
    if (s.pendingTitle) flags.push({ type: 'title', title: 'Title change waiting', Icon: ClockIcon, iconKey: 'clock' });
    if (s.pendingSrc) flags.push({ type: 'video', title: 'New video waiting', Icon: ClockIcon, iconKey: 'clock' });
    if (s.deletionRequested) flags.push({ type: 'deletion', title: 'Pending deletion', Icon: TrashIcon, iconKey: 'trash' });

    return (
      <div key={s.id} className="work-episode-row">
        <div className="episode-thumb" style={s.thumbnail ? { backgroundImage: `url(${s.thumbnail})` } : {}}>
          {!s.thumbnail && (s.cloudflareState === 'error' ? <WarningIcon size={16} src={iconOverrides.warning} /> : <ClockIcon size={16} src={iconOverrides.clock} />)}
        </div>
        <div className="episode-row-main">
          <div className="episode-title">
            {s.title}
            {/* For a podcast with both audio and video, showing both icons
                here is the whole point — at a glance, a creator can tell
                which of their episodes are audio-only, video-only, or
                offer both, without opening anything. */}
            {s.hasVideo && <span className="episode-media-icon" title="Has video"><ClapperboardIcon size={12} src={iconOverrides.clapperboard} /></span>}
            {s.hasAudio && <span className="episode-media-icon" title="Has audio"><HeadphonesIcon size={12} src={iconOverrides.headphones} /></span>}
            {!s.deletionRequested && gearMenu(s)}
          </div>
          <div className="episode-meta">
            {s.cloudflareState && s.cloudflareState !== 'ready'
              ? (CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState)
              : (s.runtime || s.description)}
          </div>
          {s.contentType !== 'bonus' && (
            <button
              type="button"
              className={`chan-optin ${s.channelOptIn ? 'on' : ''}`}
              aria-pressed={s.channelOptIn}
              disabled={channelBusy === `episode:${s.id}`}
              onClick={() => setChannelOptIn('episode', s.id, !s.channelOptIn)}
              title={s.channelOptIn ? 'Channels can air this. Click to stop.' : 'Let channels like TapaTV air this'}
            >
              <i aria-hidden="true" />Channels: {s.channelOptIn ? 'on' : 'off'}
            </button>
          )}
          {s.status === 'approved' && pricePill('episode', s.id)}
          {s.status === 'rejected' && s.rejectionReason && (
            <p className="submission-rejection">Admin's note: {s.rejectionReason}</p>
          )}
          {s.held && s.holdReason && <p className="submission-rejection">Pulled: {s.holdReason}</p>}
          {s.cloudflareState === 'error' && s.cloudflareError && (
            <p className="submission-rejection">Upload problem: {s.cloudflareError} — this file likely needs to be re-exported and re-submitted.</p>
          )}
          {s.deletionRequested && <p className="submission-rejection">Deletion reason: {s.deletionReason}</p>}
        </div>
        {s.held && s.status === 'approved'
          ? <span className="status-pill rejected" title="Taken off the site while an admin reviews it. You'll get a notice when it's decided.">Pulled for review</span>
          : <span className={`status-pill ${s.status}`}>{(STATUS_LABEL[s.status] || {}).text || s.status}</span>}
        <div className="row-views">{s.status === 'approved' ? <><EyeIcon size={12} src={iconOverrides.eye} /> {s.viewCount}</> : '—'}</div>
        {flags.length > 0 && (
          <div className="row-flags">
            {flags.map((f) => <span key={f.type} className="row-flag" title={f.title}><f.Icon size={12} src={iconOverrides[f.iconKey]} /></span>)}
          </div>
        )}
        <div className="row-actions">
          {s.contentType === 'podcast' && s.hasVideo && !s.hasAudio && (
            <button onClick={() => extractAudio(s.id)} disabled={extractingId === s.id} title="Extract audio from video">
              {extractingId === s.id ? `…${extractProgress != null ? ` ${Math.round(extractProgress)}%` : ''}` : <><HeadphonesIcon size={14} src={iconOverrides.headphones} />+</>}
            </button>
          )}
          {s.status === 'pending' && !s.deletionRequested && (
            <button onClick={() => setEditingSubmission(s)} title="Edit"><PencilIcon size={14} src={iconOverrides.pencil} /></button>
          )}
          {!s.deletionRequested && (
            <button onClick={() => setArtworkSubmission(s)} title={s.poster || s.thumbnail ? 'Replace artwork' : 'Add artwork'}><ImageIcon size={14} src={iconOverrides.image} /></button>
          )}
          {!s.deletionRequested && (
            <button onClick={() => setReplacingVideoSubmission(s)} title={s.hasVideo ? 'Replace video' : 'Add video'}><ClapperboardIcon size={14} src={iconOverrides.clapperboard} /></button>
          )}
          {!s.deletionRequested && s.contentType !== 'podcast' && (
            <button onClick={() => setCaptionSubmission(s)} title={s.captionsUrl ? 'Replace captions' : 'Add captions'}><ChatIcon size={14} src={iconOverrides.chat} /></button>
          )}
          {!s.deletionRequested && s.status === 'approved' && !s.held && s.contentType !== 'bonus' && s.canPrice !== false && (
            <button
              className={pricing.prices[`episode:${s.id}`] && priceState(pricing.prices[`episode:${s.id}`]) === 'on' ? 'sell-on' : ''}
              onClick={() => setSellTarget({ type: 'episode', id: s.id, title: s.title, sub: [s.contentType, s.runtime, s.seriesName].filter(Boolean).join(' · ') })}
              title={pricing.prices[`episode:${s.id}`] ? 'Price and sales' : 'Sell this title'}
            >
              <TicketIcon size={14} src={iconOverrides.ticket} />
            </button>
          )}
          {s.deletionRequested ? (
            <button onClick={() => cancelEpisodeDeletion(s.id)} title="Cancel deletion request"><UndoIcon size={14} src={iconOverrides.undo} /></button>
          ) : (
            <button onClick={() => setDeletingSubmission(s)} title="Request deletion"><TrashIcon size={14} src={iconOverrides.trash} /></button>
          )}
        </div>
      </div>
    );
  }

  function renderStandaloneGroup(group) {
    const pendingInGroup = group.items.filter((s) => s.status === 'pending').length;
    const missingArtworkInGroup = group.items.filter((s) => s.missingArtwork && s.status !== 'rejected').length;
    const groupArt = group.items.find((s) => s.thumbnail || s.poster);
    return (
      <div key={group.key} className="project-group">
        <div className="project-header">
          <div
            className="project-art"
            style={groupArt ? { backgroundImage: `url(${groupArt.thumbnail || groupArt.poster})` } : {}}
          />
          <div className="project-title-wrap">
            <div className="project-title">{group.label}</div>
            <div className="project-sub">{group.items.length} title{group.items.length === 1 ? '' : 's'}</div>
          </div>
          <div className="project-badges">
            {pendingInGroup > 0 && <span className="project-badge pending">{pendingInGroup} in review</span>}
            {missingArtworkInGroup > 0 && <span className="project-badge missing">{missingArtworkInGroup} needs artwork</span>}
          </div>
        </div>
        {group.items.map(renderEpisodeRow)}
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Your work — {SITE.name}</title>
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <main id="main-content" className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Creator Studio</div>
            <h1>Your work</h1>
            <p className="ca-sub">Everything you&rsquo;ve sent us, in review or live. A show&rsquo;s episodes sit under the show.</p>
          </div>
          <Link href="/creator/submit" className="account-btn-primary" style={{ width: 'auto', textDecoration: 'none' }}>
            + Submit a title
          </Link>
        </div>

        <div className="account-card">
          <p style={{ margin: '0 0 1rem', fontSize: '0.87rem', color: 'var(--ink-dim)' }}>
            Want to see how they&rsquo;re doing?{' '}
            <Link href="/creator/analytics" style={{ color: 'var(--signal-amber)' }}>
              View your numbers →
            </Link>
          </p>

          {deleteActionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{deleteActionError}</p>}
          {channelError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }} role="alert">{channelError}</p>}

          {loadingSubmissions && !submissions && <p>Loading…</p>}

          {submissions && submissions.length === 0 && (
            <p>Nothing submitted yet — <Link href="/creator/submit" style={{ color: 'var(--signal-amber)' }}>submit your first one</Link>.</p>
          )}

          {submissions && submissions.length > 0 && (
            <>
              <div className="dash-stats">
                <div className="dash-stat">
                  <div className="dash-stat-value">{total}</div>
                  <div className="dash-stat-label">Total</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{pendingCount}</div>
                  <div className="dash-stat-label">In review</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{liveCount}</div>
                  <div className="dash-stat-label">Live</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{approvalRate === null ? '—' : `${approvalRate}%`}</div>
                  <div className="dash-stat-label">Approval rate</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">{avgTurnaroundHours === null ? '—' : `${avgTurnaroundHours}h`}</div>
                  <div className="dash-stat-label">Avg. review time</div>
                </div>
              </div>

              {missingArtworkCount > 0 && (
                <div className="dash-nudge">
                  <ImageIcon size={13} src={iconOverrides.image} /> {missingArtworkCount} title{missingArtworkCount === 1 ? '' : 's'} still missing a poster or a still — a show&rsquo;s episodes take theirs on its show page, a film&rsquo;s from &ldquo;Add artwork&rdquo; on its row.
                </div>
              )}

              <div className="yourwork-toolbar">
                <input
                  type="search"
                  placeholder="Search your titles…"
                  aria-label="Search your titles"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {['all', 'pending', 'approved', 'rejected'].map((f) => (
                  <button
                    key={f}
                    className={`filter-pill ${statusFilter === f ? 'on' : ''}`}
                    aria-pressed={statusFilter === f}
                    onClick={() => setStatusFilter(f)}
                  >
                    {f === 'all' ? 'All' : STATUS_LABEL[f].text}
                  </button>
                ))}
                <button
                  className={`filter-pill ${needsAttentionOnly ? 'on' : ''}`}
                  aria-pressed={needsAttentionOnly}
                  onClick={() => setNeedsAttentionOnly((v) => !v)}
                >
                  <WarningIcon size={12} src={iconOverrides.warning} /> Needs attention
                </button>
              </div>

              {filteredSubmissions.length === 0 && (
                <p>Nothing matches this filter.</p>
              )}

              {projectGroups.map((group) => (group.isShow ? renderShowGroup(group) : renderStandaloneGroup(group)))}
            </>
          )}
        </div>
      </main>
      <Footer />

      {editingSubmission && (
        <EditSubmissionModal
          submission={editingSubmission}
          onClose={() => setEditingSubmission(null)}
          onSaved={() => { setEditingSubmission(null); loadSubmissions(); }}
        />
      )}

      {fullEditSubmission && (
        <AdminEditEpisodeModal
          episode={fullEditSubmission}
          allSeries={allSeries}
          // Scoped to this creator's own work rather than the whole site's
          // library (which is what admin.js itself passes in) — bonus
          // content here is meant to extend one of the creator's own
          // standalone pieces, not anyone else's.
          standaloneEpisodes={(submissions || []).filter((sub) => ['movie', 'short'].includes(sub.contentType) && sub.id !== fullEditSubmission.id)}
          onClose={() => setFullEditSubmission(null)}
          onSaved={() => { setFullEditSubmission(null); loadSubmissions(); }}
        />
      )}

      {artworkSubmission && (
        <ArtworkModal
          submission={artworkSubmission}
          onClose={() => setArtworkSubmission(null)}
          onSaved={() => { setArtworkSubmission(null); loadSubmissions(); }}
        />
      )}

      {deletingSubmission && (
        <DeleteRequestModal
          itemLabel={deletingSubmission.title}
          onClose={() => setDeletingSubmission(null)}
          onConfirm={requestEpisodeDeletion}
        />
      )}

      {replacingVideoSubmission && (
        <ReplaceVideoModal
          submission={replacingVideoSubmission}
          onClose={() => { setReplacingVideoSubmission(null); loadSubmissions(); }}
        />
      )}

      {captionSubmission && (
        <CaptionUploadModal
          submission={captionSubmission}
          onClose={() => setCaptionSubmission(null)}
          onSaved={loadSubmissions}
        />
      )}

      {editRequestTarget && (
        <RequestEditModal
          type={editRequestTarget.type}
          currentValues={editRequestTarget.currentValues}
          onClose={() => setEditRequestTarget(null)}
          onSubmitted={loadSubmissions}
        />
      )}

      {payeeTarget && (
        <PayeeModal
          type="episode"
          id={payeeTarget.id}
          title={payeeTarget.title}
          onClose={() => setPayeeTarget(null)}
          onChanged={() => { loadSubmissions(); loadPricing(); }}
        />
      )}

      {sellTarget && (
        <SellTitleModal
          target={sellTarget}
          price={pricing.prices[`${sellTarget.type}:${sellTarget.id}`] || null}
          settings={pricing.settings}
          blocked={pricing.blocked ? pricing.blocked[`${sellTarget.type}:${sellTarget.id}`] || null : null}
          isAdmin={isAdmin}
          onClose={() => setSellTarget(null)}
          onSaved={loadPricing}
        />
      )}
    </>
  );
}
