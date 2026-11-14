#!/usr/bin/env node
// Money paths through the fakes (the cleanup and fail-closed rounds):
//   a member whose lineup picks the studio's own account and a creator: the
//     studio's line is kept — not owed on /admin/money, "Kept by the studio"
//     on /admin/creator-money and on the admin's own /creator/money
//   invoice.paid before checkout.session.completed for a new member: a 5xx
//     (Stripe tries again) while young, recorded once the member is known;
//     a day-old one with nobody to name is skipped, not retried for ever
//   a studio-owned title's Checkout while Clerk can't say who the studio is:
//     503 "This title can't be sold right now", and a normal Checkout after
//   a referral (?via=) through Checkout: the bonus line on the first invoice
//   node dev/test-rig/checks/money.mjs
import { IDS, USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, insert, session, newUser, removeUser, browser, goto, stripeHook, stripeApi, forgetInvoiceEvents, clerk, ago, uidFor } from './lib.mjs';

const ADMIN = session(USERS.admin);
const MARA = session(USERS.mara);
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const ID = { studioFilm: `ck-money-studio-${RUN}`, houseFilm: `ck-money-house-${RUN}` };
const people = [];
const invoices = [];

const film = (id, who, extra = {}) => ({
  id, title: `Check money film ${id.slice(9, 14)} ${RUN}`, description: 'Money check.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Studio Tapa',
  runtime: '1:10:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.film), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false,
  moderation_hold: false, submitted_by: who, status: 'approved', reviewed_at: ago(6), released_at: ago(6), created_at: ago(7), ...extra
});

async function member(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}
async function checkout(who, body) {
  const r = await call('/api/create-checkout-session', { who, method: 'POST', body: { tier: 'standard', ...body } });
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  return { r, sid };
}
async function pay(sid) {
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  return { status: done.status, deliveries: done.json ? done.json.deliveries || [] : [], session: done.json ? done.json.session : null };
}
const ledger = (where) => rows(`select creator_id, kind, cents, basis, member_id from public.creator_ledger where ${where} order by created_at`);

