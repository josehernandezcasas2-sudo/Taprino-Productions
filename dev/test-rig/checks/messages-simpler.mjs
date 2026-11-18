// Messages, simpler (2026-11-18, Jose: "I like that design and choice,
// let's build"; the agreement is mockups/messages-simpler-contract.md). The
// website half: pages/messages/[[...id]].js, the .dm2-* styles, the
// production page's Message / Message the producer, the place page's
// "Ask about a date" carrying the place's id.
//
// Seeds five accounts of this run (Avery reads; Bianca wrote about a call;
// Cyrus is on Avery's production and has a plain conversation with Avery;
// Delphine is nobody's; Emeric's conversation is about a place and muted, and
// Avery follows Emeric), one production with Cyrus on its crew, three
// conversations, and checks:
//   - the inbox at 390 and 1280: the title row, the search (16px, filters
//     rows), All / Unread, the context line with its tinted icon, the unread
//     dot, the muted mark, "You: ";
//   - a conversation at 390: full screen (no site header, no tab bar, no
//     footer), back, the subject card's link, bubbles by day, the composer
//     (16px, Enter is a new line on a touch screen), a send, the ⋯ sheet
//     (mute on and off against the database);
//   - at 1280: two panes under the header filling the window, no footer, no
//     page scroll, Enter sends and Shift+Enter is a new line, ⋯ a small menu;
//   - a subject brought from the production page onto an existing
//     conversation: the redirect, the chip, the context saved with the next
//     send, the chip's ×; a production subject refused between two people
//     not both on it (page and API);
//   - New message: suggestions (productions, following), a search by name and
//     by @handle, nobody, a tap opening a new conversation or the existing
//     one, Escape;
//   - the production page's links, the empty inbox, signed out, no sideways
//     scroll at 320 / 390 / 1280, no page errors.
// Removes everything it made.
//
//   node dev/test-rig/checks/messages-simpler.mjs   (the rig must be up)
import crypto from 'node:crypto';
import { RUN, SIGNED_OUT, ok, section, runCheck, browser, goto, overflowPx, rows, sql, q, insert, call, newUser, removeUser, BASE } from './lib.mjs';

const PROD = crypto.randomUUID();
const CALL_ID = crypto.randomUUID();
const PROD_TITLE = `Harbor Night ${RUN}`;
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
const pair = (a, b) => (a < b ? [a, b] : [b, a]);

function thread(id, x, y, { context = null, messages = [] }) {
  const [a, b] = pair(x, y);
  const last = messages[messages.length - 1];
  insert('dm_threads', { id, user_a: a, user_b: b, context, last_message_at: last.at, last_message_preview: last.body.slice(0, 120), last_sender_id: last.from });
  for (const m of messages) insert('dm_messages', { thread_id: id, sender_id: m.from, body: m.body, created_at: m.at });
}

