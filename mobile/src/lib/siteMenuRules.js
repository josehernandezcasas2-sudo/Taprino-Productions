// The ☰ menu (Jose, 2026-11-18: "make something like how Facebook or
// Threads opens up to reveal more info … we do B and we move what is
// missing to there"; signed off on the canvas
// https://claude.ai/artifact/RFSJUdzGefwe1v11cCJA6M). The ☰ opens one menu
// that holds the whole site: you (photo, profile, plan), a Connect / Stream
// switch, tiles for the places on that side with one line each, "See more",
// sections that open in place (Your things, Creator, Team, Settings &
// account, Help & legal) and Log out. With option B the photo left the
// header for the Account tab, so everything its menu held lives here, on
// every page the header is on — admin, the submit steps and show pages
// included, where there is no bottom bar.
//
// Pure, no imports: the app's mobile/src/lib/siteMenuRules.js is this file
// word for word (node scripts/test-site-menu.mjs). Every tile, row, label
// and line the menu shows is built here; the website (components/SiteMenu.js)
// and the app (mobile/src/components/SiteMenu.js) only draw it. Hrefs are
// the website's paths; the app turns them into screens with hrefToRoute.

// The live line on a tile ("3 urgent · 12 open") comes from
// /api/menu-counts, read when the menu opens. Off, every tile shows its
// plain line and nothing is read (Jose decides; 2026-11-18).
export const MENU_LIVE_LINES = true;
// How many tiles show before "See more".
export const MENU_TILES_SHOWN = 6;
// The counts are read again at most this often while the page stays open.
export const MENU_COUNTS_MAX_AGE_MS = 2 * 60 * 1000;

export const MENU_WORDS = {
  title: 'Menu',
  open: 'Open the menu',
  close: 'Close the menu',
  search: 'Search',
  seeMore: 'See more',
  seeLess: 'See less',
  seeProfile: 'See your profile',
  setUpProfile: 'Set up your profile',
  yourAccount: 'Your account',
  member: 'Tapa + member',
  free: 'Free account',
  join: 'Join Tapa +',
  signedOutTitle: 'Pin yourself to the board',
  signedOutLine: 'Save titles, answer calls, back projects.',
  signIn: 'Sign in',
  createAccount: 'Create account',
  applyTitle: 'Make films?',
  applyLine: 'Apply with the film itself',
  logout: 'Log out',
  genres: 'Browse by genre',
  connect: 'Connect',
  stream: 'Stream',
  connectHome: 'Go to the Notice Board',
  streamHome: 'Go to Stream home',
  sides: 'Which half of the site'
};

