// The website's Pitch Room list looks like the app's screen (2026-11-17,
// Jose: "The website version does not look like that app version, can we
// make it look more like it … let's take the paragraph out so it looks
// like an actual app"; then "sum up and simplify whatever is in that
// section … so the user can see the projects quicker"). pages/pitches.js,
// the .prm-* styles: one title row (Pitch Room, Swipe ideas, the creator's
// +), the search that says how many, one chip row (the sort, the kinds).
//
// Seeds three pitches (one with a goal and a deadline, one taking backing,
// one with nothing but a title), switches the Pitch Room on, and checks:
// no paragraph and no Back pill, the short title row, Swipe ideas, the
// creator's + only for a creator, the first card high on a phone, search
// with a clear button and the count in it, the sort, the tag pills, the cards
// (art or the initial, tag, heart, deadline, by-line, logline, the funding
// line, Back it), the heart saving and unsaving, a signed-out heart asking
// to sign in, one column on a phone and a grid beside a side-by-side head
// on a laptop, nothing off the side at 320, 390 and 1280. Puts it all back.
//
//   node dev/test-rig/checks/pitch-room.mjs   (the rig must be up)
import crypto from 'node:crypto';
import { USERS, SIGNED_OUT, RUN, ok, section, runCheck, session, browser, goto, overflowPx, rows, sql, q, insert } from './lib.mjs';

const MARA = session(USERS.mara);
const VIEWER = session(USERS.viewer);
const A = crypto.randomUUID();
const B = crypto.randomUUID();
const C = crypto.randomUUID();
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const T = { a: `Harbour Lights ${RUN}`, b: `Salt Roads ${RUN}`, c: `Zinnia ${RUN}` };

// Clerk's browser library as far as the heart needs it: nobody signed in,
// and what the site asks it to open is written down (as sign-in-here.mjs).
const FAKE_CLERK = `
(() => {
  window.__clerkCalls = [];
  const nobody = { client: { sessions: [], signedInSessions: [], signIn: {}, signUp: {} }, session: null, user: null, organization: null };
  const base = {
    version: '5.0.0-rig', loaded: false, status: 'ready', telemetry: undefined, ...nobody,
    load: async function () { this.loaded = true; },
    addListener(cb) { try { cb(nobody); } catch (e) {} return () => {}; },
    on() {}, off() {},
    openSignIn(props) { window.__clerkCalls.push({ kind: 'openSignIn', props: props || {} }); },
    openSignUp(props) { window.__clerkCalls.push({ kind: 'openSignUp', props: props || {} }); },
    closeSignIn() {}, closeSignUp() {}
  };
  window.Clerk = new Proxy(base, { get(t, k) { if (k in t) return t[k]; if (k === 'then') return undefined; return () => undefined; } });
})();
`;

const cardTitles = (pg) => pg.$$eval('.prm-card .prm-card-title', (els) => els.map((e) => e.textContent.trim()));
const ours = (titles) => titles.filter((t) => t.endsWith(RUN));
const box = (pg, sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; });

