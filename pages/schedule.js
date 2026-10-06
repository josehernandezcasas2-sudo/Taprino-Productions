import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getRoleContext } from '../lib/roles';
import { schedulableChannels } from '../lib/channelAccess';
import { channelClock } from '../lib/channelEngine';
import { addDays, weekStartOf, fitEpisodes, DAY_SECONDS } from '../lib/channelPlan';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

// The channel scheduler: admins, sub-admins with "manage the channel
// schedule", and Content Schedulers (only for channels assigned to them).
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, roleContext] = await Promise.all([getAccountContext(req), getRoleContext(req)]);
  if (!roleContext.userId) return { redirect: { destination: '/account', permanent: false } };
  let channels = [];
  try {
    channels = await schedulableChannels(roleContext);
  } catch (err) {
    console.error('schedule page:', err.message);
  }
  if (!channels.length) return { redirect: { destination: roleContext.isCreator ? '/creator/my-work' : '/stream', permanent: false } };
  const initial = channels.find((c) => c.slug === query.channel) || channels[0];
  const today = channelClock().date;
  return {
    props: {
      channels: channels.map((c) => ({ id: c.id, slug: c.slug, name: c.name, number: c.number, visibility: c.visibility })),
      initialChannelId: initial.id,
      initialView: ['week', 'default', 'loop'].includes(query.view) ? query.view : 'week',
      today,
      canLive: !!roleContext.isAdmin,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const PX_PER_HOUR = 56;
const SNAP = 5 * 60;
const KIND_INFO = {
  series_continue: { icon: '⟳', name: 'Continue', help: 'Plays the next episodes in order. The next day picks up where this one stopped.' },
  series_rerun: { icon: '↺', name: 'Rerun', help: 'Replays what another block aired earlier the same day.' },
  series_pinned: { icon: '▣', name: 'Pinned', help: 'Always starts at the same episode. Never moves forward.' }
};
const SERIES_KINDS = Object.keys(KIND_INFO);

const pad = (n) => String(n).padStart(2, '0');
function clock(sec) {
  const s = ((Math.round(sec) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
function hhmm(sec) {
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}`;
}
function dur(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h${m ? ` ${m}m` : ''}`;
  if (m) return `${m}m${r ? ` ${r}s` : ''}`;
  return `${r}s`;
}
function dateParts(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function shortDate(d) {
  return dateParts(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function weekdayOfDate(d) {
  return DAYS[(dateParts(d).getUTCDay() + 6) % 7];
}

async function api(url, method = 'GET', body) {
  const res = await fetch(url, method === 'GET' ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export default function Scheduler(props) {
  const { channels, initialChannelId, initialView, today, canLive, isSignedIn, isSubscriber, email, isAdmin, isCreator } = props;
  const router = useRouter();
  const [channelId, setChannelId] = useState(initialChannelId);
  const [view, setView] = useState(initialView);
  const [weekStart, setWeekStart] = useState(weekStartOf(today));
  const [day, setDay] = useState(initialView === 'default' ? weekdayOfDate(today) : today);
  const [data, setData] = useState(null);
  const [library, setLibrary] = useState(null);
  const [loop, setLoop] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null); // library item waiting to be placed
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);

  const channel = channels.find((c) => c.id === channelId);
  const layer = view === 'default' ? 'default' : 'week';

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const loadView = useCallback(async () => {
    if (view === 'loop') return;
    setError(null);
    try {
      const qs = view === 'default' ? 'layer=default' : `layer=week&weekStart=${weekStart}`;
      setData(await api(`/api/schedule/view?channelId=${channelId}&${qs}`));
    } catch (err) {
      setError(err.message);
    }
  }, [channelId, view, weekStart]);

  const loadLoop = useCallback(async () => {
    try {
      setLoop((await api(`/api/schedule/loop?channelId=${channelId}`)).loop);
    } catch (err) {
      setError(err.message);
    }
  }, [channelId]);

  useEffect(() => { setData(null); loadView(); }, [loadView]);
  useEffect(() => { if (view === 'loop') loadLoop(); }, [view, loadLoop]);
  useEffect(() => {
    setLibrary(null);
    api(`/api/schedule/library?channelId=${channelId}`).then(setLibrary).catch((err) => setError(err.message));
  }, [channelId]);

  // Keep the URL shareable (?channel=&view=) without reloading the page.
  useEffect(() => {
    router.replace({ pathname: '/schedule', query: { channel: channel ? channel.slug : undefined, view } }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, view]);

  function switchView(next) {
    setView(next);
    setSelectedId(null);
    setPicked(null);
    if (next === 'default') setDay(weekdayOfDate(today));
    if (next === 'week') {
      setWeekStart(weekStartOf(today));
      setDay(today);
    }
  }
  function moveWeek(n) {
    const ws = addDays(weekStart, 7 * n);
    setWeekStart(ws);
    setDay(ws <= today && today <= addDays(ws, 6) ? today : ws);
    setSelectedId(null);
  }

  async function mutate(fn, okMsg) {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      await loadView();
      if (okMsg) flash(okMsg);
      return out;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const daySlots = useMemo(() => {
    if (!data) return [];
    return data.slots
      .filter((s) => (layer === 'week' ? s.airDate === day : s.dayOfWeek === day))
      .sort((a, b) => a.start - b.start);
  }, [data, layer, day]);
  const selected = daySlots.find((s) => s.id === selectedId) || null;

  const seriesById = useMemo(() => Object.fromEntries((library ? library.series : []).map((s) => [s.id, s])), [library]);

  // What a library item becomes when it lands on the day.
  function slotBodyFor(item, startSec) {
    const base = { channelId, layer, startTime: hhmm(startSec), ...(layer === 'week' ? { airDate: day } : { dayOfWeek: day }) };
    if (item.type === 'title') return { ...base, kind: 'episode', episodeId: item.id };
    if (item.type === 'series') {
      const longest = Math.max(...item.series.episodes.map((e) => e.durationSeconds));
      const block = Math.max(3600, Math.ceil(longest / 900) * 900);
      return { ...base, kind: layer === 'default' ? 'series_continue' : 'series_pinned', seriesId: item.id, durationSeconds: block };
    }
    if (item.type === 'ad_break') return { ...base, kind: 'ad_break', durationSeconds: 120 };
    if (item.type === 'live') return { ...base, kind: 'live', durationSeconds: 3600, title: 'Live broadcast' };
    return null;
  }

  async function place(item, startSec) {
    const snapped = Math.max(0, Math.min(DAY_SECONDS - SNAP, Math.round(startSec / SNAP) * SNAP));
    const body = slotBodyFor(item, snapped);
    const out = await mutate(() => api('/api/schedule/slots', 'POST', body), `Added at ${clock(snapped)}`);
    if (out) {
      setPicked(null);
      setSelectedId(out.id);
    }
  }

  const dayTabs = layer === 'week'
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => ({ key: d, label: `${DAY_SHORT[weekdayOfDate(d)]} ${dateParts(d).getUTCDate()}`, isToday: d === today, past: d < today }))
    : DAYS.map((d) => ({ key: d, label: DAY_SHORT[d], isToday: d === weekdayOfDate(today) }));

  const weekIsCurrent = weekStart === weekStartOf(today);

  return (
    <>
      <Head>
        <title>{`Scheduler — ${channel ? channel.name : 'Channels'} — ${SITE.name}`}</title>
      </Head>
      <HeaderNav activeType="All" isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single stage-wide sch-page">
        <div className="sch-head">
          <div>
            <div className="eyebrow">Scheduler</div>
            <h1>{channel.name} <span className="sch-chnum">CH {pad(channel.number)}</span></h1>
          </div>
          <div className="sch-head-ctrls">
            {channels.length > 1 && (
              <label className="sch-field">
                <span>Channel</span>
                <select id="sch-channel" value={channelId} onChange={(e) => { setChannelId(e.target.value); setSelectedId(null); setPicked(null); }}>
                  {channels.map((c) => <option key={c.id} value={c.id}>CH {pad(c.number)} · {c.name}{c.visibility === 'draft' ? ' (draft)' : ''}</option>)}
                </select>
              </label>
            )}
            <div className="sch-seg" role="tablist" aria-label="View">
              {[['week', 'This week'], ['default', 'Default schedule'], ['loop', 'Loop']].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => switchView(k)}>{label}</button>
              ))}
            </div>
            {channel.visibility === 'public' && <Link href={`/live/${channel.slug}`} className="sch-btn">Watch it live ↗</Link>}
          </div>
        </div>

        <div className="sch-order" aria-label="What airs, in priority order">
          <span className="sch-order-label">What airs</span>
          <span className="sch-pill live">1 · Live broadcast</span><span aria-hidden="true">→</span>
          <span className={`sch-pill ${view === 'week' ? 'on' : ''}`}>2 · Published week</span><span aria-hidden="true">→</span>
          <span className={`sch-pill ${view === 'default' ? 'on' : ''}`}>3 · Default schedule</span><span aria-hidden="true">→</span>
          <span className={`sch-pill loop ${view === 'loop' ? 'on' : ''}`}>4 · Loop, for whatever&rsquo;s left</span>
        </div>

        {error && <div className="house-ad-error" role="alert" style={{ marginBottom: '0.8rem' }}>{error}</div>}

        {view === 'loop' ? (
          <LoopView channelId={channelId} loop={loop} library={library} busy={busy} setBusy={setBusy} setError={setError} reload={loadLoop} flash={flash} />
        ) : (
          <>
            <div className="sch-bar">
              {layer === 'week' ? (
                <div className="sch-week">
                  <button type="button" className="sch-btn" onClick={() => moveWeek(-1)} aria-label="Previous week" disabled={weekIsCurrent}>◀</button>
                  <strong>{shortDate(weekStart)} – {shortDate(addDays(weekStart, 6))}</strong>
                  <button type="button" className="sch-btn" onClick={() => moveWeek(1)} aria-label="Next week">▶</button>
                  {data && (data.published
                    ? <span className="sch-pill ok">Published · airing</span>
                    : <span className="sch-pill warn">Not published · the default schedule runs</span>)}
                </div>
              ) : (
                <p className="sch-note">The default schedule runs on any day whose week isn&rsquo;t published. Series blocks here can pick up where they left off.</p>
              )}
              <div className="sch-bar-acts">
                <CopyDay key={`${view}-${day}`} layer={layer} day={day} tabs={dayTabs} busy={busy}
                  onCopy={(to) => mutate(() => api('/api/schedule/copy-day', 'POST', { channelId, layer, from: day, to }), `Copied to ${to.length} day${to.length === 1 ? '' : 's'}`)} />
                {layer === 'week' && data && (
                  <button type="button" className={data.published ? 'sch-btn' : 'sch-btn primary'} disabled={busy}
                    onClick={() => mutate(() => api('/api/schedule/publish', 'POST', { channelId, weekStart, published: !data.published }), data.published ? 'Week unpublished. The default schedule runs.' : 'Week published')}>
                    {data.published ? 'Unpublish week' : 'Publish week'}
                  </button>
                )}
              </div>
            </div>

            <div className="sch-days" role="tablist" aria-label="Day">
              {dayTabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={day === t.key} className={`${t.past ? 'past' : ''}`} onClick={() => { setDay(t.key); setSelectedId(null); }}>
                  {t.label}{t.isToday ? ' · today' : ''}
                </button>
              ))}
            </div>

            <div className="sch-grid">
              <Library library={library} layer={layer} canLive={canLive} picked={picked} setPicked={(p) => { setPicked(p); if (p) setSelectedId(null); }} />

              <Timeline
                key={`${channelId}-${view}-${day}`}
                slots={daySlots}
                loading={!data}
                layer={layer}
                selectedId={selectedId}
                picked={picked}
                isPastDay={layer === 'week' && day < today}
                onSelect={(id) => { setSelectedId(id); setPicked(null); }}
                onPlace={(sec, item) => place(item || picked, sec)}
                needPick={() => flash('Pick something from the library first')}
              />

              <aside className="sch-insp" aria-live="polite">
                {picked ? (
                  <PickedInfo picked={picked} layer={layer} onCancel={() => setPicked(null)} />
                ) : selected ? (
                  <SlotEditor
                    key={selected.id}
                    slot={selected}
                    layer={layer}
                    daySlots={daySlots}
                    series={selected.seriesId ? seriesById[selected.seriesId] : null}
                    preview={data && data.preview ? data.preview[selected.id] : null}
                    canLive={canLive}
                    busy={busy}
                    onSave={(changes, msg) => mutate(() => api('/api/schedule/slots', 'PATCH', { channelId, id: selected.id, ...changes }), msg || 'Saved')}
                    onRemove={() => {
                      const reruns = daySlots.filter((s) => s.rerunOf === selected.id).length;
                      if (reruns && !window.confirm(`Removing this also removes ${reruns} rerun${reruns === 1 ? '' : 's'} of it. Continue?`)) return;
                      mutate(() => api('/api/schedule/slots', 'DELETE', { channelId, id: selected.id }), 'Removed').then(() => setSelectedId(null));
                    }}
                  />
                ) : (
                  <div className="sch-empty-insp">
                    <div className="tv-info-eyebrow">Slot</div>
                    <p>Pick something from the library, then click a dashed gap or drag it onto the day. Select a slot to edit it.</p>
                    <p className="sch-tz">All times are Pacific, the same for every viewer.</p>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
        {toast && <div className="sch-toast" role="status">{toast}</div>}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

/* ---------------- library ---------------- */

function Library({ library, layer, canLive, picked, setPicked }) {
  const [tab, setTab] = useState('series');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const query = q.trim().toLowerCase();
  const isPicked = (type, id) => picked && picked.type === type && picked.id === id;
  const drag = (item) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData('text/plain', JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; setPicked(item); }
  });

  return (
    <div className="sch-lib">
      <div className="sch-seg sch-seg-sm" role="tablist" aria-label="Library">
        {[['series', 'Series'], ['titles', 'Titles'], ['breaks', 'Breaks']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab !== 'breaks' && <input id="sch-search" type="search" className="sch-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />}
      <p className="sch-lib-note">Only titles their creators opted in to channels show up here. Premium titles air with ads.</p>
      <div className="sch-items">
        {!library && <div className="sch-muted">Loading…</div>}
        {library && tab === 'series' && library.series.filter((s) => !query || s.name.toLowerCase().includes(query)).map((s) => {
          const item = { type: 'series', id: s.id, name: s.name, series: s };
          return (
            <div key={s.id} className={`sch-item ${isPicked('series', s.id) ? 'picked' : ''}`}>
              <button type="button" className="sch-item-main" onClick={() => setPicked(isPicked('series', s.id) ? null : item)} {...drag(item)}>
                <span className="sch-thumb" style={s.thumbnail ? { backgroundImage: `url(${s.thumbnail})` } : undefined} />
                <span className="sch-item-text">
                  <b>{s.name}</b>
                  <small>{s.episodes.length} episode{s.episodes.length === 1 ? '' : 's'} · whole series block</small>
                  <span className="sch-chips">
                    <span className="sch-chip series">{layer === 'default' ? '⟳ Continue' : '▣ Pinned'}</span>
                    {s.tiers.includes('premium') && <span className="sch-chip prem">Premium · ads</span>}
                  </span>
                </span>
              </button>
              <button type="button" className="sch-expand" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                {open === s.id ? 'Hide episodes' : 'Single episodes'}
              </button>
              {open === s.id && (
                <div className="sch-eps">
                  {s.episodes.map((e) => {
                    const epItem = { type: 'title', id: e.id, name: `${s.name} · ${e.label || e.title}`, durationSeconds: e.durationSeconds };
                    return (
                      <button key={e.id} type="button" className={`sch-ep ${isPicked('title', e.id) ? 'picked' : ''}`} onClick={() => setPicked(isPicked('title', e.id) ? null : epItem)} {...drag(epItem)}>
                        <span>{e.label ? `${e.label} · ` : ''}{e.title}</span><small>{dur(e.durationSeconds)}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {library && tab === 'series' && library.series.length === 0 && <div className="sch-muted">No series are opted in to channels yet.</div>}

        {library && tab === 'titles' && library.titles.filter((t) => !query || t.title.toLowerCase().includes(query)).map((t) => {
          const item = { type: 'title', id: t.id, name: t.title, durationSeconds: t.durationSeconds };
          return (
            <button key={t.id} type="button" className={`sch-item sch-item-main ${isPicked('title', t.id) ? 'picked' : ''}`} onClick={() => setPicked(isPicked('title', t.id) ? null : item)} {...drag(item)}>
              <span className="sch-thumb" style={t.thumbnail ? { backgroundImage: `url(${t.thumbnail})` } : undefined} />
              <span className="sch-item-text">
                <b>{t.title}</b>
                <small>{dur(t.durationSeconds)}{t.contentType ? ` · ${t.contentType === 'movie' ? 'film' : t.contentType}` : ''}</small>
                {t.tier === 'premium' && <span className="sch-chips"><span className="sch-chip prem">Premium · ads</span></span>}
              </span>
            </button>
          );
        })}
        {library && tab === 'titles' && library.titles.length === 0 && <div className="sch-muted">No standalone titles are opted in to channels yet.</div>}

        {tab === 'breaks' && (
          <>
            {[{ type: 'ad_break', id: 'ad', name: 'Ad break', sub: '2 min to start, adjustable' }, ...(canLive ? [{ type: 'live', id: 'live', name: 'Live broadcast', sub: 'A placeholder in the guide. If nobody goes live, the loop plays.' }] : [])].map((b) => (
              <button key={b.id} type="button" className={`sch-item sch-item-main ${isPicked(b.type, b.id) ? 'picked' : ''}`} onClick={() => setPicked(isPicked(b.type, b.id) ? null : b)} {...drag(b)}>
                <span className={`sch-thumb ${b.type === 'live' ? 'live' : 'ads'}`} />
                <span className="sch-item-text"><b>{b.name}</b><small>{b.sub}</small></span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- the day ---------------- */

function Timeline({ slots, loading, layer, selectedId, picked, isPastDay, onSelect, onPlace, needPick }) {
  const laneRef = useRef(null);
  const scrollRef = useRef(null);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 17 * PX_PER_HOUR; // 5 PM
  }, []);

  const gaps = [];
  let cursor = 0;
  for (const s of slots) {
    if (s.start > cursor) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.start + s.durationSeconds);
  }
  if (cursor < DAY_SECONDS) gaps.push({ start: cursor, end: DAY_SECONDS });

  const y = (sec) => (sec / 3600) * PX_PER_HOUR;
  const secFromEvent = (e) => {
    const rect = laneRef.current.getBoundingClientRect();
    return Math.max(0, ((e.clientY - rect.top) / PX_PER_HOUR) * 3600);
  };
  const gapLabel = layer === 'week' ? 'Default schedule fills this' : 'Loop fills this';

  return (
    <div className="sch-timeline">
      {isPastDay && <div className="sch-past-note">This day has already aired. Changes here won&rsquo;t show anywhere.</div>}
      <div className="sch-scroll" ref={scrollRef}>
        <div className="sch-tl" style={{ height: y(DAY_SECONDS) }}>
          <div className="sch-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: PX_PER_HOUR }}>{clock(h * 3600).replace(':00', '')}</div>)}
          </div>
          <div
            ref={laneRef}
            className={`sch-lane ${dropping ? 'drop' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              let item = null;
              try { item = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { item = null; }
              onPlace(secFromEvent(e), item);
            }}
          >
            {loading && <div className="sch-muted" style={{ padding: '1rem' }}>Loading…</div>}
            {!loading && gaps.filter((g) => g.end - g.start >= 60).map((g) => (
              <button
                key={`gap-${g.start}`}
                type="button"
                className={`sch-slot gap ${picked ? 'armed' : ''}`}
                style={{ top: y(g.start) + 1, height: Math.max(y(g.end - g.start) - 2, 6) }}
                onClick={(e) => (picked ? onPlace(Math.max(g.start, Math.min(secFromEvent(e), g.end - SNAP)), null) : needPick())}
                aria-label={`Empty ${clock(g.start)} to ${clock(g.end)}${picked ? `, place ${picked.name} here` : ''}`}
              >
                {g.end - g.start >= 1200 && <span>{picked ? `Place ${picked.name} here` : gapLabel}</span>}
                {g.end - g.start >= 1200 && <small>{clock(g.start)}–{clock(g.end)}</small>}
              </button>
            ))}
            {!loading && slots.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sch-slot k-${s.kind} ${s.unavailable ? 'unavailable' : ''} ${selectedId === s.id ? 'selected' : ''}`}
                style={{ top: y(s.start) + 1, height: Math.max(y(s.durationSeconds) - 2, 16) }}
                onClick={() => onSelect(s.id)}
              >
                <span className="sch-slot-hd">
                  <b>{KIND_INFO[s.kind] ? `${KIND_INFO[s.kind].icon} ` : s.kind === 'live' ? '● ' : ''}{s.title}</b>
                  <small>{clock(s.start)}–{clock(s.start + s.durationSeconds)}</small>
                </span>
                {s.kind === 'series_pinned' && s.pinLabel && s.durationSeconds >= 1800 && <small>From {s.pinLabel}</small>}
                {s.unavailable && <small>Not available anymore · falls through to {layer === 'week' ? 'the default' : 'the loop'}</small>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- side panel ---------------- */

function PickedInfo({ picked, layer, onCancel }) {
  return (
    <div className="sch-editor">
      <div className="tv-info-eyebrow">Ready to place</div>
      <h3>{picked.name}</h3>
      <p>
        {picked.type === 'series'
          ? `Drops in as a ${layer === 'default' ? 'Continue' : 'Pinned'} block. Make it longer or shorter after placing it.`
          : picked.durationSeconds ? `${dur(picked.durationSeconds)}. ` : ''}
        Click a dashed gap, or drag it onto the day.
      </p>
      <button type="button" className="sch-btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function SlotEditor({ slot, layer, daySlots, series, preview, canLive, busy, onSave, onRemove }) {
  const [start, setStart] = useState(hhmm(slot.start));
  const [minutes, setMinutes] = useState(Math.round(slot.durationSeconds / 60));
  const [seconds, setSeconds] = useState(slot.durationSeconds);
  const [title, setTitle] = useState(slot.title || '');
  const isSeries = SERIES_KINDS.includes(slot.kind);
  const lockedLive = slot.kind === 'live' && !canLive;

  const fit = useMemo(() => {
    if (!isSeries || !series) return null;
    const eps = series.episodes;
    let startIdx = 0;
    if (slot.kind === 'series_pinned') startIdx = Math.max(0, eps.findIndex((e) => e.id === slot.pinEpisodeId));
    return fitEpisodes(eps, startIdx, slot.durationSeconds);
  }, [isSeries, series, slot]);

  const sources = daySlots.filter((s) => s.id !== slot.id && s.seriesId === slot.seriesId && (s.kind === 'series_continue' || s.kind === 'series_pinned') && s.start < slot.start);
  const upcoming = preview ? Object.entries(preview).slice(0, 4) : [];

  const timeChanged = start !== hhmm(slot.start);
  const lenChanged = slot.kind === 'ad_break' ? Number(seconds) !== slot.durationSeconds : Number(minutes) * 60 !== slot.durationSeconds;
  const lengthEditable = isSeries || slot.kind === 'ad_break' || slot.kind === 'live';

  function saveBasics() {
    const changes = {};
    if (timeChanged) changes.startTime = start;
    if (lengthEditable && lenChanged) changes.durationSeconds = slot.kind === 'ad_break' ? Number(seconds) : Number(minutes) * 60;
    if (slot.kind === 'live' && title !== slot.title) changes.title = title;
    onSave(changes);
  }

  return (
    <div className="sch-editor">
      <div className="tv-info-eyebrow">
        {isSeries ? 'Series block' : slot.kind === 'episode' ? 'Title' : slot.kind === 'ad_break' ? 'Ad break' : slot.kind === 'live' ? 'Live broadcast' : 'Slot'}
        {layer === 'default' ? ' · default schedule' : ''}
      </div>
      <h3>{slot.title}</h3>
      {slot.tier === 'premium' && <span className="sch-chip prem" style={{ alignSelf: 'flex-start' }}>Premium · airs with ads</span>}
      {slot.unavailable && <p className="sch-warn">This isn&rsquo;t available for channels anymore (unpublished, pulled, or opted out), so the time falls through to {layer === 'week' ? 'the default schedule' : 'the loop'}. Remove it or replace it.</p>}

      {isSeries && (
        <div className="sch-kinds" role="radiogroup" aria-label="Block type">
          {SERIES_KINDS.filter((k) => k !== 'series_continue' || layer === 'default').map((k) => {
            const disabled = busy || (k === 'series_rerun' && !sources.length);
            return (
              <button key={k} type="button" role="radio" aria-checked={slot.kind === k} className={`sch-kind k-${k}`} disabled={disabled && slot.kind !== k}
                onClick={() => {
                  if (slot.kind === k) return;
                  const changes = { kind: k };
                  if (k === 'series_rerun') changes.rerunOf = sources[sources.length - 1].id;
                  if (k === 'series_pinned' && series) changes.pinEpisodeId = series.episodes[0].id;
                  onSave(changes, `Now a ${KIND_INFO[k].name} block`);
                }}>
                <b>{KIND_INFO[k].icon} {KIND_INFO[k].name}</b>
                <small>{k === 'series_rerun' && !sources.length ? 'Needs a Continue or Pinned block of this series earlier the same day.' : KIND_INFO[k].help}</small>
              </button>
            );
          })}
        </div>
      )}

      <div className="sch-row">
        <label className="sch-field">
          <span>Starts</span>
          <input id="sch-start" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} disabled={lockedLive} />
        </label>
        {lengthEditable && slot.kind !== 'ad_break' && (
          <label className="sch-field">
            <span>Length (minutes)</span>
            <input id="sch-len" type="number" min={slot.kind === 'live' ? 15 : 5} max={720} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={lockedLive} />
          </label>
        )}
        {slot.kind === 'ad_break' && (
          <label className="sch-field">
            <span>Length (seconds)</span>
            <input id="sch-len" type="number" min={30} max={1800} step={15} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          </label>
        )}
      </div>
      {slot.kind === 'live' && (
        <label className="sch-field">
          <span>Title in the guide</span>
          <input id="sch-live-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} disabled={lockedLive} />
        </label>
      )}
      <div className="sch-muted">Ends {clock(slot.start + slot.durationSeconds)}{!lengthEditable ? ` · ${dur(slot.durationSeconds)}, the title's own length` : ''}</div>
      {(timeChanged || (lengthEditable && lenChanged) || (slot.kind === 'live' && title !== slot.title)) && (
        <button type="button" className="sch-btn primary" disabled={busy} onClick={saveBasics}>Save changes</button>
      )}

      {slot.kind === 'series_pinned' && series && (
        <label className="sch-field">
          <span>Always start at</span>
          <select id="sch-pin" value={slot.pinEpisodeId || ''} disabled={busy} onChange={(e) => onSave({ pinEpisodeId: e.target.value }, 'Saved')}>
            {series.episodes.map((e) => <option key={e.id} value={e.id}>{e.label ? `${e.label} · ` : ''}{e.title}</option>)}
          </select>
        </label>
      )}
      {slot.kind === 'series_rerun' && (
        <label className="sch-field">
          <span>Rerun of</span>
          <select id="sch-rerun" value={slot.rerunOf || ''} disabled={busy} onChange={(e) => onSave({ rerunOf: e.target.value }, 'Saved')}>
            {sources.map((s) => <option key={s.id} value={s.id}>{clock(s.start)} · {KIND_INFO[s.kind].name}</option>)}
          </select>
        </label>
      )}

      {isSeries && fit && slot.kind !== 'series_continue' && slot.kind !== 'series_rerun' && (
        <p className="sch-muted">
          Fits {fit.count} episode{fit.count === 1 ? '' : 's'}
          {slot.durationSeconds - fit.used > 0 ? `, then ${dur(slot.durationSeconds - fit.used)} of ads and bumpers` : ''}.
          {fit.count === 0 ? ' The episode is longer than the block, so only ads would play. Make the block longer.' : ''}
        </p>
      )}

      {isSeries && upcoming.length > 0 && (
        <div>
          <div className="tv-info-eyebrow" style={{ marginBottom: '0.35rem' }}>How it runs</div>
          <div className="sch-runlog">
            {upcoming.map(([date, labels], i) => (
              <div key={date} className={i === 0 ? 'next' : ''}>
                <span>{DAY_SHORT[weekdayOfDate(date)]} {shortDate(date)}</span>
                <span>{labels.join(', ')}</span>
              </div>
            ))}
          </div>
          {slot.kind === 'series_continue' && (
            <p className="sch-muted" style={{ marginTop: '0.4rem' }}>
              Moves forward only on days it actually airs. After the last episode of a season it goes on to the next season, and after the last season, back to the first episode. Leftover time is ads and bumpers.
            </p>
          )}
        </div>
      )}
      {isSeries && !upcoming.length && layer === 'week' && (
        <p className="sch-muted">This week isn&rsquo;t published, so this block doesn&rsquo;t air yet.</p>
      )}

      <div className="sch-editor-acts">
        {slot.kind === 'series_continue' && (
          <button type="button" className="sch-btn" disabled={busy} onClick={() => window.confirm('Start this block over from the first episode?') && onSave({ resetBookmark: true }, 'Back to the first episode')}>Start over from episode 1</button>
        )}
        {!lockedLive && <button type="button" className="sch-btn danger" disabled={busy} onClick={onRemove}>Remove</button>}
      </div>
    </div>
  );
}

function CopyDay({ layer, day, tabs, busy, onCopy }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState([]);
  const label = tabs.find((t) => t.key === day);
  if (!open) return <button type="button" className="sch-btn" onClick={() => setOpen(true)} disabled={busy}>Copy {label ? label.label : 'day'} to…</button>;
  return (
    <div className="sch-copy">
      <span>Copy {label ? label.label : 'this day'} onto:</span>
      {tabs.filter((t) => t.key !== day && !t.past).map((t) => (
        <label key={t.key}>
          <input type="checkbox" checked={targets.includes(t.key)} onChange={() => setTargets((x) => (x.includes(t.key) ? x.filter((k) => k !== t.key) : [...x, t.key]))} />
          {t.label}
        </label>
      ))}
      <button type="button" className="sch-btn primary" disabled={busy || !targets.length}
        onClick={async () => {
          if (!window.confirm(`Replace everything on ${targets.length} day${targets.length === 1 ? '' : 's'} with ${label ? label.label : 'this day'}'s lineup?`)) return;
          await onCopy(targets);
          setOpen(false);
          setTargets([]);
        }}>Copy</button>
      <button type="button" className="sch-btn" onClick={() => { setOpen(false); setTargets([]); }}>Cancel</button>
      {layer === 'default' && <small>Each copy of a Continue block keeps its own place in the series.</small>}
    </div>
  );
}

/* ---------------- loop ---------------- */

function LoopView({ channelId, loop, library, busy, setBusy, setError, reload, flash }) {
  const [q, setQ] = useState('');
  async function act(method, body, msg) {
    setBusy(true);
    setError(null);
    try {
      await api('/api/schedule/loop', method, { channelId, ...body });
      await reload();
      if (msg) flash(msg);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const total = (loop || []).reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
  const inLoop = new Set((loop || []).map((r) => r.episodeId));
  const options = library
    ? [...library.titles.map((t) => ({ id: t.id, name: t.title, durationSeconds: t.durationSeconds })),
       ...library.series.flatMap((s) => s.episodes.map((e) => ({ id: e.id, name: `${s.name} · ${e.label ? `${e.label} ` : ''}${e.title}`, durationSeconds: e.durationSeconds })))]
      .filter((o) => !inLoop.has(o.id) && (!q.trim() || o.name.toLowerCase().includes(q.trim().toLowerCase())))
    : [];

  return (
    <div className="sch-loop">
      <div className="sch-loop-list">
        <div className="sch-bar">
          <p className="sch-note">The loop plays back to back, round and round, and fills any time nothing else is scheduled. Full loop: <b>{dur(total)}</b>.</p>
          <button type="button" className="sch-btn" disabled={busy || !loop || !loop.length} onClick={() => window.confirm('Start the loop over from the top right now?') && act('PATCH', { action: 'restart' }, 'Loop restarted')}>Restart from the top</button>
        </div>
        {!loop && <div className="sch-muted">Loading…</div>}
        {loop && loop.length === 0 && <div className="ca-empty">The loop is empty. Until you add something, gaps in the schedule show as off the air.</div>}
        {loop && loop.map((r, i) => (
          <div key={r.id} className="sch-loop-row">
            <span className="sch-loop-pos">{i + 1}</span>
            <span className="sch-loop-title"><b>{r.title}</b><small>{dur(r.durationSeconds || 0)}</small></span>
            <span className="sch-loop-acts">
              <button type="button" className="sch-btn" disabled={busy || i === 0} onClick={() => act('PATCH', { id: r.id, action: 'moveUp' })} aria-label={`Move ${r.title} up`}>↑</button>
              <button type="button" className="sch-btn" disabled={busy || i === loop.length - 1} onClick={() => act('PATCH', { id: r.id, action: 'moveDown' })} aria-label={`Move ${r.title} down`}>↓</button>
              <button type="button" className="sch-btn danger" disabled={busy} onClick={() => act('PATCH', { id: r.id, action: 'remove' }, 'Removed from the loop')}>Remove</button>
            </span>
          </div>
        ))}
      </div>
      <div className="sch-lib">
        <div className="tv-info-eyebrow">Add to the loop</div>
        <input id="sch-loop-search" type="search" className="sch-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search titles to add" />
        <div className="sch-items">
          {!library && <div className="sch-muted">Loading…</div>}
          {library && options.length === 0 && <div className="sch-muted">Nothing else to add.</div>}
          {options.map((o) => (
            <button key={o.id} type="button" className="sch-ep" disabled={busy} onClick={() => act('POST', { episodeId: o.id }, 'Added to the loop')}>
              <span>{o.name}</span><small>+ {dur(o.durationSeconds)}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
