import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { colors } from '../lib/theme';
import { SearchIcon } from './TabBarIcons';
import SmartImage from './SmartImage';

// The branded header for every screen that's a direct bottom-nav
// destination (Home, Stream, the four Watch screens, Pitch Room/Discover,
// Vertical Discover, Account/Wishlist/My Work) — those set
// headerShown: false in _layout.js and render this instead. Drill-down
// detail screens (episode, series, profile, etc.) keep Expo Router's
// default back-button header, unchanged.
//
// Deliberately NOT a port of components/HeaderNav.js — that bar's nav
// links, hamburger genre menu, and notification bell all duplicate what
// BottomNav's drop-ups already cover on mobile. This is just brand +
// search + account, agreed with Jose as the minimal direction (see
// mobile_top_nav_options mockup).
export default function TopNav() {
  const router = useRouter();
  const { isSignedIn, user } = useUser();

  const avatarLetter = isSignedIn && user && user.primaryEmailAddress
    ? user.primaryEmailAddress.emailAddress[0].toUpperCase()
    : null;

  return (
    <View style={styles.bar}>
      <Text style={styles.brand}>Studio <Text style={styles.brandBold}>Tapa</Text></Text>
      <View style={styles.actions}>
        <Pressable style={styles.iconBtn} onPress={() => router.push('/search')} hitSlop={8}>
          <SearchIcon size={20} color={colors.ink} />
        </Pressable>
        <Pressable style={styles.avatarBtn} onPress={() => router.push('/account')} hitSlop={8}>
          {isSignedIn && user && user.imageUrl ? (
            <SmartImage uri={user.imageUrl} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarText}>{avatarLetter || '☺'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: colors.hairline
  },
  brand: { color: colors.ink, fontSize: 17, fontWeight: '500' },
  brandBold: { fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  avatarBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: colors.onBrass, fontSize: 13, fontWeight: '700' }
});
