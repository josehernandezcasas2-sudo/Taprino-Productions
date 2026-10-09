import { useEffect, useState } from 'react';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { useFonts } from 'expo-font';
import { SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { Fraunces_400Regular, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BottomNav from '../components/BottomNav';
import { colors } from '../lib/theme';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY — see mobile/.env');
}

// A Stack, not Tabs — BottomNav (its own component) floats over it as a
// persistent overlay, same relationship MobileTabBar.js has to the
// website's page stack (rendered once in _app.js, not tied to routing).
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
    Fraunces_400Regular, Fraunces_700Bold,
    IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_700Bold
  });
  // The app is portrait everywhere. app.json allows rotation only so the
  // Live player's fullscreen can turn sideways (components/ChannelPlayer.js
  // unlocks and relocks around it).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Hold the first paint for the fonts (so text doesn't visibly swap), but
  // never block forever — after 3s fall through to system fonts.
  const [fontWaitExpired, setFontWaitExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontWaitExpired(true), 3000);
    return () => clearTimeout(t);
  }, []);
  if (!fontsLoaded && !fontError && !fontWaitExpired) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface1 },
            headerTintColor: colors.ink,
            contentStyle: { backgroundColor: colors.surface0 }
          }}
        >
          {/* These 12 are TopNav's screens — every direct bottom-nav
              destination except Vertical Discover (its own full-screen
              takeover, no chrome at all, matching the website). Each
              screen renders <TopNav /> itself, so the native header is
              turned off here rather than just re-titled. */}
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="stream" options={{ headerShown: false }} />
          <Stack.Screen name="live/index" options={{ headerShown: false }} />
          <Stack.Screen name="live/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="about" options={{ headerShown: false }} />
          <Stack.Screen name="pitches/index" options={{ headerShown: false }} />
          <Stack.Screen name="pitches/discover" options={{ headerShown: false }} />
          <Stack.Screen name="university/index" options={{ headerShown: false }} />
          <Stack.Screen name="vertical/discover" options={{ title: 'Vertical Discover' }} />
          <Stack.Screen name="watch/series" options={{ headerShown: false }} />
          <Stack.Screen name="watch/movies" options={{ headerShown: false }} />
          <Stack.Screen name="watch/podcasts" options={{ headerShown: false }} />
          <Stack.Screen name="watch/vertical" options={{ headerShown: false }} />
          <Stack.Screen name="account/index" options={{ headerShown: false }} />
          <Stack.Screen name="account/wishlist" options={{ headerShown: false }} />
          <Stack.Screen name="account/my-work" options={{ headerShown: false }} />
          <Stack.Screen name="search" options={{ title: 'Search' }} />
          <Stack.Screen name="admin/index" options={{ headerShown: false }} />
          <Stack.Screen name="admin/review" options={{ headerShown: false }} />
        </Stack>
        <BottomNav />
      </SafeAreaProvider>
    </ClerkProvider>
    </GestureHandlerRootView>
  );
}
