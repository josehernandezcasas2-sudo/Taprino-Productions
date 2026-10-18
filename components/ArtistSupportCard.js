import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Avatar } from './crew/CrewBits';
import { tierLabel } from '../lib/membershipTiers';
import { SITE } from '../lib/siteConfig';
import { MAX_PICKS, MAX_WEIGHT, MIN_WEIGHT, dollars, splitLineup } from '../lib/artistSupportRules';

// The member's side of Membership Artist Support (mockups/creator-share-v1
// + the playable creator-share-play.html): their share for the month, the
// up-to-10 creators it goes to, equal or set shares, who may see their
// name, and the search to add more. Saves the whole list in one go
// through /api/artist-support; the app's account/artist-support screen
// mirrors it. `apiPath`/`searchPath` exist so a dev page can point the
// card at no-auth routes.
const COLORS = ['var(--brass)', 'var(--olive)', 'var(--mint)', 'var(--sky)', '#b48ad6', 'var(--danger)', 'var(--olive-bright)', 'var(--ok)', '#f8d98a', '#8499dc'];

const signature = (picks, mode, shareVisible) => JSON.stringify({ picks: picks.map((p) => `${p.creatorId}:${p.weight}`), mode, shareVisible });

export default function ArtistSupportCard({ initial, apiPath = '/api/artist-support', searchPath = '/api/artist-support/search' }) {
  const [picks, setPicks] = useState(initial.picks || []);
  const [mode, setMode] = useState(initial.mode === 'custom' ? 'custom' : 'equal');
  const [shareVisible, setShareVisible] = useState(Boolean(initial.shareVisible));
  const [savedSig, setSavedSig] = useState(() => signature(initial.picks || [], initial.mode === 'custom' ? 'custom' : 'equal', Boolean(initial.shareVisible)));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ creators: [], total: 0 });
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const timer = useRef(null);

  const shareCents = Number(initial.shareCents) || 0;
  const isPaid = shareCents > 0;
  const available = initial.available !== false;
  const split = splitLineup(shareCents, picks, mode);
  const full = picks.length >= MAX_PICKS;
  const dirty = signature(picks, mode, shareVisible) !== savedSig;
  const inLineup = new Set(picks.map((p) => p.creatorId));

  // Search as you type (and the first page of everyone on mount).
  useEffect(() => {
    let cancelled = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${searchPath}?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!cancelled && res.ok) setResults({ creators: data.creators || [], total: data.total || 0 });
      } catch (err) {
        // Non-fatal: the list just stays as it was.
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [query, searchPath]);

  function add(creator) {
    if (full || inLineup.has(creator.userId)) return;
    setNote(null);
    setPicks((prev) => [...prev, { ...creator, creatorId: creator.userId, weight: 1 }]);
  }
  function remove(creatorId) {
    setNote(null);
    setPicks((prev) => prev.filter((p) => p.creatorId !== creatorId));
  }
  function step(creatorId, delta) {
    setPicks((prev) => prev.map((p) => (p.creatorId === creatorId ? { ...p, weight: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, (p.weight || 1) + delta)) } : p)));
  }

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks: picks.map((p) => ({ creatorId: p.creatorId, weight: p.weight })), mode, shareVisible })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setPicks(data.picks || []);
      setMode(data.mode === 'custom' ? 'custom' : 'equal');
      setShareVisible(Boolean(data.shareVisible));
      setSavedSig(signature(data.picks || [], data.mode === 'custom' ? 'custom' : 'equal', Boolean(data.shareVisible)));
      setNote({ kind: 'ok', text: picks.length ? 'Saved. This applies from your next renewal.' : 'Saved. Your share follows what you watch until you pick someone.' });
    } catch (err) {
      setNote({ kind: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const profileHref = (c) => `/profile/${c.handle || c.creatorId || c.userId}`;

  return (
    <div className="account-card asup-card">
      <div className="asup-head">
        <div>
          <div className="account-subheading">Your creators</div>
          <h2 className="asup-title">{picks.length} of {MAX_PICKS} picked</h2>
        </div>
        <span className={`asup-tier ${isPaid ? 'paid' : ''}`}>{tierLabel(initial.tier || 'basic')}</span>
      </div>

      <div className="asup-share">
        <b>{dollars(shareCents)}</b>
        <span>{isPaid ? 'of your membership goes to your creators every month.' : `on Basic. Your picks are saved and start getting paid the day you join ${SITE.premiumTier}.`}</span>
      </div>
      <div className="asup-bar" aria-hidden="true">
        {isPaid && split.filter((s) => s.cents > 0).map((s, i) => (
          <i key={s.id} style={{ width: `${(s.cents / shareCents) * 100}%`, background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
      <div className="asup-meta">
        {picks.length
          ? `${mode === 'custom' ? 'Your own shares' : 'Equal shares'} · changes apply from your next renewal`
          : 'Nothing picked · your share follows what you watch'}
      </div>

      {!available && (
        <div className="asup-empty"><b>Artist Support isn&rsquo;t switched on yet.</b> The database part (migration 088) hasn&rsquo;t been run, so picks can&rsquo;t be saved. Everything below still works as a preview.</div>
      )}

      {picks.length === 0 ? (
        <div className="asup-empty">
          <b>Nobody picked yet.</b> Until you pick someone, your share follows what you watch: on each renewal it&rsquo;s split between the creators of the titles you watched in the last 30 days. Watched nothing? It joins the site-wide pool. Pick up to {MAX_PICKS} creators below and it goes to them instead.
        </div>
      ) : (
        <div className="asup-rows">
          {picks.map((p, idx) => {
            const s = split.find((x) => x.id === p.creatorId) || { cents: 0, percent: 0 };
            return (
              <div className="asup-row" key={p.creatorId}>
                <Avatar userId={p.creatorId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="md" />
                <div className="asup-row-main">
                  <Link href={profileHref(p)} className="asup-name">{p.displayName}</Link>
                  <span className="asup-sub">{(p.credits || []).slice(0, 2).join(' · ') || (p.handle ? `@${p.handle}` : 'Creator')}</span>
                </div>
                <div className="asup-amt">
                  {dollars(s.cents)}
                  <small>{s.percent}%{idx === 0 && picks.length > 1 && mode !== 'custom' ? ' · first pick' : ''}</small>
                </div>
                <div className="asup-row-actions">
                  {mode === 'custom' && (
                    <span className="asup-step">
                      <button type="button" onClick={() => step(p.creatorId, -1)} aria-label={`Smaller share for ${p.displayName}`} disabled={p.weight <= MIN_WEIGHT}>−</button>
                      <span>×{p.weight}</span>
                      <button type="button" onClick={() => step(p.creatorId, 1)} aria-label={`Bigger share for ${p.displayName}`} disabled={p.weight >= MAX_WEIGHT}>+</button>
                    </span>
                  )}
                  <button type="button" className="asup-x" onClick={() => remove(p.creatorId)} aria-label={`Remove ${p.displayName}`}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="asup-togs">
        <label>
          <button type="button" role="switch" aria-checked={mode === 'custom'} className={`asup-tog ${mode === 'custom' ? 'on' : ''}`} onClick={() => setMode((m) => (m === 'custom' ? 'equal' : 'custom'))} />
          Set my own shares
        </label>
        <label>
          <button type="button" role="switch" aria-checked={shareVisible} className={`asup-tog ${shareVisible ? 'on' : ''}`} onClick={() => setShareVisible((v) => !v)} />
          Let my creators see my name
        </label>
      </div>

      <div className="asup-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add a creator — search by name or title"
          aria-label="Search creators"
          id="asup-search"
        />
        <span className="asup-count">{full ? `Your ${MAX_PICKS} are full — swap someone out` : searching ? 'Searching…' : `${results.total} creator${results.total === 1 ? '' : 's'}`}</span>
      </div>
      <div className="asup-results">
        {results.creators.length === 0 && !searching && <div className="asup-meta" style={{ padding: '10px 0' }}>{query ? 'No creator matches that.' : 'No creators with released titles yet.'}</div>}
        {results.creators.map((c) => (
          <div className="asup-row" key={c.userId}>
            <Avatar userId={c.userId} name={c.displayName} src={c.avatarUrl} position={c.avatarPosition} zoom={c.avatarZoom} size="md" />
            <div className="asup-row-main">
              <span className="asup-name">{c.displayName}</span>
              <span className="asup-sub">{(c.credits || []).slice(0, 2).join(' · ') || (c.handle ? `@${c.handle}` : 'Creator')}</span>
            </div>
            {inLineup.has(c.userId)
              ? <span className="asup-in">✓ in your lineup</span>
              : <button type="button" className="account-btn-secondary" style={{ width: 'auto', margin: 0, padding: '6px 14px' }} onClick={() => add(c)} disabled={full}>Support</button>}
          </div>
        ))}
      </div>

      <div className="asup-actions">
        <button type="button" className="account-btn-primary" style={{ width: 'auto', marginBottom: 0 }} onClick={save} disabled={!dirty || saving || !available}>
          {saving ? 'Saving…' : 'Save my creators'}
        </button>
        {dirty && !saving && <span className="asup-note">Unsaved changes</span>}
        {note && <span className={`asup-note ${note.kind}`}>{note.text}</span>}
      </div>
      <p className="account-fineprint" style={{ marginTop: '0.9rem' }}>
        The split happens on each renewal, the way your list looks at that moment. Your history will show here once Artist Support payments start.
      </p>
    </div>
  );
}
