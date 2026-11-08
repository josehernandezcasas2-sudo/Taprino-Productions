// The rig's catalogue: text slug ids like the real ones (never uuids),
// real column names from the migration chain, and every state the show
// pages care about. seed.mjs writes it; the fake Cloudflare preloads the
// videos it names, ready and demanding signed links.
import crypto from 'node:crypto';

export const IDS = {
  film: 'the-long-quiet-lx3k9a',
  short: 'kitchen-hours-m1q8zt',
  nightBus: 'night-bus-lx3k9a',
  nbS1E1: 'night-bus-first-stop-lx3k9b',
  nbS1E2: 'night-bus-the-transfer-lx3k9c',
  nbS1E3: 'night-bus-last-stop-lx3k9d',
  nbS2E1: 'night-bus-new-route-lx3k9e',
  nbExtraShow: 'night-bus-making-of-lx3k9f',
  nbExtraAfterS1E3: 'night-bus-deleted-scene-lx3k9g',
  harbor: 'harbor-lights-p7w2qa',
  harborE1: 'harbor-lights-pilot-p7w2qb',
  lineCooks: 'line-cooks-d4r8vn',
  lineCooksE1: 'line-cooks-opening-shift-d4r8vp',
  podcast: 'tapa-talk-c2x9mm',
  podE1: 'tapa-talk-pilot-c2x9mn',
  podE2: 'tapa-talk-on-funding-c2x9mp'
};

export const USERS = { admin: 'user_rigAdmin', mara: 'user_rigMara', dee: 'user_rigDee', viewer: 'user_rigViewer', sub: 'user_rigSub' };

// A Cloudflare-shaped uid (32 hex) per title, stable across seeds.
export const uidFor = (key) => crypto.createHash('md5').update(`rig-video:${key}`).digest('hex');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

// Pictures the seed draws and stores in the public episode-art bucket.
export function artFor(id) {
  return {
    poster: { bucket: 'episode-art', key: `rig/${id}-poster.jpg`, width: 600, height: 900 },
    thumbnail: { bucket: 'episode-art', key: `rig/${id}-thumb.jpg`, width: 1280, height: 720 },
    hero: { bucket: 'episode-art', key: `rig/${id}-hero.jpg`, width: 1920, height: 1080 }
  };
}

export function videos() {
  const list = [
    [IDS.film, 'the-long-quiet.mp4', USERS.mara, 5520],
    [`${IDS.film}:trailer`, 'the-long-quiet-trailer.mp4', USERS.mara, 95],
    [IDS.short, 'kitchen-hours.mp4', USERS.dee, 840],
    [IDS.nbS1E1, 'night-bus-101.mp4', USERS.mara, 1340],
    [IDS.nbS1E2, 'night-bus-102.mp4', USERS.mara, 1385],
    [IDS.nbS1E3, 'night-bus-103.mp4', USERS.mara, 1412],
    [IDS.nbS2E1, 'night-bus-201.mp4', USERS.mara, 1450],
    [`${IDS.nightBus}:trailer`, 'night-bus-trailer.mp4', USERS.mara, 80],
    [IDS.nbExtraShow, 'night-bus-making-of.mp4', USERS.mara, 600],
    [IDS.nbExtraAfterS1E3, 'night-bus-deleted-scene.mp4', USERS.mara, 190],
    [IDS.harborE1, 'harbor-lights-pilot.mp4', USERS.mara, 1500],
    [IDS.lineCooksE1, 'line-cooks-101.mp4', USERS.dee, 1260],
    [IDS.podE1, 'tapa-talk-1.mp4', USERS.dee, 1800],
    [IDS.podE2, 'tapa-talk-2.mp4', USERS.dee, 2100]
  ];
  return list.map(([key, name, creator, duration]) => ({ uid: uidFor(key), key, name, creator, duration }));
}

