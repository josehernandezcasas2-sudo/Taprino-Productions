import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

// For nav destinations that exist on the site but don't have a real
// screen built here yet — keeps the app's map matching the site's
// instead of hiding pages the nav can't reach yet.
export default function ComingSoon({ title, note }) {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.note}>
          {note || "Not built yet — it's in the nav so the app's map matches the site's, but there's no real content here yet."}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  note: { color: colors.inkDim, fontSize: 14, textAlign: 'center', lineHeight: 20 }
});