async function studioPick() {
  section('A member picks the studio’s own account and a creator');
  const m = await member('pick');
  let r = await call('/api/artist-support', { who: m, method: 'POST', body: { mode: 'equal', picks: [{ creatorId: USERS.admin }, { creatorId: USERS.mara }] } });
  ok('the lineup saves both picks (the studio account has released work)', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const before = await call('/api/admin/money', { who: ADMIN });
  ok('/api/admin/money answers', before.status === 200 && before.json && before.json.obligations, `${before.status} ${before.text.slice(0, 200)}`);
  const { r: co, sid } = await checkout(m, {});
  ok('membership Checkout opens', co.status === 200 && sid, co.text.slice(0, 200));
  const paid = await pay(sid);
  ok('Checkout completes; every webhook answered 2xx', paid.status === 200 && paid.deliveries.length >= 3 && paid.deliveries.every((d) => d.status >= 200 && d.status < 300), paid.deliveries.map((d) => `${d.type} ${d.status}`));
  const lines = ledger(`member_id = ${q(m.id)}`);
  const studioLine = lines.find((l) => l.creator_id === USERS.admin);
  const maraLine = lines.find((l) => l.creator_id === USERS.mara);
  ok('a member_share line for each pick', studioLine && maraLine && studioLine.kind === 'member_share' && maraLine.kind === 'member_share' && studioLine.basis === 'picks', lines);
  const after = await call('/api/admin/money', { who: ADMIN });
  const ob0 = before.json.obligations;
  const ob1 = after.json && after.json.obligations;
  ok('/admin/money: owed to creators grew by Mara’s line only', ob1 && ob1.owedCents - ob0.owedCents === maraLine.cents, ob1 && { before: ob0.owedCents, after: ob1.owedCents, mara: maraLine && maraLine.cents });
  ok('/admin/money: the studio’s line is counted apart as kept', ob1 && ob1.studioKeptCents - (ob0.studioKeptCents || 0) === studioLine.cents, ob1 && { before: ob0.studioKeptCents, after: ob1.studioKeptCents, studio: studioLine && studioLine.cents });
  r = await call('/api/admin/creator-money', { who: ADMIN });
  const plan = r.json && (r.json.plan || r.json.batch || {});
  const kept = (plan && plan.kept) || [];
  ok('/admin/creator-money: the studio account is in `kept`, not pay/held/carry', kept.some((k) => k.creatorId === USERS.admin) && !['pay', 'held', 'carry'].some((k) => (plan[k] || []).some((x) => x.creatorId === USERS.admin)), { kept: kept.map((k) => k.creatorId), keys: Object.keys(r.json || {}) });
  ok('/admin/creator-money: summary.studioKeptCents counts it', r.json && r.json.summary && r.json.summary.studioKeptCents >= studioLine.cents, r.json && r.json.summary);
  r = await call('/api/creator/money', { who: ADMIN });
  ok('the admin’s own /creator/money: kept by the studio, nothing owed', r.status === 200 && r.json && r.json.top && r.json.top.studioKept === true && r.json.top.owedCents === 0 && r.json.top.studioKeptCents >= studioLine.cents, r.json && r.json.top);
  r = await call('/api/creator/money', { who: MARA });
  ok('Mara’s /creator/money: owed as usual, not studio', r.status === 200 && r.json.top.studioKept === false && r.json.top.owedCents >= maraLine.cents, r.json && r.json.top);

  const b = await browser();
  try {
    const a = await b.open(ADMIN, 1280);
    await goto(a.page, '/admin/creator-money');
    // The panel fetches its numbers after the page draws, and on a rig that
    // has just been built that route compiles on this first hit: wait for
    // the words (up to 20 s) rather than a fixed moment.
    await a.page.getByText('Kept by the studio').first().waitFor({ timeout: 20000 }).catch(() => {});
    ok('/admin/creator-money says "Kept by the studio"', (await a.page.locator('body').innerText()).includes('Kept by the studio'));
    ok('…no page errors', a.errors.length === 0, a.errors);
    await goto(a.page, '/creator/money');
    await a.page.waitForTimeout(2500);
    const text = await a.page.locator('body').innerText();
    ok('the admin’s /creator/money says "Kept by the studio"', /kept by the studio/i.test(text));
    ok('…and not "Owed to you"', !/owed to you/i.test(text));
    ok('…no page errors', a.errors.length === 0, a.errors);
    await goto(a.page, '/admin/money');
    await a.page.waitForTimeout(2500);
    ok('/admin/money says the studio’s picks are not counted', /members picked the studio’s own account for/.test(await a.page.locator('body').innerText()));
    ok('…no page errors', a.errors.length === 0, a.errors);
    await a.ctx.close();
  } finally {
    await b.close();
  }
}

async function invoiceBeforeCheckout() {
  section('invoice.paid before checkout.session.completed');
  const m = await member('early');
  const cus = await stripeApi('/customers', { method: 'POST', params: { email: m.email } });
  const cusId = cus.json && cus.json.id;
  ok('a fresh Stripe customer with no Clerk id on it', cus.status === 200 && cusId && !(cus.json.metadata || {}).clerkUserId, cus.json);
  const standard = (await stripeHook('/__state')).json.objects.find((o) => o.object === 'price' && o.recurring && o.unit_amount === 799);
  const now = Math.floor(Date.now() / 1000);
  const invoice = (id, paidAt, customer) => ({
    id, object: 'invoice', status: 'paid', paid: true, customer, subscription: `sub_ckmissing${RUN}${id.slice(-4)}`, amount_paid: 799, amount_due: 799, currency: 'usd', created: paidAt,
    billing_reason: 'subscription_create', status_transitions: { paid_at: paidAt, finalized_at: paidAt }, charge: null, payment_intent: null,
    lines: { object: 'list', data: [{ id: `il_${id}`, object: 'line_item', amount: 799, currency: 'usd', price: standard, quantity: 1, period: { start: paidAt, end: paidAt + 30 * 86400 }, type: 'subscription' }] }
  });
  const young = invoice(`in_ckyoung${RUN}`, now, cusId);
  invoices.push(young.id);
  let d = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: young } });
  ok('nobody names the member yet → 5xx, so Stripe tries again', d.status === 200 && d.json.delivery.status >= 500, d.json && d.json.delivery);
  const evId = d.json && d.json.event && d.json.event.id;
  ok('…and the event is handed back (no stripe_events row left)', rows(`select id from public.stripe_events where id = ${q(evId)}`).length === 0);
  ok('…nothing recorded', rows(`select id from public.member_payments where stripe_invoice_id = ${q(young.id)}`).length === 0);
  d = await stripeHook('/__event', { method: 'POST', body: { type: 'checkout.session.completed', object: { id: `cs_ckearly${RUN}`, object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid', customer: cusId, client_reference_id: m.id, metadata: { member: m.id, tier: 'standard' } } } });
  ok('checkout.session.completed arrives → 200', d.json && d.json.delivery.status === 200, d.json && d.json.delivery);
  ok('…the member is known now (member_customers)', rows(`select user_id from public.member_customers where stripe_customer_id = ${q(cusId)}`).some((x) => x.user_id === m.id));
  d = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: young } });
  ok('Stripe’s retry of the invoice → 200', d.json && d.json.delivery.status === 200, d.json && d.json.delivery);
  const pays = rows(`select user_id, tier, amount_cents from public.member_payments where stripe_invoice_id = ${q(young.id)}`);
  ok('…recorded once, for the member, at Standard', pays.length === 1 && pays[0].user_id === m.id && pays[0].tier === 'standard', pays);
  d = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: young } });
  ok('a second retry → 200, still one payment', d.json && d.json.delivery.status === 200 && rows(`select id from public.member_payments where stripe_invoice_id = ${q(young.id)}`).length === 1, d.json && d.json.delivery);
  // A day old with nobody to name: skipped (logged), never failing for ever.
  const cus2 = await stripeApi('/customers', { method: 'POST', params: { email: `stale-${RUN}@rig.example.com` } });
  const old = invoice(`in_ckold${RUN}`, now - 25 * 3600, cus2.json.id);
  invoices.push(old.id);
  d = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: old } });
  ok('a 25-hour-old invoice with no member → 200 (skipped, not retried for ever)', d.json && d.json.delivery.status === 200, d.json && d.json.delivery);
  ok('…and nothing recorded for it', rows(`select id from public.member_payments where stripe_invoice_id = ${q(old.id)}`).length === 0);
  // The Clerk id on the Stripe customer names the member too.
  const m2 = await member('stamped');
  const cus3 = await stripeApi('/customers', { method: 'POST', params: { email: m2.email, metadata: { clerkUserId: m2.id } } });
  const viaCustomer = invoice(`in_ckstamp${RUN}`, now, cus3.json.id);
  invoices.push(viaCustomer.id);
  d = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: viaCustomer } });
  ok('a customer stamped with the Clerk id names the member at once → 200 and recorded', d.json && d.json.delivery.status === 200 && rows(`select user_id from public.member_payments where stripe_invoice_id = ${q(viaCustomer.id)}`).some((x) => x.user_id === m2.id), d.json && d.json.delivery);
}

