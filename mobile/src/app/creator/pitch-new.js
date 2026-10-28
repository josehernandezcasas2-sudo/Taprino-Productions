import { useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { apiPost } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';

// Submit a project (components/AddPitchForm.js on the web): the same
// fields, posted to the same /api/creator/create-pitch route, which lands
// the pitch as "pending" for an admin to approve. Images go up as data
// URLs the way the account screen sends avatars.
const PAPER = '#241a05';
// lib/pitches.js PITCH_TAGS, in the site's order.
const PITCH_TAGS = ['Documentary', 'Narrative Film', 'Short Film', 'Series', 'Animation', 'Vertical', 'Podcast', 'Music Video', 'Other'];

async function pickImage(width) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library access is needed to pick an image.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets || !result.assets[0]) return null;
  const rendered = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  return { uri: saved.uri, base64: `data:image/jpeg;base64,${saved.base64}`, fileName: 'image.jpg' };
}

export default function NewPitch() {
  const router = useRouter();
  const { getToken } = useAuth();
  const scrollRef = useRef(null);
  // "Raised so far" left the form on 2026-10-28 (the website's too).
  const [form, setForm] = useState({ title: '', logline: '', description: '', projectUrl: '', tag: '', fundingGoal: '', fundingDeadline: '' });
  const [team, setTeam] = useState([{ name: '', role: '' }]);
  const [thumb, setThumb] = useState(null);
  const [hero, setHero] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updateMember = (i, k, v) => setTeam((t) => t.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  async function choose(setter, width) {
    try {
      const picked = await pickImage(width);
      if (picked) setter(picked);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit() {
    setError(null);
    if (!form.title.trim() || !form.logline.trim()) {
      setError('A title and a one-line logline are required.');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (form.fundingDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(form.fundingDeadline)) {
      setError('Write the deadline as YYYY-MM-DD.');
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      await apiPost('/api/creator/create-pitch', {
        ...form,
        team: team.filter((m) => m.name.trim()),
        thumbnailBase64: thumb ? thumb.base64 : null,
        thumbnailFileName: thumb ? thumb.fileName : null,
        heroImageBase64: hero ? hero.base64 : null,
        heroImageFileName: hero ? hero.fileName : null
      }, token);
      Alert.alert('Submitted', 'Your project is in. Studio Tapa reviews it before it goes live in the Pitch Room.');
      router.replace('/creator/pitches');
    } catch (err) {
      setError(err.message);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView ref={scrollRef} style={styles.scrollView} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>Pitch Room</Text>
        <Text style={styles.h1}>Submit a project</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Title</Text>
        <TextInput style={styles.input} value={form.title} onChangeText={(v) => update('title', v)} placeholder="Your project's name" placeholderTextColor={colors.inkFaint} />

        <Text style={styles.label}>Logline <Text style={styles.hint}>one sentence</Text></Text>
        <TextInput style={styles.input} value={form.logline} onChangeText={(v) => update('logline', v)} placeholder="What it's about, in a line" placeholderTextColor={colors.inkFaint} />

        <Text style={styles.label}>Full description <Text style={styles.hint}>optional</Text></Text>
        <TextInput style={[styles.input, styles.textarea]} value={form.description} onChangeText={(v) => update('description', v)} multiline placeholder="The project, the plan, who it's for" placeholderTextColor={colors.inkFaint} />

        <Text style={styles.label}>Project type</Text>
        <View style={styles.chips}>
          {PITCH_TAGS.map((tag) => (
            <Pressable key={tag} style={[styles.chip, form.tag === tag && styles.chipOn]} onPress={() => update('tag', form.tag === tag ? '' : tag)}>
              <Text style={[styles.chipText, form.tag === tag && styles.chipTextOn]}>{tag}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Where should “Fund this project” send people? <Text style={styles.hint}>optional — leave blank to take backing here once payouts are set up</Text></Text>
        <TextInput style={styles.input} value={form.projectUrl} onChangeText={(v) => update('projectUrl', v)} placeholder="https://kickstarter.com/..." placeholderTextColor={colors.inkFaint} autoCapitalize="none" keyboardType="url" />

        <Text style={styles.label}>Funding goal <Text style={styles.hint}>optional</Text></Text>
        <TextInput style={styles.input} value={form.fundingGoal} onChangeText={(v) => update('fundingGoal', v)} keyboardType="number-pad" placeholder="2000" placeholderTextColor={colors.inkFaint} />
        <Text style={styles.label}>Funding deadline <Text style={styles.hint}>optional, YYYY-MM-DD</Text></Text>
        <TextInput style={styles.input} value={form.fundingDeadline} onChangeText={(v) => update('fundingDeadline', v)} placeholder="2026-12-31" placeholderTextColor={colors.inkFaint} autoCapitalize="none" />

        <Text style={styles.label}>Thumbnail <Text style={styles.hint}>shown in the Pitch Room grid</Text></Text>
        <View style={styles.pickRow}>
          {thumb ? <Image source={{ uri: thumb.uri }} style={styles.preview} /> : null}
          <Pressable style={styles.btnSecondary} onPress={() => choose(setThumb, 800)}><Text style={styles.btnSecondaryText}>{thumb ? 'Change' : 'Choose image'}</Text></Pressable>
        </View>
        <Text style={styles.label}>Hero image <Text style={styles.hint}>the banner on your project page</Text></Text>
        <View style={styles.pickRow}>
          {hero ? <Image source={{ uri: hero.uri }} style={[styles.preview, styles.previewWide]} /> : null}
          <Pressable style={styles.btnSecondary} onPress={() => choose(setHero, 1600)}><Text style={styles.btnSecondaryText}>{hero ? 'Change' : 'Choose image'}</Text></Pressable>
        </View>

        <Text style={styles.label}>Team</Text>
        {team.map((m, i) => (
          <View key={i} style={styles.row}>
            <TextInput style={[styles.input, { flex: 1 }]} value={m.name} onChangeText={(v) => updateMember(i, 'name', v)} placeholder="Name" placeholderTextColor={colors.inkFaint} />
            <TextInput style={[styles.input, { flex: 1 }]} value={m.role} onChangeText={(v) => updateMember(i, 'role', v)} placeholder="Role" placeholderTextColor={colors.inkFaint} />
          </View>
        ))}
        <Pressable style={styles.btnSmall} onPress={() => setTeam((t) => [...t, { name: '', role: '' }])}><Text style={styles.btnSmallText}>+ Add team member</Text></Pressable>

        <Pressable style={[styles.btnPrimary, saving && styles.btnDisabled]} disabled={saving} onPress={submit}>
          <Text style={styles.btnPrimaryText}>{saving ? 'Submitting…' : 'Submit for review'}</Text>
        </Pressable>
        <Text style={styles.fine}>Studio Tapa reviews every project before it goes live. Backing through the site needs your payouts set up first (Your pitches → Get paid).</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 19, paddingBottom: 120 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.olive, marginBottom: 8 },
  h1: { fontFamily: fonts.displayBold, fontSize: 32, lineHeight: 34, color: colors.ink, marginBottom: 14 },
  label: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, marginTop: 12, marginBottom: 6 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkDim },
  fine: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim, marginTop: 14 },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginBottom: 8 },
  input: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline, borderRadius: 6, color: colors.ink, fontFamily: fonts.body, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  chipOn: { backgroundColor: colors.olive, borderColor: colors.olive },
  chipText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  chipTextOn: { color: PAPER },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  preview: { width: 72, height: 72, borderRadius: 6, backgroundColor: colors.surface2 },
  previewWide: { width: 120, height: 54 },
  btnPrimary: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 24, alignItems: 'center', alignSelf: 'flex-start', marginTop: 22 },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14, color: PAPER },
  btnSecondary: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
  btnSecondaryText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.ink },
  btnSmall: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, alignSelf: 'flex-start', marginTop: 2 },
  btnSmallText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  btnDisabled: { opacity: 0.45 }
});
