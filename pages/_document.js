import { Html, Head, Main, NextScript } from 'next/document';

// Exists primarily for lang="en" on <html>. Without it, screen readers fall
// back to the user's system language and will happily read English content in
// a Spanish voice — it's a WCAG 2.1 Level A failure (3.1.1 Language of Page)
// and one of the cheapest to fix.
export default function Document() {
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
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