// The rows. `base` is the app's SUPABASE_URL, `code` its Cloudflare
// customer code: stored addresses are the shapes the app itself writes.
export function catalogue({ base, code = 'test' }) {
  const pub = (bucket, key) => `${base}/storage/v1/object/public/${bucket}/${key}`;
  const art = (id) => {
    const a = artFor(id);
    return { poster: pub(a.poster.bucket, a.poster.key), thumbnail: pub(a.thumbnail.bucket, a.thumbnail.key), hero_image: pub(a.hero.bucket, a.hero.key) };
  };
  const src = (key) => `https://customer-${code}.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
  const approved = (who, days) => ({ status: 'approved', submitted_by: who, reviewed_by: USERS.admin, reviewed_at: ago(days), released_at: ago(days), created_at: ago(days + 2) });

  const series = [
    {
      id: IDS.nightBus,
      name: 'Night Bus',
      description: 'A driver on the last route of the night and the passengers who ride it to the end of the line.',
      ...art(IDS.nightBus),
      trailer_src: src(`${IDS.nightBus}:trailer`),
      creator_id: USERS.mara,
      release_year: 2026,
      status: 'approved',
      submitted_by: 'mara@rig.example.com',
      submitted_by_user_id: USERS.mara,
      reviewed_by: 'admin@rig.example.com',
      reviewed_by_user_id: USERS.admin,
      reviewed_at: ago(40),
      public_at: ago(40),
      created_at: ago(45),
      kind: 'series',
      defaults: { genre: 'Drama', mainGenre: 'Drama', rating: 'TV-14', artist: 'Mara Reyes' },
      seasons: [{ number: 1, name: 'The Late Line' }, { number: 2, name: 'New Routes' }],
      credits: {}
    },
    {
      id: IDS.harbor,
      name: 'Harbor Lights',
      description: 'A fishing town, a lighthouse keeper and the summer nobody talks about.',
      ...art(IDS.harbor),
      creator_id: USERS.mara,
      release_year: 2026,
      status: 'pending',
      submitted_by: 'mara@rig.example.com',
      submitted_by_user_id: USERS.mara,
      created_at: ago(12),
      kind: 'series',
      defaults: { genre: 'Mystery', mainGenre: 'Drama', rating: 'TV-PG' },
      seasons: [],
      credits: {}
    },
    {
      id: IDS.lineCooks,
      name: 'Line Cooks',
      description: 'One restaurant kitchen, one service, every night.',
      ...art(IDS.lineCooks),
      creator_id: USERS.dee,
      release_year: 2026,
      status: 'pending',
      submitted_by: 'dee@rig.example.com',
      submitted_by_user_id: USERS.dee,
      created_at: ago(5),
      kind: 'series',
      defaults: { genre: 'Documentary', mainGenre: 'Documentary', rating: 'TV-PG' },
      seasons: [],
      credits: {}
    },
    {
      id: IDS.podcast,
      name: 'Tapa Talk',
      description: 'Independent filmmakers on making and funding their work.',
      ...art(IDS.podcast),
      creator_id: USERS.dee,
      release_year: 2026,
      status: 'approved',
      submitted_by: 'dee@rig.example.com',
      submitted_by_user_id: USERS.dee,
      reviewed_by: 'admin@rig.example.com',
      reviewed_by_user_id: USERS.admin,
      reviewed_at: ago(30),
      public_at: ago(30),
      created_at: ago(32),
      kind: 'podcast',
      defaults: { genre: 'Talk', mainGenre: 'Podcast' },
      seasons: [],
      credits: {}
    }
  ];

  const common = { video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, ad_break_seconds: [0], featured: false, deletion_requested: false, moderation_hold: false, credits: {} };
  const ep = (row) => ({ ...common, ...row });

  const episodes = [
    ep({
      id: IDS.film, title: 'The Long Quiet', description: 'Two sisters drive the length of the coast to scatter their father’s ashes and find they disagree about where.',
      tier: 'free', genre: 'Road Movie', main_genre: 'Drama', content_type: 'movie', artist: 'Mara Reyes', runtime: '1:32:00', rating: 'PG-13', release_year: 2025,
      src: src(IDS.film), trailer_src: src(`${IDS.film}:trailer`), ...art(IDS.film), featured: true, is_original: true, has_page: true,
      ...approved(USERS.mara, 60)
    }),
    ep({
      id: IDS.short, title: 'Kitchen Hours', description: 'A night in the life of a dish pit.',
      tier: 'premium', genre: 'Short Documentary', main_genre: 'Documentary', content_type: 'short', artist: 'Dee Park', runtime: '14:00', rating: 'TV-PG', release_year: 2026,
      src: src(IDS.short), ...art(IDS.short),
      ...approved(USERS.dee, 20)
    }),
    ep({
      id: IDS.nbS1E1, title: 'First Stop', description: 'Lou takes the last route for the first time.',
      tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'series', series_id: IDS.nightBus, season: 1, series_order: 1, artist: 'Mara Reyes', runtime: '22:20', rating: 'TV-14', release_year: 2026,
      src: src(IDS.nbS1E1), ...art(IDS.nbS1E1),
      ...approved(USERS.mara, 40)
    }),
    ep({
      id: IDS.nbS1E2, title: 'The Transfer', description: 'A passenger who never gets off.',
      tier: 'premium', genre: 'Drama', main_genre: 'Drama', content_type: 'series', series_id: IDS.nightBus, season: 1, series_order: 2, artist: 'Mara Reyes', runtime: '23:05', rating: 'TV-14', release_year: 2026,
      src: src(IDS.nbS1E2), ...art(IDS.nbS1E2), has_page: true, page_notes: 'We shot the whole episode in one night on a real route.',
      ...approved(USERS.mara, 33)
    }),
    ep({
      id: IDS.nbS1E3, title: 'Last Stop', description: 'The end of the line, and what is waiting there.',
      tier: 'premium', genre: 'Drama', main_genre: 'Drama', content_type: 'series', series_id: IDS.nightBus, season: 1, series_order: 3, artist: 'Mara Reyes', runtime: '23:32', rating: 'TV-14', release_year: 2026,
      src: src(IDS.nbS1E3), ...art(IDS.nbS1E3),
      ...approved(USERS.mara, 26)
    }),
    ep({
      id: IDS.nbS2E1, title: 'New Route', description: 'Lou is moved to days and hates it.',
      tier: 'premium', genre: 'Drama', main_genre: 'Drama', content_type: 'series', series_id: IDS.nightBus, season: 2, series_order: 1, artist: 'Mara Reyes', runtime: '24:10', rating: 'TV-14', release_year: 2026,
      src: src(IDS.nbS2E1), ...art(IDS.nbS2E1),
      ...approved(USERS.mara, 6)
    }),
    ep({
      id: IDS.nbExtraShow, title: 'Making Night Bus', description: 'How a crew of six shot a series on a moving bus.',
      tier: 'free', genre: 'Behind the Scenes', main_genre: 'Drama', content_type: 'bonus', bonus_parent_type: 'series', bonus_parent_id: IDS.nightBus, artist: 'Mara Reyes', runtime: '10:00', rating: 'TV-PG', release_year: 2026,
      src: src(IDS.nbExtraShow), ...art(IDS.nbExtraShow),
      ...approved(USERS.mara, 30)
    }),
    ep({
      id: IDS.nbExtraAfterS1E3, title: 'Deleted Scene: The Depot', description: 'The scene that would have opened Last Stop.',
      tier: 'free', genre: 'Deleted Scene', main_genre: 'Drama', content_type: 'bonus', bonus_parent_type: 'episode', bonus_parent_id: IDS.nbS1E3, artist: 'Mara Reyes', runtime: '3:10', rating: 'TV-14', release_year: 2026,
      src: src(IDS.nbExtraAfterS1E3), ...art(IDS.nbExtraAfterS1E3),
      ...approved(USERS.mara, 25)
    }),
    ep({
      id: IDS.harborE1, title: 'Pilot', description: 'The keeper finds a boat that should not be there.',
      tier: 'free', genre: 'Mystery', main_genre: 'Drama', content_type: 'series', series_id: IDS.harbor, season: 1, series_order: 1, artist: 'Mara Reyes', runtime: '25:00', rating: 'TV-PG', release_year: 2026,
      src: src(IDS.harborE1), ...art(IDS.harborE1),
      ...approved(USERS.mara, 3)
    }),
    ep({
      id: IDS.lineCooksE1, title: 'Opening Shift', description: 'Prep starts at six.',
      tier: 'free', genre: 'Documentary', main_genre: 'Documentary', content_type: 'series', series_id: IDS.lineCooks, season: 1, series_order: 1, artist: 'Dee Park', runtime: '21:00', rating: 'TV-PG', release_year: 2026,
      src: src(IDS.lineCooksE1), ...art(IDS.lineCooksE1),
      status: 'pending', submitted_by: USERS.dee, created_at: ago(2)
    }),
    ep({
      id: IDS.podE1, title: 'Pilot: Why Tapa Talk', description: 'Dee on why indie filmmakers need a room of their own.',
      tier: 'free', genre: 'Talk', main_genre: 'Podcast', content_type: 'podcast', series_id: IDS.podcast, season: 1, series_order: 1, artist: 'Dee Park', runtime: '30:00', release_year: 2026,
      src: src(IDS.podE1), ...art(IDS.podE1),
      ...approved(USERS.dee, 28)
    }),
    ep({
      id: IDS.podE2, title: 'On Funding', description: 'Pitch rooms, grants and the money nobody mentions.',
      tier: 'free', genre: 'Talk', main_genre: 'Podcast', content_type: 'podcast', series_id: IDS.podcast, season: 1, series_order: 2, artist: 'Dee Park', runtime: '35:00', release_year: 2026,
      src: src(IDS.podE2), ...art(IDS.podE2),
      ...approved(USERS.dee, 14)
    })
  ];

  // Every picture the rows above point at.
  const pictures = [];
  for (const row of [...series, ...episodes]) {
    const a = artFor(row.id);
    const title = row.name || row.title;
    pictures.push({ ...a.poster, title }, { ...a.thumbnail, title }, { ...a.hero, title });
  }

  // Mara can be paid (her Stripe Express account is ready in the fake
  // Stripe), so the Tip button, Buy cards and Money page have something
  // to show; Night Bus is for sale as a whole series.
  const payoutAccounts = [
    { user_id: USERS.mara, stripe_account_id: 'acct_rigMara', details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements_due: [] }
  ];
  const prices = [
    { target_type: 'series', target_id: IDS.nightBus, creator_id: USERS.mara, price_cents: 999, status: 'on', requested_at: ago(20), reviewed_by: USERS.admin, reviewed_at: ago(19) },
    { target_type: 'episode', target_id: IDS.nbS1E3, creator_id: USERS.mara, price_cents: 199, status: 'on', requested_at: ago(20), reviewed_by: USERS.admin, reviewed_at: ago(19) }
  ];

  return { series, episodes, pictures, payoutAccounts, prices };
}
