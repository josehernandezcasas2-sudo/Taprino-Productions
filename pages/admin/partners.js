import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import PlaceSearch from '../../components/crew/PlaceSearch';
import { shrinkImage } from '../../components/locations/LocationBits';
import { adminPageProps } from '../../lib/adminPage';
import { PARTNER_KINDS, CODE_GATES, MAX_BLURB_CHARS, MAX_DEAL_CHARS, MAX_NOTE_CHARS } from '../../lib/partnerRules';

// Partners & resources (migration 108): the list behind /resources. Full
// admins add, edit, pause and remove partners; the deal, the code and its
// gate live here, and every partner shows how many people opened its code.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

const EMPTY = { id: null, name: '', kind: 'rental', blurb: '', url: '', place: null, ships: false, deal: '', code: '', codeGate: 'account', codeNote: '', contactName: '', contactEmail: '', status: 'listed', featured: false, sortOrder: 0, logoUrl: null };

function toForm(p) {
  return { id: p.id, name: p.name, kind: p.kind, blurb: p.blurb, url: p.url || '', place: p.place ? { ...p.place, lat: p.lat, lng: p.lng } : null, ships: p.ships, deal: p.deal, code: p.code || '', codeGate: p.codeGate, codeNote: p.codeNote, contactName: p.contactName || '', contactEmail: p.contactEmail || '', status: p.status, featured: p.featured, sortOrder: p.sortOrder || 0, logoUrl: p.logoUrl };
}

