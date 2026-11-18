// node scripts/test-message-rules.mjs — the simpler Messages' rules
// (lib/messageRules.js, 2026-11-18): what a conversation is about and where
// it links back to, the All / Unread filters and the search, the times, the
// days and the runs in a conversation, the next-message subject and the
// people search's query. The app's copy is checked word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/messageRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const local = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const NOW = new Date(2026, 10, 18, 15, 0).getTime(); // Wed Nov 18, 3 PM

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/messageRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/messageRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('what a conversation is about, on its row', () => {
  assert.equal(R.contextLine(null), 'Direct message');
  assert.equal(R.contextLine({ kind: 'call', label: 'Gaffer' }), 'About a call · Gaffer');
  assert.equal(R.contextLine({ kind: 'production', label: 'Night Bus' }), 'About a production · Night Bus');
  assert.equal(R.contextLine({ kind: 'location', label: '' }), 'About a place');
  assert.equal(R.contextLine({ kind: 'nonsense', label: 'x' }), 'Direct message');
  assert.ok(R.CONTEXT_KINDS.includes('production'));
});

t('where it links back to', () => {
  const other = { profilePath: '/profile/dee' };
  const id = '3f2b1c4d-0000-4000-8000-000000000001';
  assert.deepEqual(R.contextLink({ kind: 'call', label: 'Gaffer', id }, other), { href: `/crew/calls/${id}`, label: 'Open the call' });
  assert.deepEqual(R.contextLink({ kind: 'location', label: 'Loft', id }, other), { href: `/locations/${id}`, label: 'Open the place' });
  assert.deepEqual(R.contextLink({ kind: 'production', label: 'Night Bus', id }, other), { href: `/productions/${id}`, label: 'Open the production' });
  assert.deepEqual(R.contextLink({ kind: 'gear', label: 'FX3' }, other), { href: '/profile/dee', label: 'See their gear' });
  assert.deepEqual(R.contextLink({ kind: 'card', label: 'Gaffer' }, other), { href: '/profile/dee', label: 'See their card' });
  assert.equal(R.contextLink({ kind: 'profile', label: 'Dee' }, other), null);
  assert.equal(R.contextLink({ kind: 'call', label: 'Gaffer' }, other), null, 'no id, no link');
  assert.equal(R.contextLink({ kind: 'call', label: 'x', id: '../admin' }, other), null, 'a strange id never becomes a link');
  assert.equal(R.contextLink({ kind: 'gear', label: 'x' }, { profilePath: 'https://evil.example' }), null);
  assert.equal(R.contextLink(null, other), null);
});

const THREADS = [
  { id: 'a', other: { displayName: 'Dee Park', handle: 'deepark' }, preview: 'Sounds good', context: { kind: 'call', label: 'Gaffer' }, unread: true },
  { id: 'b', other: { displayName: 'Mara Reyes', handle: 'mara' }, preview: 'Is the loft free?', context: { kind: 'location', label: 'Echo Park loft' }, unread: true },
  { id: 'c', other: { displayName: 'Peeps', handle: null }, preview: 'Hi', context: null, unread: false }
];

t('All and Unread, and the search over names, @handles, the last line and the subject', () => {
  assert.deepEqual(R.filterThreads(THREADS).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(R.filterThreads(THREADS, { filter: 'unread' }).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(R.filterThreads(THREADS, { query: 'dee' }).map((x) => x.id), ['a']);
  assert.deepEqual(R.filterThreads(THREADS, { query: '@mara' }).map((x) => x.id), ['b']);
  assert.deepEqual(R.filterThreads(THREADS, { query: 'LOFT' }).map((x) => x.id), ['b']);
  assert.deepEqual(R.filterThreads(THREADS, { query: 'gaffer' }).map((x) => x.id), ['a']);
  assert.deepEqual(R.filterThreads(THREADS, { filter: 'unread', query: 'hi' }).map((x) => x.id), []);
  assert.equal(R.filterLabel('unread', THREADS), 'Unread · 2');
  assert.equal(R.filterLabel('unread', [THREADS[2]]), 'Unread');
  assert.equal(R.filterLabel('all', THREADS), 'All');
  assert.equal(R.emptyFilterLine('unread', ''), 'You’re all caught up.');
  assert.equal(R.emptyFilterLine('all', 'zzz'), 'Nothing matches that.');
});

t('the time on a row: the clock today, the weekday this week, else the date', () => {
  assert.equal(R.listTime(local(2026, 11, 18, 9, 42), NOW), '9:42 AM');
  assert.equal(R.listTime(local(2026, 11, 17, 20, 5), NOW), 'Tue');
  assert.equal(R.listTime(local(2026, 10, 18), NOW), 'Oct 18');
  assert.equal(R.listTime(local(2025, 12, 1), NOW), 'Dec 1, 2025');
  assert.equal(R.listTime(null, NOW), '');
});

t('a conversation by day, with the time under the last message of each run', () => {
  const me = 'user_me';
  const msgs = [
    { id: '1', senderId: 'user_dee', body: 'Hi', createdAt: local(2026, 11, 17, 18, 10) },
    { id: '2', senderId: me, body: 'Great', createdAt: local(2026, 11, 17, 18, 12) },
    { id: '3', senderId: 'user_dee', body: 'Yes', createdAt: local(2026, 11, 17, 18, 13) },
    { id: '4', senderId: 'user_dee', body: 'And tubes', createdAt: local(2026, 11, 17, 18, 14) },
    { id: '5', senderId: me, body: 'Stands?', createdAt: local(2026, 11, 18, 9, 40) },
    { id: '6', senderId: 'user_dee', body: 'Sure', createdAt: local(2026, 11, 18, 9, 42) }
  ];
  const g = R.dayGroups(msgs, me, NOW);
  assert.deepEqual(g.map((x) => x.label), ['Yesterday', 'Today']);
  assert.deepEqual(g[0].items.map((m) => [m.id, m.mine, m.time]), [['1', false, '6:10 PM'], ['2', true, '6:12 PM'], ['3', false, ''], ['4', false, '6:14 PM']]);
  assert.deepEqual(g[1].items.map((m) => [m.id, m.mine, m.time]), [['5', true, '9:40 AM'], ['6', false, '9:42 AM']]);
  assert.equal(R.dayLabel(local(2026, 11, 14), NOW), 'Sat, Nov 14');
  assert.equal(R.dayLabel(local(2026, 9, 2), NOW), 'Sep 2');
  assert.deepEqual(R.dayGroups(null, me, NOW), []);
});

t('the next message’s subject, the people query, the words', () => {
  assert.equal(R.pendingAbout({ kind: 'production', label: 'Night Bus' }), 'Your next message is about Night Bus');
  assert.equal(R.pendingAbout(null), null);
  assert.deepEqual(R.peopleQuery('  @dee '), { q: 'dee', handle: true, ready: true });
  assert.deepEqual(R.peopleQuery('d'), { q: 'd', handle: false, ready: false });
  assert.equal(R.personLine({ handle: 'dee', why: 'Night Bus' }), '@dee · Night Bus');
  assert.equal(R.personLine({ handle: null, why: '' }), '');
  assert.equal(R.firstName('Dee Park'), 'Dee');
  assert.equal(R.firstName(''), 'them');
  assert.equal(R.MESSAGE_WORDS.placeholder('Dee'), 'Message Dee…');
});

console.log(`\n${n} checks passed`);
