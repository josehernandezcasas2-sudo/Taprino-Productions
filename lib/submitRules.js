// Creator Studio's three-step submit (2026-10-31), the client-safe part:
// the types, the steps, what each step needs before the next, and the
// draft shape. pages/creator/submit.js and the app's submit screen
// (mobile/src/lib/submitRules.js mirrors it) read from here; the server
// route (pages/api/creator/submit-episode.js) is the one that enforces.

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
  { n: 1, key: 'file', title: 'The file', short: 'The file' },
  { n: 2, key: 'about', title: 'About it', short: 'About it' },
  { n: 3, key: 'artwork', title: 'Artwork', short: 'Artwork & options' }
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
  captionsLanguage: 'en',
  captionsLabel: 'English',
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

// What's in the way of leaving a step, in the order to fix it; null when
// the step is complete. `media` = { video, audioUrl }.
export function stepBlocker(step, form, media = {}) {
  const f = form || {};
  if (step === 1) {
    if (!media.video && !media.audioUrl) return f.contentType === 'podcast' ? 'Drop the episode in, or paste a link to the video or the MP3.' : 'Drop the master in, or paste a link to it.';
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

export function stepComplete(step, form, media) {
  return stepBlocker(step, form, media) === null;
}

// The form as the server wants it.
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
