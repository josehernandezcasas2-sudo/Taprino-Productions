import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { MAIN_GENRES } from '../../../lib/submitRules';
import { useContentRatings } from '../../../lib/contentAdvisory';
import { showCall } from '../../../lib/showApi';
import { colors, fonts, inkTint } from '../../../lib/theme';
import { AccountFrame } from '../../../components/account/AccountBits';
import { Check, Chips, Field, PrimaryButton, Switch, cp, pickImageAsDataUrl } from '../../../components/CreatorBits';
import SmartImage from '../../../components/SmartImage';
import { PREMIUM_WORD, UploadIcon, LinkText, ss } from '../../../components/show/ShowBits';

// New show in the app (the series revamp, slice 5; the website's
// pages/creator/show/new.js, spec "New show"): name it, say what it is (a
// series or a podcast), one line about it, the defaults its episodes start
// from (genre, rating, Who can watch, Made by, ads — copied onto each
// episode as it is added), and the art or "Cut them from the first episode
// for me". Create the show → POST /api/show → the show page, which says it
// is ready for its episodes. The show is private until its owner makes it
// public (decision 2: once an episode is approved). People who start from
// the file keep the three-step submit's inline "+ New show".

const NAME_MAX = 120;
const ABOUT_MAX = 2000;

export default function NewShowScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // Null until /api/ratings has answered once this session.
  const ratings = useContentRatings() || [];
  const [gate, setGate] = useState({ state: 'checking' });
  const [name, setName] = useState('');
  const [kind, setKind] = useState('series');
  const [about, setAbout] = useState('');
  const [mainGenre, setMainGenre] = useState('');
  const [rating, setRating] = useState('');
  const [tier, setTier] = useState('free');
  const [artist, setArtist] = useState('');
  const [artistTouched, setArtistTouched] = useState(false);
  const [adsEnabled, setAdsEnabled] = useState(true);
  const [poster, setPoster] = useState(null);
  const [still, setStill] = useState(null);
  const [cut, setCut] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const podcast = kind === 'podcast';
  const noArt = !poster && !still;

  // Who may start a show (a creator or the team: GET /api/show answers
  // 403 otherwise), and the name "Made by" starts from.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined;
    let alive = true;
    (async () => {
      const [shows, profile] = await Promise.all([
        showCall('GET', '/api/show', undefined, getToken),
        showCall('GET', '/api/account/profile', undefined, getToken)
      ]);
      if (!alive) return;
      if (shows.status === 403) setGate({ state: 'forbidden', line: shows.error });
      else setGate({ state: 'open' });
      const display = profile.ok && profile.data ? profile.data.displayName : null;
      // The placeholder name a profile without one carries isn't a credit.
      if (display && display !== 'A viewer') setArtist((a) => (artistTouched || a ? a : display));
    })();
    return () => { alive = false; };
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = !name.trim() ? 'Name it to go on.' : name.trim().length > NAME_MAX ? `A name is limited to ${NAME_MAX} characters.` : about.trim().length > ABOUT_MAX ? `The line about it is limited to ${ABOUT_MAX.toLocaleString('en-US')} characters.` : null;

  async function pickArt(which) {
    setError(null);
    try {
      const img = await pickImageAsDataUrl({ width: which === 'poster' ? 600 : 1280 });
      if (!img) return;
      if (which === 'poster') setPoster(img); else setStill(img);
    } catch (err) {
      setError(err.message);
    }
  }

  async function create() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    const defaults = { tier, adsEnabled };
    if (mainGenre) defaults.mainGenre = mainGenre;
    if (rating) defaults.rating = rating;
    if (artist.trim()) defaults.artist = artist.trim();
    const body = {
      name: name.trim(),
      kind,
      description: about.trim(),
      defaults,
      ...(poster ? { posterBase64: poster.base64, posterFileName: 'poster.jpg' } : {}),
      ...(still ? { thumbnailBase64: still.base64, thumbnailFileName: 'still.jpg' } : {}),
      cutFromFirst: noArt && cut
    };
    const r = await showCall('POST', '/api/show', body, getToken);
    if (!r.ok) {
      setError(r.error || 'Could not create the show.');
      setSaving(false);
      return;
    }
    router.replace(`/creator/show/${encodeURIComponent(r.data.id)}?created=1`);
  }

  const dashboard = !isLoaded ? null : { isSignedIn: Boolean(isSignedIn) };
  const back = { href: '/creator', label: 'Creator Studio' };

  if (gate.state === 'forbidden') {
    return (
      <AccountFrame title="Start a show" dashboard={dashboard} back={back}>
        <View style={cp.card}>
          <Text style={cp.p}>{gate.line}</Text>
          <Text style={cp.p}>Creator Studio opens once an application is accepted.</Text>
          <PrimaryButton label="Send us your film" onPress={() => router.push('/apply')} />
        </View>
      </AccountFrame>
    );
  }

  return (
    <AccountFrame title="Start a show" dashboard={dashboard} back={back}>
      <View style={{ gap: 6, marginTop: -8 }}>
        <Text style={cp.eyebrow}>New show</Text>
        <Text style={cp.lede}>Name it now; episodes come next. Once one is approved, you choose when it goes public.</Text>
      </View>

      <View style={cp.card}>
        <Field label="Name" note={`${name.length} / ${NAME_MAX}`}>
          <TextInput style={[cp.input, ns.name]} value={name} maxLength={NAME_MAX} onChangeText={setName} placeholder={podcast ? 'The show’s name' : 'The series’ name'} placeholderTextColor={colors.inkFaint} autoCorrect={false} />
        </Field>

        <Field label="Kind">
          <Chips options={[{ value: 'series', label: 'Series' }, { value: 'podcast', label: 'Podcast' }]} value={kind} onChange={setKind} />
          <Text style={cp.help}>Fixed once the first episode is in.</Text>
        </Field>

        <Field label="One line about it" note={`${about.length} / ${ABOUT_MAX.toLocaleString('en-US')}`}>
          <TextInput style={[cp.input, cp.textarea, { minHeight: 70 }]} multiline value={about} maxLength={ABOUT_MAX} onChangeText={setAbout} placeholder={podcast ? 'What it’s about, in a line.' : 'What happens, in a line.'} placeholderTextColor={colors.inkFaint} />
          <Text style={cp.help}>You can write more later.</Text>
        </Field>
      </View>

      <View style={cp.card}>
        <Text style={cp.cardK}>Defaults for its episodes</Text>
        <Text style={cp.help}>Copied onto each episode you add from now on. You can change any episode.</Text>
        <Field label="Genre">
          <View style={cp.chips}>
            {MAIN_GENRES.map((g) => {
              const on = mainGenre === g;
              return (
                <Pressable key={g} style={[cp.chip, cp.chipSmall, on && cp.chipOn]} onPress={() => setMainGenre(on ? '' : g)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={[cp.chipText, cp.chipTextSmall]}>{g}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
        <Field label="Rating" note="not set = treated as 17+">
          <Chips small options={[{ value: '', label: 'Not set' }, ...ratings.map((r) => ({ value: r.code, label: r.code }))]} value={rating} onChange={setRating} />
        </Field>
        <Field label="Who can watch">
          <Chips options={[{ value: 'free', label: 'Free with ads' }, { value: 'premium', label: PREMIUM_WORD }]} value={tier} onChange={setTier} />
          <Text style={cp.help}>Free with ads, or {PREMIUM_WORD} members only. The studio has the final say.</Text>
        </Field>
        <Field label={podcast ? 'Hosted by' : 'Made by'}>
          <TextInput style={cp.input} value={artist} maxLength={120} onChangeText={(t) => { setArtistTouched(true); setArtist(t); }} placeholder="Your name, as credited" placeholderTextColor={colors.inkFaint} />
        </Field>
        <Switch on={adsEnabled} label="Ads between scenes" onPress={() => setAdsEnabled((v) => !v)} />
      </View>

      <View style={cp.card}>
        <Text style={cp.cardK}>Art · optional</Text>
        <View style={ns.artRow}>
          <ArtSlot label="Poster 2:3" shape="poster" image={poster} onPick={() => pickArt('poster')} onClear={() => setPoster(null)} />
          <ArtSlot label="Still · 16:9" shape="still" image={still} onPick={() => pickArt('still')} onClear={() => setStill(null)} />
        </View>
        {noArt ? <Check on={cut} onPress={() => setCut((v) => !v)}>Cut them from the first episode for me</Check> : null}
        <Text style={cp.help}>{noArt ? 'Swap them any time from Edit show.' : 'The other one can be added any time from Edit show.'}</Text>
      </View>

      {error ? <Text style={cp.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
      <View style={{ gap: 10 }}>
        <PrimaryButton label={saving ? 'Creating…' : 'Create the show'} busy={saving} disabled={Boolean(blocked) || gate.state === 'checking'} onPress={create} />
        {blocked ? <Text style={cp.note}>{blocked}</Text> : null}
        <Text style={[ss.small, { textAlign: 'center' }]}>
          Have the first episode ready? <LinkText onPress={() => router.push(`/creator/submit?type=${podcast ? 'podcast' : 'series'}`)}>Start from the file instead</LinkText>
        </Text>
      </View>
    </AccountFrame>
  );
}

function ArtSlot({ label, shape, image, onPick, onClear }) {
  const box = shape === 'poster' ? ns.poster : ns.still;
  return (
    <View style={{ gap: 6, alignItems: 'flex-start' }}>
      <Pressable style={[box, ns.slot, image && ns.slotFilled]} onPress={onPick} accessibilityRole="button" accessibilityLabel={image ? `${label}: pick another` : `${label}: pick an image`}>
        {image ? <SmartImage uri={image.uri} style={box} resizeMode="cover" /> : (
          <View style={ns.slotEmpty}><UploadIcon size={18} color={colors.inkDim} /><Text style={ns.slotText}>{label}</Text></View>
        )}
      </Pressable>
      {image ? <LinkText onPress={onClear}>Remove</LinkText> : null}
    </View>
  );
}

const ns = StyleSheet.create({
  name: { fontFamily: fonts.bodyBold, fontSize: 18, height: 48 },
  artRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' },
  poster: { width: 104, height: 156, borderRadius: 8 },
  still: { width: 176, height: 99, borderRadius: 8 },
  slot: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: inkTint(0.35), overflow: 'hidden', backgroundColor: colors.surface0 },
  slotFilled: { borderStyle: 'solid', borderColor: inkTint(0.2) },
  slotEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 },
  slotText: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkDim, textAlign: 'center' }
});
