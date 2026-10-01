import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
          <Stack.Screen name="about" options={{ headerShown: false }} />
          <Stack.Screen name="pitches/index" options={{ headerShown: false }} />
          <Stack.Screen name="pitches/discover" options={{ headerShown: false }} />
          <Stack.Screen name="vertical/discover" options={{ title: 'Vertical Discover' }} />
          <Stack.Screen name="watch/series" options={{ headerShown: false }} />
          <Stack.Screen name="watch/movies" options={{ headerShown: false }} />
          <Stack.Screen name="watch/podcasts" options={{ headerShown: false }} />
          <Stack.Screen name="watch/vertical" options={{ headerShown: false }} />
          <Stack.Screen name="account/index" options={{ headerShown: false }} />
          <Stack.Screen name="account/wishlist" options={{ headerShown: false }} />
          <Stack.Screen name="account/my-work" options={{ headerShown: false }} />
          <Stack.Screen name="search" options={{ title: 'Search' }} />
        </Stack>
        <BottomNav />
      </SafeAreaProvider>
    </ClerkProvider>
    </GestureHandlerRootView>
  );
}
