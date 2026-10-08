import { useEffect, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import Link from 'next/link';

// Admin-only: you create channels and decide who maintains them.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

// Shrinks an image in the browser before upload, so big camera files fit
// under the server's request size limit. Logos stay PNG (transparency).
function shrinkImage(file, { maxWidth, maxHeight, type }) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read that file.'));
      r.readAsDataURL(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL(type, 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image this browser can read."));
    };
    img.src = url;
  });
}

function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

const pad = (n) => String(n).padStart(2, '0');

export default function AdminChannels({ account, mainGenres }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | channel id

  async function load() {
    try {
      const res = await fetch('/api/admin/channels');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load channels.');
      setData(d);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function call(url, method, body) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Something went wrong.');
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(channel) {
    if (!window.confirm(`Delete ${channel.name} (CH ${pad(channel.number)})? Its schedule, loop and scheduler assignments go with it. This can't be undone.`)) return;
    await call('/api/admin/channels', 'DELETE', { id: channel.id });
  }

  const editingChannel = data && editing && editing !== 'new' ? data.channels.find((c) => c.id === editing) : null;

  return (
    <>
      <AdminShell account={account} mainGenres={mainGenres} title="Channels" crumbs={['Channels & Live']} wide>
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Channels</h1>
            <p className="ca-sub">
              Every channel at <Link href="/live">/live</Link>. You create channels and assign the Content Schedulers who
              maintain them. Give someone that role on <Link href="/admin/team">Team &amp; permissions</Link>. Schedules and loops are built in the <Link href="/schedule">scheduler</Link>.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }} role="alert">{error}</div>}
        {!data && !error && <div className="ca-empty" style={{ marginTop: '1.2rem' }}>Loading…</div>}

        {data && (
          <div className="chadm-grid">
            {data.channels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                candidates={data.schedulers}
                busy={busy}
                onEdit={() => setEditing(c.id)}
                onDelete={() => remove(c)}
                onAssign={(userId) => call('/api/admin/channel-schedulers', 'POST', { channelId: c.id, userId, action: 'assign' })}
                onUnassign={(userId) => call('/api/admin/channel-schedulers', 'POST', { channelId: c.id, userId, action: 'unassign' })}
              />
            ))}
            {editing !== 'new' && (
              <button type="button" className="chadm-card chadm-new" onClick={() => setEditing('new')}>
                <strong>New channel</strong>
                <span>Gets CH {pad(data.nextNumber)} unless you pick another number</span>
              </button>
            )}
          </div>
        )}

        {data && editing && (
          <ChannelForm
            key={editing}
            channel={editingChannel}
            nextNumber={data.nextNumber}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (body) => {
              const ok = editingChannel
                ? await call('/api/admin/channels', 'PATCH', { id: editingChannel.id, ...body })
                : await call('/api/admin/channels', 'POST', body);
              if (ok) setEditing(null);
            }}
          />
        )}
      </AdminShell>
    </>
  );
}

