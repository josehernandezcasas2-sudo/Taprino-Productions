import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './CrewBits';
import TierChip from './TierChip';
import { shrinkImage } from '../locations/LocationBits';
import { UNION_STATUS, SKILL_SUGGESTIONS, MAX_HEADSHOTS, MAX_SKILLS } from '../../lib/crewOptions';

// Casting (migration 106): the performer side of a working card, the
// Cast tab's cards, and the self-tape field on a casting call.

export function playingAge(min, max) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? `plays ${min}` : `plays ${min}–${max}`;
  return `plays ${min != null ? `${min}+` : `up to ${max}`}`;
}

// The read-only performer block (profile card, directory).
export function PerformerFacts({ card, compact = false }) {
  if (!card || !card.performer) return null;
  const facts = [playingAge(card.playingAgeMin, card.playingAgeMax), card.unionLabel].filter(Boolean);
  return (
    <div className="cast-facts">
      {!compact && card.headshots && card.headshots.length > 0 && (
        <div className="cast-shots">{card.headshots.map((h) => <img key={h.id || h.url} src={h.url} alt="" loading="lazy" />)}</div>
      )}
      <div className="crew-pmeta">
        <span className="crew-chip olive">Performer</span>
        {facts.map((f) => <span key={f}>{f}</span>)}
        {card.reelUrl && <a href={card.reelUrl} target="_blank" rel="noopener noreferrer">Reel ↗</a>}
      </div>
      {card.skills && card.skills.length > 0 && <div className="crew-chips">{card.skills.map((s) => <span key={s} className="crew-chip">{s}</span>)}</div>}
    </div>
  );
}

// One performer on the Cast tab.
export function CastCard({ p, signedIn, MessageLink }) {
  const shot = p.headshots && p.headshots[0] ? p.headshots[0].url : null;
  const where = [p.place, p.miles != null ? `${p.miles} mi` : null].filter(Boolean).join(' · ');
  return (
    <article className="crew-panel cast-card">
      <Link href={p.profilePath} className="cast-card-shot">
        {shot ? <img src={shot} alt="" loading="lazy" /> : <div className="cast-card-ph"><Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="lg" /></div>}
        {p.freeNow && <span className="crew-chip urgent cast-card-free">⚡ free right now</span>}
      </Link>
      <div className="cast-card-body">
        <div className="crew-pname"><Link href={p.profilePath}>{p.displayName}</Link>{p.verified && <span className="crew-ver">✓ creator</span>}{p.tier && <TierChip person={p} />}</div>
        <div className="crew-pmeta">
          {playingAge(p.playingAgeMin, p.playingAgeMax) && <span>{playingAge(p.playingAgeMin, p.playingAgeMax)}</span>}
          {p.unionLabel && <span>{p.unionLabel}</span>}
          {where && <span>{where}</span>}
        </div>
        <div className="crew-chips">{p.roles.filter((r) => r !== 'Actor' || p.roles.length === 1).slice(0, 3).map((r) => <span key={r} className="crew-chip role">{r}</span>)}{(p.skills || []).slice(0, 4).map((s) => <span key={s} className="crew-chip">{s}</span>)}</div>
        <div className="crew-actions">
          {p.reelUrl && <a href={p.reelUrl} target="_blank" rel="noopener noreferrer" className="crew-btn sm">Reel ↗</a>}
          {MessageLink && <MessageLink signedIn={signedIn} userId={p.userId} kind="card" label={`${p.displayName}’s card`} className="crew-btn sm primary">Message</MessageLink>}
        </div>
      </div>
    </article>
  );
}

