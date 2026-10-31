// Mirrors lib/submitRules.js on the website: Creator Studio's three-step
// submit, the client-safe part. Change both together.

export const SUBMIT_TYPES = [
  { value: 'movie', label: 'Film', noun: 'film' },
  { value: 'short', label: 'Short', noun: 'short' },
  { value: 'series', label: 'Series episode', noun: 'episode' },
  { value: 'podcast', label: 'Podcast', noun: 'episode' },
  { value: 'vertical', label: 'Snippet', noun: 'Snippet' },
  { value: 'bonus', label: 'Bonus content', noun: 'clip' }
];

export const MAIN_GENRES = ['Comedy', 'Drama', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];

export const STEPS = [
  { n: 1, key: 'file', title: 'The file' },
  { n: 2, key: 'about', title: 'About it' },
  { n: 3, key: 'artwork', title: 'Artwork' }
];

export const EMPTY_SUBMIT_FORM = {
  contentType: 'movie',
  title: '',
  description: '',
  artist: '',
  seriesId: '',
  newSeriesName: '',
  newSeriesDescription: '',
  season: '1',
  seriesOrder: '',
  mainGenre: MAIN_GENRES[1],
  genre: '',
  rating: '',
  releaseYear: '',
  runtime: '',
  tier: 'free',
  adBreaksText: '0:00',
  adsEnabled: true,
  channelOptIn: false,
  featured: false,
  isOriginal: false,
  fundingUrl: '',
  cutArtwork: true,
  step: 1
};

export function typeNeedsShow(contentType) {
  return contentType === 'series' || contentType === 'podcast' || contentType === 'bonus';
}

export function typeIsNumbered(contentType) {
  return contentType === 'series' || contentType === 'podcast';
}

export function showNoun(contentType) {
  return contentType === 'podcast' ? 'show' : 'series';
}

export function stepBlocker(step, form, media = {}) {
  const f = form || {};
  if (step === 1) {
    if (!media.video && !media.audioUrl) return f.contentType === 'podcast' ? 'Pick the episode, or paste a link to the video or the MP3.' : 'Pick the master, or paste a link to it.';
    return null;
  }
  if (step === 2) {
    if (!String(f.title || '').trim()) return 'Give it a title.';
    if (!String(f.description || '').trim()) return 'A few lines about it.';
    if (!String(f.artist || '').trim()) return 'Your name, as credited.';
    if (typeNeedsShow(f.contentType) && !f.seriesId && !String(f.newSeriesName || '').trim()) return `Pick the ${showNoun(f.contentType)}, or name a new one.`;
    if (typeIsNumbered(f.contentType) && !(Number(f.seriesOrder) > 0)) return 'Which episode number is this?';
    if (!String(f.runtime || '').trim()) return 'The runtime, as MM:SS.';
    return null;
  }
  return null;
}

// "0:00, 10:00" → [0, 600]; the website's lib/adBreaks.js rule.
export function parseAdBreaks(text) {
  if (!text || !text.trim()) return [0];
  const out = [];
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+):([0-5]?\d)$/.exec(part);
    if (m) out.push(Number(m[1]) * 60 + Number(m[2]));
    else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  const uniq = [...new Set(out)].sort((a, b) => a - b);
  return uniq.length ? uniq : [0];
}

export function toSubmitBody(form, media, extras = {}) {
  const f = form || {};
  const numbered = typeIsNumbered(f.contentType);
  return {
    contentType: f.contentType,
    title: String(f.title || '').trim(),
    description: String(f.description || '').trim(),
    artist: String(f.artist || '').trim(),
    ...(typeNeedsShow(f.contentType) && f.seriesId && !String(f.newSeriesName || '').trim() ? { seriesId: f.seriesId } : {}),
    ...(numbered && String(f.newSeriesName || '').trim() ? { newSeriesName: String(f.newSeriesName).trim(), newSeriesDescription: String(f.newSeriesDescription || '').trim() } : {}),
    ...(numbered ? { season: Number(f.season) || 1, seriesOrder: Number(f.seriesOrder) || 1 } : {}),
    mainGenre: f.mainGenre,
    genre: String(f.genre || '').trim() || f.mainGenre,
    rating: f.rating || '',
    releaseYear: f.releaseYear || '',
    runtime: String(f.runtime || '').trim(),
    tier: f.tier === 'premium' ? 'premium' : 'free',
    adsEnabled: f.adsEnabled !== false,
    adBreakSeconds: f.adsEnabled !== false ? parseAdBreaks(f.adBreaksText) : [0],
    channelOptIn: f.channelOptIn === true,
    featured: f.featured === true,
    isOriginal: f.isOriginal === true,
    fundingUrl: String(f.fundingUrl || '').trim(),
    ...(media && media.video ? { videoUid: media.video.uid, runtimeSeconds: media.video.runtimeSeconds || undefined } : {}),
    ...(media && media.trailer ? { trailerUid: media.trailer.uid } : {}),
    ...(media && media.audioUrl ? { audioUrl: media.audioUrl, audioBytes: media.audioBytes || null } : {}),
    ...extras
  };
}

/* ---- shared words (lib/creatorRights.js on the website) ---- */

export const APPLICATION_STATUS_LABEL = { new: 'Under review', reviewing: 'Under review', held: 'One thing to fix', accepted: 'You’re in', declined: 'Not this time' };

export function runtimeClock(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// "05:30" / "1:02:15": the runtime string an episode stores.
export function formatRuntime(seconds) {
  const s = Math.round(Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function bytesLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return null;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / (1024 * 1024)))} MB`;
}

export function videoStateLine(video) {
  if (!video) return null;
  const facts = [bytesLabel(video.bytes), runtimeClock(video.runtimeSeconds)].filter(Boolean).join(', ');
  if (video.state === 'uploading') return 'The master is still uploading. Keep the app open, or pick the same file again to resume.';
  if (video.state === 'processing') return `The master is in${facts ? ` (${facts})` : ''}. Cloudflare is processing it.`;
  if (video.state === 'ready') return `The master is in${facts ? ` (${facts})` : ''}.`;
  if (video.state === 'error') return 'Cloudflare couldn’t process the master. Replace the file, or email us.';
  if (video.state === 'deleted') return 'The file is deleted from our side.';
  return null;
}
