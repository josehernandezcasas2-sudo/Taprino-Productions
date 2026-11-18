import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/stableAuth';
import { apiGet, freshToken } from '../lib/api';
import { colors, fonts, inkTint, brassTint, oliveTint, dangerTint, mintTint, skyTint, surfaceTint, absoluteFill } from '../lib/theme';
import { MENU_LIVE_LINES, MENU_WORDS, countsFresh, keptOpen, siteMenu } from '../lib/siteMenuRules';
import { useAdminRole } from '../lib/adminRole';
import { signOutEverywhere } from '../lib/signOut';
import { hrefToRoute } from './PushListener';
import { GENERAL_SIGN_IN } from './dashboard/useSignInLanding';
import PositionedImage from './PositionedImage';
import { MenuGlyph } from './SiteMenuIcons';

// The ☰ menu (Jose, 2026-11-18: option B plus a Facebook / Threads-style
// menu; the canvas https://claude.ai/artifact/RFSJUdzGefwe1v11cCJA6M). It
// slides in from the left over everything — the whole screen on a phone, a
// 440pt drawer on anything wider — and holds the whole site: you, the
// Connect / Stream switch, the places on that side as tiles, "See more",
// the sections that open in place, Log out. What it holds is
// lib/siteMenuRules.js (the website's file word for word); this file only
// draws it, the same way the website's components/SiteMenu.js does. Every
// href is a website path, turned into a screen by hrefToRoute; one the app
// has no screen for opens the website.
//
// Closes with ×, the Android back button, a tap on the dimmed screen beside
// the drawer, or a swipe to the left. It is a Modal of its own (so it sits
// over the bottom bar), with its own inset provider: a full-screen Modal is
// its own window on iOS, and the root provider's values could lag a turn of
// the phone. Every orientation is allowed — an iOS Modal opened from a
// screen held sideways crashes without it.
const ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'];
// Wider than this, the menu is a drawer (the website's .site-menu from
// 640px), so the screen behind still shows.
const DRAWER_FROM = 600;
const DRAWER_WIDTH = 440;
const GAP = 10;

// The tint behind each tile's icon, as on the website.
const TINT = {
  crew: 'brass', swipe: 'brass', films: 'brass', creator: 'brass',
  'pitch-room': 'gold', resources: 'gold', series: 'gold', 'my-list': 'gold',
  locations: 'mint', university: 'mint', podcasts: 'mint', team: 'mint', continue: 'mint',
  productions: 'sky', shop: 'sky', 'my-recs': 'sky', downloads: 'sky', vertical: 'sky', 'vertical-discover': 'sky',
  live: 'red'
};
const TINTS = {
  brass: { color: colors.brass, tint: brassTint },
  gold: { color: colors.olive, tint: oliveTint },
  mint: { color: colors.mint, tint: mintTint },
  sky: { color: colors.sky, tint: skyTint },
  red: { color: colors.danger, tint: dangerTint }
};
const SIDE_TINT = { connect: TINTS.mint, stream: TINTS.gold };

// Kept for the app's session: the live lines (read at most every
// MENU_COUNTS_MAX_AGE_MS), the genres, the plan line, and which sections
// are open.
let countsCache = { counts: null, at: NaN };
let genresCache = null;
let genresPromise = null;
let membershipCache = { at: 0, isSubscriber: null };
let openStore = [];

function loadGenres() {
  if (genresCache) return Promise.resolve(genresCache);
  if (!genresPromise) {
    genresPromise = apiGet('/api/genres')
      .then((d) => { genresCache = Array.isArray(d.genres) ? d.genres.filter((g) => typeof g === 'string' && g) : []; return genresCache; })
      .catch(() => { genresPromise = null; return []; });
  }
  return genresPromise;
}

