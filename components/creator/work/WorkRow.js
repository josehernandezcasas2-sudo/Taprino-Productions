import Link from 'next/link';
import { episodeEditorHref } from '../../../lib/workListRules';
import { AccountIcon, BarChartIcon, ChatIcon, ClapperboardIcon, ClockIcon, ExternalLinkIcon, HeadphonesIcon, ImageIcon, LinkIcon, PencilIcon, TicketIcon, TrashIcon, TvIcon, UndoIcon, WarningIcon } from '../../PlayerIcons';
import { bg } from '../../show/roomBits';
import WorkMenu from './WorkMenu';

// One row of Your work (2026-11-15): every title draws the same way — a
// show's episode or extra, a film, a short, a podcast episode, a vertical
// title. The thumbnail and the words are one link (a title of its own to
// its dashboard, a show's episode to its editor); then what needs the
// creator (orange, a warning sign) and what waits for approval (gold, a
// clock); on the right the row's one next step and the ⋯ menu. The model
// is lib/workListRules.js's row; the page runs the actions (`onAction`).

const ICON = {
  open: null,
  edit_full: PencilIcon,
  edit_submission: PencilIcon,
  edit_words: PencilIcon,
  view: ExternalLinkIcon,
  copy: LinkIcon,
  sell: TicketIcon,
  payee: AccountIcon,
  artwork: ImageIcon,
  video: ClapperboardIcon,
  captions: ChatIcon,
  extract_audio: HeadphonesIcon,
  channels: TvIcon,
  cancel_removal: UndoIcon,
  remove: TrashIcon,
  restore: UndoIcon,
  cancel_restore: UndoIcon
};

export default function WorkRow({ row, icons = {}, menuOpen, onToggleMenu, onCloseMenu, onAction, busy = {}, note = null, copied = false }) {
  const titleId = `wk-t-${row.id}`;
  const inShow = row.kind !== 'title';
  const iconFor = (key) => {
    const Icon = key === 'open' ? (inShow ? PencilIcon : BarChartIcon) : ICON[key];
    const srcKey = { open: inShow ? 'pencil' : 'bar_chart', edit_full: 'pencil', edit_submission: 'pencil', edit_words: 'pencil', view: 'external_link', copy: 'link', sell: 'ticket', payee: 'account', artwork: 'image', video: 'clapperboard', captions: 'chat', extract_audio: 'headphones', channels: 'tv', cancel_removal: 'undo', remove: 'trash', restore: 'undo', cancel_restore: 'undo' }[key];
    return Icon ? <Icon size={16} src={icons[srcKey]} /> : null;
  };

  const items = row.menu.map((m) => {
    const it = { key: m.key, label: m.label, detail: m.detail || '', tone: m.tone, icon: iconFor(m.key) };
    if (m.key === 'open') return { ...it, href: row.href };
    if (m.key === 'view') return { ...it, href: row.publicPath, external: true };
    if (m.key === 'payee' && inShow && row.showId) return { ...it, href: episodeEditorHref(row.showId, row.id, 'who-gets-paid') };
    if (m.key === 'copy') return { ...it, label: copied ? 'Link copied' : m.label, keepOpen: true, onSelect: () => onAction('copy', row) };
    if (m.key === 'channels') {
      // Not disabled while it saves (a focused item that is disabled loses
      // the focus in some browsers): a second click waits.
      return { ...it, checked: Boolean(m.on), detail: busy.channels ? 'Saving…' : m.detail, keepOpen: true, onSelect: () => { if (!busy.channels) onAction('channels', row); } };
    }
    if (m.key === 'extract_audio' && busy.extracting) return { ...it, label: `Extracting the audio…${busy.extractPercent != null ? ` ${Math.round(busy.extractPercent)}%` : ''}`, disabled: true };
    if ((m.key === 'cancel_removal' || m.key === 'cancel_restore') && busy.cancelling) return { ...it, label: 'Cancelling…', disabled: true };
    return { ...it, onSelect: () => onAction(m.key, row) };
  });

  const next = row.next;
  let nextEl = null;
  if (next && next.key === 'open') {
    nextEl = <Link href={row.href} className="wk-next" aria-describedby={titleId}>{next.label}</Link>;
  } else if (next) {
    const cancelling = next.key === 'cancel_removal' && busy.cancelling;
    nextEl = (
      <button type="button" className="wk-next" aria-describedby={titleId} disabled={cancelling} onClick={() => onAction(next.key, row)}>
        {cancelling ? 'Cancelling…' : next.label}
      </button>
    );
  }

  const meta = [row.showName, row.meta].filter(Boolean).join(' · ');
  const working = busy.extracting ? `Extracting the audio…${busy.extractPercent != null ? ` ${Math.round(busy.extractPercent)}%` : ''}` : '';

  return (
    <div className={`wk-row${inShow ? ' in-show' : ''}${menuOpen ? ' menu-open' : ''}`} id={`wk-${row.id}`}>
      <Link href={row.href} className="wk-row-link">
        <span className={`wk-thumb${row.thumb ? '' : ' empty'}`} style={bg(row.thumb)} aria-hidden="true">
          {!row.thumb && <ImageIcon size={16} src={icons.image} />}
        </span>
        <span className="wk-row-text">
          <span className="wk-row-title" id={titleId}>
            {row.code && <span className="wk-code">{row.code}</span>}
            <span className="wk-row-name">{row.title}</span>
          </span>
          <span className="wk-row-meta">
            <span className={`wk-pill tone-${row.pill.tone}`}>{row.pill.label}</span>
            {meta && <span className="wk-meta">{meta}</span>}
          </span>
        </span>
      </Link>

      {(row.need || row.waiting || working) && (
        <div className="wk-row-notes">
          {row.need && <p className="wk-note need"><WarningIcon size={16} src={icons.warning} /><span>{row.need}</span></p>}
          {row.waiting && <p className="wk-note wait"><ClockIcon size={16} src={icons.clock} /><span>{row.waiting}</span></p>}
          {working && <p className="wk-note quiet" role="status"><HeadphonesIcon size={16} src={icons.headphones} /><span>{working}</span></p>}
        </div>
      )}

      {nextEl && <div className="wk-row-next">{nextEl}</div>}

      <div className="wk-row-more">
        <WorkMenu
          label={`More for ${row.title}`}
          open={menuOpen}
          onToggle={onToggleMenu}
          onClose={onCloseMenu}
          items={items}
        />
      </div>

      {copied && <span className="visually-hidden" role="status">Link copied</span>}

      {note && (
        <p className={`wk-row-alert${note.ok ? ' ok' : ''}`} role={note.ok ? 'status' : 'alert'}>{note.text}</p>
      )}
    </div>
  );
}
