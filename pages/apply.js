import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import { SITE } from '../lib/siteConfig';

import Footer from '../components/Footer';
const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];

export async function getServerSideProps({ req }) {
  const account = await getAccountContext(req);
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

const EMPTY = {
  name: '', email: '', portfolioUrl: '',
  title: '', logline: '', description: '',
  contentType: 'film', mainGenre: MAIN_GENRES[0], runtime: '', completionStatus: 'finished',
  mediaLink: '', mediaNotes: ''
};

export default function Apply({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [form, setForm] = useState({ ...EMPTY, email: email || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send your application.');
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Submit your work — {SITE.name}</title>
        <meta name="description" content={`Apply to have your film or series distributed on ${SITE.name}.`} />
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

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Submit your work</div>
        <p className="library-sub" style={{ marginBottom: '1.2rem' }}>
          Tell us about your film or series — we&rsquo;ll reach out if it looks like a fit.
        </p>

        {isCreator && (
          <div className="draft-banner" style={{ marginBottom: '1.2rem' }}>
            Already approved as a creator? Head to your{' '}
            <Link href="/creator" style={{ color: 'var(--brass)' }}>Creator Studio →</Link>{' '}
            to submit a new episode directly — no need to pitch it here first.
          </div>
        )}

        {sent ? (
          <div className="account-card">
            <div className="apply-success">
              <h2>Got it — thanks.</h2>
              <p>
                We read every application. If your work looks like a fit, we&rsquo;ll email you at{' '}
                <strong>{form.email}</strong> to talk about next steps and how to get the files over
                to us.
              </p>
              <p className="apply-fineprint">
                We don&rsquo;t send rejections for every application — if you haven&rsquo;t heard back
                in a few weeks, it&rsquo;s not a fit right now, but you&rsquo;re welcome to apply again
                with something new.
              </p>
            </div>
          </div>
        ) : (
          <div className="account-card">
            <div className="account-eyebrow">How this works</div>
            <p style={{ marginBottom: '1.2rem' }}>
              Tell us about your work below — no file upload needed here. If it looks like a fit,
              we&rsquo;ll reach out and arrange getting the actual files from you, then handle the
              encoding, captions, and publishing on our end. You keep ownership of everything you make.
            </p>

            <form onSubmit={submit} className="admin-edit-form apply-form">
              <div className="eyebrow apply-section">About you</div>

              <div className="admin-field-row">
                <div className="admin-field">
                  <label>Your name</label>
                  <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} required />
                </div>
                <div className="admin-field">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
                </div>
              </div>

              <div className="admin-field">
                <label>Portfolio or reel <span className="admin-optional">optional</span></label>
                <input type="url" value={form.portfolioUrl} onChange={(e) => update('portfolioUrl', e.target.value)} placeholder="https://" />
              </div>

              <div className="eyebrow apply-section">About the work</div>

              <div className="admin-field">
                <label>Title</label>
                <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />
              </div>

              <div className="admin-field">
                <label>Logline — one sentence</label>
                <input type="text" value={form.logline} onChange={(e) => update('logline', e.target.value)} maxLength={200} required />
              </div>

              <div className="admin-field">
                <label>Tell us more <span className="admin-optional">optional</span></label>
                <textarea rows={4} value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="What it's about, who made it, where it's screened, anything else worth knowing." />
              </div>

              <div className="admin-field-row">
                <div className="admin-field">
                  <label>Type</label>
                  <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)}>
                    <option value="film">Film</option>
                    <option value="series">Series</option>
                    <option value="other">Something else</option>
                  </select>
                </div>
                <div className="admin-field">
                  <label>Genre</label>
                  <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)}>
                    {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div className="admin-field-row">
                <div className="admin-field">
                  <label>Runtime <span className="admin-optional">approx.</span></label>
                  <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} placeholder="e.g. 12 min, or 6 × 20 min" />
                </div>
                <div className="admin-field">
                  <label>Where it stands</label>
                  <select value={form.completionStatus} onChange={(e) => update('completionStatus', e.target.value)}>
                    <option value="finished">Finished and ready</option>
                    <option value="in_progress">In progress</option>
                    <option value="concept">Concept / seeking support</option>
                  </select>
                </div>
              </div>

              <div className="eyebrow apply-section">The files</div>

              <div className="admin-field">
                <label>Link to the files <span className="admin-optional">if you have them ready</span></label>
                <input type="url" value={form.mediaLink} onChange={(e) => update('mediaLink', e.target.value)} placeholder="Google Drive, Dropbox, WeTransfer, Frame.io…" />
                <p className="admin-field-hint">
                  Wherever the files already live is fine — there&rsquo;s nothing to upload here.
                  Send the highest quality master you have; we handle compressing it for streaming.
                </p>
              </div>

              <div className="admin-field">
                <label>Format notes <span className="admin-optional">optional</span></label>
                <textarea rows={2} value={form.mediaNotes} onChange={(e) => update('mediaNotes', e.target.value)} placeholder="Resolution, codec, whether captions exist, link password — anything we'd need to know." />
              </div>

              {error && <p className="admin-error">{error}</p>}

              <div className="admin-actions">
                <button className="account-btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Sending…' : 'Send application'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
