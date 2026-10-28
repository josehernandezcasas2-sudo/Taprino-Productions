import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors, fonts, inkTint, oliveTint, absoluteFill } from '../lib/theme';
import { SearchIcon, AccountIcon, BellIcon, MenuIcon } from './TabBarIcons';
import PositionedImage from './PositionedImage';
import { rememberStayInStream } from '../lib/stayInStream';
import { useNotifications } from '../lib/useUnread';
import { hrefToRoute } from './PushListener';

// The mobile routes that count as the Stream half of the site — the same
// pages lib/streamSection.js's isStreamPath() marks on the website, mapped
// to their app routes (/type/series|movie → /watch/series|movies,
// /podcasts → /watch/podcasts, /vertical/browse → /watch/vertical). Search
// counts too: on the website a search runs inside /stream. Everything else
// (home, pitches, about, account, profiles, genre, collections…) is Connect.
export function isStreamRoute(pathname) {
  return (
    pathname === '/stream' ||
    pathname === '/live' ||
    pathname.startsWith('/live/') ||
    pathname === '/search' ||
    pathname === '/watch/series' ||
    pathname === '/watch/movies' ||
    pathname === '/watch/podcasts' ||
    pathname === '/watch/vertical' ||
    pathname.startsWith('/podcasts/') ||
    pathname.startsWith('/episode/') ||
    pathname.startsWith('/series/')
  );
}

// Site settings are the same for every screen, so fetch them once per app
// session, not per screen. PrivateBetaGate reads the same copy for its
// `privateBeta` flag.
let settingsCache = null;
let settingsPromise = null;
export function loadSettings() {
  if (settingsCache) return Promise.resolve(settingsCache);
  if (!settingsPromise) {
    settingsPromise = apiGet('/api/site-settings')
      .then((s) => { settingsCache = s; return s; })
      .catch(() => { settingsPromise = null; return null; });
  }
  return settingsPromise;
}
// The signed-in viewer's own profile bits the header needs: their site
// photo (user_profiles.avatar_url, set on the Account screen — the same one
// the website's header, profile page, and comments show, never Clerk's
// sign-in-provider image) and the "Here only for the stream?" preference.
let ownProfileCache = null;
const ownProfileListeners = new Set();
// Called by the Account screen after a save so every mounted header picks
// up a new photo / preference immediately instead of on the next launch.
export function updateOwnProfileCache(patch) {
  ownProfileCache = { ...(ownProfileCache || {}), ...patch };
  ownProfileListeners.forEach((fn) => fn(ownProfileCache));
}
// The same cache for anything outside the header (BottomNav's "View
// profile" row). TopNav fills it; this only follows along.
export function useOwnProfile() {
  const [ownProfile, setOwnProfile] = useState(ownProfileCache);
  useEffect(() => {
    ownProfileListeners.add(setOwnProfile);
    return () => { ownProfileListeners.delete(setOwnProfile); };
  }, []);
  return ownProfile;
}
// Public profile route for the signed-in viewer: /profile/<@handle>, or
// the user id until they pick a handle (pages/profile/[userId].js takes
// either). Null until the cache has loaded.
export function ownProfileHref(ownProfile) {
  if (!ownProfile || !ownProfile.userId) return null;
  return `/profile/${ownProfile.handle || ownProfile.userId}`;
}

// The genres the browse menu lists on Stream screens (the website's
// "Browse by genre"): /api/genres, once per app session.
let genresCache = null;
let genresPromise = null;
function loadGenres() {
  if (genresCache) return Promise.resolve(genresCache);
  if (!genresPromise) {
    genresPromise = apiGet('/api/genres')
      .then((d) => { genresCache = Array.isArray(d.genres) ? d.genres : []; return genresCache; })
      .catch(() => { genresPromise = null; return []; });
  }
  return genresPromise;
}

