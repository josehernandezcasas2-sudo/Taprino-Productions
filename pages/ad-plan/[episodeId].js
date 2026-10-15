import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import HeaderNav from '../../components/HeaderNav';
import { getAccountContext } from '../../lib/accountContext';
import { getRoleContext } from '../../lib/roles';
import { canCurate } from '../../lib/adPlans';
import { SITE } from '../../lib/siteConfig';
import { wholeMinutes } from '../../lib/channelPlan';
import {
  airBreaks, airSeconds, adsSeconds, adsPerHour, bookedSeconds, piecesSeconds, pieceLabel, fmtClock, parseClock, selfAdConflicts, eligibleCount,
  AUTO_BUMPERS, ROUND_CHOICES, STATUS_LABELS, MIN_PIECE_SECONDS, MAX_PIECE_SECONDS, SELF_AD_CLEARANCE
} from '../../lib/adPlanRules';

// The Episode Ad Curator (mockups/episode-ad-curator-v1.html): every break
// of one episode, composed from exact sections, range sections, flex
// blocks and pinned Studio Tapa ads; bumper time computed; the air length
// the scheduler uses. Built for tablets and computers like /schedule.
// Admins, scheduling sub-admins and content schedulers (lib/adPlans.js
// canCurate). Nothing here changes playback until the plan is saved as
// "ready for air".

export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, roleContext] = await Promise.all([getAccountContext(req), getRoleContext(req)]);
  if (!roleContext.userId) return { redirect: { destination: '/account', permanent: false } };
  if (!canCurate(roleContext)) return { redirect: { destination: account.canAccessAdmin ? '/admin' : '/stream', permanent: false } };
  return {
    props: {
      episodeId: String(params.episodeId),
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      adminArea: !!account.canAccessAdmin
    }
  };
}

const KIND_CLASS = { exact: 'ex', range: 'rg', flex: 'fx', pinned: 'pin' };
const KIND_NAME = { exact: 'exact', range: 'range', flex: 'flex block', pinned: 'pinned' };
const sortBreaks = (breaks) => breaks.slice().sort((a, b) => a.at - b.at);
const clone = (plan) => JSON.parse(JSON.stringify(plan));

