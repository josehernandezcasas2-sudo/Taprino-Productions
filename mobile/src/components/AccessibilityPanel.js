import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, inkTint, warnTint } from '../lib/theme';

// The website's Accessibility panel under the description
// (components/AccessibilityPanel.js), in the app (2026-11-12: the app had
// none). The same fields and the same words: whether it flashes, whether
// there are captions, whether a described version exists, whether there
// is a transcript, the creator's accessibility notes, and where to tell us.
// What isn't there yet says so rather than staying silent.
//
// The described version doesn't play in the app yet: its row says so and
// opens the title on the website, where it does. `onOpenWebsite` opens it;
// `contactEmail` is the site's address.
export default function AccessibilityPanel({ episode, hasAudioDescription = false, onOpenWebsite = null, contactEmail, onLayout = null }) {
  if (!episode) return null;
  const hasCaptions = Boolean(episode.captionsUrl);
  const hasTranscript = Boolean(episode.transcriptUrl);
  const notes = episode.accessibilityNotes || null;
  const flashing = episode.hasFlashingLights === true;
  const openTranscript = () => { if (episode.transcriptUrl) Linking.openURL(episode.transcriptUrl).catch(() => {}); };

  return (
    <View style={styles.panel} onLayout={onLayout} accessibilityRole="summary" accessibilityLabel="Accessibility">
      <Text style={styles.heading} accessibilityRole="header">Accessibility</Text>

      {flashing ? (
        <View style={styles.warning} accessibilityRole="alert">
          <Text style={styles.warningText}>
            <Text style={styles.warningStrong}>Flashing lights.</Text> This episode contains flashing or strobing images that may affect viewers with photosensitive epilepsy.
          </Text>
        </View>
      ) : null}

      <Row yes={hasCaptions} title="Captions">
        {hasCaptions ? `${episode.captionsLabel || 'English'} · turn on with the CC button` : 'Not available for this episode yet'}
      </Row>

      <Row yes={hasAudioDescription} title="Audio description">
        {hasAudioDescription ? (
          <>
            A described version narrates what happens on screen. It plays on the website for now.{' '}
            {onOpenWebsite ? <Text style={styles.link} onPress={onOpenWebsite} accessibilityRole="link">Watch it on the website</Text> : null}
          </>
        ) : 'Not available for this episode yet'}
      </Row>

      <Row yes={hasTranscript} title="Transcript">
        {hasTranscript ? <Text style={styles.link} onPress={openTranscript} accessibilityRole="link">Read the full transcript</Text> : 'Not available for this episode yet'}
      </Row>

      {notes ? <Text style={styles.notes}>{notes}</Text> : null}

      <Text style={styles.foot}>
        Something here not working for you? Tell us at{' '}
        <Text style={styles.footLink} onPress={() => Linking.openURL(`mailto:${contactEmail}`).catch(() => {})} accessibilityRole="link">{contactEmail}</Text>
        {' '}— we’d rather know.
      </Text>
    </View>
  );
}

function Mark({ yes }) {
  return yes ? (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.ok} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 12l5 5L20 6" />
    </Svg>
  ) : (
    <Text style={styles.markNo}>—</Text>
  );
}

function Row({ yes, title, children }) {
  return (
    <View style={styles.row}>
      <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Mark yes={yes} /></View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={[styles.rowNote, !yes && styles.rowNoteNo]}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 4, marginBottom: 24, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: inkTint(0.12), backgroundColor: colors.surface1, gap: 12 },
  heading: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.inkDim },
  warning: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: warnTint(0.55), backgroundColor: warnTint(0.1) },
  warningText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19.5, color: colors.ink },
  warningStrong: { fontFamily: fonts.displaySemi, color: colors.warn },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  mark: { width: 18, paddingTop: 2, alignItems: 'center' },
  markNo: { fontFamily: fonts.mono, fontSize: 13, color: colors.inkFaint },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  rowNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18.5, color: colors.inkDim },
  rowNoteNo: { color: colors.inkFaint },
  link: { color: colors.olive, textDecorationLine: 'underline' },
  notes: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim },
  foot: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkFaint },
  footLink: { color: colors.inkDim, textDecorationLine: 'underline' }
});
