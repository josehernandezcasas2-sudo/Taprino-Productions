import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import HeaderNav from './HeaderNav';
import InstallButton from './InstallButton';
import MobileTabBar from './MobileTabBar';
import Footer from './Footer';
import ChannelPlayer from './ChannelPlayer';
import ReportButton from './ReportButton';
import { SITE } from '../lib/siteConfig';

// Channel time is Pacific for everyone, like a broadcast schedule.
const ptTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const HALF_HOUR_PX = 132;
const LABEL_EVERY = HALF_HOUR_PX * 4; // two hours
const DAY = 86400;

function timeLabel(sec) {
  const wrapped = ((Math.round(sec) % DAY) + DAY) % DAY;
  const h24 = Math.floor(wrapped / 3600);
  const m = Math.floor((wrapped % 3600) / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY * 1000).toISOString().slice(0, 10);
}
function dayTabLabel(dateStr, today) {
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

// Where "Go to series/film page" leads for a program.
function titlePageFor(p) {
  if (!p) return null;
  if (p.seriesId) return { href: p.contentType === 'podcast' ? `/podcasts/${p.seriesId}` : `/series/${p.seriesId}`, label: p.contentType === 'podcast' ? 'Go to podcast page' : 'Go to series page' };
  if (p.episodeId) return { href: `/episode/${p.episodeId}`, label: p.contentType === 'movie' ? 'Go to film page' : 'Go to title page' };
  return null;
}

function programHeading(p) {
  if (!p) return '';
  if (p.seriesName) return p.seriesName;
  return p.title;
}

export default function LiveChannelsPage(props) {
  const { channels, channel, initialNow, initialGuide, nowSec, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, unavailable } = props;
  const router = useRouter();
  const [now, setNow] = useState(initialNow);
  const [guide, setGuide] = useState(initialGuide);
  const [guideLoading, setGuideLoading] = useState(false);
  const [selected, setSelected] = useState(null); // a guide segment, or null = what's on now
  const [clockSec, setClockSec] = useState(nowSec);
  const scrollRef = useRef(null);

  // Keep the guide's "now" line moving.
  useEffect(() => {
    if (unavailable) return undefined;
    const startedAt = Date.now();
    const id = setInterval(() => setClockSec(nowSec + (Date.now() - startedAt) / 1000), 30000);
    return () => clearInterval(id);
  }, [nowSec, unavailable]);

  // New channel = fresh state from the server props.
  useEffect(() => {
    setNow(initialNow);
    setGuide(initialGuide);
    setSelected(null);
  }, [initialNow, initialGuide]);

  // Scroll the guide so "now" sits near the left edge.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !guide || guide.date !== guide.today) return;
    el.scrollLeft = Math.max(0, (clockSec / 1800) * HALF_HOUR_PX - HALF_HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide && guide.date, channel && channel.slug]);

  async function loadDay(date) {
    setGuideLoading(true);
    try {
      const res = await fetch(`/api/channel/guide?channel=${encodeURIComponent(channel.slug)}&date=${date}`);
      const data = await res.json();
      if (res.ok) {
        setGuide(data);
        setSelected(null);
        if (scrollRef.current) scrollRef.current.scrollLeft = date === data.today ? Math.max(0, (clockSec / 1800) * HALF_HOUR_PX - HALF_HOUR_PX) : (19 * 2 - 1) * HALF_HOUR_PX;
      }
    } finally {
      setGuideLoading(false);
    }
  }

  const idx = channels ? channels.findIndex((c) => c.slug === (channel && channel.slug)) : -1;
  function surf(step) {
    if (!channels || channels.length < 2) return;
    const next = channels[(idx + step + channels.length) % channels.length];
    router.push(next.number === channels[0].number ? '/live' : `/live/${next.slug}`);
  }

  const isToday = guide && guide.date === guide.today;
  const info = useMemo(() => {
    if (selected) {
      const state = !isToday ? 'later' : selected.end <= clockSec ? 'earlier' : selected.start <= clockSec ? 'now' : 'later';
      return { source: 'guide', seg: selected, state };
    }
    return { source: 'now' };
  }, [selected, isToday, clockSec]);

  const head = (
    <Head>
      <title>{channel ? `${channel.name} — Live — ${SITE.name}` : `Live — ${SITE.name}`}</title>
      <meta name="description" content={channel && channel.description ? channel.description : `Live channels from ${SITE.studio}.`} />
    </Head>
  );
  const nav = (
    <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
  );

  if (unavailable) {
    return (
      <>
        {head}
        {nav}
        <main className="stage stage-single stage-wide">
          <div className="ca-empty" style={{ marginTop: '2rem' }}>
            <b>Live channels are off the air right now</b>
            Check back soon, or browse everything on demand from the homepage.
          </div>
        </main>
        <Footer />
        <MobileTabBar />
      </>
    );
  }

  const nowProgram = now && now.program;
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(guide.today, n));

  return (
    <>
      {head}
      {nav}
      <div className="install-row"><InstallButton /></div>

      <main className="stage stage-single stage-wide">
        <div className="tv-layout">
          <nav className="tv-dial" aria-label="Channels">
            <div className="tv-dial-label">Channels</div>
            {channels.map((c, i) => (
              <Link
                key={c.slug}
                href={i === 0 ? '/live' : `/live/${c.slug}`}
                className={`tv-ch ${c.slug === channel.slug ? 'active' : ''}`}
                aria-current={c.slug === channel.slug ? 'page' : undefined}
              >
                <span className="tv-ch-num">{String(c.number).padStart(2, '0')}</span>
                {c.logoUrl ? <img className="tv-ch-logo" src={c.logoUrl} alt="" /> : null}
                <span className="tv-ch-text">
                  <span className="tv-ch-name">{c.name}</span>
                  <span className="tv-ch-now">{c.isLive ? '● Live · ' : ''}{c.nowTitle || 'Off air'}</span>
                </span>
              </Link>
            ))}
            {channels.length > 1 && (
              <div className="tv-dial-keys">
                <button type="button" className="tv-key" onClick={() => surf(-1)} aria-label="Channel up">CH ▲</button>
                <button type="button" className="tv-key" onClick={() => surf(1)} aria-label="Channel down">CH ▼</button>
              </div>
            )}
          </nav>

          <div className="tv-main">
            <div className="tv-stage">
              <div className="player-card tv-player">
                <ChannelPlayer key={channel.slug} channelSlug={channel.slug} initialNow={initialNow} onNowChange={setNow} />
              </div>

              <aside className="tv-info" aria-live="polite">
                {info.source === 'now' ? (
                  <NowInfo now={now} channel={channel} />
                ) : (
                  <SegmentInfo seg={info.seg} state={info.state} channel={channel} date={guide.date} today={guide.today} onBack={() => setSelected(null)} />
                )}
              </aside>
            </div>

            <section className="tv-guide" aria-label={`${channel.name} guide`}>
              <div className="tv-guide-head">
                <h2>{channel.name} guide</h2>
                <div className="tv-guide-days" role="tablist">
                  {days.map((d) => (
                    <button key={d} type="button" role="tab" aria-selected={guide.date === d} className={`tv-day ${guide.date === d ? 'active' : ''}`} onClick={() => loadDay(d)} disabled={guideLoading}>
                      {dayTabLabel(d, guide.today)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tv-guide-scroll" ref={scrollRef}>
                <div className="tv-guide-grid" style={{ width: `${48 * HALF_HOUR_PX}px` }}>
                  <div className="tv-guide-times">
                    {Array.from({ length: 48 }, (_, i) => (
                      <span key={i} style={{ width: HALF_HOUR_PX }}>{timeLabel(i * 1800)}</span>
                    ))}
                  </div>
                  <div className="tv-guide-track">
                    {guide.segments.map((s) => {
                      const left = (s.start / 1800) * HALF_HOUR_PX;
                      const width = Math.max(4, ((s.end - s.start) / 1800) * HALF_HOUR_PX - 3);
                      const past = isToday && s.end <= clockSec;
                      const onNow = isToday && s.start <= clockSec && clockSec < s.end;
                      const cls = ['tv-blk', `k-${s.kind}`, past ? 'past' : '', onNow ? 'now' : '', selected && selected.start === s.start ? 'selected' : ''].join(' ');
                      return (
                        <button
                          key={`${s.start}-${s.kind}`}
                          type="button"
                          className={cls}
                          style={{ left, width }}
                          onClick={() => setSelected(s)}
                          aria-label={`${s.seriesName ? `${s.seriesName}, ` : ''}${s.title}, ${timeLabel(s.start)}`}
                        >
                          {(s.kind === 'loop' || s.kind === 'off_air') && width > LABEL_EVERY * 2 ? (
                            // Long stretches repeat their label every two hours, so
                            // it's visible wherever the guide is scrolled to.
                            Array.from({ length: Math.ceil(width / LABEL_EVERY) }, (_, k) => k * LABEL_EVERY).filter((x) => x < width - 70).map((x) => (
                              <span key={x} className="tv-blk-repeat" style={{ left: 8 + x }}>
                                <b>{s.title}</b>
                                <small>{timeLabel(s.start + (x / HALF_HOUR_PX) * 1800)}</small>
                              </span>
                            ))
                          ) : width > 40 && (
                            <>
                              <b>{s.kind === 'live_slot' ? '● ' : ''}{s.seriesName ? s.seriesName : s.title}</b>
                              <small>{timeLabel(s.start)}{s.label ? ` · ${s.label}` : ''}</small>
                            </>
                          )}
                        </button>
                      );
                    })}
                    {isToday && <div className="tv-nowline" style={{ left: (clockSec / 1800) * HALF_HOUR_PX }} aria-hidden="true" />}
                  </div>
                </div>
              </div>
              <div className="tv-legend">
                <span><i className="lg-show" />Show</span>
                <span><i className="lg-live" />Live broadcast</span>
                <span><i className="lg-ads" />Ads &amp; bumpers</span>
                <span><i className="lg-loop" />Channel loop</span>
                <span className="tv-legend-tz">All times Pacific</span>
              </div>
            </section>

            <p className="ca-foot" style={{ marginTop: '1rem' }}>
              {channel.name} plays like TV: everyone sees the same thing at the same time, ads included. Want to pick what you watch?
              Every show here has its own page, ready on demand.
            </p>
          </div>
        </div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

function Chips({ p }) {
  return (
    <div className="tv-chips">
      {p.layer === 'loop' && <span className="tv-chip">Channel loop</span>}
      {p.contentType && <span className="tv-chip">{p.contentType === 'movie' ? 'Film' : p.contentType[0].toUpperCase() + p.contentType.slice(1)}</span>}
      {p.tier === 'premium' && <span className="tv-chip prem">{SITE.premiumTier}</span>}
      {p.tier === 'free' && <span className="tv-chip free">Free</span>}
      {p.rating && <span className="tv-chip">{p.rating}</span>}
      {p.genre && <span className="tv-chip">{p.genre}</span>}
    </div>
  );
}

function NowInfo({ now, channel }) {
  if (now && now.live) {
    return (
      <>
        <div className="tv-info-eyebrow"><span className="tv-live-pill">● Live</span> CH {String(channel.number).padStart(2, '0')}</div>
        <h2>{now.live.title}</h2>
        {now.live.description && <p>{now.live.description}</p>}
        <UpNext next={now.next} />
      </>
    );
  }
  const p = now && now.program;
  if (!p) {
    return (
      <>
        <div className="tv-info-eyebrow">CH {String(channel.number).padStart(2, '0')}</div>
        <h2>{channel.name} is off the air</h2>
        <p>Nothing is on right now. Pick a day in the guide to see what&rsquo;s coming up.</p>
        <UpNext next={now && now.next} />
      </>
    );
  }
  if (p.kind === 'ad_break') {
    return (
      <>
        <div className="tv-info-eyebrow">On now · CH {String(channel.number).padStart(2, '0')}</div>
        <h2>Ad break</h2>
        <p>Back to {channel.name} at {ptTime(p.endsAt)}.</p>
        <UpNext next={now.next} />
      </>
    );
  }
  const page = titlePageFor(p);
  return (
    <>
      <div className="tv-info-eyebrow">On now · CH {String(channel.number).padStart(2, '0')}</div>
      <h2>{programHeading(p)}</h2>
      {p.seriesName && <div className="tv-info-sub">{p.label ? `${p.label} · ` : ''}{p.title}</div>}
      <div className="tv-info-when">Until {ptTime(p.endsAt)}</div>
      <Chips p={p} />
      {p.description && <p>{p.description}</p>}
      <div className="tv-info-acts">
        {page && <Link href={page.href} className="account-btn-primary">{page.label} &rarr;</Link>}
        {p.kind === 'episode' && p.episodeId && <ReportButton key={p.episodeId} targetType="episode" targetId={p.episodeId} title={p.seriesName ? `${p.seriesName} · ${p.title}` : p.title} className="tv-report" />}
      </div>
      <UpNext next={now.next} />
    </>
  );
}

function SegmentInfo({ seg, state, channel, date, today, onBack }) {
  const page = titlePageFor(seg);
  const when = `${timeLabel(seg.start)} – ${seg.end >= DAY ? 'midnight' : timeLabel(seg.end)} PT${date !== today ? ` · ${dayTabLabel(date, today)}` : ''}`;
  const eyebrow = state === 'now' ? 'On now' : state === 'earlier' ? 'Aired earlier' : 'Coming up';
  let body = null;
  if (seg.kind === 'loop') body = <p>Nothing is booked here, so the channel loop fills the time.</p>;
  else if (seg.kind === 'ad_break') body = <p>{seg.filler ? 'Ads and bumpers fill out the rest of this block.' : 'A scheduled ad break.'}</p>;
  else if (seg.kind === 'off_air') body = <p>Nothing is on {channel.name} at this time.</p>;
  else if (seg.kind === 'live_slot') body = <p>A live broadcast is planned here. If it doesn&rsquo;t start, the channel loop plays instead.</p>;

  return (
    <>
      <div className="tv-info-eyebrow">{eyebrow} · CH {String(channel.number).padStart(2, '0')}</div>
      <h2>{seg.kind === 'live_slot' ? `● ${seg.title}` : programHeading(seg)}</h2>
      {seg.seriesName && <div className="tv-info-sub">{seg.label ? `${seg.label} · ` : ''}{seg.title}</div>}
      <div className="tv-info-when">{when}</div>
      {(seg.kind === 'episode' || seg.kind === 'media') && <Chips p={seg} />}
      {seg.description && <p>{seg.description}</p>}
      {body}
      <div className="tv-info-acts">
        {page && <Link href={page.href} className="account-btn-primary">{page.label} &rarr;</Link>}
        <button type="button" className="account-btn-secondary" onClick={onBack}>Back to what&rsquo;s on</button>
        {seg.kind === 'episode' && seg.episodeId && <ReportButton key={seg.episodeId} targetType="episode" targetId={seg.episodeId} title={seg.seriesName ? `${seg.seriesName} · ${seg.title}` : seg.title} className="tv-report" />}
      </div>
    </>
  );
}

function UpNext({ next }) {
  if (!next || !next.length) return null;
  return (
    <div className="tv-upnext">
      <div className="tv-info-eyebrow">After this</div>
      {next.map((n, i) => (
        <div key={i} className="tv-upnext-row">
          <span>{n.seriesName ? `${n.seriesName}${n.label ? ` · ${n.label}` : ''}` : n.title}</span>
          <span className="tv-upnext-time">{ptTime(n.startsAt)}</span>
        </div>
      ))}
    </div>
  );
}
