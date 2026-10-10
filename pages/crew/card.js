import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import PlaceSearch from '../../components/crew/PlaceSearch';
import { Avatar, GearRows, CreditRows } from '../../components/crew/CrewBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getOwnCard } from '../../lib/crewCards';
import { getCreditedWork, getPublicProfile, placeholderProfile, profilePath } from '../../lib/userProfiles';
import { CREW_ROLES, GEAR_CATEGORIES, GEAR_FLAGS, MAX_ROLES, MAX_TRAVEL_MILES, DEFAULT_TRAVEL_MILES, MAX_GEAR_ITEMS, MAX_CREDITS, MAX_LANGUAGES } from '../../lib/crewOptions';
import { SITE } from '../../lib/siteConfig';

// Your Crew Call working card: roles, where you're based and how far
// you'll go, whether you're free, gear, outside credits, rate. Saves as
// one piece through POST /api/crew/card. Released titles on Studio Tapa
// are credits automatically and show read-only here.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let card = null;
  let creditedWork = [];
  let profile = null;
  let loadError = null;
  if (account.isSignedIn) {
    try {
      [card, creditedWork, profile] = await Promise.all([
        getOwnCard(account.userId),
        getCreditedWork(account.userId),
        getPublicProfile(account.userId)
      ]);
    } catch (err) {
      console.error('crew card page:', err.message);
      loadError = err.message;
    }
    if (!profile) profile = placeholderProfile(account.userId);
  }
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      card,
      creditedWork,
      profile,
      loadError
    }
  };
}

const EMPTY = {
  roles: [], place: null, travelMiles: DEFAULT_TRAVEL_MILES, remoteOk: false, availability: 'open', bookedUntil: '',
  rateMin: '', rateMax: '', languages: [], listed: true, gear: [], credits: []
};

function fromCard(card) {
  if (!card) return EMPTY;
  return {
    roles: card.roles,
    place: card.place,
    travelMiles: card.travelMiles,
    remoteOk: card.remoteOk,
    availability: card.availability,
    bookedUntil: card.bookedUntil || '',
    rateMin: card.rateMin == null ? '' : String(card.rateMin),
    rateMax: card.rateMax == null ? '' : String(card.rateMax),
    languages: card.languages,
    listed: card.listed,
    gear: card.gear.map((g) => ({ category: g.category, name: g.name, flag: g.flag })),
    credits: card.credits.map((c) => ({ title: c.title, role: c.role || '', year: c.year || '' }))
  };
}