await runCheck('pitch-room', async () => {
  const was = rows('select elevator_pitch_enabled from public.site_settings where id = 1')[0];
  sql('update public.site_settings set elevator_pitch_enabled = true where id = 1');
  insert('pitches', { id: A, title: T.a, logline: 'A lighthouse keeper’s daughter films the last winter before the light goes automatic.', project_url: 'https://example.com/a', status: 'approved', created_by: USERS.mara, tag: 'Animation', funding_goal: 4000, funding_raised: 1000, funding_deadline: inDays(5) });
  insert('pitches', { id: B, title: T.b, logline: 'Two sisters walk the old salt route.', project_url: 'https://example.com/b', status: 'approved', created_by: USERS.mara, tag: 'Documentary', funding_enabled: true, platform_cut_percent: 5, funding_goal: 2000 });
  insert('pitches', { id: C, title: T.c, logline: 'Short.', project_url: 'https://example.com/c', status: 'approved', creator_name: 'Pat Lee' });
  const b = await browser();
  try {
    section('Signed out on a phone (390)');
    {
      const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 390);
      await ctx.route('**/clerk.browser.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_CLERK }));
      await goto(pg, '/pitches');
      await pg.waitForSelector('.prm-card');
      const text = await pg.$eval('main', (e) => e.innerText);
      ok('the paragraph is gone', !/Projects looking for backing/.test(text) && !(await pg.$('.library-sub')), text.slice(0, 200));
      ok('no Back pill', !(await pg.$('main .back-pill, main .back-btn, main .back-button, main .library-back')) && !/^\s*Back\s*$/m.test(text));
      ok('the slogan is gone too: the title is just “Pitch Room”', (await pg.$eval('.prm-title', (e) => e.innerText.trim())) === 'Pitch Room' && !/Back what gets/.test(text));
      ok('…in the serif, as in the app', /Fraunces/.test(await pg.$eval('.prm-title', (e) => getComputedStyle(e).fontFamily)));
      const swipe = await pg.$eval('.prm-swipe', (e) => ({ href: e.getAttribute('href'), text: e.innerText.trim(), bg: getComputedStyle(e).backgroundImage, h: e.getBoundingClientRect().height }));
      ok('Swipe ideas is a pill to the swipe deck, on the orange gradient', swipe.href === '/pitches/discover' && swipe.text === 'Swipe ideas' && /linear-gradient/.test(swipe.bg) && swipe.h <= 44, swipe);
      const row = await pg.evaluate(() => { const t = document.querySelector('.prm-title').getBoundingClientRect(); const a = document.querySelector('.prm-top-actions').getBoundingClientRect(); return { titleRight: t.right, actionsLeft: a.left, sameRow: Math.abs((t.top + t.bottom) / 2 - (a.top + a.bottom) / 2) < 6 }; });
      ok('…beside the title on one row', row.sameRow && row.titleRight <= row.actionsLeft, row);
      ok('no Discover card, no creator buttons, no count line', !(await pg.$('.prm-discover')) && !(await pg.$('.prm-add')) && !(await pg.$('.prm-creator-row')) && !(await pg.$('.prm-count')));
      const titles = await cardTitles(pg);
      ok('our three pitches are listed', ours(titles).length === 3, titles);
      ok('the search says how many there are', (await pg.$eval('.prm-search input', (e) => e.placeholder)) === `Search ${titles.length} ${titles.length === 1 ? 'project' : 'projects'}…`);
      const sort = await pg.$eval('.prm-sort select', (e) => ({ value: e.value, options: [...e.options].map((o) => o.textContent) }));
      ok('the sort is one pill with the three choices, Newest first', sort.value === 'newest' && sort.options.join('|') === 'Newest|Closest to goal|Most saved' && (await pg.$eval('.prm-sort > span', (e) => e.textContent.trim())) === 'Newest', sort);
      const firstCard = await pg.$eval('.prm-card', (e) => Math.round(e.getBoundingClientRect().top));
      ok('the first card starts high on the phone (under 300px)', firstCard < 300, firstCard);
      const card = (title) => pg.$$eval('.prm-card', (els, t) => {
        const el = els.find((e) => e.querySelector('.prm-card-title').textContent.trim() === t);
        if (!el) return null;
        const g = (s) => { const n = el.querySelector(s); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; };
        return { tag: g('.prm-card-tag'), deadline: g('.prm-deadline'), by: g('.prm-by'), logline: g('.prm-logline'), raised: el.querySelector('.prm-funding-row') ? `${g('.prm-raised')} · ${g('.prm-pct')}` : null, backIt: g('.prm-back-it'), initial: g('.prm-initial'), bare: el.querySelector('.prm-art').classList.contains('bare'), heart: !!el.querySelector('.prm-save'), fill: el.querySelector('.prm-fill') ? el.querySelector('.prm-fill').style.width : null };
      }, title);
      const a = await card(T.a);
      ok('a card: tag, deadline, by-line, logline', a && a.tag === 'Animation' && /days left/i.test(a.deadline) && /^by /.test(a.by) && /lighthouse/.test(a.logline), a);
      ok('…the funding line as the app: $1,000 of $4,000 · 25%', a && a.raised === '$1,000 of $4,000 · 25%' && a.fill === '25%', a);
      ok('…no Back it when backing is off', a && a.backIt === null, a);
      const bb = await card(T.b);
      ok('a card taking backing: $0.00 of $2,000 · 0%, a sliver of bar, Back it', bb && bb.raised === '$0.00 of $2,000 · 0%' && bb.fill === '2%' && bb.backIt === 'Back it', bb);
      const c = await card(T.c);
      ok('a card with no art: the gradient and the initial', c && c.bare && c.initial === 'Z', c);
      ok('…by the name typed on the pitch, no funding line', c && c.by === 'by Pat Lee' && c.raised === null, c);
      const widths = await pg.$$eval('.prm-card', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
      const stage = await pg.$eval('.prm-grid', (e) => Math.round(e.getBoundingClientRect().width));
      ok('one card across, the full width', widths.every((w) => Math.abs(w - stage) <= 1), { widths, stage });
      ok('nothing runs off the side', (await overflowPx(pg)) <= 0);

      // Search, clear, sorts, tags.
      await pg.fill('.prm-search input', T.b);
      ok('search narrows to the one', JSON.stringify(await cardTitles(pg)) === JSON.stringify([T.b]));
      await pg.click('.prm-clear');
      ok('✕ clears it', (await pg.$eval('.prm-search input', (e) => e.value)) === '' && ours(await cardTitles(pg)).length === 3);
      await pg.fill('.prm-search input', 'Pat Lee');
      ok('search finds a creator’s name too', ours(await cardTitles(pg)).join('|') === T.c);
      await pg.fill('.prm-search input', '');
      await pg.selectOption('.prm-sort select', 'closest');
      const closest = ours(await cardTitles(pg));
      ok('Closest to goal: 25% before 0%, no goal last', closest.join('|') === [T.a, T.b, T.c].join('|'), closest);
      ok('…and the pill says so', (await pg.$eval('.prm-sort > span', (e) => e.textContent.trim())) === 'Closest to goal');
      const tags = await pg.$$eval('.prm-tag-pill', (els) => els.map((e) => e.textContent.trim()));
      ok('tag pills: All and the kinds in use', tags[0] === 'All' && tags.includes('Animation') && tags.includes('Documentary'), tags);
      await pg.click('.prm-tag-pill:has-text("Documentary")');
      ok('a tag shows only that kind', (await cardTitles(pg)).every((t) => !t.endsWith(RUN) || t === T.b) && ours(await cardTitles(pg)).length === 1);
      await pg.click('.prm-tag-pill:has-text("All")');

      // The heart signed out asks to sign in and stays on the page.
      await pg.waitForFunction(() => window.Clerk && window.Clerk.loaded === true, null, { timeout: 30000 });
      await pg.$$eval('.prm-card', (els, t) => els.find((e) => e.querySelector('.prm-card-title').textContent.trim() === t).querySelector('.prm-save').click(), T.a);
      await pg.waitForTimeout(300);
      const calls = await pg.evaluate(() => window.__clerkCalls);
      ok('a signed-out heart opens sign-in and comes back here', calls.length === 1 && calls[0].kind === 'openSignIn' && /\/pitches$/.test(calls[0].props.forceRedirectUrl || ''), calls);
      ok('…and stays on the Pitch Room', new URL(pg.url()).pathname === '/pitches');
      ok('no page errors', errors.length === 0, errors);
      await pg.screenshot({ path: '/tmp/studio-tapa-rig/pitch-room-390.png', fullPage: false });
      await ctx.close();
    }

    section('A small phone (320)');
    {
      const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 320);
      await goto(pg, '/pitches');
      await pg.waitForSelector('.prm-card');
      ok('nothing runs off the side at 320', (await overflowPx(pg)) <= 0);
      const row = await pg.evaluate(() => { const t = document.querySelector('.prm-title').getBoundingClientRect(); const a = document.querySelector('.prm-top-actions').getBoundingClientRect(); return { titleRight: t.right, actionsLeft: a.left, swipeWords: getComputedStyle(document.querySelector('.prm-swipe span')).display }; });
      ok('the title still fits beside Swipe (its icon alone at 320)', row.titleRight <= row.actionsLeft && row.swipeWords === 'none', row);
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('A creator on a phone: the + to pitch, the heart saves');
    {
      const { ctx, page: pg, errors } = await b.open(MARA, 390);
      await goto(pg, '/pitches');
      await pg.waitForSelector('.prm-card');
      const add = await pg.$eval('.prm-add', (e) => ({ href: e.getAttribute('href'), label: e.getAttribute('aria-label'), text: e.textContent.trim() }));
      ok('a round + to submit a project, beside Swipe ideas', add.href === '/creator/pitch/new' && add.label === 'Submit your project' && add.text === '+', add);
      ok('…on the title row, which still fits', await pg.evaluate(() => { const t = document.querySelector('.prm-title').getBoundingClientRect(); const a = document.querySelector('.prm-top-actions').getBoundingClientRect(); return t.right <= a.left && document.querySelector('.prm-top-actions').contains(document.querySelector('.prm-add')); }));
      sql(`delete from public.pitch_saves where user_id = ${q(USERS.mara)} and pitch_id = ${q(A)}`);
      const heart = () => pg.$$eval('.prm-card', (els, t) => els.find((e) => e.querySelector('.prm-card-title').textContent.trim() === t).querySelector('.prm-save').click(), T.a);
      const savedRows = () => rows(`select 1 from public.pitch_saves where user_id = ${q(USERS.mara)} and pitch_id = ${q(A)}`).length;
      const waitFor = async (n) => { for (let i = 0; i < 60 && savedRows() !== n; i++) await pg.waitForTimeout(250); return savedRows(); };
      await heart();
      await waitFor(1);
      ok('the heart saves', rows(`select 1 from public.pitch_saves where user_id = ${q(USERS.mara)} and pitch_id = ${q(A)}`).length === 1);
      ok('…and shows it', await pg.$$eval('.prm-card', (els, t) => { const s = els.find((e) => e.querySelector('.prm-card-title').textContent.trim() === t).querySelector('.prm-save'); return s.classList.contains('on') && s.getAttribute('aria-pressed') === 'true'; }, T.a));
      await heart();
      await waitFor(0);
      ok('a second tap unsaves', rows(`select 1 from public.pitch_saves where user_id = ${q(USERS.mara)} and pitch_id = ${q(A)}`).length === 0);
      ok('nothing runs off the side', (await overflowPx(pg)) <= 0);
      ok('no page errors', errors.length === 0, errors);
      await pg.screenshot({ path: '/tmp/studio-tapa-rig/pitch-room-390-creator.png', fullPage: false });
      await ctx.close();
    }

    section('A viewer on a laptop (1280)');
    {
      const { ctx, page: pg, errors } = await b.open(VIEWER, 1280);
      await goto(pg, '/pitches');
      await pg.waitForSelector('.prm-card');
      const title = await box(pg, '.prm-title');
      const swipe = await box(pg, '.prm-swipe');
      ok('the title on the left, Swipe ideas on the right of one row', swipe.left > title.right + 200 && Math.abs((swipe.top + swipe.bottom) / 2 - (title.top + title.bottom) / 2) < 8, { title, swipe });
      ok('no + for a viewer', !(await pg.$('.prm-add')));
      const search = await box(pg, '.prm-search');
      const chips = await box(pg, '.prm-sort');
      ok('search and the chips on one line', Math.abs((search.top + search.bottom) / 2 - (chips.top + chips.bottom) / 2) < 6 && chips.left > search.right - 1, { search, chips });
      const lefts = await pg.$$eval('.prm-card', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
      ok('the cards make a grid', lefts.length >= 3, lefts);
      ok('nothing runs off the side', (await overflowPx(pg)) <= 0);
      ok('no page errors', errors.length === 0, errors);
      await pg.screenshot({ path: '/tmp/studio-tapa-rig/pitch-room-1280.png', fullPage: false });
      await ctx.close();
    }
  } finally {
    sql(`delete from public.pitches where id in (${q(A)}, ${q(B)}, ${q(C)})`);
    sql(`update public.site_settings set elevator_pitch_enabled = ${was && (was.elevator_pitch_enabled === true || was.elevator_pitch_enabled === 't') ? 'true' : 'false'} where id = 1`);
    await b.close();
  }
});
