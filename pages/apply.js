import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { SignInButton, useUser } from '@clerk/nextjs';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getOwnApplication } from '../lib/creatorApplications';
import {
  ONBOARDING, APPLICATION_TYPES, APPLICATION_RATINGS, APPLICATION_STATUSES, APPLICATION_GENRES, APPLICATION_STATUS_LABEL,
  rightsVerdict, runtimeClock, bytesLabel, videoStateLine
} from '../lib/creatorRights';
import { readVideoMetadata } from '../lib/videoMetadata';
import { useUpload } from '../contexts/UploadContext';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import RightsCheck from '../components/RightsCheck';
import { SITE } from '../lib/siteConfig';

// Creator onboarding, one short page (2026-10-31, from the creator-path
// canvas): the master starts uploading the moment it's dropped and keeps
// going while the applicant fills in six fields, answers the five rights
// questions and ticks one sentence. Accept on our side puts it live.
//
// The same URL shows where the application stands afterwards: Under
// review (with the upload's progress), You're in · Live, One thing to
// fix (replace the file), or Not this time. Replaces the four-part
// handbook that lived here (what we take → rights → form → next steps;
// the "what we take" cards survive at the foot of the page).
export async function getServerSideProps({ req, res, query }) {
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession || query.preview) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  }

  const account = await getAccountContext(req);
  // Admin preview (/admin/applications → Preview applicant page): the page
  // as a new applicant sees it, which an admin otherwise never can (they
  // count as a creator). visitor = signed out, as from an invite email;
  // member = signed in with no application. Sending is off.
  const preview = (account.isAdmin || account.canAccessAdmin) && ['visitor', 'member'].includes(query.preview) ? query.preview : null;
  const [episodes, application] = await Promise.all([
    getPublicEpisodes(),
    account.isSignedIn && !preview ? getOwnApplication(account.userId) : Promise.resolve(null)
  ]);
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: preview ? preview === 'member' : account.isSignedIn,
      isSubscriber: preview ? false : account.isSubscriber,
      email: preview ? null : account.email,
      isAdmin: preview ? false : account.isAdmin,
      isCreator: preview ? false : account.isCreator,
      application,
      preview
    }
  };
}

const EMPTY = {
  title: '', contentType: 'short', logline: '', mainGenre: 'Drama', rating: APPLICATION_RATINGS[0], completionStatus: 'finished',
  name: '', portfolioUrl: '', mediaLink: ''
};

const TYPE_PILLS = [
  { value: 'short', label: 'Short' },
  { value: 'film', label: 'Film' },
  { value: 'series', label: 'Series' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'vertical', label: 'Snippet' }
];

const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm,.mp3,.m4a';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '');

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { data });
  return data;
}

