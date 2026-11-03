import { CREDIT_KEYS, normalizeCredits } from '../../lib/showRules';
import { FieldHead, FieldNote } from './EditorBits';

// Credits (decision 20): "Made by" the original creator stays on top unless
// the show's owner puts the Studio or the Producer line first; each of
// those is a typed name, optionally linked to an account on the site by
// its @handle (the server resolves the handle and stores { name, userId }).
// An episode's line can also be "Same as the show" (the key left out, so it
// follows the show's). Used by the episode editor and Edit show.
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

export default function CreditsFields({ idPrefix = 'credits', value, onChange, inherit = false, showCredits = null, makerName = null, makerLabel = 'Made by', policy = null }) {
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
    <div className="show-credits">
      {['studio', 'producer'].map((key) => {
        const l = value[key];
        const sid = `${idPrefix}-${key}`;
        return (
          <div className="show-credits-row" key={key}>
            <FieldHead htmlFor={`${sid}-mode`} label={LINE_LABEL[key]} hint="optional" />
            <select id={`${sid}-mode`} className="show-ed-select" value={l.mode} disabled={locked} onChange={(e) => setLine(key, { mode: e.target.value })}>
              {inherit && <option value="inherit">Same as the show{inheritedName(showCredits, key) ? ` (${inheritedName(showCredits, key)})` : ' (none)'}</option>}
              <option value="none">None</option>
              <option value="own">{inherit ? 'Its own' : `Add a ${key}`}</option>
            </select>
            {l.mode === 'own' && (
              <div className="show-credits-own">
                <input
                  id={`${sid}-name`}
                  className="show-ed-input"
                  type="text"
                  value={l.name}
                  maxLength={120}
                  disabled={locked}
                  placeholder={key === 'studio' ? 'Studio name' : 'Producer’s name'}
                  aria-label={`${LINE_LABEL[key]} name`}
                  onChange={(e) => setLine(key, { name: e.target.value })}
                />
                {l.userId && !String(l.handle || '').trim() ? (
                  <p className="show-credits-linked">
                    Linked to their account on the site ·{' '}
                    <button type="button" className="show-ed-link" disabled={locked} onClick={() => setLine(key, { userId: null })}>Unlink</button>
                  </p>
                ) : (
                  <input
                    id={`${sid}-handle`}
                    className="show-ed-input"
                    type="text"
                    value={l.handle}
                    maxLength={41}
                    disabled={locked}
                    placeholder="@handle, if they’re on the site"
                    aria-label={`${LINE_LABEL[key]}’s @handle on the site`}
                    onChange={(e) => setLine(key, { handle: e.target.value })}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="show-credits-row">
        <FieldHead htmlFor={`${idPrefix}-top`} label="On top" />
        <select id={`${idPrefix}-top`} className="show-ed-select" value={value.top} disabled={locked} onChange={(e) => onChange({ ...value, top: e.target.value })}>
          {inherit && <option value="inherit">Same as the show</option>}
          <option value="maker">{makerLabel} (the original creator)</option>
          <option value="studio">Studio</option>
          <option value="producer">Producer</option>
        </select>
      </div>
      <p className="show-credits-preview">{preview.length ? <>On the page: <strong>{preview.join(' · ')}</strong></> : 'No credit lines yet.'}</p>
      <FieldNote policy={policy} />
    </div>
  );
}
