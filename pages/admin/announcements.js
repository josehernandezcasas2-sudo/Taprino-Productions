import { useEffect, useState } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export default function AnnouncementsAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [announcements, setAnnouncements] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // New-announcement form state
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newLink, setNewLink] = useState('');
  const [newFile, setNewFile] = useState(null);
  const [creating, setCreating] = useState(false);

  // Per-announcement edit buffers, keyed by id — lets each card be edited
  // independently without a modal, matching the rest of this admin's
  // inline-edit style elsewhere (e.g. episode metadata fields).
  const [edits, setEdits] = useState({});

  async function load() {
    try {
      const res = await fetch('/api/admin/announcements');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnnouncements(data.announcements);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function editValue(a, field) {
    const buf = edits[a.id];
    return buf && buf[field] !== undefined ? buf[field] : a[field];
  }

  function setEditValue(id, field, value) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTitle.trim()) {
      setError('Title is required.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const imageBase64 = newFile ? await readAsDataUrl(newFile) : null;
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          body: newBody,
          linkUrl: newLink,
          imageBase64,
          imageFileName: newFile && newFile.name
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewTitle('');
      setNewBody('');
      setNewLink('');
      setNewFile(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(a) {
    setBusyId(a.id);
    setError(null);
    try {
      const buf = edits[a.id] || {};
      const res = await fetch('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, title: buf.title, body: buf.body, linkUrl: buf.linkUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEdits((prev) => { const next = { ...prev }; delete next[a.id]; return next; });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function replaceImage(a, file) {
    setBusyId(a.id);
    setError(null);
    try {
      const imageBase64 = await readAsDataUrl(file);
      const res = await fetch('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, imageBase64, imageFileName: file.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeImage(a) {
    setBusyId(a.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, removeImage: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(a) {
    setBusyId(a.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, isActive: !a.isActive })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function moveOrder(a, direction) {
    const index = announcements.findIndex((x) => x.id === a.id);
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;
    const neighbor = announcements[neighborIndex];
    if (!neighbor) return; // already first/last, nothing to swap with

    setBusyId(a.id);
    setError(null);
    try {
      // Swap the two items' sort_order values directly, rather than a
      // blind +/- nudge — reliable regardless of what gap (if any)
      // currently exists between neighboring sort_order values.
      await Promise.all([
        fetch('/api/admin/announcements', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: a.id, sortOrder: neighbor.sortOrder })
        }),
        fetch('/api/admin/announcements', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: neighbor.id, sortOrder: a.sortOrder })
        })
      ]);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a) {
    if (!confirm(`Delete "${a.title}" permanently?`)) return;
    setBusyId(a.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Head>
        <title>Announcements — Admin</title>
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
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Announcements</h1>
            <p className="ca-sub">
              Shown in the homepage&rsquo;s Announcements carousel, newest-curated first. Each one can
              optionally link to a specific page — a pitch, a series, an internal path like{' '}
              <code>/pitches/&lt;id&gt;</code>, or a full external URL.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        <div className="account-card" style={{ maxWidth: 'none', marginTop: '1.2rem' }}>
          <h3>New announcement</h3>
          <form onSubmit={handleCreate}>
            <label>Title</label>
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />

            <label>Body <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional, short</span></label>
            <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={2} style={{ width: '100%', boxSizing: 'border-box' }} />

            <label>Link <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — what this announcement is promoting</span></label>
            <input type="text" value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="/pitches/abc123 or https://..." />

            <label>Image <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', margin: '0 0 0.5rem' }}>
              Recommended size: <strong>1200 × 630px</strong> (landscape, roughly 1.9:1) — the same shape
              used everywhere else on the web for link previews, so it crops cleanly at any card size
              on this page. JPG or PNG, under 6MB.
            </p>
            <input type="file" accept="image/*" onChange={(e) => setNewFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

            <button className="account-btn-primary" type="submit" disabled={creating} style={{ width: 'auto', display: 'block' }}>
              {creating ? 'Posting…' : 'Post announcement'}
            </button>
          </form>
        </div>

        <h3 style={{ marginTop: '2rem' }}>All announcements</h3>
        {!announcements ? (
          <p>Loading…</p>
        ) : announcements.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)' }}>Nothing posted yet.</p>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="account-card" style={{ maxWidth: 'none', marginBottom: '1rem', opacity: a.isActive ? 1 : 0.6 }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flexShrink: 0, width: '160px' }}>
                  {a.imageUrl ? (
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '1200/630', borderRadius: '8px', overflow: 'hidden' }}>
                      <Image src={a.imageUrl} alt="" fill sizes="160px" style={{ objectFit: 'cover' }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '1200/630', borderRadius: '8px', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--ink-dim)' }}>
                      No image
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <label className="admin-media-action" style={{ fontSize: '0.72rem' }}>
                      {a.imageUrl ? 'Replace…' : 'Upload…'}
                      <input type="file" accept="image/*" disabled={busyId === a.id} onChange={(e) => e.target.files[0] && replaceImage(a, e.target.files[0])} />
                    </label>
                    {a.imageUrl && (
                      <button type="button" className="admin-media-undo" style={{ fontSize: '0.72rem' }} onClick={() => removeImage(a)} disabled={busyId === a.id}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <label>Title</label>
                  <input type="text" value={editValue(a, 'title')} onChange={(e) => setEditValue(a.id, 'title', e.target.value)} />

                  <label>Body</label>
                  <textarea value={editValue(a, 'body') || ''} onChange={(e) => setEditValue(a.id, 'body', e.target.value)} rows={2} style={{ width: '100%', boxSizing: 'border-box' }} />

                  <label>Link</label>
                  <input type="text" value={editValue(a, 'linkUrl') || ''} onChange={(e) => setEditValue(a.id, 'linkUrl', e.target.value)} />

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="account-btn-primary" style={{ width: 'auto' }} onClick={() => saveEdit(a)} disabled={busyId === a.id || !edits[a.id]}>
                      Save changes
                    </button>
                    <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => toggleActive(a)} disabled={busyId === a.id}>
                      {a.isActive ? 'Hide from homepage' : 'Show on homepage'}
                    </button>
                    <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => moveOrder(a, 'up')} disabled={busyId === a.id}>↑ Move earlier</button>
                    <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => moveOrder(a, 'down')} disabled={busyId === a.id}>↓ Move later</button>
                    <button className="admin-media-undo" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => remove(a)} disabled={busyId === a.id}>
                      Delete
                    </button>
                    <span style={{ fontSize: '0.72rem', color: 'var(--ink-dim)', marginLeft: 'auto' }}>
                      {a.isActive ? 'Live on homepage' : 'Hidden'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}