async function call(method, body) {
  const res = await fetch('/api/admin/partners', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export default function PartnersAdmin({ account, mainGenres }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null); // null = closed
  const [logo, setLogo] = useState(null); // { base64, fileName }
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function load() {
    try { setData(await call('GET')); setError(null); } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call('POST', { ...form, logoBase64: logo ? logo.base64 : null, fileName: logo ? logo.fileName : null });
      setForm(null);
      setLogo(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(p) {
    if (!window.confirm(`Remove ${p.name} from Resources?`)) return;
    setBusy(true);
    try { await call('DELETE', { id: p.id }); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function quick(p, patch) {
    setBusy(true);
    try { await call('POST', { ...toForm(p), ...patch }); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function pickLogo(file) {
    if (!file) return;
    try { setLogo({ base64: await shrinkImage(file, 600), fileName: `${file.name.replace(/\.[^.]+$/, '')}.jpg` }); } catch (err) { setError(err.message); }
  }

  return (
    <AdminShell title="Partners & resources" account={account} mainGenres={mainGenres} crumbs={['People']}>
      <div className="eyebrow">Admin</div>
      <h1>Partners & resources</h1>
      <p className="ca-sub">What shows on <Link href="/resources">/resources</Link>: rental houses, post, insurance, festivals, paperwork… with the deal each gives Studio Tapa productions and a code behind a gate. The count is how many people opened the code — what to show the partner.</p>
      {error && <div className="crew-status error" style={{ margin: '0.6rem 0' }}>{error}</div>}
      <div className="crew-actions" style={{ margin: '0.8rem 0' }}>
        <button type="button" className="crew-btn primary" onClick={() => { setForm(EMPTY); setLogo(null); }}>+ Add a partner</button>
        {data && !data.setup && <span className="crew-mono">Run migration 108 first — the tables aren’t there yet.</span>}
      </div>

      {form && (
        <form className="crew-panel cc-postform" onSubmit={save} style={{ marginBottom: '1rem' }}>
          <span className="crew-eyebrow">{form.id ? 'Edit partner' : 'New partner'}</span>
          <div className="crew-row2">
            <label className="crew-field"><span>Name</span><input type="text" className="crew-input" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} required /></label>
            <label className="crew-field"><span>Kind</span><select className="crew-select" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>{Object.entries(PARTNER_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <label className="crew-field"><span>Website</span><input type="text" className="crew-input" value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" /></label>
          <label className="crew-field"><span>Blurb</span><textarea className="crew-input" rows={3} value={form.blurb} onChange={(e) => set({ blurb: e.target.value })} maxLength={MAX_BLURB_CHARS} placeholder="What they do, who they’re good for." /></label>
          <div className="crew-row2">
            <div className="crew-field"><span>Where</span><PlaceSearch value={form.place} onChange={(p) => set({ place: p })} placeholder="City (leave empty for online-only)" /></div>
            <label className="crew-check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={form.ships} onChange={(e) => set({ ships: e.target.checked })} /><span>Ships / works remotely — shows up for everyone, however far</span></label>
          </div>
          <div className="crew-row2">
            <label className="crew-field"><span>The deal</span><input type="text" className="crew-input" value={form.deal} onChange={(e) => set({ deal: e.target.value })} maxLength={MAX_DEAL_CHARS} placeholder="15% off rentals for Studio Tapa productions" /></label>
            <label className="crew-field"><span>Code</span><input type="text" className="crew-input" value={form.code} onChange={(e) => set({ code: e.target.value })} maxLength={60} placeholder="TAPA15" /></label>
          </div>
          <div className="crew-row2">
            <label className="crew-field"><span>Who sees the code</span><select className="crew-select" value={form.codeGate} onChange={(e) => set({ codeGate: e.target.value })}>{Object.entries(CODE_GATES).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}</select></label>
            <label className="crew-field"><span>How to use it</span><input type="text" className="crew-input" value={form.codeNote} onChange={(e) => set({ codeNote: e.target.value })} maxLength={MAX_NOTE_CHARS} placeholder="At checkout, or mention it when you book" /></label>
          </div>
          <div className="crew-row2">
            <label className="crew-field"><span>Contact (admin only)</span><input type="text" className="crew-input" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} maxLength={80} /></label>
            <label className="crew-field"><span>Contact email (admin only)</span><input type="email" className="crew-input" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} maxLength={120} /></label>
          </div>
          <div className="crew-row2">
            <div className="crew-field"><span>Logo</span>
              <div className="crew-actions">
                {(logo || form.logoUrl) && <img src={logo ? logo.base64 : form.logoUrl} alt="" className="res-logo" />}
                <input type="file" accept="image/*" onChange={(e) => pickLogo(e.target.files[0])} />
                {(logo || form.logoUrl) && <button type="button" className="crew-btn sm ghost" onClick={() => { setLogo(null); set({ logoUrl: null }); }}>Remove</button>}
              </div>
            </div>
            <div className="crew-row2">
              <label className="crew-field"><span>Status</span><select className="crew-select" value={form.status} onChange={(e) => set({ status: e.target.value })}><option value="listed">Listed</option><option value="paused">Paused</option><option value="draft">Draft</option></select></label>
              <label className="crew-field"><span>Order</span><input type="number" className="crew-input" min="0" max="999" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} /></label>
            </div>
          </div>
          <label className="crew-check"><input type="checkbox" checked={form.featured} onChange={(e) => set({ featured: e.target.checked })} /><span>Featured — pinned to the top</span></label>
          <div className="crew-actions">
            <button type="submit" className="crew-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="crew-btn ghost" onClick={() => { setForm(null); setLogo(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {!data && !error && <div className="crew-mono">Loading…</div>}
      {data && data.partners.length === 0 && <div className="crew-panel crew-empty">No partners yet.</div>}
      {data && data.partners.length > 0 && (
        <div className="crew-results">
          {data.partners.map((p) => (
            <div key={p.id} className="crew-panel crew-rhead res-admin-row">
              <span className="res-admin-main">
                {p.logoUrl ? <img src={p.logoUrl} alt="" className="res-logo sm" /> : <span className="res-logo res-logo-ph sm">{p.name.slice(0, 2).toUpperCase()}</span>}
                <span>
                  <b>{p.name}</b> <span className="crew-chip">{p.kindLabel}</span> {p.featured && <span className="crew-chip pink">featured</span>} {p.status !== 'listed' && <span className="crew-chip mute">{p.status}</span>}
                  <br /><span className="crew-mono">{p.deal || 'no deal written'}{p.code ? ` · code ${p.code} · ${p.gateLabel}` : ' · no code'}{p.place ? ` · ${p.place.label}` : ''}{p.ships ? ' · ships' : ''} · {p.redemptions} {p.redemptions === 1 ? 'reveal' : 'reveals'}</span>
                </span>
              </span>
              <span className="crew-actions">
                <button type="button" className="crew-btn sm" disabled={busy} onClick={() => { setForm(toForm(p)); setLogo(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
                <button type="button" className="crew-btn sm" disabled={busy} onClick={() => quick(p, { status: p.status === 'listed' ? 'paused' : 'listed' })}>{p.status === 'listed' ? 'Pause' : 'List'}</button>
                <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => remove(p)}>Remove</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