export default function Apply({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, application, preview = null }) {
  const { isSignedIn: clerkSignedIn, user } = useUser();
  const { activeUpload, startVideoUpload } = useUpload();
  // The server knew at render time; Clerk's modal sign-in updates the
  // client without a reload, so trust either.
  const signedIn = preview ? preview === 'member' : (isSignedIn || Boolean(clerkSignedIn));
  const shownEmail = preview ? 'applicant@example.com' : (email || (user && user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : null));

  const [app, setApp] = useState(application);
  const [creator, setCreator] = useState(isCreator);
  const [reapply, setReapply] = useState(false);
  const [answers, setAnswers] = useState({});
  const [attested, setAttested] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The master: { uid, uploadUrl, name, bytes, runtimeSeconds, width, height }
  // from the first second of the upload; `pendingFile` waits for sign-in.
  const [video, setVideo] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [over, setOver] = useState(false);
  const tusUrlRef = useRef(null);
  const appRef = useRef(app);
  appRef.current = app;

  // Signed in through the modal after the page loaded: find out whether
  // this account already has an application or Creator Studio.
  useEffect(() => {
    if (preview || isSignedIn || !clerkSignedIn) return;
    let cancelled = false;
    fetch('/api/apply').then((r) => r.json()).then((data) => {
      if (cancelled || !data) return;
      if (data.application) setApp(data.application);
      if (data.isCreator) setCreator(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isSignedIn, clerkSignedIn, preview]);

  const refreshApp = useCallback(async () => {
    try {
      const res = await fetch('/api/apply');
      const data = await res.json();
      if (res.ok && data.application) setApp(data.application);
    } catch {
      // The next poll or reload catches up.
    }
  }, []);

  // Keeps the row's resumable address current once the application exists.
  const storeUploadUrl = useCallback(async (uid, url) => {
    const current = appRef.current;
    if (!current || !current.video || current.video.uid !== uid || current.video.uploadUrl === url) return;
    try {
      const data = await postJson('/api/apply/video', { id: current.id, videoUid: uid, uploadUrl: url, videoName: current.video.name, videoBytes: current.video.bytes, runtimeSeconds: current.video.runtimeSeconds });
      setApp(data.application);
    } catch {
      // Best effort: the upload itself is unaffected.
    }
  }, []);

  // Starts (or resumes) the master's upload and remembers what we know
  // about the file. `resumeUrl` is the row's kept address.
  const beginUpload = useCallback(async (file, { resumeUrl = null } = {}) => {
    setError(null);
    let meta = { duration: null, width: null, height: null };
    try {
      meta = await readVideoMetadata(file);
    } catch {
      // An audio file or a codec the browser can't read: Cloudflare tells us the runtime later.
    }
    try {
      const started = await startVideoUpload(file, {
        urlEndpoint: '/api/apply/upload-url',
        resumeUrl,
        onUrl: (url) => { tusUrlRef.current = url; storeUploadUrl(started.uid, url); }
      });
      const info = { uid: started.uid, uploadUrl: resumeUrl || null, name: file.name, bytes: file.size, runtimeSeconds: meta.duration ? Math.round(meta.duration) : null, width: meta.width, height: meta.height };
      setVideo(info);
      started.done.then(() => refreshApp()).catch(() => {});
      return info;
    } catch (err) {
      if (err && err.data && err.data.code === 'already_creator') setCreator(true);
      setError(err.message || 'Could not start the upload.');
      return null;
    }
  }, [startVideoUpload, storeUploadUrl, refreshApp]);

  // A file dropped before signing in waits for the account.
  useEffect(() => {
    if (!pendingFile || !signedIn || preview) return;
    const f = pendingFile;
    setPendingFile(null);
    beginUpload(f);
  }, [pendingFile, signedIn, preview, beginUpload]);

  // While Cloudflare is still receiving or processing the master, ask
  // every few seconds where it stands (the server refreshes the row).
  const uploadingHere = Boolean(activeUpload && activeUpload.videoOnly && app && app.video && activeUpload.uid === app.video.uid && ['requesting-url', 'uploading'].includes(activeUpload.status));
  const waitingOnCloudflare = Boolean(app && app.isOpen && app.video && ['uploading', 'processing'].includes(app.video.state) && !uploadingHere);
  useEffect(() => {
    if (!waitingOnCloudflare) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > 100) { clearInterval(t); return; }
      refreshApp();
    }, 6000);
    return () => clearInterval(t);
  }, [waitingOnCloudflare, refreshApp]);

  const verdict = rightsVerdict(answers);
  const showForm = !creator && (!app || (app.status === 'declined' && reapply));
  const hasFile = Boolean(video) || Boolean(form.mediaLink.trim());

  // Why "Send" is off, in the order the applicant should fix things.
  let blocker = null;
  if (!hasFile) blocker = 'Drop the master in, or paste a link to it.';
  else if (!form.title.trim()) blocker = 'Give it a title.';
  else if (!form.logline.trim()) blocker = 'One line about it.';
  else if (!verdict.complete) blocker = `Answer all five rights questions (${verdict.answered} of 5 so far).`;
  else if (verdict.result === 'blocked') blocker = 'Only the rights holder can apply.';
  else if (!signedIn) blocker = 'Sign in (free) so we can attach this to your account.';
  else if (!form.name.trim()) blocker = 'Your name, as credited.';
  else if (!attested) blocker = 'Tick the rights sentence.';
  else if (preview) blocker = 'Preview: sending is off.';

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function pickFile(file) {
    if (!file) return;
    if (preview) { setError('Preview: the upload is off.'); return; }
    if (!signedIn) { setPendingFile(file); return; }
    if (!form.title.trim()) update('title', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    beginUpload(file);
  }

  async function submit(e) {
    e.preventDefault();
    if (blocker) { setError(blocker); return; }
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        rightsAnswers: answers,
        rightsAttested: true,
        ...(video ? { videoUid: video.uid, videoName: video.name, videoBytes: video.bytes, runtimeSeconds: video.runtimeSeconds, uploadUrl: tusUrlRef.current || video.uploadUrl || null } : {})
      };
      const data = await postJson('/api/apply', body);
      setApp(data.application);
      setReapply(false);
      setForm(EMPTY);
      setAnswers({});
      setAttested(false);
      setVideo(null);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err.data && err.data.application) setApp(err.data.application);
      if (err.data && err.data.code === 'already_creator') setCreator(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // The status card's Replace the file (and the resume of a stopped upload).
  async function replaceFile(file, { resume = false } = {}) {
    if (!file || !app) return;
    const sameFile = resume && app.video && app.video.uploadUrl && file.size === app.video.bytes;
    const info = await beginUpload(file, { resumeUrl: sameFile ? app.video.uploadUrl : null });
    if (!info) return;
    if (sameFile) return; // the row already names this upload
    try {
      const data = await postJson('/api/apply/video', { id: app.id, videoUid: info.uid, videoName: info.name, videoBytes: info.bytes, runtimeSeconds: info.runtimeSeconds, uploadUrl: tusUrlRef.current || null });
      setApp(data.application);
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendArtwork({ poster, still }) {
    if (!app) return;
    setBusy(true);
    setError(null);
    try {
      const [posterBase64, thumbnailBase64] = await Promise.all([readAsDataUrl(poster), readAsDataUrl(still)]);
      const data = await postJson('/api/apply/artwork', { id: app.id, posterBase64, posterFileName: poster ? poster.name : null, thumbnailBase64, thumbnailFileName: still ? still.name : null });
      setApp(data.application);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const uploadNow = activeUpload && activeUpload.videoOnly && video && activeUpload.uid === video.uid ? activeUpload : null;

  return (
    <>
      <Head>
        <title>Send us your film — {SITE.name}</title>
        <meta name="description" content={`How to get your film, short, series or podcast on ${SITE.name}: one page, the master uploads while you fill it in, and if it's a fit it goes live.`} />
      </Head>

      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={signedIn} email={shownEmail} isAdmin={isAdmin} isCreator={creator} isSubscriber={isSubscriber} />

      {preview && (
        <div className="apply-preview-bar" role="status">
          <span><b>Preview</b> · what {preview === 'visitor' ? 'a signed-out visitor (someone opening an invite)' : 'a signed-in person with no application'} sees. Sending is off.</span>
          <span className="apply-preview-links">
            {preview === 'visitor' ? <Link href="/apply?preview=member">See it signed in</Link> : <Link href="/apply?preview=visitor">See it signed out</Link>}
            <Link href="/admin/applications">Back to Applications</Link>
          </span>
        </div>
      )}

      <main id="main-content" className="apl">
        <div className="apl-head">
          <div className="apl-eyebrow">For creators</div>
          <h1 className="apl-h1">{app && !showForm ? 'Your application' : 'Send us your film.'}</h1>
          {showForm && (
            <p className="apl-lede">
              One page. The master uploads while you fill in the rest, we watch it, and if it&rsquo;s a fit it goes live with you
              keeping every right. <a href="#what">What we take and what we pass on</a> · <Link href="/terms#submit-work">Terms, section 5</Link>
            </p>
          )}
        </div>

        {creator && (
          <div className="apl-status level-ok">
            <span className="apl-status-tag">Creator Studio</span>
            <div className="apl-status-title">You already have Creator Studio.</div>
            <p>No need to apply. Submit films, shorts and everything else there, and track their review.</p>
            <div className="apl-actions"><Link href="/creator" className="apl-btn">Open Creator Studio</Link></div>
          </div>
        )}

        {!creator && app && (
          <StatusCard
            app={app}
            upload={uploadingHere ? activeUpload : null}
            busy={busy}
            onReapply={() => setReapply(true)}
            reapplying={reapply}
            onReplace={(f) => replaceFile(f)}
            onResume={(f) => replaceFile(f, { resume: true })}
            onArtwork={sendArtwork}
          />
        )}

        {error && !showForm && <p className="admin-error" role="alert">{error}</p>}

        {showForm && (
          <form onSubmit={submit} noValidate>
            <section className="apl-card">
              <div className="apl-card-k">1 · The film</div>
              {!video && !linkMode && (
                <div
                  className={`apl-drop ${over ? 'is-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></svg>
                  <div className="apl-drop-title">{pendingFile ? `${pendingFile.name} is ready to go` : 'Drop the master here'}</div>
                  <div className="apl-drop-sub">
                    {pendingFile
                      ? 'Sign in (free) and it starts uploading. The application is attached to your account.'
                      : 'MP4 or MOV, any size. It starts uploading right away and keeps going while you type.'}
                  </div>
                  {signedIn && !preview ? (
                    <label className="apl-btn-ghost">
                      Browse files
                      <input type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => { pickFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                    </label>
                  ) : preview ? (
                    <button type="button" className="apl-btn-ghost" onClick={() => setError('Preview: the upload is off.')}>Browse files</button>
                  ) : pendingFile ? (
                    <SignInButton mode="modal"><button type="button" className="apl-btn-ghost">Sign in to start the upload</button></SignInButton>
                  ) : (
                    <label className="apl-btn-ghost">
                      Browse files
                      <input type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => { pickFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                    </label>
                  )}
                  <button type="button" className="apl-link" onClick={() => setLinkMode(true)}>or paste a link to it (Drive, Dropbox, WeTransfer)</button>
                </div>
              )}
              {video && <UploadProgress video={video} upload={uploadNow} onRemove={() => { setVideo(null); tusUrlRef.current = null; }} />}
              {linkMode && !video && (
                <div className="apl-field">
                  <label className="apl-label" htmlFor="apl-link">Link to the files</label>
                  <input id="apl-link" type="url" value={form.mediaLink} onChange={(e) => update('mediaLink', e.target.value)} placeholder="https://" />
                  <div className="apl-help">A share link we can open (Drive, Dropbox, WeTransfer, Frame.io). Put the password, if any, in the one line below. <button type="button" className="apl-link" onClick={() => setLinkMode(false)}>Upload the file instead</button></div>
                </div>
              )}

              <div className="apl-field">
                <label className="apl-label" htmlFor="apl-title">Title</label>
                <input id="apl-title" type="text" value={form.title} onChange={(e) => update('title', e.target.value)} maxLength={300} required />
              </div>
              <div className="apl-field">
                <div className="apl-label" id="apl-type-label">What is it</div>
                <div className="apl-pills" role="radiogroup" aria-labelledby="apl-type-label">
                  {TYPE_PILLS.map((t) => (
                    <button key={t.value} type="button" role="radio" aria-checked={form.contentType === t.value} className={`apl-pill ${form.contentType === t.value ? 'on' : ''}`} onClick={() => update('contentType', t.value)}>{t.label}</button>
                  ))}
                </div>
                {(form.contentType === 'series' || form.contentType === 'podcast') && (
                  <div className="apl-help">Send the first episode. The show is created around it when it goes live; the rest follow from Creator Studio.</div>
                )}
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="apl-logline">One line about it</label>
                <input id="apl-logline" type="text" value={form.logline} onChange={(e) => update('logline', e.target.value)} maxLength={200} required />
              </div>
              <div className="apl-grid2">
                <div className="apl-field">
                  <label className="apl-label" htmlFor="apl-genre">Genre</label>
                  <select id="apl-genre" value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)}>
                    {APPLICATION_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="apl-field">
                  <label className="apl-label" htmlFor="apl-rating">Rating</label>
                  <select id="apl-rating" value={form.rating} onChange={(e) => update('rating', e.target.value)}>
                    {APPLICATION_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="apl-stand">Where it stands</label>
                <select id="apl-stand" value={form.completionStatus} onChange={(e) => update('completionStatus', e.target.value)}>
                  {APPLICATION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </section>

            <section className="apl-card">
              <div className="apl-card-k">2 · Rights, five questions</div>
              <RightsCheck compact answers={answers} onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} />
            </section>

            <section className="apl-card">
              <div className="apl-card-k">3 · You</div>
              <div className={`apl-signed ${signedIn ? 'on' : ''}`}>
                {signedIn ? (
                  <span>Signed in as <strong>{shownEmail}</strong></span>
                ) : (
                  <>
                    <span>A free account, so the application is yours and the reply finds you.</span>
                    {preview
                      ? <button type="button" className="apl-btn-ghost small" onClick={() => setError('Preview: this opens sign-in for a real visitor.')}>Sign in or create one</button>
                      : <SignInButton mode="modal"><button type="button" className="apl-btn-ghost small">Sign in or create one</button></SignInButton>}
                  </>
                )}
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="apl-name">Your name, as credited</label>
                <input id="apl-name" type="text" value={form.name} onChange={(e) => update('name', e.target.value)} maxLength={200} required />
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="apl-portfolio">Portfolio or reel <em>optional</em></label>
                <input id="apl-portfolio" type="url" value={form.portfolioUrl} onChange={(e) => update('portfolioUrl', e.target.value)} placeholder="https://" />
              </div>
              <label className="apl-attest">
                <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                <span>I made this or hold the rights, I&rsquo;ve done the check above and will send licences for anything it flagged, and I&rsquo;ve read <Link href="/terms#submit-work" target="_blank">Terms, section 5</Link>: I keep my copyright and grant a non-exclusive licence to stream and promote.</span>
              </label>
            </section>

            {error && <p className="admin-error" role="alert">{error}</p>}

            <div className="apl-send">
              <button type="submit" className="apl-btn" disabled={busy || Boolean(blocker)}>{busy ? 'Sending…' : 'Send it in'}</button>
              <div className="apl-send-note">{blocker || (video && uploadNow && uploadNow.status === 'uploading' ? 'The upload keeps going after you send; keep this tab open until it finishes, or pick the same file again later to resume.' : `We watch it and reply within ${ONBOARDING.replyWindow}.`)}</div>
            </div>
          </form>
        )}

        <section id="what" className="apl-what">
          <div className="apl-card-k">What we take and what we pass on</div>
          <div className="onboard-guide-grid">
            <div className="onboard-card"><h3>Shorts and films</h3><p>Finished and ready to watch, made by you. Under {ONBOARDING.shortMaxMinutes} minutes is a short; narrative or documentary; student and first films welcome. Festival runs are fine as long as you still hold streaming rights.</p></div>
            <div className="onboard-card"><h3>Series, podcasts, Snippets</h3><p>Send the first episode here and the rest from Creator Studio once you&rsquo;re in. Snippets are vertical, 9:16.</p></div>
            <div className="onboard-card"><h3>What we pass on</h3><p>Trailers on their own, works in progress, re-uploads of other people&rsquo;s work, compilations, and anything you can&rsquo;t clear in the rights check.</p></div>
          </div>
          <div className="onboard-card onboard-specs">
            <div><span className="onboard-label">Master file</span><p>The best you have. MP4 or MOV, {ONBOARDING.minResolution} minimum, 4K welcome. We encode for streaming.</p></div>
            <div><span className="onboard-label">Picture &amp; sound</span><p>16:9 for films and shorts (9:16 for Snippets). Stereo mix, no burnt-in subtitles.</p></div>
            <div><span className="onboard-label">Captions &amp; artwork</span><p>Optional. Send an SRT and a 2:3 poster + 16:9 still from Your work once you&rsquo;re in; otherwise we caption what we can and cut artwork from the film.</p></div>
            <div><span className="onboard-label">What you keep</span><p>Your copyright. We get a non-exclusive licence to stream and promote (<Link href="/terms#submit-work">Terms, section 5</Link>); put the same work anywhere else.</p></div>
          </div>
        </section>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

// The master's progress while it uploads, then what we read from the file.
function UploadProgress({ video, upload, onRemove }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!upload || upload.status !== 'uploading') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [upload && upload.status]);
  const pct = upload && upload.fileSize ? Math.min(100, Math.round((upload.bytesUploaded / upload.fileSize) * 100)) : 0;
  const elapsed = upload ? Math.max(1, (Date.now() - upload.startedAt) / 1000) : 0;
  const speed = upload ? upload.bytesUploaded / elapsed : 0;
  const left = upload && speed > 0 ? Math.round((upload.fileSize - upload.bytesUploaded) / speed) : null;
  const leftLabel = left == null ? '' : left < 60 ? 'under a minute left' : `${Math.round(left / 60)} min left`;
  const status = !upload ? 'uploaded' : upload.status;
  const right = status === 'uploading' ? `${pct}%${leftLabel ? ` · ${leftLabel}` : ''}` : status === 'requesting-url' ? 'starting…' : status === 'error' ? 'stopped' : 'uploaded ✓';
  const facts = [runtimeClock(video.runtimeSeconds), video.width && video.height ? `${video.width} × ${video.height}` : null].filter(Boolean);
  return (
    <div className={`apl-progress ${status === 'error' ? 'is-error' : ''}`} aria-live="polite">
      <div className="apl-progress-row"><span className="apl-progress-name">{video.name} · {bytesLabel(video.bytes)}</span><span>{right}</span></div>
      <div className="apl-bar"><div className="apl-bar-fill" style={{ width: `${status === 'uploading' || status === 'requesting-url' ? pct : 100}%` }} /></div>
      <div className="apl-progress-meta">
        {status === 'error'
          ? <span>{upload.errorMessage || 'The upload stopped.'} Retry from the widget at the bottom, or <button type="button" className="apl-link" onClick={onRemove}>pick a file again</button>.</span>
          : facts.length
            ? <span>Runtime read from the file: <strong>{facts[0]}</strong>{facts[1] ? ` · ${facts[1]}` : ''}</span>
            : <span>We read the runtime once Cloudflare has the file.</span>}
        {status !== 'error' && <button type="button" className="apl-link" onClick={onRemove}>Not this file</button>}
      </div>
    </div>
  );
}

// Where the signed-in applicant's latest application stands.
function StatusCard({ app, upload, busy, onReapply, reapplying, onReplace, onResume, onArtwork }) {
  const [poster, setPoster] = useState(null);
  const [still, setStill] = useState(null);
  const [artOpen, setArtOpen] = useState(false);
  const label = APPLICATION_STATUS_LABEL[app.status] || app.status;
  const subject = encodeURIComponent(`${app.title}: what you asked for`);
  const mailto = `mailto:${SITE.contactEmail}?subject=${subject}`;
  const replaceInput = (handler, text) => (
    <label className="apl-btn-ghost">
      {text}
      <input type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => { handler(e.target.files && e.target.files[0]); e.target.value = ''; }} />
    </label>
  );

  if (app.status === 'accepted') {
    const live = Boolean(app.episodeHref);
    return (
      <div className="apl-status level-ok">
        <span className="apl-status-tag">{live ? 'You’re in · Live' : 'You’re in'}</span>
        <div className="apl-status-title">{live ? `${app.title} is on ${SITE.name}` : app.title}</div>
        <p>
          {live
            ? `Accepted ${fmtDate(app.reviewedAt)}. Creator Studio is on your account: your numbers, your money, the next title.`
            : `Accepted ${fmtDate(app.reviewedAt)}. Creator Studio is on your account: upload the master there and it goes into our review queue.`}
        </p>
        {app.decisionNote && <p><strong>A note from us:</strong> {app.decisionNote}</p>}
        <div className="apl-actions">
          {live && <Link href={app.episodeHref} className="apl-btn">View the page</Link>}
          <Link href="/creator" className={live ? 'apl-btn-secondary' : 'apl-btn'}>Open Creator Studio</Link>
        </div>
      </div>
    );
  }

  if (app.status === 'declined') {
    return (
      <div className="apl-status level-neutral">
        <span className="apl-status-tag">{label}</span>
        <div className="apl-status-title">{app.title}</div>
        <p>Not a fit for {SITE.name} right now{app.reviewedAt ? ` (${fmtDate(app.reviewedAt)})` : ''}.{app.video && app.video.state === 'deleted' ? ' The file is deleted from our side.' : ''} You&rsquo;re welcome to send new work any time.</p>
        {app.decisionNote && <p><strong>A note from us:</strong> {app.decisionNote}</p>}
        {!reapplying && <div className="apl-actions"><button type="button" className="apl-btn-ghost" onClick={onReapply}>Send something new</button></div>}
      </div>
    );
  }

  if (app.status === 'held') {
    return (
      <div className="apl-status level-warn">
        <span className="apl-status-tag">{label}</span>
        <div className="apl-status-title">{app.title}</div>
        {app.decisionNote && <p><strong>From us:</strong> {app.decisionNote}</p>}
        {upload && <UploadProgress video={{ ...app.video, name: upload.fileName, bytes: upload.fileSize }} upload={upload} onRemove={() => {}} />}
        <p>Replace the file, or send what&rsquo;s missing, and it comes straight back to us.</p>
        <div className="apl-actions">
          {replaceInput(onReplace, 'Replace the file')}
          <a className="apl-btn-secondary" href={mailto}>Send it by email</a>
        </div>
      </div>
    );
  }

  // new / reviewing
  const stalled = app.video && app.video.state === 'uploading' && !upload;
  return (
    <div className="apl-status level-review">
      <span className="apl-status-tag">{label}</span>
      <div className="apl-status-title">{app.title}</div>
      {upload
        ? <UploadProgress video={{ ...app.video, name: upload.fileName, bytes: upload.fileSize }} upload={upload} onRemove={() => {}} />
        : <p>Sent {fmtDate(app.createdAt)}. {app.video ? videoStateLine(app.video) : (app.hasLink ? 'We open your link from here.' : '')} We watch everything and reply within {ONBOARDING.replyWindow}, by email and here.</p>}
      {upload && <p>Keep this tab open until it finishes. Close it and the upload stops; pick the same file again later and it carries on.</p>}
      {stalled && (
        <div className="apl-actions">
          {replaceInput(onResume, 'Pick the same file to resume')}
          {replaceInput(onReplace, 'Replace the file')}
        </div>
      )}
      {app.holds.length > 0 && (
        <>
          <div className="apl-status-k">Still to send us</div>
          <ul>{app.holds.map((h) => <li key={h}>{h} — <a href={mailto}>send it by email</a></li>)}</ul>
        </>
      )}
      <div className="apl-status-k">Optional</div>
      {app.poster || app.thumbnail ? <p>Artwork received{app.poster && app.thumbnail ? ' (poster and still)' : app.poster ? ' (poster; we cut the still from the film)' : ' (still; we cut the poster from the film)'}. Swap it any time from Your work once it&rsquo;s live.</p> : <p>A 2:3 poster and a 16:9 still, no text baked in. Skip them and we cut both from the film.</p>}
      {!artOpen ? (
        <div className="apl-actions">
          <button type="button" className="apl-btn-ghost" onClick={() => setArtOpen(true)}>{app.poster || app.thumbnail ? 'Change the artwork' : 'Add a poster and a still'}</button>
          {!stalled && app.video && replaceInput(onReplace, 'Replace the file')}
        </div>
      ) : (
        <div className="apl-art">
          <label className="apl-art-slot">
            <span>Poster · 2:3</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPoster(e.target.files && e.target.files[0])} />
          </label>
          <label className="apl-art-slot">
            <span>Still · 16:9</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setStill(e.target.files && e.target.files[0])} />
          </label>
          <div className="apl-actions">
            <button type="button" className="apl-btn" disabled={busy || (!poster && !still)} onClick={async () => { await onArtwork({ poster, still }); setArtOpen(false); setPoster(null); setStill(null); }}>{busy ? 'Saving…' : 'Save artwork'}</button>
            <button type="button" className="apl-btn-ghost" onClick={() => setArtOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