function ChannelCard({ channel: c, candidates, busy, onEdit, onDelete, onAssign, onUnassign }) {
  const [pick, setPick] = useState('');
  const assignable = candidates.filter((p) => !c.schedulerIds.includes(p.id));
  return (
    <div className="chadm-card">
      <div className="chadm-img" style={c.image_url ? { backgroundImage: `url(${c.image_url})` } : undefined}>
        {!c.image_url && <span>{c.name}</span>}
      </div>
      <div className="chadm-top">
        {c.logo_url ? <img className="chadm-logo" src={c.logo_url} alt="" /> : <div className="chadm-logo chadm-logo-empty">{c.name.slice(0, 2).toUpperCase()}</div>}
        <div style={{ minWidth: 0 }}>
          <h3>{c.name}</h3>
          <div className="chadm-meta">CH {pad(c.number)} · /live{c.isMain ? '' : `/${c.slug}`}</div>
        </div>
      </div>
      <div className="chadm-chips">
        {c.isMain && <span className="tv-chip">Main channel</span>}
        <span className={`tv-chip ${c.visibility === 'public' ? 'free' : ''}`}>{c.visibility === 'public' ? 'Public' : 'Draft · hidden from viewers'}</span>
      </div>
      {c.description && <p className="chadm-desc">{c.description}</p>}

      <div>
        <div className="tv-info-eyebrow" style={{ marginBottom: '0.4rem' }}>Schedulers</div>
        <div className="chadm-people">
          {c.schedulers.length === 0 && <span className="chadm-none">Nobody assigned yet. You can still schedule it yourself.</span>}
          {c.schedulers.map((s) => (
            <span key={s.id} className={`chadm-person ${s.stillScheduler ? '' : 'stale'}`} title={s.stillScheduler ? undefined : 'No longer a Content Scheduler'}>
              {s.email}
              <button type="button" onClick={() => onUnassign(s.id)} disabled={busy} aria-label={`Take ${s.email} off ${c.name}`}>×</button>
            </span>
          ))}
        </div>
        {assignable.length > 0 && (
          <div className="chadm-assign">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Assign a scheduler to ${c.name}`}>
              <option value="">Assign a Content Scheduler…</option>
              {assignable.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
            </select>
            <button type="button" className="account-btn-secondary" disabled={!pick || busy} onClick={() => { onAssign(pick); setPick(''); }}>Assign</button>
          </div>
        )}
        {candidates.length === 0 && (
          <p className="chadm-none" style={{ marginTop: '0.4rem' }}>No Content Schedulers yet. Add one on <Link href="/admin/team">Team &amp; permissions</Link>.</p>
        )}
      </div>

      <div className="chadm-acts">
        <button type="button" className="account-btn-secondary" onClick={onEdit} disabled={busy}>Edit</button>
        {c.visibility === 'public' && <Link href={c.isMain ? '/live' : `/live/${c.slug}`} className="account-btn-secondary">View on /live</Link>}
        <Link href={`/schedule?channel=${c.slug}`} className="account-btn-secondary">Open scheduler</Link>
        {!c.isMain && <button type="button" className="account-btn-danger" onClick={onDelete} disabled={busy}>Delete</button>}
      </div>
    </div>
  );
}

function ChannelForm({ channel, nextNumber, busy, onCancel, onSave }) {
  const isNew = !channel;
  const [name, setName] = useState(channel ? channel.name : '');
  const [slug, setSlug] = useState(channel ? channel.slug : '');
  const [slugTouched, setSlugTouched] = useState(!!channel);
  const [number, setNumber] = useState(channel ? channel.number : nextNumber);
  const [description, setDescription] = useState(channel ? channel.description || '' : '');
  const [visibility, setVisibility] = useState(channel ? channel.visibility : 'draft');
  const [logo, setLogo] = useState(null); // { dataUrl, name }
  const [image, setImage] = useState(null);
  const [clearLogo, setClearLogo] = useState(false);
  const [clearImage, setClearImage] = useState(false);
  const [fileError, setFileError] = useState(null);
  const isMain = channel && channel.isMain;

  async function pickFile(e, kind) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileError(null);
    try {
      const dataUrl = kind === 'logo'
        ? await shrinkImage(file, { maxWidth: 512, maxHeight: 512, type: 'image/png' })
        : await shrinkImage(file, { maxWidth: 1920, maxHeight: 1080, type: 'image/jpeg' });
      const ext = file.type === 'image/svg+xml' ? 'svg' : kind === 'logo' ? 'png' : 'jpg';
      if (kind === 'logo') { setLogo({ dataUrl, name: `logo.${ext}` }); setClearLogo(false); }
      else { setImage({ dataUrl, name: `image.${ext}` }); setClearImage(false); }
    } catch (err) {
      setFileError(err.message);
    }
  }

  function submit(e) {
    e.preventDefault();
    onSave({
      name,
      slug: isMain ? undefined : slug,
      number: Number(number),
      description,
      visibility: isMain ? undefined : visibility,
      logoBase64: logo ? logo.dataUrl : undefined,
      logoFileName: logo ? logo.name : undefined,
      imageBase64: image ? image.dataUrl : undefined,
      imageFileName: image ? image.name : undefined,
      clearLogo: clearLogo || undefined,
      clearImage: clearImage || undefined
    });
  }

  const logoPreview = logo ? logo.dataUrl : !clearLogo && channel ? channel.logo_url : null;
  const imagePreview = image ? image.dataUrl : !clearImage && channel ? channel.image_url : null;

  return (
    <form className="chadm-form" onSubmit={submit}>
      <div className="chadm-form-head">
        <h2>{isNew ? 'New channel' : `Edit ${channel.name}`}</h2>
        {isNew && <span className="tv-info-eyebrow">Starts as a draft unless you make it public</span>}
      </div>
      <label className="chadm-field">
        <span>Channel name</span>
        <input id="ch-name" value={name} maxLength={40} required onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
      </label>
      <label className="chadm-field">
        <span>Number</span>
        <input id="ch-number" type="number" min={1} max={999} value={number} required onChange={(e) => setNumber(e.target.value)} />
      </label>
      <label className="chadm-field chadm-full">
        <span>Web address</span>
        <div className="chadm-slug">
          <span>/live/</span>
          <input id="ch-slug" value={isMain ? '' : slug} placeholder={isMain ? '(main channel lives at /live)' : 'tapa-after-dark'} disabled={isMain} required={!isMain} onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugTouched(true); }} />
        </div>
        {!isNew && !isMain && channel.visibility === 'public' && slug !== channel.slug && <small className="chadm-warn">Changing this breaks old links to /live/{channel.slug}.</small>}
      </label>
      <label className="chadm-field chadm-full">
        <span>Short description</span>
        <textarea id="ch-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's on this channel, in a sentence." />
      </label>

      <div className="chadm-field">
        <span>Logo · square, shown in the channel list</span>
        <div className="chadm-upload">
          {logoPreview ? <img src={logoPreview} alt="" className="chadm-logo" /> : <div className="chadm-logo chadm-logo-empty">—</div>}
          <input id="ch-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => pickFile(e, 'logo')} />
          {logoPreview && <button type="button" className="chadm-linkbtn" onClick={() => { setLogo(null); setClearLogo(true); }}>Remove</button>}
        </div>
      </div>
      <div className="chadm-field">
        <span>Channel image · 16:9, shown on the channel card</span>
        <div className="chadm-upload">
          {imagePreview ? <div className="chadm-img chadm-img-sm" style={{ backgroundImage: `url(${imagePreview})` }} /> : <div className="chadm-img chadm-img-sm"><span>—</span></div>}
          <input id="ch-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickFile(e, 'image')} />
          {imagePreview && <button type="button" className="chadm-linkbtn" onClick={() => { setImage(null); setClearImage(true); }}>Remove</button>}
        </div>
      </div>
      {fileError && <div className="house-ad-error chadm-full" role="alert">{fileError}</div>}

      {!isMain && (
        <fieldset className="chadm-field chadm-full chadm-vis">
          <legend>Who can see it</legend>
          <label><input type="radio" name="vis" checked={visibility === 'draft'} onChange={() => setVisibility('draft')} /> <span><b>Draft</b><small>Schedulers can build it. Viewers can&rsquo;t see it yet.</small></span></label>
          <label><input type="radio" name="vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> <span><b>Public</b><small>Listed at /live for everyone.</small></span></label>
        </fieldset>
      )}

      <div className="chadm-form-acts chadm-full">
        <button type="button" className="account-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="account-btn-primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create channel' : 'Save changes'}</button>
      </div>
    </form>
  );
}