async function houseSale() {
  section('A studio-owned title’s Checkout while Clerk can’t answer');
  const studio = await member('studio', { role: 'admin', displayName: 'Check Studio' });
  insert('episodes', film(ID.houseFilm, studio.id, { tier: 'premium' }));
  insert('title_prices', { target_type: 'episode', target_id: ID.houseFilm, creator_id: studio.id, price_cents: 299, status: 'on', requested_at: ago(2), reviewed_by: USERS.admin, reviewed_at: ago(2) });
  const buyer = await member('buyer');
  await clerk(`/__fail?user=${studio.id}&on=1`, { method: 'POST' });
  try {
    const pg = await page(`/episode/${ID.houseFilm}`, buyer);
    ok('the title’s page still opens while Clerk fails (200)', pg.status === 200, pg.status);
    const r = await call('/api/purchases/checkout', { who: buyer, method: 'POST', body: { type: 'episode', id: ID.houseFilm } });
    ok('Checkout → 503 "This title can’t be sold right now"', r.status === 503 && /can’t be sold right now/.test(r.json && r.json.error), `${r.status} ${r.text.slice(0, 200)}`);
    ok('…no purchase row was written', rows(`select id from public.purchases where target_id = ${q(ID.houseFilm)}`).length === 0);
  } finally {
    await clerk(`/__fail?user=${studio.id}&on=0`, { method: 'POST' });
  }
  const r = await call('/api/purchases/checkout', { who: buyer, method: 'POST', body: { type: 'episode', id: ID.houseFilm } });
  const url = r.json && r.json.url;
  ok('once Clerk answers, Checkout opens (200)', r.status === 200 && url, `${r.status} ${r.text.slice(0, 200)}`);
  const sid = url ? url.split('/checkout/')[1] : null;
  const paid = sid ? await pay(sid) : { deliveries: [] };
  ok('…paid; the webhook records it (2xx)', paid.status === 200 && paid.deliveries.every((d) => d.status >= 200 && d.status < 300), paid.deliveries.map((d) => `${d.type} ${d.status}`));
  const pi = paid.session && paid.session.payment_intent ? (await stripeHook('/__state')).json.objects.find((o) => o.id === paid.session.payment_intent) : null;
  ok('…as a studio title: the charge transfers to nobody', pi && !pi.transfer_data && !pi.application_fee_amount, pi && { transfer_data: pi.transfer_data, fee: pi.application_fee_amount });
  const row = rows(`select house, creator_cents, status from public.purchases where target_id = ${q(ID.houseFilm)}`)[0];
  ok('…the purchase row: completed, house, nothing for a creator', row && row.status === 'completed' && row.house === true && Number(row.creator_cents || 0) === 0, row);
  // A creator's title still sells while the studio check isn't needed.
  const r2 = await call('/api/purchases/checkout', { who: buyer, method: 'POST', body: { type: 'episode', id: IDS.nbS1E3 } });
  ok('a creator’s title (Mara’s S1 E3) still opens Checkout', r2.status === 200 && r2.json && r2.json.url, `${r2.status} ${r2.text.slice(0, 200)}`);
  sql(`delete from public.purchases where buyer_id = ${q(buyer.id)}`);
  sql(`delete from public.title_prices where target_id = ${q(ID.houseFilm)}`);
}

