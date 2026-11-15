import { TITLE_TABS } from '../../../lib/titleDashRules';
import { ActionError, NeedLine, bg } from './TitleBits';
import { AccountIcon, ChatIcon, ClapperboardIcon, HeadphonesIcon, ImageIcon, PencilIcon, TicketIcon, TrashIcon, UndoIcon } from '../../PlayerIcons';

// A title's other tabs (Details, Artwork, Video and captions, Selling,
// Channels): one card each from lib/titleDashRules.js titleDashboard, every
// button opening the edit box Your work already has for it (the page owns
// the boxes and runs the keys).

const tabLabel = (key) => (TITLE_TABS.find((t) => t.key === key) || { label: key }).label;

function ActButton({ action, run, busy, where, icon: Icon, tone = 'gold' }) {
  if (!action) return null;
  return (
    <button type="button" className={`td-btn ${tone}`} disabled={busy === action.key} onClick={() => run(action.key, where)}>
      {Icon ? <Icon size={16} /> : null}
      {busy === action.key ? 'Working…' : action.label}
    </button>
  );
}

export function DetailsTab({ dash, run, busy, error }) {
  const d = dash.details;
  const removal = dash.removal;
  return (
    <div className="td-stack">
      <section className="dash-card td-card" aria-labelledby="td-details-h">
        <div className="td-card-head">
          <h2 id="td-details-h" className="td-h2">{tabLabel('details')}</h2>
          <ActButton action={d.action} run={run} busy={busy} where="details" icon={PencilIcon} />
        </div>
        <dl className="td-facts">
          {d.rows.map((row) => (
            <div key={row.key} className="td-fact">
              <dt>{row.label}</dt>
              <dd>
                <span className={row.key === 'about' || row.key === 'notes' ? 'td-long' : undefined}>{row.value}</span>
                {row.waiting ? <NeedLine text={row.waiting} tone="wait" as="span" /> : null}
              </dd>
            </div>
          ))}
        </dl>
        {d.note && <p className="dash-fine">{d.note}</p>}
        <ActionError error={error} where="details" />
      </section>
      {removal && (
        <section className={`dash-card td-card td-removal${removal.key === 'remove' ? '' : ' asked'}`} aria-labelledby="td-removal-h">
          <h2 id="td-removal-h" className="td-h2">{removal.heading || (removal.key === 'remove' ? 'Remove it' : 'Removal requested')}</h2>
          <p className="td-sub">{removal.line}</p>
          {removal.key && (
            <div className="td-acts">
              <ActButton action={removal} run={run} busy={busy} where="removal" icon={removal.key === 'remove' ? TrashIcon : UndoIcon} tone={removal.key === 'remove' ? 'danger' : 'gold'} />
            </div>
          )}
          <ActionError error={error} where="removal" />
        </section>
      )}
    </div>
  );
}