async function api(method, body, query, path = '/api/ad-plan/curator') {
  const res = await fetch(`${path}${query ? `?${query}` : ''}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export default function AdPlanPage({ episodeId, isSignedIn, isSubscriber, email, isAdmin, isCreator, adminArea, apiPath = '/api/ad-plan/curator' }) {
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [savedStatus, setSavedStatus] = useState('none');
  const [loadError, setLoadError] = useState(null);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState('sections');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [custom, setCustom] = useState('45');
  const [newBreak, setNewBreak] = useState('');
  const [adQuery, setAdQuery] = useState('');
  const [over, setOver] = useState(null); // drop target being hovered: 'strip' | break index

  const load = useCallback(async () => {
    try {
      const d = await api('GET', null, `episode=${encodeURIComponent(episodeId)}`, apiPath);
      setData(d);
      setPlan(clone(d.plan));
      setSavedStatus(d.plan.status || 'none');
      setDirty(false);
      setSel(0);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [episodeId, apiPath]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const edit = (fn) => {
    setPlan((p) => { const next = clone(p); fn(next); next.breaks = sortBreaks(next.breaks); return next; });
    setDirty(true);
    setMsg(null);
  };

  const episode = data ? data.episode : null;
  const settings = data ? data.settings : null;
  const ads = data ? data.ads : [];
  const bumpers = data ? data.bumpers : [];
  const runtime = episode ? episode.runtimeSeconds : 0;

  const derived = useMemo(() => {
    if (!plan || !episode) return null;
    const breaks = sortBreaks(plan.breaks);
    const ab = airBreaks(plan);
    const air = airSeconds(runtime, plan);
    const slot = wholeMinutes(air);
    const perHour = adsPerHour(runtime, plan);
    const conflicts = selfAdConflicts(plan);
    const empties = [];
    for (const b of breaks) for (const p of b.pieces) if (p.kind !== 'pinned' && eligibleCount(p, ads) === 0) empties.push({ at: b.at, piece: p });
    return { breaks, ab, air, slot, tail: slot - air, ads: adsSeconds(plan), perHour, overCap: settings && perHour > settings.hourCapSeconds, conflicts, empties };
  }, [plan, episode, runtime, ads, settings]);

  const selected = derived && derived.breaks[sel] ? derived.breaks[sel] : null;
  // "Pre-roll", "Break 1", "Break 2"… the same numbering on the chips, the bar and the composer.
  const breakName = (i) => (derived && derived.breaks[i] && derived.breaks[i].at === 0 ? 'Pre-roll' : `Break ${i + (derived && derived.breaks[0] && derived.breaks[0].at === 0 ? 0 : 1)}`);

  /* ---------------- edits ---------------- */

  function addPiece(piece, breakIndex = sel) {
    edit((p) => {
      const breaks = sortBreaks(p.breaks);
      let target = breaks[breakIndex];
      if (!target) {
        target = { at: 0, pieces: [] };
        p.breaks.push(target);
      }
      target.pieces.push(piece);
      p.breaks = breaks.length ? breaks : p.breaks;
    });
  }
  function removePiece(pi) {
    edit((p) => { sortBreaks(p.breaks)[sel].pieces.splice(pi, 1); });
  }
  function movePiece(pi, dir) {
    edit((p) => {
      const pieces = sortBreaks(p.breaks)[sel].pieces;
      const j = pi + dir;
      if (j < 0 || j >= pieces.length) return;
      [pieces[pi], pieces[j]] = [pieces[j], pieces[pi]];
    });
  }
  function addBreak() {
    const at = parseClock(newBreak);
    if (at == null || at < 0) { setMsg({ kind: 'error', text: 'Type the break time as mm:ss, like 8:00.' }); return; }
    if (runtime && at >= runtime) { setMsg({ kind: 'error', text: `The episode ends at ${fmtClock(runtime)}; a break has to come before that.` }); return; }
    const existing = derived.breaks.findIndex((b) => b.at === at);
    if (existing >= 0) { setSel(existing); return; }
    edit((p) => { p.breaks.push({ at, pieces: [] }); });
    setNewBreak('');
    setSel(sortBreaks([...plan.breaks, { at }]).findIndex((b) => b.at === at));
  }
  function moveBreak(text) {
    const at = parseClock(text);
    if (at == null || at < 0 || (runtime && at >= runtime)) { setMsg({ kind: 'error', text: `Give the break a time between 0:00 and ${fmtClock(Math.max(0, runtime - 1))}.` }); return; }
    if (derived.breaks.some((b, i) => i !== sel && b.at === at)) { setMsg({ kind: 'error', text: `There is already a break at ${fmtClock(at)}.` }); return; }
    edit((p) => { sortBreaks(p.breaks)[sel].at = at; });
    setSel(sortBreaks(plan.breaks.map((b, i) => (i === sel ? { ...b, at } : b))).findIndex((b) => b.at === at));
  }
  function removeBreak() {
    edit((p) => { p.breaks = sortBreaks(p.breaks).filter((_, i) => i !== sel); });
    setSel((s) => Math.max(0, s - 1));
  }
  function setField(key, value) {
    edit((p) => { p[key] = value; });
  }
  function addSelfAd() {
    edit((p) => { p.selfAds.push({ inSeconds: 0, outSeconds: 30, sponsor: '', url: '', card: true }); });
  }
  function setSelfAd(i, key, value) {
    edit((p) => { p.selfAds[i][key] = value; });
  }
  function removeSelfAd(i) {
    edit((p) => { p.selfAds.splice(i, 1); });
  }

  async function save(status) {
    if (!plan) return;
    setBusy(true);
    setMsg(null);
    try {
      const result = await api('POST', { episodeId, plan: { ...plan, status } }, null, apiPath);
      setPlan(clone(result.plan));
      setSavedStatus(result.plan.status);
      setDirty(false);
      setMsg({ kind: 'ok', text: `${status === 'ready' ? 'Ready for air' : 'Draft saved'} · air length ${fmtClock(result.stats.airSeconds)}${result.errors.length ? ` · dropped: ${result.errors.join(' ')}` : ''}` });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (!window.confirm('Throw the saved plan away and go back to the default (one 30 s section at each of the creator’s break times)?')) return;
    setBusy(true);
    try {
      await api('DELETE', null, `episode=${encodeURIComponent(episodeId)}`, apiPath);
      await load();
      setMsg({ kind: 'ok', text: 'Back to the default plan. Nothing changes on air until you save again.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- drag and drop ---------------- */

  const dragProps = (piece) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData('text/plain', JSON.stringify(piece)); e.dataTransfer.effectAllowed = 'copy'; }
  });
  const dropProps = (target) => ({
    onDragOver: (e) => { e.preventDefault(); setOver(target); },
    onDragLeave: () => setOver(null),
    onDrop: (e) => {
      e.preventDefault();
      setOver(null);
      let piece = null;
      try { piece = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { piece = null; }
      if (!piece || !piece.kind) return;
      if (target !== 'strip') setSel(target);
      addPiece(piece, target === 'strip' ? sel : target);
    }
  });

  /* ---------------- render ---------------- */

  const title = episode ? `${episode.seriesName ? `${episode.seriesName} · ` : ''}${episode.label ? `${episode.label} ` : ''}${episode.title}` : 'Ad plan';
  const backHref = adminArea ? '/admin/library' : '/schedule';
  const backLabel = adminArea ? 'Library' : 'Scheduler';

  return (
    <>
      <Head><title>{`Ad plan — ${episode ? episode.title : 'Episode'} — ${SITE.name}`}</title></Head>
      <HeaderNav activeType="All" isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <main className="stage stage-single stage-wide sch-page adc-page">
        <div className="sch-phone">
          <div className="eyebrow">Ad plan</div>
          <h1>{episode ? episode.title : 'Episode'}</h1>
          <p>The ad curator is built for a tablet or computer. Open this page on a bigger screen to compose the breaks.</p>
          {derived && <p>Right now: {STATUS_LABELS[savedStatus]} · air length {fmtClock(derived.air)} · {derived.ab.length} break{derived.ab.length === 1 ? '' : 's'}.</p>}
          <Link href={backHref} className="sch-btn">‹ {backLabel}</Link>
        </div>

        <div className="sch-work">
          <div className="sch-head">
            <div>
              <div className="eyebrow"><Link href={backHref} className="adc-back">‹ {backLabel}</Link> · Ad plan{episode && episode.seriesName ? ` · ${episode.seriesName}` : ''}</div>
              <h1>{episode ? `${episode.label ? `${episode.label} ` : ''}${episode.title}` : 'Loading…'} {derived && <span className={`adc-status ${savedStatus}`}>{STATUS_LABELS[savedStatus]}{dirty ? ' · unsaved' : ''}</span>}</h1>
              {episode && (
                <p className="sch-lib-note">
                  Runtime {episode.runtime || fmtClock(runtime)}{episode.rating ? ` · ${episode.rating}` : ''}{episode.artist ? ` · by ${episode.artist}` : ''} · breaks set by the creator: {episode.adBreakSeconds.map(fmtClock).join(', ')}
                  {!episode.adsEnabled && ' · ads are switched off on this episode (its plan still sets the air length)'}
                </p>
              )}
            </div>
            <div className="sch-head-ctrls">
              <button type="button" className="sch-btn" onClick={reset} disabled={busy || savedStatus === 'none'}>Reset to default</button>
              <button type="button" className="sch-btn" onClick={() => save('draft')} disabled={busy || !plan}>Save draft</button>
              <button type="button" className="sch-btn primary" onClick={() => save('ready')} disabled={busy || !plan}>Save · ready for air</button>
            </div>
          </div>

          {loadError && <div className="house-ad-error" role="alert">{loadError}</div>}
          {msg && <div className={msg.kind === 'error' ? 'house-ad-error' : 'adc-warn ok'} role="status">{msg.text}</div>}

          {derived && episode && (
            <>
              <div className="adc-stats">
                <div className="adc-stat"><b>{fmtClock(runtime)}</b><span>Runtime</span></div>
                <div className="adc-stat"><b>{derived.ab.length}</b><span>Breaks · {fmtClock(derived.ads)} of ads</span></div>
                <div className="adc-stat hot"><b>{fmtClock(derived.air)}</b><span>Air length</span></div>
                <div className="adc-stat"><b>{derived.slot / 60} min</b><span>Slot{derived.tail > 0 ? ` · ${derived.tail} s bumpers to close` : ' · exact'}</span></div>
                <div className={`adc-stat ${derived.overCap ? 'bad' : ''}`}><b>{fmtClock(derived.perHour)}</b><span>Ads per hour · cap {fmtClock(settings.hourCapSeconds)}</span></div>
              </div>

              {(!runtime || !episode.hasVideo || episode.status !== 'approved') && (
                <div className="adc-warn">
                  {!runtime && <div>This episode has no usable runtime, so a plan can’t be saved. Set it on the episode first (mm:ss).</div>}
                  {runtime && !episode.hasVideo && <div>No video is attached yet. The plan saves, but nothing plays until the episode has one.</div>}
                  {runtime && episode.status !== 'approved' && <div>The episode isn’t approved yet; it won’t air or play until it is.</div>}
                </div>
              )}
              {derived.overCap && <div className="adc-warn">At this density the channel would carry {fmtClock(derived.perHour)} of ads per hour; the cap is {fmtClock(settings.hourCapSeconds)}. Shorten or remove a break.</div>}
              {derived.conflicts.map((c, i) => (
                <div key={i} className="adc-warn">The break at {fmtClock(c.at)} {c.inside ? 'sits inside' : `is within ${SELF_AD_CLEARANCE} s of`} the sponsor segment at {fmtClock(c.selfAd.inSeconds)}–{fmtClock(c.selfAd.outSeconds)}. Move it.</div>
              ))}
              {derived.empties.map((e, i) => (
                <div key={i} className="adc-warn">No approved ad can fill the {pieceLabel(e.piece)} {KIND_NAME[e.piece.kind]} at {fmtClock(e.at)} today; a Studio Tapa ad (then bumpers) would play instead.</div>
              ))}

              <div className="adc-grid">
                {/* left rail */}
                <div className="adc-rail">
                  <div className="sch-seg sch-seg-sm" role="tablist">
                    {[['sections', 'Sections'], ['ads', 'Ads'], ['bumpers', 'Bumpers']].map(([k, label]) => (
                      <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
                    ))}
                  </div>

                  {tab === 'sections' && (
                    <>
                      <div className="adc-grp">Exact · any ad of this length</div>
                      <div className="adc-pal">
                        {data.palette.exact.map((x) => (
                          <button key={x.seconds} type="button" className="ex" onClick={() => addPiece({ kind: 'exact', seconds: x.seconds })} {...dragProps({ kind: 'exact', seconds: x.seconds })}>
                            <span><i className="adc-ex" />{x.seconds} s</span><small>{x.count} ad{x.count === 1 ? '' : 's'}</small>
                          </button>
                        ))}
                      </div>
                      <div className="adc-grp">Range · one ad in the range, bumpers take the rest</div>
                      <div className="adc-pal">
                        {data.palette.range.map((x) => (
                          <button key={`${x.min}-${x.max}`} type="button" className="rg" onClick={() => addPiece({ kind: 'range', min: x.min, max: x.max })} {...dragProps({ kind: 'range', min: x.min, max: x.max })}>
                            <span><i className="adc-rg" />{x.min}–{x.max} s</span><small>{x.count} ad{x.count === 1 ? '' : 's'}</small>
                          </button>
                        ))}
                      </div>
                      <div className="adc-grp">Flex block · any lengths, bumpers at the end</div>
                      <div className="adc-pal">
                        {data.palette.flex.map((x) => (
                          <button key={x.seconds} type="button" className="fx" onClick={() => addPiece({ kind: 'flex', seconds: x.seconds })} {...dragProps({ kind: 'flex', seconds: x.seconds })}>
                            <span><i className="adc-fx" />{x.seconds} s block</span><small>{x.count} ad{x.count === 1 ? '' : 's'}</small>
                          </button>
                        ))}
                        <div className="adc-custom">
                          <i className="adc-fx" />
                          <span>Custom</span>
                          <input type="number" min={MIN_PIECE_SECONDS} max={MAX_PIECE_SECONDS} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom block length in seconds" />
                          <span>s</span>
                          <button type="button" className="sch-btn sm" onClick={() => { const n = Math.round(Number(custom)); if (n >= MIN_PIECE_SECONDS && n <= MAX_PIECE_SECONDS) addPiece({ kind: 'flex', seconds: n }); }}>Add</button>
                        </div>
                      </div>
                      <p className="sch-lib-note" style={{ marginTop: '0.8rem' }}>Click a piece to add it to the selected break, or drag it onto a break. The count is how many approved ads could fill it today.</p>
                    </>
                  )}

                  {tab === 'ads' && (
                    <>
                      <input type="search" className="sch-search" placeholder="Search ads…" value={adQuery} onChange={(e) => setAdQuery(e.target.value)} aria-label="Search ads" />
                      {[['Studio Tapa ads · pin by dragging · internal only', true], ['Advertisers · fill sections through the draw · not pinnable', false]].map(([label, house]) => {
                        const list = ads.filter((a) => a.house === house && (!adQuery || `${a.title} ${a.brand}`.toLowerCase().includes(adQuery.toLowerCase())));
                        return (
                          <div key={label}>
                            <div className="adc-grp">{label}</div>
                            <div className="adc-ads">
                              {list.length === 0 && <div className="sch-muted">None right now.</div>}
                              {list.map((a) => {
                                const piece = { kind: 'pinned', adId: a.id, seconds: a.durationSeconds, title: a.title };
                                return (
                                  <div key={a.id} className={`adc-ad ${house ? 'mine' : ''}`} {...(house ? dragProps(piece) : {})}>
                                    <div className="n">{a.title}<small>{a.brand}{a.placements ? ` · ${a.placements.map((p) => p.replace('_', ' ')).join(', ')}` : ''} · fits {a.fits.join(' · ')}</small></div>
                                    <div className="d">{a.durationSeconds} s{house && <button type="button" className="sch-btn sm" onClick={() => addPiece(piece)}>Pin</button>}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      <p className="sch-lib-note" style={{ marginTop: '0.8rem' }}>Approved, active, inside their dates. Advertisers whose credits ran out are paused and don’t show. The advertiser form steers uploads to {settings.sizes.join(' / ')} s.</p>
                    </>
                  )}

                  {tab === 'bumpers' && (
                    <>
                      <div className="adc-grp">Auto bumper for this episode</div>
                      <select className="adc-select" value={plan.autoBumper} onChange={(e) => setField('autoBumper', e.target.value)} aria-label="Auto bumper">
                        {Object.entries(AUTO_BUMPERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <div className="adc-grp">Approved channel uploads · bumpers, station IDs, promos</div>
                      <div className="adc-ads">
                        {bumpers.length === 0 && <div className="sch-muted">No approved bumpers yet. Upload them on the scheduler’s Uploads tab; an admin approves them.</div>}
                        {bumpers.map((m) => (
                          <div key={m.id} className="adc-ad">
                            <div className="n">{m.title}<small>{m.kind.replace('_', ' ')}{m.kind === 'promo' ? ' · too long for a tail, fine as a piece' : ''}</small></div>
                            <div className="d">{m.durationSeconds} s</div>
                          </div>
                        ))}
                      </div>
                      <p className="sch-lib-note" style={{ marginTop: '0.8rem' }}>Bumper time is whatever a break has left after its ads: station IDs first, then other clips, then the hold card (the channel logo). “Presented by” names the pinned Studio Tapa ad’s brand; without one it falls back to the station ID.</p>
                    </>
                  )}
                </div>

                {/* stage */}
                <div className="adc-stage">
                  <Timeline runtime={runtime} plan={plan} ab={derived.ab} breaks={derived.breaks} tail={derived.tail} sel={sel} onSelect={setSel} />

                  <div className="adc-chips">
                    {derived.breaks.map((b, i) => {
                      const booked = bookedSeconds(b, plan.roundTo);
                      return (
                        <button key={`${b.at}-${i}`} type="button" className={`adc-chip ${i === sel ? 'on' : ''} ${over === i ? 'over' : ''}`} onClick={() => setSel(i)} {...dropProps(i)}>
                          <i className={`adc-${KIND_CLASS[(b.pieces[0] || {}).kind] || 'ex'}`} />
                          {breakName(i)} · {fmtClock(b.at)} · {booked ? `${booked} s` : 'empty'}
                        </button>
                      );
                    })}
                    <span className="adc-addbreak">
                      <input type="text" placeholder="mm:ss" value={newBreak} onChange={(e) => setNewBreak(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addBreak(); }} aria-label="New break time" />
                      <button type="button" className="sch-btn sm" onClick={addBreak}>+ Add a break</button>
                    </span>
                  </div>

                  {selected ? (
                    <Composer
                      brk={selected} name={breakName(sel)} plan={plan} ads={ads} over={over === 'strip'}
                      dropProps={dropProps('strip')} onMove={moveBreak} onRemove={removeBreak} onRemovePiece={removePiece} onMovePiece={movePiece}
                    />
                  ) : (
                    <div className="adc-comp"><p className="sch-lib-note">No breaks yet. Add one above (0:00 is a pre-roll), then click pieces on the left to fill it.</p></div>
                  )}
                </div>

                {/* settings */}
                <div className="adc-settings adc-set">
                  <div className="eyebrow">Ad settings · this episode</div>
                  <div className="row"><div><b>Breaks from the creator</b><small>{episode.adBreakSeconds.map(fmtClock).join(', ')} are the starting points. Moving or adding breaks here never touches the creator’s submission.</small></div></div>
                  <div className="row">
                    <div><b>Adjacent sections become one block</b><small>Sections placed next to each other fill as one pool of their combined length, so ads of any length can land; bumpers take what’s left.</small></div>
                    <button type="button" className={`adc-tog ${plan.mergeAdjacent ? 'on' : ''}`} onClick={() => setField('mergeAdjacent', !plan.mergeAdjacent)} aria-pressed={plan.mergeAdjacent} aria-label="Adjacent sections become one block" />
                  </div>
                  <div className="row">
                    <div><b>Round each break to</b><small>Ads first; bumpers fill up to the next even length, 1 s to 20 s or more.</small></div>
                    <select value={plan.roundTo} onChange={(e) => setField('roundTo', Number(e.target.value))} aria-label="Round each break to">
                      {ROUND_CHOICES.map((r) => <option key={r} value={r}>{r} s</option>)}
                    </select>
                  </div>
                  <div className="row">
                    <div style={{ flex: 1 }}><b>Auto bumper</b><small>What fills bumper time.</small>
                      <select className="adc-select" value={plan.autoBumper} onChange={(e) => setField('autoBumper', e.target.value)} aria-label="Auto bumper">
                        {Object.entries(AUTO_BUMPERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="row"><div><b>Ads per hour on the channel</b><small>No cap per break. The scheduler adds breaks, gaps and slot tails per clock hour and flags any hour over the cap. Self-ads don’t count.</small></div><b>&lt; {fmtClock(settings.hourCapSeconds)}</b></div>
                  <div className="row"><div><b>If nothing fits at air time</b><small>A Studio Tapa ad of that length or shorter, then bumpers, then the hold card. Never an overrun.</small></div></div>
                  <div className="row">
                    <div><b>On demand too</b><small>The same plan plays as pods in the main player. Ad-free members skip them; the live channel runs them for everyone.</small></div>
                    <button type="button" className={`adc-tog ${plan.onDemand ? 'on' : ''}`} onClick={() => setField('onDemand', !plan.onDemand)} aria-pressed={plan.onDemand} aria-label="On demand too" />
                  </div>
                  <div className="row" style={{ display: 'block' }}>
                    <b>Sponsor segments in the video</b>
                    <small>Ads the creator shot into the episode. Never counted; breaks keep {SELF_AD_CLEARANCE} s clear; the player can show a link card over them.</small>
                    <div className="adc-self">
                      {plan.selfAds.map((s, i) => (
                        <div key={i} className="adc-self-row">
                          <div className="f">
                            <label>In<input type="text" value={fmtClock(s.inSeconds)} onChange={(e) => { const v = parseClock(e.target.value); if (v != null) setSelfAd(i, 'inSeconds', v); }} aria-label="In" /></label>
                            <label>Out<input type="text" value={fmtClock(s.outSeconds)} onChange={(e) => { const v = parseClock(e.target.value); if (v != null) setSelfAd(i, 'outSeconds', v); }} aria-label="Out" /></label>
                          </div>
                          <label>Sponsor<input type="text" value={s.sponsor} maxLength={80} onChange={(e) => setSelfAd(i, 'sponsor', e.target.value)} placeholder="Acme Coffee" /></label>
                          <label>Link<input type="text" value={s.url} maxLength={300} onChange={(e) => setSelfAd(i, 'url', e.target.value)} placeholder="acme.example/fawns" /></label>
                          <div className="f" style={{ alignItems: 'center' }}>
                            <label className="adc-inline"><input type="checkbox" checked={s.card !== false} onChange={(e) => setSelfAd(i, 'card', e.target.checked)} /> Show a link card over it</label>
                            <button type="button" className="sch-btn sm danger" onClick={() => removeSelfAd(i)}>Remove</button>
                          </div>
                        </div>
                      ))}
                      <button type="button" className="sch-btn sm" onClick={addSelfAd}>+ Mark a sponsor segment</button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

/* ---------------- the bar ---------------- */

function Timeline({ runtime, plan, ab, breaks, tail, sel, onSelect }) {
  // Cut the episode at every break and every sponsor segment edge; each
  // break draws before the content at its time.
  const cuts = new Set([0, runtime]);
  for (const b of breaks) cuts.add(Math.min(b.at, runtime));
  for (const s of plan.selfAds) { cuts.add(Math.min(s.inSeconds, runtime)); cuts.add(Math.min(s.outSeconds, runtime)); }
  const points = [...cuts].sort((a, b) => a - b);
  const segs = [];
  const bookedAt = (at) => { const b = ab.find((x) => x.at === at); return b ? b.booked : 0; };
  for (let i = 0; i < points.length; i++) {
    const t = points[i];
    const bi = breaks.findIndex((b) => b.at === t);
    if (bi >= 0) segs.push({ type: 'break', at: t, booked: bookedAt(t), index: bi });
    if (i < points.length - 1) {
      const end = points[i + 1];
      const self = plan.selfAds.find((s) => s.inSeconds <= t && end <= s.outSeconds);
      segs.push({ type: self ? 'self' : 'ep', start: t, end, self });
    }
  }
  if (tail > 0) segs.push({ type: 'tail', seconds: tail });
  const air = airSeconds(runtime, plan);
  const ticks = [];
  const step = air > 3600 ? 900 : air > 1200 ? 300 : 60;
  for (let t = 0; t < air; t += step) ticks.push(t);
  return (
    <div className="adc-tl">
      <div className="adc-ticks">{ticks.map((t) => <span key={t}>{fmtClock(t)}</span>)}<span>{fmtClock(air)}</span></div>
      <div className="adc-bar" aria-label="The episode with its breaks">
        {segs.map((s, i) => {
          if (s.type === 'break') {
            return (
              <button
                key={`b${i}`} type="button" style={{ flex: `${Math.max(s.booked, 1)} 0 0` }}
                className={`adc-${KIND_CLASS[(breaks[s.index].pieces[0] || {}).kind] || 'ex'} ${s.index === sel ? 'sel' : ''} ${s.booked ? '' : 'empty'}`}
                onClick={() => onSelect(s.index)} title={`Break at ${fmtClock(s.at)} · ${s.booked ? `${s.booked} s` : 'empty'}`} aria-label={`Break at ${fmtClock(s.at)}`}
              >{s.booked || '+'}</button>
            );
          }
          if (s.type === 'self') return <span key={`s${i}`} className="adc-self-seg self" style={{ flex: `${s.end - s.start} 0 0` }} title={`Sponsor segment ${fmtClock(s.start)}–${fmtClock(s.end)}${s.self.sponsor ? ` · ${s.self.sponsor}` : ''}`}>{s.self.card !== false ? 'QR' : ''}</span>;
          if (s.type === 'tail') return <span key="tail" className="adc-tail tail" style={{ flex: `${s.seconds} 0 0` }} title={`Slot tail · ${s.seconds} s · the channel's own bumpers`} />;
          return <span key={`e${i}`} className="adc-ep" style={{ flex: `${s.end - s.start} 0 0` }} title={`${fmtClock(s.start)}–${fmtClock(s.end)}`} />;
        })}
      </div>
      <div className="adc-legend">
        <span><i className="adc-ep" />Episode</span><span><i className="adc-ex" />Exact section</span><span><i className="adc-rg" />Range section</span><span><i className="adc-fx" />Flex block</span><span><i className="adc-pin" />Pinned ad</span><span><i className="adc-bp" />Bumpers</span><span><i className="adc-self-seg" />Sponsor segment</span><span><i className="adc-tail" />Slot tail</span><span style={{ marginLeft: 'auto' }}>breaks drawn wider than scale</span>
      </div>
    </div>
  );
}

