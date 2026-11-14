import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { riseRoom } from '../lib/menuScroll';
import { colors, fonts } from '../lib/theme';
import { HouseIcon, CompassIcon, WatchTabIcon, AccountIcon, CaretUpIcon, ShieldIcon, DashboardIcon } from './TabBarIcons';
import { useAdminRole } from '../lib/adminRole';
import { useUnreadMessages } from '../lib/useUnread';
import { useOwnProfile, ownProfileHref, loadSettings } from './TopNav';
import { useDownloadCount } from '../lib/useDownloads';
import { DOWNLOAD_WORDS } from '../lib/downloadRules';
import { DownloadGlyph } from './downloads/DownloadBits';
import { DASHBOARD_PATH, seesDashboard } from '../lib/creatorDashboardRules';
import { SQUARE_RADIUS, tabBarFit } from '../lib/tabBarFit';
import { GENERAL_SIGN_IN } from './dashboard/useSignInLanding';

// Mirrors components/MobileTabBar.js on the website: four groups, each a
// button that opens a small drop-up menu above itself rather than
// navigating directly, so the app's nav covers every page the site's
// does.
//
// The creator's Dashboard (Jose, 2026-11-14: "add a dashboard to the tab
// bar … all creators and teams see the tab"): one more tab between Watch
// and Account for a creator, an admin or a sub-admin (seesDashboard). A tap
// goes straight to the screen, no menu. It is the lit tab on the Dashboard
// and on the screens its row of tabs opens (Your work, Your numbers, Money,
// Your pitches, the show screens and the rest of /creator/*), so Account no
// longer lights up for Your work. The people who have it lose My Work, Your
// Numbers and Money from the Account menu: those are the Dashboard's own
// tabs (components/dashboard/DashboardTabs.js). Creator Studio's hub is gone
// (the Dashboard took its place the same day), and so is its row in the
// Account menu. An admin then has six tabs;
// lib/tabBarFit.js decides how the labels fit whatever the phone's width
// (closer letters, a squarer lit pill, no carets and a wider Dashboard tab,
// and last a smaller size), so no label is ever cut, wrapped, or left
// poking out of its pill.
const onCreatorScreen = (p) => p === '/creator' || p.startsWith('/creator/') || p === '/account/my-work';
const DASHBOARD_TAB = { label: 'Dashboard', Icon: DashboardIcon, href: DASHBOARD_PATH, match: onCreatorScreen };