async function referral() {
  section('A referral through Checkout (?via=)');
  const m = await member('referred');
  let { r, sid } = await checkout(m, { via: 'mara' });
  ok('Checkout with via=mara opens', r.status === 200 && sid, r.text.slice(0, 200));
  const s = (await stripeHook('/__state')).json.objects.find((o) => o.id === sid);
  ok('…stamped with Mara’s id as a link referral', s && s.metadata && s.metadata.via === USERS.mara && s.metadata.via_source === 'link', s && s.metadata);
  const paid = await pay(sid);
  ok('Checkout completes; every webhook 2xx', paid.status === 200 && paid.deliveries.every((d) => d.status >= 200 && d.status < 300), paid.deliveries.map((d) => `${d.type} ${d.status}`));
  const ref = rows(`select creator_id, source from public.member_referrals where user_id = ${q(m.id)}`);
  ok('the referral is locked for Mara', ref.length === 1 && ref[0].creator_id === USERS.mara && ref[0].source === 'link', ref);
  const bonus = ledger(`member_id = ${q(m.id)} and kind = 'referral'`);
  ok('the first invoice carries Mara’s referral bonus ($1.00 at Standard)', bonus.length === 1 && bonus[0].creator_id === USERS.mara && bonus[0].cents === 100, bonus);
  const lineup = rows(`select creator_id from public.member_lineups where user_id = ${q(m.id)}`);
  ok('the referrer is the member’s first pick', lineup.length === 1 && lineup[0].creator_id === USERS.mara, lineup);
  // Typed, wrong: refused so they can fix it; typed, right: a code referral.
  ({ r } = await checkout(await member('typo'), { via: '@nosuchhandle', viaSource: 'typed' }));
  ok('a typed handle that isn’t a creator → 400', r.status === 400, `${r.status} ${r.text.slice(0, 160)}`);
  const t = await member('typed');
  ({ r, sid } = await checkout(t, { via: '@mara', viaSource: 'typed' }));
  const s2 = sid ? (await stripeHook('/__state')).json.objects.find((o) => o.id === sid) : null;
  ok('a typed @mara → stamped as a code referral', r.status === 200 && s2 && s2.metadata.via === USERS.mara && s2.metadata.via_source === 'code' && s2.metadata.via_code === 'mara', s2 && s2.metadata);
  ({ r, sid } = await checkout(await member('self', { handle: `self${RUN}` }), { via: `self${RUN}`, viaSource: 'typed' }));
  ok('your own handle → 400 (never yourself)', r.status === 400, r.status);
  // The cookie (a /@handle link) works the same.
  const c = await member('cookie');
  const withCookie = { ...c, cookie: `${c.cookie}; tapa_via=mara` };
  ({ r, sid } = await checkout(withCookie, {}));
  const s3 = sid ? (await stripeHook('/__state')).json.objects.find((o) => o.id === sid) : null;
  ok('the tapa_via cookie stamps the referral too', r.status === 200 && s3 && s3.metadata.via === USERS.mara, s3 && s3.metadata);
  const sub = paid.session && paid.session.subscription ? (await stripeHook('/__state')).json.objects.find((o) => o.id === paid.session.subscription) : null;
  ok('the paid subscription carries the referral (what the invoice reads)', sub && sub.metadata && sub.metadata.via === USERS.mara && sub.metadata.member === m.id, sub && sub.metadata);
}

