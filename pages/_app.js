import { useEffect } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import Script from 'next/script';
import Head from 'next/head';
import { UploadProvider, uploadStatusRef } from '../contexts/UploadContext';
import { PodcastPlayerProvider } from '../contexts/PodcastPlayerContext';
import UploadStatusWidget from '../components/UploadStatusWidget';
import PodcastMiniPlayer from '../components/PodcastMiniPlayer';
import '../styles/globals.css';
import '@uppy/core/css/style.css';
import '@uppy/dashboard/css/style.css';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    // Only registered in production. In dev, the whole point of editing a
    // file is seeing the change immediately — a service worker caching JS
    // bundles works directly against that, and unlike a normal browser
    // cache, it persists across dev-server restarts and even across
    // unrelated code changes, since it's stored in the browser's own
    // registry for this origin. That's exactly what caused the "server
    // says Studio Tapa TV, client says Taprino Transmission" hydration
    // mismatch — the server was rendering fresh code while an old service
    // worker kept serving a stale cached JS bundle from a much earlier
    // test session.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installable/offline support is a bonus, not a requirement — fail quietly.
      });
    }

    // Browsers can restore a page from the back-forward cache (bfcache) on
    // back/forward navigation without re-running any data fetch — meaning
    // "opt in to the newsletter on /account, hit back" could show the
    // homepage exactly as it looked before that change. event.persisted
    // is true specifically when the page came from bfcache rather than a
    // fresh load, so this only forces a reload in that one situation.
    function handlePageShow(event) {
      if (event.persisted) {
        // Don't blow away an in-progress upload just because the browser
        // restored this page from bfcache via back/forward navigation —
        // the reload this normally does is exactly what "survives
        // navigation" is supposed to prevent.
        const upload = uploadStatusRef.current;
        if (upload && (upload.status === 'uploading' || upload.status === 'saving' || upload.status === 'requesting-url')) {
          return;
        }
        window.location.reload();
      }
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: 'var(--olive)',
          colorBackground: 'var(--surface-1)',
          colorInputBackground: 'var(--surface-0)',
          colorInputText: 'var(--ink)',
          colorText: 'var(--ink)',
          colorTextSecondary: 'var(--ink-dim)',
          borderRadius: '4px',
          fontFamily: "'Fraunces', serif"
        }
      }}
    >
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="manifest" href="/api/manifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="theme-color" content="var(--surface-0)" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      {/* Google's IMA SDK — free, this is what actually serves the pre-roll ads */}
      {/* Lets keyboard and screen-reader users jump past the nav on every page
          instead of tabbing through the whole header each time. Visually hidden
          until it receives focus. */}
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Script src="https://imasdk.googleapis.com/js/sdkloader/ima3.js" strategy="beforeInteractive" />
      <UploadProvider>
        <PodcastPlayerProvider>
          <Component {...pageProps} />
          <UploadStatusWidget />
          <PodcastMiniPlayer />
        </PodcastPlayerProvider>
      </UploadProvider>
    </ClerkProvider>
  );
}
