import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Profile() {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Text style={styles.title}>Sign-in not wired up yet</Text>
      <Text style={styles.subtitle}>
        This tab becomes the real profile once Clerk auth (@clerk/clerk-expo) is added.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#161005',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  title: { color: '#f5e9d3', fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: '#b8ab8f', fontSize: 14, textAlign: 'center', lineHeight: 20 }
});
