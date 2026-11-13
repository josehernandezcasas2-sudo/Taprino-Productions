import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getPublicIdentities } from '../../../lib/userProfiles';
import { MAIN_GENRES } from '../../../lib/submitRules';
import { SITE } from '../../../lib/siteConfig';
import { PODCASTS_AD_FREE } from '../../../lib/adBreakRules';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import RatingOptions from '../../../components/RatingOptions';
import { readAsDataUrl, useObjectUrl } from '../../../components/show/EditorBits';
import { BackArrowIcon } from '../../../components/PlayerIcons';
import { UploadIcon, pickerKeys } from '../../../components/show/roomBits';

// New show (the series revamp, slice 2; spec Screens "New show", board
// NewShow): name it, say what it is (a series or a podcast), one line about
// it, the defaults its episodes start from (genre, rating, Who can watch,
// Made by, ads — copied onto each episode as it is added, never read back
// later), and the art or "Cut them from the first episode for me". Create
// the show → POST /api/show → the show page, which says it is ready for its
// episodes. The show is private until its owner makes it public (decision
// 2: once an episode is approved). People who start from the file keep the
// three-step submit's inline "+ New show".
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin && !account.canAccessAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const [episodes, identities] = await Promise.all([
    getPublicEpisodes(),
    account.userId ? getPublicIdentities([account.userId]).catch(() => ({})) : Promise.resolve({})
  ]);
  const me = account.userId ? identities[account.userId] : null;
  // The placeholder name a profile without one carries isn't a credit.
  const displayName = me && me.displayName && me.displayName !== 'A viewer' ? me.displayName : '';
  return {
    props: {
      displayName,
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

const NAME_MAX = 120;
const ABOUT_MAX = 2000;
const IMAGE_MAX = 6 * 1024 * 1024;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

function ArtPick({ id, label, shape, file, onPick, onClear }) {
  const url = useObjectUrl(file);
  return (
    <div className={`new-show-art ${shape}`}>
      <label htmlFor={id} className={`new-show-art-slot ${url ? 'has-image' : ''}`} role="button" aria-label={file ? `${label}: ${file.name} — pick another` : `${label}: pick an image`} {...pickerKeys()}>
        {url ? <img src={url} alt="" /> : (
          <span className="new-show-art-empty"><UploadIcon size={18} /><span>{label}</span></span>
        )}
        <input id={id} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onPick(f); }} />
      </label>
      {file && <button type="button" className="apl-link new-show-art-clear" onClick={onClear}>Remove</button>}
    </div>
  );
}

