import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Home() {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Text style={styles.title}>Studio Tapa TV</Text>
      <Text style={styles.subtitle}>
        This is the first screen of the native app — everything else (feeds, playback,
        sign-in) gets built one screen at a time on top of this shell.
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
  title: {
    color: '#f5e9d3',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12
  },
  subtitle: {
    color: '#b8ab8f',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22
  }
});
