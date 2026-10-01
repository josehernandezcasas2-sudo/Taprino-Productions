import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';
import TopNav from '../components/TopNav';

// Mirrors pages/about.js content, stacked single-column the same way the
// site's own @media (max-width: 900px) rule collapses the two-column
// label+body layout — this screen never had a wide column to begin with.
const CONTACT_EMAIL = 'info@studiotapa.com';

export default function About() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>ABOUT</Text>
        <Text style={styles.h1}>Indie work has a distribution problem.</Text>
        <Text style={styles.lede}>We built a smaller, more deliberate screening room around it.</Text>
        <Text style={styles.sub}>
          <Text style={styles.strong}>Studio Tapa TV</Text> is a streaming service and networking app run by
          Taprino Productions, designed for indie films and projects. A lot of what's here is free with ads.
          They help maintain the site and fund new projects that not only help the community but tell the story
          of the creator.
        </Text>

        <View style={styles.divider} />

        <Section label="01 — WHAT THIS IS">
          <Text style={styles.body}>
            Studio Tapa TV exists because independent work has a distribution problem. Finishing a short film or
            a series is hard enough; getting it in front of people who'd actually want to watch it is somehow
            harder.
          </Text>
          <View style={styles.pull}>
            <Text style={styles.body}>
              We take a smaller, more deliberate approach: work is{' '}
              <Text style={styles.strongOlive}>reviewed and programmed</Text> rather than uploaded and forgotten.
            </Text>
          </View>
        </Section>

        <Section label="02 — HOW IT WORKS">
          <View style={styles.card}>
            <View style={[styles.tag, { borderColor: colors.mint }]}>
              <Text style={[styles.tagText, { color: colors.mint }]}>FOR VIEWERS</Text>
            </View>
            <Text style={styles.cardBody}>
              Most of the catalogue is free and supported by advertising — no account needed to watch, but an
              account is highly recommended. Making a free account adds a watchlist and remembers where you left
              off across devices.
            </Text>
          </View>
          <View style={styles.card}>
            <View style={[styles.tag, { borderColor: colors.brass }]}>
              <Text style={[styles.tagText, { color: colors.brass }]}>FOR CREATORS</Text>
            </View>
            <Text style={styles.cardBody}>
              We don't run open uploads. Creators apply, and if the work isn't a fit, we'll let you know. When it
              is, we work with creators so their work can be shown not just on our platform but others too — we
              handle the encoding, captioning, and publishing ourselves.
            </Text>
          </View>
        </Section>

        <View style={styles.callout}>
          <Text style={[styles.label, { color: colors.olive, marginBottom: 8 }]}>03 — ACCESSIBILITY</Text>
          <Text style={styles.body}>
            We caption what we can and mark clearly on every episode page which accessibility features are
            available. We're not where we want to be on this yet — tell us if something isn't working for you.
          </Text>
        </View>

        <Section label="04 — WHO RUNS IT">
          <Text style={styles.mastheadLine}>Operated by Taprino Productions.</Text>
          <Text style={styles.mastheadSub}>
            It's a small operation, which is why the catalogue grows deliberately.
          </Text>
          <Text style={styles.mastheadDate}>LAST UPDATED AUGUST 13, 2026</Text>
        </Section>

        <View style={styles.cta}>
          <Text style={styles.ctaTitle}>Get in touch</Text>
          <Text style={styles.ctaBody}>
            Real inbox, real person reading it. We might take a while... but we'll get to it.
          </Text>
          <Pressable style={styles.ctaBtn} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>
            <Text style={styles.ctaBtnText}>Contact us →</Text>
          </Pressable>
          <Text style={styles.ctaEmail}>{CONTACT_EMAIL}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ label, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 120 },

  eyebrow: { color: colors.olive, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },
  h1: { color: colors.ink, fontSize: 28, fontWeight: '800', lineHeight: 34, marginBottom: 10 },
  lede: { color: colors.oliveBright, fontSize: 15, fontStyle: 'italic', marginBottom: 12, lineHeight: 22 },
  sub: { color: colors.inkDim, fontSize: 14, lineHeight: 22 },
  strong: { color: colors.ink, fontWeight: '700' },
  strongOlive: { color: colors.oliveBright, fontWeight: '600' },

  divider: { height: 1, backgroundColor: colors.ink, opacity: 0.18, marginVertical: 24 },

  section: { marginBottom: 28 },
  label: { color: colors.inkDim, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  body: { color: colors.inkDim, fontSize: 14, lineHeight: 22 },

  pull: { borderLeftWidth: 3, borderLeftColor: colors.oliveDeep, paddingLeft: 14, marginTop: 14 },

  card: { backgroundColor: colors.surface2, borderRadius: 16, borderWidth: 1, borderColor: colors.oceanInk, padding: 18, marginBottom: 14 },
  tag: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 12 },
  tagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  cardBody: { color: colors.inkDim, fontSize: 13, lineHeight: 20 },

  callout: { backgroundColor: colors.surface2, borderRadius: 16, borderWidth: 1, borderColor: colors.olive, padding: 20, marginBottom: 28 },

  mastheadLine: { color: colors.ink, fontSize: 17, marginBottom: 6 },
  mastheadSub: { color: colors.oliveDeep, fontSize: 11, fontWeight: '600', marginBottom: 6 },
  mastheadDate: { color: colors.inkFaint, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },

  cta: { borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: 18, padding: 22 },
  ctaTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  ctaBody: { color: colors.inkDim, fontSize: 14, marginBottom: 16, lineHeight: 20 },
  ctaBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignSelf: 'flex-start', marginBottom: 12 },
  ctaBtnText: { color: colors.onBrass, fontWeight: '800', fontSize: 14 },
  ctaEmail: { color: colors.inkDim, fontSize: 13, textDecorationLine: 'underline' }
});