// The plan line ("Tapa + member" / "Free account"): /api/account/dashboard-info,
// at most once a minute, asked as the menu opens so a membership bought a
// moment ago shows.
async function loadMembership(getToken) {
  if (Date.now() - membershipCache.at < 60000) return membershipCache;
  const token = await freshToken(getToken);
  if (!token) return membershipCache;
  const info = await apiGet('/api/account/dashboard-info', token).catch(() => null);
  if (info) membershipCache = { at: Date.now(), isSubscriber: Boolean(info.isSubscriber) };
  return membershipCache;
}

export function forgetMenuMembership() {
  membershipCache = { at: 0, isSubscriber: null };
}

// visible: whether it is open (the top bar's ☰). side: the half of the
// site the screen is on, where the switch starts. settings: the public site
// settings the top bar already read. ownProfile: the top bar's copy of the
// person's own profile (photo, name, handle).
export default function SiteMenu({ visible, onClose, side, settings, ownProfile }) {
  const [shown, setShown] = useState(Boolean(visible));
  const anim = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && !shown) { setShown(true); return; }
    if (visible && shown) {
      drag.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      return;
    }
    if (!visible && shown) {
      Animated.timing(anim, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown(false);
      });
    }
  }, [visible, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // The inset provider fills the Modal's window and never moves: under the
  // sliding drawer it would measure the drawer's place mid-slide (off the
  // left edge) as an inset.
  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={onClose}
      supportedOrientations={ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <SafeAreaProvider style={absoluteFill}>
        {shown ? <MenuFrame anim={anim} drag={drag} onClose={onClose} side={side} settings={settings} ownProfile={ownProfile} /> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

// The dimmed screen and the drawer that slides over it.
function MenuFrame({ anim, drag, onClose, side, settings, ownProfile }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const drawer = width >= DRAWER_FROM;
  const panelWidth = drawer ? Math.min(width, DRAWER_WIDTH + insets.left) : width;

  // A swipe to the left closes it: the drawer follows the finger and goes
  // when it is past a third of its width (or flicked); a vertical move is
  // the list scrolling and is left alone.
  const live = useRef({ panelWidth, onClose });
  live.current = { panelWidth, onClose };
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (e, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (e, g) => { drag.setValue(Math.min(0, g.dx)); },
    onPanResponderRelease: (e, g) => {
      if (g.dx < -live.current.panelWidth / 3 || g.vx < -0.6) live.current.onClose();
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
    onPanResponderTerminate: () => { Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(); }
  })).current;

  const translateX = useMemo(
    () => Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [-(panelWidth + 24), 0] }), drag),
    [panelWidth] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={absoluteFill} onPress={onClose} accessibilityLabel={MENU_WORDS.close} accessibilityRole="button" />
      </Animated.View>
      <Animated.View
        style={[styles.panel, { width: panelWidth }, drawer && styles.drawer, { transform: [{ translateX }] }]}
        accessibilityViewIsModal
        {...swipe.panHandlers}
      >
        <MenuBody onClose={onClose} side={side} settings={settings} ownProfile={ownProfile} drawer={drawer} insets={insets} />
      </Animated.View>
    </>
  );
}

