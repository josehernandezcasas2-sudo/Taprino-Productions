import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, useUser } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { colors } from '../../lib/theme';

// Hosted Account Portal auth (an in-app browser, same sign-in page the
// website uses) rather than a hand-rolled form — the one Expo auth
// approach that works inside Expo Go with no dev build.
export default function Account() {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    try {
      await startHostedAuth();
    } catch (err) {
      Alert.alert('Sign-in failed', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  if (!isLoaded) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }

  if (isSignedIn) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.title}>
          {user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Signed in'}
        </Text>
        {user?.primaryEmailAddress?.emailAddress ? (
          <Text style={styles.subtitle}>{user.primaryEmailAddress.emailAddress}</Text>
        ) : null}
        <Pressable style={[styles.button, styles.buttonSecondary]} onPress={handleSignOut} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.buttonText}>Sign out</Text>}
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.center} edges={['bottom']}>
      <Text style={styles.title}>Not signed in</Text>
      <Text style={styles.subtitle}>Sign in with the same account you use on studiotapatv.site.</Text>
      <Pressable style={styles.button} onPress={handleSignIn} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.buttonTextDark}>Sign in</Text>}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: colors.inkDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  button: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28, minWidth: 140, alignItems: 'center' },
  buttonSecondary: { backgroundColor: colors.surface2, marginTop: 4 },
  buttonText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  buttonTextDark: { color: colors.onBrass, fontSize: 15, fontWeight: '700' }
});
