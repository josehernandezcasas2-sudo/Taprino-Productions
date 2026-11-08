// The admin deck's words and small rules (mobile/src/app/admin/review.js),
// kept apart from the screen so they import nothing and a suite can run
// them on the server's real queue items. The words are the website's
// (components/admin/ReviewQueue.js); change both together.

// The kinds the deck draws. The old 'series' kind (a show ready to go
// public) is gone: Make it public is the owner's (decision 2).
export const KIND_LABEL = { submission: 'Episode', ad: 'Ad', channel: 'Channel upload', location: 'Place', price: 'Price', application: 'Application' };

// A show episode's eyebrow, by where its show stands (lib/reviewQueue.js
// meta.show.stage). `tone` names a theme colour: ok, danger, faint or plain.
export const STAGE_EYEBROW = {
  new: { text: 'New show', tone: 'plain' },
  private: { text: 'Show · not public yet', tone: 'plain' },
  live: { text: 'Show · live', tone: 'ok' },
  pulled: { text: 'Show · pulled', tone: 'danger' },
  removal: { text: 'Show · removal requested', tone: 'faint' }
};

export const FILE_WORDS = { ready: 'ready', audio: 'audio', external: 'ready (its own address)', processing: 'still processing', uploading: 'still uploading', error: 'failed to process', deleted: 'gone from Cloudflare', none: 'no file yet', unknown: 'not checked yet' };

// Meta the card already says in its own words (the website's HIDDEN_META).
export const HIDDEN_META = ['blocked', 'masterReady', 'openOnShowPage', 'tier', 'seen'];

const LABELS = { contentType: 'Type', hasCaptions: 'Captions', durationSeconds: 'Duration', budgetTotalCents: 'Budget', clickUrl: 'Click URL', accountContactEmail: 'Advertiser', proofUrl: 'Proof', proofNote: 'Proof note', hostSays: 'Host says', listingUrl: 'Listing', filesLink: 'Their files', goesLive: 'Accept means', approvedCount: 'Approved episodes', position: 'Place', master: 'The file' };

// ?kind= as the deck reads it: a kind it doesn't know (an old
// ?kind=series link) shows everything.
export function deckKind(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KIND_LABEL, kind) ? kind : null;
}

// The items the deck shows, in the server's order.
export function deckItems(items, kind) {
  const only = deckKind(kind);
  return (Array.isArray(items) ? items : []).filter((i) => i && Object.prototype.hasOwnProperty.call(KIND_LABEL, i.kind) && (!only || i.kind === only));
}

// The show of a submission card, or null.
export function showOf(item) {
  return item && item.kind === 'submission' && item.meta && item.meta.show && typeof item.meta.show === 'object' ? item.meta.show : null;
}

// "Night Bus · 4 in review": this one and the rest of its show's waiting;
// just the name when the queue sends no count.
export function kickerFor(item) {
  const show = showOf(item);
  if (!show) return null;
  const waiting = show.waitingCount === null || show.waitingCount === undefined || !Number.isFinite(Number(show.waitingCount)) ? null : Math.max(0, Number(show.waitingCount));
  return [show.name || 'A show', waiting !== null ? `${waiting + 1} in review` : null].filter(Boolean).join(' · ');
}

// The eyebrow on the media chip: the show's stage for a show's episode,
// else the kind.
export function eyebrowFor(item) {
  const show = showOf(item);
  if (show) return STAGE_EYEBROW[show.stage] || STAGE_EYEBROW.private;
  return { text: KIND_LABEL[item && item.kind] || 'Review', tone: 'plain' };
}

// Why Approve is off (the approval blocker's line), or null.
export function blockedLine(item) {
  return item && item.kind === 'submission' && item.meta && item.meta.blocked ? String(item.meta.blocked) : null;
}

// The place line under the title: { free, words } or null.
export function slotLine(item) {
  const slot = item && item.kind === 'submission' && item.meta ? item.meta.slot : null;
  return slot && slot.words ? { free: slot.free !== false, words: String(slot.words) } : null;
}

// The tier an Approve sends: the chip picked on this card, else what the
// title was sent in with (an application starts at Free, as on the web).
export function tierFor(item, tiers = {}) {
  if (item && tiers && tiers[item.id]) return tiers[item.id];
  if (item && item.kind === 'submission') return item.meta && item.meta.tier === 'premium' ? 'premium' : 'free';
  return 'free';
}

// What an Approve or a Reject sends (the website's queue sends the same).
// A submission's Approve carries `seen` (the queue's fingerprint of the
// file the card shows): a file replaced since answers 409 'changed' and the
// deck reloads, as on the website.
export function decisionBody(item, decision, { reason, tiers } = {}) {
  const withTier = item.kind === 'submission' || item.kind === 'application';
  const seen = decision === 'approve' && item.kind === 'submission' && item.meta && typeof item.meta.seen === 'string' && item.meta.seen ? item.meta.seen : undefined;
  return {
    kind: item.kind,
    id: item.id,
    decision,
    reason: decision === 'reject' || decision === 'hold' ? reason : undefined,
    tierOverride: withTier ? tierFor(item, tiers) : undefined,
    seen
  };
}

// The line after approving a show's episode while its show is private.
export function approvedFlash(item) {
  const show = showOf(item);
  return show && show.makesPublic ? `“${item.title}” is approved. ${show.makesPublic}` : null;
}

// Why nothing plays (the website's words for an episode).
export function noVideoWords(item) {
  const meta = (item && item.meta) || {};
  if (item.kind === 'channel') return 'Loading preview…';
  if (item.kind === 'application') return meta.filesLink ? 'No upload; open their link below' : 'The master is still uploading or processing';
  if (item.kind === 'submission') {
    if (meta.master && meta.master !== 'ready' && meta.masterReady === false) return `The file is ${FILE_WORDS[meta.master] || 'not ready'} — it plays here once it’s ready.`;
    if (meta.openOnShowPage && showOf(item)) return 'Too many to play here at once — open it on the show page.';
    if (meta.openOnShowPage) return 'Too many to play here at once — reload the queue once a few are decided.';
  }
  return null;
}

// "account 12 days old".
export function ageWords(days) {
  const n = Number(days);
  if (days === null || days === undefined || !Number.isFinite(n) || n < 0) return null;
  if (n < 1) return 'new today';
  if (n < 60) return `${Math.floor(n)} day${Math.floor(n) === 1 ? '' : 's'} old`;
  if (n < 730) return `${Math.floor(n / 30)} months old`;
  return `${Math.floor(n / 365)} years old`;
}

// The show card's "by Mara Quinn · account 12 days old".
export function ownerLine(show) {
  const age = ageWords(show && show.ownerAccountAgeDays);
  return [show && show.ownerName ? `by ${show.ownerName}` : 'No one runs it yet', age ? `account ${age}` : null].filter(Boolean).join(' · ');
}

export function labelFor(k) {
  return LABELS[k] || String(k).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export function fmtDuration(s) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function fmtValue(k, v) {
  if (k === 'hasCaptions') return v ? 'Yes' : 'No';
  if (k === 'durationSeconds') return fmtDuration(v);
  if (k === 'budgetTotalCents') return `$${(v / 100).toFixed(2)}`;
  if (k === 'master') return FILE_WORDS[v] || String(v);
  return String(v);
}

// The key/value rows under the description: [key, label, value].
export function metaRows(meta) {
  return Object.entries(meta || {})
    .filter(([k, v]) => !HIDDEN_META.includes(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object' && typeof v !== 'boolean')
    .map(([k, v]) => [k, labelFor(k), fmtValue(k, v)]);
}