function MenuBody({ onClose, side: startSide, settings, ownProfile, drawer, insets }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn, getToken, signOut } = useAuth();
  const role = useAdminRole();
  const signedIn = Boolean(isSignedIn);
  const [side, setSide] = useState(startSide === 'stream' ? 'stream' : 'connect');
  const [counts, setCounts] = useState(countsCache.counts);
  const [genres, setGenres] = useState(genresCache || []);
  const [membership, setMembership] = useState(membershipCache.at ? membershipCache.isSubscriber : null);
  const [showMore, setShowMore] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);

  // The person: the top bar's profile copy first (it follows an edit on the
  // Profile screen at once), else what /api/my-role answered.
  const roleAvatar = role && role.avatar && role.avatar.url ? role.avatar : null;
  const hasOwnPhoto = ownProfile && Object.prototype.hasOwnProperty.call(ownProfile, 'avatarUrl');
  const photo = !signedIn ? null
    : hasOwnPhoto ? (ownProfile.avatarUrl ? { url: ownProfile.avatarUrl, position: ownProfile.avatarPosition, zoom: ownProfile.avatarZoom } : null)
      : roleAvatar;
  const displayName = (ownProfile && ownProfile.displayName) || (role && role.displayName) || null;
  const ownHref = ownProfile && ownProfile.userId ? `/profile/${ownProfile.handle || ownProfile.userId}` : null;
  const profileHref = signedIn ? (ownHref || (role && role.profileHref) || null) : null;

  const menu = siteMenu({
    side,
    signedIn,
    roles: role || {},
    isSubscriber: Boolean(membership),
    settings: settings || null,
    counts,
    displayName,
    profileHref
  });

  // Which sections are open (kept for the app's session); only the ones
  // this person has are drawn open.
  const [openIds, setOpenIds] = useState(openStore);
  const openNow = keptOpen(openIds, menu.sections);

  // The live lines: one public read as the menu opens, unless the last one
  // is still fresh. A failure leaves them as they were (null the first
  // time), and the tiles show their plain line.
  useEffect(() => {
    if (!MENU_LIVE_LINES || countsFresh(countsCache.at)) return undefined;
    let alive = true;
    apiGet('/api/menu-counts')
      .then((d) => {
        if (!d || !d.counts || typeof d.counts !== 'object') return;
        countsCache = { counts: d.counts, at: Date.now() };
        if (alive) setCounts(d.counts);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    let alive = true;
    loadMembership(getToken).then((m) => { if (alive && m.at) setMembership(m.isSubscriber); });
    return () => { alive = false; };
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // The genres, once the Stream side is asked for.
  useEffect(() => {
    if (!menu.genres) return undefined;
    let alive = true;
    loadGenres().then((g) => { if (alive) setGenres(g); });
    return () => { alive = false; };
  }, [menu.genres]);

  function follow(href) {
    onClose();
    const where = hrefToRoute(href);
    if (!where) return;
    if (where.route) {
      if (where.route !== pathname) router.push(where.route);
    } else {
      Linking.openURL(where.url).catch(() => {});
    }
  }
  function openExternal(url) {
    onClose();
    Linking.openURL(url).catch(() => {});
  }
  // The general way in, the same as the top bar's Sign in pill: a creator
  // who signs in from it lands on the Dashboard (useSignInLanding.js).
  function signIn() {
    onClose();
    router.push(`/account?${GENERAL_SIGN_IN}`);
  }
  function search() {
    onClose();
    if (pathname !== '/search') router.push('/search');
  }
  function logOut() {
    onClose();
    forgetMenuMembership();
    signOutEverywhere(signOut, getToken).catch(() => {});
  }
  function pickSide(next) {
    if (next === side) return;
    setSide(next);
    setShowMore(false);
  }
  function toggleSection(id) {
    const ids = keptOpen(openIds, menu.sections);
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    openStore = next;
    setOpenIds(next);
  }

  let activeGenre = null;
  if (pathname.startsWith('/genre/')) {
    try { activeGenre = decodeURIComponent(pathname.slice('/genre/'.length)); } catch (err) { activeGenre = pathname.slice('/genre/'.length); }
  }

  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - GAP) / 2) : null;
  const tiles = showMore ? [...menu.tiles, ...menu.more] : menu.tiles;
  const p = menu.profile;
  const sideTint = SIDE_TINT[side];
  const padLeft = 16 + insets.left;
  const padRight = 16 + (drawer ? 0 : insets.right);

  return (
    <View style={styles.fill}>
      <View style={[styles.top, { paddingTop: insets.top, paddingLeft: padLeft, paddingRight: padRight }]}>
        <View style={styles.topRow}>
          <Text style={styles.title} accessibilityRole="header">{MENU_WORDS.title}</Text>
          <View style={styles.topActions}>
            <RoundButton label={MENU_WORDS.search} onPress={search}><MenuGlyph name="search" size={17} color={colors.inkDim} /></RoundButton>
            <RoundButton label={MENU_WORDS.close} onPress={onClose}><MenuGlyph name="close" size={17} color={colors.inkDim} /></RoundButton>
          </View>
        </View>
      </View>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.body, { paddingLeft: padLeft, paddingRight: padRight, paddingBottom: 24 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {p ? (
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.youRow, pressed && styles.pressed]}
              onPress={() => follow(p.href)}
              accessibilityRole="link"
              accessibilityLabel={`${p.name}. ${p.sub}`}
            >
              <View style={styles.youRing}>
                <View style={styles.youPhoto}>
                  {photo ? (
                    <PositionedImage uri={photo.url} position={photo.position} zoom={photo.zoom || 1} style={styles.photoFill} />
                  ) : (
                    <Text style={styles.youLetter}>{(p.name[0] || '?').toUpperCase()}</Text>
                  )}
                </View>
              </View>
              <View style={styles.textCol}>
                <Text style={styles.youName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.youSub} numberOfLines={1}>{p.sub}</Text>
              </View>
              <MenuGlyph name="chev" size={18} color={colors.inkFaint} />
            </Pressable>
            <View style={styles.planStrip}>
              {/* The plan shows once it is known, so a member never sees
                  "Free account" and a Join pill for a moment. */}
              <Text style={[styles.planText, membership && styles.planMember, membership === null && styles.hidden]} numberOfLines={1}>{p.plan}</Text>
              {p.join && membership !== null ? (
                <Pressable style={({ pressed }) => [styles.joinPill, pressed && styles.joinPressed]} onPress={() => follow(p.join.href)} accessibilityRole="link">
                  <Text style={styles.joinText}>{p.join.label}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[styles.card, styles.outCard]}>
            <View style={styles.outRow}>
              <View style={styles.outPhoto}><MenuGlyph name="person" size={22} color={colors.inkFaint} /></View>
              <View style={styles.textCol}>
                <Text style={styles.youName}>{MENU_WORDS.signedOutTitle}</Text>
                <Text style={styles.youSub}>{MENU_WORDS.signedOutLine}</Text>
              </View>
            </View>
            <View style={styles.outButtons}>
              <Pressable style={({ pressed }) => [styles.outBtn, styles.outBtnPrimary, pressed && styles.joinPressed]} onPress={signIn} accessibilityRole="button">
                <Text style={styles.outBtnPrimaryText}>{MENU_WORDS.signIn}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.outBtn, pressed && styles.pressed]} onPress={signIn} accessibilityRole="button">
                <Text style={styles.outBtnText}>{MENU_WORDS.createAccount}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.sides} accessibilityLabel={MENU_WORDS.sides}>
          {['connect', 'stream'].map((s) => {
            const on = s === side;
            const t = SIDE_TINT[s];
            return (
              <Pressable
                key={s}
                style={[styles.side, on && { backgroundColor: t.tint(0.16), borderColor: t.tint(0.55) }]}
                onPress={() => pickSide(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.sideText, { color: on ? t.color : colors.inkFaint }]}>{s === 'connect' ? MENU_WORDS.connect : MENU_WORDS.stream}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={({ pressed }) => [styles.home, pressed && styles.pressedText]} onPress={() => follow(menu.home.href)} accessibilityRole="link" accessibilityLabel={menu.home.label}>
          <Text style={[styles.homeText, { color: sideTint.color }]}>{menu.home.label} →</Text>
        </Pressable>

        <View style={styles.grid} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
          {tiles.map((t) => {
            const tint = TINTS[TINT[t.id] || 'brass'];
            return (
              <Pressable
                key={t.id}
                style={({ pressed }) => [styles.tile, tileWidth ? { width: tileWidth } : styles.tileGuess, pressed && styles.tilePressed]}
                onPress={() => (t.external ? openExternal(t.href) : follow(t.href))}
                accessibilityRole="link"
                accessibilityLabel={`${t.label}. ${t.line}`}
              >
                <View style={[styles.tileIcon, { backgroundColor: tint.tint(0.14) }]}>
                  <MenuGlyph name={t.id} size={19} color={tint.color} />
                </View>
                <View>
                  <Text style={styles.tileLabel} numberOfLines={1}>{t.label}</Text>
                  <View style={styles.tileLineRow}>
                    {t.dot ? <View style={styles.dot} /> : null}
                    <Text style={[styles.tileLine, t.live && styles.tileLineLive]} numberOfLines={1}>{t.line}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
        {menu.more.length > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
            onPress={() => setShowMore((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showMore }}
          >
            <Text style={styles.moreText}>{showMore ? MENU_WORDS.seeLess : MENU_WORDS.seeMore}</Text>
          </Pressable>
        ) : null}

        {menu.genres && genres.length > 0 ? (
          <View style={[styles.card, styles.genres]}>
            <Text style={styles.genresTitle} accessibilityRole="header">{MENU_WORDS.genres}</Text>
            <View style={styles.chips}>
              {genres.map((g) => {
                const on = activeGenre === g;
                return (
                  <Pressable
                    key={g}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                    onPress={() => {
                      onClose();
                      if (!on) router.push(`/genre/${encodeURIComponent(g)}`);
                    }}
                    accessibilityRole="link"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{g}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {menu.apply ? (
          <Pressable style={({ pressed }) => [styles.card, styles.applyRow, pressed && styles.tilePressed]} onPress={() => follow(menu.apply.href)} accessibilityRole="link" accessibilityLabel={`${menu.apply.title} ${menu.apply.line}`}>
            <View style={[styles.sectionIcon, { backgroundColor: brassTint(0.14) }]}>
              <MenuGlyph name="apply" size={18} color={colors.brass} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.sectionTitle}>{menu.apply.title}</Text>
              <Text style={styles.sectionSummary} numberOfLines={1}>{menu.apply.line}</Text>
            </View>
            <MenuGlyph name="chev" size={16} color={colors.inkFaint} />
          </Pressable>
        ) : null}

        {menu.sections.map((s) => {
          const open = openNow.includes(s.id);
          const tint = TINT[s.id] ? TINTS[TINT[s.id]].color : colors.inkDim;
          return (
            <View key={s.id} style={[styles.card, styles.section]}>
              <Pressable
                style={({ pressed }) => [styles.sectionHead, pressed && styles.pressed]}
                onPress={() => toggleSection(s.id)}
                accessibilityRole="button"
                accessibilityLabel={s.title}
                accessibilityHint={open ? undefined : s.summary}
                accessibilityState={{ expanded: open }}
              >
                <View style={styles.sectionIcon}>
                  <MenuGlyph name={s.id} size={18} color={tint} />
                </View>
                <View style={styles.textCol}>
                  <Text style={styles.sectionTitle}>{s.title}</Text>
                  {!open ? <Text style={styles.sectionSummary} numberOfLines={1}>{s.summary}</Text> : null}
                </View>
                <View style={open ? styles.caretOpen : null}>
                  <MenuGlyph name="down" size={18} color={colors.inkFaint} />
                </View>
              </Pressable>
              {open ? s.rows.map((r) => (
                <Pressable key={r.href} style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => follow(r.href)} accessibilityRole="link">
                  <Text style={styles.rowText} numberOfLines={1}>{r.label}</Text>
                  <MenuGlyph name="chev" size={15} color={colors.inkFaint} />
                </Pressable>
              )) : null}
            </View>
          );
        })}

        {menu.logout ? (
          <Pressable style={({ pressed }) => [styles.logout, pressed && styles.morePressed]} onPress={logOut} accessibilityRole="button">
            <MenuGlyph name="logout" size={17} color={colors.ink} />
            <Text style={styles.logoutText}>{MENU_WORDS.logout}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function RoundButton({ label, onPress, children }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.round, pressed && styles.roundPressed]}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...absoluteFill, backgroundColor: surfaceTint(0.72) },
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.surface0, overflow: 'hidden' },
  // Wider screens: the drawer's edge and its shadow over the screen behind.
  drawer: {
    borderRightWidth: 1, borderRightColor: colors.hairline,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 24, height: 0 }, elevation: 24
  },
  top: { backgroundColor: colors.surface0, borderBottomWidth: 1, borderBottomColor: inkTint(0.06) },
  topRow: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 28, color: colors.ink },
  topActions: { flexDirection: 'row', gap: 10 },
  round: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: inkTint(0.18), backgroundColor: inkTint(0.04), alignItems: 'center', justifyContent: 'center' },
  roundPressed: { backgroundColor: inkTint(0.1) },
  body: { paddingTop: 14, gap: 12 },
  card: { borderRadius: 20, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  pressed: { backgroundColor: inkTint(0.05) },
  pressedText: { opacity: 0.7 },
  textCol: { flex: 1, minWidth: 0, gap: 2 },
  hidden: { opacity: 0 },
  // You.
  youRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12 },
  youRing: { width: 55, height: 55, borderRadius: 28, borderWidth: 1.5, borderColor: brassTint(0.7), padding: 2, alignItems: 'center', justifyContent: 'center' },
  youPhoto: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoFill: { width: '100%', height: '100%' },
  youLetter: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
  youName: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  youSub: { fontFamily: fonts.display, fontSize: 13, color: colors.inkFaint },
  planStrip: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  planText: { flexShrink: 1, fontFamily: fonts.display, fontSize: 13, color: colors.inkFaint },
  planMember: { color: colors.olive },
  joinPill: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  joinPressed: { opacity: 0.85 },
  joinText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.onBrass },
  // Signed out.
  outCard: { padding: 16 },
  outRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  outPhoto: { width: 48, height: 48, borderRadius: 24, backgroundColor: inkTint(0.06), borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25), alignItems: 'center', justifyContent: 'center' },
  outButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  outBtn: { flex: 1, height: 42, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.25), alignItems: 'center', justifyContent: 'center' },
  outBtnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  outBtnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrass },
  outBtnText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  // Connect / Stream.
  sides: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, backgroundColor: inkTint(0.05), borderWidth: 1, borderColor: inkTint(0.08) },
  side: { flex: 1, height: 36, borderRadius: 999, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  sideText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' },
  home: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 2, marginTop: -2 },
  homeText: { fontFamily: fonts.displaySemi, fontSize: 13.5 },
  // The tiles.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { minHeight: 92, borderRadius: 18, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, paddingVertical: 12, paddingHorizontal: 13, justifyContent: 'space-between', gap: 8 },
  // Until the grid has been measured (one frame).
  tileGuess: { width: '47%' },
  tilePressed: { backgroundColor: colors.surface2 },
  tileIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  tileLineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger, marginRight: 5 },
  tileLine: { flexShrink: 1, fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },
  tileLineLive: { color: colors.inkDim },
  more: { height: 42, borderRadius: 14, backgroundColor: inkTint(0.07), alignItems: 'center', justifyContent: 'center' },
  morePressed: { backgroundColor: inkTint(0.12) },
  moreText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  // Genres.
  genres: { borderRadius: 18, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 14 },
  genresTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.16), alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: oliveTint(0.16), borderColor: oliveTint(0.55) },
  chipText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.inkDim },
  chipTextOn: { color: colors.olive },
  // Make films? and the sections.
  applyRow: { borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  section: { borderRadius: 18 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  sectionIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: inkTint(0.07), alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  sectionSummary: { fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },
  caretOpen: { transform: [{ rotate: '180deg' }] },
  row: { height: 46, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: inkTint(0.06) },
  rowText: { flexShrink: 1, fontFamily: fonts.display, fontSize: 15, color: colors.ink },
  logout: { height: 46, borderRadius: 14, backgroundColor: inkTint(0.07), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  logoutText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink }
});
