import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { PITCH_TAGS } from '../../../lib/pitches';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import { SITE } from '../../../lib/siteConfig';

export async function getServerSideProps({ req }) {
  const account = await getAccountContext(req);
  // Same gate as the video-episode submission page — pitch submission
  // requires the creator role, not just any signed-in account.
  if (!account.isCreator) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres
    }
  };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export default function NewPitch({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres }) {
  const router = useRouter();
  const [form, setForm] = useState({ title: '', logline: '', description: '', projectUrl: '', tag: '', fundingGoal: '', fundingRaised: '' });
  const [team, setTeam] = useState([{ name: '', role: '' }]);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [heroFile, setHeroFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit your project.');
      router.push('/creator/pitch/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Head>
        <title>Submit a project — Pitch Room — {SITE.name}</title>
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single">
        <Link href="/pitches" className="library-back">&larr; Back to Pitch Room</Link>
        <h1>Submit a project</h1>
        <p className="ca-sub">
          This goes to Studio Tapa for review before it appears in the Pitch Room — you'll see its
          status on your dashboard once submitted.
        </p>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
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

          <label>Where should "Fund this project" send people? <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — you can add this later</span></label>
          <input type="url" value={form.projectUrl} onChange={(e) => update('projectUrl', e.target.value)} placeholder="https://kickstarter.com/..." />

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Funding goal <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional, self-reported</span></label>
              <input type="number" min="0" value={form.fundingGoal} onChange={(e) => update('fundingGoal', e.target.value)} />
            </div>
            <div className="admin-field">
              <label>Raised so far <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
              <input type="number" min="0" value={form.fundingRaised} onChange={(e) => update('fundingRaised', e.target.value)} />
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

          <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto', display: 'block' }}>
            {saving ? 'Submitting…' : 'Submit for review'}
          </button>
        </form>
      </main>
      <Footer />
    </>
  );
}
