// Crew Call, simpler (2026-11-18, Jose on the canvas
// https://claude.ai/artifact/NAcrMSstXHTCP2HuysLCjp: "calls should be its
// own tab for now, make it the first page", then "I like both Bs"; the
// agreement is mockups/crew-call-simpler-contract.md). The website half:
// pages/crew/index.js (four tabs, Calls first), components/crew/
// CrewDirectory.js (the rows, the strip, the nudge) and CrewFilters.js (the
// sheet / panel), the .ccx-* styles, /crew/calls forwarding to /crew and a
// call on its own at /crew/calls/<id>.
//
// Seeds five accounts of this run (a gaffer who is free right now and
// brings five pieces of gear, a DP who is booked and lends two, a performer
// with a headshot, one without, and a poster with no card), a public
// production and four calls (an urgent one, a casting one, a remote one
// for the production, a DP one that matches the DP's card), and checks:
//   - the addresses: /crew/calls → 307 /crew keeping urgent, production and
//     kind; /crew/calls/<id> is the call alone under ‹ Calls; new's links;
//   - /crew signed out on a phone: Calls selected, the urgent badge, the
//     nudge with Sign in, a call's row (tags, title, meta, pay, poster,
//     answered), the chips; People (one gear line, the mark, a Message that
//     signs in), Cast (a headshot, the avatar in its box), Gear (the tile,
//     category · flag, Ask; a category chip), the URL on each switch;
//   - Filters on a phone: a bottom sheet, focus into it, a switch that
//     changes the list, Show N, Escape back to the chip, the page still,
//     Clear all, the place chip opening it at Near;
//   - a viewer with no card: the nudge, the card button's dot, Message
//     links; a card holder: the strip, I'm free → 4 h → Turn off against
//     the database, Matches my card;
//   - the older links (?free=1, ?urgent=1, ?production= with its ×);
//   - a laptop: the switch on the title row, the pills, the side card, two
//     columns of calls, three of people, the panel under the chips (Escape,
//     a click outside), a pay filter;
//   - no sideways scroll at 320 / 390 / 1280 on every tab, no page errors.
// Removes everything it made.
//
//   node dev/test-rig/checks/crew-call-simpler.mjs   (the rig must be up)
//   SHOTS=<dir> keeps a screenshot of each tab at 390 and 1280.
import crypto from 'node:crypto';
import { RUN, USERS, SIGNED_OUT, ok, section, runCheck, browser, goto, overflowPx, rows, sql, q, call, page, session, newUser, removeUser } from './lib.mjs';

const PROD = crypto.randomUUID();
const PROD_TITLE = `Harbor Doc ${RUN}`;
const CALL = { urgent: crypto.randomUUID(), cast: crypto.randomUUID(), remote: crypto.randomUUID(), dp: crypto.randomUUID() };
const T = {
  urgent: `Gaffer for a night exterior ${RUN}`,
  cast: `Lead, warm and dry ${RUN}`,
  remote: `Editor for a short doc ${RUN}`,
  dp: `DP for a music video ${RUN}`
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const inHours = (n) => new Date(Date.now() + n * 3600000).toISOString();
const PIXEL = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="54" height="68"><rect width="54" height="68" fill="#5c4433"/></svg>').toString('base64');
const arr = (list) => `array[${list.map(q).join(', ')}]::text[]`;

function card(userId, { roles, place = 'Echo Park, Los Angeles', lat = 34.08, lng = -118.26, availability = 'open', bookedUntil = null, rate = [null, null], freeHours = 0, performer = false, ageMin = null, ageMax = null, union = null }) {
  sql(`insert into public.crew_cards (user_id, roles, place_label, city, lat, lng, availability, booked_until, rate_min, rate_max, available_now_until, performer, playing_age_min, playing_age_max, union_status)
       values (${q(userId)}, ${arr(roles)}, ${q(place)}, 'Los Angeles', ${lat}, ${lng}, ${q(availability)}, ${q(bookedUntil)}, ${q(rate[0])}, ${q(rate[1])}, ${freeHours ? `now() + interval '${freeHours} hours'` : 'null'}, ${performer}, ${q(ageMin)}, ${q(ageMax)}, ${q(union)})`);
}
function gear(userId, items) {
  items.forEach(([category, name, flag], i) => sql(`insert into public.crew_gear (user_id, category, name, flag, sort_order) values (${q(userId)}, ${q(category)}, ${q(name)}, ${q(flag)}, ${i})`));
}

const visible = (pg, sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; }).catch(() => false);
const rect = (pg, sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
const ours = (list) => list.filter((t) => t.includes(RUN));
const callTitles = (pg) => pg.$$eval('.ccx-call .ccx-call-title', (els) => els.map((e) => e.textContent.trim())).then(ours);
const names = (pg) => pg.$$eval('.ccx-person .ccx-p-name-text', (els) => els.map((e) => e.textContent.trim())).then(ours);
const gearNames = (pg) => pg.$$eval('.ccx-gear .ccx-gear-name', (els) => els.map((e) => e.textContent.trim()));
const selectedTab = (pg) => pg.$eval('.ccx-tabs [role="tab"][aria-selected="true"]', (e) => e.id.replace('ccx-tab-', ''));
const pathOf = (pg) => { const u = new URL(pg.url()); return `${u.pathname}${u.search}`; };
const chipTexts = (pg) => pg.$$eval('.ccx-chips .ccx-chip', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const shot = async (pg, name) => { if (process.env.SHOTS) await pg.screenshot({ path: `${process.env.SHOTS}/${name}.png` }).catch(() => {}); };
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) { await new Promise((r) => setTimeout(r, 200)); v = await fn(); }
  return v;
}
async function clickTab(pg, tab) {
  await pg.click(`#ccx-tab-${tab}`);
  await pg.waitForSelector(`.ccx-body-${tab} .ccx-list, .ccx-body-${tab} .ccx-empty`, { timeout: 30000 });
  await pg.waitForTimeout(300);
}

// Clerk's browser library as far as a signed-out Message needs it (as
// pitch-room.mjs): nobody signed in, and what the site asks it to open is
// written down.
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