// The editor's performer section. `form`/`set` are the card page's.
export function PerformerEditor({ form, set, onError }) {
  const [skill, setSkill] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  function addSkill(raw) {
    const parts = String(raw || skill).split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    set({ skills: [...new Set([...form.skills, ...parts])].slice(0, MAX_SKILLS) });
    setSkill('');
  }

  async function addHeadshots(files) {
    const list = [...(files || [])].slice(0, MAX_HEADSHOTS - form.headshots.length);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const file of list) {
        const base64 = await shrinkImage(file, 1600);
        const res = await fetch('/api/crew/headshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64, fileName: `${file.name.replace(/\.[^.]+$/, '')}.jpg` }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed.');
        set({ headshots: [...form.headshots, { url: data.url }] });
        form.headshots = [...form.headshots, { url: data.url }]; // keep the loop's view current
      }
    } catch (err) {
      if (onError) onError(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section className="crew-panel">
      <h3>Performer <small>acting, voice, background, dance…</small></h3>
      <label className="crew-check">
        <input type="checkbox" checked={form.performer} onChange={(e) => set({ performer: e.target.checked })} />
        <span>I perform — list me on the <b>Cast</b> tab and send me casting calls</span>
      </label>
      {form.performer && (
        <>
          <div className="crew-row2">
            <div className="crew-field"><span>Playing age</span>
              <div className="crew-row2">
                <input type="number" className="crew-input" min="0" max="110" placeholder="from" value={form.playingAgeMin} onChange={(e) => set({ playingAgeMin: e.target.value })} aria-label="Playing age from" />
                <input type="number" className="crew-input" min="0" max="110" placeholder="to" value={form.playingAgeMax} onChange={(e) => set({ playingAgeMax: e.target.value })} aria-label="Playing age to" />
              </div>
            </div>
            <label className="crew-field"><span>Union</span>
              <select className="crew-select" value={form.unionStatus} onChange={(e) => set({ unionStatus: e.target.value })}>
                <option value="">Prefer not to say</option>
                {Object.entries(UNION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <label className="crew-field"><span>Reel</span><input type="url" className="crew-input" placeholder="https://vimeo.com/… or an unlisted YouTube link" value={form.reelUrl} onChange={(e) => set({ reelUrl: e.target.value })} /></label>
          <div className="crew-field"><span>Skills</span>
            <div className="crew-chips">
              {form.skills.map((s) => <span key={s} className="crew-chip">{s} <button type="button" className="crew-chip-x" onClick={() => set({ skills: form.skills.filter((x) => x !== s) })} aria-label={`Remove ${s}`}>✕</button></span>)}
            </div>
            <div className="crew-chips crew-filterchips">
              {SKILL_SUGGESTIONS.filter((s) => !form.skills.includes(s)).slice(0, 12).map((s) => <button key={s} type="button" onClick={() => addSkill(s)}>+ {s}</button>)}
            </div>
            <div className="crew-place-row">
              <input type="text" className="crew-input" placeholder="Anything else (accents, instruments…)" value={skill} onChange={(e) => setSkill(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} aria-label="Add a skill" />
              <button type="button" className="crew-btn sm" onClick={() => addSkill()}>Add</button>
            </div>
          </div>
          <div className="crew-field"><span>Headshots <small>up to {MAX_HEADSHOTS}</small></span>
            <div className="cast-shots cast-shots-edit">
              {form.headshots.map((h, i) => (
                <div key={h.url} className="cast-shot-edit">
                  <img src={h.url} alt="" />
                  <button type="button" className="crew-btn sm ghost" onClick={() => set({ headshots: form.headshots.filter((_, j) => j !== i) })} aria-label="Remove headshot">✕</button>
                </div>
              ))}
              {form.headshots.length < MAX_HEADSHOTS && (
                <label className={`cast-shot-add${busy ? ' busy' : ''}`}>
                  <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => addHeadshots(e.target.files)} disabled={busy} />
                  <span>{busy ? 'Uploading…' : '+ Add'}</span>
                </label>
              )}
            </div>
            <span className="crew-mono">Shrunk to 1600px before upload. The first one is your card photo on the Cast tab.</span>
          </div>
        </>
      )}
    </section>
  );
}

// A self-tape: paste a link, or upload a file straight to Cloudflare
// Stream (TUS, resumable). `value` is { url, uid }; `onChange` gets the
// same shape.
export function SelfTapeField({ value, onChange, due, callId }) {
  const [stage, setStage] = useState('idle'); // idle | uploading | transcoding | ready | error
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  const polls = useRef(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function poll(uid) {
    const tick = async () => {
      if (polls.current++ > 200) { setStage('error'); setMsg('Gave up waiting on the upload — try again.'); return; }
      try {
        const res = await fetch(`/api/crew/self-tape-upload-url?uid=${encodeURIComponent(uid)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lost track of the upload.');
        if (data.stage === 'error') { setStage('error'); setMsg(data.error); return; }
        if (data.stage === 'ready') { setStage('ready'); onChange({ url: value && value.url ? value.url : null, uid }); return; }
        if (typeof data.pctComplete === 'number') setPct(data.pctComplete);
        timer.current = setTimeout(tick, 3000);
      } catch (err) { setStage('error'); setMsg(err.message); }
    };
    tick();
  }

  async function handleFile(file) {
    if (!file) return;
    setStage('uploading');
    setPct(0);
    setMsg(file.name);
    try {
      const tus = await import('tus-js-client');
      const urlRes = await fetch('/api/crew/self-tape-upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileSize: file.size, fileName: file.name, callId }) });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not start the upload.');
      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: urlData.uploadUrl,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          metadata: { filename: file.name, filetype: file.type },
          onError: reject,
          onProgress: (up, total) => setPct(Math.round((up / total) * 100)),
          onSuccess: resolve
        });
        upload.start();
      });
      setStage('transcoding');
      setPct(0);
      polls.current = 0;
      poll(urlData.uid);
    } catch (err) {
      setStage('error');
      setMsg(err.message || 'The upload failed.');
    }
  }

  return (
    <div className="cast-tape">
      <label className="crew-field"><span>Self-tape link{due ? ` · due ${new Date(`${due}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
        <input type="url" className="crew-input" placeholder="Unlisted YouTube, Vimeo or Drive link" value={(value && value.url) || ''} onChange={(e) => onChange({ url: e.target.value, uid: value ? value.uid : null })} />
      </label>
      <div className="cast-tape-or">
        <span className="crew-mono">or upload the file</span>
        {stage === 'idle' && <input type="file" accept="video/*" onChange={(e) => handleFile(e.target.files[0])} />}
        {stage === 'uploading' && <span className="crew-mono">Uploading {msg}… {pct}%</span>}
        {stage === 'transcoding' && <span className="crew-mono">Processing the video…</span>}
        {(stage === 'uploading' || stage === 'transcoding') && <div className="upload-widget-bar"><div className="upload-widget-bar-fill" style={{ width: `${pct}%` }} /></div>}
        {stage === 'ready' && <span className="crew-chip ok">✓ Tape uploaded</span>}
        {value && value.uid && stage === 'idle' && <span className="crew-chip ok">✓ Tape attached</span>}
        {stage === 'error' && <><span className="crew-status error">{msg}</span><button type="button" className="crew-btn sm ghost" onClick={() => setStage('idle')}>Try again</button></>}
      </div>
    </div>
  );
}

// Plays an uploaded self-tape (signed HLS) for the poster.
export function TapePlayer({ callId, responseId }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    let hls = null;
    (async () => {
      try {
        const res = await fetch(`/api/crew/self-tape-play?callId=${encodeURIComponent(callId)}&responseId=${encodeURIComponent(responseId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not open the tape.');
        if (!alive) return;
        setSrc(data.url);
        const video = ref.current;
        if (!video) return;
        if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = data.url; return; }
        const Hls = (await import('hls.js')).default;
        if (Hls.isSupported()) { hls = new Hls(); hls.loadSource(data.url); hls.attachMedia(video); }
        else setErr('This browser can’t play the tape — open it on a phone or in Safari.');
      } catch (e) { if (alive) setErr(e.message); }
    })();
    return () => { alive = false; if (hls) hls.destroy(); };
  }, [callId, responseId]);
  return (
    <div className="cast-player">
      <video ref={ref} controls playsInline style={{ width: '100%', borderRadius: 8, background: '#000', display: src ? 'block' : 'none' }} />
      {!src && !err && <span className="crew-mono">Opening the tape…</span>}
      {err && <span className="crew-status error">{err}</span>}
    </div>
  );
}
