import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '../lib/theme';
import { HouseIcon, CompassIcon, WatchTabIcon, AccountIcon, CaretUpIcon } from './TabBarIcons';

// Mirrors components/MobileTabBar.js on the website: four groups, each a
// button that opens a small drop-up menu above itself rather than
// navigating directly, so the app's nav covers every page the site's
// does even though most don't have a built screen yet (see ComingSoon).
const GROUPS = {
  home: {
    label: 'Home',
    Icon: HouseIcon,
    items: [
      { href: '/', label: 'Connect' },
      { href: '/stream', label: 'Stream' },
      { href: '/pitches', label: 'Pitch Room' },
      { href: '/about', label: 'About' }
    ],
    match: (p) => p === '/' || p === '/stream' || p === '/about' || p === '/pitches'
  },
  discover: {
    label: 'Discover',
    Icon: CompassIcon,
    items: [
      { href: '/pitches/discover', label: 'Pitch Discover' },
      { href: '/vertical/discover', label: 'Vertical Discover' }
    ],
    match: (p) => p === '/pitches/discover' || p === '/vertical/discover'
  },
  watch: {
    label: 'Watch',
    Icon: WatchTabIcon,
    items: [
      { href: '/live', label: 'Live TV' },
      { href: '/watch/series', label: 'Watch Series' },
      { href: '/watch/movies', label: 'Watch Movies' },
      { href: '/watch/podcasts', label: 'Podcasts' },
      { href: '/watch/vertical', label: 'Vertical' }
    ],
    match: (p) => p.startsWith('/watch') || p === '/live' || p.startsWith('/live/')
  },
  account: {
    label: 'Account',
    Icon: AccountIcon,
    items: [
      { href: '/account', label: 'Settings / Account' },
      { href: '/account/wishlist', label: 'My List' },
      { href: '/account/my-work', label: 'My Work' }
    ],
    match: (p) => p.startsWith('/account')
  }
};

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [openKey, setOpenKey] = useState(null);
  // Measured layouts, used to center the drop-up over the tab that opened
  // it (same approach as MobileTabBar.js's useLayoutEffect).
  const [barLayout, setBarLayout] = useState(null);
  const [itemLayouts, setItemLayouts] = useState({});
  const [dropupWidth, setDropupWidth] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => { setOpenKey(null); }, [pathname]);



  function toggle(key) {
    setDropupWidth(0);
    setOpenKey((k) => (k === key ? null : key));
  }
  function go(href) {
    setOpenKey(null);
    router.push(href);
  }

  const openGroup = openKey ? GROUPS[openKey] : null;

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
            <View onLayout={(e) => setDropupWidth(e.nativeEvent.layout.width + 2)}>
            {openGroup.items.map((entry) => (
              <Pressable
                key={entry.href}
                style={({ pressed }) => [styles.dropupItem, pressed && styles.dropupItemPressed]}
                onPress={() => go(entry.href)}
              >
                <Text style={styles.dropupItemText}>{entry.label}</Text>
              </Pressable>
            ))}
            </View>
          </Animated.View>
        )}
        <View style={styles.bar} onLayout={(e) => setBarLayout(e.nativeEvent.layout)}>
          {Object.entries(GROUPS).map(([key, group]) => {
            const active = group.match(pathname);
            const isDiscover = key === 'discover';
            const tint = active ? colors.onBrass : isDiscover ? colors.sky : colors.inkDim;
            const Icon = group.Icon;
            return (
              <View
                key={key}
                style={styles.itemSlot}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  setItemLayouts((prev) => ({ ...prev, [key]: { x, width } }));
                }}
              >
                <Pressable style={[styles.item, active && styles.itemActive]} onPress={() => toggle(key)}>
                  <Icon size={20} color={tint} />
                  <View style={styles.labelRow}>
                    <Text style={[styles.label, { color: tint }]}>{group.label}</Text>
                    {isDiscover ? null : <CaretUpIcon size={7} color={tint} />}
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
  itemActive: { backgroundColor: colors.brass },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { fontFamily: fonts.mono, fontSize: 8.3, letterSpacing: 0.8, textTransform: 'uppercase' },
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
  dropupItemPressed: { backgroundColor: 'rgba(248,95,115,0.15)' },
  dropupItemText: { color: colors.ink, fontSize: 13.6, fontFamily: fonts.body }
});