// The branded header on every screen that's a direct bottom-nav
// destination (detail screens keep Expo Router's back-button header).
// It is the website's phone header (components/HeaderNav.js at ≤1180px,
// Jose, 2026-10-28: "match the site's"): the wordmark + CONNECT / STREAM
// kicker, then the round hamburger that opens the browse menu under
// itself (the site's .hamburger-dropdown: Browse by type for whichever
// half of the site this screen is on, My List, My Recs, Live TV, Shop,
// and the genres on Stream screens), and on the right the round search
// button, the bell with its unread count that opens the notifications
// panel (the site's .notification-dropdown, mark read / mark all read,
// a tap opens what the notification points at), and the account photo.
// Both panels live in one transparent Modal placed just under the bar,
// so they sit above every screen and BottomNav the way the website's
// dropdowns do. The brand tap goes home, or straight to Stream for an
// account with "Here only for the stream?" turned on.
export default function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const [settings, setSettings] = useState(settingsCache);
  const [ownProfile, setOwnProfile] = useState(ownProfileCache);
  const [genres, setGenres] = useState(genresCache || []);
  const [panel, setPanel] = useState(null); // 'menu' | 'bell' | null
  const [anchorTop, setAnchorTop] = useState(0);
  const barRef = useRef(null);
  const { notifications, unreadCount, messagesUnread, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((s) => { if (!cancelled && s) setSettings(s); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    ownProfileListeners.add(setOwnProfile);
    return () => { ownProfileListeners.delete(setOwnProfile); };
  }, []);

  useEffect(() => {
    if (!isSignedIn) { ownProfileCache = null; setOwnProfile(null); return undefined; }
    if (ownProfileCache) { setOwnProfile(ownProfileCache); return undefined; }
    let cancelled = false;
    (async () => {
      const token = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      if (!token) return;
      const profile = await apiGet('/api/account/profile', token).catch(() => null);
      if (!cancelled && profile) {
        updateOwnProfileCache({ userId: profile.userId || null, handle: profile.handle || null, avatarUrl: profile.avatarUrl || null, avatarPosition: profile.avatarPosition || null, avatarZoom: profile.avatarZoom || null, stayInStream: !!profile.stayInStream });
        rememberStayInStream(!!profile.stayInStream);
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  // A panel closes when the screen changes (a tap in it navigates).
  useEffect(() => { setPanel(null); }, [pathname]);

  const stream = isStreamRoute(pathname);
  const kicker = stream
    ? (settings && settings.streamLabel) || 'Stream'
    : (settings && settings.connectLabel) || 'Connect';

  // The genres only matter on Stream screens, and only once the menu is
  // asked for.
  useEffect(() => {
    if (panel !== 'menu' || !stream) return undefined;
    let cancelled = false;
    loadGenres().then((g) => { if (!cancelled) setGenres(g); });
    return () => { cancelled = true; };
  }, [panel, stream]);

  const avatarLetter = isSignedIn && user && user.primaryEmailAddress
    ? user.primaryEmailAddress.emailAddress[0].toUpperCase()
    : null;

  function openPanel(which) {
    if (panel === which) { setPanel(null); return; }
    const node = barRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, w, h) => {
        setAnchorTop(y + h + 8);
        setPanel(which);
      });
    } else {
      setPanel(which);
    }
  }

  function go(href) {
    setPanel(null);
    router.push(href);
  }

  function openNotification(n) {
    if (!n.read) markRead(n.id);
    const href = n.href || (n.episodeId ? `/episode/${n.episodeId}` : n.pitchId ? `/pitches/${n.pitchId}` : null);
    const where = hrefToRoute(href);
    setPanel(null);
    if (!where) return;
    if (where.route) router.push(where.route);
    else Linking.openURL(where.url).catch(() => {});
  }

  // The website's typeLinks: the Stream list on Stream screens, the
  // Connect list elsewhere, each entry knowing whether it is the screen
  // we are on. Flags fail closed like the site (nothing until settings
  // have loaded).
  const typeLinks = stream
    ? [
        { href: '/stream', label: 'Home', match: pathname === '/stream' },
        { href: '/watch/series', label: 'Series', match: pathname === '/watch/series' || pathname.startsWith('/series/') },
        { href: '/watch/movies', label: 'Films', match: pathname === '/watch/movies' },
        ...(settings && settings.verticalEnabled !== false ? [{ href: '/watch/vertical', label: 'Vertical', match: pathname === '/watch/vertical' }] : []),
        ...(settings && settings.podcastsEnabled !== false ? [{ href: '/watch/podcasts', label: 'Podcasts', match: pathname === '/watch/podcasts' || pathname.startsWith('/podcasts/') }] : [])
      ]
    : [
        { href: '/', label: 'Home', match: pathname === '/' },
        { href: '/pitches/discover', label: 'Pitch Discover', match: pathname === '/pitches/discover' },
        { href: '/crew', label: 'Crew Call', match: pathname.startsWith('/crew') },
        { href: '/locations', label: 'Locations', match: pathname.startsWith('/locations') },
        { href: '/productions', label: 'Productions', match: pathname.startsWith('/productions') },
        { href: '/resources', label: 'Resources', match: pathname.startsWith('/resources') },
        ...(isSignedIn ? [{ href: '/messages', label: 'Messages', match: pathname.startsWith('/messages'), badge: messagesUnread }] : []),
        ...(settings && settings.verticalEnabled !== false ? [{ href: '/vertical/discover', label: 'Vertical Discover', match: pathname === '/vertical/discover' }] : []),
        ...(settings && settings.elevatorPitchEnabled ? [{ href: '/pitches', label: 'Pitch Room', match: pathname === '/pitches' || /^\/pitches\/(?!discover$)[^/]+$/.test(pathname) }] : []),
        { href: '/university', label: 'University', match: pathname.startsWith('/university') }
      ];
  const extraLinks = [
    { href: '/account/wishlist', label: 'My List', match: pathname === '/account/wishlist' },
    ...(isSignedIn ? [{ href: '/recs', label: 'My Recs', match: pathname === '/recs' }] : []),
    ...(settings && settings.liveTvEnabled !== false ? [{ href: '/live', label: 'Live TV', match: pathname === '/live' || pathname.startsWith('/live/') }] : [])
  ];
  const shopUrl = settings && settings.shopEnabled && settings.shopUrl ? settings.shopUrl : null;
  let currentGenre = null;
  if (pathname.startsWith('/genre/')) {
    try { currentGenre = decodeURIComponent(pathname.slice('/genre/'.length)); } catch (err) { currentGenre = pathname.slice('/genre/'.length); }
  }
  const showGenres = stream && genres.length > 0;

  const menuWidth = Math.min(Math.round(windowWidth * 0.86), 340);
  const bellWidth = Math.min(300, windowWidth - 32);

  return (
    <>
      <View style={styles.bar} ref={barRef} collapsable={false}>
        <Pressable style={styles.brandMark} onPress={() => router.push(ownProfile && ownProfile.stayInStream ? '/stream' : '/')} hitSlop={6}>
          {settings && settings.logoUrl ? (
            <Image source={{ uri: settings.logoUrl }} style={styles.logoImage} resizeMode="contain" />
          ) : null}
          <View style={styles.brandText}>
            <Text style={styles.brandWord} numberOfLines={1}>Studio <Text style={styles.brandStrong}>Tapa</Text></Text>
            <Text style={[styles.kicker, { color: stream ? colors.olive : colors.ok }]} numberOfLines={1}>{kicker}</Text>
          </View>
        </Pressable>
        <CircleButton label="Browse by type and genre" active={panel === 'menu'} onPress={() => openPanel('menu')}>
          <MenuIcon size={17} color={panel === 'menu' ? colors.olive : colors.inkDim} />
        </CircleButton>
        <View style={styles.spacer} />
        <View style={styles.actions}>
          <CircleButton label="Search" onPress={() => router.push('/search')}>
            <SearchIcon size={17} color={colors.inkDim} />
          </CircleButton>
          {isSignedIn ? (
            <CircleButton label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`} active={panel === 'bell'} onPress={() => openPanel('bell')}>
              <BellIcon size={17} color={panel === 'bell' ? colors.olive : colors.inkDim} />
              {unreadCount > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View>
              ) : null}
            </CircleButton>
          ) : null}
          <Pressable style={styles.avatarBtn} onPress={() => router.push('/account')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Account">
            {isSignedIn && ownProfile && ownProfile.avatarUrl ? (
              <PositionedImage uri={ownProfile.avatarUrl} position={ownProfile.avatarPosition} zoom={ownProfile.avatarZoom || 1} style={styles.avatarImg} />
            ) : avatarLetter ? (
              <Text style={styles.avatarText}>{avatarLetter}</Text>
            ) : (
              // Signed out (or Clerk still loading): the same person glyph the
              // tab bar's Account tab uses — a "☺" here came out as an emoji
              // on iOS (Jose, 2026-10-28).
              <AccountIcon size={17} color={colors.onBrass} />
            )}
          </Pressable>
        </View>
      </View>

      <HeaderPanel visible={panel !== null} onClose={() => setPanel(null)} top={anchorTop} side={panel === 'bell' ? 'right' : 'left'} width={panel === 'bell' ? bellWidth : menuWidth}>
        {panel === 'menu' ? (
          <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelInner} keyboardShouldPersistTaps="handled">
            <Text style={styles.panelLabel}>Browse by type</Text>
            {typeLinks.map((l) => <MenuRow key={l.href} label={l.label} badge={l.badge} active={l.match} onPress={() => go(l.href)} />)}
            {extraLinks.map((l) => <MenuRow key={l.href} label={l.label} active={l.match} onPress={() => go(l.href)} />)}
            {shopUrl ? <MenuRow label="Shop" onPress={() => { setPanel(null); Linking.openURL(shopUrl).catch(() => {}); }} /> : null}
            {showGenres ? (
              <>
                <View style={styles.panelDivider} />
                <Text style={styles.panelLabel}>Browse by genre</Text>
                {genres.map((g) => <MenuRow key={g} label={g} active={currentGenre === g} onPress={() => go(`/genre/${encodeURIComponent(g)}`)} />)}
              </>
            ) : null}
          </ScrollView>
        ) : panel === 'bell' ? (
          <View>
            <View style={styles.bellHead}>
              <Text style={styles.panelLabel}>Notifications</Text>
              {unreadCount > 0 ? (
                <Pressable onPress={markAllRead} hitSlop={8} accessibilityRole="button"><Text style={styles.markAll}>Mark all read</Text></Pressable>
              ) : null}
            </View>
            <ScrollView style={styles.bellScroll} keyboardShouldPersistTaps="handled">
              {notifications.length === 0 ? (
                <Text style={styles.bellEmpty}>Nothing yet.</Text>
              ) : notifications.map((n, i) => (
                <Pressable
                  key={n.id}
                  style={({ pressed }) => [styles.noteRow, i > 0 && styles.noteRowBorder, !n.read && styles.noteRowUnread, pressed && styles.rowPressed]}
                  onPress={() => openNotification(n)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.noteMessage, !n.read && styles.noteMessageUnread]}>{n.message}</Text>
                  <Text style={styles.noteTime}>{formatWhen(n.createdAt)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </HeaderPanel>
    </>
  );
}

// The website's .icon-btn: a 32px hairline circle, gold when its menu is
// open.
function CircleButton({ label, active, onPress, children }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.iconBtn, active && styles.iconBtnActive, pressed && styles.iconBtnPressed]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { expanded: !!active }}
    >
      {children}
    </Pressable>
  );
}

function MenuRow({ label, badge, active, onPress }) {
  return (
    <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.rowPressed]} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.menuRowText, active && styles.menuRowActive]}>
        {label}{badge > 0 ? <Text style={styles.menuRowBadge}>{`  ${badge > 9 ? '9+' : badge}`}</Text> : null}
      </Text>
    </Pressable>
  );
}

// One transparent Modal for both panels: a tap anywhere outside closes
// it, the card fades and slides in like the website's dropdowns (and
// BottomNav's drop-up), anchored just under the bar on the side of the
// button that opened it.
function HeaderPanel({ visible, onClose, top, side, width, children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) { anim.setValue(0); return; }
    Animated.timing(anim, { toValue: 1, duration: 140, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View
        style={[
          styles.panel,
          { top, width },
          side === 'right' ? { right: 16 } : { left: 16 },
          { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }
        ]}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleString(); } catch (err) { return d.toISOString().slice(0, 16).replace('T', ' '); }
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 10,
    borderBottomWidth: 1, borderBottomColor: colors.hairline
  },
  // .brand-mark / .nav-logo-image / .brand-text / .brand-word / .brand-kicker
  // at the website's phone sizes (0.92rem / 0.54rem).
  brandMark: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  logoImage: { height: 28, width: 84, maxWidth: 112 },
  brandText: { gap: 2 },
  brandWord: { fontFamily: fonts.display, fontSize: 15, color: colors.ink },
  brandStrong: { fontFamily: fonts.displayBold, color: colors.brass },
  kicker: { fontFamily: fonts.monoMedium, fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase' },
  spacer: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // .icon-btn (32px at ≤640px), .icon-btn.active
  iconBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: inkTint(0.18), alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { borderColor: colors.olive },
  iconBtnPressed: { backgroundColor: inkTint(0.06) },
  // .notification-badge
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 14, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.danger, alignItems: 'center' },
  badgeText: { fontFamily: fonts.mono, fontSize: 9.6, lineHeight: 10, color: colors.ink },
  avatarBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: colors.onBrass, fontSize: 13, fontFamily: fonts.displayBold },
  // .dropdown: the website's panel (void-2 fill, hairline, 8px radius,
  // deep shadow); .hamburger-dropdown is min(86vw, 340px) and scrolls.
  backdrop: { ...absoluteFill },
  panel: {
    position: 'absolute',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: inkTint(0.14), borderRadius: 8,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 34, shadowOffset: { width: 0, height: 16 }, elevation: 16,
    overflow: 'hidden'
  },
  panelScroll: { maxHeight: 420 },
  panelInner: { padding: 8 },
  // .dropdown-label
  panelLabel: { fontFamily: fonts.mono, fontSize: 9.6, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 5 },
  panelDivider: { height: 1, backgroundColor: inkTint(0.1), marginVertical: 6, marginHorizontal: 3 },
  // .dropdown-item, .dropdown-item.active-cat
  menuRow: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 5 },
  rowPressed: { backgroundColor: inkTint(0.06) },
  menuRowText: { fontFamily: fonts.body, fontSize: 13.6, color: colors.ink },
  menuRowActive: { color: colors.olive },
  menuRowBadge: { fontFamily: fonts.mono, fontSize: 11, color: colors.brass },
  // .notification-dropdown (300px, scrolls at 360px), .notification-item
  bellHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingTop: 8, paddingRight: 14 },
  markAll: { fontFamily: fonts.mono, fontSize: 10.9, color: colors.olive },
  bellScroll: { maxHeight: 360 },
  bellEmpty: { fontFamily: fonts.body, fontSize: 13.6, color: colors.ink, paddingHorizontal: 18, paddingVertical: 12 },
  noteRow: { paddingVertical: 10, paddingHorizontal: 14 },
  noteRowBorder: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  noteRowUnread: { backgroundColor: oliveTint(0.06) },
  noteMessage: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink, marginBottom: 3 },
  noteMessageUnread: { fontFamily: fonts.bodyBold },
  noteTime: { fontFamily: fonts.mono, fontSize: 10.4, color: colors.inkDim }
});
