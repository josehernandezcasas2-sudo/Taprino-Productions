import { useEffect, useState } from 'react';
import Link from 'next/link';

// The homepage's "On the telly" TV set (approved mockup option B): what
// TapaTV (the main channel) is airing right now, plus the next two
// programs. Fetched in the browser rather than in getServerSideProps:
// the homepage is CDN-cached for a minute, so a baked-in program could
// already have ended, and this way the page itself doesn't wait on the
// channel engine. Hidden entirely when nothing is on air.

const ptTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

export default function HomeOnNow() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async () => {
      let next = 60000;
      try {
        const res = await fetch('/api/channel/now');
        const data = await res.json();
        if (cancelled) return;
        setState(data);
        // Refresh right after the current program ends (a minute at most).
        const endsAt = data.program && Date.parse(data.program.endsAt);
        if (endsAt) next = Math.min(next, Math.max(5000, endsAt - Date.now() + 2000));
      } catch {
        // Keep whatever we showed last; try again shortly.
      }
      if (!cancelled) timer = setTimeout(load, next);
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  if (!state || !state.onAir || !state.channel) return null;

  const { channel, live, program } = state;
  const chNumber = String(channel.number || 1).padStart(2, '0');

  let title;
  let sub;
  if (live) {
    title = live.title;
    sub = 'Live broadcast';
  } else if (program.kind === 'episode' && program.seriesName) {
    title = program.seriesName;
    sub = [program.label, program.title].filter(Boolean).join(' · ');
  } else {
    title = program.kind === 'ad_break' ? 'Back after the break' : program.title;
    sub = null;
  }
  // A short loop repeats the same title back to back; listing "Next: X,
  // Then: X" under X itself says nothing, so drop repeats.
  const nextName = (n) => (n.seriesName ? `${n.seriesName}${n.label ? ` · ${n.label}` : ''}` : n.title);
  const upNext = [];
  let prevName = live ? live.title : program.kind === 'episode' && program.seriesName ? `${program.seriesName}${program.label ? ` · ${program.label}` : ''}` : program.title;
  for (const n of state.next || []) {
    if (n.kind === 'off_air' || upNext.length === 2) continue;
    const name = nextName(n);
    if (name !== prevName) upNext.push({ ...n, name });
    prevName = name;
  }
  const until = !live && program.endsAt ? `until ${ptTime(program.endsAt)} PT` : null;
  const still = !live ? program.thumbnail : null;

  return (
    <div className="zine-dept">
      <div className="zine-dept-label"><span className="zine-sticker mint">ON THE TELLY</span></div>
      <div className="zine-tv-wrap">
        <Link href="/live" className="zine-tv" aria-label={`Watch ${channel.name}: ${title}`}>
          <div className="zine-tv-body">
            <div className="zine-tv-screen">
              {still && <img src={still} alt="" className="zine-tv-still" loading="lazy" />}
              <span className="zine-tv-ch">CH {chNumber}</span>
              <span className="zine-tv-bug">
                <span className="zine-tv-bug-dot" aria-hidden="true" />{live ? 'LIVE' : 'ON NOW'}
              </span>
              <div className="zine-tv-caption">
                <div className="zine-tv-title">{title}</div>
                {(sub || until) && <div className="zine-tv-sub">{[sub, until].filter(Boolean).join(' · ')}</div>}
              </div>
            </div>
            <div className="zine-tv-panel">
              <span className="zine-tv-name">{channel.name}</span>
              <span className="zine-tv-knobs" aria-hidden="true"><span /><span /></span>
            </div>
          </div>
          <div className="zine-tv-legs" aria-hidden="true"><span /><span /></div>
        </Link>
        {upNext.length > 0 && (
          <div className="zine-tv-next">
            {upNext.map((n, i) => (
              <div key={`${n.startsAt}-${i}`}>
                <span className="zine-tv-next-time">{i === 0 ? 'NEXT' : 'THEN'} {ptTime(n.startsAt)}</span>
                {n.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
