// Episode and series ids are text: slugs made from the title plus a stamp
// ("night-bus-last-stop-lx3k9a", "placeholder-movie-lx3k9a"), and a few
// older ids from the first catalogue ("cipher-lore"). A uuid fits too.
// Client-safe, no imports.
//
// This is only a sanity check on an id that arrives from a browser (a
// tracking pixel, a query string) before it is used: it is never an access
// check, and it does not prove the title exists. Never test a title id
// against a uuid pattern: that is how ad share recorded nothing from the
// day it shipped (2026-10-24) until migration 117.
export const TITLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export function isTitleId(value) {
  return typeof value === 'string' && TITLE_ID_PATTERN.test(value);
}
