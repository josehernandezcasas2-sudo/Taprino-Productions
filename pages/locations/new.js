import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import PlaceSearch from '../../components/crew/PlaceSearch';
import { LocationShell, Crumbs, PhotoStrip, uploadImage } from '../../components/locations/LocationBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getListing } from '../../lib/locations';
import { LOCATION_TYPES, FEATURE_GROUPS, CANCELLATION, PERMIT_HELP, OWNERSHIP, MAX_PHOTOS, DEFAULT_CUT_PERCENT, splitBooking, dollars } from '../../lib/locationRules';
import { SITE } from '../../lib/siteConfig';

const SITE_NAME = SITE.name;

// List a place (/locations/new) or edit one (/locations/new?edit=<id>).
// One page, seven sections (the mockup's steps), saved in one go: a new
// place goes to admin review; an edit to a listed place stays live
// unless the address, ownership or proof changed.
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  const base = {
    mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator
  };
  let editing = null;
  let loadError = null;
  if (account.isSignedIn && query.edit) {
    try {
      const l = await getListing(String(query.edit), { viewerId: account.userId, isAdmin: account.isAdmin });
      if (l.mine || account.isAdmin) editing = JSON.parse(JSON.stringify(l)); else loadError = 'That place isn’t yours to edit.';
    } catch (err) {
      loadError = err.status === 404 ? 'That place isn’t here.' : err.message;
    }
  }
  return { props: { ...base, editing, loadError } };
}

const EMPTY = {
  title: '', kind: 'home', description: '', place: null, address: '', accessNotes: '',
  photos: [],
  sqFt: '', outdoorSqFt: '', rooms: '', ceilingFt: '', crewMax: '', hoursFrom: '07:00', hoursTo: '22:00', features: [], windowsFace: '', bestLight: '', power: '', sound: '',
  hourly: '', minHours: 4, halfDay: '', day: '', dayHours: 10, overtime: '', cleaning: '', weekendPct: 0, dealsOk: true,
  cancellation: 'moderate', rules: '', permitHelp: 'you_handle', coiRequired: false,
  ownership: 'owner', proofUrl: null, proofNote: ''
};

function fromListing(l) {
  if (!l) return EMPTY;
  const d = (c) => (c == null ? '' : String(c / 100));
  return {
    title: l.title, kind: l.kind, description: l.description, place: l.place, address: l.address, accessNotes: l.accessNotes,
    photos: l.photos.map((p) => ({ url: p.url, caption: p.caption || '' })),
    sqFt: l.sqFt ?? '', outdoorSqFt: l.outdoorSqFt ?? '', rooms: l.rooms, ceilingFt: l.ceilingFt ?? '', crewMax: l.crewMax ?? '', hoursFrom: l.hoursFrom || '', hoursTo: l.hoursTo || '',
    features: l.features, windowsFace: l.windowsFace, bestLight: l.bestLight, power: l.power, sound: l.sound,
    hourly: d(l.hourlyCents), minHours: l.minHours, halfDay: d(l.halfDayCents), day: d(l.dayCents), dayHours: l.dayHours, overtime: d(l.overtimeCents), cleaning: d(l.cleaningCents), weekendPct: l.weekendPct, dealsOk: l.dealsOk,
    cancellation: l.cancellation, rules: l.rules, permitHelp: l.permitHelp, coiRequired: l.coiRequired,
    ownership: l.ownership, proofUrl: l.proofUrl, proofNote: l.proofNote
  };
}

const SECTIONS = [['basics', '1 Basics'], ['photos', '2 Photos'], ['space', '3 The space'], ['rates', '4 Rates'], ['rules', '5 Rules'], ['permits', '6 Permits & insurance'], ['proof', '7 Who you are']];

