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
// "Running now" (2026-11-19): how many of the productions someone runs the
// card shows; /api/productions/running is read as the menu opens, at most
// this often (countsFresh with the same two minutes).
export const MENU_RUNNING_SHOWN = 2;

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
  sides: 'Which half of the site',
  runningNow: 'Running now',
  runningOpen: 'Open',
  allProductions: 'All your productions',
  production: 'Production',
  productionHome: 'Go to Your productions',
  admin: 'Admin',
  adminHome: 'Go to the Admin home'
};

export function menuSide(inStream) {
  return inStream ? 'stream' : 'connect';
}

// The Production side (Jose, 2026-11-20: "a production tab … where users/
// creators and crew type users can find the pages to their work … goes
// directly to their work instead of their discover page"): a third choice
// beside Connect and Stream for anyone signed in. The menu opens on it from
// one of those pages (the website's paths and the app's own, where they
// differ).
//
// The Admin side (Jose, 2026-11-20: "let's add an admin that admin and sub
// admin users can see"): a fourth choice for a full admin or a sub-admin
// (canAccessAdmin), its tiles the admin pages they can open; the menu
// opens on it from an admin page.
// Production sits in the middle (Jose, 2026-11-21): Connect · Production ·
// Stream, then Admin for the team. Signed out there is no Production side.
export const MENU_SIDES = ['connect', 'production', 'stream', 'admin'];
const ADMIN_PATHS = [/^\/admin(\/|$)/, /^\/schedule(\/|$)/, /^\/ad-plan(\/|$)/];
const seesAdmin = (roles) => Boolean(roles && (roles.isAdmin || roles.canAccessAdmin));
const WORK_PATHS = [
  /^\/productions\/mine(\/|$)/,
  /^\/productions\/[^/]+\/dashboard(\/|$)/,
  /^\/creator(\/|$)/,
  /^\/account\/my-work(\/|$)/,
  /^\/crew\/card(\/|$)/,
  /^\/locations\/mine(\/|$)/,
  /^\/locations\/requests(\/|$)/
];
export function menuSides(signedIn, roles = {}) {
  if (!signedIn) return MENU_SIDES.filter((x) => x === 'connect' || x === 'stream');
  return seesAdmin(roles) ? MENU_SIDES : MENU_SIDES.filter((x) => x !== 'admin');
}
export function menuSideFor({ inStream = false, pathname = '', signedIn = false, roles = {} } = {}) {
  const path = String(pathname || '').split(/[?#]/)[0];
  if (signedIn && seesAdmin(roles) && ADMIN_PATHS.some((re) => re.test(path))) return 'admin';
  if (signedIn && WORK_PATHS.some((re) => re.test(path))) return 'production';
  return menuSide(inStream);
}
export function sideLabel(side) {
  if (side === 'admin') return MENU_WORDS.admin;
  return side === 'stream' ? MENU_WORDS.stream : side === 'production' ? MENU_WORDS.production : MENU_WORDS.connect;
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

// The Production side's tiles: the person's own pages, never a directory.
// Who gets which: the creator pages for a creator or an admin (the
// Dashboard for a sub-admin too, as the bottom bar's tab); everyone signed
// in has their productions, their working card and their places. The order
// follows their account types (lib/accountTypeRules.js; `types` is
// { types, main }), the main first: a creator's titles, a crew member's or
// a performer's working card, a studio's productions and places; then the
// rest in the usual order. `running` is /api/productions/running's answer
// (the live line on Your productions).
const WORK_GROUPS = {
  creator: ['dashboard', 'my-work', 'my-productions', 'my-pitches', 'submit', 'money', 'numbers'],
  crew: ['working-card', 'my-productions'],
  cast: ['working-card', 'my-productions'],
  studio: ['my-productions', 'my-places', 'place-requests']
};
const WORK_ORDER = ['my-productions', 'dashboard', 'my-work', 'working-card', 'my-pitches', 'submit', 'money', 'numbers', 'my-places', 'place-requests'];
function workTiles(tile, { roles = {}, types = null, running = null } = {}) {
  const isAdmin = Boolean(roles.isAdmin);
  const isCreator = Boolean(roles.isCreator);
  const isSubAdmin = !isAdmin && Boolean(roles.canAccessAdmin || roles.isSubAdmin);
  const makes = isCreator || isAdmin;
  const list = types && Array.isArray(types.types) ? types.types.filter((t) => typeof t === 'string' && WORK_GROUPS[t]) : [];
  const main = types && list.includes(types.main) ? types.main : list[0] || null;
  const ordered = main ? [main, ...list.filter((t) => t !== main)] : list;
  const items = running && Array.isArray(running.items) ? running.items.length : 0;
  const total = running ? Math.max(num(running.total), items) : 0;
  const all = {
    'my-productions': tile('my-productions', '/productions/mine', 'Your productions', 'Shoots you run or work on', total ? `${total} running now` : null),
    dashboard: makes || isSubAdmin ? tile('dashboard', '/creator/dashboard', 'Dashboard', 'Titles and earnings') : null,
    'my-work': makes ? tile('my-work', '/creator/my-work', 'Your work', 'Live, in review, drafts') : null,
    'working-card': tile('working-card', '/crew/card', 'Working card', main === 'cast' ? 'Headshots and reel' : 'Your roles and gear'),
    'my-pitches': makes ? tile('my-pitches', '/creator/pitch/dashboard', 'Your pitches', 'Backing and updates') : null,
    submit: makes ? tile('submit', '/creator/submit', 'Submit a title', 'Films, shows, podcasts') : null,
    money: makes ? tile('money', '/creator/money', 'Money', 'What you’ve earned') : null,
    numbers: isCreator ? tile('numbers', '/creator/analytics', 'Your numbers', 'Views and watch time') : null,
    'my-places': tile('my-places', '/locations/mine', 'Your places', 'Listings and payouts'),
    'place-requests': tile('place-requests', '/locations/requests', 'Place requests', 'Bookings, both sides')
  };
  const order = [];
  for (const t of ordered) for (const id of WORK_GROUPS[t]) if (!order.includes(id)) order.push(id);
  for (const id of WORK_ORDER) if (!order.includes(id)) order.push(id);
  return order.map((id) => all[id]).filter(Boolean);
}

// The Admin side's tiles: the admin pages most used, in this order. `caps`
// are the capabilities lib/adminNav.js gives each page (a sub-admin sees a
// tile when they hold any of them; none = full admins only;
// scripts/test-site-menu.mjs checks them against that file). `count` names
// the /api/admin/queue-counts number that is its live line. The Scheduler
// is for a content scheduler too.
const DASHBOARD_CAPS = ['review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags', 'view_all_content', 'manage_applications', 'manage_house_ads', 'manage_live', 'manage_schedule', 'manage_content_lifecycle', 'manage_genre_icons', 'manage_comped_access', 'manage_episodes'];
export const ADMIN_TILES = [
  { id: 'admin-home', href: '/admin', label: 'Admin home', plain: 'Queue, flags and numbers', count: 'review', live: (n) => `${n} to review`, caps: DASHBOARD_CAPS },
  { id: 'admin-review', href: '/admin/review', label: 'Review queue', plain: 'Titles waiting on a decision', count: 'review', live: (n) => `${n} waiting`, caps: ['review_submissions'] },
  { id: 'admin-shows', href: '/admin/shows', label: 'Shows', plain: 'Every show and where it stands', count: 'shows', live: (n) => `${n} waiting`, caps: ['manage_episodes', 'review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags'] },
  { id: 'admin-library', href: '/admin/library', label: 'Library', plain: 'Titles, changes, removals', count: 'library', live: (n) => `${n} waiting`, caps: ['manage_episodes', 'manage_artwork', 'manage_deletions'] },
  { id: 'admin-flags', href: '/admin/content', label: 'Reports & flags', plain: 'What people reported', count: 'flags', live: (n) => `${n} flagged`, caps: ['view_all_content', 'handle_flags'] },
  { id: 'admin-applications', href: '/admin/applications', label: 'Applications', plain: 'People asking to make films', caps: ['manage_applications'] },
  { id: 'admin-accounts', href: '/admin/accounts', label: 'Accounts', plain: 'People and suspensions' },
  { id: 'admin-money', href: '/admin/money', label: 'Studio money', plain: 'What can go to the bank' },
  { id: 'admin-payouts', href: '/admin/creator-money', label: 'Creator payouts', plain: 'Creator Share and the 1st' },
  { id: 'admin-scheduler', href: '/schedule', label: 'Scheduler', plain: 'The channels’ week', caps: ['manage_schedule'], scheduler: true },
  { id: 'admin-crew', href: '/admin/crew', label: 'Crew Call board', plain: 'Calls, jobs and secured pay', caps: ['handle_flags'] },
  { id: 'admin-locations', href: '/admin/locations', label: 'Locations', plain: 'Places and bookings', caps: ['handle_flags'] },
  { id: 'admin-security', href: '/admin/security', label: 'Security', plain: 'The door, two-step, keys' },
  { id: 'admin-settings', href: '/admin/settings', label: 'Settings', plain: 'Switches and numbers' }
];
function adminTiles(tile, { roles = {}, adminCounts = null } = {}) {
  if (!seesAdmin(roles)) return [];
  const isAdmin = Boolean(roles.isAdmin);
  const perms = Array.isArray(roles.permissions) ? roles.permissions : [];
  const scheduler = Boolean(roles.isContentScheduler || roles.isScheduler);
  const c = adminCounts && typeof adminCounts === 'object' ? adminCounts : {};
  return ADMIN_TILES
    .filter((t) => isAdmin || (t.scheduler && scheduler) || (Array.isArray(t.caps) && t.caps.some((cap) => perms.includes(cap))))
    .map((t) => {
      const n = t.count ? num(c[t.count]) : 0;
      return tile(t.id, t.href, t.label, t.plain, n && t.live ? t.live(n) : null, { dot: t.count === 'flags' && n > 0 });
    });
}

// Every tile the side can show, in order: the first MENU_TILES_SHOWN are
// the grid, the rest come out under "See more". `line` is the live line
// when there is one, else the plain one; `dot` marks something happening
// now (an urgent call, a broadcast on air).
export function menuTiles(side, { signedIn = false, settings = null, counts = null, liveLines = MENU_LIVE_LINES, roles = {}, types = null, running = null, adminCounts = null } = {}) {
  const c = liveLines && counts ? counts : {};
  const tile = (id, href, label, plain, live = null, extra = {}) => ({ id, href, label, line: live || plain, live: Boolean(live), dot: false, external: false, ...extra });
  if (side === 'production') return signedIn ? workTiles(tile, { roles, types, running: liveLines ? running : null }) : [];
  if (side === 'admin') return signedIn ? adminTiles(tile, { roles, adminCounts: liveLines ? adminCounts : null }) : [];
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
  if (side === 'admin') return { href: '/admin', label: MENU_WORDS.adminHome };
  if (side === 'production') return { href: '/productions/mine', label: MENU_WORDS.productionHome };
  return side === 'stream'
    ? { href: '/stream', label: MENU_WORDS.streamHome }
    : { href: '/', label: MENU_WORDS.connectHome };
}

// The rows that open in place. `roles` is what /api/my-role answers (or
// the page's own isAdmin / isCreator). "Your things" and "Creator" became
// the Production side's tiles and the Team rows the Admin side's
// (2026-11-20), so they aren't listed twice; a content scheduler who
// isn't on the admin team keeps Team with the Channel scheduler.
export function menuSections({ signedIn = false, roles = {}, isSubscriber = false } = {}) {
  const isScheduler = Boolean(roles.isContentScheduler || roles.isScheduler);
  const section = (id, title, rows) => ({ id, title, rows, summary: rows.map((r) => r.label).join(', ') });
  const out = [];
  if (signedIn) {
    if (isScheduler && !seesAdmin(roles)) {
      out.push(section('team', 'Team', [{ href: '/schedule', label: 'Channel scheduler' }]));
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

// "Running now" above the Connect / Stream switch, on both sides, for
// someone who runs a production still being made (Jose, 2026-11-19: the
// MenuEntry board on https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN).
// `running` is what GET /api/productions/running answers:
// { items: [{ id, title, line, needsYou }], total }. Null when there is
// nothing to show.
const PRODUCTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function menuRunning(running) {
  const items = running && Array.isArray(running.items)
    ? running.items.filter((x) => x && typeof x.id === 'string' && PRODUCTION_ID.test(x.id) && typeof x.title === 'string' && x.title.trim())
    : [];
  if (!items.length) return null;
  const total = Math.max(num(running.total), items.length);
  return {
    title: MENU_WORDS.runningNow,
    count: plural(total, 'production', 'productions'),
    items: items.slice(0, MENU_RUNNING_SHOWN).map((x, i) => {
      const n = num(x.needsYou);
      return {
        id: x.id,
        href: `/productions/${x.id}/dashboard`,
        title: x.title.trim(),
        line: typeof x.line === 'string' ? x.line : '',
        needs: n ? `${n} ${n === 1 ? 'needs' : 'need'} you` : null,
        open: MENU_WORDS.runningOpen,
        primary: i === 0
      };
    }),
    all: { href: '/productions/mine', label: MENU_WORDS.allProductions }
  };
}

// The whole menu in one call.
// `types` is the person's account types ({ types, main }; null when not
// known), which orders the Production side. Signed out there is no
// Production side: a menu asked for it opens on Connect.
// `adminCounts` is /api/admin/queue-counts' answer (the Admin side's live
// lines; read only while that side is open).
export function siteMenu({ side = 'connect', signedIn = false, roles = {}, isSubscriber = false, settings = null, counts = null, displayName = null, profileHref = null, liveLines = MENU_LIVE_LINES, running = null, types = null, adminCounts = null } = {}) {
  const sides = menuSides(signedIn, roles);
  if (!sides.includes(side)) side = 'connect';
  const all = menuTiles(side, { signedIn, settings, counts, liveLines, roles, types, running, adminCounts });
  return {
    side,
    sides: sides.map((id) => ({ id, label: sideLabel(id) })),
    home: sideHome(side),
    profile: menuProfile({ signedIn, displayName, profileHref, isSubscriber }),
    running: signedIn ? menuRunning(running) : null,
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