export default function NewShowPage({ displayName, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('series');
  const [about, setAbout] = useState('');
  const [mainGenre, setMainGenre] = useState('');
  const [rating, setRating] = useState('');
  const [tier, setTier] = useState('free');
  const [artist, setArtist] = useState(displayName || '');
  const [adsEnabled, setAdsEnabled] = useState(true);
  const [poster, setPoster] = useState(null);
  const [still, setStill] = useState(null);
  const [cut, setCut] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const podcast = kind === 'podcast';
  const noArt = !poster && !still;

  const pick = (setter) => (f) => {
    setError(null);
    if (f.size > IMAGE_MAX) return setError(`“${f.name}” is too large — please use a file under 6MB.`);
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return setError(`“${f.name}” isn’t a JPEG, PNG, WebP or GIF image.`);
    return setter(f);
  };

  const blocked = !name.trim() ? 'Name it to go on.' : name.trim().length > NAME_MAX ? `A name is limited to ${NAME_MAX} characters.` : about.trim().length > ABOUT_MAX ? `The line about it is limited to ${ABOUT_MAX.toLocaleString('en-US')} characters.` : null;

  async function create(e) {
    e.preventDefault();
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const [posterBase64, thumbnailBase64] = await Promise.all([poster ? readAsDataUrl(poster) : null, still ? readAsDataUrl(still) : null]);
      const defaults = { tier, adsEnabled };
      if (mainGenre) defaults.mainGenre = mainGenre;
      if (rating) defaults.rating = rating;
      if (artist.trim()) defaults.artist = artist.trim();
      const body = {
        name: name.trim(),
        kind,
        description: about.trim(),
        defaults,
        ...(posterBase64 ? { posterBase64, posterFileName: poster.name } : {}),
        ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: still.name } : {}),
        cutFromFirst: noArt && cut
      };
      const res = await fetch('/api/show', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not create the show (${res.status}).`);
      router.push(`/creator/show/${encodeURIComponent(data.id)}?created=1`);
    } catch (err) {
      setError((err && err.message) || 'Could not create the show.');
      setSaving(false);
    }
  }

  return (
    <>
      <Head>
        <title>{`Start a show — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <HeaderNav mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator} />
      <main id="main-content" className="apl new-show">
        <Link href="/creator" className="acct-back new-show-back"><BackArrowIcon size={14} /> Creator Studio</Link>
        <div className="apl-head">
          <div className="apl-eyebrow">New show</div>
          <h1 className="apl-h1">Start a show</h1>
          <p className="apl-lede">Name it now; episodes come next. Once one is approved, you choose when it goes public.</p>
        </div>
        <form onSubmit={create} noValidate>
          <div className="apl-card new-show-card">
            <div className="apl-field">
              <div className="new-show-label-row"><label className="apl-label" htmlFor="ns-name">Name</label><span className="new-show-count">{name.length} / {NAME_MAX}</span></div>
              <input id="ns-name" className="new-show-name" type="text" maxLength={NAME_MAX} value={name} autoComplete="off" placeholder={podcast ? 'The show’s name' : 'The series’ name'} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="apl-field">
              <span className="apl-label" id="ns-kind">Kind</span>
              <div className="apl-pills" role="radiogroup" aria-labelledby="ns-kind">
                {[['series', 'Series'], ['podcast', 'Podcast']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={kind === v ? 'true' : 'false'} className={`apl-pill ${kind === v ? 'on' : ''}`} onClick={() => setKind(v)}>{l}</button>
                ))}
              </div>
              <p className="apl-help">Fixed once the first episode is in.</p>
            </div>

            <div className="apl-field">
              <div className="new-show-label-row"><label className="apl-label" htmlFor="ns-about">One line about it</label><span className="new-show-count">{about.length} / {ABOUT_MAX.toLocaleString('en-US')}</span></div>
              <textarea id="ns-about" className="new-show-about" rows={2} maxLength={ABOUT_MAX} value={about} placeholder={podcast ? 'What it’s about, in a line.' : 'What happens, in a line.'} onChange={(e) => setAbout(e.target.value)} />
              <p className="apl-help">You can write more later.</p>
            </div>

            <details className="new-show-defaults" open>
              <summary>Defaults for its episodes</summary>
              <div className="new-show-defaults-body">
              <p className="apl-help">Copied onto each episode you add from now on. You can change any episode.</p>
              <div className="apl-field">
                <span className="apl-label" id="ns-genre">Genre</span>
                <div className="apl-pills" role="radiogroup" aria-labelledby="ns-genre">
                  {MAIN_GENRES.map((g) => (
                    <button key={g} type="button" role="radio" aria-checked={mainGenre === g ? 'true' : 'false'} className={`apl-pill ${mainGenre === g ? 'on' : ''}`} onClick={() => setMainGenre(mainGenre === g ? '' : g)}>{g}</button>
                  ))}
                </div>
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="ns-rating">Rating</label>
                <select id="ns-rating" value={rating} onChange={(e) => setRating(e.target.value)}>
                  <option value="">Not set (treated as 17+)</option>
                  <RatingOptions />
                </select>
              </div>
              <div className="apl-field">
                <span className="apl-label" id="ns-tier">Who can watch</span>
                <div className="apl-pills" role="radiogroup" aria-labelledby="ns-tier">
                  {[['free', podcast ? 'Free' : 'Free with ads'], ['premium', SITE.premiumTier]].map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={tier === v ? 'true' : 'false'} className={`apl-pill ${tier === v ? 'on' : ''}`} onClick={() => setTier(v)}>{l}</button>
                  ))}
                </div>
                <p className="apl-help">{podcast ? 'Free' : 'Free with ads'}, or {SITE.premiumTier} members only. The studio has the final say.</p>
              </div>
              <div className="apl-field">
                <label className="apl-label" htmlFor="ns-artist">{podcast ? 'Hosted by' : 'Made by'}</label>
                <input id="ns-artist" type="text" maxLength={120} value={artist} placeholder="Your name, as credited" onChange={(e) => setArtist(e.target.value)} />
              </div>
              {/* A podcast carries no ads of ours (lib/adBreakRules.js). */}
              {podcast ? (
                <p className="apl-help">{PODCASTS_AD_FREE} No ad of ours plays in an episode; a sponsor read in your own audio is yours.</p>
              ) : (
                <div className="new-show-switch-row">
                  <span id="ns-ads">Ads between scenes</span>
                  <button type="button" role="switch" aria-checked={adsEnabled ? 'true' : 'false'} aria-labelledby="ns-ads" className={`seal-switch show-ed-switch ${adsEnabled ? 'on' : ''}`} onClick={() => setAdsEnabled((v) => !v)} />
                </div>
              )}
              </div>
            </details>

            <div className="new-show-art-block">
              <span className="apl-label">Art <em>optional</em></span>
              <div className="new-show-art-row">
                <ArtPick id="ns-poster" label="Poster 2:3" shape="poster" file={poster} onPick={pick(setPoster)} onClear={() => setPoster(null)} />
                <ArtPick id="ns-still" label="Still · 16:9" shape="still" file={still} onPick={pick(setStill)} onClear={() => setStill(null)} />
              </div>
              {noArt ? (
                <label className="new-show-cut">
                  <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} />
                  <span>Cut them from the first episode for me</span>
                </label>
              ) : null}
              <p className="apl-help">{noArt ? 'Swap them any time from Edit show.' : 'The other one can be added any time from Edit show.'}</p>
            </div>
          </div>

          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="apl-send new-show-send">
            <button type="submit" className="apl-btn" disabled={Boolean(blocked) || saving}>{saving ? 'Creating…' : 'Create the show'}</button>
            {blocked && <p className="apl-send-note" role="status">{blocked}</p>}
            <Link href={`/creator/submit?type=${podcast ? 'podcast' : 'series'}`} className="new-show-alt">Have the first episode ready? <span>Start from the file instead</span></Link>
          </div>
        </form>
      </main>
      <Footer />
    </>
  );
}
