import { Html, Head, Main, NextScript } from 'next/document';

// Exists primarily for lang="en" on <html>. Without it, screen readers fall
// back to the user's system language and will happily read English content in
// a Spanish voice — it's a WCAG 2.1 Level A failure (3.1.1 Language of Page)
// and one of the cheapest to fix.
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