export function menuSide(inStream) {
  return inStream ? 'stream' : 'connect';
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// A switch an admin turns off hides its tile; while the settings are still
// loading (null) the switched tiles stay hidden, as the header's links do
// (fail closed: a tile may appear a moment late, never vanish).
function on(settings, key) {
  return Boolean(settings) && settings[key] !== false;
}

function crewLine(counts) {
  const open = num(counts.openCalls);
  const urgent = num(counts.urgent);
  if (urgent && open) return `${urgent} urgent · ${open} open`;
  if (open) return plural(open, 'open call', 'open calls');
  return null;
}

function placesLine(counts) {
  const fresh = num(counts.newPlaces);
  if (fresh) return `${fresh} new this week`;
  const places = num(counts.places);
  return places ? plural(places, 'place to shoot', 'places to shoot') : null;
}

// Every tile the side can show, in order: the first MENU_TILES_SHOWN are
// the grid, the rest come out under "See more". `line` is the live line
// when there is one, else the plain one; `dot` marks something happening
// now (an urgent call, a broadcast on air).
export function menuTiles(side, { signedIn = false, settings = null, counts = null, liveLines = MENU_LIVE_LINES } = {}) {
  const c = liveLines && counts ? counts : {};
  const tile = (id, href, label, plain, live = null, extra = {}) => ({ id, href, label, line: live || plain, live: Boolean(live), dot: false, external: false, ...extra });
  const liveNow = c.liveNow && typeof c.liveNow.title === 'string' && c.liveNow.title.trim() ? c.liveNow.title.trim() : null;
  const live = on(settings, 'liveTvEnabled')
    ? tile('live', '/live', 'Live TV', 'Channels, all day', liveNow ? `On now: ${liveNow}` : null, { dot: Boolean(liveNow) })
    : null;
  const shop = settings && settings.shopEnabled && settings.shopUrl
    ? tile('shop', settings.shopUrl, 'Shop', 'The Studio Tapa shop', null, { external: true })
    : null;
  const myList = tile('my-list', '/wishlist', 'My List', 'Saved for later');
  if (side === 'stream') {
    return [
      tile('series', '/type/series', 'Series', 'Shows, season by season'),
      tile('films', '/type/movie', 'Films', 'Feature films'),
      on(settings, 'podcastsEnabled') ? tile('podcasts', '/podcasts', 'Podcasts', 'Ad-free shows') : null,
      live,
      myList,
      signedIn ? tile('my-recs', '/recs', 'My Recs', 'Picked for you') : null,
      signedIn ? tile('continue', '/stream#continue-watching', 'Continue watching', 'Pick up where you left off') : null,
      on(settings, 'verticalEnabled') ? tile('vertical', '/type/vertical', 'Vertical', 'Made for your phone') : null,
      settings && settings.downloadsEnabled ? tile('downloads', '/downloads', 'Downloads', 'Watch offline in the app') : null,
      shop
    ].filter(Boolean);
  }
  const raising = num(c.raising);
  const shooting = num(c.shooting);
  return [
    tile('crew', '/crew', 'Crew Call', 'Find crew, post calls', crewLine(c), { dot: num(c.urgent) > 0 }),
    settings && settings.elevatorPitchEnabled
      ? tile('pitch-room', '/pitches', 'Pitch Room', 'Back new projects', raising ? `${raising} raising now` : null)
      : null,
    tile('locations', '/locations', 'Locations', 'Places to shoot', placesLine(c)),
    tile('productions', '/productions', 'Productions', 'Plan and run shoots', shooting ? `${shooting} shooting now` : null),
    tile('university', '/university', 'University', 'Free film courses'),
    tile('resources', '/resources', 'Resources', 'Deals & paperwork'),
    tile('swipe', '/pitches/discover', 'Swipe ideas', 'Pitches, one by one'),
    on(settings, 'verticalEnabled') ? tile('vertical-discover', '/vertical/discover', 'Vertical Discover', 'Short films, one by one') : null,
    live,
    myList,
    shop
  ].filter(Boolean);
}

export function sideHome(side) {
  return side === 'stream'
    ? { href: '/stream', label: MENU_WORDS.streamHome }
    : { href: '/', label: MENU_WORDS.connectHome };
}

// The rows that open in place. `roles` is what /api/my-role answers (or
// the page's own isAdmin / isCreator): a creator, an admin, a sub-admin
// (canAccessAdmin without isAdmin) and a content scheduler each get their
// own rows, the same people the header's account menu gave them.
export function menuSections({ signedIn = false, roles = {}, isSubscriber = false } = {}) {
  const isAdmin = Boolean(roles.isAdmin);
  const isCreator = Boolean(roles.isCreator);
  const isSubAdmin = !isAdmin && Boolean(roles.canAccessAdmin || roles.isSubAdmin);
  const isScheduler = Boolean(roles.isContentScheduler || roles.isScheduler);
  const section = (id, title, rows) => ({ id, title, rows, summary: rows.map((r) => r.label).join(', ') });
  const out = [];
  if (signedIn) {
    out.push(section('yours', 'Your things', [
      { href: '/crew/card', label: 'My working card' },
      { href: '/locations/mine', label: 'My locations' },
      { href: '/locations/requests', label: 'Location requests' },
      { href: '/productions#mine', label: 'My productions' }
    ]));
    if (isCreator || isAdmin || isSubAdmin) {
      out.push(section('creator', 'Creator', [
        { href: '/creator/dashboard', label: 'Dashboard' },
        ...(isCreator || isAdmin ? [{ href: '/creator/my-work', label: 'Your work' }, { href: '/creator/submit', label: 'Submit your work' }] : []),
        ...(isCreator ? [{ href: '/creator/analytics', label: 'Your numbers' }] : []),
        ...(isCreator || isAdmin ? [{ href: '/creator/money', label: 'Money' }] : [])
      ]));
    }
    if (isAdmin || isSubAdmin || isScheduler) {
      out.push(section('team', 'Team', [
        ...(isAdmin || isSubAdmin ? [{ href: '/admin', label: 'Admin Portal' }] : []),
        ...(isAdmin || isScheduler ? [{ href: '/schedule', label: 'Channel scheduler' }] : [])
      ]));
    }
    out.push(section('account', 'Settings & account', [
      { href: '/account', label: 'Account' },
      { href: '/account/profile', label: 'Profile' },
      { href: '/account/membership', label: isSubscriber ? 'Membership' : MENU_WORDS.join },
      { href: '/account/purchases', label: 'Purchases' },
      { href: '/account/preferences', label: 'Preferences' },
      { href: '/account/security', label: 'Security' }
    ]));
  }
  out.push(section('help', 'Help & legal', [
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/cookies', label: 'Cookies' },
    { href: '/ai-policy', label: 'AI policy' }
  ]));
  return out;
}

// You, at the top. Signed out there is no profile: the menu draws the
// sign-in card instead.
export function menuProfile({ signedIn = false, displayName = null, profileHref = null, isSubscriber = false } = {}) {
  if (!signedIn) return null;
  const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : MENU_WORDS.yourAccount;
  return {
    name,
    href: profileHref || '/account/profile',
    sub: profileHref ? MENU_WORDS.seeProfile : MENU_WORDS.setUpProfile,
    plan: isSubscriber ? MENU_WORDS.member : MENU_WORDS.free,
    join: isSubscriber ? null : { href: '/account/membership', label: MENU_WORDS.join }
  };
}

// "Make films?" for anyone who isn't a creator or an admin yet.
export function menuApply({ roles = {} } = {}) {
  return roles.isCreator || roles.isAdmin ? null : { href: '/apply', title: MENU_WORDS.applyTitle, line: MENU_WORDS.applyLine };
}

// The whole menu in one call.
export function siteMenu({ side = 'connect', signedIn = false, roles = {}, isSubscriber = false, settings = null, counts = null, displayName = null, profileHref = null, liveLines = MENU_LIVE_LINES } = {}) {
  const all = menuTiles(side, { signedIn, settings, counts, liveLines });
  return {
    side,
    home: sideHome(side),
    profile: menuProfile({ signedIn, displayName, profileHref, isSubscriber }),
    tiles: all.slice(0, MENU_TILES_SHOWN),
    more: all.slice(MENU_TILES_SHOWN),
    genres: side === 'stream',
    sections: menuSections({ signedIn, roles, isSubscriber }),
    apply: menuApply({ roles }),
    logout: Boolean(signedIn)
  };
}

// The sections someone opened stay open the next time the menu opens
// (a list of ids; anything else is dropped).
export function keptOpen(value, sections) {
  const ids = new Set((sections || []).map((s) => s.id));
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && ids.has(id)) : [];
}

// Whether the counts in hand are still fresh enough to skip a read.
export function countsFresh(readAt, now = Date.now()) {
  return Number.isFinite(readAt) && now - readAt < MENU_COUNTS_MAX_AGE_MS;
}
