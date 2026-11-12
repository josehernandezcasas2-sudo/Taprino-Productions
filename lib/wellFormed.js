// Text from a request, made well formed before anything stores it
// (2026-11-12). A JavaScript string can hold a lone surrogate — half of an
// emoji pair, or "\ud800" sent as JSON on purpose — and Postgres refuses
// one ("unsupported Unicode escape sequence"), so a save carrying it
// answered 500 "Could not save your changes." (PATCH
// /api/show/episode/<id> with an extraKind or pageNotes of "ab\ud800cd",
// and every other text field). Each lone surrogate becomes U+FFFD, the
// replacement character, the way String.prototype.toWellFormed does it;
// a real pair is left alone.
//
// Pure, client-safe, imports nothing. Tested by node
// scripts/test-well-formed.mjs. Applied where request text enters: the
// /api/show/** routes' plumbing (lib/showRoute.js startShowRoute), the
// older creator and admin edit routes (title, description, page notes),
// the three-step submit and the drafts route. lib/extraKinds.js drops a
// lone surrogate outright (a category is a short label).

export const REPLACEMENT_CHAR = '�';
const MAX_DEPTH = 32;

function manualWellFormed(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      } else {
        out += REPLACEMENT_CHAR;
      }
      continue;
    }
    out += c >= 0xdc00 && c <= 0xdfff ? REPLACEMENT_CHAR : text[i];
  }
  return out;
}

// One string: well formed, or as it was when it already is; anything that
// isn't a string comes back as it is.
export function wellFormed(value) {
  if (typeof value !== 'string') return value;
  if (typeof value.isWellFormed === 'function') return value.isWellFormed() ? value : value.toWellFormed();
  return manualWellFormed(value);
}

// Every string inside a parsed JSON value (objects and arrays, in place;
// own keys only, so nothing on a prototype is touched). Keys are made well
// formed too. Deeper than MAX_DEPTH is left as it is (no request the site
// takes nests that far).
export function wellFormedDeep(value, depth = 0) {
  if (typeof value === 'string') return wellFormed(value);
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = wellFormedDeep(value[i], depth + 1);
    return value;
  }
  // Written with defineProperty: a parsed body can carry an own key named
  // "__proto__", and a plain assignment to it would set the prototype.
  const own = (key, v) => Object.defineProperty(value, key, { value: v, writable: true, enumerable: true, configurable: true });
  for (const key of Object.keys(value)) {
    const clean = wellFormed(key);
    const v = wellFormedDeep(value[key], depth + 1);
    if (clean !== key) {
      delete value[key];
      own(clean, v);
    } else if (v !== value[key]) {
      own(key, v);
    }
  }
  return value;
}

// A Next API route's parsed body, cleaned in place; returns it.
export function wellFormedBody(req) {
  if (!req || req.body === undefined || req.body === null) return req ? req.body : undefined;
  req.body = wellFormedDeep(req.body);
  return req.body;
}
