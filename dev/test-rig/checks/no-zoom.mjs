// No zoom when a field is tapped (2026-11-17). Safari on an iPhone zooms the
// page when a text field under 16px takes focus; on a touch screen every
// text field is at least 16px (the end of styles/globals.css), the bigger
// ones keep their size, a mouse keeps the old sizes, and a double tap
// doesn't zoom (touch-action: manipulation). Nothing runs off the side.
//
// node dev/test-rig/checks/no-zoom.mjs   (the rig must be up)
import { IDS, USERS, ok, section, runCheck, session, browser, goto, overflowPx } from './lib.mjs';

const ADMIN = session(USERS.admin);
const PAGES = ['/', '/account/profile', '/crew/card', '/crew/calls/new', '/locations/new', '/productions/new', '/pitches', '/creator/submit', '/creator/show/new', '/creator/my-work', '/admin/library', '/admin/settings', `/ad-plan/${IDS.film}`, '/welcome?preview=1'];
const SKIP = ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image', 'hidden'];

const fieldSizes = (pg) => pg.evaluate((skip) => [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
  .filter((el) => !(el.tagName === 'INPUT' && skip.includes((el.getAttribute('type') || 'text').toLowerCase())))
  .map((el) => ({ what: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`, px: parseFloat(getComputedStyle(el).fontSize) })), SKIP);

await runCheck('no-zoom', async () => {
  const b = await browser();
  try {
    section('A touch phone (390)');
    {
      const { ctx, page: pg, errors } = await b.open(ADMIN, 390);
      let fields = 0;
      for (const p of PAGES) {
        await goto(pg, p);
        await pg.waitForTimeout(1200);
        const sizes = await fieldSizes(pg);
        fields += sizes.length;
        const small = sizes.filter((s) => s.px < 16);
        ok(`${p}: every text field is 16px or more (${sizes.length})`, small.length === 0, small.slice(0, 5));
        ok(`${p}: nothing runs off the side`, (await overflowPx(pg)) <= 0);
      }
      ok('the pages had fields to look at', fields > 60, fields);
      await goto(pg, '/creator/show/new');
      ok('a field drawn bigger keeps its size (New show’s name, 16.8px)', (await pg.$eval('input.new-show-name', (e) => getComputedStyle(e).fontSize)) === '16.8px');
      ok('a double tap doesn’t zoom (touch-action: manipulation)', (await pg.evaluate(() => [getComputedStyle(document.documentElement).touchAction, getComputedStyle(document.querySelector('button')).touchAction])).every((v) => v === 'manipulation'));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }
    section('A laptop with a mouse (1280) keeps the old sizes');
    {
      const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
      await goto(pg, '/crew/card');
      await pg.waitForTimeout(1200);
      const sizes = await fieldSizes(pg);
      ok('the working card’s fields are their own size (under 16px), not forced up', sizes.length > 0 && sizes.some((s) => s.px < 16), sizes.slice(0, 4));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }
  } finally {
    await b.close();
  }
});
