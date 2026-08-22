import { Html, Head, Main, NextScript } from 'next/document';
import { getSiteSettings } from '../lib/siteSettings';
import { buildThemeStyleTag } from '../lib/themeColors';

// Exists primarily for lang="en" on <html>. Without it, screen readers fall
// back to the user's system language and will happily read English content in
// a Spanish voice — it's a WCAG 2.1 Level A failure (3.1.1 Language of Page)
// and one of the cheapest to fix.
export default function Document({ themeStyleTag }) {
  return (
    <Html lang="en">
      <Head>
        {/* Google AdSense verification + ad serving.
            Lives in _document rather than _app so it's present in the
            server-rendered HTML on the very first request — AdSense's
            crawler checks for this tag when reviewing the site, and a
            script injected later by React can be missed entirely.

            Note this is the DISPLAY ads script, separate from the IMA SDK
            in _app.js that handles in-player video ads. The two don't
            interact. */}
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1412100592036798"
          crossOrigin="anonymous"
        />
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

Document.getInitialProps = async (ctx) => {
  const [initialProps, siteSettings] = await Promise.all([
    ctx.defaultGetInitialProps(ctx),
    getSiteSettings()
  ]);
  return { ...initialProps, themeStyleTag: buildThemeStyleTag(siteSettings.themeOverrides) };
};
