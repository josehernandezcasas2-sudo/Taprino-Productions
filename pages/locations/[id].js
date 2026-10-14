import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import ReportButton from '../../components/ReportButton';
import { Avatar } from '../../components/crew/CrewBits';
import { LocationShell, Crumbs, HostedChip, StatusPill, MonthCalendar, thisMonth, todayIso, daysBetween, hoursLabel, fmtRange } from '../../components/locations/LocationBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getListing } from '../../lib/locations';
import { getOwnCard } from '../../lib/crewCards';
import { getSupabase } from '../../lib/supabase';
import { FEATURES, CANCELLATION, PERMIT_HELP, quoteFor, splitBooking, dollars, dayCount, MIN_BOOKING_CENTS, MAX_BOOKING_CENTS, MAX_DAYS, DEFAULT_CUT_PERCENT } from '../../lib/locationRules';

// One place (mockups/locations-v1.html §2): gallery, the facts a scout
// wants, availability, the host, and the request panel. The host sees
// the same page with an edit bar on top.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  const base = {
    mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator,
    viewerId: account.userId || null
  };
  let near = null;
  if (account.isSignedIn) {
    try { const own = await getOwnCard(account.userId); if (own && own.place) near = { lat: own.place.lat, lng: own.place.lng }; } catch (err) { /* none */ }
  }
  let listing = null;
  let notFound = false;
  let setupError = false;
  try {
    listing = JSON.parse(JSON.stringify(await getListing(String(params.id), { viewerId: account.userId || null, isAdmin: account.isAdmin, near })));
  } catch (err) {
    if (err.status === 404) notFound = true;
    else if (err.status === 503) setupError = true;
    else throw err;
  }
  let projects = [];
  if (account.isSignedIn && listing && !listing.mine) {
    const supabase = getSupabase();
    const [pitches, series] = await Promise.all([
      supabase.from('pitches').select('id, title').eq('created_by', account.userId).order('created_at', { ascending: false }).limit(50),
      supabase.from('series').select('id, name').eq('creator_id', account.userId).order('created_at', { ascending: false }).limit(50)
    ]);
    projects = [
      ...(pitches.data || []).map((p) => ({ value: `pitch:${p.id}`, label: `Pitch Room · ${p.title}` })),
      ...(series.data || []).map((s) => ({ value: `series:${s.id}`, label: `Series · ${s.name}` }))
    ];
  }
  return { props: { ...base, listing, notFound, setupError, projects } };
}

const TABS = ['The space', 'Light, power, sound', 'Logistics', 'Rules', 'Permits & insurance', 'Shot here'];
const has = (l, k) => l.features.includes(k);
const yesNo = (l, k, yes, no) => (has(l, k) ? yes : no);

