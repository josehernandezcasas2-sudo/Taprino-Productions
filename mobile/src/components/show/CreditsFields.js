import { Text, View } from 'react-native';
import { CREDIT_KEYS, normalizeCredits } from '../../lib/showRules';
import { ChoiceChips, EdInput, FieldHead, FieldNote } from './EditorBits';
import { LinkText, ss } from './ShowBits';

// Credits in the app (decision 20; the website's components/show/
// CreditsFields.js, the same words): "Made by" the original creator stays
// on top unless the show's owner puts the Studio or the Producer line
// first; each of those is a typed name, optionally linked to an account on
// the site by its @handle (the server resolves the handle and stores
// { name, userId }). An episode's line can also be "Same as the show" (the
// key left out, so it follows the show's). Used by the episode editor and
// Edit show.
//
// The form shape: { studio: line, producer: line, top, hadOrder } where a
// line is { mode: 'inherit' | 'none' | 'own', name, handle, userId } and
// top is 'maker' | 'studio' | 'producer' (or 'inherit' on an episode).

const LINE_LABEL = { studio: 'Studio', producer: 'Producer' };

function lineFrom(c, key, inherit) {
  if (!Object.prototype.hasOwnProperty.call(c, key)) return { mode: inherit ? 'inherit' : 'none', name: '', handle: '', userId: null };
  const v = c[key];
  if (!v) return { mode: 'none', name: '', handle: '', userId: null };
  return { mode: 'own', name: v.name || '', handle: '', userId: v.userId || null };
}

export function creditsToForm(raw, { inherit = false } = {}) {
  const c = normalizeCredits(raw);
  const hadOrder = Array.isArray(c.order);
  return {
    studio: lineFrom(c, 'studio', inherit),
    producer: lineFrom(c, 'producer', inherit),
    top: hadOrder ? c.order[0] : inherit ? 'inherit' : 'maker',
    hadOrder
  };
}

// The body the /api/show routes take: { studio, producer, order? } with
// each line 'inherit', null, { name, handle } (link it) or { name, userId }
// (a link already stored, kept as it is).
export function creditsFormBody(form, { inherit = false, showOrder = null } = {}) {
  const line = (l) => {
    if (!l) return null;
    if (l.mode === 'inherit') return inherit ? 'inherit' : null;
    if (l.mode !== 'own') return null;
    const name = String(l.name || '').trim();
    const handle = String(l.handle || '').trim().replace(/^@+/, '');
    if (handle) return { name: name || null, handle };
    if (l.userId) return { name: name || null, userId: l.userId };
    return name ? { name } : null;
  };
  const out = { studio: line(form.studio), producer: line(form.producer) };
  const top = form.top;
  if (inherit && top === 'inherit') {
    // An episode that follows the show's order: nothing to store unless it
    // had its own before, which becomes the show's order as it is now.
    if (form.hadOrder) out.order = Array.isArray(showOrder) && showOrder.length ? showOrder : CREDIT_KEYS;
  } else {
    const first = CREDIT_KEYS.includes(top) ? top : 'maker';
    out.order = [first, ...CREDIT_KEYS.filter((k) => k !== first)];
  }
  return out;
}

export function creditsFormKey(form, opts) {
  return JSON.stringify(creditsFormBody(form, opts));
}

function inheritedName(showCredits, key) {
  const c = normalizeCredits(showCredits);
  const v = c[key];
  return v ? v.name || 'an account on the site' : null;
}

export default function CreditsFields({ value, onChange, inherit = false, showCredits = null, makerName = null, makerLabel = 'Made by', policy = null }) {
  const locked = Boolean(policy) && policy.mode !== 'direct';
  const setLine = (key, patch) => onChange({ ...value, [key]: { ...value[key], ...patch } });
  const nameOf = (key) => {
    const l = value[key];
    if (l.mode === 'own') return String(l.name || '').trim() || (l.userId ? 'a linked account' : null);
    if (l.mode === 'inherit') return inheritedName(showCredits, key);
    return null;
  };
  const showOrder = normalizeCredits(showCredits).order || CREDIT_KEYS;
  const order = value.top === 'inherit' ? showOrder : [value.top, ...CREDIT_KEYS.filter((k) => k !== value.top)];
  const preview = order
    .map((k) => (k === 'maker' ? (makerName ? `${makerLabel} ${makerName}` : null) : nameOf(k) ? `${LINE_LABEL[k]} ${nameOf(k)}` : null))
    .filter(Boolean);
  return (
    <View style={{ gap: 14 }}>
      {['studio', 'producer'].map((key) => {
        const l = value[key];
        const inheritedLabel = inheritedName(showCredits, key);
        const options = [
          ...(inherit ? [{ value: 'inherit', label: `Same as the show${inheritedLabel ? ` (${inheritedLabel})` : ' (none)'}` }] : []),
          { value: 'none', label: 'None' },
          { value: 'own', label: inherit ? 'Its own' : `Add a ${key}` }
        ];
        return (
          <View key={key} style={{ gap: 6 }}>
            <FieldHead label={LINE_LABEL[key]} hint="optional" />
            <ChoiceChips options={options} value={l.mode} disabled={locked} onChange={(mode) => setLine(key, { mode })} />
            {l.mode === 'own' ? (
              <View style={{ gap: 6 }}>
                <EdInput
                  value={l.name}
                  maxLength={120}
                  disabled={locked}
                  placeholder={key === 'studio' ? 'Studio name' : 'Producer’s name'}
                  accessibilityLabel={`${LINE_LABEL[key]} name`}
                  onChangeText={(t) => setLine(key, { name: t })}
                />
                {l.userId && !String(l.handle || '').trim() ? (
                  <Text style={ss.small}>
                    Linked to their account on the site · <LinkText disabled={locked} onPress={() => setLine(key, { userId: null })}>Unlink</LinkText>
                  </Text>
                ) : (
                  <EdInput
                    value={l.handle}
                    maxLength={41}
                    disabled={locked}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="@handle, if they’re on the site"
                    accessibilityLabel={`${LINE_LABEL[key]}’s @handle on the site`}
                    onChangeText={(t) => setLine(key, { handle: t })}
                  />
                )}
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={{ gap: 6 }}>
        <FieldHead label="On top" />
        <ChoiceChips
          options={[
            ...(inherit ? [{ value: 'inherit', label: 'Same as the show' }] : []),
            { value: 'maker', label: `${makerLabel} (the original creator)` },
            { value: 'studio', label: 'Studio' },
            { value: 'producer', label: 'Producer' }
          ]}
          value={value.top}
          disabled={locked}
          onChange={(top) => onChange({ ...value, top })}
        />
      </View>
      <Text style={ss.small}>{preview.length ? <>On the page: <Text style={ss.strong}>{preview.join(' · ')}</Text></> : 'No credit lines yet.'}</Text>
      <FieldNote policy={policy} />
    </View>
  );
}
