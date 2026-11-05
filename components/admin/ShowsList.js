import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ADMIN_SHOW_FILTERS, capLine } from '../../lib/showAdminRules';
import { CheckIcon, CloseIcon, LockIcon, PlusIcon, SearchIcon } from '../PlayerIcons';
import CreateShowForm from './CreateShowForm';

// Admin → Shows, the list (the series revamp, slice 3a §5.4): every series
// and podcast newest first, a search by name or the owner's name or email,
// the filter chips with their counts (lib/showAdminRules.js
// ADMIN_SHOW_FILTERS), and a row per show — poster, name, kind, where it
// stands, who runs it, the count line and the badges that say what needs
// someone — opening the show's admin page. "+ Create a show for a creator"
// (manage_episodes) sets one up, private, for its owner to fill.
// Data: GET /api/admin/shows?filter=&q=.

const STATE_CHIP = { live: 'state-live', ready: 'state-ready', review: 'state-private', drafts: 'state-private', empty: 'state-private', pulled: 'state-pulled', removal: 'state-removal', declined: 'state-declined' };

function bg(url) {
  return url ? { backgroundImage: `url("${String(url).replace(/"/g, '%22')}")` } : undefined;
}

export default function ShowsList({ account, mainGenres = [] }) {
  const router = useRouter();
  const canCreate = Boolean(account.isAdmin || (account.permissions || []).includes('manage_episodes'));
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [removed, setRemoved] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async (f, query) => {
    seq.current += 1;
    const mine = seq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f && f !== 'all') params.set('filter', f);
      if (query) params.set('q', query);
      const res = await fetch(`/api/admin/shows${params.toString() ? `?${params}` : ''}`, { credentials: 'same-origin' });
      const d = await res.json().catch(() => ({}));
      if (mine !== seq.current) return;
      if (!res.ok) {
        setError(d.error || `Couldn’t load the shows (${res.status}).`);
        setData((x) => x || { shows: [], counts: {} });
      } else {
        setError(null);
        setData(d);
      }
    } catch {
      if (mine === seq.current) setError('Couldn’t reach the site — check the connection and try again.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // The search waits for a pause in typing; a chip loads at once.
  useEffect(() => {
    const t = setTimeout(() => load(filter, q.trim()), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filter, q, load]);

  // "Night Bus was removed: …" after a show's page removed it.
  useEffect(() => {
    if (!router.isReady || typeof router.query.removed !== 'string') return;
    const name = router.query.removed.slice(0, 200);
    let words = null;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem('showAdmRemoved') || 'null');
      if (saved && saved.name === name) words = saved.words || null;
      window.sessionStorage.removeItem('showAdmRemoved');
    } catch {
      words = null;
    }
    setRemoved({ name, words });
    const next = { ...router.query };
    delete next.removed;
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true, scroll: false });
  }, [router.isReady, router.query.removed]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = (data && data.counts) || {};
  const shows = (data && data.shows) || [];
  const shows118 = !data || !data.migration || data.migration.shows118 !== false;

  return (
    <div className="adm-shows">
      {removed && (
        <div className="cs-flash adm-shows-flash" role="status">
          <CheckIcon size={15} />
          <span><strong>{removed.name} was removed{removed.words ? ':' : '.'}</strong>{removed.words ? ` ${removed.words}.` : ''}</span>
          <button type="button" className="show-room-flash-x" aria-label="Dismiss" onClick={() => setRemoved(null)}><CloseIcon size={14} /></button>
        </div>
      )}

      <div className="adm-shows-top">
        <label className="adm-shows-search">
          <SearchIcon size={16} />
          <span className="show-sr">Search shows</span>
          <input type="search" value={q} maxLength={80} placeholder="Search by name or owner email" onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="adm-shows-create">
          <button type="button" className="apl-btn adm-shows-create-btn" disabled={!canCreate} onClick={() => setCreating(true)}>
            <PlusIcon size={16} /> Create a show for a creator
          </button>
          {!canCreate && <p className="show-adm-need"><LockIcon size={11} /> <span>{capLine('manage_episodes')}</span></p>}
        </div>
      </div>

      <div className="adm-shows-chips" role="group" aria-label="Show filters">
        {ADMIN_SHOW_FILTERS.map(([key, label]) => {
          const n = Number(counts[key]) || 0;
          return (
            <button key={key} type="button" className={`rq-chip ${filter === key ? 'is-active' : ''}`} aria-pressed={filter === key ? 'true' : 'false'} onClick={() => setFilter(key)}>
              {label}{data ? <> <span className="adm-shows-chip-n">{n}</span></> : null}
            </button>
          );
        })}
      </div>

      {!shows118 && <p className="show-behind" role="status">Kinds, defaults and “Went public this week” need a database update (migration 118).</p>}
      {error && <p className="rq-error" role="alert">{error}</p>}

      {!data && loading ? (
        <p className="adm-empty">Loading…</p>
      ) : shows.length === 0 ? (
        <p className="adm-empty">{loading ? 'Loading…' : 'No shows match.'}</p>
      ) : (
        <ul className={`adm-shows-list ${loading ? 'is-loading' : ''}`}>
          {shows.map((s) => (
            <li key={s.id}>
              <Link href={s.href || `/admin/shows/${encodeURIComponent(s.id)}`} className="adm-shows-row">
                <span className={`adm-shows-poster ${s.poster || s.thumbnail ? '' : 'is-empty'}`} style={bg(s.poster || s.thumbnail)} aria-hidden="true">{s.poster || s.thumbnail ? null : (s.name || '?').slice(0, 1)}</span>
                <span className="adm-shows-body">
                  <span className="adm-shows-name">{s.name || 'Untitled show'}</span>
                  <span className="adm-shows-chiprow">
                    <span className={`cs-chip ${s.kind === 'podcast' ? 'kind-podcast' : 'kind-series'}`}>{s.kindLabel || (s.kind === 'podcast' ? 'Podcast' : 'Series')}</span>
                    <span className={`cs-chip ${STATE_CHIP[s.state] || 'state-private'}`}>{s.state === 'live' ? <i /> : null}{s.statusLabel || 'Not public yet'}</span>
                  </span>
                  <span className={`adm-shows-owner ${s.owner ? '' : 'is-none'}`}>{s.owner ? [s.owner.name, s.owner.email].filter(Boolean).join(' · ') || 'An account with no name yet' : '(no owner)'}</span>
                  <span className="adm-shows-count">{s.countLine}</span>
                  {(s.badges || []).length > 0 && (
                    <span className="adm-shows-badges">
                      {s.badges.map((b) => <span key={b.key} className={`adm-shows-badge tone-${b.tone || 'neutral'}`}>{b.words}</span>)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateShowForm
          account={account}
          mainGenres={mainGenres}
          onClose={() => setCreating(false)}
          onCreated={(href) => router.push(`${href}?created=1`)}
        />
      )}
    </div>
  );
}
