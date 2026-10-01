import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';
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
      { href: '/watch/series', label: 'Watch Series' },
      { href: '/watch/movies', label: 'Watch Movies' },
      { href: '/watch/podcasts', label: 'Podcasts' },
      { href: '/watch/vertical', label: 'Vertical' }
    ],
    match: (p) => p.startsWith('/watch')
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

  function toggle(key) {
    setOpenKey((k) => (k === key ? null : key));
  }
  function go(href) {
    setOpenKey(null);
    router.push(href);
  }

  const openGroup = openKey ? GROUPS[openKey] : null;

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
        {openGroup && (
          <View style={styles.dropup}>
            {openGroup.items.map((item) => (
              <Pressable
                key={item.href}
                style={({ pressed }) => [styles.dropupItem, pressed && styles.dropupItemPressed]}
                onPress={() => go(item.href)}
              >
                <Text style={styles.dropupItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.bar}>
          {Object.entries(GROUPS).map(([key, group]) => {
            const active = group.match(pathname);
            const isDiscover = key === 'discover';
            const tint = active ? colors.onBrass : isDiscover ? colors.sky : colors.inkDim;
            const Icon = group.Icon;
            return (
              <Pressable key={key} style={[styles.item, active && styles.itemActive]} onPress={() => toggle(key)}>
                <Icon size={20} color={tint} />
                <View style={styles.labelRow}>
                  <Text style={[styles.label, { color: tint }]}>{group.label}</Text>
                  <CaretUpIcon size={7} color={tint} />
                </View>
              </Pressable>
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
  item: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 999, paddingVertical: 4 },
  itemActive: { backgroundColor: colors.brass },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  dropup: {
    marginBottom: 10,
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
    minWidth: 200,
    alignSelf: 'flex-start'
  },
  dropupItem: { paddingVertical: 12, paddingHorizontal: 18 },
  dropupItemPressed: { backgroundColor: 'rgba(248,95,115,0.15)' },
  dropupItemText: { color: colors.ink, fontSize: 14 }
});
