import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '../lib/theme';

// "Did a creator send you?" above the plans on the Account screen, for
// anyone not yet on a paid plan — the website's components/ReferredByField.js.
// Prefilled from a creator link opened in the app (lib/referral.js); a
// typed handle is checked at checkout. That creator earns the referral
// bonus; it never changes the member's price or where their share goes.
export default function ReferredByField({ value, onChange, fromLink }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Did a creator send you? <Text style={styles.optional}>optional</Text></Text>
      <View style={styles.row}>
        <Text style={styles.at}>@</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(t) => onChange(t.replace(/^@+/, ''))}
          placeholder="their handle"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={64}
          accessibilityLabel="Handle of the creator who sent you"
        />
      </View>
      <Text style={styles.note}>
        {fromLink && value === fromLink ? 'From the creator link you opened. ' : ''}
        They earn a thank-you bonus from us while you're a member. It never changes your price or where your share goes.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 2, marginBottom: 16 },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.inkDim, marginBottom: 6 },
  optional: { color: colors.inkFaint, textTransform: 'none', letterSpacing: 0 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(251,232,211,0.14)', borderRadius: 8, backgroundColor: colors.surface2 },
  at: { fontFamily: fonts.mono, color: colors.inkFaint, paddingLeft: 10 },
  input: { flex: 1, color: colors.ink, fontFamily: fonts.mono, fontSize: 14, paddingVertical: 9, paddingLeft: 4, paddingRight: 10 },
  note: { fontSize: 12.5, lineHeight: 18, color: colors.inkFaint, marginTop: 6 }
});
