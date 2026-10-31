// Creator onboarding, the client-safe half: the five rights questions, the
// verdict they produce, and the numbers on /apply. No server imports, so
// pages/apply.js and components/RightsCheck.js can use it in the browser.
// lib/creatorApplications.js (database + emails) re-exports all of this
// for the API routes, and GET /api/apply serves the questions to the
// mobile app, so a question changed here changes everywhere.

// `block` means a "no" is a hard stop (only the rights holder can apply);
// otherwise a "no" adds `hold` to the paperwork list and the application
// is flagged as one that would sit in review until that arrives.
export const RIGHTS_QUESTIONS = [
  {
    id: 'own',
    text: 'Did you make this, or do you hold the rights to distribute it?',
    hint: 'Director, producer or rights holder. Someone else’s film you admire does not count.',
    block: true,
    hold: null
  },
  {
    id: 'music',
    text: 'Is every piece of music original, licensed, or royalty-free with proof?',
    hint: 'Unlicensed music is the single most common reason a film sits in review.',
    block: false,
    hold: 'Music licences or cue sheets (or a version with the music replaced)'
  },
  {
    id: 'footage',
    text: 'Is all footage, stock and archival material yours or licensed?',
    hint: 'Clips from other films, TV, games or news need a licence, however short.',
    block: false,
    hold: 'Licences for any stock, archival or third-party footage'
  },
  {
    id: 'people',
    text: 'Do you have releases for the identifiable people on screen?',
    hint: 'Cast and anyone recognisable in a documentary. Crowds in public are fine.',
    block: false,
    hold: 'Signed talent or appearance releases'
  },
  {
    id: 'exclusive',
    text: 'Is it free of exclusivity, festival premiere holds and distributor claims?',
    hint: 'If a distributor or festival holds streaming rights right now, we need a date they release.',
    block: false,
    hold: 'Confirmation of when streaming rights clear, in writing'
  }
];

// The numbers on the page. Jose's call; change here, not in the copy.
export const ONBOARDING = {
  shortMaxMinutes: 40,
  minResolution: '1080p',
  replyWindow: 'two weeks'
};

export const APPLICATION_TYPES = [
  { value: 'short', label: `Short (under ${ONBOARDING.shortMaxMinutes} min)` },
  { value: 'film', label: `Film (${ONBOARDING.shortMaxMinutes} min+)` },
  { value: 'series', label: 'Series' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'vertical', label: 'Vertical / Snippet' }
];

export const APPLICATION_RATINGS = ['All ages', 'TV-14', 'TV-MA / R'];

export const APPLICATION_STATUSES = [
  { value: 'finished', label: 'Finished and ready' },
  { value: 'festival', label: 'Finished, festival run ongoing' },
  { value: 'in_post', label: 'Still in post' }
];

export const APPLICATION_GENRES = ['Comedy', 'Drama', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime', 'Other'];

// The one rights sentence on the form (2026-10-31: the three tick boxes
// became one). The Terms link is rendered beside it by the page.
export const ATTESTATION = 'I made this or hold the rights, I’ve done the check above and will send licences for anything it flagged, and I’ve read Terms, section 5: I keep my copyright and grant a non-exclusive licence to stream and promote.';

// What Accept creates from an application: the catalogue's content type
// and the rating code behind the three plain-words ratings.
export const APPLICATION_TYPE_TO_CONTENT = { short: 'short', film: 'movie', series: 'series', podcast: 'podcast', vertical: 'vertical' };
export const APPLICATION_RATING_CODES = { 'All ages': 'TV-G', 'TV-14': 'TV-14', 'TV-MA / R': 'TV-MA' };

// Where an application stands, in the applicant's words (the status card
// on /apply, the app's screen, Your work). `held` = one thing to fix.
export const APPLICATION_STATUS_LABEL = {
  new: 'Under review',
  reviewing: 'Under review',
  held: 'One thing to fix',
  accepted: 'You’re in',
  declined: 'Not this time'
};

export function isOpenApplicationStatus(status) {
  return status === 'new' || status === 'reviewing' || status === 'held';
}

// "14:06" / "1:02:15" from seconds; null when unknown.
export function runtimeClock(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// "1.2 GB" / "340 MB" for the status card.
export function bytesLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return null;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / (1024 * 1024)))} MB`;
}

// What the applicant reads about the upload on the status card.
export function videoStateLine(video) {
  if (!video) return null;
  const size = bytesLabel(video.bytes);
  const clock = runtimeClock(video.runtimeSeconds);
  const facts = [size, clock].filter(Boolean).join(', ');
  if (video.state === 'uploading') return 'The master is still uploading. Keep this tab open, or pick the same file again to resume.';
  if (video.state === 'processing') return `The master is in${facts ? ` (${facts})` : ''}. Cloudflare is processing it.`;
  if (video.state === 'ready') return `The master is in${facts ? ` (${facts})` : ''}.`;
  if (video.state === 'error') return 'Cloudflare couldn’t process the master. Replace the file, or email us.';
  if (video.state === 'deleted') return 'The file is deleted from our side.';
  return null;
}

// Keeps only known question ids with a yes/no answer.
export function normalizeRightsAnswers(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const q of RIGHTS_QUESTIONS) {
    if (input[q.id] === 'yes' || input[q.id] === 'no') out[q.id] = input[q.id];
  }
  return out;
}

// { result: 'incomplete' | 'blocked' | 'held' | 'clear', answered, holds, complete }
export function rightsVerdict(answers) {
  const a = normalizeRightsAnswers(answers);
  const answered = RIGHTS_QUESTIONS.filter((q) => a[q.id]).length;
  const blocked = RIGHTS_QUESTIONS.some((q) => q.block && a[q.id] === 'no');
  const holds = RIGHTS_QUESTIONS.filter((q) => !q.block && a[q.id] === 'no').map((q) => q.hold);
  let result;
  if (blocked) result = 'blocked';
  else if (answered < RIGHTS_QUESTIONS.length) result = 'incomplete';
  else if (holds.length) result = 'held';
  else result = 'clear';
  return { result, answered, holds, complete: answered === RIGHTS_QUESTIONS.length };
}

// The card beside the questions. `level` picks the colour.
export function rightsVerdictCopy(verdict) {
  const { result, answered } = verdict;
  if (answered === 0) return { level: 'neutral', tag: 'Not started', title: 'Answer the five questions', body: 'Your answers stay on this page. Nothing is sent until you apply.' };
  if (result === 'blocked') return { level: 'bad', tag: 'Can’t accept', title: 'We can’t take this one', body: 'Only the rights holder can submit a film. If that’s a collaborator, ask them to apply, or apply together.' };
  if (result === 'held') return { level: 'warn', tag: 'Will be held in review', title: 'You can apply, but it won’t go live yet', body: 'Your film would sit in review until we have the paperwork below. Send it with the application and it clears faster.' };
  if (result === 'incomplete') return { level: 'neutral', tag: 'Looking good', title: `${answered} of ${RIGHTS_QUESTIONS.length} answered`, body: 'Keep going.' };
  return { level: 'ok', tag: 'Clear to submit', title: 'Nothing here would hold it', body: 'Rights look clean. Review then comes down to picture, sound and fit.' };
}
