import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import SignInHere from '../../components/SignInHere';
import StartSheet from '../../components/productions/StartSheet';
import ProductionShell, { shellProps } from '../../components/productions/ProductionShell';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getMyProductionsView } from '../../lib/productionDashboard';
import { MINE_WORDS, mineGroups, mineTab, readyPitchCard, yoursCard } from '../../lib/productionDashRules';

// Your productions (2026-11-19; the YourProds board on
// https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN): Running (you run it,
// still being made) · On the crew · Done, and "Got a pitch?" for an
// approved pitch with no production yet. Words and cards are
// lib/productionDashRules.js; the data is GET /api/productions/mine's
// view, read here in getServerSideProps.
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let view = { items: [], readyPitches: [], today: null };
  let failed = false;
  if (account.isSignedIn) {
    try {
      view = await getMyProductionsView(account.userId);
    } catch (err) {
      console.error('productions/mine page:', err && err.message);
      failed = true;
    }
  }
  return { props: { ...shellProps(account, episodes), view: JSON.parse(JSON.stringify(view)), failed, initialTab: mineTab(typeof query.tab === 'string' ? query.tab : 'running') } };
}

export default function YourProductions(props) {
  const { view, failed, isSignedIn, initialTab } = props;
  const router = useRouter();
  const groups = mineGroups(view.items);
  const [tab, setTab] = useState(initialTab);
  const [starting, setStarting] = useState(null);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const list = groups.groups[tab] || [];

  function pick(id) {
    setTab(id);
    router.replace(id === 'running' ? '/productions/mine' : `/productions/mine?tab=${id}`, undefined, { shallow: true, scroll: false });
  }

  return (
    <ProductionShell title={MINE_WORDS.title} {...props}>
      <div className="ypr">
        <div className="ypr-head">
          <h1 className="ypr-title">{MINE_WORDS.title}</h1>
          {isSignedIn && <Link href={MINE_WORDS.startHref} className="ypr-plus" aria-label={MINE_WORDS.start} title={MINE_WORDS.start}>+</Link>}
        </div>
        {!isSignedIn ? (
          <div className="pd-card ypr-signin">
            <p className="pd-line">{MINE_WORDS.signIn}</p>
            <SignInHere><button type="button" className="pd-btn primary">{MINE_WORDS.signInButton}</button></SignInHere>
          </div>
        ) : failed ? (
          <div className="pd-error" role="alert">{MINE_WORDS.failed}</div>
        ) : (
          <>
            <div className="ypr-tabs" role="tablist" aria-label={MINE_WORDS.title}>
              {groups.tabs.map((t) => (
                <button key={t.id} type="button" role="tab" id={`ypr-tab-${t.id}`} aria-selected={tab === t.id} className={`pd-tab${tab === t.id ? ' on' : ''}`} onClick={() => pick(t.id)}>{t.label}</button>
              ))}
            </div>
            <div className="ypr-list" role="tabpanel" aria-labelledby={`ypr-tab-${tab}`}>
              {list.length === 0 && <p className="pd-muted ypr-empty">{MINE_WORDS.empty[tab]}</p>}
              {list.map((item) => {
                const c = yoursCard(item, view.today);
                return (
                  <section key={c.id} className="pd-card ypr-card" data-production={c.id}>
                    <div className="ypr-card-top"><b className="ypr-card-title">{c.title}</b><span className={`ypr-status s-${c.status.tone}`}>{c.status.text}</span></div>
                    {c.line && <span className="pd-line pd-faint">{c.line}</span>}
                    {(c.stats.length > 0 || c.needs) && (
                      <span className="ypr-stats">{c.stats.map((x) => <span key={x}>{x}</span>)}{c.needs && <b className="ypr-needs">{c.needs}</b>}</span>
                    )}
                    <Link href={c.button.href} className={`pd-btn wide${c.button.primary ? ' primary' : ''}`}>{c.button.label}</Link>
                  </section>
                );
              })}
              {tab === 'running' && view.readyPitches.map((p) => {
                const c = readyPitchCard(p);
                return (
                  <section key={p.id} className="ypr-pitch" data-pitch={p.id}>
                    <b>{c.title}</b>
                    <span className="pd-line pd-faint">{c.line}</span>
                    <button type="button" className="ypr-pitch-go" onClick={() => setStarting(p)}>{c.link.label} ›</button>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
      {starting && <StartSheet pitch={starting} backers={starting.backers} onClose={() => setStarting(null)} />}
    </ProductionShell>
  );
}
