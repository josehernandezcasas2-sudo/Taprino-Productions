// The menus' rows for who is looking (2026-11-17, Jose: "let's remove the
// my wishlist from here … see if you can find anything else like that").
//
// Signed out, the header's account menu and the tab bar's Account menu are
// the way in and Become a creator, nothing that only leads to the sign-in
// card; a viewer's Account menu has Become a creator, a creator's doesn't;
// Continue Watching points at Stream, where the row is; the tab bar has no
// Dashboard tab for a viewer; Live TV, Podcasts, Vertical and Vertical
// Discover follow their admin switches, as the header's links do. The
// switches are put back as they were.
//
// node dev/test-rig/checks/menu-rows.mjs   (the rig must be up)
import { USERS, ok, section, runCheck, rows, sql, session, SIGNED_OUT, browser, goto } from './lib.mjs';

const MARA = session(USERS.mara);
const VIEWER = session(USERS.viewer);

const accountMenu = async (pg) => {
  await pg.locator('.avatar-btn').first().click();
  await pg.locator('.account-dropdown').waitFor({ timeout: 10000 });
  const items = await pg.$$eval('.account-dropdown .dropdown-item', (els) => els.map((e) => e.textContent.trim()));
  await pg.keyboard.press('Escape').catch(() => {});
  return items;
};

const tabMenu = async (pg, label) => {
  const btn = pg.locator('.tabbar .tabbar-item', { hasText: label });
  await btn.first().tap();
  await pg.locator('.tabbar-dropup').waitFor({ timeout: 10000 });
  await pg.waitForTimeout(200);
  const items = await pg.$$eval('.tabbar-dropup .tabbar-dropup-item', (els) => els.map((e) => ({ text: e.textContent.trim(), href: e.getAttribute('href') })));
  await btn.first().tap();
  await pg.waitForTimeout(200);
  return items;
};

const tabs = (pg) => pg.$$eval('.tabbar .tabbar-item', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
const texts = (items) => items.map((i) => i.text);

await runCheck('menu-rows', async () => {
  const before = rows('select live_tv_enabled, vertical_enabled, podcasts_enabled from public.site_settings where id = 1')[0];
  const b = await browser();
  try {
    section('Signed out on a phone');
    {
      const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 390);
      await goto(pg, '/');
      const header = await accountMenu(pg);
      ok('the header’s account menu: Log in and Become a creator, no My Wishlist', header.length === 2 && /Log in/.test(header[0]) && /Become a creator/.test(header[1]) && !header.some((t) => /Wishlist/.test(t)), header);
      const tabNames = await tabs(pg);
      ok('the tab bar has no Dashboard tab', !tabNames.some((t) => /Dashboard/i.test(t)), tabNames);
      const acct = await tabMenu(pg, 'Account');
      ok('the tab bar’s Account menu: Log in / Create account and Become a creator', texts(acct).join('|') === 'Log in / Create account|Become a creator', acct);
      ok('…to the account page and /apply', acct[0] && acct[0].href === '/account' && acct[1] && acct[1].href === '/apply', acct);
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('A viewer signed in');
    {
      const { ctx, page: pg, errors } = await b.open(VIEWER, 390);
      await goto(pg, '/stream');
      const acct = await tabMenu(pg, 'Account');
      const t = texts(acct);
      ok('Settings / Account, Membership, Your purchases, My List and My Recs are there', ['Settings / Account', 'Membership', 'Your purchases', 'My List', 'My Recs'].every((x) => t.includes(x)), t);
      const cw = acct.find((i) => i.text === 'Continue Watching');
      ok('Continue Watching points at Stream, where the row is', cw && cw.href === '/stream#continue-watching', cw);
      ok('Become a creator is there for a viewer', t.includes('Become a creator'), t);
      ok('no Dashboard tab for a viewer', !(await tabs(pg)).some((x) => /Dashboard/i.test(x)));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('A creator signed in');
    {
      const { ctx, page: pg, errors } = await b.open(MARA, 390);
      await goto(pg, '/stream');
      ok('the Dashboard tab is there', (await tabs(pg)).some((x) => /Dashboard/i.test(x)));
      const t = texts(await tabMenu(pg, 'Account'));
      ok('no Become a creator for a creator', !t.includes('Become a creator'), t);
      const header = await accountMenu(pg);
      ok('the header’s signed-in menu keeps My Wishlist', header.some((x) => /My Wishlist/.test(x)), header);
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('Rows behind an admin switch follow it');
    {
      const { ctx, page: pg, errors } = await b.open(VIEWER, 390);
      await goto(pg, '/stream');
      let watch = texts(await tabMenu(pg, 'Watch'));
      ok('switches on: Live TV, Podcasts and Vertical are in Watch', ['Live TV', 'Podcasts', 'Vertical'].every((x) => watch.includes(x)), watch);
      let disc = texts(await tabMenu(pg, 'Discover'));
      ok('…and Vertical Discover in Discover', disc.includes('Vertical Discover'), disc);
      sql('update public.site_settings set live_tv_enabled = false, vertical_enabled = false, podcasts_enabled = false where id = 1');
      await pg.waitForTimeout(1500);
      await goto(pg, '/stream');
      watch = texts(await tabMenu(pg, 'Watch'));
      ok('switches off: Live TV, Podcasts and Vertical leave Watch', !['Live TV', 'Podcasts', 'Vertical'].some((x) => watch.includes(x)) && watch.includes('Watch Series'), watch);
      disc = texts(await tabMenu(pg, 'Discover'));
      ok('…and Vertical Discover leaves Discover', !disc.includes('Vertical Discover') && disc.includes('Crew Call'), disc);
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }
  } finally {
    sql(`update public.site_settings set live_tv_enabled = ${before.live_tv_enabled === 't' || before.live_tv_enabled === true}, vertical_enabled = ${before.vertical_enabled === 't' || before.vertical_enabled === true}, podcasts_enabled = ${before.podcasts_enabled === 't' || before.podcasts_enabled === true} where id = 1`);
    await b.close();
  }
});