const visible = (pg, sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; }).catch(() => false);
const rect = (pg, sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
const rowNames = (pg) => pg.$$eval('.dm2-rows .dm2-row .dm2-row-name-text', (els) => els.map((e) => e.textContent.trim()));
const fontPx = (pg, sel) => pg.$eval(sel, (e) => parseFloat(getComputedStyle(e).fontSize));
// SHOTS=<dir> keeps a screenshot of each screen, for a look by eye.
const shot = async (pg, name) => { if (process.env.SHOTS) await pg.screenshot({ path: `${process.env.SHOTS}/${name}.png` }).catch(() => {}); };

await runCheck('messages-simpler', async () => {
  const A = await newUser('dma', { displayName: `Avery ${RUN}`, handle: `avery${RUN}` });
  const B = await newUser('dmb', { displayName: `Bianca Zorro ${RUN}`, handle: `bz${RUN}` });
  const C = await newUser('dmc', { displayName: `Cyrus Crew ${RUN}`, handle: `cyrus${RUN}` });
  const D = await newUser('dmd', { displayName: `Delphine Outsider ${RUN}`, handle: `delph${RUN}` });
  const E = await newUser('dme', { displayName: `Emeric Muted ${RUN}`, handle: `emeric${RUN}` });
  const F = await newUser('dmf', { displayName: `Fern Empty ${RUN}`, handle: `fern${RUN}` });
  const ALL = [A, B, C, D, E, F].map((u) => u.id);
  const T1 = crypto.randomUUID(); // Avery ↔ Bianca, about a call, unread
  const T2 = crypto.randomUUID(); // Avery ↔ Cyrus, a direct message
  const T3 = crypto.randomUUID(); // Avery ↔ Emeric, about a place, muted
  const b = await browser();
  try {
    insert('productions', { id: PROD, owner_id: A.id, title: PROD_TITLE, kind: 'short', status: 'prep', visibility: 'public' });
    insert('production_members', { production_id: PROD, user_id: C.id, role: 'Gaffer', added_by: A.id });
    insert('user_follows', { follower_id: A.id, followed_id: E.id });
    thread(T1, A.id, B.id, {
      context: { kind: 'call', label: `Gaffer · Sat ${RUN}`, id: CALL_ID },
      messages: [
        { from: B.id, body: 'Hi! Saw your call for a gaffer on the 6th. I’m free that day.', at: minutesAgo(26 * 60 + 9) },
        { from: B.id, body: 'I have a 600D and a couple of tubes.', at: minutesAgo(26 * 60 + 8) },
        { from: A.id, body: 'Great — it’s a night exterior, about 10 hours. Can you bring stands too?', at: minutesAgo(26 * 60 + 5) },
        { from: B.id, body: `Sounds good — I can bring the 600D and two stands. ${RUN}`, at: minutesAgo(3) }
      ]
    });
    thread(T2, A.id, C.id, { messages: [{ from: A.id, body: 'Hey Cyrus, are you free next week?', at: minutesAgo(2 * 24 * 60) }] });
    thread(T3, A.id, E.id, { context: { kind: 'location', label: `Echo loft ${RUN}` }, messages: [{ from: E.id, body: 'Is the loft free the weekend after?', at: minutesAgo(3 * 24 * 60) }] });
    insert('dm_thread_state', { thread_id: T2, user_id: A.id, last_read_at: new Date().toISOString() });
    insert('dm_thread_state', { thread_id: T3, user_id: A.id, last_read_at: new Date().toISOString(), muted: true });

    section('The API, as the page uses it');
    {
      const inbox = await call('/api/messages', { who: A });
      ok('the inbox: three conversations, one unread', inbox.status === 200 && inbox.json.threads.length === 3 && inbox.json.unread === 1, inbox.json);
      const people = await call('/api/messages/people', { who: A });
      ok('suggested: Cyrus from the production, Emeric from following', people.status === 200 && people.json.productions.some((p) => p.userId === C.id && p.why === PROD_TITLE) && people.json.following.some((p) => p.userId === E.id), people.json);
      const byName = await call(`/api/messages/people?q=${encodeURIComponent('Delphine Outsider')}`, { who: A });
      ok('search by name finds Delphine', byName.status === 200 && byName.json.people.some((p) => p.userId === D.id), byName.json);
      const byHandle = await call(`/api/messages/people?q=${encodeURIComponent(`@delph${RUN}`)}`, { who: A });
      ok('search by @handle finds Delphine', byHandle.status === 200 && byHandle.json.people.some((p) => p.userId === D.id), byHandle.json);
      const refused = await call('/api/messages', { who: A, method: 'POST', body: { toUserId: D.id, body: 'About the shoot', context: { kind: 'production', id: PROD, label: PROD_TITLE } } });
      ok('a production subject between two people not both on it is refused (403)', refused.status === 403 && /Only people on this production/.test((refused.json && refused.json.error) || ''), refused.json);
      ok('…and nothing was created', rows(`select 1 from public.dm_threads where (user_a = ${q(A.id)} or user_b = ${q(A.id)}) and (user_a = ${q(D.id)} or user_b = ${q(D.id)})`).length === 0);
    }

    section('The inbox on a phone (390)');
    {
      const { ctx, page: pg, errors } = await b.open(A, 390);
      await goto(pg, '/messages');
      await pg.waitForSelector('.dm2-row');
      const title = await pg.$eval('h1.dm2-title', (e) => ({ text: e.textContent.trim(), font: getComputedStyle(e).fontFamily, size: parseFloat(getComputedStyle(e).fontSize) }));
      ok('the title row: “Messages” in the serif, 28px', title.text === 'Messages' && /Fraunces/.test(title.font) && title.size === 28, title);
      const nb = await pg.$eval('.dm2-newbtn', (e) => ({ label: e.getAttribute('aria-label'), w: e.getBoundingClientRect().width, bg: getComputedStyle(e).backgroundColor }));
      ok('…and a round orange New message button, 44px', nb.label === 'New message' && Math.round(nb.w) === 44 && /255, 140, 66/.test(nb.bg), nb);
      ok('the site header and the tab bar are there on the inbox', (await visible(pg, '.channel-bar')) && (await visible(pg, '.tabbar')));
      ok('no footer on Messages', !(await pg.$('footer.site-footer')));
      ok('the search box is 16px', (await fontPx(pg, '.dm2-search input')) >= 16);
      const chips = await pg.$$eval('.dm2-chip', (els) => els.map((e) => ({ t: e.textContent.trim(), p: e.getAttribute('aria-pressed') })));
      ok('two chips: All (pressed) and Unread · 1', chips.length === 2 && chips[0].t === 'All' && chips[0].p === 'true' && chips[1].t === 'Unread · 1' && chips[1].p === 'false', chips);
      const names = await rowNames(pg);
      ok('three rows, newest first', names.length === 3 && names[0] === `Bianca Zorro ${RUN}` && names[1] === `Cyrus Crew ${RUN}` && names[2] === `Emeric Muted ${RUN}`, names);
      const r1 = await pg.$eval('.dm2-row:nth-child(1)', (e) => ({
        unread: e.classList.contains('unread'),
        dot: Boolean(e.querySelector('.dm2-dot[aria-label="Unread"]')),
        weight: getComputedStyle(e.querySelector('.dm2-row-name')).fontWeight,
        ctx: e.querySelector('.dm2-row-ctx').textContent.trim(),
        iconColor: getComputedStyle(e.querySelector('.dm2-row-ctx svg')).color,
        preview: e.querySelector('.dm2-row-preview').textContent.trim(),
        previewFont: getComputedStyle(e.querySelector('.dm2-row-preview')).fontFamily,
        href: e.getAttribute('href'),
        face: Boolean(e.querySelector('.dm2-face'))
      }));
      ok('Bianca’s row: unread, the dot, the name bold', r1.unread && r1.dot && Number(r1.weight) >= 700, r1);
      ok('…what it is about, with the call’s orange icon', r1.ctx === `About a call · Gaffer · Sat ${RUN}` && /255, 140, 66/.test(r1.iconColor), r1);
      ok('…the last line in the serif, and the link to the conversation', /Fraunces/.test(r1.previewFont) && r1.preview.startsWith('Sounds good') && r1.href === `/messages/${T1}` && r1.face, r1);
      const r2 = await pg.$eval('.dm2-row:nth-child(2)', (e) => ({ ctx: e.querySelector('.dm2-row-ctx').textContent.trim(), preview: e.querySelector('.dm2-row-preview').textContent.trim(), unread: e.classList.contains('unread') }));
      ok('Cyrus’s row: “You: …” and “Direct message”', r2.preview.startsWith('You: Hey Cyrus') && r2.ctx === 'Direct message' && !r2.unread, r2);
      const r3 = await pg.$eval('.dm2-row:nth-child(3)', (e) => ({ ctx: e.querySelector('.dm2-row-ctx').textContent.trim(), muted: Boolean(e.querySelector('.dm2-row-muted[aria-label="Muted"]')), iconColor: getComputedStyle(e.querySelector('.dm2-row-ctx svg')).color }));
      ok('Emeric’s row: about a place (mint), muted', r3.ctx === `About a place · Echo loft ${RUN}` && r3.muted && /147, 208, 164/.test(r3.iconColor), r3);
      await pg.fill('.dm2-search input', 'bianca');
      await pg.waitForTimeout(200);
      ok('the search filters by name', JSON.stringify(await rowNames(pg)) === JSON.stringify([`Bianca Zorro ${RUN}`]));
      await pg.fill('.dm2-search input', 'echo loft');
      await pg.waitForTimeout(200);
      ok('…and by what it is about', JSON.stringify(await rowNames(pg)) === JSON.stringify([`Emeric Muted ${RUN}`]));
      await pg.fill('.dm2-search input', 'zzqqxx');
      await pg.waitForTimeout(200);
      ok('…nothing left says so', (await rowNames(pg)).length === 0 && (await pg.$eval('.dm2-filter-empty', (e) => e.textContent.trim())) === 'Nothing matches that.');
      await pg.fill('.dm2-search input', '');
      await pg.locator('.dm2-chip', { hasText: 'Unread' }).tap();
      await pg.waitForTimeout(200);
      ok('Unread shows the one unread conversation', JSON.stringify(await rowNames(pg)) === JSON.stringify([`Bianca Zorro ${RUN}`]) && (await pg.$eval('.dm2-chip:nth-child(2)', (e) => e.getAttribute('aria-pressed'))) === 'true');
      await pg.locator('.dm2-chip', { hasText: 'All' }).tap();
      await shot(pg, 'inbox-390');
      await pg.setViewportSize({ width: 390, height: 420 });
      await pg.waitForTimeout(200);
      await pg.evaluate(() => window.scrollTo(0, 160));
      await pg.waitForTimeout(200);
      const stick = await pg.evaluate(() => ({ y: window.scrollY, top: document.querySelector('.channel-bar').getBoundingClientRect().top }));
      ok('the header stays stuck to the top as the inbox scrolls', stick.y > 40 && Math.abs(stick.top) < 1, stick);
      // New message over a page that can scroll: the page behind never moves.
      await pg.locator('.dm2-newbtn').tap();
      await pg.waitForSelector('.dm2-people');
      const y0 = await pg.evaluate(() => window.scrollY);
      const lb = await rect(pg, '.dm2-new-list');
      await pg.mouse.move(lb.left + 40, lb.top + 20);
      await pg.mouse.wheel(0, 600);
      await pg.waitForTimeout(250);
      await pg.mouse.wheel(0, -600);
      await pg.waitForTimeout(250);
      ok('a wheel over New message leaves the page where it was', (await pg.evaluate(() => window.scrollY)) === y0, { y0, y: await pg.evaluate(() => window.scrollY) });
      await pg.locator('.dm2-x').tap();
      await pg.waitForTimeout(150);
      ok('× closes New message', !(await pg.$('.dm2-new')));
      await pg.setViewportSize({ width: 390, height: 844 });
      await pg.evaluate(() => window.scrollTo(0, 0));
      ok('nothing off the side at 390', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      ok('no page errors on the inbox', errors.length === 0, errors);
      await ctx.close();
    }

    section('A conversation on a phone (390): full screen');
    {
      const { ctx, page: pg, errors } = await b.open(A, 390);
      await goto(pg, `/messages/${T1}`);
      await pg.waitForSelector('.dm2-thread');
      await shot(pg, 'thread-390');
      ok('no site header', !(await visible(pg, '.channel-bar')));
      ok('no tab bar', !(await visible(pg, '.tabbar')));
      ok('no footer', !(await pg.$('footer.site-footer')));
      const box = await rect(pg, '.dm2-convo');
      ok('the conversation fills the screen', Math.abs(box.top) < 1 && Math.abs(box.height - 844) < 2 && Math.abs(box.width - 390) < 1, box);
      ok('the list is not drawn under it', !(await visible(pg, '.dm2-list')));
      const back = await pg.$eval('.dm2-back', (e) => ({ href: e.getAttribute('href'), label: e.getAttribute('aria-label'), w: e.getBoundingClientRect().width }));
      ok('back to the inbox, 44px', back.href === '/messages' && back.label === 'Back to messages' && Math.round(back.w) === 44, back);
      const who = await pg.$eval('.dm2-who', (e) => ({ href: e.getAttribute('href'), name: e.querySelector('.dm2-who-name').textContent.trim(), handle: (e.querySelector('.dm2-who-handle') || {}).textContent }));
      ok('the photo, name and @handle open their profile', who.name === `Bianca Zorro ${RUN}` && who.handle === `@bz${RUN}` && /^\/profile\//.test(who.href), who);
      ok('“View profile” is the laptop’s pill only', !(await visible(pg, '.dm2-profile-pill')));
      const subj = await pg.$eval('.dm2-subject', (e) => ({ tag: e.tagName, href: e.getAttribute('href'), kicker: e.querySelector('.dm2-subject-kicker').textContent.trim(), label: e.querySelector('.dm2-subject-label').textContent.trim(), go: (e.querySelector('.dm2-subject-go') || {}).textContent }));
      ok('the subject card: About a call, the label, “Open the call ›” to the call', subj.tag === 'A' && subj.href === `/crew/calls/${CALL_ID}` && subj.kicker === 'About a call' && subj.label === `Gaffer · Sat ${RUN}` && subj.go === 'Open the call ›', subj);
      const bubbles = await pg.$$eval('.dm2-msg', (els) => els.map((e) => ({ mine: e.classList.contains('mine'), right: e.querySelector('.dm2-bubble').getBoundingClientRect().right, left: e.querySelector('.dm2-bubble').getBoundingClientRect().left, bg: getComputedStyle(e.querySelector('.dm2-bubble')).backgroundColor })));
      ok('four bubbles, mine orange on the right, theirs on the left', bubbles.length === 4 && bubbles[2].mine && !bubbles[0].mine && /255, 140, 66/.test(bubbles[2].bg) && bubbles[2].right > 370 && bubbles[0].left < 30, bubbles);
      const days = await pg.$$eval('.dm2-day', (els) => els.map((e) => e.textContent.trim()));
      ok('the messages are under day labels', days.length >= 1 && days.every(Boolean), days);
      const times = await pg.$$eval('.dm2-msg', (els) => els.map((e) => Boolean(e.querySelector('.dm2-time'))));
      ok('a time under the last message of each run, not under every message', JSON.stringify(times) === JSON.stringify([false, true, true, true]), times);
      const newest = await pg.$eval('.dm2-msgs', (e) => e.scrollHeight - e.scrollTop - e.clientHeight);
      ok('the newest message is in view', newest <= 2, newest);
      const ta = await pg.$eval('.dm2-field textarea', (e) => ({ ph: e.placeholder, max: e.maxLength, size: parseFloat(getComputedStyle(e).fontSize) }));
      ok('the composer: “Message Bianca…”, 16px, the limit', ta.ph === 'Message Bianca…' && ta.size >= 16 && ta.max === 2000, ta);
      ok('send is muted while the box is empty', await pg.$eval('.dm2-send', (e) => e.disabled && !e.classList.contains('ready')));
      await pg.locator('.dm2-field textarea').tap();
      await pg.keyboard.type('Line one');
      await pg.keyboard.press('Enter');
      await pg.keyboard.type('line two');
      const val = await pg.$eval('.dm2-field textarea', (e) => e.value);
      ok('on a touch screen Enter is a new line', val === 'Line one\nline two', val);
      ok('send turns orange with text', await pg.$eval('.dm2-send', (e) => !e.disabled && e.classList.contains('ready')));
      const before = rows(`select count(*)::int as n from public.dm_messages where thread_id = ${q(T1)}`)[0].n;
      await pg.locator('.dm2-send').tap();
      await pg.waitForFunction(() => document.querySelectorAll('.dm2-msg').length === 5, null, { timeout: 15000 }).catch(() => {});
      const after = rows(`select count(*)::int as n from public.dm_messages where thread_id = ${q(T1)}`)[0].n;
      ok('the send button sends it', after === before + 1 && (await pg.$$('.dm2-msg')).length === 5 && (await pg.$eval('.dm2-field textarea', (e) => e.value)) === '', { before, after });
      ok('…kept as one message with its line break', rows(`select body from public.dm_messages where thread_id = ${q(T1)} order by created_at desc limit 1`)[0].body === 'Line one\nline two');

      // ⋯ — a sheet from the bottom
      await pg.locator('.dm2-more-btn').tap();
      await pg.waitForSelector('.dm2-more');
      await shot(pg, 'more-390');
      const sheet = await rect(pg, '.dm2-more');
      ok('⋯ opens a sheet from the bottom', Math.abs(sheet.bottom - 844) < 2 && Math.abs(sheet.width - 390) < 1, sheet);
      const items = await pg.$$eval('.dm2-more .dm2-more-item, .dm2-more .dm2-more-cancel', (els) => els.map((e) => e.textContent.trim()));
      ok('…View profile, Open the call, Mute with its line, Block, Report, Cancel', JSON.stringify(items) === JSON.stringify(['View profile', 'Open the call', 'MuteNo emails or badge for this conversation', 'Block', 'Report this conversation', 'Cancel']), items);
      await pg.locator('.dm2-more-item', { hasText: 'Mute' }).tap();
      await pg.waitForSelector('.dm2-toast');
      ok('Mute: the toast', (await pg.$eval('.dm2-toast', (e) => e.textContent.trim())) === 'Muted. No emails or badge for this conversation.');
      ok('…and the conversation is muted in the database', rows(`select muted from public.dm_thread_state where thread_id = ${q(T1)} and user_id = ${q(A.id)}`)[0]?.muted === true);
      ok('…the sheet closed', !(await pg.$('.dm2-more')));
      await pg.locator('.dm2-more-btn').tap();
      await pg.waitForSelector('.dm2-more');
      ok('⋯ now says Unmute', (await pg.$$eval('.dm2-more .dm2-more-item', (els) => els.map((e) => e.textContent.trim()))).some((t) => t.startsWith('Unmute')));
      await pg.locator('.dm2-more-item', { hasText: 'Unmute' }).tap();
      await pg.waitForFunction(() => /Unmuted/.test((document.querySelector('.dm2-toast') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
      ok('Unmute: the toast and the database', (await pg.$eval('.dm2-toast', (e) => e.textContent.trim())) === 'Unmuted.' && rows(`select muted from public.dm_thread_state where thread_id = ${q(T1)} and user_id = ${q(A.id)}`)[0]?.muted === false);
      await pg.locator('.dm2-more-btn').tap();
      await pg.waitForSelector('.dm2-more');
      await pg.locator('.dm2-more-item', { hasText: 'Block' }).tap();
      const confirm = await pg.$eval('.dm2-more-step p', (e) => e.textContent.trim());
      ok('Block asks first, in the rules’ words', confirm === `Block Bianca Zorro ${RUN}? They can’t message you and won’t see your card. You can undo this here.`, confirm);
      await pg.locator('.dm2-more .dm2-pill', { hasText: 'Cancel' }).tap();
      ok('…Cancel blocks nobody', !(await pg.$('.dm2-more')) && rows(`select 1 from public.user_blocks where blocker_id = ${q(A.id)}`).length === 0);
      await pg.locator('.dm2-more-btn').tap();
      await pg.waitForSelector('.dm2-more');
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(150);
      ok('Escape closes the sheet', !(await pg.$('.dm2-more')));
      ok('nothing off the side at 390', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await pg.setViewportSize({ width: 320, height: 640 });
      await pg.waitForTimeout(300);
      ok('nothing off the side at 320, and it still fills the screen', (await overflowPx(pg)) <= 0 && Math.abs((await rect(pg, '.dm2-convo')).height - 640) < 2, { over: await overflowPx(pg), box: await rect(pg, '.dm2-convo') });
      await pg.setViewportSize({ width: 390, height: 844 });
      await pg.locator('.dm2-back').tap();
      await pg.waitForURL(`${BASE}/messages`, { timeout: 30000 });
      await pg.waitForSelector('.dm2-row');
      ok('back lands on the inbox, header and tab bar back', (await visible(pg, '.channel-bar')) && (await visible(pg, '.tabbar')));
      ok('no page errors in the conversation', errors.length === 0, errors);
      await ctx.close();
    }

    section('On a laptop (1280): two panes under the header');
    {
      const { ctx, page: pg, errors } = await b.open(A, 1280);
      await goto(pg, '/messages');
      await pg.waitForSelector('.dm2-row');
      ok('no conversation open: “Pick a conversation.”', (await pg.$eval('.dm2-pick', (e) => e.textContent.trim())) === 'Pick a conversation.');
      await goto(pg, `/messages/${T1}`);
      await pg.waitForSelector('.dm2-thread');
      await pg.waitForTimeout(400);
      await shot(pg, 'thread-1280');
      ok('the header stays', await visible(pg, '.channel-bar'));
      ok('the rail is there', await visible(pg, '.tabbar'));
      ok('no footer', !(await pg.$('footer.site-footer')));
      const list = await rect(pg, '.dm2-list');
      const convo = await rect(pg, '.dm2-convo');
      const header = await rect(pg, '.channel-bar');
      ok('the list is 380px, the conversation beside it', Math.round(list.width) === 380 && Math.abs(convo.left - list.right) < 1 && convo.width > 600, { list, convo });
      ok('both panes run from the header to the bottom of the window', Math.abs(list.top - header.bottom) < 2 && Math.abs(list.bottom - 900) < 2 && Math.abs(convo.bottom - 900) < 2, { list, convo, header });
      const scroll = await pg.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      ok('the page itself doesn’t scroll', scroll <= 1, scroll);
      ok('the open row is marked', (await pg.$eval('.dm2-row[aria-current="true"]', (e) => e.getAttribute('href'))) === `/messages/${T1}`);
      ok('back is hidden, View profile shows', !(await visible(pg, '.dm2-back')) && (await visible(pg, '.dm2-profile-pill')));
      ok('Bianca’s row is read now', !(await pg.$eval('.dm2-row[aria-current="true"]', (e) => e.classList.contains('unread'))));
      await pg.locator('.dm2-field textarea').click();
      await pg.keyboard.type('Two');
      await pg.keyboard.press('Shift+Enter');
      await pg.keyboard.type('lines');
      ok('Shift+Enter is a new line', (await pg.$eval('.dm2-field textarea', (e) => e.value)) === 'Two\nlines');
      await pg.fill('.dm2-field textarea', Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'));
      await pg.waitForTimeout(100);
      const grown = await pg.$eval('.dm2-field textarea', (e) => ({ h: e.getBoundingClientRect().height, line: parseFloat(getComputedStyle(e).lineHeight), scrolls: e.scrollHeight > e.clientHeight }));
      ok('the box grows to about six lines, then scrolls', grown.h > grown.line * 5 && grown.h < grown.line * 7 + 24 && grown.scrolls, grown);
      ok('no count far from the limit', !(await pg.$('.dm2-count')));
      await pg.fill('.dm2-field textarea', 'x'.repeat(1850));
      await pg.waitForTimeout(100);
      ok('within 200 of the limit, a small count', (await pg.$eval('.dm2-count', (e) => e.textContent.trim()).catch(() => '')) === '1850/2000');
      await pg.fill('.dm2-field textarea', `Desktop hello ${RUN}`);
      const n0 = (await pg.$$('.dm2-msg')).length;
      await pg.keyboard.press('Enter');
      await pg.waitForFunction((n) => document.querySelectorAll('.dm2-msg').length === n + 1, n0, { timeout: 15000 }).catch(() => {});
      ok('Enter sends on a keyboard-and-mouse screen', (await pg.$$('.dm2-msg')).length === n0 + 1 && rows(`select 1 from public.dm_messages where thread_id = ${q(T1)} and body = ${q(`Desktop hello ${RUN}`)}`).length === 1);
      ok('…and the row moves to the top with “You: ”', (await pg.$eval('.dm2-row:first-child .dm2-row-preview', (e) => e.textContent.trim())) === `You: Desktop hello ${RUN}`);
      await pg.locator('.dm2-more-btn').click();
      await pg.waitForSelector('.dm2-more');
      await shot(pg, 'more-1280');
      const menu = await rect(pg, '.dm2-more');
      const btn = await rect(pg, '.dm2-more-btn');
      ok('⋯ is a small menu under its button', menu.width <= 320 && menu.top >= btn.bottom && menu.top - btn.bottom < 12 && Math.abs(menu.right - btn.right) < 2, { menu, btn });
      ok('…without the phone’s Cancel', !(await visible(pg, '.dm2-more-cancel')));
      await pg.locator('.dm2-more-item', { hasText: 'Mute' }).click();
      await pg.waitForSelector('.dm2-toast');
      ok('Mute from the menu', rows(`select muted from public.dm_thread_state where thread_id = ${q(T1)} and user_id = ${q(A.id)}`)[0]?.muted === true);
      await pg.waitForTimeout(200);
      ok('…and the row shows it', Boolean(await pg.$('.dm2-row[aria-current="true"] .dm2-row-muted')));
      await pg.locator('.dm2-more-btn').click();
      await pg.locator('.dm2-more-item', { hasText: 'Unmute' }).click();
      await pg.waitForTimeout(600);
      ok('…and Unmute', rows(`select muted from public.dm_thread_state where thread_id = ${q(T1)} and user_id = ${q(A.id)}`)[0]?.muted === false);
      await pg.locator('.dm2-more-btn').click();
      await pg.waitForSelector('.dm2-more');
      await pg.mouse.click(200, 600);
      await pg.waitForTimeout(150);
      ok('a click elsewhere closes the menu', !(await pg.$('.dm2-more')));
      ok('nothing off the side at 1280', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await pg.setViewportSize({ width: 1000, height: 800 });
      await pg.waitForTimeout(400);
      const mid = await rect(pg, '.dm2-convo');
      const bar = await rect(pg, '.tabbar');
      ok('at 1000 the panes stop above the floating tab bar', mid.bottom <= bar.top + 1 && mid.bottom > 650, { mid, bar });
      ok('no page errors on the laptop', errors.length === 0, errors);
      await ctx.close();
    }

    section('A subject brought from the production page');
    {
      const crew = await b.open(C, 390);
      await goto(crew.page, `/productions/${PROD}`);
      await shot(crew.page, 'production-crew-390');
      const producer = await crew.page.$$eval('a', (els) => els.filter((e) => e.textContent.trim() === 'Message the producer').map((e) => e.getAttribute('href')));
      ok('a crew member gets “Message the producer”', producer.length === 1 && producer[0] === `/messages?to=${encodeURIComponent(A.id)}&kind=production&ref=${PROD}`, producer);
      ok('…next to “Take me off this”', await crew.page.$$eval('.prod-hero-side .crew-actions', (els) => els.some((e) => /Message the producer/.test(e.textContent) && /Take me off this/.test(e.textContent))));
      ok('no page errors on the production page (crew)', crew.errors.length === 0, crew.errors);
      await crew.ctx.close();

      const { ctx, page: pg, errors } = await b.open(A, 1280);
      await goto(pg, `/productions/${PROD}`);
      const msg = await pg.$$eval('.prod-member a', (els) => els.filter((e) => e.textContent.trim() === 'Message').map((e) => e.getAttribute('href')));
      ok('the owner gets Message on each crew row that isn’t them', msg.length === 1 && msg[0] === `/messages?to=${encodeURIComponent(C.id)}&kind=production&ref=${PROD}`, msg);
      ok('…and no “Message the producer”', !(await pg.$$eval('a', (els) => els.some((e) => e.textContent.trim() === 'Message the producer'))));
      await pg.locator('.prod-member a', { hasText: 'Message' }).click();
      await pg.waitForURL((u) => u.pathname === `/messages/${T2}`, { timeout: 60000 });
      await pg.waitForSelector('.dm2-thread');
      const u = new URL(pg.url());
      ok('the existing conversation opens, the subject in the address', u.searchParams.get('kind') === 'production' && u.searchParams.get('ref') === PROD, pg.url());
      const chip = await pg.$eval('.dm2-about', (e) => ({ text: e.querySelector('.dm2-about-text').textContent.trim(), x: e.querySelector('button').getAttribute('aria-label') }));
      ok('the chip: “Your next message is about …” with its ×', chip.text === `Your next message is about ${PROD_TITLE}` && chip.x === 'Not about this', chip);
      await shot(pg, 'pending-1280');
      ok('no subject card yet (it was a direct message)', !(await pg.$('.dm2-subject')));
      await pg.locator('.dm2-field textarea').click();
      await pg.keyboard.type(`About the shoot ${RUN}`);
      await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => !document.querySelector('.dm2-about'), null, { timeout: 15000 }).catch(() => {});
      ok('the chip goes with the send', !(await pg.$('.dm2-about')));
      const saved = rows(`select context->>'kind' as kind, context->>'id' as id, context->>'label' as label from public.dm_threads where id = ${q(T2)}`)[0];
      ok('…and the conversation is about the production now', saved.kind === 'production' && saved.id === PROD && saved.label === PROD_TITLE, saved);
      await pg.waitForTimeout(300);
      ok('…the address is plain again', new URL(pg.url()).search === '', pg.url());
      const subj = await pg.$eval('.dm2-subject', (e) => ({ href: e.getAttribute('href'), kicker: e.querySelector('.dm2-subject-kicker').textContent.trim(), go: e.querySelector('.dm2-subject-go').textContent.trim() }));
      ok('…the subject card links back to it', subj.href === `/productions/${PROD}` && subj.kicker === 'About a production' && subj.go === 'Open the production ›', subj);
      ok('the row says so too', (await pg.$eval('.dm2-row[aria-current="true"] .dm2-row-ctx', (e) => e.textContent.trim())) === `About a production · ${PROD_TITLE}`);

      // The chip's ×: the subject goes, the next message keeps the old one.
      await goto(pg, `/messages/${T3}?kind=location&label=${encodeURIComponent(`Other place ${RUN}`)}`);
      await pg.waitForSelector('.dm2-about');
      await pg.locator('.dm2-about button').click();
      await pg.waitForTimeout(300);
      ok('× drops the subject (chip gone, plain address)', !(await pg.$('.dm2-about')) && new URL(pg.url()).search === '', pg.url());
      await pg.fill('.dm2-field textarea', `Still about the loft ${RUN}`);
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(1500);
      ok('…and the conversation keeps what it was about', rows(`select context->>'label' as label from public.dm_threads where id = ${q(T3)}`)[0].label === `Echo loft ${RUN}`);

      // Refused: Avery and Delphine aren't both on the production.
      await goto(pg, `/messages?to=${encodeURIComponent(D.id)}&kind=production&ref=${PROD}`);
      await pg.waitForSelector('.dm2-thread');
      const line = await pg.$eval('.dm2-composer', (e) => e.textContent.trim());
      await shot(pg, 'refused-1280');
      ok('a production subject between people not both on it: the line, no composer', line === 'Only people on this production can message each other from it.' && !(await pg.$('.dm2-field textarea')) && !(await pg.$('.dm2-hello')), line);
      ok('no page errors (subjects)', errors.length === 0, errors);
      await ctx.close();
    }

    section('New message');
    {
      const { ctx, page: pg, errors } = await b.open(A, 390);
      await goto(pg, '/messages');
      await pg.locator('.dm2-newbtn').tap();
      await pg.waitForSelector('.dm2-new');
      await pg.waitForSelector('.dm2-people');
      const dlg = await pg.$eval('.dm2-new', (e) => ({ role: e.getAttribute('role'), title: e.querySelector('h2').textContent.trim(), focused: document.activeElement === e.querySelector('.dm2-to input'), size: parseFloat(getComputedStyle(e.querySelector('.dm2-to input')).fontSize), ph: e.querySelector('.dm2-to input').placeholder, bottom: e.getBoundingClientRect().bottom }));
      ok('a sheet: “New message”, the To box focused, 16px, “Name or @handle”', dlg.role === 'dialog' && dlg.title === 'New message' && dlg.focused && dlg.size >= 16 && dlg.ph === 'Name or @handle' && Math.abs(dlg.bottom - 844) < 2, dlg);
      await shot(pg, 'new-390');
      const groups = await pg.$$eval('.dm2-people', (els) => els.map((g) => ({ title: (g.querySelector('.dm2-people-title') || {}).textContent, people: [...g.querySelectorAll('.dm2-person')].map((p) => ({ name: p.querySelector('.dm2-person-name').textContent.trim(), line: (p.querySelector('.dm2-person-line') || {}).textContent, href: p.getAttribute('href') })) })));
      ok('suggestions: People on your productions (Cyrus · the production) and Following (Emeric)', groups.length === 2 && groups[0].title === 'People on your productions' && groups[0].people.some((p) => p.name === `Cyrus Crew ${RUN}` && p.line === `@cyrus${RUN} · ${PROD_TITLE}`) && groups[1].title === 'Following' && groups[1].people.some((p) => p.name === `Emeric Muted ${RUN}`), groups);
      await pg.fill('.dm2-to input', 'D');
      await pg.waitForTimeout(100);
      ok('one letter: “Type at least two letters.”', (await pg.$eval('.dm2-new-line', (e) => e.textContent.trim())) === 'Type at least two letters.');
      await pg.fill('.dm2-to input', 'Delphine Outs');
      await pg.waitForFunction((n) => [...document.querySelectorAll('.dm2-person-name')].some((e) => e.textContent.trim() === n), `Delphine Outsider ${RUN}`, { timeout: 15000 }).catch(() => {});
      ok('a search by name finds Delphine', await pg.$$eval('.dm2-person-name', (els, n) => els.some((e) => e.textContent.trim() === n), `Delphine Outsider ${RUN}`));
      await pg.fill('.dm2-to input', `@delph${RUN}`);
      await pg.waitForFunction((h) => [...document.querySelectorAll('.dm2-person-line')].some((e) => e.textContent.trim() === h), `@delph${RUN}`, { timeout: 15000 }).catch(() => {});
      ok('…and by @handle', await pg.$$eval('.dm2-person-line', (els, h) => els.some((e) => e.textContent.trim() === h), `@delph${RUN}`));
      await pg.fill('.dm2-to input', `zzqx${RUN}`);
      await pg.waitForFunction(() => /Nobody by that name/.test((document.querySelector('.dm2-new-line') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
      ok('nobody: “Nobody by that name or @handle.”', (await pg.$eval('.dm2-new-line', (e) => e.textContent.trim())) === 'Nobody by that name or @handle.');
      ok('Find people on Crew Call at the bottom', (await pg.$eval('.dm2-new-crew', (e) => e.getAttribute('href'))) === '/crew');
      ok('nothing off the side with it open', (await overflowPx(pg)) <= 0);
      await pg.fill('.dm2-to input', `@delph${RUN}`);
      await pg.waitForSelector('.dm2-person');
      await pg.locator('.dm2-person').first().tap();
      await pg.waitForURL((u) => u.pathname === '/messages' && u.searchParams.get('to') === D.id, { timeout: 60000 });
      await pg.waitForSelector('.dm2-thread');
      ok('a tap opens a new conversation (full screen, no subject, “Say hello”)', !(await pg.$('.dm2-new')) && !(await pg.$('.dm2-subject')) && (await pg.$eval('.dm2-hello', (e) => e.textContent.trim())) === 'Say hello to Delphine.' && !(await visible(pg, '.channel-bar')));
      await pg.locator('.dm2-field textarea').tap();
      await pg.keyboard.type(`Hello Delphine ${RUN}`);
      await pg.locator('.dm2-send').tap();
      await pg.waitForURL((u) => /^\/messages\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 60000 }).catch(() => {});
      await pg.waitForSelector('.dm2-msg');
      const made = rows(`select id, context from public.dm_threads where (user_a = ${q(A.id)} or user_b = ${q(A.id)}) and (user_a = ${q(D.id)} or user_b = ${q(D.id)})`);
      ok('…the first message starts it, a direct message', made.length === 1 && made[0].context === null && new URL(pg.url()).pathname === `/messages/${made[0].id}`, { made, url: pg.url() });
      ok('no page errors (New message, phone)', errors.length === 0, errors);
      await ctx.close();

      const lap = await b.open(A, 1280);
      await goto(lap.page, '/messages');
      await lap.page.locator('.dm2-newbtn').click();
      await lap.page.waitForSelector('.dm2-people');
      await shot(lap.page, 'new-1280');
      const box = await rect(lap.page, '.dm2-new');
      ok('on a laptop New message is a dialog in the middle', box.width <= 520 && Math.abs((box.left + box.right) / 2 - 640) < 2 && Math.abs((box.top + box.bottom) / 2 - 450) < 4, box);
      await lap.page.keyboard.press('Escape');
      await lap.page.waitForTimeout(150);
      ok('Escape closes it', !(await lap.page.$('.dm2-new')));
      await lap.page.locator('.dm2-newbtn').click();
      await lap.page.waitForSelector('.dm2-people');
      await lap.page.mouse.click(60, 450);
      await lap.page.waitForTimeout(150);
      ok('…and so does the dimmed area', !(await lap.page.$('.dm2-new')));
      await lap.page.locator('.dm2-newbtn').click();
      await lap.page.waitForSelector('.dm2-person');
      await lap.page.locator('.dm2-person', { hasText: `Cyrus Crew ${RUN}` }).first().click();
      await lap.page.waitForURL((u) => u.pathname === `/messages/${T2}`, { timeout: 60000 });
      ok('someone you already talk to: their conversation opens (no subject in the address)', new URL(lap.page.url()).search === '', lap.page.url());
      ok('no page errors (New message, laptop)', lap.errors.length === 0, lap.errors);
      await lap.ctx.close();
    }

    section('Nothing yet, and signed out');
    {
      const { ctx, page: pg, errors } = await b.open(F, 390);
      await goto(pg, '/messages');
      await shot(pg, 'empty-390');
      const empty = await pg.$eval('.dm2-empty', (e) => ({ h: e.querySelector('h2').textContent.trim(), p: e.querySelector('p').textContent.trim(), links: [...e.querySelectorAll('a, button')].map((x) => ({ t: x.textContent.trim(), href: x.getAttribute('href') })) }));
      ok('the empty card: “No messages yet”, the line, the two ways', empty.h === 'No messages yet' && /^Conversations start from a working card/.test(empty.p) && empty.links[0].t === 'Find people on Crew Call' && empty.links[0].href === '/crew' && empty.links[1].t === 'Write to someone you know', empty);
      ok('…no search or chips with nothing to filter', !(await pg.$('.dm2-search')) && !(await pg.$('.dm2-chip')));
      await pg.locator('.dm2-empty button').tap();
      await pg.waitForSelector('.dm2-new');
      ok('“Write to someone you know” opens New message', Boolean(await pg.$('.dm2-new')));
      ok('nothing off the side (empty, 390)', (await overflowPx(pg)) <= 0);
      ok('no page errors (empty)', errors.length === 0, errors);
      await ctx.close();

      const out = await b.open(SIGNED_OUT, 390);
      await goto(out.page, '/messages');
      await shot(out.page, 'signedout-390');
      const card = await out.page.$eval('.dm2-signin', (e) => ({ p: e.querySelector('p').textContent.trim(), btn: Boolean(e.querySelector('button')) })).catch(() => null);
      ok('signed out: the sign-in card', card && card.p === 'Sign in to see your messages. Anyone with an account can write to anyone on Crew Call.' && card.btn, card);
      ok('no page errors (signed out)', out.errors.length === 0, out.errors);
      await out.ctx.close();
    }

    section('No sideways scroll');
    {
      for (const w of [320, 390, 1280]) {
        const { ctx, page: pg } = await b.open(A, w);
        await goto(pg, '/messages');
        const inbox = await overflowPx(pg);
        await goto(pg, `/messages/${T1}`);
        const thread = await overflowPx(pg);
        ok(`at ${w}: inbox ${inbox}px, conversation ${thread}px over`, inbox <= 0 && thread <= 0);
        await ctx.close();
      }
    }
  } finally {
    await b.close().catch(() => {});
    sql(`delete from public.dm_threads where user_a in (${ALL.map(q).join(', ')}) or user_b in (${ALL.map(q).join(', ')})`);
    sql(`delete from public.user_blocks where blocker_id in (${ALL.map(q).join(', ')}) or blocked_id in (${ALL.map(q).join(', ')})`);
    sql(`delete from public.user_follows where follower_id in (${ALL.map(q).join(', ')}) or followed_id in (${ALL.map(q).join(', ')})`);
    sql(`delete from public.productions where id = ${q(PROD)}`);
    sql(`delete from public.notifications where user_id in (${ALL.map(q).join(', ')})`);
    for (const id of ALL) await removeUser(id);
  }
});