export default function ListAPlace({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, editing, loadError }) {
  const router = useRouter();
  const [form, setForm] = useState(() => fromListing(editing));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(loadError);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleFeature = (k) => set({ features: form.features.includes(k) ? form.features.filter((x) => x !== k) : [...form.features, k] });

  // The money line under Rates: a 10-hour Saturday at these rates.
  const preview = useMemo(() => {
    const day = Math.round(Number(form.day) * 100) || 0;
    const hourly = Math.round(Number(form.hourly) * 100) || 0;
    const base = day || (hourly ? hourly * Math.max(10, Number(form.minHours) || 1) : 0);
    if (!base) return null;
    const withWeekend = base + Math.round((base * (Number(form.weekendPct) || 0)) / 100);
    const split = splitBooking({ subtotalCents: withWeekend, cleaningCents: Math.round(Number(form.cleaning) * 100) || 0, cutPercent: DEFAULT_CUT_PERCENT });
    return { ...split, how: day ? 'day rate' : `${Math.max(10, Number(form.minHours) || 1)} hrs × hourly` };
  }, [form.day, form.hourly, form.minHours, form.weekendPct, form.cleaning]);

  async function addPhotos(files) {
    setUploading(true);
    setError(null);
    try {
      const room = MAX_PHOTOS - form.photos.length;
      const added = [];
      for (const file of files.slice(0, room)) added.push({ url: await uploadImage(file, 'photo'), caption: '' });
      setForm((f) => ({ ...f, photos: [...f.photos, ...added].slice(0, MAX_PHOTOS) }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function addProof(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      set({ proofUrl: await uploadImage(file, 'proof') });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/locations/${editing.id}` : '/api/locations', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save that.');
      router.push(`/locations/mine?${editing ? 'saved' : 'submitted'}=1`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const shell = { mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber };

  if (!isSignedIn) {
    return (
      <LocationShell title="List a place" {...shell}>
        <Crumbs items={[{ href: '/locations', label: 'Locations' }, { label: 'List a place' }]} />
        <div className="crew-panel crew-signin">
          <span className="crew-eyebrow">Connect · Locations</span>
          <h1>List a place</h1>
          <p>A home, a warehouse, a café on its closed day, a yard: if you hold the keys, productions near you will pay to shoot there. Set your rates or take offers; the site handles the booking and the money.</p>
          <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in or create an account</button></SignInButton>
        </div>
      </LocationShell>
    );
  }

  const proofIsPdf = form.proofUrl && /\.pdf($|\?)/i.test(form.proofUrl);

  return (
    <LocationShell title={editing ? 'Edit your place' : 'List a place'} {...shell}>
      <Crumbs items={[{ href: '/locations', label: 'Locations' }, { href: '/locations/mine', label: 'Your places' }, { label: editing ? 'Edit' : 'List a place' }]} />
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Connect · Locations</span>
          <h1>{editing ? `Edit “${editing.title}”` : 'List a place'}</h1>
          <p>{editing ? 'Changes to the address, who you are or the proof send the place back to review; everything else updates straight away.' : 'Seven short sections. A new place goes to review first: we check you’re the owner or can book it, then it’s public under Locations.'}</p>
        </div>
      </div>
      <p className="crew-mono loc-req-legend"><i className="req-dot" aria-hidden="true" /> marks what a listing needs before it can go to review.</p>
      {error && <div className="crew-status error loc-topstatus" role="alert">{error}</div>}
      {editing && editing.status === 'rejected' && editing.rejectionReason && <div className="crew-status error loc-topstatus">Not approved last time: {editing.rejectionReason} — fix it and save to resubmit.</div>}

      <nav className="loc-steps" aria-label="Sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <form className="crew-card-grid loc-form" onSubmit={save}>
        <div className="crew-wc">
          <section className="crew-panel" id="basics">
            <h3>Basics</h3>
            <label className="crew-field"><span>Title<i className="req-dot" aria-hidden="true" /></span><input type="text" className="crew-input" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Mid-century bungalow with a big back yard" maxLength={90} required /></label>
            <div className="crew-row2">
              <label className="crew-field"><span>What it is<i className="req-dot" aria-hidden="true" /></span>
                <select className="crew-select" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>{Object.entries(LOCATION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <div className="crew-field"><span>Neighbourhood or city (shows publicly)<i className="req-dot" aria-hidden="true" /></span>
                <PlaceSearch value={form.place} onChange={(p) => set({ place: p })} placeholder="Highland Park, Los Angeles" id="loc-place" />
              </div>
            </div>
            <label className="crew-field"><span>Describe it</span><textarea className="crew-input" rows={5} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Year built, materials, what the light does, who lives or works there, what has shot here before." maxLength={2000} /></label>
            <div className="crew-row2">
              <label className="crew-field"><span>Street address (private until a booking is paid)<i className="req-dot" aria-hidden="true" /></span><input type="text" className="crew-input" value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="1234 Avenue 56, Los Angeles, CA 90042" maxLength={200} required /></label>
              <label className="crew-field"><span>Access notes (private, same)</span><input type="text" className="crew-input" value={form.accessNotes} onChange={(e) => set({ accessNotes: e.target.value })} placeholder="Gate code, where to park the truck, which door" maxLength={1000} /></label>
            </div>
          </section>

          <section className="crew-panel" id="photos">
            <h3>Photos<i className="req-dot" aria-hidden="true" /> <small>up to {MAX_PHOTOS} · the first is the cover</small></h3>
            <PhotoStrip photos={form.photos} max={MAX_PHOTOS} busy={uploading} onChange={(next) => (Array.isArray(next) && next[0] instanceof File ? addPhotos(next) : set({ photos: next }))} />
            <span className="crew-mono">One frame per room at the time of day the light is best, and say the time in the caption. Photos are shrunk to 1600px before upload.</span>
          </section>

          <section className="crew-panel" id="space">
            <h3>The space <small>scouts filter on these, so tick what’s true</small></h3>
            <div className="crew-row2">
              <label className="crew-field"><span>Inside (sq ft)</span><input type="number" className="crew-input" min="0" value={form.sqFt} onChange={(e) => set({ sqFt: e.target.value })} /></label>
              <label className="crew-field"><span>Outside (sq ft)</span><input type="number" className="crew-input" min="0" value={form.outdoorSqFt} onChange={(e) => set({ outdoorSqFt: e.target.value })} /></label>
            </div>
            <label className="crew-field"><span>Rooms crews may use</span><input type="text" className="crew-input" value={form.rooms} onChange={(e) => set({ rooms: e.target.value })} placeholder="Living · kitchen · bedroom · yard · garage (green room)" maxLength={200} /></label>
            <div className="loc-row4">
              <label className="crew-field"><span>Ceilings (ft)</span><input type="number" className="crew-input" min="0" step="0.5" value={form.ceilingFt} onChange={(e) => set({ ceilingFt: e.target.value })} /></label>
              <label className="crew-field"><span>Crew max</span><input type="number" className="crew-input" min="1" max="200" value={form.crewMax} onChange={(e) => set({ crewMax: e.target.value })} /></label>
              <label className="crew-field"><span>Hours from</span><input type="time" className="crew-input" value={form.hoursFrom} onChange={(e) => set({ hoursFrom: e.target.value })} /></label>
              <label className="crew-field"><span>Hours to</span><input type="time" className="crew-input" value={form.hoursTo} onChange={(e) => set({ hoursTo: e.target.value })} /></label>
            </div>
            {FEATURE_GROUPS.map((g) => (
              <div key={g.label} className="crew-field">
                <span>{g.label}</span>
                <div className="loc-checks">
                  {g.items.map(([k, label]) => (
                    <label key={k} className="crew-check"><input type="checkbox" checked={form.features.includes(k)} onChange={() => toggleFeature(k)} /><span>{label}</span></label>
                  ))}
                </div>
              </div>
            ))}
            <div className="crew-row2">
              <label className="crew-field"><span>Windows face</span><input type="text" className="crew-input" value={form.windowsFace} onChange={(e) => set({ windowsFace: e.target.value })} placeholder="West (afternoon sun)" maxLength={80} /></label>
              <label className="crew-field"><span>Best light</span><input type="text" className="crew-input" value={form.bestLight} onChange={(e) => set({ bestLight: e.target.value })} placeholder="3–6 pm" maxLength={80} /></label>
            </div>
            <div className="crew-row2">
              <label className="crew-field"><span>Power</span><input type="text" className="crew-input" value={form.power} onChange={(e) => set({ power: e.target.value })} placeholder="Household 20A circuits · no tie-in" maxLength={120} /></label>
              <label className="crew-field"><span>Sound</span><input type="text" className="crew-input" value={form.sound} onChange={(e) => set({ sound: e.target.value })} placeholder="Quiet street · no flight path" maxLength={120} /></label>
            </div>
          </section>

          <section className="crew-panel" id="rates">
            <h3>Rates<i className="req-dot" aria-hidden="true" /> <small>hourly, a day rate, or open to deals — at least one</small></h3>
            <div className="crew-row2">
              <label className="crew-field"><span>Hourly ($)</span><input type="number" className="crew-input" min="0" step="1" value={form.hourly} onChange={(e) => set({ hourly: e.target.value })} placeholder="85" /></label>
              <label className="crew-field"><span>Minimum hours</span><input type="number" className="crew-input" min="1" max="24" value={form.minHours} onChange={(e) => set({ minHours: e.target.value })} /></label>
            </div>
            <div className="crew-row2">
              <label className="crew-field"><span>Full day ($)</span><input type="number" className="crew-input" min="0" step="1" value={form.day} onChange={(e) => set({ day: e.target.value })} placeholder="600" /></label>
              <label className="crew-field"><span>A day is (hours)</span><input type="number" className="crew-input" min="4" max="24" value={form.dayHours} onChange={(e) => set({ dayHours: e.target.value })} /></label>
            </div>
            <div className="loc-row4">
              <label className="crew-field"><span>Half day ($)</span><input type="number" className="crew-input" min="0" step="1" value={form.halfDay} onChange={(e) => set({ halfDay: e.target.value })} placeholder="380" /></label>
              <label className="crew-field"><span>Overtime ($/hr)</span><input type="number" className="crew-input" min="0" step="1" value={form.overtime} onChange={(e) => set({ overtime: e.target.value })} placeholder="120" /></label>
              <label className="crew-field"><span>Cleaning fee ($)</span><input type="number" className="crew-input" min="0" step="1" value={form.cleaning} onChange={(e) => set({ cleaning: e.target.value })} placeholder="75" /></label>
              <label className="crew-field"><span>Weekend / night (+%)</span><input type="number" className="crew-input" min="0" max="100" value={form.weekendPct} onChange={(e) => set({ weekendPct: e.target.value })} /></label>
            </div>
            <label className="crew-check"><input type="checkbox" checked={form.dealsOk} onChange={(e) => set({ dealsOk: e.target.checked })} /><span>Open to deals — producers can send their own number (students, no-budget shorts). With no rates set, every request is an offer.</span></label>
            {preview ? (
              <div className="loc-money">A 10-hour Saturday ({preview.how}{Number(form.weekendPct) ? `, +${form.weekendPct}% weekend` : ''}) shows producers <b>{dollars(preview.bookingCents)}</b>{preview.cleaningCents ? ` including ${dollars(preview.cleaningCents)} cleaning` : ''}, plus the card fee. You receive <b>{dollars(preview.hostPayoutCents)}</b> after {SITE_NAME}’s {DEFAULT_CUT_PERCENT}% cut.</div>
            ) : (
              <div className="loc-money">No rates: every request will be an offer you accept, counter or decline. {SITE_NAME} keeps {DEFAULT_CUT_PERCENT}% of whatever you agree.</div>
            )}
          </section>

          <section className="crew-panel" id="rules">
            <h3>Rules</h3>
            <div className="crew-field"><span>Cancellation</span>
              <div className="loc-radios">
                {Object.entries(CANCELLATION).map(([k, v]) => (
                  <label key={k} className={`loc-radio${form.cancellation === k ? ' on' : ''}`}><input type="radio" name="cancellation" checked={form.cancellation === k} onChange={() => set({ cancellation: k })} /><b>{v.label}</b><span>{v.text}</span></label>
                ))}
              </div>
            </div>
            <label className="crew-field"><span>House rules</span><textarea className="crew-input" rows={4} value={form.rules} onChange={(e) => set({ rules: e.target.value })} placeholder="Shoes off on the terrazzo. Quiet outside after 9pm. Nothing taped to the wood. Generator in the driveway only." maxLength={2000} /></label>
          </section>

          <section className="crew-panel" id="permits">
            <h3>Permits &amp; insurance</h3>
            <label className="crew-field"><span>Film permit</span>
              <select className="crew-select" value={form.permitHelp} onChange={(e) => set({ permitHelp: e.target.value })}>{Object.entries(PERMIT_HELP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="crew-check"><input type="checkbox" checked={form.coiRequired} onChange={(e) => set({ coiRequired: e.target.checked })} /><span>Crews must carry a certificate of insurance (COI) naming me</span></label>
          </section>

          <section className="crew-panel" id="proof">
            <h3>Who you are to this place<i className="req-dot" aria-hidden="true" /> <small>checked by an admin before it’s public</small></h3>
            <div className="loc-radios">
              {Object.entries(OWNERSHIP).map(([k, v]) => (
                <label key={k} className={`loc-radio${form.ownership === k ? ' on' : ''}`}><input type="radio" name="ownership" checked={form.ownership === k} onChange={() => set({ ownership: k })} /><b>{v}</b></label>
              ))}
            </div>
            <div className="crew-row2">
              <div className="crew-field"><span>Proof (a photo or scan)</span>
                <div className="loc-proof">
                  {form.proofUrl && (proofIsPdf ? <a href={form.proofUrl} target="_blank" rel="noreferrer" className="crew-btn sm">Open the file ↗</a> : <img src={form.proofUrl} alt="Proof" />)}
                  <label className="crew-btn sm"><input type="file" accept="image/*" style={{ display: 'none' }} onChange={addProof} disabled={uploading} />{form.proofUrl ? 'Replace' : uploading ? 'Uploading…' : 'Upload proof'}</label>
                  {form.proofUrl && <button type="button" className="crew-btn sm ghost" onClick={() => set({ proofUrl: null })}>Remove</button>}
                </div>
                <span className="crew-mono">A deed or tax bill, a lease, a utility bill in your name, or a letter from the owner. Only admins see it; it’s never shown on the site.</span>
              </div>
              <label className="crew-field"><span>Anything the reviewer should know</span><textarea className="crew-input" rows={3} value={form.proofNote} onChange={(e) => set({ proofNote: e.target.value })} placeholder="I manage the café for the owner; her letter is attached." maxLength={300} /></label>
            </div>
          </section>
        </div>

        <aside className="crew-aside">
          <section className="crew-panel crew-wc-side">
            <h3>How it works</h3>
            <ul className="cl-rules">
              <li>Admin checks the proof, then the place is public. The street address never is: only a paid booking sees it.</li>
              <li>A producer asks for dates at your rate or makes an offer. You have 48 hours to accept, counter or decline.</li>
              <li>They pay through the site to confirm; you get your share through Stripe, minus {DEFAULT_CUT_PERCENT}%.</li>
              <li>After the shoot you say how it went. Shoots that went as agreed build your record and the production’s “Shot here” credit.</li>
            </ul>
          </section>
          <section className="crew-panel crew-wc-side">
            <h3>Before you save</h3>
            <ul className="loc-checklist">
              <li className={form.title.trim().length >= 3 ? 'on' : ''}>A title</li>
              <li className={form.place ? 'on' : ''}>A neighbourhood or city</li>
              <li className={form.address.trim().length >= 5 ? 'on' : ''}>The street address</li>
              <li className={form.photos.length ? 'on' : ''}>At least one photo</li>
              <li className={form.hourly || form.day || form.dealsOk ? 'on' : ''}>A rate, or open to deals</li>
              <li className={form.proofUrl ? 'on' : ''}>Proof you can let a crew in (optional, but it’s what gets you approved)</li>
            </ul>
          </section>
          <div className="crew-savebar loc-savebar">
            <button type="submit" className="crew-btn primary" disabled={busy || uploading}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Submit for review'}</button>
            <Link href="/locations/mine" className="crew-btn ghost">Cancel</Link>
          </div>
        </aside>
      </form>
    </LocationShell>
  );
}
