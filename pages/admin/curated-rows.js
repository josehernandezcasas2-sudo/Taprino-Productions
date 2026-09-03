import { useEffect, useState } from 'react';
import Head from 'next/head';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      episodes,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

// Matches TYPE_LABELS in pages/type/[type].js — scope naming follows the
// same "type:<value>" convention throughout the curated-rows system.
const TYPES = [
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
  { value: 'short', label: 'Shorts' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcasts' }
];

export default function CuratedRowsAdmin({ mainGenres, episodes, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [type, setType] = useState('movie');
  const scope = `type:${type}`;

  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [siteSettings, setSiteSettings] = useState(null);
  const [savingOrderMode, setSavingOrderMode] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingItemIds, setEditingItemIds] = useState([]);
  const [episodeFilter, setEpisodeFilter] = useState('');
  const [savingItems, setSavingItems] = useState(false);

  function loadGroups() {
    setLoading(true);
    fetch(`/api/admin/curated-groups?scope=${encodeURIComponent(scope)}`)
      .then((r) => r.json())
      .then((data) => setGroups(data.groups || []))
      .catch(() => setError('Could not load rows for this section.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadGroups(); }, [scope]);

  useEffect(() => {
    fetch('/api/admin/site-settings').then((r) => r.json()).then(setSiteSettings).catch(() => {});
  }, []);

  async function toggleOrderMode(random) {
    if (!siteSettings) return;
    setSavingOrderMode(true);
    try {
      // Sends the COMPLETE settings payload, not just the one field that
      // changed — this endpoint applies every field it receives, so
      // sending only curatedRowsRandomOrder would read every other field
      // as undefined and silently reset Shop, Live TV, Vertical, and
      // Podcasts back to their defaults.
      const res = await fetch('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...siteSettings, curatedRowsRandomOrder: random })
      });
      if (!res.ok) throw new Error();
      setSiteSettings((s) => ({ ...s, curatedRowsRandomOrder: random }));
    } catch {
      setError('Could not save the row order setting.');
    } finally {
      setSavingOrderMode(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/curated-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', scope, title: newTitle.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create group.');
      setNewTitle('');
      loadGroups();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleSetActive(groupId, active) {
    setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, active } : g)));
    try {
      await fetch('/api/admin/curated-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setActive', groupId, active })
      });
    } catch {
      loadGroups(); // revert to server truth if the save actually failed
    }
  }

  async function handleDelete(groupId, title) {
    if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
    try {
      await fetch('/api/admin/curated-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', groupId })
      });
      loadGroups();
    } catch {
      setError('Could not delete that group.');
    }
  }

  function move(index, direction) {
    const next = [...groups];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setGroups(next);
    fetch('/api/admin/curated-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder', orderedGroupIds: next.map((g) => g.id) })
    }).catch(() => loadGroups());
  }

  function openEditor(group) {
    setEditingGroupId(group.id);
    setEpisodeFilter('');
    fetch(`/api/admin/curated-groups?itemsForGroup=${group.id}`)
      .then((r) => r.json())
      .then((data) => setEditingItemIds(data.episodeIds || []))
      .catch(() => setEditingItemIds([]));
  }

  function toggleEpisodeInEditor(episodeId) {
    setEditingItemIds((ids) => (ids.includes(episodeId) ? ids.filter((id) => id !== episodeId) : [...ids, episodeId]));
  }

  async function saveEditorItems() {
    setSavingItems(true);
    try {
      await fetch('/api/admin/curated-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setItems', groupId: editingGroupId, episodeIds: editingItemIds })
      });
      setEditingGroupId(null);
    } catch {
      setError('Could not save that group\u2019s episodes.');
    } finally {
      setSavingItems(false);
    }
  }

  const typeEpisodes = episodes.filter((e) => e.contentType === type);
  const filteredPickerEpisodes = typeEpisodes.filter(
    (e) => !episodeFilter.trim() || e.title.toLowerCase().includes(episodeFilter.trim().toLowerCase())
  );
  const editingGroup = groups && groups.find((g) => g.id === editingGroupId);

  return (
    <>
      <Head>
        <title>Curated rows — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <main id="main-content" className="stage stage-single">
        <div className="eyebrow">Admin</div>
        <h1>Curated rows</h1>
        <p className="ca-sub">
          Arrange the genre rows and custom picks shown on each browse page. Genre rows appear
          automatically as content is added — you can reorder or hide them here, but not delete
          them, since they&rsquo;d just reappear the moment that genre has content again.
        </p>

        {error && <div className="admin-preview-banner" style={{ marginTop: '1rem' }}>{error}</div>}

        <div className="account-card" style={{ marginTop: '1.2rem' }}>
          <div className="account-eyebrow">Row order</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: '0 0 0.8rem' }}>
            Admin-arranged uses the order set below, on every page load. Random reshuffles the
            row order (not what&rsquo;s inside each row) every time the page loads.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              className={siteSettings && !siteSettings.curatedRowsRandomOrder ? 'account-btn-primary' : 'account-btn-secondary'}
              style={{ width: 'auto' }}
              disabled={!siteSettings || savingOrderMode}
              onClick={() => toggleOrderMode(false)}
            >
              Admin-arranged
            </button>
            <button
              className={siteSettings && siteSettings.curatedRowsRandomOrder ? 'account-btn-primary' : 'account-btn-secondary'}
              style={{ width: 'auto' }}
              disabled={!siteSettings || savingOrderMode}
              onClick={() => toggleOrderMode(true)}
            >
              Random
            </button>
          </div>
        </div>

        <div className="account-card" style={{ marginTop: '1.2rem' }}>
          <div className="account-eyebrow">Which page</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {TYPES.map((t) => (
              <button
                key={t.value}
                className={type === t.value ? 'account-btn-primary' : 'account-btn-secondary'}
                style={{ width: 'auto' }}
                onClick={() => setType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="account-card" style={{ marginTop: '1.2rem' }}>
          <div className="account-eyebrow">Rows on {TYPES.find((t) => t.value === type).label}</div>
          {loading ? (
            <p style={{ color: 'var(--ink-dim)' }}>Loading…</p>
          ) : groups.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)' }}>No rows yet — genre rows appear here once this section has content.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {groups.map((g, i) => (
                <div
                  key={g.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.7rem',
                    padding: '0.7rem 0.9rem', border: '1px solid rgba(234,231,221,0.12)', borderRadius: '8px',
                    opacity: g.active ? 1 : 0.5
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <button onClick={() => move(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer', fontSize: '0.9rem' }}>&uarr;</button>
                    <button onClick={() => move(i, 1)} disabled={i === groups.length - 1} style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer', fontSize: '0.9rem' }}>&darr;</button>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.68rem', padding: '0.15rem 0.5rem', borderRadius: '10px',
                      background: g.groupType === 'genre' ? 'rgba(232,163,61,0.15)' : 'rgba(132,205,152,0.15)',
                      color: g.groupType === 'genre' ? 'var(--brass)' : 'var(--ok)'
                    }}
                  >
                    {g.groupType === 'genre' ? 'GENRE' : 'CUSTOM'}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{g.title}</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--ink-dim)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={g.active} onChange={(e) => handleSetActive(g.id, e.target.checked)} />
                    Active
                  </label>
                  {g.groupType === 'custom' && (
                    <>
                      <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => openEditor(g)}>Edit episodes</button>
                      <button className="account-btn-secondary" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => handleDelete(g.id, g.title)}>Delete</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="account-card" style={{ marginTop: '1.2rem' }}>
          <div className="account-eyebrow">Create a custom row</div>
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.6rem' }}>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Staff Picks"
              style={{ flex: 1 }}
            />
            <button className="account-btn-primary" style={{ width: 'auto' }} type="submit" disabled={creating || !newTitle.trim()}>
              {creating ? 'Creating\u2026' : 'Create'}
            </button>
          </form>
        </div>

        {editingGroup && (
          <div className="account-card" style={{ marginTop: '1.2rem' }}>
            <div className="account-eyebrow">Episodes in &ldquo;{editingGroup.title}&rdquo;</div>
            <input
              type="text"
              value={episodeFilter}
              onChange={(e) => setEpisodeFilter(e.target.value)}
              placeholder="Search titles\u2026"
              style={{ marginBottom: '0.8rem' }}
            />
            <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {filteredPickerEpisodes.length === 0 ? (
                <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>No matching episodes in this section.</p>
              ) : (
                filteredPickerEpisodes.map((ep) => (
                  <label key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', padding: '0.3rem 0' }}>
                    <input type="checkbox" checked={editingItemIds.includes(ep.id)} onChange={() => toggleEpisodeInEditor(ep.id)} />
                    {ep.title}
                    {ep.mainGenre && <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{ep.mainGenre}</span>}
                  </label>
                ))
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
              <button className="account-btn-primary" style={{ width: 'auto' }} onClick={saveEditorItems} disabled={savingItems}>
                {savingItems ? 'Saving\u2026' : `Save (${editingItemIds.length} selected)`}
              </button>
              <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setEditingGroupId(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