/* ---------------- one break ---------------- */

function Composer({ brk, name, plan, ads, over, dropProps, onMove, onRemove, onRemovePiece, onMovePiece }) {
  const [at, setAt] = useState(fmtClock(brk.at));
  useEffect(() => { setAt(fmtClock(brk.at)); }, [brk.at]);
  const booked = bookedSeconds(brk, plan.roundTo);
  const adsIn = piecesSeconds(brk);
  const tail = booked - adsIn;
  return (
    <div className="adc-comp">
      <div className="adc-comp-head">
        <div>
          <b>{name} · at </b>
          <input type="text" className="adc-at" value={at} onChange={(e) => setAt(e.target.value)} onBlur={() => onMove(at)} onKeyDown={(e) => { if (e.key === 'Enter') onMove(at); }} aria-label="Break time" />
          <span className="sch-lib-note" style={{ marginLeft: '0.5rem' }}>
            {booked ? `books ${booked} s · ${adsIn} s of pieces + ${tail} s bumpers (rounded to ${plan.roundTo} s)` : 'empty · add pieces from the left'}
            {plan.mergeAdjacent && brk.pieces.filter((p) => p.kind !== 'pinned').length > 1 ? ' · adjacent sections fill as one block' : ''}
          </span>
        </div>
        <button type="button" className="sch-btn sm danger" onClick={onRemove}>Remove break</button>
      </div>
      <div className={`adc-strip ${over ? 'over' : ''}`} {...dropProps}>
        {brk.pieces.map((p, i) => {
          const count = p.kind === 'pinned' ? null : eligibleCount(p, ads);
          const pinned = p.kind === 'pinned' ? ads.find((a) => a.id === p.adId) : null;
          return (
            <div key={i} className={`adc-piece ${KIND_CLASS[p.kind]} adc-${KIND_CLASS[p.kind]}`} style={{ flex: `${Math.max(pieceSecondsOf(p), 8)} 0 0` }}>
              <div>
                <b>{pieceLabel(p)}</b>
                {p.kind === 'pinned' ? (pinned ? `pinned · ${pinned.brand}` : 'pinned · not available today · plays as an exact section') : `${KIND_NAME[p.kind]} · ${count} ad${count === 1 ? '' : 's'} eligible${count === 0 ? ' · Studio Tapa ad will play' : ''}`}
              </div>
              <div className="ctl">
                <button type="button" onClick={() => onMovePiece(i, -1)} aria-label="Move earlier" disabled={i === 0}>◀</button>
                <button type="button" onClick={() => onMovePiece(i, 1)} aria-label="Move later" disabled={i === brk.pieces.length - 1}>▶</button>
                <button type="button" onClick={() => onRemovePiece(i)} aria-label="Remove piece">✕</button>
              </div>
            </div>
          );
        })}
        {tail > 0 && <div className="adc-piece bp adc-bp" style={{ flex: `${tail} 0 0` }}><div><b>{tail} s</b>bumpers · computed</div></div>}
        <div className="adc-drop">{brk.pieces.length ? 'drop a piece · the break grows, bumpers re-fit' : 'drop or click a piece'}</div>
      </div>
    </div>
  );
}

function pieceSecondsOf(p) {
  return p.kind === 'range' ? p.max : p.seconds;
}