await runCheck('crew-call-simpler', async () => {
  const G = await newUser('ccg', { displayName: `Gale Gaffer ${RUN}`, handle: `gale${RUN}` });
  const P = await newUser('ccp', { displayName: `Pia Lens ${RUN}`, handle: `pia${RUN}` });
  const A = await newUser('cca', { displayName: `Ana Stage ${RUN}`, handle: `ana${RUN}` });
  const B = await newUser('ccb', { displayName: `Bo Model ${RUN}`, handle: `bo${RUN}` });
  const O = await newUser('cco', { displayName: `Oren Poster ${RUN}`, handle: `oren${RUN}` });
  const ALL = [G.id, P.id, A.id, B.id, O.id];
  const ids = ALL.map(q).join(', ');
  const b = await browser();
  try {
    card(G.id, { roles: ['Gaffer', 'Grip'], rate: [350, 350], freeHours: 5 });
    gear(G.id, [['Lighting', 'Aputure 600D Pro', 'brings'], ['Grip & support', 'C-stands', 'brings'], ['Grip & support', 'Flags', 'brings'], ['Grip & support', 'Sandbags', 'brings'], ['Lighting', 'Dimmer', 'brings']]);
    card(P.id, { roles: ['DP', 'Camera operator'], place: 'Silver Lake, Los Angeles', lat: 34.09, lng: -118.27, availability: 'booked', bookedUntil: day(14), rate: [600, 800] });
    gear(P.id, [['Camera', 'Sony FX3 kit', 'lends'], ['Lenses', 'Sigma 18–35mm', 'lends']]);
    card(A.id, { roles: ['Actor', 'Singer'], place: 'Highland Park, Los Angeles', lat: 34.11, lng: -118.19, performer: true, ageMin: 25, ageMax: 35, union: 'sag_aftra' });
    sql(`insert into public.crew_headshots (user_id, url, sort_order) values (${q(A.id)}, ${q(PIXEL)}, 0)`);
    card(B.id, { roles: ['Model'], performer: true, ageMin: 18, ageMax: 25, union: 'non_union' });
    sql(`insert into public.productions (id, owner_id, title, visibility) values (${q(PROD)}, ${q(O.id)}, ${q(PROD_TITLE)}, 'public')`);
    const callRow = (id, f) => sql(`insert into public.crew_calls (id, poster_id, title, role, spots, pay_type, pay_note, starts_on, ends_on, remote, place_label, lat, lng, kind, character_name, urgent, needed_by, production_id, production_title)
      values (${q(id)}, ${q(O.id)}, ${q(f.title)}, ${q(f.role)}, ${f.spots || 1}, ${q(f.pay)}, ${q(f.note || null)}, ${q(f.starts)}, ${q(f.ends)}, ${f.remote ? 'true' : 'false'}, ${q(f.remote ? null : 'Echo Park, Los Angeles')}, ${f.remote ? 'null' : 34.08}, ${f.remote ? 'null' : -118.26}, ${q(f.kind || 'crew')}, ${q(f.character || null)}, ${f.urgent ? 'true' : 'false'}, ${q(f.urgent ? inHours(20) : null)}, ${q(f.production || null)}, ${q(f.production ? PROD_TITLE : null)})`);
    callRow(CALL.urgent, { title: T.urgent, role: 'Gaffer', pay: 'paid', note: '$250/day', starts: day(1), ends: day(1), urgent: true });
    callRow(CALL.cast, { title: T.cast, role: 'Actor', pay: 'deferred', starts: day(10), ends: day(12), kind: 'cast', character: 'Lena', spots: 2 });
    callRow(CALL.remote, { title: T.remote, role: 'Editor', pay: 'paid', starts: day(3), ends: day(20), remote: true, production: PROD });
    callRow(CALL.dp, { title: T.dp, role: 'DP', pay: 'union', starts: day(5), ends: day(5), remote: true });

    section('Addresses');
    {
      const r = await call('/crew/calls', { accept: 'text/html' });
      ok('/crew/calls is a 307 to /crew', r.status === 307 && new URL(r.headers.get('location'), 'http://x').pathname === '/crew' && !new URL(r.headers.get('location'), 'http://x').search, `${r.status} ${r.headers.get('location')}`);
      const r2 = await call(`/crew/calls?urgent=1&production=${PROD}&kind=cast&tab=gear&junk=1`, { accept: 'text/html' });
      const loc = new URL(r2.headers.get('location') || '/', 'http://x');
      ok('…keeping urgent, production and kind, and nothing else', r2.status === 307 && loc.pathname === '/crew' && loc.searchParams.get('urgent') === '1' && loc.searchParams.get('production') === PROD && loc.searchParams.get('kind') === 'cast' && !loc.searchParams.has('junk') && !loc.searchParams.has('tab'), r2.headers.get('location'));
      const one = await page(`/crew/calls/${CALL.urgent}`);
      ok('/crew/calls/<id> shows the call', one.status === 200 && one.text.includes('cc-detail-panel') && one.text.includes(T.urgent), one.status);
      ok('…under ‹ Calls to /crew, with no board, list or filters beside it', /class="ccx-back"[^>]*href="\/crew"|href="\/crew"[^>]*class="ccx-back"/.test(one.text) && !one.text.includes('cc-list') && !one.text.includes('ccx-tabs') && !one.text.includes('crew-filters') && !one.text.includes(T.cast));
      const gone = await page('/crew/calls/00000000-0000-4000-8000-000000000000');
      ok('a call that is gone says so, with a way back to /crew', gone.status === 200 && /isn(.|&#x27;|&#39;)t here any more/.test(gone.text) && gone.text.includes('Back to Crew Call'));
      const fresh = await page('/crew/calls/new', session(O.id));
      ok('/crew/calls/new: its links to the board point at /crew', fresh.status === 200 && !/href="\/crew\/calls"/.test(fresh.text) && /href="\/crew"/.test(fresh.text));
      const home = await page('/', session(O.id));
      ok('the Notice Board no longer links to /crew/calls with no id', home.status === 200 && !/href="\/crew\/calls(\?[^"]*)?"/.test(home.text));
      const prods = await page('/productions');
      ok('Productions: Find people → /crew?tab=people, Calls → /crew', prods.status === 200 && prods.text.includes('href="/crew?tab=people"') && !/href="\/crew\/calls"/.test(prods.text));
    }

    section('Signed out on a phone (390): Calls first');
    {
      const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 390);
      await ctx.route('**/clerk.browser.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_CLERK }));
      await goto(pg, '/crew');
      await pg.waitForSelector('.ccx-list-calls');
      ok('Calls is the tab that is selected', (await selectedTab(pg)) === 'calls');
      const tabs = await pg.$$eval('.ccx-tabs [role="tab"]', (els) => els.map((e) => ({ t: e.childNodes[0].textContent.trim(), w: Math.round(e.getBoundingClientRect().width) })));
      ok('the switch: Calls · People · Cast · Gear, equal widths, in a tablist', tabs.map((t) => t.t).join('|') === 'Calls|People|Cast|Gear' && new Set(tabs.map((t) => t.w)).size === 1 && (await pg.$eval('.ccx-tabs', (e) => e.getAttribute('role'))) === 'tablist', tabs);
      const badge = await pg.$eval('#ccx-tab-calls', (e) => ({ badge: e.querySelector('.ccx-badge') ? e.querySelector('.ccx-badge').textContent : null, label: e.getAttribute('aria-label') }));
      ok('the Calls tab carries the urgent count, named in its label', badge.badge && Number(badge.badge) >= 1 && badge.label === `Calls, ${badge.badge} urgent`, badge);
      const title = await pg.$eval('h1.ccx-title', (e) => ({ t: e.textContent, font: getComputedStyle(e).fontFamily, size: parseFloat(getComputedStyle(e).fontSize) }));
      ok('the title: Crew Call in the serif, 28px', title.t === 'Crew Call' && /Fraunces/.test(title.font) && title.size === 28, title);
      const acts = await pg.$$eval('.ccx-acts .ccx-act', (els) => els.map((e) => ({ tag: e.tagName, label: e.getAttribute('aria-label'), w: Math.round(e.getBoundingClientRect().width), r: getComputedStyle(e).borderRadius })));
      ok('the card button and + Post a call are round 44px buttons (sign-in in place)', acts.length === 2 && acts.every((a) => a.tag === 'BUTTON' && a.w === 44) && acts[0].label === 'Set up your card' && acts[1].label === 'Post a call', acts);
      const nudge = await pg.$eval('.ccx-nudge', (e) => ({ text: e.innerText, btn: e.querySelector('.ccx-nudge-btn').tagName }));
      ok('signed out: the nudge with the signed-out line and Sign in', /You.re not on the board yet/.test(nudge.text) && /Sign in to post a call/.test(nudge.text) && /Sign in/.test(nudge.text) && nudge.btn === 'BUTTON', nudge);
      ok('no free strip for a visitor', !(await pg.$('.ccx-free')));
      const titles = await callTitles(pg);
      ok('our four calls are listed, the urgent one first of ours', titles.length === 4 && titles[0] === T.urgent, titles);
      const row = await pg.$$eval('.ccx-call', (els, t) => {
        const el = els.find((e) => e.querySelector('.ccx-call-title').textContent.trim() === t);
        const tag = el.querySelector('.ccx-tag');
        return { href: el.getAttribute('href'), tag: tag.textContent, tagColor: getComputedStyle(tag).color, tagFont: getComputedStyle(tag).fontFamily, upper: getComputedStyle(el.querySelector('.ccx-tags')).textTransform, meta: el.querySelector('.ccx-call-meta').textContent, pay: el.querySelector('.ccx-pay').textContent, payColor: getComputedStyle(el.querySelector('.ccx-pay')).color, foot: el.querySelector('.ccx-call-foot').innerText.replace(/\s+/g, ' ').trim(), titleSize: getComputedStyle(el.querySelector('.ccx-call-title')).fontSize };
      }, T.urgent);
      const danger = await pg.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--danger)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
      const mint = await pg.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--mint)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
      ok('a call row links to the call', row.href === `/crew/calls/${CALL.urgent}`, row.href);
      ok('…its urgent tag in red mono capitals', /Urgent/.test(row.tag) && row.tagColor === danger && /mono/i.test(row.tagFont) && row.upper === 'uppercase', row);
      ok('…the title at 16px, the meta line (role · date · place)', row.titleSize === '16px' && /^Gaffer · .+ · Echo Park$/.test(row.meta), row);
      ok('…pay in mint · poster · answered', row.pay === 'Paid · $250/day' && row.payColor === mint && row.foot === `Paid · $250/day · Oren Poster ${RUN} · No answers yet`, row);
      const cast = await pg.$$eval('.ccx-call', (els, t) => els.find((e) => e.querySelector('.ccx-call-title').textContent.trim() === t).querySelector('.ccx-tags').textContent, T.cast);
      ok('a casting call: Casting · Lena', /Casting · Lena/.test(cast), cast);
      const chips = await chipTexts(pg);
      ok('the chips: Anywhere · newest, ⚡ Urgent · N, Pay ▾, Filters (no Matches without a card)', chips[0] === 'Anywhere · newest' && /^⚡ Urgent · \d+$/.test(chips[1]) && chips.includes('Pay ▾') && chips[chips.length - 1] === 'Filters' && !chips.includes('Matches my card'), chips);
      const ph = await pg.$eval('.ccx-search input', (e) => ({ ph: e.placeholder, size: parseFloat(getComputedStyle(e).fontSize), h: Math.round(e.closest('.ccx-search').getBoundingClientRect().height) }));
      ok('the search: 44px, 16px text, says how many open calls', /^Search \d+ open calls?…$/.test(ph.ph) && ph.size >= 16 && ph.h === 44, ph);
      ok('no count line, no eyebrow, no intro paragraph', !(await pg.$('.ccx .crew-rhead')) && !(await pg.$('.ccx .crew-eyebrow')) && !(await pg.$('.ccx p.intro')) && !/Find the people and the gear/.test(await pg.$eval('main', (e) => e.innerText)));
      ok('nothing runs off the side (Calls)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-390-calls');

      // The urgent toggle narrows the list.
      await pg.click('.ccx-chip.urgent');
      await until(async () => (await callTitles(pg)).join('|') === T.urgent);
      ok('⚡ Urgent narrows to the urgent call', (await callTitles(pg)).join('|') === T.urgent && (await pg.$eval('.ccx-chip.urgent', (e) => e.getAttribute('aria-pressed'))) === 'true');
      await pg.click('.ccx-chip.urgent');
      await until(async () => (await callTitles(pg)).length === 4);

      // People.
      await clickTab(pg, 'people');
      ok('People: the address says so', pathOf(pg) === '/crew?tab=people', pg.url());
      ok('…and the tab is selected', (await selectedTab(pg)) === 'people');
      const people = await names(pg);
      ok('our four people with roles are listed (not the poster, who has no card)', [`Gale Gaffer ${RUN}`, `Pia Lens ${RUN}`, `Ana Stage ${RUN}`, `Bo Model ${RUN}`].every((n) => people.includes(n)) && !people.includes(`Oren Poster ${RUN}`), people);
      ok('Gale (free right now) is first of ours', people[0] === `Gale Gaffer ${RUN}`, people);
      const gale = await pg.$$eval('.ccx-person', (els, n) => {
        const el = els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n);
        const face = el.querySelector('.ccx-face');
        const msg = el.querySelector('.ccx-msg');
        return { href: el.querySelector('.ccx-p-main').getAttribute('href'), free: face.classList.contains('free'), ring: getComputedStyle(face).boxShadow, faceW: Math.round(face.getBoundingClientRect().width), roles: el.querySelector('.ccx-p-roles').textContent, status: el.querySelector('.ccx-p-status').textContent, statusColor: getComputedStyle(el.querySelector('.ccx-p-status > span')).color, gear: el.querySelector('.ccx-p-gear').textContent, verbColor: getComputedStyle(el.querySelector('.ccx-verb')).color, gearWrap: getComputedStyle(el.querySelector('.ccx-p-gear')).whiteSpace, tier: Boolean(el.querySelector('.crew-tier')), msgTag: msg.tagName, msgLabel: msg.getAttribute('aria-label'), msgW: Math.round(msg.getBoundingClientRect().width) };
      }, `Gale Gaffer ${RUN}`);
      const brass = await pg.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--brass)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
      const olive = await pg.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--olive)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
      ok('a person: the row links to the profile', gale.href === `/profile/gale${RUN}`, gale.href);
      ok('…52px photo with the orange ring when free', gale.free && gale.faceW === 52 && /rgb/.test(gale.ring), gale);
      ok('…roles, the free status in orange, the tier chip', gale.roles === 'Gaffer · Grip' && /^⚡ Free (until|right now)/.test(gale.status) && gale.statusColor === brass && gale.tier, gale);
      ok('…one gear line: Brings (gold) Aputure 600D Pro · C-stands +3, on one line', gale.gear === 'Brings Aputure 600D Pro · C-stands +3' && gale.verbColor === olive && gale.gearWrap === 'nowrap', gale);
      ok('…a round 40px Message that signs in when signed out', gale.msgTag === 'BUTTON' && gale.msgLabel === `Message Gale Gaffer ${RUN}` && gale.msgW === 40, gale);
      const pia = await pg.$$eval('.ccx-person', (els, n) => { const el = els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n); return { status: el.querySelector('.ccx-p-status').textContent, gear: el.querySelector('.ccx-p-gear').textContent, mark: el.querySelector('.ccx-face').classList.contains('free') || Boolean(el.querySelector('.ccx-dot')) }; }, `Pia Lens ${RUN}`);
      ok('a booked person: Booked until …, Lends …, no mark; no rate signed out', /^Booked until \w+ \d+/.test(pia.status) && !/\$/.test(pia.status) && pia.gear === 'Lends Sony FX3 kit · Sigma 18–35mm' && !pia.mark, pia);
      const ana = await pg.$$eval('.ccx-person', (els, n) => { const el = els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n); return Boolean(el.querySelector('.ccx-dot')); }, `Ana Stage ${RUN}`);
      ok('an open person: the small green dot', ana);
      ok('the chips: place, Role ▾, ⚡ Free now, Open to work, Filters', (await chipTexts(pg)).join('|') === 'Anywhere · newest|Role ▾|⚡ Free now|Open to work|Filters', await chipTexts(pg));
      ok('nothing runs off the side (People)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-390-people');

      // A signed-out Message opens sign-in and stays on the page.
      await pg.waitForFunction(() => window.Clerk && window.Clerk.loaded === true, null, { timeout: 30000 }).catch(() => {});
      await pg.$$eval('.ccx-person', (els, n) => els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n).querySelector('.ccx-msg').click(), `Gale Gaffer ${RUN}`);
      await pg.waitForTimeout(300);
      const signIns = await pg.evaluate(() => window.__clerkCalls || []);
      ok('a signed-out Message opens sign-in and comes back here', signIns.length === 1 && signIns[0].kind === 'openSignIn' && /\/crew\?tab=people$/.test(signIns[0].props.forceRedirectUrl || ''), signIns);

      // Filters on a phone: a bottom sheet.
      const scrollBefore = await pg.evaluate(() => window.scrollY);
      await pg.click('.ccx-chip:has-text("Filters")');
      await pg.waitForSelector('.ccx-sheet-back .ccx-sheet');
      const sheet = await pg.$eval('.ccx-sheet', (e) => { const r = e.getBoundingClientRect(); return { role: e.getAttribute('role'), modal: e.getAttribute('aria-modal'), bottom: Math.round(r.bottom), top: Math.round(r.top), inBody: e.parentElement.parentElement === document.body, focusIn: e.contains(document.activeElement), title: e.querySelector('h2').textContent, show: e.querySelector('.ccx-show').textContent, clear: e.querySelector('.ccx-clear-all').textContent, sections: [...e.querySelectorAll('.ccx-fsec-label')].map((x) => x.textContent) }; });
      ok('Filters on a phone: a modal dialog sheet at the bottom of the screen', sheet.role === 'dialog' && sheet.modal === 'true' && sheet.bottom === 844 && sheet.top > 40 && sheet.inBody, sheet);
      ok('…Filters, Clear all, focus inside it', sheet.title === 'Filters' && sheet.clear === 'Clear all' && sheet.focusIn, sheet);
      ok('…People’s sections: Near, Role · pick any, Has gear, and the switches', sheet.sections.join('|') === 'Near|Role · pick any|Has gear' && (await pg.$$eval('.ccx-sheet .ccx-switch-row', (els) => els.map((e) => e.querySelector('.ccx-switch-text > span').textContent))).join('|') === '⚡ Free right now|Open to work|Verified creators only', sheet.sections);
      ok('…Show N people', /^Show \d+ (people|person)$/.test(sheet.show), sheet.show);
      const roleChips = await pg.$$eval('.ccx-sheet [data-section="role"] .ccx-fchip', (els) => els.map((e) => e.textContent.trim()));
      ok('…the first ten roles, then + N more', roleChips.length === 11 && /^\+ \d+ more$/.test(roleChips[10]), roleChips);
      await pg.click('.ccx-sheet [data-section="role"] .ccx-fchip.more');
      ok('…which opens the rest', (await pg.$$eval('.ccx-sheet [data-section="role"] .ccx-fchip', (els) => els.length)) === 30);
      await pg.mouse.move(195, 600);
      await pg.mouse.wheel(0, 1200);
      await pg.waitForTimeout(250);
      await pg.mouse.wheel(0, 1200);
      await pg.waitForTimeout(250);
      ok('the page behind never scrolls', (await pg.evaluate(() => window.scrollY)) === scrollBefore);
      await pg.click('.ccx-sheet .ccx-switch-row:has-text("Open to work") input');
      await until(async () => !(await names(pg)).includes(`Pia Lens ${RUN}`));
      ok('Open to work applies live: the booked person leaves the list', !(await names(pg)).includes(`Pia Lens ${RUN}`) && (await names(pg)).includes(`Gale Gaffer ${RUN}`));
      const shown = await pg.$eval('.ccx-show', (e) => e.textContent);
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(250);
      ok('Escape closes it', !(await pg.$('.ccx-sheet')));
      ok('…and focus is back on the Filters chip', await pg.evaluate(() => document.activeElement && /^Filters/.test(document.activeElement.textContent.trim())));
      ok('the Filters chip counts it: Filters · 1', (await chipTexts(pg)).includes('Filters · 1') && (await chipTexts(pg)).includes('Open to work'), await chipTexts(pg));
      ok('Show N matches the list', new RegExp(`^Show ${await pg.$$eval('.ccx-person', (els) => els.length)} `).test(shown), shown);
      await pg.click('.ccx-chip:has-text("Filters")');
      await pg.waitForSelector('.ccx-sheet');
      await pg.click('.ccx-clear-all');
      await until(async () => (await names(pg)).includes(`Pia Lens ${RUN}`));
      ok('Clear all clears the tab’s filters', (await names(pg)).includes(`Pia Lens ${RUN}`));
      await pg.click('.ccx-show');
      await pg.waitForTimeout(250);
      ok('Show closes it', !(await pg.$('.ccx-sheet')) && (await chipTexts(pg)).includes('Filters'));
      // The place chip opens it at Near.
      await pg.click('.ccx-chip:has-text("Anywhere")');
      await pg.waitForSelector('.ccx-sheet');
      ok('the place chip opens Filters at Near', await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('ccx-fsec-label') && document.activeElement.textContent === 'Near'));
      ok('…its text field is 16px', (await pg.$eval('.ccx-sheet .ccx-near input', (e) => parseFloat(getComputedStyle(e).fontSize))) >= 16);
      await pg.click('.ccx-sheet .ccx-x');
      await pg.waitForTimeout(250);
      ok('× closes it', !(await pg.$('.ccx-sheet')));

      // Cast.
      await clickTab(pg, 'cast');
      ok('Cast: the address says so', pathOf(pg) === '/crew?tab=cast', pg.url());
      const performers = await names(pg);
      ok('only performers are listed', performers.includes(`Ana Stage ${RUN}`) && performers.includes(`Bo Model ${RUN}`) && !performers.includes(`Gale Gaffer ${RUN}`), performers);
      const shots = await pg.$$eval('.ccx-cast', (els, [a, bo]) => {
        const get = (n) => { const el = els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n); const s = el.querySelector('.ccx-shot'); const r = s.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(s).borderRadius, img: Boolean(s.querySelector('img')), avatar: Boolean(s.querySelector('.crew-avatar')), playing: el.querySelector('.ccx-p-roles').textContent, meta: el.querySelector('.ccx-p-status').textContent, msg: Boolean(el.querySelector('.ccx-msg')) }; };
        return { a: get(a), b: get(bo) };
      }, [`Ana Stage ${RUN}`, `Bo Model ${RUN}`]);
      ok('a performer with a headshot: 54×68, radius 10, the photo', shots.a.w === 54 && shots.a.h === 68 && shots.a.radius === '10px' && shots.a.img, shots.a);
      ok('…Plays 25–35 · SAG-AFTRA, then status · roles, and Message', shots.a.playing === 'Plays 25–35 · SAG-AFTRA' && /Open to work · Actor · Singer/.test(shots.a.meta) && shots.a.msg, shots.a);
      ok('no headshot: the avatar in that box', shots.b.w === 54 && shots.b.h === 68 && !shots.b.img && shots.b.avatar, shots.b);
      ok('the chips: place, Playing age ▾, Union ▾, ⚡ Free now, Filters', (await chipTexts(pg)).join('|') === 'Anywhere · newest|Playing age ▾|Union ▾|⚡ Free now|Filters', await chipTexts(pg));
      await pg.click('.ccx-chip:has-text("Union")');
      await pg.waitForSelector('.ccx-sheet');
      ok('Union ▾ opens Filters at Union', await pg.evaluate(() => document.activeElement && document.activeElement.textContent === 'Union'));
      await pg.click('.ccx-sheet [data-section="union"] .ccx-fchip:has-text("SAG-AFTRA")');
      await until(async () => !(await names(pg)).includes(`Bo Model ${RUN}`));
      ok('…a union narrows the list', (await names(pg)).includes(`Ana Stage ${RUN}`) && !(await names(pg)).includes(`Bo Model ${RUN}`));
      await pg.click('.ccx-clear-all');
      await pg.keyboard.press('Escape');
      ok('nothing runs off the side (Cast)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-390-cast');

      // Gear.
      await clickTab(pg, 'gear');
      ok('Gear: the address says so', pathOf(pg) === '/crew?tab=gear', pg.url());
      const gearRow = await pg.$$eval('.ccx-gear', (els) => {
        const el = els.find((e) => e.querySelector('.ccx-gear-name').textContent.trim() === 'Sony FX3 kit' && /Pia Lens/.test(e.querySelector('.ccx-gear-owner').textContent));
        if (!el) return null;
        const tile = el.querySelector('.ccx-gear-tile');
        return { tile: Math.round(tile.getBoundingClientRect().width), svg: Boolean(tile.querySelector('svg')), cat: el.querySelector('.ccx-gear-cat').textContent, owner: el.querySelector('.ccx-gear-owner').lastChild.textContent, ownerFace: Math.round(el.querySelector('.ccx-gear-owner .ccx-face').getBoundingClientRect().width), ask: el.querySelector('.ccx-ask').textContent, askTag: el.querySelector('.ccx-ask').tagName };
      });
      ok('a piece of gear: a 48px tile with its icon, category · flag', gearRow && gearRow.tile === 48 && gearRow.svg && gearRow.cat === 'Camera · Open to lending', gearRow);
      ok('…the owner with an 18px photo, Ask (signs in when signed out)', gearRow && /^Pia Lens .+ · Silver Lake$/.test(gearRow.owner) && gearRow.ownerFace === 18 && gearRow.ask === 'Ask' && gearRow.askTag === 'BUTTON', gearRow);
      const gchips = await chipTexts(pg);
      ok('the chips: place, then All and the categories (no Filters)', gchips[0] === 'Anywhere · newest' && gchips[1] === 'All' && gchips.includes('Lighting') && !gchips.some((c) => /^Filters/.test(c)) && Boolean(await pg.$('.ccx-chip-rule')), gchips);
      await pg.click('.ccx-cats .ccx-chip:has-text("Lighting")');
      await until(async () => { const g = await gearNames(pg); return g.length > 0 && !g.includes('Sony FX3 kit'); });
      const lighting = await pg.$$eval('.ccx-gear .ccx-gear-cat', (els) => els.map((e) => e.textContent.split(' · ')[0]));
      ok('a category shows only that kind', lighting.length > 0 && lighting.every((c) => c === 'Lighting'), lighting);
      // Filters belong to each tab: Lighting on Gear is not People's Has gear.
      await clickTab(pg, 'people');
      ok('a category on Gear does not filter People (Filters stays plain)', (await chipTexts(pg)).includes('Filters') && (await names(pg)).includes(`Pia Lens ${RUN}`), await chipTexts(pg));
      await pg.click('.ccx-chip:has-text("Free now")');
      await until(async () => (await names(pg)).join('|') === `Gale Gaffer ${RUN}`);
      ok('…Free now on People narrows People', (await names(pg)).join('|') === `Gale Gaffer ${RUN}`);
      await clickTab(pg, 'cast');
      await until(async () => (await names(pg)).includes(`Bo Model ${RUN}`));
      ok('…and does not reach Cast', (await names(pg)).includes(`Ana Stage ${RUN}`) && (await names(pg)).includes(`Bo Model ${RUN}`) && (await pg.$eval('.ccx-chip[aria-pressed]', (e) => e.getAttribute('aria-pressed'))) === 'false');
      await clickTab(pg, 'people');
      ok('…while People keeps it', (await pg.$eval('.ccx-chip[aria-pressed="true"]', (e) => e.textContent.trim()).catch(() => null)) === '⚡ Free now');
      await pg.click('.ccx-chip:has-text("Free now")');
      await clickTab(pg, 'gear');
      ok('…and Gear still has Lighting', (await pg.$eval('.ccx-cats .ccx-chip[aria-pressed="true"]', (e) => e.textContent.trim())) === 'Lighting');
      await pg.click('.ccx-cats .ccx-chip:has-text("All")');
      ok('nothing runs off the side (Gear)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-390-gear');

      // Switching back draws at once from the last answer.
      await pg.click('#ccx-tab-calls');
      ok('switching back to Calls draws at once', Boolean(await pg.$('.ccx-list-calls')) && pathOf(pg) === '/crew');
      ok('no page errors (signed out, 390)', errors.length === 0, errors);
      await ctx.close();
    }

    section('A viewer with no card (390)');
    {
      const { ctx, page: pg, errors } = await b.open(session(USERS.viewer), 390);
      await goto(pg, '/crew');
      await pg.waitForSelector('.ccx-list-calls');
      const nudge = await pg.$eval('.ccx-nudge', (e) => ({ text: e.innerText, href: e.querySelector('.ccx-nudge-btn').getAttribute('href') }));
      ok('the nudge: add a card, Set it up → /crew/card', /You.re not on the board yet/.test(nudge.text) && /Add a card and calls that fit you find you/.test(nudge.text) && nudge.href === '/crew/card', nudge);
      const cardBtn = await pg.$eval('.ccx-act.card', (e) => ({ href: e.getAttribute('href'), label: e.getAttribute('aria-label'), dot: Boolean(e.querySelector('.ccx-act-dot')) }));
      ok('the card button: Set up your card, with the orange dot', cardBtn.href === '/crew/card' && cardBtn.label === 'Set up your card' && cardBtn.dot, cardBtn);
      ok('+ Post a call → /crew/calls/new', (await pg.$eval('.ccx-act.post', (e) => e.getAttribute('href'))) === '/crew/calls/new');
      await clickTab(pg, 'people');
      const msg = await pg.$$eval('.ccx-person', (els, n) => els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n).querySelector('.ccx-msg').getAttribute('href'), `Pia Lens ${RUN}`);
      ok('Message links to the conversation about their card', msg === `/messages?to=${encodeURIComponent(P.id)}&kind=card&label=${encodeURIComponent(`Pia Lens ${RUN}’s card`)}`, msg);
      const rate = await pg.$$eval('.ccx-person', (els, n) => els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n).querySelector('.ccx-p-status').textContent, `Pia Lens ${RUN}`);
      ok('signed in, the rate shows', /\$600–800\/day/.test(rate), rate);
      await clickTab(pg, 'gear');
      const ask = await pg.$$eval('.ccx-gear', (els) => { const el = els.find((e) => e.querySelector('.ccx-gear-name').textContent.trim() === 'Sony FX3 kit' && /Pia Lens/.test(e.querySelector('.ccx-gear-owner').textContent)); return el && el.querySelector('.ccx-ask').getAttribute('href'); });
      ok('Ask links to a conversation about the piece', ask === `/messages?to=${encodeURIComponent(P.id)}&kind=gear&label=${encodeURIComponent('Sony FX3 kit')}`, ask);
      ok('no page errors (viewer, 390)', errors.length === 0, errors);
      await ctx.close();
    }

    section('A card holder (390): the strip, Matches my card');
    {
      sql(`update public.crew_cards set available_now_until = null where user_id = ${q(P.id)}`);
      const { ctx, page: pg, errors } = await b.open(P, 390);
      const consoleErrors = [];
      pg.on('console', (m) => { if (m.type() === 'error' && /hydrat|did not match|server-rendered/i.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
      await goto(pg, '/crew');
      await pg.waitForSelector('.ccx-free');
      const strip = await pg.$eval('.ccx-free', (e) => ({ text: e.innerText, h: Math.round(e.getBoundingClientRect().height), on: e.classList.contains('on') }));
      ok('the strip: Free right now? with I’m free', /Free right now\?/.test(strip.text) && /Urgent calls nearby reach you first/.test(strip.text) && /I’m free/.test(strip.text) && !strip.on && strip.h >= 52, strip);
      ok('no nudge for a card holder', !(await pg.$('.ccx-nudge')));
      ok('the card button: Your card, no dot', (await pg.$eval('.ccx-act.card', (e) => e.getAttribute('aria-label'))) === 'Your card' && !(await pg.$('.ccx-act-dot')));
      ok('Matches my card is a chip for a card holder', (await chipTexts(pg)).includes('Matches my card'));
      ok('the place chip says the card’s place and distance', /^Silver Lake · 50 mi$/.test((await chipTexts(pg))[0]), (await chipTexts(pg))[0]);
      await pg.click('.ccx-chip:has-text("Matches my card")');
      await until(async () => (await callTitles(pg)).join('|') === T.dp);
      ok('…which narrows to the DP call', (await callTitles(pg)).join('|') === T.dp, await callTitles(pg));
      ok('…while the red badge still counts the urgent calls near the place', Number(await pg.$eval('#ccx-tab-calls .ccx-badge', (e) => e.textContent).catch(() => 0)) >= 1);
      await pg.click('.ccx-chip:has-text("Matches my card")');
      ok('the hour choices hide until I’m free is pressed', !(await visible(pg, '.ccx-free-hours')));
      await pg.click('.ccx-free-open');
      ok('I’m free shows the four choices in its place', (await pg.$$eval('.ccx-free-hours .ccx-hour', (els) => els.map((e) => e.textContent))).join('|') === '4 h|8 h|12 h|24 h' && !(await visible(pg, '.ccx-free-open')));
      ok('…still nothing off the side', (await overflowPx(pg)) <= 0);
      await pg.click('.ccx-hour:has-text("4 h")');
      const saved = await until(() => rows(`select available_now_until from public.crew_cards where user_id = ${q(P.id)}`)[0].available_now_until);
      const hrs = saved ? (Date.parse(saved) - Date.now()) / 3600000 : 0;
      ok('4 h saves about four hours on the card', hrs > 3.8 && hrs < 4.1, saved);
      await pg.waitForSelector('.ccx-free.on');
      const on = await pg.$eval('.ccx-free', (e) => e.innerText);
      ok('…the strip says Free until …, Turn off', /Free until \d/.test(on) && /Turn off/.test(on) && /first in line/.test(on), on);
      await pg.click('.ccx-free-btn:has-text("Turn off")');
      const off = await until(() => rows(`select available_now_until from public.crew_cards where user_id = ${q(P.id)}`)[0].available_now_until === null);
      ok('Turn off clears it', off);
      ok('no page errors (card holder, 390)', errors.length === 0, errors);
      ok('no hydration mismatch', consoleErrors.length === 0, consoleErrors);
      await ctx.close();
    }

    section('The older links');
    {
      const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 390);
      await goto(pg, '/crew?free=1');
      await pg.waitForSelector('.ccx-list-people, .ccx-body-people .ccx-empty');
      ok('/crew?free=1 opens People with Free now on', (await selectedTab(pg)) === 'people' && (await pg.$eval('.ccx-chip[aria-pressed="true"]', (e) => e.textContent.trim())) === '⚡ Free now');
      ok('…listing only who is free', (await names(pg)).join('|') === `Gale Gaffer ${RUN}`, await names(pg));
      await goto(pg, '/crew?urgent=1');
      await pg.waitForSelector('.ccx-list-calls');
      ok('/crew?urgent=1 opens Calls with Urgent on', (await selectedTab(pg)) === 'calls' && (await pg.$eval('.ccx-chip.urgent', (e) => e.getAttribute('aria-pressed'))) === 'true' && (await callTitles(pg)).join('|') === T.urgent);
      await goto(pg, `/crew?production=${PROD}`);
      await pg.waitForSelector('.ccx-list-calls');
      ok('/crew?production= shows that production’s calls with its chip', (await callTitles(pg)).join('|') === T.remote && (await pg.$eval('.ccx-prodchip', (e) => e.textContent.trim())) === `For ${PROD_TITLE}`);
      await pg.click('.ccx-prodchip button');
      await until(async () => (await callTitles(pg)).length === 4);
      ok('…its × shows every call again and drops it from the address', (await callTitles(pg)).length === 4 && pathOf(pg) === '/crew' && !(await pg.$('.ccx-prodchip')), pg.url());
      await goto(pg, '/crew/calls?urgent=1');
      ok('/crew/calls?urgent=1 lands on /crew?urgent=1', pathOf(pg) === '/crew?urgent=1', pg.url());
      await goto(pg, `/crew/calls/${CALL.urgent}`);
      ok('/crew/calls/<id>: the call alone under ‹ Calls', Boolean(await pg.$('.cc-detail-panel')) && !(await pg.$('.ccx-tabs')) && (await pg.$eval('.ccx-back', (e) => e.textContent.replace(/\s+/g, ' ').trim())) === '‹ Calls' && !(await visible(pg, '.cc-back')));
      ok('…nothing off the side', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-390-call');
      await pg.click('.ccx-back');
      await pg.waitForSelector('.ccx-tabs');
      ok('…‹ Calls goes back to Crew Call', pathOf(pg) === '/crew');
      ok('no page errors (older links)', errors.length === 0, errors);
      await ctx.close();
    }

    section('A small phone (320)');
    {
      const { ctx, page: pg, errors } = await b.open(P, 320);
      await goto(pg, '/crew');
      await pg.waitForSelector('.ccx-list-calls');
      for (const t of ['calls', 'people', 'cast', 'gear']) {
        if (t !== 'calls') await clickTab(pg, t);
        ok(`nothing runs off the side at 320 (${t})`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
      }
      await clickTab(pg, 'people');
      const nameRows = await pg.$$eval('.ccx-person', (els) => els.map((e) => { const n = e.querySelector('.ccx-p-name-text'); return { name: n.textContent, w: Math.round(n.getBoundingClientRect().width), full: n.scrollWidth <= n.clientWidth + 1 }; }));
      ok('at 320 a name is never squeezed: the chips go under it', nameRows.length > 0 && nameRows.every((r) => r.full), nameRows);
      const top = await pg.evaluate(() => { const t = document.querySelector('.ccx-title').getBoundingClientRect(); const a = document.querySelector('.ccx-acts').getBoundingClientRect(); return { titleRight: t.right, actsLeft: a.left }; });
      ok('the title still fits beside the two buttons', top.titleRight <= top.actsLeft, top);
      ok('no page errors (320)', errors.length === 0, errors);
      await ctx.close();
    }

    section('A laptop (1280), a card holder');
    {
      const { ctx, page: pg, errors } = await b.open(P, 1280);
      await goto(pg, '/crew');
      await pg.waitForSelector('.ccx-list-calls');
      const head = await pg.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const t = r('.ccx-title'); const tabs = r('.ccx-tabs'); const acts = r('.ccx-acts');
        return { sameRow: Math.abs((t.top + t.bottom) / 2 - (tabs.top + tabs.bottom) / 2) < 6, tabsW: Math.round(tabs.width), titleSize: parseFloat(getComputedStyle(document.querySelector('.ccx-title')).fontSize), actsRight: acts.right };
      });
      ok('the switch sits on the title row, 420px; the title 32px', head.sameRow && head.tabsW === 420 && head.titleSize === 32, head);
      const pills = await pg.$$eval('.ccx-act', (els) => els.map((e) => ({ t: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height) })));
      ok('the card and Post a call are labelled pills', pills[0].t === 'Your card' && pills[1].t === 'Post a call' && pills.every((p) => p.h === 40), pills);
      const tools = await pg.evaluate(() => { const s = document.querySelector('.ccx-search').getBoundingClientRect(); const c = document.querySelector('.ccx-chips .ccx-chip').getBoundingClientRect(); return { searchW: Math.round(s.width), searchH: Math.round(s.height), sameLine: Math.abs((s.top + s.bottom) / 2 - (c.top + c.bottom) / 2) < 6 }; });
      ok('the search (320 × 40) and the chips on one line', tools.searchW === 320 && tools.searchH === 40 && tools.sameLine, tools);
      const side = await pg.evaluate(() => { const s = document.querySelector('.ccx-side').getBoundingClientRect(); const m = document.querySelector('.ccx-main').getBoundingClientRect(); return { left: s.left, mainRight: m.right, w: Math.round(s.width), hours: [...document.querySelectorAll('.ccx-free-hours .ccx-hour')].filter((e) => e.getBoundingClientRect().width > 0).length, line: document.querySelector('.ccx-free-line.wide').getBoundingClientRect().height > 0, title: getComputedStyle(document.querySelector('.ccx-free-title')).fontFamily }; });
      ok('the free card: 300px to the right of the calls, the four choices showing, the long line, the serif title', side.left >= side.mainRight && side.w === 300 && side.hours === 4 && side.line && /Fraunces/.test(side.title), side);
      const cols = await pg.$$eval('.ccx-call', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))].length);
      ok('the calls in two columns of cards', cols === 2, cols);
      const urgentCard = await pg.$$eval('.ccx-call.urgent', (els) => { const e = els[0]; const s = getComputedStyle(e); return { radius: s.borderRadius, border: s.borderTopColor, face: Math.round(e.querySelector('.ccx-poster-face').getBoundingClientRect().width) }; });
      ok('an urgent card: 16px radius, a red-tinted border, the poster’s 18px photo', urgentCard.radius === '16px' && /rgba\(239, 91, 91/.test(urgentCard.border) && urgentCard.face === 18, urgentCard);
      // The panel under the chips.
      await pg.click('.ccx-chip:has-text("Pay")');
      await pg.waitForSelector('.ccx-panel');
      const panel = await pg.evaluate(() => { const p = document.querySelector('.ccx-panel'); const r = p.getBoundingClientRect(); const chips = document.querySelector('.ccx-chips').getBoundingClientRect(); const pay = p.querySelector('[data-section="pay"]').getBoundingClientRect(); const body = p.querySelector('.ccx-sheet-body').getBoundingClientRect(); return { portal: Boolean(document.querySelector('.ccx-sheet-back')), modal: p.getAttribute('aria-modal'), top: r.top, chipsBottom: chips.bottom, payInView: pay.top >= body.top - 1 && pay.top < body.bottom, focus: document.activeElement && document.activeElement.textContent }; });
      ok('Filters on a laptop: a panel dropping under the chips, not a sheet', !panel.portal && panel.modal === 'false' && panel.top >= panel.chipsBottom, panel);
      ok('…opened at Pay, in view and focused', panel.payInView && panel.focus === 'Pay', panel);
      await pg.click('.ccx-panel [data-section="pay"] .ccx-fchip:has-text("Union")');
      await until(async () => (await callTitles(pg)).join('|') === T.dp);
      ok('a pay type applies live', (await callTitles(pg)).join('|') === T.dp, await callTitles(pg));
      const scroll0 = await pg.evaluate(() => window.scrollY);
      await pg.mouse.move(300, (await rect(pg, '.ccx-panel')).top + 60);
      await pg.mouse.wheel(0, 800);
      await pg.waitForTimeout(250);
      ok('a wheel on the panel leaves the page where it is', (await pg.evaluate(() => window.scrollY)) === scroll0);
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(250);
      ok('Escape closes the panel, focus back on Pay ▾', !(await pg.$('.ccx-panel')) && (await pg.evaluate(() => /^Pay/.test(document.activeElement.textContent.trim()))));
      ok('the Pay chip is lit while a pay type is on', (await pg.$eval('.ccx-chips .ccx-chip.on:has-text("Pay")', () => true).catch(() => false)));
      await pg.click('.ccx-chip:has-text("Filters")');
      await pg.waitForSelector('.ccx-panel');
      await pg.mouse.click(40, (await rect(pg, '.ccx-title')).top + 10);
      await pg.waitForTimeout(250);
      ok('a click outside closes it', !(await pg.$('.ccx-panel')));
      await pg.click('.ccx-chip:has-text("Filters")');
      await pg.waitForSelector('.ccx-panel');
      await pg.click('.ccx-clear-all');
      await pg.keyboard.press('Escape');
      await until(async () => (await callTitles(pg)).length === 4);
      ok('nothing runs off the side (Calls, 1280)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-1280-calls');

      await clickTab(pg, 'people');
      // The place is shared by every tab.
      await pg.click('.ccx-chip:has-text("Silver Lake")');
      await pg.waitForSelector('.ccx-panel');
      await pg.click('.ccx-panel [data-section="near"] .ccx-fchip:has-text("100 mi")');
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(300);
      ok('a new distance shows on the place chip', (await chipTexts(pg))[0] === 'Silver Lake · 100 mi', await chipTexts(pg));
      await clickTab(pg, 'gear');
      ok('…and on every other tab (Gear)', (await chipTexts(pg))[0] === 'Silver Lake · 100 mi', await chipTexts(pg));
      await clickTab(pg, 'calls');
      ok('…(Calls)', (await chipTexts(pg))[0] === 'Silver Lake · 100 mi', await chipTexts(pg));
      await clickTab(pg, 'people');
      const pcols = await pg.$$eval('.ccx-person', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))].length);
      ok('People in three columns of cards', pcols === 3, pcols);
      const pc = await pg.$$eval('.ccx-person', (els, n) => { const el = els.find((e) => e.querySelector('.ccx-p-name-text').textContent.trim() === n); const m = el.querySelector('.ccx-msg'); return { face: Math.round(el.querySelector('.ccx-face').getBoundingClientRect().width), msg: m.textContent.trim(), msgBg: getComputedStyle(m).backgroundColor, profile: el.querySelector('.ccx-profile-pill').getBoundingClientRect().width > 0 }; }, `Gale Gaffer ${RUN}`);
      ok('a person card: 56px photo, Message (orange) and Profile pills', pc.face === 56 && pc.msg === 'Message' && /rgb\(255, 140, 66\)/.test(pc.msgBg) && pc.profile, pc);
      ok('nothing runs off the side (People, 1280)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-1280-people');
      await clickTab(pg, 'cast');
      const ccols = await pg.$$eval('.ccx-cast', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))].length);
      ok('Cast in two columns', ccols === 2, ccols);
      ok('nothing runs off the side (Cast, 1280)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-1280-cast');
      await clickTab(pg, 'gear');
      const gcols = await pg.$$eval('.ccx-gear', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))].length);
      ok('Gear in three columns', gcols === 3, gcols);
      ok('nothing runs off the side (Gear, 1280)', (await overflowPx(pg)) <= 0);
      await shot(pg, 'crew-1280-gear');
      ok('no page errors (1280)', errors.length === 0, errors);
      await ctx.close();
    }

    section('Screenshots of every tab signed out (390 and 1280)');
    if (process.env.SHOTS) {
      for (const w of [390, 1280]) {
        const { ctx, page: pg } = await b.open(SIGNED_OUT, w);
        for (const t of ['calls', 'people', 'cast', 'gear']) {
          await goto(pg, t === 'calls' ? '/crew' : `/crew?tab=${t}`);
          await pg.waitForSelector(`.ccx-body-${t} .ccx-list, .ccx-body-${t} .ccx-empty`);
          await shot(pg, `crew-${w}-${t}-signed-out`);
        }
        await ctx.close();
      }
      ok('screenshots kept', true);
    } else {
      ok('screenshots skipped (no SHOTS)', true);
    }
  } finally {
    sql(`delete from public.crew_calls where poster_id in (${ids})`);
    sql(`delete from public.productions where id = ${q(PROD)}`);
    sql(`delete from public.crew_headshots where user_id in (${ids})`);
    sql(`delete from public.crew_gear where user_id in (${ids})`);
    sql(`delete from public.crew_cards where user_id in (${ids})`);
    for (const id of ALL) await removeUser(id);
    await b.close();
  }
});
