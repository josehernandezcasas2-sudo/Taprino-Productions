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
          <Stack.Screen name="index" options={{ title: 'Home' }} />
          <Stack.Screen name="stream" options={{ title: 'Stream' }} />
          <Stack.Screen name="about" options={{ title: 'About' }} />
          <Stack.Screen name="pitches/index" options={{ title: 'Pitch Room' }} />
          <Stack.Screen name="pitches/discover" options={{ title: 'Pitch Discover' }} />
          <Stack.Screen name="vertical/discover" options={{ title: 'Vertical Discover' }} />
          <Stack.Screen name="watch/series" options={{ title: 'Watch Series' }} />
          <Stack.Screen name="watch/movies" options={{ title: 'Watch Movies' }} />
          <Stack.Screen name="watch/podcasts" options={{ title: 'Podcasts' }} />
          <Stack.Screen name="watch/vertical" options={{ title: 'Vertical' }} />
          <Stack.Screen name="account/index" options={{ title: 'Account' }} />
          <Stack.Screen name="account/wishlist" options={{ title: 'My List' }} />
          <Stack.Screen name="account/my-work" options={{ title: 'My Work' }} />
        </Stack>
        <BottomNav />
      </SafeAreaProvider>
    </ClerkProvider>
    </GestureHandlerRootView>
  );
}