const GROUPS = {
  home: {
    label: 'Home',
    Icon: HouseIcon,
    items: [
      { href: '/', label: 'Connect' },
      { href: '/stream', label: 'Stream' },
      { href: '/pitches', label: 'Pitch Room' },
      { href: '/university', label: 'Film University' },
      { href: '/about', label: 'About' }
    ],
    match: (p) => p === '/' || p === '/stream' || p === '/about' || p === '/pitches' || p.startsWith('/university')
  },
  discover: {
    label: 'Discover',
    Icon: CompassIcon,
    items: [
      { href: '/pitches/discover', label: 'Pitch Discover' },
      { href: '/vertical/discover', label: 'Vertical Discover' },
      { href: '/crew', label: 'Crew Call' },
      { href: '/locations', label: 'Locations' },
      { href: '/productions', label: 'Productions' },
      { href: '/resources', label: 'Resources' }
    ],
    match: (p) => p === '/pitches/discover' || p === '/vertical/discover' || p.startsWith('/crew') || p.startsWith('/locations')
  },
  watch: {
    label: 'Watch',
    Icon: WatchTabIcon,
    // A function since 2026-11-14: Downloads is the first row (the mockup's
    // "Getting there" screen) while the admin switch is on, or while this
    // phone holds copies — so they stay reachable with no connection, when
    // the settings can't be read. The count is how many titles are here.
    items: ({ downloads }) => [
      ...(downloads.show ? [{ href: '/downloads', label: DOWNLOAD_WORDS.nav, glyph: 'download', count: downloads.count }] : []),
      { href: '/live', label: 'Live TV' },
      { href: '/watch/series', label: 'Watch Series' },
      { href: '/watch/movies', label: 'Watch Movies' },
      { href: '/watch/podcasts', label: 'Podcasts' },
      { href: '/watch/vertical', label: 'Vertical' }
    ],
    match: (p) => p.startsWith('/watch') || p === '/live' || p.startsWith('/live/') || p === '/downloads' || p.startsWith('/downloads/')
  },
  account: {
    label: 'Account',
    Icon: AccountIcon,
    // A function, like MobileTabBar.js's: "View profile" only exists once
    // the signed-in viewer's own profile is known (TopNav's cache).
    items: ({ profileHref, role, hasDashboard }) => [
      // Signed out, this row is the bar's way to the sign-in card: a
      // creator who signs in from it lands on the Dashboard
      // (components/dashboard/useSignInLanding.js).
      { href: role.isSignedIn ? '/account' : `/account?${GENERAL_SIGN_IN}`, label: 'Settings / Account' },
      ...(profileHref ? [{ href: profileHref, label: 'View profile' }] : []),
      // The account hub's screens (option B, 2026-10-29).
      { href: '/account/membership', label: 'Membership' },
      { href: '/account/purchases', label: 'Your purchases' },
      // Membership Artist Support: the creators a member's share goes to.
      { href: '/account/artist-support', label: 'Artist Support' },
      { href: '/messages', label: 'Messages', badge: 'messages' },
      { href: '/account/wishlist', label: 'My List' },
      // The Account screen's old quick links (2026-10-12) live here now.
      { href: '/recs', label: 'My Recs' },
      { href: '/stream', label: 'Continue Watching' },
      // My Work, Your Numbers and Money: the Dashboard's tabs for the
      // people who have the Dashboard tab (2026-11-14).
      ...(hasDashboard ? [] : [{ href: '/account/my-work', label: 'My Work' }]),
      { href: '/locations/mine', label: 'My locations' },
      ...(role.isSignedIn && !role.isCreator ? [{ href: '/apply', label: 'Become a creator' }] : [])
    ],
    // Your work lights the Dashboard tab for the people who have it.
    match: (p, { hasDashboard } = {}) => (p.startsWith('/account') && !(hasDashboard && p === '/account/my-work')) || p.startsWith('/messages')
  }
};