async function forfeitPool() {
  section('A leaver’s uncollected balance goes to the pool, never to the studio');
  const leaver = await member('leaver', { role: 'creator', displayName: 'Check Leaver' });
  insert('creator_ledger', { creator_id: leaver.id, lane: 'earnings', kind: 'adjustment', cents: 500, moves_money: true, note: `check credit ${RUN}`, created_by: 'check' });
  insert('creator_standing', { creator_id: leaver.id, leaving_reason: 'withdrew', left_at: ago(100), collect_until: ago(10), left_by: USERS.admin });
  try {
    const r = await call('/api/admin/creator-money', { who: ADMIN, method: 'POST', body: { action: 'forfeit', creator: leaver.id } });
    ok('Move to pool → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
    const out = ledger(`creator_id = ${q(leaver.id)} and kind = 'forfeit'`);
    ok('the leaver’s $5.00 leaves as one forfeit line', out.length === 1 && out[0].cents === -500, out);
    const pool = ledger(`kind = 'pool_share' and note like ${q(`%uncollected credits from ${leaver.id}%`)}`);
    ok('it lands on the pool, $5.00 in all', pool.length >= 2 && pool.reduce((t, l) => t + l.cents, 0) === 500, pool);
    ok('…never on the studio’s own account (a maker here)', !pool.some((l) => l.creator_id === USERS.admin), pool.map((l) => l.creator_id));
    ok('…and on the makers (Mara and Dee among them)', pool.some((l) => l.creator_id === USERS.mara) && pool.some((l) => l.creator_id === USERS.dee), pool.map((l) => l.creator_id));
  } finally {
    sql(`delete from public.creator_ledger where creator_id = ${q(leaver.id)} or note like ${q(`%uncollected credits from ${leaver.id}%`)}`);
    sql(`delete from public.creator_standing where creator_id = ${q(leaver.id)}`);
    sql(`delete from public.notifications where user_id = ${q(leaver.id)}`);
  }
}

await runCheck('money', async () => {
  insert('episodes', film(ID.studioFilm, USERS.admin));
  try {
    await studioPick();
    await invoiceBeforeCheckout();
    await houseSale();
    await referral();
    await forfeitPool();
  } finally {
    await clerk('/__fail?user=*&on=0', { method: 'POST' });
    // Undo every row a member of this run caused, then the people.
    const ids = people.map(q).join(', ') || "''";
    // The catch-up must not record these invoices again once the rows go.
    await forgetInvoiceEvents({ members: people, invoices });
    const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member));
    for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
    sql(`delete from public.creator_ledger where member_id in (${ids})`);
    sql(`delete from public.member_referrals where user_id in (${ids})`);
    sql(`delete from public.member_payments where user_id in (${ids}) or stripe_invoice_id in (${invoices.map(q).join(', ') || "''"})`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    sql(`delete from public.member_lineups where user_id in (${ids})`);
    sql(`delete from public.purchases where buyer_id in (${ids})`);
    sql(`delete from public.title_prices where target_id in (${q(ID.houseFilm)}, ${q(ID.studioFilm)})`);
    sql(`delete from public.notifications where user_id in (${ids}) or episode_id in (${q(ID.houseFilm)}, ${q(ID.studioFilm)})`);
    sql(`delete from public.episodes where id in (${q(ID.houseFilm)}, ${q(ID.studioFilm)})`);
    for (const id of people) await removeUser(id);
  }
});
