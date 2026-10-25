import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '../lib/theme';
import { absoluteUrl } from '../lib/api';

// The "Not for AI training" seal, the app's mirror of components/AiSeal.js
// (Jose, 2026-10-25): the AI sparkle struck through, in the dim ink
// colour, never brass or gold. Tapping any form opens the policy page on
// the website; there is no in-app copy of it.
export const AI_POLICY_PATH = '/ai-policy';
export const SEAL_LABEL = 'Not for AI training';

export function openAiPolicy() {
  return WebBrowser.openBrowserAsync(absoluteUrl(AI_POLICY_PATH)).catch(() => {});
}

export function AiSealGlyph({ size = 12, color = colors.inkDim, strokeWidth = 2 }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M12 3c.6 3.9 3.1 6.4 7 7-3.9.6-6.4 3.1-7 7-.6-3.9-3.1-6.4-7-7 3.9-.6 6.4-3.1 7-7z" />
      <Path d="M4 20 20 4" />
    </Svg>
  );
}

export function AiSealChip({ style }) {
  return (
    <Pressable style={[styles.chip, style]} onPress={openAiPolicy} accessibilityRole="link" accessibilityLabel={`${SEAL_LABEL}. Read the policy`}>
      <AiSealGlyph />
      <Text style={styles.chipText}>{SEAL_LABEL}</Text>
    </Pressable>
  );
}

export function AiSealLine({ style }) {
  return (
    <Pressable style={[styles.line, style]} onPress={openAiPolicy} accessibilityRole="link" accessibilityLabel={`${SEAL_LABEL}. Read the policy`}>
      <AiSealGlyph />
      <Text style={styles.lineText}>{SEAL_LABEL}</Text>
    </Pressable>
  );
}

// The profile's card: a larger glyph and one line in the person's name.
export function AiSealCard({ name, style }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'This';
  const possessive = /s$/i.test(first) ? `${first}’` : `${first}’s`;
  return (
    <Pressable style={[styles.card, style]} onPress={openAiPolicy} accessibilityRole="link" accessibilityLabel={`${possessive} work is not for AI training. Read the policy`}>
      <View style={styles.cardRing}><AiSealGlyph size={22} strokeWidth={1.9} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.cardTitle}>{possessive} work is not for AI training</Text>
        <Text style={styles.cardText}>Nothing on Studio Tapa TV is licensed for training or data mining. Read the policy →</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingLeft: 8, paddingRight: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(179, 161, 140, 0.5)' },
  chipText: { fontFamily: fonts.displayBold, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkDim },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderBottomWidth: 1, borderBottomColor: 'rgba(179, 161, 140, 0.7)', borderStyle: 'dotted', paddingBottom: 1 },
  lineText: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, backgroundColor: colors.surface2 },
  cardRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.inkDim, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.ink, marginBottom: 2 },
  cardText: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkDim }
});