// Fifth tab, admins and sub-admins only (2026-10-08). Review on the go:
// the admin home with the queues, the card-by-card review screen, and
// flags on the web.
const ADMIN_GROUP = {
  label: 'Admin',
  Icon: ShieldIcon,
  items: [
    { href: '/admin', label: 'Admin home' },
    { href: '/admin/review', label: 'Review queue' }
  ],
  match: (p) => p.startsWith('/admin')
};

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [openKey, setOpenKey] = useState(null);
  // Measured layouts, used to center the drop-up over the tab that opened
  // it (same approach as MobileTabBar.js's useLayoutEffect).
  const [barLayout, setBarLayout] = useState(null);
  const [itemLayouts, setItemLayouts] = useState({});
  const [dropupWidth, setDropupWidth] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const role = useAdminRole();
  const hasDashboard = seesDashboard(role);
  // Left to right: Home, Discover, Watch, Dashboard (creators and the
  // team), Account, Admin (the team).
  const groups = {
    home: GROUPS.home,
    discover: GROUPS.discover,
    watch: GROUPS.watch,
    ...(hasDashboard ? { dashboard: DASHBOARD_TAB } : {}),
    account: GROUPS.account,
    ...(role.canAccessAdmin ? { admin: ADMIN_GROUP } : {})
  };
  // Unread conversations: a dot on the Account tab and a count on the
  // Messages row (the website's header badge).
  const unreadMessages = useUnreadMessages();
  const profileHref = ownProfileHref(useOwnProfile());
  // Downloads: the phone's own count (the index file, no request), and the
  // admin switch from the settings every screen already shares.
  const downloadCount = useDownloadCount();
  const [downloadsEnabled, setDownloadsEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => { if (alive && s) setDownloadsEnabled(s.downloadsEnabled === true); });
    return () => { alive = false; };
  }, [openKey]);
  const downloads = { show: downloadsEnabled || downloadCount > 0, count: downloadCount };

  useEffect(() => { setOpenKey(null); }, [pathname]);



  function toggle(key) {
    setDropupWidth(0);
    setOpenKey((k) => (k === key ? null : key));
  }
  function go(href) {
    setOpenKey(null);
    router.push(href);
  }
  // A tab that is a link (the Dashboard): straight to its screen, and
  // nothing when that screen is already the one showing. From one of the
  // screens its row of tabs opens (Your work, Money…) the Dashboard is
  // usually underneath: go back down to it rather than push a second copy
  // on top (dismissTo opens it in this screen's place when it isn't there).
  function goTab(href, match) {
    setOpenKey(null);
    if (pathname === href) return;
    if (match && match(pathname)) router.dismissTo(href);
    else router.push(href);
  }

  const openGroup = openKey ? groups[openKey] : null;
  // How the labels fit this bar on this phone (lib/tabBarFit.js): one size
  // and spacing for all of them, whether the carets show, how round the lit
  // pill is, and the share of the bar a tab that is a link (the Dashboard,
  // the longest word) takes.
  const fit = tabBarFit({
    barWidth: barLayout ? barLayout.width : windowWidth - 32,
    tabs: Object.entries(groups).map(([key, group]) => ({ text: group.label, caret: key !== 'discover' && !group.href, long: Boolean(group.href) })),
    fontScale
  });

  let dropupLeft = 0;
  const item = openKey ? itemLayouts[openKey] : null;
  // Until the drop-up reports its own width, assume .tabbar-dropup's
  // 180px min-width — close enough that the later correction is invisible.
  const width = dropupWidth || 180;
  if (item && barLayout) {
    const margin = 6;
    const center = item.x + item.width / 2;
    dropupLeft = Math.max(margin, Math.min(center - width / 2, barLayout.width - width - margin));
  }
  const measured = !!(item && barLayout);
  // The menu is its own scroll area, never taller than the room between
  // the bar and the top of the screen (lib/menuScroll.js, the website's
  // rule): on a phone held sideways the Account menu used to run off the
  // top with no way to reach its first rows.
  const dropupMaxHeight = riseRoom({ bottom: windowHeight - (insets.bottom + 18) - (barLayout ? barLayout.height : 64) - 10, ceiling: insets.top });

  // Fade/slide in only once the position is known (.tabbar-dropup's 0.14s
  // tabbar-dropup-in), so it never animates from the wrong spot.
  useEffect(() => {
    if (!openKey || !measured) { anim.setValue(0); return; }
    Animated.timing(anim, { toValue: 1, duration: 140, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [openKey, measured]);

  // Vertical Discover is a full-screen immersive takeover (edge-to-edge
  // video, its own close button) — matches pages/vertical/discover.js,
  // which likewise renders no MobileTabBar. Pitch Discover, by contrast,
  // keeps the tab bar on the website (pages/pitches/discover.js does
  // render MobileTabBar), so it stays visible here too.
  if (pathname === '/vertical/discover' || pathname === '/snippets/discover') return null;

  return (
    <>
      {openGroup && <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpenKey(null)} />}
      <View style={[styles.wrap, { bottom: insets.bottom + 18 }]} pointerEvents="box-none">
        {openGroup && barLayout && (
          <Animated.View
            key={openKey}
            style={[
              styles.dropup,
              { left: dropupLeft, bottom: barLayout.height + 10 },
              { opacity: measured ? anim : 0, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }
            ]}
          >
            <ScrollView style={{ maxHeight: dropupMaxHeight }} keyboardShouldPersistTaps="handled">
            <View onLayout={(e) => setDropupWidth(e.nativeEvent.layout.width + 2)}>
            {(typeof openGroup.items === 'function' ? openGroup.items({ profileHref, role, downloads, hasDashboard }) : openGroup.items).map((entry) => (
              <Pressable
                key={entry.href}
                style={({ pressed }) => [styles.dropupItem, entry.glyph && styles.dropupItemRow, pressed && styles.dropupItemPressed]}
                onPress={() => go(entry.href)}
                accessibilityRole="link"
                accessibilityLabel={entry.count > 0 ? `${entry.label}, ${entry.count}` : undefined}
              >
                {entry.glyph === 'download' ? <DownloadGlyph size={15} color={colors.ink} /> : null}
                <Text style={styles.dropupItemText}>{entry.label}{entry.badge === 'messages' && unreadMessages > 0 ? ` · ${unreadMessages}` : ''}</Text>
                {entry.count > 0 ? <View style={styles.dropupCount}><Text style={styles.dropupCountText}>{entry.count}</Text></View> : null}
              </Pressable>
            ))}
            </View>
            </ScrollView>
          </Animated.View>
        )}
        <View style={styles.bar} onLayout={(e) => setBarLayout(e.nativeEvent.layout)}>
          {Object.entries(groups).map(([key, group]) => {
            const active = group.match(pathname, { hasDashboard });
            const isDiscover = key === 'discover';
            // A tab with an address of its own is a link, not a menu.
            const isLink = Boolean(group.href);
            const tint = active ? colors.onBrass : isDiscover ? colors.sky : colors.inkDim;
            const Icon = group.Icon;
            return (
              <View
                key={key}
                style={[styles.itemSlot, isLink && fit.share !== 1 && { flex: fit.share }]}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  setItemLayouts((prev) => ({ ...prev, [key]: { x, width } }));
                }}
              >
                <Pressable
                  style={[styles.item, !fit.round && styles.itemSquarer, active && styles.itemActive]}
                  onPress={() => (isLink ? goTab(group.href, group.match) : toggle(key))}
                  accessibilityRole={isLink ? 'link' : undefined}
                  accessibilityLabel={isLink ? group.label : undefined}
                  accessibilityState={isLink ? { selected: active } : undefined}
                >
                  <View>
                    <Icon size={20} color={tint} />
                    {key === 'account' && unreadMessages > 0 ? <View style={styles.badgeDot} /> : null}
                  </View>
                  <View style={styles.labelRow}>
                    {/* The size comes from tabBarFit, in real points (it has
                        the phone's text-size setting already, so scaling is
                        off here); adjustsFontSizeToFit is the net under it
                        (a fallback font is wider), so a label is shrunk,
                        never cut or wrapped. */}
                    <Text
                      style={[styles.label, { color: tint, fontSize: fit.size, letterSpacing: fit.spacing }]}
                      allowFontScaling={false}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                    >
                      {group.label}
                    </Text>
                    {isDiscover || isLink || !fit.carets ? null : <CaretUpIcon size={7} color={tint} />}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: colors.barBackground,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12
  },
  itemSlot: { flex: 1 },
  item: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 999, paddingVertical: 4 },
  // On a tight bar the lit pill's corners are squarer, so its round ends
  // don't take the room the label needs (lib/tabBarFit.js).
  itemSquarer: { borderRadius: SQUARE_RADIUS },
  itemActive: { backgroundColor: colors.brass },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%' },
  badgeDot: { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brass, borderWidth: 1, borderColor: colors.barBackground },
  // The size and spacing here are the bar's when there is room; the render
  // sets both from tabBarFit.
  label: { fontFamily: fonts.mono, fontSize: 8.3, letterSpacing: 0.8, textTransform: 'uppercase', flexShrink: 1 },
  dropup: {
    position: 'absolute',
    backgroundColor: colors.dropupBackground,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    minWidth: 180
  },
  dropupItem: { paddingVertical: 11, paddingHorizontal: 18 },
  // The Downloads row: its glyph, the label, the count pushed to the right
  // (the mockup's .menu-row + .count).
  dropupItemRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dropupCount: { marginLeft: 'auto', minWidth: 20, borderRadius: 999, backgroundColor: colors.olive, paddingHorizontal: 7, paddingVertical: 1, alignItems: 'center' },
  dropupCountText: { fontFamily: fonts.monoBold, fontSize: 10.5, color: colors.onBrass },
  dropupItemPressed: { backgroundColor: 'rgba(255,140,66,0.15)' },
  dropupItemText: { color: colors.ink, fontSize: 13.6, fontFamily: fonts.body }
});