export default function CrewCardPage({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, card: initialCard, creditedWork, profile, loadError }) {
  const [form, setForm] = useState(() => fromCard(initialCard));
  const [saved, setSaved] = useState(initialCard);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(loadError ? { kind: 'error', text: loadError } : null);
  const [lang, setLang] = useState('');
  const [gearDraft, setGearDraft] = useState({ category: GEAR_CATEGORIES[0], name: '', flag: 'brings' });
  const [creditDraft, setCreditDraft] = useState({ title: '', role: '', year: '' });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(fromCard(saved));

  function toggleRole(r) {
    setForm((f) => {
      if (f.roles.includes(r)) return { ...f, roles: f.roles.filter((x) => x !== r) };
      if (f.roles.length >= MAX_ROLES) { setStatus({ kind: 'error', text: `Up to ${MAX_ROLES} roles — drop one to add another.` }); return f; }
      return { ...f, roles: [...f.roles, r] };
    });
  }
  function addLanguage() {
    const parts = lang.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setForm((f) => ({ ...f, languages: [...new Set([...f.languages, ...parts])].slice(0, MAX_LANGUAGES) }));
    setLang('');
  }
  function addGear() {
    const name = gearDraft.name.trim();
    if (!name) return;
    if (form.gear.length >= MAX_GEAR_ITEMS) { setStatus({ kind: 'error', text: `Up to ${MAX_GEAR_ITEMS} gear items.` }); return; }
    set({ gear: [...form.gear, { category: gearDraft.category, name, flag: gearDraft.flag }] });
    setGearDraft((d) => ({ ...d, name: '' }));
  }
  function addCredit() {
    const title = creditDraft.title.trim();
    if (!title) return;
    if (form.credits.length >= MAX_CREDITS) { setStatus({ kind: 'error', text: `Up to ${MAX_CREDITS} outside credits.` }); return; }
    set({ credits: [...form.credits, { title, role: creditDraft.role.trim(), year: creditDraft.year }] });
    setCreditDraft({ title: '', role: '', year: '' });
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/crew/card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your card.');
      setSaved(data.card);
      setForm(fromCard(data.card));
      setStatus({ kind: 'ok', text: data.card.listed && (data.card.roles.length || data.card.gear.length) ? 'Saved — you’re on Crew Call.' : 'Saved.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Remove your working card? Your profile and credits stay; only the card goes.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/crew/card', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove the card.');
      setSaved(null);
      setForm(EMPTY);
      setStatus({ kind: 'ok', text: 'Card removed.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const onEnter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

  return (
    <>
      <Head>
        <title>Your working card — Crew Call — {SITE.name}</title>
        <meta name="description" content="Set up your Crew Call working card: roles, gear, where you're based, availability." />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="stage stage-single crew-page">
        <div className="crew-crumbs"><Link href="/crew">Crew Call</Link><span>/</span><span>Your card</span></div>

        {!isSignedIn ? (
          <div className="crew-panel crew-signin">
            <span className="crew-eyebrow">Connect · Crew Call</span>
            <h1>Your working card</h1>
            <p>Everyone with an account gets one: what you do, what gear you have, where you’re based and how far you’ll go, whether you’re free. People find you by role, gear and distance.</p>
            <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in or create an account</button></SignInButton>
          </div>
        ) : (
          <>
            <div className="crew-hero">
              <Avatar userId={profile.userId} name={profile.displayName} src={profile.avatarUrl} size="lg" />
              <div style={{ minWidth: 0 }}>
                <div className="crew-pname crew-pname-lg">{profile.displayName}{isCreator && <span className="crew-ver">✓ creator</span>}</div>
                <div className="crew-handle">{profile.handle ? `@${profile.handle} · ` : ''}{creditedWork.length} released {creditedWork.length === 1 ? 'title' : 'titles'} on Studio Tapa</div>
                {profile.bio ? <p className="crew-muted crew-bio">{profile.bio}</p> : <p className="crew-muted crew-bio">Your name, photo and bio come from <Link href="/account">account settings</Link>.</p>}
              </div>
              <div className="crew-actions">
                <Link href={profilePath(profile)} className="crew-btn">View profile</Link>
                <Link href="/crew" className="crew-btn ghost">Back to Crew Call</Link>
              </div>
            </div>

            <div className="crew-card-grid">
              <div className="crew-wc">
                <section className="crew-panel">
                  <h3>Roles <small>pick up to {MAX_ROLES}</small></h3>
                  <div className="crew-rolepick">
                    {CREW_ROLES.map((r) => (
                      <button key={r} type="button" aria-pressed={form.roles.includes(r)} onClick={() => toggleRole(r)}>{r}</button>
                    ))}
                  </div>
                </section>

                <section className="crew-panel">
                  <h3>Where</h3>
                  <div className="crew-row2">
                    <div className="crew-field">
                      <span>Based in</span>
                      <PlaceSearch value={form.place} onChange={(p) => set({ place: p })} placeholder="City or neighborhood" id="crew-place" />
                    </div>
                    <label className="crew-field">
                      <span>Will travel (miles)</span>
                      <input type="number" className="crew-input" min="0" max={MAX_TRAVEL_MILES} value={form.travelMiles} onChange={(e) => set({ travelMiles: e.target.value })} />
                    </label>
                  </div>
                  <label className="crew-check">
                    <input type="checkbox" checked={form.remoteOk} onChange={(e) => set({ remoteOk: e.target.checked })} />
                    <span>I also work remotely (editing, color, sound, VFX…)</span>
                  </label>
                  <span className="crew-mono">Only the place name shows on your card. The distance filter measures from it; your exact point never leaves the server.</span>
                </section>

                <section className="crew-panel">
                  <h3>Availability</h3>
                  <div className="crew-row2">
                    <div className="crew-toggle" role="group" aria-label="Availability">
                      <button type="button" aria-pressed={form.availability === 'open'} onClick={() => set({ availability: 'open' })}>● Open to work</button>
                      <button type="button" aria-pressed={form.availability === 'booked'} onClick={() => set({ availability: 'booked' })}>Booked</button>
                    </div>
                    {form.availability === 'booked' && (
                      <label className="crew-field">
                        <span>Booked until</span>
                        <input type="date" className="crew-input" value={form.bookedUntil} onChange={(e) => set({ bookedUntil: e.target.value })} />
                      </label>
                    )}
                  </div>
                </section>

                <section className="crew-panel">
                  <h3>Gear <small>what you have — brings it, lends it, or ask</small></h3>
                  <GearRows gear={form.gear} onRemove={(i) => set({ gear: form.gear.filter((_, j) => j !== i) })} />
                  <div className="crew-addgear">
                    <label className="crew-field"><span>Category</span>
                      <select className="crew-select" value={gearDraft.category} onChange={(e) => setGearDraft((d) => ({ ...d, category: e.target.value }))}>
                        {GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <label className="crew-field"><span>What it is</span>
                      <input type="text" className="crew-input" maxLength={80} placeholder="Aputure 600d Pro" value={gearDraft.name} onChange={(e) => setGearDraft((d) => ({ ...d, name: e.target.value }))} onKeyDown={onEnter(addGear)} />
                    </label>
                    <label className="crew-field"><span>On a shoot</span>
                      <select className="crew-select" value={gearDraft.flag} onChange={(e) => setGearDraft((d) => ({ ...d, flag: e.target.value }))}>
                        {Object.entries(GEAR_FLAGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <button type="button" className="crew-btn" onClick={addGear}>Add</button>
                  </div>
                </section>

                <section className="crew-panel">
                  <h3>Credits</h3>
                  <CreditRows auto={creditedWork} manual={form.credits} onRemove={(i) => set({ credits: form.credits.filter((_, j) => j !== i) })} />
                  <div className="crew-addcredit">
                    <label className="crew-field"><span>Outside credit</span>
                      <input type="text" className="crew-input" maxLength={120} placeholder="Harbor Credit Union spot" value={creditDraft.title} onChange={(e) => setCreditDraft((d) => ({ ...d, title: e.target.value }))} onKeyDown={onEnter(addCredit)} />
                    </label>
                    <label className="crew-field"><span>Role</span>
                      <input type="text" className="crew-input" maxLength={40} list="crew-role-list" placeholder="DP" value={creditDraft.role} onChange={(e) => setCreditDraft((d) => ({ ...d, role: e.target.value }))} onKeyDown={onEnter(addCredit)} />
                    </label>
                    <label className="crew-field"><span>Year</span>
                      <input type="number" className="crew-input" min="1900" max={new Date().getFullYear() + 1} placeholder="2024" value={creditDraft.year} onChange={(e) => setCreditDraft((d) => ({ ...d, year: e.target.value }))} onKeyDown={onEnter(addCredit)} />
                    </label>
                    <button type="button" className="crew-btn" onClick={addCredit}>Add credit</button>
                  </div>
                  <datalist id="crew-role-list">{CREW_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
                  <span className="crew-mono">Released titles on Studio Tapa are credits automatically; outside work you add yourself.</span>
                </section>
              </div>

              <aside className="crew-aside">
                <section className="crew-panel crew-wc-side">
                  <h3>Day rate <small>optional</small></h3>
                  <div className="crew-row2">
                    <label className="crew-field"><span>From ($)</span><input type="number" className="crew-input" min="0" value={form.rateMin} onChange={(e) => set({ rateMin: e.target.value })} /></label>
                    <label className="crew-field"><span>To ($)</span><input type="number" className="crew-input" min="0" value={form.rateMax} onChange={(e) => set({ rateMax: e.target.value })} /></label>
                  </div>
                  <span className="crew-mono">Shown to signed-in people only.</span>
                </section>
                <section className="crew-panel crew-wc-side">
                  <h3>Languages</h3>
                  <div className="crew-chips">
                    {form.languages.map((l) => (
                      <span key={l} className="crew-chip">{l} <button type="button" className="crew-chip-x" onClick={() => set({ languages: form.languages.filter((x) => x !== l) })} aria-label={`Remove ${l}`}>✕</button></span>
                    ))}
                  </div>
                  <div className="crew-place-row">
                    <input type="text" className="crew-input" placeholder="English, Spanish" value={lang} onChange={(e) => setLang(e.target.value)} onKeyDown={onEnter(addLanguage)} aria-label="Add a language" />
                    <button type="button" className="crew-btn sm" onClick={addLanguage}>Add</button>
                  </div>
                </section>
                <section className="crew-panel crew-wc-side">
                  <h3>Listing</h3>
                  <label className="crew-check">
                    <input type="checkbox" checked={form.listed} onChange={(e) => set({ listed: e.target.checked })} />
                    <span>Show my card in the Crew Call directory</span>
                  </label>
                  <span className="crew-mono">Off keeps the card on your profile only. A card needs at least one role or gear item to be listed.</span>
                </section>
              </aside>
            </div>

            <div className="crew-savebar">
              <button type="button" className="crew-btn primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : saved ? 'Save changes' : 'Save card'}</button>
              {status && <span className={`crew-status ${status.kind}`} role="status">{status.text}</span>}
              {!status && dirty && <span className="crew-mono">Unsaved changes</span>}
              {saved && <button type="button" className="crew-btn ghost sm crew-remove" onClick={remove} disabled={busy}>Remove card</button>}
            </div>
          </>
        )}
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}