export default function ListingPage(props) {
  const { listing: l, notFound, setupError, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, projects } = props;
  const shell = { mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber };
  const [photo, setPhoto] = useState(0);
  const [tab, setTab] = useState(0);
  const [month, setMonth] = useState(thisMonth());
  const [copied, setCopied] = useState(false);
  const [dates, setDates] = useState({ from: '', to: '' });

  if (notFound || setupError || !l) {
    return (
      <LocationShell title="Not here" {...shell}>
        <Crumbs items={[{ href: '/locations', label: 'Locations' }, { label: 'Not here' }]} />
        <div className="crew-panel crew-empty">{setupError ? 'Locations aren’t set up yet — the admin needs to run migration 086.' : 'That place isn’t here any more.'}<br /><Link href="/locations" className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to Locations</Link></div>
      </LocationShell>
    );
  }

  const photos = l.photos.length ? l.photos : [{ url: l.coverUrl, caption: '' }];
  const marks = {};
  for (const d of l.blockedDays || []) marks[d] = 'blocked';
  for (const d of l.bookedDays || []) marks[d] = 'booked';
  if (dates.from) for (const d of daysBetween(dates.from, dates.to || dates.from)) if (!marks[d]) marks[d] = 'sel';
  const pickDay = (iso) => {
    if (marks[iso] === 'booked' || marks[iso] === 'blocked') return;
    setDates((d) => (!d.from || (d.from && d.to) || iso < d.from ? { from: iso, to: '' } : { from: d.from, to: iso }));
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  const kv = [
    [['Rooms', l.rooms], ['Inside', l.sqFt ? `${l.sqFt.toLocaleString()} sq ft` : null], ['Outside', l.outdoorSqFt ? `${l.outdoorSqFt.toLocaleString()} sq ft` : null], ['Ceilings', l.ceilingFt ? `${l.ceilingFt} ft` : null], ['Crew max', l.crewMax], ['Hours', hoursLabel(l.hoursFrom, l.hoursTo)], ['Furniture', yesNo(l, 'furniture_moves', 'May move; photograph first', null)], ['Green room', yesNo(l, 'green_room', 'Yes', null)], ['Makeup area', yesNo(l, 'makeup_area', 'Yes', null)]],
    [['Windows face', l.windowsFace], ['Best light', l.bestLight], ['Natural light', yesNo(l, 'natural_light', 'Yes', 'Little')], ['Blackout', yesNo(l, 'blackout', 'Possible', 'No')], ['Power', l.power || (has(l, 'power_tiein') ? 'Tie-in available' : has(l, 'power_50a') ? '50A+ outlet' : has(l, 'household_power') ? 'Household circuits' : null)], ['Sound', l.sound || (has(l, 'soundproof') ? 'Soundproofed' : has(l, 'quiet') ? 'Quiet' : has(l, 'flight_path') ? 'Near a flight path' : null)]],
    [['Parking', [has(l, 'driveway') && 'driveway', has(l, 'street_parking') && 'street', has(l, 'truck_access') && 'truck access'].filter(Boolean).join(' · ') || null], ['Load-in', [has(l, 'ground_loadin') && 'ground level', has(l, 'elevator') && 'elevator', has(l, 'loading_dock') && 'loading dock'].filter(Boolean).join(' · ') || null], ['Bathrooms', yesNo(l, 'bathrooms', 'Crew may use', null)], ['Kitchen', yesNo(l, 'kitchen', 'Usable', null)], ['Wifi', yesNo(l, 'wifi', 'Yes', null)], ['Overnight', yesNo(l, 'overnight', 'OK', 'No')], ['Access notes', l.accessNotes || (l.mine ? null : 'Shared once a booking is paid')]],
    [['Cancellation', `${CANCELLATION[l.cancellation].label} · ${CANCELLATION[l.cancellation].text}`], ['Hours', hoursLabel(l.hoursFrom, l.hoursTo)], ['Crew max', l.crewMax], ['House rules', l.rules || 'None posted']],
    [['Film permit', PERMIT_HELP[l.permitHelp]], ['Insurance', l.coiRequired ? 'Crews must carry a COI naming the host' : 'No COI required'], ['Host', { owner: 'Owns the place', works_here: 'Works here and can book it', permission: 'Has the owner’s written permission' }[l.ownership]], ['Verified', l.verified ? '✓ Checked by Studio Tapa' : 'Not yet']]
  ];

  return (
    <LocationShell title={l.title} description={`${l.kindLabel} in ${l.place ? l.place.label : ''} · ${l.rateLine}`} {...shell}>
      <Crumbs items={[{ href: '/locations', label: 'Locations' }, { href: `/locations?kind=${l.kind}`, label: l.kindLabel }, { label: l.title }]} />
      {l.mine && (
        <div className="loc-ownbar">
          <span><StatusPill status={l.status} /> This is how producers see your place{l.status === 'pending' ? ' once it’s approved' : l.status === 'paused' ? ' when it’s listed' : ''}.</span>
          <span className="crew-actions"><Link href={`/locations/new?edit=${l.id}`} className="crew-btn sm">Edit</Link><Link href="/locations/mine" className="crew-btn sm ghost">Your places</Link></span>
        </div>
      )}
      <div className="loc-lp">
        <div>
          <div className="loc-gallery">
            <div className="loc-gallery-main" style={{ backgroundImage: `url(${photos[photo].url})` }}>{photos[photo].caption && <span className="loc-card-k">{photos[photo].caption}</span>}</div>
            {photos.length > 1 && (
              <div className="loc-gallery-thumbs">
                {photos.map((p, i) => <button key={p.url} type="button" className={i === photo ? 'on' : ''} style={{ backgroundImage: `url(${p.url})` }} onClick={() => setPhoto(i)} aria-label={p.caption || `Photo ${i + 1}`} />)}
              </div>
            )}
          </div>
          <div className="loc-title-row">
            <div>
              <span className="crew-eyebrow" style={{ color: 'var(--olive)' }}>{l.kindLabel} · {l.place ? l.place.label : ''}{l.miles != null ? ` · ${l.miles} mi from you` : ''} · {l.mine || l.address ? 'exact address' : 'exact address after booking'}</span>
              <h1 className="loc-h1">{l.title}</h1>
            </div>
            <div className="crew-chips">
              <button type="button" className="crew-btn sm" onClick={share}>{copied ? 'Link copied' : 'Share'}</button>
              {isSignedIn && !l.mine && <ReportButton targetType="location" targetId={l.id} title={l.title} className="crew-btn sm ghost" />}
            </div>
          </div>
          <div className="loc-tiles">
            <div className="loc-tile"><b>{l.sqFt ? `${l.sqFt.toLocaleString()} sq ft` : '—'}</b><span>Inside</span></div>
            <div className="loc-tile"><b>{l.rooms ? `${l.rooms.split('·').length} ${l.rooms.split('·').length === 1 ? 'space' : 'spaces'}` : l.outdoorSqFt ? `${l.outdoorSqFt.toLocaleString()} sq ft` : '—'}</b><span>{l.rooms ? 'Spaces' : 'Outside'}</span></div>
            <div className="loc-tile"><b>{l.crewMax ? `Crew up to ${l.crewMax}` : 'Any crew'}</b><span>People</span></div>
            <div className="loc-tile"><b>{hoursLabel(l.hoursFrom, l.hoursTo)}</b><span>Hours</span></div>
          </div>
          {l.description && <p className="loc-desc">{l.description}</p>}
          {l.mine && l.address && <div className="loc-money">Private: <b>{l.address}</b>{l.accessNotes ? ` · ${l.accessNotes}` : ''} — only you, admins and a paid booking see this.</div>}

          <div className="crew-subnav loc-tabs" role="tablist">
            {TABS.map((t, i) => <button key={t} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>{t}{i === 5 ? ` · ${l.credits.length}` : ''}</button>)}
          </div>
          {tab < 5 ? (
            <div className="loc-kv">
              {kv[tab].filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k}><span>{k}</span><span>{String(v)}</span></div>)}
            </div>
          ) : (
            <div className="crew-chips">
              {l.credits.length === 0 && <span className="crew-muted">No credits yet. A shoot that goes as agreed adds the production here.</span>}
              {l.credits.map((c, i) => c.projectId
                ? <Link key={i} href={c.projectType === 'pitch' ? `/pitches/${c.projectId}` : `/series/${c.projectId}`} className="crew-chip pitch">{c.projectType === 'pitch' ? 'Pitch Room' : 'Series'} · {c.title}</Link>
                : <span key={i} className="crew-chip">{c.title}</span>)}
            </div>
          )}

          <div className="crew-field" style={{ marginTop: '1.2rem' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>Availability <small style={{ textTransform: 'none', letterSpacing: 0 }}>tap a day, then the last day, to start a request</small></span>
            <div style={{ maxWidth: 480 }}><MonthCalendar month={month} onMonth={setMonth} marks={marks} min={todayIso()} onPick={pickDay} /></div>
          </div>
        </div>

        <aside className="loc-side">
          <div className="crew-panel loc-rates">
            <span className="crew-eyebrow" style={{ color: 'var(--olive)' }}>Rates</span>
            {l.hourlyCents && <div><span>Hourly <small>{l.minHours} hr minimum</small></span><b>{dollars(l.hourlyCents, { whole: true })}</b></div>}
            {l.halfDayCents && <div><span>Half day</span><b>{dollars(l.halfDayCents, { whole: true })}</b></div>}
            {l.dayCents && <div><span>Full day <small>{l.dayHours} hrs</small></span><b>{dollars(l.dayCents, { whole: true })}</b></div>}
            {l.overtimeCents && <div><span>Overtime <small>past booked hours</small></span><b>{dollars(l.overtimeCents, { whole: true })}/hr</b></div>}
            {l.cleaningCents && <div><span>Cleaning</span><b>{dollars(l.cleaningCents, { whole: true })}</b></div>}
            {l.weekendPct > 0 && <div><span>Weekends / nights</span><b>+{l.weekendPct}%</b></div>}
            {!l.hourlyCents && !l.dayCents && <div><span>No posted rate</span><b>Make a deal</b></div>}
            <span className="crew-mono">{l.dealsOk ? 'Also open to a deal — send your own number in the request.' : 'Posted rates only.'} {CANCELLATION[l.cancellation].label} cancellation.</span>
          </div>

          {!l.mine && (isSignedIn
            ? <RequestPanel listing={l} projects={projects} dates={dates} setDates={setDates} />
            : (
              <div className="crew-panel loc-req">
                <span className="crew-eyebrow">Request to book</span>
                <p className="crew-muted" style={{ margin: '0.4rem 0 0.7rem' }}>Pick dates, say what you’re shooting, pay the posted rate or make an offer. Nothing is charged until the host accepts.</p>
                <SignInButton mode="modal"><button type="button" className="crew-btn primary" style={{ width: '100%' }}>Sign in to request dates</button></SignInButton>
              </div>
            ))}

          <div className="crew-panel loc-host">
            <div className="loc-host-row">
              <Avatar userId={l.host.userId} name={l.host.displayName} src={l.host.avatarUrl} position={l.host.avatarPosition} zoom={l.host.avatarZoom} size="lg" />
              <div style={{ minWidth: 0 }}>
                <div className="crew-pname"><Link href={l.host.profilePath}>{l.host.displayName}</Link><HostedChip host={l.host} />{l.verified && <span className="crew-chip ok">✓ verified</span>}</div>
                <span className="crew-mono">{l.host.listings || 1} {l.host.listings === 1 ? 'place' : 'places'} listed{l.host.wouldAgain ? ` · ${l.host.wouldAgain} would shoot here again` : ''}</span>
              </div>
            </div>
            {!l.mine && (
              <div className="crew-actions" style={{ marginTop: '0.6rem' }}>
                {isSignedIn ? <Link href={`/messages?to=${encodeURIComponent(l.host.userId)}&kind=location&label=${encodeURIComponent(l.title)}`} className="crew-btn sm">Ask about a date</Link> : null}
                <Link href={l.host.profilePath} className="crew-btn sm ghost">Profile</Link>
              </div>
            )}
          </div>

          {l.rules && (
            <div className="crew-panel loc-rules-box">
              <span className="crew-eyebrow">House rules · the short version</span>
              <p className="crew-muted" style={{ margin: '0.4rem 0 0' }}>{l.rules}</p>
            </div>
          )}
        </aside>
      </div>
    </LocationShell>
  );
}

/* ---------------- the request panel ---------------- */

function hoursBetween(from, to) {
  if (!from || !to) return null;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let h = (th + tm / 60) - (fh + fm / 60);
  if (h <= 0) h += 24;
  return Math.round(h * 2) / 2;
}

function RequestPanel({ listing: l, projects, dates, setDates }) {
  const router = useRouter();
  const [form, setForm] = useState({ hoursFrom: '08:00', hoursTo: '18:00', crewSize: '', vehicles: '', project: '', shooting: '', message: '', pricing: l.hourlyCents || l.dayCents ? 'posted' : 'offer', offer: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const hasRates = Boolean(l.hourlyCents || l.dayCents);
  const endsOn = dates.to || dates.from;
  const days = dayCount(dates.from, endsOn);
  const hoursPerDay = hoursBetween(form.hoursFrom, form.hoursTo) || l.dayHours;

  const est = useMemo(() => {
    if (!dates.from) return null;
    let subtotal = null;
    let how = '';
    if (form.pricing === 'posted' && hasRates) {
      const q = quoteFor(l, { startsOn: dates.from, endsOn, hoursPerDay });
      if (q) { subtotal = q.subtotalCents; how = q.lines.every((x) => x.how === 'day') ? `${days} × day rate` : q.lines.map((x) => x.how).join(' + '); }
    } else {
      const cents = Math.round(Number(form.offer) * 100);
      if (cents > 0) { subtotal = cents; how = 'your offer'; }
    }
    if (subtotal == null) return null;
    return { ...splitBooking({ subtotalCents: subtotal, cleaningCents: l.cleaningCents || 0, cutPercent: DEFAULT_CUT_PERCENT }), how };
  }, [dates.from, endsOn, hoursPerDay, form.pricing, form.offer, hasRates, l, days]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [type, id] = form.project ? form.project.split(':') : [null, null];
      const res = await fetch(`/api/locations/${l.id}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsOn: dates.from, endsOn, hoursFrom: form.hoursFrom, hoursTo: form.hoursTo, crewSize: form.crewSize, vehicles: form.vehicles, project: type ? { type, id } : null, shooting: form.shooting, message: form.message, pricing: form.pricing, offer: form.offer })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send that.');
      setDone(data.request);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="crew-panel loc-req">
        <span className="crew-eyebrow">Request sent</span>
        <p className="crew-muted" style={{ margin: '0.4rem 0 0.7rem' }}>{l.host.displayName.split(' ')[0]} has 48 hours to accept, counter or decline. You’ll get a notification either way, and the conversation is in your Messages with the place attached.</p>
        <div className="crew-actions">
          <Link href={`/locations/requests/${done.id}`} className="crew-btn sm primary">Open the request</Link>
          {done.threadId && <Link href={`/messages/${done.threadId}`} className="crew-btn sm">Messages</Link>}
        </div>
      </div>
    );
  }

  return (
    <form className="crew-panel loc-req" onSubmit={submit}>
      <span className="crew-eyebrow">Request to book</span>
      <div className="crew-row2">
        <label className="crew-field"><span>First day</span><input type="date" className="crew-input" value={dates.from} min={todayIso()} onChange={(e) => setDates({ from: e.target.value, to: dates.to && dates.to >= e.target.value ? dates.to : '' })} required /></label>
        <label className="crew-field"><span>Last day</span><input type="date" className="crew-input" value={dates.to} min={dates.from || todayIso()} onChange={(e) => setDates({ ...dates, to: e.target.value })} disabled={!dates.from} /></label>
      </div>
      <div className="crew-row2">
        <label className="crew-field"><span>From</span><input type="time" className="crew-input" value={form.hoursFrom} onChange={(e) => set({ hoursFrom: e.target.value })} /></label>
        <label className="crew-field"><span>To</span><input type="time" className="crew-input" value={form.hoursTo} onChange={(e) => set({ hoursTo: e.target.value })} /></label>
      </div>
      <div className="crew-row2">
        <label className="crew-field"><span>Crew size</span><input type="number" className="crew-input" min="1" max="200" value={form.crewSize} onChange={(e) => set({ crewSize: e.target.value })} placeholder="9" /></label>
        <label className="crew-field"><span>Vehicles</span><input type="number" className="crew-input" min="0" max="50" value={form.vehicles} onChange={(e) => set({ vehicles: e.target.value })} placeholder="3" /></label>
      </div>
      <label className="crew-field"><span>Project (optional)</span>
        <select className="crew-select" value={form.project} onChange={(e) => set({ project: e.target.value })}>
          <option value="">Independent — no project page</option>
          {projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label className="crew-field"><span>What you’re shooting</span><input type="text" className="crew-input" value={form.shooting} onChange={(e) => set({ shooting: e.target.value })} placeholder="Narrative short, dialogue in the living room + yard, one night exterior" maxLength={200} required /></label>
      <div className="crew-field"><span>Pay</span>
        <div className="crew-toggle" role="group" aria-label="Pay">
          {hasRates && <button type="button" aria-pressed={form.pricing === 'posted'} onClick={() => set({ pricing: 'posted' })}>Posted rate</button>}
          {l.dealsOk && <button type="button" aria-pressed={form.pricing === 'offer'} onClick={() => set({ pricing: 'offer' })}>Make an offer</button>}
        </div>
        {form.pricing === 'offer' && <input type="number" className="crew-input" min="25" step="1" value={form.offer} onChange={(e) => set({ offer: e.target.value })} placeholder={`Your number for the whole booking ($${MIN_BOOKING_CENTS / 100}–$${(MAX_BOOKING_CENTS / 100).toLocaleString()})`} required />}
      </div>
      <label className="crew-field"><span>A note to {l.host.displayName.split(' ')[0]}</span><textarea className="crew-input" rows={3} value={form.message} onChange={(e) => set({ message: e.target.value })} placeholder="Anything they should know: generator, night work, how you found them." maxLength={2000} /></label>
      {est ? (
        <div className="loc-money">
          Est. <b>{dollars(est.bookingCents)}</b> for {days} {days === 1 ? 'day' : 'days'} ({est.how}{est.cleaningCents ? ` + ${dollars(est.cleaningCents)} cleaning` : ''}), <b>{dollars(est.totalChargedCents)}</b> with the card fee. Nothing is charged until {l.host.displayName.split(' ')[0]} accepts; the address is shared then.
        </div>
      ) : dates.from ? (
        <div className="loc-money">{form.pricing === 'offer' ? 'Enter your offer to see the total.' : 'This place has no posted rate — make an offer.'}</div>
      ) : (
        <div className="loc-money">Pick your dates on the calendar or above to see an estimate.</div>
      )}
      {days > MAX_DAYS && <div className="crew-status error">Up to {MAX_DAYS} days per request — split a longer shoot into two.</div>}
      {error && <div className="crew-status error" role="alert">{error}</div>}
      <button type="submit" className="crew-btn primary" style={{ width: '100%' }} disabled={busy || !dates.from || days > MAX_DAYS || (form.pricing === 'offer' && !(Number(form.offer) > 0))}>{busy ? 'Sending…' : 'Send request'}</button>
      <span className="crew-mono" style={{ textAlign: 'center' }}>{fmtRange(dates.from, endsOn) || 'No dates yet'}{dates.from ? ` · ${hoursPerDay} hrs a day` : ''}</span>
    </form>
  );
}
