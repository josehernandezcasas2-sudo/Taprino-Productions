import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors, fonts, oliveTint } from '../lib/theme';
import { hrefToRoute } from './PushListener';

// The owner's private preview (the series revamp, slice 4; decision 2,
// amendment 5; board V3 of the series canvas): the bar under the site
// header on a series or episode screen opened with ?preview=1, and the
// footnote at the foot of the page. The words come from the server
// (lib/showRules.js previewBarWords, sent as `preview.strong` / `.text`),
// so the app and the website say the same thing. The link is the show
// page: /creator/show/<id> opens the app's own screen, the team's
// /admin/shows/<id> opens the website (hrefToRoute decides).

function EyeIcon({ size = 18, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

function EyeOffIcon({ size = 13, color = colors.inkDim }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1" />
      <Path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <Line x1="3" y1="3" x2="21" y2="21" />
    </Svg>
  );
}

function ArrowIcon({ size = 14, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12h14" />
      <Path d="M13 6l6 6-6 6" />
    </Svg>
  );
}

// Opens a site address the way a notification does: an app screen when the
// app has one, else the website in the browser.
export function openSiteHref(router, href) {
  const where = hrefToRoute(href);
  if (!where) return;
  if (where.route) router.push(where.route);
  else Linking.openURL(where.url).catch(() => {});
}

// `preview` = { strong, text, linkHref, linkLabel } (the server's words).
export default function PreviewBar({ preview }) {
  const router = useRouter();
  if (!preview) return null;
  const label = preview.linkLabel || 'Open show page';
  return (
    <View style={styles.bar} accessibilityLabel="Preview" accessible={false}>
      <View style={styles.line}>
        <View style={styles.icon}><EyeIcon /></View>
        <Text style={styles.text}>
          {preview.strong ? <Text style={styles.strong}>{preview.strong}</Text> : null}
          {preview.strong && preview.text ? ' ' : ''}
          {preview.text || ''}
        </Text>
      </View>
      {preview.linkHref ? (
        <Pressable
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.75 }]}
          onPress={() => openSiteHref(router, preview.linkHref)}
          accessibilityRole="link"
          accessibilityLabel={label}
        >
          <Text style={styles.linkText}>{label}</Text>
          <ArrowIcon />
        </Pressable>
      ) : null}
    </View>
  );
}

// The line at the foot of a previewed page.
export function PreviewFootnote() {
  return (
    <View style={styles.foot}>
      <EyeOffIcon />
      <Text style={styles.footText}>Hidden from search (noindex). Anyone else gets “not found”. Your plays here don’t count as views.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: oliveTint(0.12), borderBottomWidth: 1, borderBottomColor: oliveTint(0.4), paddingTop: 12, paddingHorizontal: 19, paddingBottom: 14, gap: 10 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { marginTop: 1 },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20.3, color: colors.ink },
  strong: { fontFamily: fonts.bodyBold },
  link: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: oliveTint(0.7), marginLeft: 28 },
  linkText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.olive },
  foot: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6, marginBottom: 22 },
  footText: { flex: 1, fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 15.5, color: colors.inkDim }
});
