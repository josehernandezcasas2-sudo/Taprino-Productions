// The bits of lib/messages.js the browser needs too (the composer's
// limit, the "about" kinds). Kept apart because lib/messages.js pulls in
// Clerk's server client, which can't be bundled into a page.
export const MAX_MESSAGE_CHARS = 2000;
export const CONTEXT_KINDS = ['card', 'gear', 'call', 'profile'];
export const CONTEXT_LABELS = { gear: 'About gear', call: 'About a call', card: 'From a card', profile: 'From a profile' };
