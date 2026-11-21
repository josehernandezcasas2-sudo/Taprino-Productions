import Link from 'next/link';
import { useEffect, useState } from 'react';
import ProductionShell, { shellProps } from '../../../components/productions/ProductionShell';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getDistribution } from '../../../lib/distribution';
import { FESTIVAL_STATUS } from '../../../lib/distributionRules';
import { SCREENING_WORDS, screeningText, screeningsList } from '../../../lib/screeningRules';
import { EndedCard, OpenCard } from '../../../components/creator/screenings/ScreeningsTab';
import { webText } from '../../../components/creator/screenings/ScreeningBits';

// A production's distribution page (migration 109), for its owner: the
// checklist that reads the rest of the site, the festival tracker, the
// premiere / press kit / trailer, partners who distribute, and the private
// screenings. Since migration 128 (2026-11-21) screening links are made on
// the title's own page (its Private screenings tab): the card here lists
// the released title's links and the production's older screeners,
// read-only with where each stands, Open › for the ones the viewer runs,
// and a way to the tab (getDistribution's `screenings: { links, href,
// canManage }`).
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let data = null;
  let problem = null;
  if (!account.isSignedIn) problem = 'Sign in to see this page.';
  else {
    try {
      data = await getDistribution(String(params.id), { viewerId: account.userId, isAdmin: account.isAdmin });
    } catch (err) {
      if (err.status) problem = err.message; else throw err;
    }
  }
  return { props: { ...shellProps(account, episodes), data: data ? JSON.parse(JSON.stringify(data)) : null, problem, productionId: String(params.id) } };
}

