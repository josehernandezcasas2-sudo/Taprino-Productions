import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/expo';
import { useAuth } from '../lib/stableAuth';
import { apiGet } from '../lib/api';
import { colors, fonts, inkTint, oliveTint, absoluteFill } from '../lib/theme';
import { panelRoom } from '../lib/menuScroll';
import { SearchIcon, BellIcon, MenuIcon, ChatIcon } from './TabBarIcons';
import { rememberStayInStream } from '../lib/stayInStream';
import { useNotifications } from '../lib/useUnread';
import { hrefToRoute } from './PushListener';
import { GENERAL_SIGN_IN } from './dashboard/useSignInLanding';
import { MENU_WORDS, menuSideFor } from '../lib/siteMenuRules';
import SiteMenu, { forgetMenuMembership } from './SiteMenu';
import { useAdminRole } from '../lib/adminRole';

// The mobile routes that count as the Stream half of the site — the same
// pages lib/streamSection.js's isStreamPath() marks on the website, mapped
// to their app routes (/type/series|movie → /watch/series|movies,
// /podcasts → /watch/podcasts, /vertical/browse → /watch/vertical,
// /wishlist → /account/wishlist). Search counts too: on the website a
// search runs inside /stream. Everything else (home, pitches, about,
// account, profiles, University…) is Connect.
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
    pathname.startsWith('/series/') ||
    pathname.startsWith('/genre/') ||
    pathname.startsWith('/collection/') ||
    // Lists of titles (the website's /wishlist and /recs, Stream since
    // 2026-10-28).
    pathname === '/account/wishlist' ||
    pathname === '/recs' ||
    // Downloads and a downloaded title playing (2026-11-14).
    pathname === '/downloads' ||
    pathname.startsWith('/downloads/')
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
// sign-in-provider image), their name for the ☰ menu's card, and the "Here
// only for the stream?" preference.
let ownProfileCache = null;
const ownProfileListeners = new Set();
// Called by the Account screen after a save so every mounted header picks
// up a new photo / preference immediately instead of on the next launch.
export function updateOwnProfileCache(patch) {
  ownProfileCache = { ...(ownProfileCache || {}), ...patch };
  ownProfileListeners.forEach((fn) => fn(ownProfileCache));
}
// Signed out: every follower (the bottom bar's Account photo too) forgets
// the person at once.
function clearOwnProfileCache() {
  if (ownProfileCache === null) return;
  ownProfileCache = null;
  ownProfileListeners.forEach((fn) => fn(null));
}
// The same cache for anything outside the header (BottomNav's Account
// photo and "View profile" row). TopNav fills it; this only follows along.
export function useOwnProfile() {
  const [ownProfile, setOwnProfile] = useState(ownProfileCache);
  useEffect(() => {
    ownProfileListeners.add(setOwnProfile);
    setOwnProfile(ownProfileCache);
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

// The branded header on every screen that's a direct bottom-nav
// destination (detail screens keep Expo Router's back-button header).
// It is the website's phone header (components/HeaderNav.js), option B of
// 2026-11-18 (Jose: "we do B and we move what is missing to there"): the
// ☰ first, then the wordmark + CONNECT / STREAM kicker, and on the right
// the round search button, Messages with the unread-conversations count,
// and the bell with its unread count that opens the notifications panel
// (the site's .notification-dropdown, mark read / mark all read, a tap
// opens what the notification points at). The account photo and its panel
// left the bar: the photo is the bottom bar's Account tab, and what its
// panel held is in the ☰ menu (components/SiteMenu.js), which slides in
// from the left over everything and holds the whole site — signed out, a
// "Sign in" pill sits where the photo was. The bell's panel lives in a
// transparent Modal placed just under the bar, so it sits above every
// screen and BottomNav the way the website's dropdowns do. The brand tap
// goes home, or straight to Stream for an account with "Here only for the
// stream?" turned on.
export default function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useUser();
  // The admin team's ☰ menu opens on its Admin side from an admin screen.
  const role = useAdminRole();
  const { getToken } = useAuth();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState(settingsCache);
  const [ownProfile, setOwnProfile] = useState(ownProfileCache);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState(null); // 'bell' | null
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
    if (!isSignedIn) { clearOwnProfileCache(); setOwnProfile(null); forgetMenuMembership(); return undefined; }
    if (ownProfileCache && ownProfileCache.userId) { setOwnProfile(ownProfileCache); return undefined; }
    let cancelled = false;
    (async () => {
      const token = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      if (!token) return;
      const profile = await apiGet('/api/account/profile', token).catch(() => null);
      if (!cancelled && profile) {
        updateOwnProfileCache({ userId: profile.userId || null, handle: profile.handle || null, displayName: profile.displayName || null, avatarUrl: profile.avatarUrl || null, avatarPosition: profile.avatarPosition || null, avatarZoom: profile.avatarZoom || null, stayInStream: !!profile.stayInStream });
        rememberStayInStream(!!profile.stayInStream);
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // A panel or the menu closes when the screen changes (a tap in it
  // navigates).
  useEffect(() => { setPanel(null); setMenuOpen(false); }, [pathname]);

  const stream = isStreamRoute(pathname);
  const kicker = stream
    ? (settings && settings.streamLabel) || 'Stream'
    : (settings && settings.connectLabel) || 'Connect';

  function openPanel(which) {
    if (panel === which) { setPanel(null); return; }
    const node = barRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      // The panel hangs from the bar's bottom edge, as on the website
      // (Jose, 2026-11-14: "make it go under the nav bar").
      node.measureInWindow((x, y, w, h) => {
        setAnchorTop(y + h);
        setPanel(which);
      });
    } else {
      setPanel(which);
    }
  }

  // The phone was turned (or the window changed) with a panel open: the
  // bar has moved, so find its bottom edge again.
  useEffect(() => {
    if (!panel) return;
    const node = barRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, w, h) => { if (Number.isFinite(y) && Number.isFinite(h)) setAnchorTop(y + h); });
    }
  }, [windowWidth, windowHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  function go(href) {
    setPanel(null);
    if (href !== pathname) router.push(href);
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

  const bellWidth = Math.min(300, windowWidth - 32);
  // A panel never runs off the bottom of the screen: it is its own scroll
  // area from the bar down to the home indicator (lib/menuScroll.js, the
  // website's rule), so every row can be reached on any phone, upright or
  // sideways. It sits in a Modal, so nothing behind it moves.
  const panelMaxHeight = panelRoom({ top: anchorTop, viewBottom: windowHeight - insets.bottom });

  return (
    <>
      <View style={styles.bar} ref={barRef} collapsable={false}>
        {/* The ☰ first, drawn without the circle the other buttons have
            (the website's .nav-hamburger; Jose, 2026-10-28). It opens the
            menu that holds the whole site (2026-11-18). */}
        <Pressable
          style={({ pressed }) => [styles.menuBtn, pressed && styles.iconBtnPressed]}
          onPress={() => { setPanel(null); setMenuOpen(true); }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={MENU_WORDS.open}
          accessibilityState={{ expanded: menuOpen }}
        >
          <MenuIcon size={20} color={menuOpen ? colors.olive : colors.inkDim} />
        </Pressable>
        <Pressable style={styles.brandMark} onPress={() => router.push(ownProfile && ownProfile.stayInStream ? '/stream' : '/')} hitSlop={6}>
          {settings && settings.logoUrl ? (
            <Image source={{ uri: settings.logoUrl }} style={styles.logoImage} resizeMode="contain" />
          ) : null}
          <View style={styles.brandText}>
            <Text style={styles.brandWord} numberOfLines={1}>Studio <Text style={styles.brandStrong}>Tapa</Text></Text>
            <Text style={[styles.kicker, { color: stream ? colors.olive : colors.ok }]} numberOfLines={1}>{kicker}</Text>
          </View>
        </Pressable>
        <View style={styles.spacer} />
        <View style={styles.actions}>
          <CircleButton label="Search" onPress={() => go('/search')}>
            <SearchIcon size={17} color={colors.inkDim} />
          </CircleButton>
          {isSignedIn ? (
            <>
              {/* Messages, between search and the bell (option B): the
                  same unread-conversations count the bottom bar's Account
                  dot and the Messages row use. */}
              <CircleButton label={`Messages${messagesUnread > 0 ? ` (${messagesUnread} unread)` : ''}`} onPress={() => go('/messages')}>
                <ChatIcon size={17} color={pathname.startsWith('/messages') ? colors.olive : colors.inkDim} />
                {messagesUnread > 0 ? (
                  <View style={styles.badge}><Text style={styles.badgeText}>{messagesUnread > 9 ? '9+' : messagesUnread}</Text></View>
                ) : null}
              </CircleButton>
              <CircleButton label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`} active={panel === 'bell'} onPress={() => openPanel('bell')}>
                <BellIcon size={17} color={panel === 'bell' ? colors.olive : colors.inkDim} />
                {unreadCount > 0 ? (
                  <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View>
                ) : null}
              </CircleButton>
            </>
          ) : isLoaded ? (
            // Where the photo was: the general way in (a creator who signs
            // in from it lands on the Dashboard, useSignInLanding.js).
            // Nothing until Clerk has loaded, so a signed-in person never
            // sees it flash.
            <Pressable
              style={({ pressed }) => [styles.signInPill, pressed && styles.signInPressed]}
              onPress={() => go(`/account?${GENERAL_SIGN_IN}`)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={MENU_WORDS.signIn}
            >
              <Text style={styles.signInText} numberOfLines={1}>{MENU_WORDS.signIn}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <SiteMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        side={menuSideFor({ inStream: stream, pathname, signedIn: Boolean(isSignedIn), roles: role || {} })}
        settings={settings}
        ownProfile={ownProfile}
      />

      <HeaderPanel visible={panel !== null} onClose={() => setPanel(null)} top={anchorTop} width={bellWidth}>
        {panel === 'bell' ? (
          <View>
            <View style={styles.bellHead}>
              <Text style={styles.panelLabel}>Notifications</Text>
              {unreadCount > 0 ? (
                <Pressable onPress={markAllRead} hitSlop={8} accessibilityRole="button"><Text style={styles.markAll}>Mark all read</Text></Pressable>
              ) : null}
            </View>
            <ScrollView style={{ maxHeight: Math.min(360, panelMaxHeight - 40) }} keyboardShouldPersistTaps="handled">
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

// A transparent Modal for the bell's panel: a tap anywhere outside closes
// it, the card fades and slides in like the website's dropdowns (and
// BottomNav's drop-up), anchored just under the bar on the right.
function HeaderPanel({ visible, onClose, top, width, children }) {
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
          { top, width, right: 16 },
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
  // .nav-hamburger: the same 32px hit area, no border.
  menuBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  // .notification-badge
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 14, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.danger, alignItems: 'center' },
  badgeText: { fontFamily: fonts.mono, fontSize: 9.6, lineHeight: 10, color: colors.ink },
  // Signed out, where the photo was: a small brass pill, the general way
  // in.
  signInPill: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  signInPressed: { opacity: 0.85 },
  signInText: { fontFamily: fonts.displayBold, fontSize: 12.5, color: colors.onBrass },
  // .dropdown: the website's panel (void-2 fill, hairline, 8px radius,
  // deep shadow).
  backdrop: { ...absoluteFill },
  // It comes out from under the bar (.menu-panel): no top edge of its own
  // and square top corners.
  panel: {
    position: 'absolute',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderTopWidth: 0, borderColor: inkTint(0.14),
    borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 34, shadowOffset: { width: 0, height: 16 }, elevation: 16,
    overflow: 'hidden'
  },
  // .dropdown-label
  panelLabel: { fontFamily: fonts.mono, fontSize: 9.6, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 5 },
  rowPressed: { backgroundColor: inkTint(0.06) },
  // .notification-dropdown (300px, scrolls at 360px), .notification-item
  bellHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingTop: 8, paddingRight: 14 },
  markAll: { fontFamily: fonts.mono, fontSize: 10.9, color: colors.olive },
  bellEmpty: { fontFamily: fonts.body, fontSize: 13.6, color: colors.ink, paddingHorizontal: 18, paddingVertical: 12 },
  noteRow: { paddingVertical: 10, paddingHorizontal: 14 },
  noteRowBorder: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  noteRowUnread: { backgroundColor: oliveTint(0.06) },
  noteMessage: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink, marginBottom: 3 },
  noteMessageUnread: { fontFamily: fonts.bodyBold },
  noteTime: { fontFamily: fonts.mono, fontSize: 10.4, color: colors.inkDim }
});
