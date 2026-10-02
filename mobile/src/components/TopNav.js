import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { SearchIcon } from './TabBarIcons';
import SmartImage from './SmartImage';

// The mobile routes that count as the Stream half of the site — the same
// pages lib/streamSection.js's isStreamPath() marks on the website, mapped
// to their app routes (/type/series|movie → /watch/series|movies,
// /podcasts → /watch/podcasts, /vertical/browse → /watch/vertical). Search
// counts too: on the website a search runs inside /stream. Everything else
// (home, pitches, about, account, profiles, genre, collections…) is Connect.
export function isStreamRoute(pathname) {
  return (
    pathname === '/stream' ||
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
// session, not per screen.
let settingsCache = null;
let settingsPromise = null;
function loadSettings() {
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

// The branded header on every screen that's a direct bottom-nav
// destination (detail screens keep Expo Router's back-button header).
// Top-left mirrors components/HeaderNav.js's .brand-mark: the admin-set
// logo image (Site Settings), "Studio Tapa", and the green CONNECT / amber
// STREAM kicker for whichever half of the site this screen belongs to,
// with labels editable in Site Settings. Tapping it goes home, or straight
// to Stream for an account with "Here only for the stream?" turned on.
// The rest stays deliberately minimal (search + account) since BottomNav
// already covers HeaderNav's links.
export default function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const [settings, setSettings] = useState(settingsCache);
  const [ownProfile, setOwnProfile] = useState(ownProfileCache);

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
        updateOwnProfileCache({ avatarUrl: profile.avatarUrl || null, stayInStream: !!profile.stayInStream });
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  const stream = isStreamRoute(pathname);
  const kicker = stream
    ? (settings && settings.streamLabel) || 'Stream'
    : (settings && settings.connectLabel) || 'Connect';

  const avatarLetter = isSignedIn && user && user.primaryEmailAddress
    ? user.primaryEmailAddress.emailAddress[0].toUpperCase()
    : null;

  return (
    <View style={styles.bar}>
      <Pressable style={styles.brandMark} onPress={() => router.push(ownProfile && ownProfile.stayInStream ? '/stream' : '/')} hitSlop={6}>
        {settings && settings.logoUrl ? (
          <Image source={{ uri: settings.logoUrl }} style={styles.logoImage} resizeMode="contain" />
        ) : null}
        <View style={styles.brandText}>
          <Text style={styles.brandWord}>Studio <Text style={styles.brandStrong}>Tapa</Text></Text>
          <Text style={[styles.kicker, { color: stream ? colors.olive : colors.ok }]}>{kicker}</Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Pressable style={styles.iconBtn} onPress={() => router.push('/search')} hitSlop={8}>
          <SearchIcon size={20} color={colors.ink} />
        </Pressable>
        <Pressable style={styles.avatarBtn} onPress={() => router.push('/account')} hitSlop={8}>
          {isSignedIn && ownProfile && ownProfile.avatarUrl ? (
            <SmartImage uri={ownProfile.avatarUrl} style={styles.avatarImg} />
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
    backgroundColor: colors.surface1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.hairline
  },
  // .brand-mark / .nav-logo-image / .brand-text / .brand-word / .brand-kicker
  brandMark: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  logoImage: { height: 32, width: 96, maxWidth: 128 },
  brandText: { gap: 2 },
  brandWord: { fontFamily: fonts.display, fontSize: 16.8, color: colors.ink },
  brandStrong: { fontFamily: fonts.displayBold, color: colors.brass },
  kicker: { fontFamily: fonts.monoMedium, fontSize: 9.3, letterSpacing: 1.5, textTransform: 'uppercase' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  avatarBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: colors.onBrass, fontSize: 13, fontFamily: fonts.displayBold }
});
