import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import VideoPlayer from '../../components/VideoPlayer';
import { openScreener } from '../../lib/distribution';
import { SITE } from '../../lib/siteConfig';

// A private screener (migration 109): the filmmaker's video for one
// programmer, journalist or distributor. No sign-in — the link is the
// key — but it's labelled, it expires, it has a view cap, every open is
// logged and the owner is told, and the picture carries a moving
// watermark with who it's for. Not indexed.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    const data = await openScreener(String(params.token), { ip, userAgent: req.headers['user-agent'] || '', countView: true });
    return { props: { data: JSON.parse(JSON.stringify(data)), token: String(params.token), problem: null } };
  } catch (err) {
    if (err.status) return { props: { data: null, token: String(params.token), problem: err.message } };
    throw err;
  }
}

export default function ScreenerPage({ data, token, problem }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 9000); return () => clearInterval(t); }, []);
  const refreshSrc = useCallback(async () => {
    try {
      const res = await fetch(`/api/screener/${encodeURIComponent(token)}`, { method: 'POST' });
      const d = await res.json();
      return d && d.src ? d.src : null;
    } catch (err) { return null; }
  }, [token]);

  if (problem || !data) {
    return (
      <>
        <Head><title>Screener — {SITE.name}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <main className="scr-page"><div className="scr-card"><span className="crew-eyebrow">Private screener</span><h1>Not available</h1><p>{problem || 'That screener link isn’t right.'}</p><Link href="/" className="crew-btn sm">{SITE.name}</Link></div></main>
      </>
    );
  }

  const { production, screener, episode } = data;
  const stamp = `${screener.label}${screener.recipientEmail ? ` · ${screener.recipientEmail}` : ''} · ${screener.token}`;
  const positions = [{ top: '8%', left: '6%' }, { top: '70%', left: '55%' }, { top: '40%', left: '30%' }, { top: '15%', left: '60%' }, { top: '78%', left: '8%' }];
  const pos = positions[tick % positions.length];

  return (
    <>
      <Head>
        <title>{episode.title} — private screener — {SITE.name}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <main className="scr-page" onContextMenu={(e) => e.preventDefault()}>
        <div className="scr-head">
          <span className="crew-eyebrow">Private screener · {SITE.name}</span>
          <h1 className="scr-title">{episode.title}</h1>
          <p className="scr-sub">From <b>{production.title}</b> by {production.ownerName}. Shared with <b>{screener.label}</b>{screener.recipientEmail ? ` (${screener.recipientEmail})` : ''}. Please don’t forward or record it — every open is logged and the picture is marked.</p>
        </div>
        <div className="scr-player">
          <VideoPlayer episode={{ id: episode.id, title: episode.title, src: data.src, thumbnail: episode.thumbnail, contentType: episode.contentType }} adsEnabled={false} advisory={false} signedPlayback={Boolean(data.signed)} refreshSrc={refreshSrc} />
          <div className="scr-mark" style={pos} aria-hidden="true">{stamp}</div>
          <div className="scr-mark scr-mark-fixed" aria-hidden="true">{stamp}</div>
        </div>
        <div className="scr-foot crew-mono">
          <span>Link good until {new Date(screener.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {screener.viewsLeft} {screener.viewsLeft === 1 ? 'open' : 'opens'} left</span>
          <span>{episode.desc ? episode.desc.slice(0, 200) : ''}</span>
        </div>
      </main>
    </>
  );
}