function ArtSlot({ url, label, shape }) {
  return (
    <figure className={`td-art ${shape}`}>
      <span className={`td-art-img${url ? '' : ' empty'}`} style={bg(url)} role={url ? 'img' : undefined} aria-label={url ? label : undefined}>
        {!url && <span>None yet</span>}
      </span>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function ArtworkTab({ dash, run, busy, error }) {
  const a = dash.artwork;
  return (
    <section className="dash-card td-card" aria-labelledby="td-art-h">
      <div className="td-card-head">
        <h2 id="td-art-h" className="td-h2">{tabLabel('artwork')}</h2>
        <ActButton action={a.action} run={run} busy={busy} where="artwork" icon={ImageIcon} />
      </div>
      {a.waiting ? <NeedLine text={a.waiting} tone="wait" /> : null}
      <div className="td-arts">
        <ArtSlot url={a.poster} label="Poster" shape="poster" />
        <ArtSlot url={a.still} label="Still" shape="still" />
        {a.titleImage && (
          <figure className="td-art title">
            <span className="td-art-img contain"><img src={a.titleImage} alt="Title image" /></span>
            <figcaption>Title image</figcaption>
          </figure>
        )}
      </div>
      <ActionError error={error} where="artwork" />
    </section>
  );
}

export function VideoTab({ dash, run, busy, error, extract }) {
  const v = dash.video;
  return (
    <div className="td-stack">
      <section className="dash-card td-card" aria-labelledby="td-video-h">
        <div className="td-card-head">
          <h2 id="td-video-h" className="td-h2">Video</h2>
          <ActButton action={v.action} run={run} busy={busy} where="video" icon={ClapperboardIcon} />
        </div>
        <p className="td-value">{v.file}</p>
        {v.waiting ? <NeedLine text={v.waiting} tone="wait" /> : null}
        <ActionError error={error} where="video" />
      </section>
      {v.audio && (
        <section className="dash-card td-card" aria-labelledby="td-audio-h">
          <div className="td-card-head">
            <h2 id="td-audio-h" className="td-h2">Audio</h2>
            <ActButton action={v.audio.action} run={run} busy={busy || (extract ? 'extract_audio' : null)} where="audio" icon={HeadphonesIcon} />
          </div>
          <p className="td-value">{v.audio.has ? 'The audio track is ready.' : 'No audio track yet.'}</p>
          {extract && <p className="td-sub" role="status">Extracting the audio…{extract.pct != null ? ` ${Math.round(extract.pct)}%` : ''}</p>}
          <ActionError error={error} where="audio" />
        </section>
      )}
      {v.captions && (
        <section className="dash-card td-card" aria-labelledby="td-captions-h">
          <div className="td-card-head">
            <h2 id="td-captions-h" className="td-h2">Captions</h2>
            <ActButton action={v.captions.action} run={run} busy={busy} where="captions" icon={ChatIcon} />
          </div>
          <p className="td-value">{v.captions.line}</p>
          <ActionError error={error} where="captions" />
        </section>
      )}
    </div>
  );
}

export function SellingTab({ dash, run, busy, error }) {
  const s = dash.selling;
  return (
    <div className="td-stack">
      <section className="dash-card td-card" aria-labelledby="td-sell-h">
        <div className="td-card-head">
          <h2 id="td-sell-h" className="td-h2">{tabLabel('selling')}</h2>
          <ActButton action={s.action} run={run} busy={busy} where="selling" icon={TicketIcon} />
        </div>
        <p className="td-value">{s.price}</p>
        {s.note && <p className="td-sub">{s.note}</p>}
        <ActionError error={error} where="selling" />
      </section>
      {s.payee && (
        <section className="dash-card td-card" aria-labelledby="td-payee-h">
          <div className="td-card-head">
            <h2 id="td-payee-h" className="td-h2">{s.payee.label}</h2>
            <ActButton action={s.payee} run={run} busy={busy} where="payee" icon={AccountIcon} tone="plain" />
          </div>
          <p className="td-sub">Whose account its title sales and ad share are paid to.</p>
        </section>
      )}
    </div>
  );
}

export function ChannelsTab({ dash, onToggle, busy, error }) {
  const c = dash.channels;
  const working = busy === 'channels';
  return (
    <section className="dash-card td-card" aria-labelledby="td-chan-h">
      <h2 id="td-chan-h" className="td-h2">{tabLabel('channels')}</h2>
      <button
        type="button"
        role="switch"
        aria-checked={c.on}
        aria-describedby="td-chan-help"
        className={`td-switch${c.on ? ' on' : ''}`}
        disabled={c.locked || working}
        onClick={() => onToggle(!c.on)}
      >
        <span className="td-switch-label">Channels can air it</span>
        <span className="td-switch-state" aria-hidden="true">{working ? '…' : c.on ? 'On' : 'Off'}</span>
        <span className="td-switch-track" aria-hidden="true"><span className="td-switch-knob" /></span>
      </button>
      <p id="td-chan-help" className="td-sub">{c.locked ? c.lockedWhy : 'Live channels like TapaTV can put it in their schedule. It still plays on demand either way.'}</p>
      <ActionError error={error} where="channels" />
    </section>
  );
}