const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const dollars = (c) => (c == null ? '' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`);

export default function DistributionPage(props) {
  const { data: initial, problem, productionId } = props;
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  useEffect(() => { setData(initial); }, [initial]);
  // "2 live": a link's state follows the clock, so it is worked out once
  // the page is in the browser.
  const links = data && data.screenings && Array.isArray(data.screenings.links) ? data.screenings.links : null;
  const [liveBadge, setLiveBadge] = useState('');
  useEffect(() => { setLiveBadge(links ? screeningsList(links, Date.now()).tabBadge : ''); }, [links]);

  async function api(url, body, method = 'PATCH') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Something went wrong.');
      if (json.production && json.checklist) setData(json);
      return json;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (problem || !data) {
    return (
      <ProductionShell title="Distribution" {...props}>
        <div className="crew-crumbs"><Link href="/productions">Productions</Link><span>/</span><Link href={`/productions/${productionId}`}>Production</Link><span>/</span><span>Distribution</span></div>
        <div className="crew-panel crew-empty">{problem || 'Not available.'}<br /><Link href={`/productions/${productionId}`} className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to the production</Link></div>
      </ProductionShell>
    );
  }

  const { production: p, release, festivals, checklist: c, partners } = data;
  const screenings = data.screenings || { links: [], href: null, canManage: false };

  return (
    <ProductionShell title={`${p.title} · Distribution`} {...props}>
      <div className="crew-crumbs"><Link href="/productions">Productions</Link><span>/</span><Link href={`/productions/${p.id}`}>{p.title}</Link><span>/</span><span>Distribution</span></div>
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Distribution</span>
          <h1>{p.title}</h1>
          <p>Where it goes after the cut: Studio Tapa, Buy to own, early screenings, festivals, press — and private screenings for the people who decide.</p>
        </div>
        <Link href={`/productions/${p.id}`} className="crew-btn">Back to the production</Link>
      </div>
      {note && <div className="crew-status ok" role="status">{note}</div>}
      {error && <div className="crew-status error" role="alert">{error}</div>}

      <div className="prod-grid2">
        <div className="prod-col">
          {/* ---- checklist ---- */}
          <section className="crew-panel prod-section">
            <h2 className="cc-h2">The release plan</h2>
            <ul className="dist-check">
              <li className={c.released ? 'on' : ''}><b>On Studio Tapa</b><span>{release ? <>Released as <Link href={release.href}>{release.title}</Link>.</> : <>Upload the finished title, then link it on <Link href={`/productions/${p.id}`}>the production page</Link>; the crew’s credits go live with it.</>}</span></li>
              <li className={c.buyToOwn ? 'on' : ''}><b>Buy to own</b><span>{c.buyToOwn ? 'Priced — people can buy it outright.' : release ? <>Set a price from <Link href="/creator/my-work">My Work</Link> so people can own it.</> : 'Opens once the title is released.'}</span></li>
              <li className={c.earlyScreening ? 'on' : ''}><b>Early screening</b><span>{c.earlyScreening ? `Premium members see it first, from ${new Date(c.earlyAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}.` : release ? 'A future release date on the title gives Premium members the first day.' : 'Set a release date on the title when you upload it.'}</span></li>
              <li className={c.festivalsSubmitted ? 'on' : ''}><b>Festivals</b><span>{festivals.length ? `${c.festivalsSubmitted} submitted · ${c.festivalsIn} in` : 'Nothing on the tracker yet.'}</span></li>
              <li className={c.trailer ? 'on' : ''}><b>Trailer</b><span>{c.trailer ? <a href={data.trailerUrl} target="_blank" rel="noopener noreferrer">Linked ↗</a> : 'Add a trailer link below.'}</span></li>
              <li className={c.pressKit ? 'on' : ''}><b>Press kit</b><span>{c.pressKit ? <a href={data.pressKitUrl} target="_blank" rel="noopener noreferrer">Linked ↗</a> : 'Stills, logline, bios, poster — one folder link.'}</span></li>
              <li className={c.shotHere ? 'on' : ''}><b>Shot here</b><span>{c.shotHere ? `${c.shotHere} ${c.shotHere === 1 ? 'place credits' : 'places credit'} the title.` : 'Credit the places you shot at from their listings; the hosts confirm.'}</span></li>
              <li className={liveBadge ? 'on' : ''}><b>{SCREENING_WORDS.tab}</b><span>{liveBadge ? `${liveBadge}.` : screenings.href && screenings.canManage ? <Link href={screenings.href}>{SCREENING_WORDS.distributionLine}</Link> : SCREENING_WORDS.distributionLine}</span></li>
            </ul>
          </section>

          {/* ---- premiere / links / notes ---- */}
          <Details data={data} busy={busy} onSave={(patch) => api(`/api/productions/${p.id}/distribution`, patch).then((r) => r && setNote('Saved.'))} />

          {/* ---- partners ---- */}
          <section className="crew-panel prod-section">
            <div className="crew-rhead"><h2 className="cc-h2">Festivals & distributors who know Studio Tapa</h2><Link href="/resources?kind=festival" className="crew-mono">all resources ›</Link></div>
            {partners.length === 0 && <p className="crew-muted" style={{ margin: 0 }}>None listed yet. <Link href="/resources">Resources</Link> is where they’ll show up.</p>}
            {partners.map((x) => (
              <div key={x.id} className="dist-partner">
                <span><b>{x.name}</b> <span className="crew-chip">{x.kindLabel}</span>{x.deal && <span className="crew-mono"> · {x.deal}</span>}</span>
                {x.url && <a href={x.url} target="_blank" rel="noopener noreferrer" className="crew-btn sm">Open ↗</a>}
              </div>
            ))}
          </section>
        </div>

        <div className="prod-col">
          {/* ---- festival tracker ---- */}
          <Festivals festivals={festivals} busy={busy} onSave={(list) => api(`/api/productions/${p.id}/distribution`, { festivals: list })} />

          {/* ---- private screenings (read-only; made on the title's own page) ---- */}
          <PrivateScreenings screenings={screenings} release={release} canReach={Boolean(props.isCreator || props.isAdmin)} />
        </div>
      </div>
    </ProductionShell>
  );
}

function Details({ data, busy, onSave }) {
  const [form, setForm] = useState({ premiereOn: data.premiereOn || '', premiereNote: data.premiereNote || '', trailerUrl: data.trailerUrl || '', pressKitUrl: data.pressKitUrl || '', notes: data.notes || '' });
  useEffect(() => { setForm({ premiereOn: data.premiereOn || '', premiereNote: data.premiereNote || '', trailerUrl: data.trailerUrl || '', pressKitUrl: data.pressKitUrl || '', notes: data.notes || '' }); }, [data]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form className="crew-panel prod-section" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <h2 className="cc-h2">Premiere, trailer, press kit</h2>
      <div className="crew-row2">
        <label className="crew-field"><span>Premiere</span><input type="date" className="crew-input" value={form.premiereOn} onChange={(e) => set({ premiereOn: e.target.value })} /></label>
        <label className="crew-field"><span>Where</span><input type="text" className="crew-input" value={form.premiereNote} onChange={(e) => set({ premiereNote: e.target.value })} placeholder="Los Feliz 3, 7pm — or “online, on Studio Tapa”" maxLength={200} /></label>
      </div>
      <label className="crew-field"><span>Trailer link</span><input type="text" className="crew-input" value={form.trailerUrl} onChange={(e) => set({ trailerUrl: e.target.value })} placeholder="https://" /></label>
      <label className="crew-field"><span>Press kit link</span><input type="text" className="crew-input" value={form.pressKitUrl} onChange={(e) => set({ pressKitUrl: e.target.value })} placeholder="A Drive / Dropbox folder with stills, poster, bios, logline" /></label>
      <label className="crew-field"><span>Notes to self</span><textarea className="crew-input" rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Who you’ve talked to, what’s promised, what’s next." maxLength={4000} /></label>
      <div className="crew-actions"><button type="submit" className="crew-btn sm primary" disabled={busy}>Save</button></div>
    </form>
  );
}

function Festivals({ festivals, busy, onSave }) {
  const [draft, setDraft] = useState({ name: '', url: '', deadline: '', feeCents: '', status: 'planning', notes: '' });
  const [editing, setEditing] = useState(null); // id
  const upcoming = [...festivals].sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));

  function add(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    onSave([...festivals, { ...draft, feeCents: draft.feeCents === '' ? null : Math.round(Number(draft.feeCents) * 100) }]).then(() => setDraft({ name: '', url: '', deadline: '', feeCents: '', status: 'planning', notes: '' }));
  }
  function patch(id, changes) {
    onSave(festivals.map((f) => (f.id === id ? { ...f, ...changes } : f)));
  }
  function remove(id) {
    if (window.confirm('Take this festival off the tracker?')) onSave(festivals.filter((f) => f.id !== id));
  }

  return (
    <section className="crew-panel prod-section">
      <div className="crew-rhead"><h2 className="cc-h2">Festival tracker · {festivals.length}</h2><span className="crew-mono">deadlines first</span></div>
      {festivals.length === 0 && <p className="crew-muted" style={{ margin: 0 }}>Nothing yet. Add the festivals you’re aiming at, with deadlines and fees, and mark what comes back.</p>}
      <div className="dist-fests">
        {upcoming.map((f) => (
          <div key={f.id} className={`dist-fest s-${f.status}`}>
            <div className="dist-fest-main">
              <div className="dist-fest-name">{f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer">{f.name} ↗</a> : f.name}</div>
              <div className="crew-mono">{f.deadline ? `deadline ${fmtDate(f.deadline)}` : 'no deadline'}{f.feeCents != null ? ` · fee ${dollars(f.feeCents)}` : ''}{f.decidedOn ? ` · heard ${fmtDate(f.decidedOn)}` : ''}</div>
              {f.notes && <div className="crew-muted" style={{ fontSize: '0.82rem' }}>{f.notes}</div>}
            </div>
            <div className="dist-fest-acts">
              <select className="crew-select" value={f.status} disabled={busy} onChange={(e) => patch(f.id, { status: e.target.value, decidedOn: ['accepted', 'declined'].includes(e.target.value) && !f.decidedOn ? new Date().toISOString().slice(0, 10) : f.decidedOn })} aria-label="Status">
                {Object.entries(FESTIVAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => setEditing(editing === f.id ? null : f.id)}>{editing === f.id ? 'Done' : 'Edit'}</button>
              <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => remove(f.id)}>✕</button>
            </div>
            {editing === f.id && (
              <div className="dist-fest-edit">
                <input type="text" className="crew-input" defaultValue={f.name} onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && patch(f.id, { name: e.target.value })} aria-label="Name" />
                <input type="date" className="crew-input" defaultValue={f.deadline || ''} onBlur={(e) => e.target.value !== (f.deadline || '') && patch(f.id, { deadline: e.target.value })} aria-label="Deadline" />
                <input type="number" className="crew-input" placeholder="Fee $" defaultValue={f.feeCents == null ? '' : f.feeCents / 100} onBlur={(e) => patch(f.id, { feeCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} aria-label="Fee" />
                <input type="text" className="crew-input" placeholder="Link" defaultValue={f.url || ''} onBlur={(e) => e.target.value !== (f.url || '') && patch(f.id, { url: e.target.value })} aria-label="Link" />
                <input type="text" className="crew-input" placeholder="Notes" defaultValue={f.notes || ''} onBlur={(e) => e.target.value !== (f.notes || '') && patch(f.id, { notes: e.target.value })} aria-label="Notes" maxLength={400} />
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="prod-add" onSubmit={add}>
        <div className="crew-row2">
          <label className="crew-field"><span>Festival</span><input type="text" className="crew-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Slamdance" maxLength={100} /></label>
          <label className="crew-field"><span>Deadline</span><input type="date" className="crew-input" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} /></label>
        </div>
        <div className="crew-row2">
          <label className="crew-field"><span>Fee ($)</span><input type="number" className="crew-input" min="0" value={draft.feeCents} onChange={(e) => setDraft({ ...draft, feeCents: e.target.value })} placeholder="65" /></label>
          <label className="crew-field"><span>Link</span><input type="text" className="crew-input" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://filmfreeway.com/…" /></label>
        </div>
        <div className="crew-actions"><button type="submit" className="crew-btn sm primary" disabled={busy || !draft.name.trim()}>Add to the tracker</button></div>
      </form>
    </section>
  );
}

// The released title's screening links and the production's older
// screeners, read-only: where each stands, Open › for the links the viewer
// runs (an older screener made here is its production owner's) when they
// can reach a link's page (creators and admins), and the way to the
// title's Private screenings tab.
function PrivateScreenings({ screenings, release, canReach }) {
  const [now, setNow] = useState(null);
  useEffect(() => { setNow(Date.now()); }, [screenings]);
  const links = Array.isArray(screenings.links) ? screenings.links : [];
  const byId = new Map(links.map((l) => [l.id, l]));
  const list = now ? screeningsList(links, now) : null;
  const canOpen = (id) => {
    const l = byId.get(id);
    return Boolean(canReach && l && (screenings.canManage || (l.legacy && l.productionId)));
  };
  return (
    <section className="crew-panel prod-section">
      <div className="crew-rhead"><h2 className="cc-h2">{SCREENING_WORDS.tab}{list && list.tabBadge ? ` · ${list.tabBadge}` : ''}</h2></div>
      <p className="crew-muted" style={{ margin: 0 }}>{SCREENING_WORDS.distributionLine}</p>
      {list && links.length === 0 && (
        <p className="crew-muted" style={{ margin: 0 }}>{release ? webText('distributionNone', { title: release.title }) : webText('distributionNoRelease')}</p>
      )}
      {list && links.length > 0 && (
        <div className="scn-dist">
          {list.open.map((card) => <OpenCard key={card.id} card={card} link={byId.get(card.id)} readOnly canOpen={canOpen(card.id)} />)}
          {list.ended.map((card) => <EndedCard key={card.id} card={card} readOnly canOpen={canOpen(card.id)} />)}
        </div>
      )}
      {release && screenings.href && screenings.canManage && canReach && (
        <div className="crew-actions"><Link href={screenings.href} className="crew-btn sm primary">{screeningText('distributionGo', { title: release.title })}</Link></div>
      )}
    </section>
  );
}
