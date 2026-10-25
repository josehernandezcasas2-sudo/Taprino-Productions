import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import ProductionShell, { shellProps } from '../../components/productions/ProductionShell';
import { ProductionCard } from '../../components/productions/ProductionBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { listProductions, listMyProductions } from '../../lib/productions';
import { PRODUCTION_KINDS, PRODUCTION_STATUS } from '../../lib/productionRules';

// Productions (Connect, migration 104): who's making what. Public list
// with filters; a signed-in person's own productions and the ones they're
// crew on sit at the top.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let board = { productions: [], total: 0 };
  let mine = { owned: [], crewOn: [] };
  try {
    [board, mine] = await Promise.all([
      listProductions({}, { viewerId: account.userId || null }),
      account.isSignedIn ? listMyProductions(account.userId) : Promise.resolve(mine)
    ]);
  } catch (err) {
    console.error('productions page:', err.message);
  }
  return { props: { ...shellProps(account, episodes), board, mine } };
}

const PUBLIC_STATUSES = ['prep', 'shooting', 'post', 'released'];

export default function ProductionsPage(props) {
  const { board: initial, mine, isSignedIn } = props;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [board, setBoard] = useState(initial);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  const reqId = useRef(0);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (kind) params.set('kind', kind);
      if (status) params.set('status', status);
      try {
        const res = await fetch(`/api/productions?${params.toString()}`);
        const data = await res.json();
        if (id === reqId.current && res.ok) setBoard(data);
      } catch (err) { /* keep what we have */ } finally { if (id === reqId.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, status]);

  const hasFilters = Boolean(q.trim() || kind || status);
  const hasMine = mine.owned.length > 0 || mine.crewOn.length > 0;

  return (
    <ProductionShell title="Productions" {...props}>
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Connect · Productions</span>
          <h1>Productions</h1>
          <p>The shoots happening on Studio Tapa. A production is where crew calls, location bookings and the call sheet live — and when it’s released here, everyone who worked it gets the credit with their role.</p>
        </div>
        {isSignedIn
          ? <Link href="/productions/new" className="crew-btn primary">+ Start a production</Link>
          : <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in to start one</button></SignInButton>}
      </div>
      <div className="crew-subnav" role="tablist">
        <Link href="/crew" className="crew-tab">Find people</Link>
        <Link href="/crew/calls" className="crew-tab">Calls</Link>
        <Link href="/locations" className="crew-tab">Locations</Link>
        <span className="crew-tab on" aria-current="page">Productions{board.total ? ` · ${board.total}` : ''}</span>
      </div>

      {hasMine && (
        <section className="prod-mine" id="mine">
          {mine.owned.length > 0 && (
            <>
              <div className="crew-rhead"><span className="crew-mono">Yours · {mine.owned.length}</span><Link href="/productions/new" className="crew-mono">+ start another</Link></div>
              <div className="prod-grid">{mine.owned.map((p) => <ProductionCard key={p.id} p={p} />)}</div>
            </>
          )}
          {mine.crewOn.length > 0 && (
            <>
              <div className="crew-rhead"><span className="crew-mono">You’re on the crew · {mine.crewOn.length}</span></div>
              <div className="prod-grid">{mine.crewOn.map((p) => <ProductionCard key={p.id} p={p} roles={p.myRoles} />)}</div>
            </>
          )}
        </section>
      )}

      <div className="crew-find prod-find">
        <aside className="crew-filters">
          <input type="search" className="crew-input" placeholder="Title, place, who…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search productions" />
          <div className="crew-panel crew-filter-panel">
            <label className="crew-field"><span>Kind</span>
              <select className="crew-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">Any kind</option>
                {Object.entries(PRODUCTION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <div className="crew-field"><span>Where it’s at</span>
              <div className="crew-chips crew-filterchips">
                {PUBLIC_STATUSES.map((k) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(status === k ? '' : k)}>{PRODUCTION_STATUS[k]}</button>)}
              </div>
            </div>
            {hasFilters && <button type="button" className="crew-btn sm ghost" onClick={() => { setQ(''); setKind(''); setStatus(''); }}>Clear filters</button>}
          </div>
          <div className="crew-panel crew-muted">Public productions only. The call sheet — addresses, access notes, house rules — is for the crew on each one.</div>
        </aside>
        <div className="cc-list">
          <div className="crew-rhead">
            <span className="crew-mono">{board.total} {board.total === 1 ? 'production' : 'productions'}{loading ? ' · updating…' : ''}</span>
            <span className="crew-mono">shooting now first</span>
          </div>
          {board.productions.length === 0 && (
            <div className="crew-panel crew-empty">
              {hasFilters ? 'Nothing matches. Clear a filter.' : isSignedIn ? <>No productions yet. <Link href="/productions/new">Start the first one</Link>.</> : 'No productions yet. Sign in to start the first one.'}
            </div>
          )}
          <div className="prod-grid">{board.productions.map((p) => <ProductionCard key={p.id} p={p} />)}</div>
        </div>
      </div>
    </ProductionShell>
  );
}
