import { Html, Head, Main, NextScript } from 'next/document';
import { getSiteSettings } from '../lib/siteSettings';
import { buildThemeStyleTag } from '../lib/themeColors';
import { adsenseAllowedOn, adsenseShown } from '../lib/adsenseRules';
import { getAccountContext } from '../lib/accountContext';

// Exists primarily for lang="en" on <html>. Without it, screen readers fall
// back to the user's system language and will happily read English content in
// a Spanish voice — it's a WCAG 2.1 Level A failure (3.1.1 Language of Page)
// and one of the cheapest to fix.
export default function Document({ themeStyleTag, faviconUrl, showAdsense }) {
  return (
    <Html lang="en">
      <Head>
        {/* No favicon.ico exists in /public and nothing linked one before
            this — browsers were showing a blank/generic tab icon. Falls
            back to the static /icon.svg (same one manifest.json already
            uses) until an admin uploads a real one from
            /admin/site-icons. */}
        <link rel="icon" href={faviconUrl || '/icon.svg'} />
        {/* Google AdSense verification + ad serving.
            Lives in _document rather than _app so it's present in the
            server-rendered HTML on the very first request — AdSense's
            crawler checks for this tag when reviewing the site, and a
            script injected later by React can be missed entirely.

            Note this is the DISPLAY ads script, separate from the IMA SDK
            in _app.js that handles in-player video ads. The two don't
            interact. Public pages only (lib/adsenseRules.js): never the
            admin area, the account and Money pages, Messages, a screener
            or an error page — and never for a viewer whose plan is ad-free
            (Premium, Sponsor, the team, comped and promo access; Jose,
            2026-11-13), which getInitialProps below decides per request. */}
        {showAdsense && (
          <script
            async
            src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1412100592036798"
            crossOrigin="anonymous"
          />
        )}
        {/* Theme color overrides — set from /admin/theme. Injected here
            (server-rendered, before any content paints) rather than via a
            client-side effect, specifically so there's no flash of the
            stylesheet's default colors before an override kicks in. Empty
            when nothing's been overridden — this tag then simply doesn't
            render at all. */}
        {themeStyleTag && <style id="theme-overrides" dangerouslySetInnerHTML={{ __html: themeStyleTag }} />}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

// Whether this viewer's plan is ad-free. The account is the one the page's
// getServerSideProps already read for this request — `ctx.req` here is the
// same request object, and lib/requestCache.js memoByRequest hands back the
// same promise — so on a page that reads it this costs nothing more; a page
// that doesn't reads it once (for a signed-out visitor that is a header
// check, no Clerk or Stripe call). A page built ahead of time has no
// request and no viewer: only the error pages are, and they never get the
// script. A read that fails counts as not ad-free (the script loads, as it
// did for everyone before).
async function viewerAdFree(req) {
  if (!req) return false;
  try {
    const account = await getAccountContext(req);
    return Boolean(account && account.adFree);
  } catch (err) {
    return false;
  }
}

Document.getInitialProps = async (ctx) => {
  const publicPage = adsenseAllowedOn(ctx.pathname);
  const [initialProps, siteSettings, adFree] = await Promise.all([
    ctx.defaultGetInitialProps(ctx),
    getSiteSettings(),
    publicPage ? viewerAdFree(ctx.req) : false
  ]);
  return { ...initialProps, themeStyleTag: buildThemeStyleTag(siteSettings.themeOverrides), faviconUrl: siteSettings.faviconUrl, showAdsense: adsenseShown({ pathname: ctx.pathname, adFree }) };
};
