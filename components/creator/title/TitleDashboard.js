import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import DashboardTabs from '../DashboardTabs';
import EditSubmissionModal from '../../EditSubmissionModal';
import AdminEditEpisodeModal from '../../AdminEditEpisodeModal';
import ArtworkModal from '../../ArtworkModal';
import DeleteRequestModal from '../../DeleteRequestModal';
import CaptionUploadModal from '../../CaptionUploadModal';
import ReplaceVideoModal from '../../ReplaceVideoModal';
import RequestEditModal from '../../RequestEditModal';
import SellTitleModal from '../SellTitleModal';
import { PayeeModal } from '../../show/PayeeCard';
import { BackArrowIcon, ExternalLinkIcon, LinkIcon } from '../../PlayerIcons';
import { TITLE_WORDS, titleDashboard } from '../../../lib/titleDashRules';
import { copyLinkFor, episodeEditorHref, runtimeWords, titleDashHref, workShowIdOf } from '../../../lib/workListRules';
import { SITE } from '../../../lib/siteConfig';
import { bg, editValuesFor, useRoute } from './TitleBits';
import TitleOverview from './TitleOverview';
import { ArtworkTab, ChannelsTab, DetailsTab, SellingTab, VideoTab } from './TitleCards';

// A title's dashboard (/creator/title/<id>; Jose, 2026-11-14: "for series,
// and single items like a film/short, add a dashboard that will encompass
// the work's back end and analytics"; the canvas's "Dashboard · a film",
// the agreement mockups/work-revamp-contract.md). A film, a short, an
// extra or a vertical title of its own: the head, the title's tabs
// (Overview · Details · Artwork · Video and captions · Selling · Channels,
// ?tab= by a shallow route change), and the tab. It reads four routes that
// already exist — the creator's titles, this title's numbers, the prices
// and this year's money — and lib/titleDashRules.js turns them into every
// number and sentence. Every button opens the edit box Your work already
// uses for it, and the page reads its data again after a box saves.
//
// A show's episode isn't edited here: the page sends it to the episode
// editor (/creator/show/<sid>/episode/<eid>), as Your work does.

const EXTRACT_POLL_MS = 3000;

