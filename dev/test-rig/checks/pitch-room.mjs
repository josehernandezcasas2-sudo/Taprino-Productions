// The website's Pitch Room list looks like the app's screen (2026-11-17,
// Jose: "The website version does not look like that app version, can we
// make it look more like it … let's take the paragraph out so it looks
// like an actual app"). pages/pitches.js, the .prm-* styles.
//
// Seeds three pitches (one with a goal and a deadline, one taking backing,
// one with nothing but a title), switches the Pitch Room on, and checks:
// no paragraph and no Back pill, the kicker and headline, the Discover
// card, the creator's buttons only for a creator, search with a clear
// button, the three sorts as buttons, the tag pills, the count, the cards
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
      ok('the kicker reads Pitch Room', (await pg.$eval('.prm-kicker', (e) => e.textContent.trim())) === 'Pitch Room');
      ok('the headline reads “Back what gets made next.”', (await pg.$eval('.prm-title', (e) => e.innerText.replace(/\s+/g, ' ').trim())) === 'Back what gets made next.');
      ok('the headline is the serif, as in the app', /Fraunces/.test(await pg.$eval('.prm-title', (e) => getComputedStyle(e).fontFamily)));
      const disc = await pg.$eval('.prm-discover', (e) => ({ href: e.getAttribute('href'), text: e.innerText.replace(/\s+/g, ' ').trim(), bg: getComputedStyle(e).backgroundImage }));
      ok('the Discover card goes to the swipe deck and says so', disc.href === '/pitches/discover' && /Discover/i.test(disc.text) && /Swipe through ideas/.test(disc.text), disc);
      ok('…on the orange gradient', /linear-gradient/.test(disc.bg), disc.bg);
      ok('no creator buttons signed out', !(await pg.$('.prm-creator-row')));
      const sorts = await pg.$$eval('.prm-sort', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('aria-pressed')]));
      ok('three sorts as buttons, Newest pressed', JSON.stringify(sorts) === JSON.stringify([['Newest', 'true'], ['Closest to goal', 'false'], ['Most saved', 'false']]), sorts);
      const sortTops = await pg.$$eval('.prm-sort', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      ok('…in one row', new Set(sortTops).size === 1, sortTops);
      const titles = await cardTitles(pg);
      ok('our three pitches are listed', ours(titles).length === 3, titles);
      ok('the count matches the cards', (await pg.$eval('.prm-count', (e) => e.textContent.trim())) === `${titles.length} ${titles.length === 1 ? 'project' : 'projects'}`);
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
      await pg.click('.prm-sort:has-text("Closest to goal")');
      const closest = ours(await cardTitles(pg));
      ok('Closest to goal: 25% before 0%, no goal last', closest.join('|') === [T.a, T.b, T.c].join('|'), closest);
      ok('…and that button is pressed', (await pg.$eval('.prm-sort[aria-pressed="true"]', (e) => e.textContent.trim())) === 'Closest to goal');
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
      const sorts = await pg.$$eval('.prm-sort', (els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1));
      ok('the three sorts still fit', sorts.every(Boolean), sorts);
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('A creator on a phone: the two buttons, the heart saves');
    {
      const { ctx, page: pg, errors } = await b.open(MARA, 390);
      await goto(pg, '/pitches');
      await pg.waitForSelector('.prm-card');
      const links = await pg.$$eval('.prm-creator-row a', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href')]));
      ok('Submit your project and Your pitches', JSON.stringify(links) === JSON.stringify([['+ Submit your project', '/creator/pitch/new'], ['Your pitches', '/creator/pitch/dashboard']]), links);
      const order = await pg.evaluate(() => ['.prm-head', '.prm-discover', '.prm-creator-row'].map((s) => document.querySelector(s).getBoundingClientRect().top));
      ok('…under the Discover card, as in the app', order[0] < order[1] && order[1] < order[2], order);
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
      const head = await box(pg, '.prm-head');
      const disc = await box(pg, '.prm-discover');
      ok('the head and the Discover card side by side', disc.left > head.left + 200 && disc.top < head.bottom, { head, disc });
      ok('no creator buttons for a viewer', !(await pg.$('.prm-creator-row')));
      const search = await box(pg, '.prm-search');
      const sorts = await box(pg, '.prm-sorts');
      ok('search and the sorts on one line', Math.abs((search.top + search.bottom) / 2 - (sorts.top + sorts.bottom) / 2) < 4 && sorts.left > search.right - 1, { search, sorts });
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
