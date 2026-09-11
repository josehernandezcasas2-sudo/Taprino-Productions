import { useState, useEffect } from 'react';
import { useDraftAutosave } from '../lib/useDraftAutosave';
import { PITCH_TAGS } from '../lib/pitches';

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

// Genuinely separate from CreatorSubmissionForm/AddSeriesForm the same
// way those two are separate from each other — a pitch is neither an
// episode nor a series, it's a Pitch Room listing with its own funding
// fields and its own endpoint (api/creator/create-pitch.js).
export default function AddPitchForm({ onSubmitted }) {
  const [form, setForm] = useState({ title: '', logline: '', description: '', projectUrl: '', tag: '', fundingGoal: '', fundingRaised: '', fundingDeadline: '' });
  const [team, setTeam] = useState([{ name: '', role: '' }]);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [heroFile, setHeroFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { existingDraft, scheduleSave, clearDraft, dismissDraft } = useDraftAutosave('pitch');
  const [draftApplied, setDraftApplied] = useState(false);

  // Same guard as the original standalone page: don't let a fresh mount
  // autosave over a draft the person hasn't been offered a chance to
  // resume or discard yet.
  const readyToAutosave = existingDraft === null || draftApplied;
  useEffect(() => {
    if (readyToAutosave && (form.title.trim() || form.logline.trim())) {
      scheduleSave({ form, team });
    }
  }, [form, team, readyToAutosave, scheduleSave]);

  function resumeDraft() {
    if (existingDraft) {
      if (existingDraft.form) setForm(existingDraft.form);
      if (existingDraft.team) setTeam(existingDraft.team);
    }
    setDraftApplied(true);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updateTeamMember(i, field, value) {
    setTeam((t) => t.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const [thumbnailBase64, heroImageBase64] = await Promise.all([readAsDataUrl(thumbnailFile), readAsDataUrl(heroFile)]);
      const res = await fetch('/api/creator/create-pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          team: team.filter((m) => m.name.trim()),
          thumbnailBase64,
          thumbnailFileName: thumbnailFile && thumbnailFile.name,
          heroImageBase64,
          heroImageFileName: heroFile && heroFile.name
        })
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(res.status === 413 ? 'That image is too large — please use a smaller file.' : `Something went wrong (status ${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || 'Could not submit your project.');
      clearDraft();
      if (onSubmitted) onSubmitted({ ...data, title: form.title });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
        This goes to Studio Tapa for review before it appears in the Pitch Room — you&rsquo;ll see its
        status on your dashboard once submitted.
      </p>

      {existingDraft && !draftApplied && (
        <div className="account-card" style={{ background: 'rgba(217,143,62,0.1)', border: '1px solid rgba(217,143,62,0.3)', marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 0.8rem' }}>You have an unsaved draft of a project pitch. Resume where you left off?</p>
          <button className="account-btn-primary" type="button" style={{ width: 'auto', marginRight: '0.6rem' }} onClick={resumeDraft}>Resume draft</button>
          <button className="account-btn-secondary" type="button" style={{ width: 'auto' }} onClick={dismissDraft}>Start fresh</button>
        </div>
      )}

      <label>Title</label>
      <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />

      <label>Logline <span style={{ fontWeight: 'normal', opacity: 0.65 }}>one sentence</span></label>
      <input type="text" value={form.logline} onChange={(e) => update('logline', e.target.value)} required />

      <label>Full description <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
      <textarea value={form.description} onChange={(e) => update('description', e.target.value)} rows={4} style={{ width: '100%', boxSizing: 'border-box' }} />

      <label>Project type</label>
      <select value={form.tag} onChange={(e) => update('tag', e.target.value)} required>
        <option value="">Choose one…</option>
        {PITCH_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      <label>Where should &ldquo;Fund this project&rdquo; send people? <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — you can add this later</span></label>
      <input type="url" value={form.projectUrl} onChange={(e) => update('projectUrl', e.target.value)} placeholder="https://kickstarter.com/..." />

      <div className="admin-field-row cols-3">
        <div className="admin-field">
          <label>Funding goal <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional, self-reported</span></label>
          <input type="number" min="0" value={form.fundingGoal} onChange={(e) => update('fundingGoal', e.target.value)} />
        </div>
        <div className="admin-field">
          <label>Raised so far <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
          <input type="number" min="0" value={form.fundingRaised} onChange={(e) => update('fundingRaised', e.target.value)} />
        </div>
        <div className="admin-field">
          <label>Funding deadline <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
          <input type="date" value={form.fundingDeadline} onChange={(e) => update('fundingDeadline', e.target.value)} />
        </div>
      </div>

      <label>Thumbnail <span style={{ fontWeight: 'normal', opacity: 0.65 }}>shown in the Pitch Room grid</span></label>
      <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

      <label>Hero image <span style={{ fontWeight: 'normal', opacity: 0.65 }}>the banner on your project page</span></label>
      <input type="file" accept="image/*" onChange={(e) => setHeroFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

      <label>Team</label>
      {team.map((member, i) => (
        <div key={i} className="admin-field-row" style={{ marginBottom: '0.4rem' }}>
          <input type="text" placeholder="Name" value={member.name} onChange={(e) => updateTeamMember(i, 'name', e.target.value)} />
          <input type="text" placeholder="Role" value={member.role} onChange={(e) => updateTeamMember(i, 'role', e.target.value)} />
        </div>
      ))}
      <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: '1rem' }} onClick={() => setTeam((t) => [...t, { name: '', role: '' }])}>
        + Add team member
      </button>

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.6rem' }}>{error}</p>}

      <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto', display: 'block' }}>
        {saving ? 'Submitting…' : 'Submit for review'}
      </button>
    </form>
  );
}