export default function TitleDashboard({ id, isAdmin = false, isCreator = false, canAccessAdmin = false, allSeries = [] }) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const year = new Date(now).getUTCFullYear();
  const subs = useRoute('/api/creator/my-submissions');
  const detailRoute = useRoute(`/api/creator/episode-detail-analytics?episodeId=${encodeURIComponent(id)}`);
  const pricingRoute = useRoute('/api/creator/pricing');
  const moneyRoute = useRoute(`/api/creator/money?period=${year}`);
  const [chartMode, setChartMode] = useState('views');
  const [box, setBox] = useState(null); // { kind, s }: the edit box open, with the title as it was when opened
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null); // { where, text }
  const [copied, setCopied] = useState(false);
  const [extract, setExtract] = useState(null); // { pct }
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const list = subs.data && Array.isArray(subs.data.submissions) ? subs.data.submissions : null;
  // A change made here (the channels switch) shows at once; the next read
  // of the list replaces it with what the server says.
  const [local, setLocal] = useState(null);
  useEffect(() => { setLocal(null); }, [subs.data]);
  const found = list ? list.find((s) => s && s.id === id) || null : null;
  const title = useMemo(() => (found && local ? { ...found, ...local } : found), [found, local]);
  const byId = useMemo(() => new Map((list || []).filter(Boolean).map((s) => [s.id, s])), [list]);
  // Filed under a show (an episode, or an extra attached to one): the
  // show's episode editor is where it is edited, as on Your work.
  const showId = title ? workShowIdOf(title, byId) : null;
  const inShow = Boolean(showId && title && title.contentType !== 'vertical' && title.seriesKind !== 'vertical');
  useEffect(() => {
    if (inShow) router.replace(episodeEditorHref(showId, id));
  }, [inShow, showId, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pricing = pricingRoute.state === 'ok' ? pricingRoute.data : null;
  const price = pricing && pricing.prices ? pricing.prices[`episode:${id}`] || null : null;
  const detail = detailRoute.state === 'ok' ? detailRoute.data : null;
  const money = moneyRoute.state === 'ok' ? moneyRoute.data : null;
  const dash = useMemo(
    () => (title && !inShow ? titleDashboard({ title, detail, money, price, chartMode, canEditAll: isAdmin, now }) : null),
    [title, inShow, detail, money, price, chartMode, isAdmin, now]
  );

  const asked = typeof router.query.tab === 'string' ? router.query.tab : 'overview';
  const tab = dash && dash.tabs.some((t) => t.key === asked) ? asked : 'overview';

  // On a phone the tab row scrolls: keep the open tab in view.
  const tabsRef = useRef(null);
  useEffect(() => {
    const row = tabsRef.current;
    const on = row ? row.querySelector('[aria-current="page"]') : null;
    if (on && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, on.offsetLeft - 24);
  }, [tab, Boolean(dash)]);

  const reloadSubs = subs.reload;
  const reloadPricing = pricingRoute.reload;
  const close = useCallback(() => setBox(null), []);

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not do that just now.');
    return data;
  }

  async function setChannels(optIn, where = 'channels') {
    setBusy('channels');
    setError(null);
    try {
      await post('/api/creator/channel-opt-in', { type: 'episode', id, optIn });
      setLocal((l) => ({ ...(l || {}), channelOptIn: optIn }));
      reloadSubs();
    } catch (err) {
      setError({ where, text: err instanceof TypeError ? 'You seem to be offline. Try again.' : err.message });
    } finally {
      setBusy(null);
    }
  }

  async function cancelRemoval(where = 'removal') {
    setBusy('cancel_removal');
    setError(null);
    try {
      await post('/api/creator/request-episode-deletion', { episodeId: id, action: 'cancel' });
      reloadSubs();
    } catch (err) {
      setError({ where, text: err.message || 'Could not cancel the request.' });
    } finally {
      setBusy(null);
    }
  }

  // DeleteRequestModal's confirm: it shows a thrown error itself.
  async function requestRemoval(reason) {
    await post('/api/creator/request-episode-deletion', { episodeId: id, action: 'request', reason });
    setBox(null);
    reloadSubs();
  }

  // Cloudflare pulls the audio out of the video; this checks in every 3 s.
  function extractAudio(where = 'audio') {
    if (extract) return;
    setExtract({ pct: null });
    setError(null);
    const poll = async () => {
      try {
        const data = await post('/api/creator/extract-podcast-audio', { episodeId: id });
        if (!alive.current) return;
        if (data.status === 'ready') {
          setExtract(null);
          reloadSubs();
          return;
        }
        setExtract({ pct: data.percentComplete ?? null });
        setTimeout(poll, EXTRACT_POLL_MS);
      } catch (err) {
        if (!alive.current) return;
        setExtract(null);
        setError({ where, text: err.message || 'Could not extract the audio.' });
      }
    };
    poll();
  }

  async function copyLink() {
    if (!dash || !dash.head.publicPath) return;
    try {
      await navigator.clipboard.writeText(copyLinkFor({ publicPath: dash.head.publicPath }, SITE.productionDomain));
      setCopied(true);
      setTimeout(() => { if (alive.current) setCopied(false); }, 2000);
    } catch {
      // The clipboard can be refused (permissions, an insecure page): the
      // View its page link is still there.
    }
  }

  // Every action key the rules hand out (Your work's menu keys).
  function run(key, where) {
    if (!title) return;
    setError(null);
    switch (key) {
      case 'artwork':
      case 'captions':
      case 'video':
      case 'sell':
      case 'payee':
      case 'edit_full':
      case 'edit_submission':
      case 'edit_words':
      case 'remove':
        setBox({ kind: key, s: title });
        break;
      case 'replace_file':
        setBox({ kind: 'video', s: title });
        break;
      case 'channels':
        setChannels(true, where);
        break;
      case 'cancel_removal':
        cancelRemoval(where);
        break;
      case 'extract_audio':
        extractAudio(where);
        break;
      case 'copy':
        copyLink();
        break;
      default:
        break;
    }
  }

  const back = (
    <Link href="/creator/my-work" className="acct-back td-back"><BackArrowIcon size={14} /> {TITLE_WORDS.back}</Link>
  );
  const tabsRow = <DashboardTabs current="work" isCreator={isCreator} isAdmin={isAdmin} canAccessAdmin={canAccessAdmin} />;

  // --- loading, failed, not one of theirs, or on its way to the editor ---------
  if (!dash) {
    const failed = subs.state === 'failed';
    const notMine = (subs.state === 'ok' && !title) || subs.state === 'refused';
    return (
      <main id="main-content" className="td-page">
        <Head><title>{`${TITLE_WORDS.back} — ${SITE.name}`}</title><meta name="robots" content="noindex" /></Head>
        {back}
        {tabsRow}
        {notMine ? (
          <div className="dash-card td-card td-missing" role="alert">
            <p className="td-value">{TITLE_WORDS.notFound}</p>
            <Link href="/creator/my-work" className="td-btn">{TITLE_WORDS.back}</Link>
          </div>
        ) : failed ? (
          <div className="dash-card td-card td-missing" role="alert">
            <p className="td-value">{TITLE_WORDS.failed}</p>
            <button type="button" className="td-btn" onClick={reloadSubs}>Try again</button>
          </div>
        ) : (
          <div className="td-skeleton" aria-busy="true" aria-label={TITLE_WORDS.loading}><span /><span /><span /></div>
        )}
      </main>
    );
  }

  const head = dash.head;
  const base = titleDashHref(id);
  const s = box ? box.s : null;
  const sellSub = title ? [head.typeWord, runtimeWords(title.runtime)].filter(Boolean).join(' · ') : '';
  const cardProps = { dash, run, busy, error };

  return (
    <main id="main-content" className="td-page">
      <Head>
        <title>{`${head.title} — ${TITLE_WORDS.back} — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      {back}
      {tabsRow}

      <header className="td-head">
        <span className={`td-poster${head.poster ? '' : ' empty'}`} style={bg(head.poster)} aria-hidden="true">{!head.poster && <span>{head.title}</span>}</span>
        <div className="td-head-text">
          <div className="td-chips">
            <span className="td-chip type">{head.typeWord}</span>
            <span className={`td-chip tone-${head.pill.tone}`}>{head.pill.tone === 'live' && <i aria-hidden="true" />}{head.pill.label}</span>
          </div>
          <h1 className="td-h1">{head.title}</h1>
          {head.meta && <p className="td-meta">{head.meta}</p>}
        </div>
        {head.publicPath && (
          <div className="td-head-acts">
            <a className="td-btn" href={head.publicPath} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon size={16} /> View its page<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <button type="button" className="td-btn" onClick={copyLink}>
              <LinkIcon size={16} /> {copied ? 'Link copied' : 'Copy link'}
            </button>
            <span className="visually-hidden" role="status">{copied ? 'Link copied' : ''}</span>
          </div>
        )}
      </header>

      <nav className="td-tabs" aria-label="This title" ref={tabsRef}>
        {dash.tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'overview' ? base : `${base}?tab=${encodeURIComponent(t.key)}`}
            shallow
            scroll={false}
            className={`td-tab${t.key === tab ? ' on' : ''}`}
            aria-current={t.key === tab ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <TitleOverview
          dash={dash}
          detailState={detailRoute.state}
          moneyState={moneyRoute.state}
          onRetryDetail={detailRoute.reload}
          onRetryMoney={moneyRoute.reload}
          chartMode={chartMode}
          setChartMode={setChartMode}
          run={run}
          busy={busy}
          error={error}
          extract={extract}
        />
      )}
      {tab !== 'overview' && (
        <div className="td-panel">
          {tab === 'details' && <DetailsTab {...cardProps} />}
          {tab === 'artwork' && <ArtworkTab {...cardProps} />}
          {tab === 'video' && <VideoTab {...cardProps} extract={extract} />}
          {tab === 'selling' && <SellingTab {...cardProps} />}
          {tab === 'channels' && <ChannelsTab dash={dash} busy={busy} error={error} onToggle={(on) => setChannels(on, 'channels')} />}
        </div>
      )}

      {box && box.kind === 'edit_submission' && (
        <EditSubmissionModal submission={s} onClose={close} onSaved={() => { close(); reloadSubs(); }} />
      )}
      {box && box.kind === 'edit_full' && (
        <AdminEditEpisodeModal
          episode={s}
          allSeries={allSeries}
          standaloneEpisodes={(list || []).filter((sub) => ['movie', 'short'].includes(sub.contentType) && sub.id !== s.id)}
          onClose={close}
          onSaved={() => { close(); reloadSubs(); }}
        />
      )}
      {box && box.kind === 'edit_words' && (
        <RequestEditModal type="episode" currentValues={editValuesFor(s)} onClose={close} onSubmitted={reloadSubs} />
      )}
      {box && box.kind === 'artwork' && (
        <ArtworkModal submission={s} onClose={close} onSaved={() => { close(); reloadSubs(); }} />
      )}
      {box && box.kind === 'video' && (
        <ReplaceVideoModal submission={s} onClose={() => { close(); reloadSubs(); }} />
      )}
      {box && box.kind === 'captions' && (
        <CaptionUploadModal submission={s} onClose={close} onSaved={reloadSubs} />
      )}
      {box && box.kind === 'remove' && (
        <DeleteRequestModal itemLabel={s.title} onClose={close} onConfirm={requestRemoval} />
      )}
      {box && box.kind === 'payee' && (
        <PayeeModal type="episode" id={s.id} title={head.title} onClose={close} onChanged={() => { reloadSubs(); reloadPricing(); }} />
      )}
      {box && box.kind === 'sell' && (
        <SellTitleModal
          target={{ type: 'episode', id: s.id, title: head.title, sub: sellSub }}
          price={price}
          settings={(pricing && pricing.settings) || {}}
          blocked={pricing && pricing.blocked ? pricing.blocked[`episode:${s.id}`] || null : null}
          isAdmin={isAdmin}
          onClose={close}
          onSaved={reloadPricing}
        />
      )}
    </main>
  );
}
