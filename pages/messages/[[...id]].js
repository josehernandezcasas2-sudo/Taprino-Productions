import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SignInHere from '../../components/SignInHere';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { Avatar } from '../../components/crew/CrewBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { listThreads, getConversation, getBlocksBetween } from '../../lib/messages';
import { resolveContext } from '../../lib/messageContext';
import {
  MAX_MESSAGE_CHARS, CONTEXT_KINDS, CONTEXT_LABELS, MESSAGE_WORDS, FILTERS,
  contextLine, contextLink, filterThreads, filterLabel, emptyFilterLine, listTime,
  dayGroups, pendingAbout, peopleQuery, personLine, firstName
} from '../../lib/messageRules';
import { getPublicProfile, placeholderProfile, profilePath, looksLikeUserId } from '../../lib/userProfiles';
import { REPORT_REASONS } from '../../lib/reportReasons';
import { keepScrollInside } from '../../lib/menuScroll';
import { SITE } from '../../lib/siteConfig';
import { segmentsRefused } from '../../lib/pageSegments';

// Messages, simpler (Jose, 2026-11-18, the canvas
// https://claude.ai/artifact/SgXAPeJijp7A1EzSQckyhf; the build agreement is
// mockups/messages-simpler-contract.md). One page for the inbox and a
// conversation:
//   /messages                       the inbox
//   /messages/<threadId>            a conversation
//   /messages?to=<userId>[&kind=&ref=&label=]  start one (an existing
//       conversation with that person opens instead, the subject carried
//       as ?kind=&ref=&label= — "Your next message is about …")
// Under 900px a conversation is full screen (no site header, no tab bar,
// no footer); from 900px the header stays and two panes fill the window.
// Every word, filter, time and grouping comes from lib/messageRules.js,
// which the app's copy matches word for word. New messages arrive by
// polling while the tab is visible (10 s an open conversation, 30 s the
// inbox).
const POLL_MS = 10000;
const INBOX_POLL_MS = 30000;
const SEARCH_WAIT_MS = 250;

const first = (v) => (Array.isArray(v) ? v[0] : v);

// The subject a link brought (?kind=&ref=&label=), or null.
function subjectFrom(query) {
  const kind = first(query.kind);
  if (!kind || !CONTEXT_KINDS.includes(String(kind))) return null;
  const ref = first(query.ref);
  const label = first(query.label);
  return { kind: String(kind), id: ref ? String(ref).slice(0, 80) : '', label: label ? String(label).slice(0, 80) : '' };
}

function subjectQuery(subject) {
  const qs = new URLSearchParams({ kind: subject.kind });
  if (subject.id) qs.set('ref', subject.id);
  if (subject.label) qs.set('label', subject.label);
  return qs.toString();
}

// A subject the conversation is already about needs no chip.
function sameContext(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.id || b.id) return a.id === b.id;
  return a.label === b.label;
}

export async function getServerSideProps({ req, res, params, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  // One segment at most, and never one that looks like a file: the
  // middleware skips those addresses (lib/pageSegments.js).
  if (segmentsRefused(params && params.id)) return { notFound: true };
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  const base = {
    mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator,
    viewerId: account.userId || null
  };
  const nothing = { inbox: { threads: [], unread: 0 }, active: null, compose: null, pending: null, pendingRefused: null, notFound: false, loadError: null };
  if (!account.isSignedIn) return { props: { ...base, ...nothing } };

  const me = account.userId;
  const threadId = params.id && params.id[0] ? String(params.id[0]) : null;
  const to = first(query.to) ? String(first(query.to)) : null;
  const subject = subjectFrom(query);
  const out = { ...nothing };
  try {
    out.inbox = await listThreads(me);
    if (threadId) {
      try {
        out.active = await getConversation(me, threadId);
      } catch (err) {
        if (err.status === 404) out.notFound = true; else throw err;
      }
      // A subject brought onto a conversation that exists: the composer
      // says the next message is about it. A read error leaves it out
      // rather than the conversation.
      if (out.active && subject) {
        try {
          const r = await resolveContext(me, out.active.thread.other.userId, subject);
          if (r.refused) out.pendingRefused = r.refused;
          else if (r.context && !sameContext(r.context, out.active.thread.context)) out.pending = r.context;
        } catch (err) {
          console.error('messages page subject:', err.message);
        }
      }
    } else if (to && to !== me && !looksLikeUserId(to)) {
      // A made-up id would break the block lookup's filter string.
      out.notFound = true;
    } else if (to && to !== me) {
      // Starting a conversation: if one exists already, open it instead,
      // with the subject (only when one was given).
      const existing = out.inbox.threads.find((t) => t.other.userId === to);
      if (existing) return { redirect: { destination: `/messages/${existing.id}${subject ? `?${subjectQuery(subject)}` : ''}`, permanent: false } };
      const [profile, blocks, resolved] = await Promise.all([
        getPublicProfile(to),
        getBlocksBetween(me, to),
        subject ? resolveContext(me, to, subject) : Promise.resolve({ context: null })
      ]);
      const p = profile || placeholderProfile(to);
      out.compose = {
        other: { userId: p.userId, displayName: p.displayName, handle: p.handle || null, avatarUrl: p.avatarUrl || null, avatarPosition: p.avatarPosition || null, avatarZoom: p.avatarZoom || null, profilePath: profilePath(p) },
        context: resolved.context || null,
        refused: resolved.refused || null,
        ...blocks
      };
    }
  } catch (err) {
    console.error('messages page:', err.message);
    out.loadError = err.status === 503 ? err.message : 'Messages couldn’t load just now.';
  }
  return { props: { ...base, ...out } };
}

/* ---------- small pieces ---------- */

const KIND_PATHS = {
  call: <><path d="M4 10v4h3l6 4V6L7 10z" /><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5" /></>,
  gear: <><rect x="3.5" y="7" width="17" height="12" rx="2" /><circle cx="12" cy="13" r="3.2" /><path d="M8.5 7l1.5-2.5h4L15.5 7" /></>,
  location: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  production: <><rect x="3.5" y="9.5" width="17" height="10" rx="1.5" /><path d="M3.5 9.5l1.6-4.5h13.8l1.6 4.5" /><path d="M9 5l-1.5 4.5M14 5l-1.5 4.5M19 5l-1.5 4.5" /></>,
  card: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6.4 15.8c.6-1.4 1.5-2.1 2.6-2.1s2 .7 2.6 2.1" /><path d="M14 10h4M14 13.5h3" /></>,
  profile: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
  direct: <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H10.5l-4 3.5V16a2 2 0 0 1-2-2z" />
};
const kindOf = (context) => (context && CONTEXT_LABELS[context.kind] ? context.kind : 'direct');

function KindIcon({ kind, size = 13 }) {
  const k = KIND_PATHS[kind] ? kind : 'direct';
  return (
    <svg className={`dm2-kind k-${k}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{KIND_PATHS[k]}</svg>
  );
}

function Icon({ name, size = 20, stroke = 2 }) {
  const paths = {
    pencil: <><path d="M12 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V12" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
    back: <path d="M15 5l-7 7 7 7" />,
    send: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    belloff: <><path d="M6 16v-5a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8" /><path d="M10 20a2 2 0 0 0 4 0" /><path d="M4 4l16 16" /></>,
    bell: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
    person: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
    block: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
    flag: <path d="M5 21V4h12l-2 4 2 4H5" />,
    chat: KIND_PATHS.direct,
    arrow: <path d="M9 6l6 6-6 6" />
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
  );
}

function MoreDots({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;
}

// A person's photo at their focal point and zoom (CrewBits' Avatar, which
// draws AvatarPhoto), sized by the class: row / head / pick.
function Face({ person, size = 'row' }) {
  const p = person || {};
  return (
    <span className={`dm2-face ${size}`} aria-hidden="true">
      <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="sm" />
    </span>
  );
}

// True on a screen with a mouse or a trackpad (Enter sends there).
const finePointer = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const phoneWidth = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899.98px)').matches;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
function trapTab(e, root) {
  if (e.key !== 'Tab' || !root) return;
  const items = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) return;
  const firstEl = items[0];
  const lastEl = items[items.length - 1];
  if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
  else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
}

/* ---------- the page ---------- */

export default function MessagesPage({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, inbox: initialInbox, active: initialActive, compose, pending: initialPending, pendingRefused, notFound, loadError }) {
  const router = useRouter();
  const openId = initialActive ? initialActive.thread.id : null;
  const [threads, setThreads] = useState(() => initialInbox.threads.map((t) => (t.id === openId ? { ...t, unread: false } : t)));
  const [active, setActive] = useState(initialActive);
  const [composeWith, setComposeWith] = useState(compose);
  const [pending, setPending] = useState(initialPending);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [toast, setToast] = useState(null);
  // Times and day labels follow the viewer's own clock, so they're drawn
  // once the page is in the browser (the server's time zone isn't theirs).
  const [ready, setReady] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const mainRef = useRef(null);

  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    setActive(initialActive);
    setComposeWith(compose);
    setPending(initialPending);
  }, [initialActive, compose, initialPending]);
  useEffect(() => {
    const id = initialActive ? initialActive.thread.id : null;
    setThreads(initialInbox.threads.map((t) => (t.id === id ? { ...t, unread: false } : t)));
  }, [initialInbox, initialActive]);
  // A move to another page closes New message.
  useEffect(() => {
    const close = () => setNewOpen(false);
    router.events.on('routeChangeStart', close);
    return () => router.events.off('routeChangeStart', close);
  }, [router.events]);

  const toastTimer = useRef(null);
  const showToast = useCallback((text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Poll the open conversation and the inbox while the tab is visible.
  useEffect(() => {
    if (!isSignedIn) return undefined;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const a = activeRef.current;
      if (!a) return;
      const last = a.messages.length ? a.messages[a.messages.length - 1].createdAt : null;
      try {
        const res = await fetch(`/api/messages/${a.thread.id}${last ? `?since=${encodeURIComponent(last)}` : ''}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages && data.messages.length) {
          const newest = data.messages[data.messages.length - 1];
          setActive((cur) => (cur && cur.thread.id === a.thread.id ? { ...cur, messages: [...cur.messages, ...data.messages.filter((m) => !cur.messages.some((x) => x.id === m.id))] } : cur));
          setThreads((list) => list.map((t) => (t.id === a.thread.id ? { ...t, unread: false, preview: newest.body.slice(0, 120), lastMessageAt: newest.createdAt, lastSenderId: newest.senderId } : t)));
        }
      } catch (err) { /* next tick */ }
    };
    const inboxTick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/messages');
        if (!res.ok) return;
        const data = await res.json();
        const open = activeRef.current ? activeRef.current.thread.id : null;
        setThreads((data.threads || []).map((t) => (t.id === open ? { ...t, unread: false } : t)));
      } catch (err) { /* next tick */ }
    };
    const a = setInterval(tick, POLL_MS);
    const b = setInterval(inboxTick, INBOX_POLL_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [isSignedIn]);

  const convo = active ? active.thread : composeWith;

  // A phone's conversation fills what the person can see, the keyboard
  // taken off (the visual viewport, where the browser has one).
  useEffect(() => {
    const el = mainRef.current;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!convo || !el || !vv) return undefined;
    const set = () => {
      if (!phoneWidth()) { el.style.removeProperty('--dm2-vvh'); el.style.removeProperty('--dm2-vvt'); return; }
      el.style.setProperty('--dm2-vvh', `${Math.round(vv.height)}px`);
      el.style.setProperty('--dm2-vvt', `${Math.round(vv.offsetTop)}px`);
    };
    set();
    vv.addEventListener('resize', set);
    vv.addEventListener('scroll', set);
    window.addEventListener('resize', set);
    return () => {
      vv.removeEventListener('resize', set);
      vv.removeEventListener('scroll', set);
      window.removeEventListener('resize', set);
      el.style.removeProperty('--dm2-vvh');
      el.style.removeProperty('--dm2-vvt');
    };
  }, [Boolean(convo)]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => filterThreads(threads, { filter, query }), [threads, filter, query]);
  const inConvo = Boolean(convo);

  return (
    <>
      <Head>
        <title>{`${MESSAGE_WORDS.title} — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      {/* display: contents, so the header stays sticky; hidden under 900px
          while a conversation is open (it is full screen there). */}
      <div className={`dm2-chrome${inConvo ? ' in-convo' : ''}`}>
        <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      </div>

      <main id="main-content" ref={mainRef} className={`dm2-page${isSignedIn ? ' is-in' : ''}${inConvo ? ' has-convo' : ''}`}>
        {!isSignedIn ? (
          <div className="dm2-signin">
            <h1 className="dm2-title">{MESSAGE_WORDS.title}</h1>
            <p>{MESSAGE_WORDS.signIn}</p>
            <SignInHere><button type="button" className="dm2-pill primary">Sign in or create an account</button></SignInHere>
          </div>
        ) : (
          <>
            <section className="dm2-list" aria-label={MESSAGE_WORDS.title}>
              <div className="dm2-head">
                <div className="dm2-titlerow">
                  <h1 className="dm2-title">{MESSAGE_WORDS.title}</h1>
                  <button type="button" className="dm2-newbtn" aria-label={MESSAGE_WORDS.newMessage} title={MESSAGE_WORDS.newMessage} onClick={() => setNewOpen(true)}><Icon name="pencil" size={20} stroke={2.2} /></button>
                </div>
                {notFound && <div className="dm2-note" role="status">{MESSAGE_WORDS.notHere}</div>}
                {loadError && <div className="dm2-note error" role="alert">{loadError}</div>}
                {threads.length > 0 && (
                  <>
                    <label className="dm2-search">
                      <Icon name="search" size={16} />
                      <input type="search" placeholder={MESSAGE_WORDS.search} aria-label={MESSAGE_WORDS.search} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
                    </label>
                    <div className="dm2-chips">
                      {FILTERS.map((f) => (
                        <button key={f} type="button" className="dm2-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{filterLabel(f, threads)}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {!loadError && threads.length === 0 ? (
                <div className="dm2-empty">
                  <span className="dm2-empty-icon" aria-hidden="true"><Icon name="chat" size={32} stroke={1.8} /></span>
                  <h2>{MESSAGE_WORDS.emptyTitle}</h2>
                  <p>{MESSAGE_WORDS.emptyLine}</p>
                  <Link href="/crew?tab=people" className="dm2-pill primary">{MESSAGE_WORDS.findPeople}</Link>
                  <button type="button" className="dm2-pill quiet" onClick={() => setNewOpen(true)}>{MESSAGE_WORDS.writeTo}</button>
                </div>
              ) : (
                <div className="dm2-rows">
                  {shown.length === 0 && threads.length > 0 && <div className="dm2-filter-empty">{emptyFilterLine(filter, query)}</div>}
                  {shown.map((t) => <ThreadRow key={t.id} thread={t} viewerId={viewerId} current={Boolean(active && active.thread.id === t.id)} ready={ready} />)}
                </div>
              )}
            </section>

            <section className="dm2-convo" aria-label={convo ? convo.other.displayName : MESSAGE_WORDS.title}>
              {convo ? (
                <Conversation
                  key={active ? active.thread.id : `to-${convo.other.userId}`}
                  active={active}
                  setActive={setActive}
                  composeWith={composeWith}
                  setComposeWith={setComposeWith}
                  setThreads={setThreads}
                  pending={pending}
                  setPending={setPending}
                  pendingRefused={pendingRefused}
                  viewerId={viewerId}
                  ready={ready}
                  showToast={showToast}
                />
              ) : (
                <div className="dm2-pick">
                  <span className="dm2-empty-icon" aria-hidden="true"><Icon name="chat" size={28} stroke={1.8} /></span>
                  <p>{MESSAGE_WORDS.pick}</p>
                </div>
              )}
            </section>
            {newOpen && <NewMessage onClose={() => setNewOpen(false)} />}
          </>
        )}
        {toast && <div className={`dm2-toast${inConvo ? ' over-composer' : ''}`} role="status">{toast}</div>}
      </main>

      {!isSignedIn && <Footer />}
      <div className={`dm2-chrome${inConvo ? ' in-convo' : ''}`}>
        <MobileTabBar />
      </div>
    </>
  );
}

/* ---------- a row of the inbox ---------- */

function ThreadRow({ thread: t, viewerId, current, ready }) {
  const mine = t.lastSenderId && t.lastSenderId === viewerId;
  const line = t.preview ? `${mine ? MESSAGE_WORDS.you : ''}${t.preview}` : MESSAGE_WORDS.newConversation;
  return (
    <Link href={`/messages/${t.id}`} className={`dm2-row${t.unread ? ' unread' : ''}${current ? ' current' : ''}`} aria-current={current ? 'true' : undefined}>
      <Face person={t.other} size="row" />
      <span className="dm2-row-body">
        <span className="dm2-row-top">
          <span className="dm2-row-name">
            <span className="dm2-row-name-text">{t.other.displayName}</span>
            {t.muted && <span className="dm2-row-muted" role="img" aria-label={MESSAGE_WORDS.muted} title={MESSAGE_WORDS.muted}><Icon name="belloff" size={14} /></span>}
          </span>
          <span className="dm2-row-time">{ready ? listTime(t.lastMessageAt) : ''}</span>
        </span>
        <span className="dm2-row-line">
          <span className="dm2-row-preview">{line}</span>
          {t.unread && <span className="dm2-dot" role="img" aria-label={MESSAGE_WORDS.unread} />}
        </span>
        <span className="dm2-row-ctx"><KindIcon kind={kindOf(t.context)} />{contextLine(t.context)}</span>
      </span>
    </Link>
  );
}

/* ---------- a conversation ---------- */

function Conversation({ active, setActive, composeWith, setComposeWith, setThreads, pending, setPending, pendingRefused, viewerId, ready, showToast }) {
  const router = useRouter();
  const convo = active ? active.thread : composeWith;
  const other = convo.other;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const taRef = useRef(null);
  const link = contextLink(convo.context, other);
  const messages = active ? active.messages : [];
  const blocked = convo.iBlocked || convo.blockedMe;
  const refusedHere = !active && composeWith && composeWith.refused;

  // Keep the newest message in view.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, ready]);

  // The box grows with what is written, to about six lines (CSS caps it).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // Back to the plain address once a brought subject is used or dropped
  // (shallow: the page doesn't load again).
  function clearSubjectFromAddress() {
    if (!active) return;
    if (router.query.kind || router.query.ref || router.query.label) router.replace(`/messages/${active.thread.id}`, undefined, { shallow: true, scroll: false });
  }

  function dropPending() {
    setPending(null);
    clearSubjectFromAddress();
  }

  async function send(e) {
    if (e) e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const subject = active ? pending : composeWith.context;
      const context = subject ? { kind: subject.kind, id: subject.id || undefined, label: subject.label } : undefined;
      const url = active ? `/api/messages/${active.thread.id}` : '/api/messages';
      const payload = active ? { body, ...(context ? { context } : {}) } : { toUserId: other.userId, body, ...(context ? { context } : {}) };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send that.');
      setDraft('');
      if (active) {
        const threadId = active.thread.id;
        const nextContext = pending || active.thread.context;
        // A poll that was already on the wire can bring this same message
        // back first, so only add it if it isn't there yet.
        setActive((cur) => ({ ...cur, thread: { ...cur.thread, context: nextContext }, messages: cur.messages.some((x) => x.id === data.message.id) ? cur.messages : [...cur.messages, data.message] }));
        setThreads((list) => {
          const t = list.find((x) => x.id === threadId);
          const updated = { ...(t || { id: threadId, other: active.thread.other, muted: active.thread.muted }), context: nextContext, preview: body.slice(0, 120), lastMessageAt: data.message.createdAt, lastSenderId: viewerId, unread: false };
          return [updated, ...list.filter((x) => x.id !== threadId)];
        });
        if (pending) { setPending(null); clearSubjectFromAddress(); }
      } else {
        router.replace(`/messages/${data.threadId}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.nativeEvent && e.nativeEvent.isComposing) return;
    // A keyboard and a mouse: Enter sends, Shift+Enter is a new line. A
    // touch screen's Enter is a new line (the send button sends).
    if (!finePointer()) return;
    e.preventDefault();
    send();
  }

  async function setBlock(next) {
    const res = await fetch('/api/messages/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: other.userId, blocked: next }) });
    if (!res.ok) return false;
    if (active) setActive((cur) => ({ ...cur, thread: { ...cur.thread, iBlocked: next } }));
    else setComposeWith((cur) => ({ ...cur, iBlocked: next }));
    showToast(next ? MESSAGE_WORDS.blockedToast : MESSAGE_WORDS.unblockedToast);
    return true;
  }

  async function setMuted(next) {
    if (!active) return false;
    const res = await fetch(`/api/messages/${active.thread.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ muted: next }) });
    if (!res.ok) return false;
    setActive((cur) => ({ ...cur, thread: { ...cur.thread, muted: next } }));
    setThreads((list) => list.map((t) => (t.id === active.thread.id ? { ...t, muted: next } : t)));
    showToast(next ? MESSAGE_WORDS.mutedToast : MESSAGE_WORDS.unmutedToast);
    return true;
  }

  async function report(reason) {
    if (!active) return false;
    const res = await fetch('/api/messages/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: active.thread.id, reason }) });
    const data = await res.json().catch(() => ({}));
    showToast(res.ok ? MESSAGE_WORDS.reportedToast : data.error || 'Could not send that report.');
    return res.ok;
  }

  const groups = ready ? dayGroups(messages, viewerId) : [{ key: 'all', label: '', items: messages.map((m) => ({ ...m, mine: m.senderId === viewerId, time: '' })) }];
  const near = draft.length >= MAX_MESSAGE_CHARS - 200;
  const about = active ? pendingAbout(pending) : null;
  const subjectKind = kindOf(convo.context);

  return (
    <div className="dm2-thread">
      <div className="dm2-top">
        <Link href="/messages" className="dm2-back" aria-label={MESSAGE_WORDS.back} title={MESSAGE_WORDS.back}><Icon name="back" size={22} stroke={2.2} /></Link>
        <Link href={other.profilePath} className="dm2-who">
          <Face person={other} size="head" />
          <span className="dm2-who-text">
            <span className="dm2-who-name">{other.displayName}</span>
            {other.handle && <span className="dm2-who-handle">@{other.handle}</span>}
          </span>
        </Link>
        <Link href={other.profilePath} className="dm2-pill outline dm2-profile-pill">{MESSAGE_WORDS.viewProfile}</Link>
        <MoreMenu
          other={other}
          link={link}
          canMute={Boolean(active)}
          muted={Boolean(active && active.thread.muted)}
          iBlocked={Boolean(convo.iBlocked)}
          canReport={Boolean(active)}
          onMute={setMuted}
          onBlock={setBlock}
          onReport={report}
        />
      </div>

      {convo.context && (link ? (
        <Link href={link.href} className={`dm2-subject k-${subjectKind}`}>
          <SubjectBody context={convo.context} kind={subjectKind} />
          <span className="dm2-subject-go">{link.label} ›</span>
        </Link>
      ) : (
        <div className={`dm2-subject k-${subjectKind}`}>
          <SubjectBody context={convo.context} kind={subjectKind} />
        </div>
      ))}

      <div className="dm2-msgs" ref={listRef}>
        <div className="dm2-msgs-in">
          {messages.length === 0 && !refusedHere && !blocked && <div className="dm2-hello">{MESSAGE_WORDS.sayHello(firstName(other.displayName))}</div>}
          {messages.length > 0 && groups.map((g) => (
            <div key={g.key} className="dm2-daygroup">
              {g.label && <div className="dm2-day">{g.label}</div>}
              {g.items.map((m) => (
                <div key={m.id} className={`dm2-msg${m.mine ? ' mine' : ''}`}>
                  <div className="dm2-bubble">{m.body}</div>
                  {m.time && <div className="dm2-time">{m.time}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="dm2-composer">
        {refusedHere ? (
          <div className="dm2-blocked" role="status">{composeWith.refused}</div>
        ) : blocked ? (
          <div className="dm2-blocked" role="status">
            {convo.iBlocked ? (
              <>
                <span>{MESSAGE_WORDS.youBlocked(other.displayName)}</span>
                <button type="button" className="dm2-pill outline" onClick={() => setBlock(false)}>{MESSAGE_WORDS.unblock}</button>
              </>
            ) : <span>{MESSAGE_WORDS.theyBlocked}</span>}
          </div>
        ) : (
          <form className="dm2-compose" onSubmit={send}>
            {pendingRefused && active && <div className="dm2-note" role="status">{pendingRefused}</div>}
            {about && (
              <div className={`dm2-about k-${kindOf(pending)}`}>
                <KindIcon kind={kindOf(pending)} size={14} />
                <span className="dm2-about-text">{about}</span>
                <button type="button" aria-label={MESSAGE_WORDS.dropAbout} title={MESSAGE_WORDS.dropAbout} onClick={dropPending}><Icon name="close" size={14} /></button>
              </div>
            )}
            <div className="dm2-compose-row">
              <label className="dm2-field">
                <textarea
                  ref={taRef}
                  rows={1}
                  value={draft}
                  maxLength={MAX_MESSAGE_CHARS}
                  placeholder={MESSAGE_WORDS.placeholder(firstName(other.displayName))}
                  aria-label={MESSAGE_WORDS.placeholder(firstName(other.displayName))}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              </label>
              <button type="submit" className={`dm2-send${draft.trim() ? ' ready' : ''}`} aria-label={MESSAGE_WORDS.send} title={MESSAGE_WORDS.send} disabled={busy || !draft.trim()}><Icon name="send" size={20} stroke={2.2} /></button>
            </div>
            {near && <div className="dm2-count" aria-live="polite">{draft.length}/{MAX_MESSAGE_CHARS}</div>}
            {error && <div className="dm2-error" role="alert">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

function SubjectBody({ context, kind }) {
  return (
    <>
      <span className="dm2-subject-icon" aria-hidden="true"><KindIcon kind={kind} size={17} /></span>
      <span className="dm2-subject-text">
        <span className="dm2-subject-kicker">{CONTEXT_LABELS[context.kind]}</span>
        {context.label && <span className="dm2-subject-label">{context.label}</span>}
      </span>
    </>
  );
}

/* ---------- ⋯: a sheet on a phone, a small menu on a laptop ---------- */

function MoreMenu({ other, link, canMute, muted, iBlocked, canReport, onMute, onBlock, onReport }) {
  const [step, setStep] = useState(null); // null | 'menu' | 'block' | 'report'
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const btnRef = useRef(null);
  const sheetRef = useRef(null);
  const scrimRef = useRef(null);

  const close = useCallback((refocus = true) => {
    setStep(null);
    setReason('');
    if (refocus && btnRef.current) btnRef.current.focus();
  }, []);

  useEffect(() => {
    if (!step) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey);
    const offSheet = keepScrollInside(sheetRef.current);
    const offScrim = keepScrollInside(scrimRef.current);
    const firstEl = sheetRef.current && sheetRef.current.querySelector(FOCUSABLE);
    if (firstEl) firstEl.focus();
    return () => { document.removeEventListener('keydown', onKey); offSheet(); offScrim(); };
  }, [step, close]);

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  return (
    <div className="dm2-more-wrap">
      <button ref={btnRef} type="button" className="dm2-more-btn" aria-label={MESSAGE_WORDS.more} title={MESSAGE_WORDS.more} aria-haspopup="dialog" aria-expanded={Boolean(step)} onClick={() => (step ? close() : setStep('menu'))}><MoreDots /></button>
      {step && <div ref={scrimRef} className="dm2-scrim" onClick={() => close()} aria-hidden="true" />}
      {step && (
        <div ref={sheetRef} className="dm2-more" role="dialog" aria-label={MESSAGE_WORDS.more} onKeyDown={(e) => trapTab(e, sheetRef.current)}>
          <span className="dm2-grab" aria-hidden="true" />
          {step === 'menu' && (
            <>
              <Link href={other.profilePath} className="dm2-more-item" onClick={() => close(false)}><Icon name="person" />{MESSAGE_WORDS.viewProfile}</Link>
              {link && <Link href={link.href} className="dm2-more-item" onClick={() => close(false)}><Icon name="arrow" />{link.label}</Link>}
              {canMute && (
                <button type="button" className="dm2-more-item two" disabled={busy} onClick={() => run(async () => { if (await onMute(!muted)) close(); })}>
                  <Icon name={muted ? 'bell' : 'belloff'} />
                  <span className="dm2-more-two"><span>{muted ? MESSAGE_WORDS.unmute : MESSAGE_WORDS.mute}</span><small>{MESSAGE_WORDS.muteLine}</small></span>
                </button>
              )}
              <span className="dm2-more-rule" aria-hidden="true" />
              {iBlocked ? (
                <button type="button" className="dm2-more-item danger" disabled={busy} onClick={() => run(async () => { if (await onBlock(false)) close(); })}><Icon name="block" />{MESSAGE_WORDS.unblock}</button>
              ) : (
                <button type="button" className="dm2-more-item danger" onClick={() => setStep('block')}><Icon name="block" />{MESSAGE_WORDS.block}</button>
              )}
              {canReport && <button type="button" className="dm2-more-item danger" onClick={() => setStep('report')}><Icon name="flag" />{MESSAGE_WORDS.report}</button>}
              <button type="button" className="dm2-more-cancel" onClick={() => close()}>{MESSAGE_WORDS.cancel}</button>
            </>
          )}
          {step === 'block' && (
            <div className="dm2-more-step">
              <p>{MESSAGE_WORDS.blockConfirm(other.displayName)}</p>
              <div className="dm2-more-acts">
                <button type="button" className="dm2-pill danger" disabled={busy} onClick={() => run(async () => { if (await onBlock(true)) close(); })}>{MESSAGE_WORDS.block}</button>
                <button type="button" className="dm2-pill quiet" onClick={() => close()}>{MESSAGE_WORDS.cancel}</button>
              </div>
            </div>
          )}
          {step === 'report' && (
            <form className="dm2-more-step" onSubmit={(e) => { e.preventDefault(); if (reason) run(async () => { if (await onReport(reason)) close(); }); }}>
              <p><b>{MESSAGE_WORDS.report}</b><br />{MESSAGE_WORDS.reportLine}</p>
              <fieldset className="dm2-reasons">
                <legend>{MESSAGE_WORDS.reportPick}</legend>
                {Object.entries(REPORT_REASONS).map(([k, v]) => (
                  <label key={k} className="dm2-reason"><input type="radio" name="dm2-reason" value={k} checked={reason === k} onChange={() => setReason(k)} /><span>{v}</span></label>
                ))}
              </fieldset>
              <div className="dm2-more-acts">
                <button type="submit" className="dm2-pill danger" disabled={busy || !reason}>{MESSAGE_WORDS.reportSend}</button>
                <button type="button" className="dm2-pill quiet" onClick={() => close()}>{MESSAGE_WORDS.cancel}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- New message ---------- */

function NewMessage({ onClose }) {
  const [text, setText] = useState('');
  const [suggested, setSuggested] = useState(null); // { productions, following } | null while loading
  const [found, setFound] = useState({ q: '', people: null, error: null });
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const latest = useRef('');
  const inFlight = useRef(false);
  const timer = useRef(null);
  const { q, handle, ready } = peopleQuery(text);
  const key = ready ? `${handle ? '@' : ''}${q.toLowerCase()}` : '';

  // The page polls (and re-renders) while this is open: the opening
  // effect runs once, so focus isn't pulled back to the box every tick.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement;
    if (inputRef.current) inputRef.current.focus();
    const off = keepScrollInside(backdropRef.current);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      off();
      document.removeEventListener('keydown', onKey);
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus();
    };
  }, []);

  // Who to suggest, once per opening.
  useEffect(() => {
    let live = true;
    fetch('/api/messages/people')
      .then((r) => (r.ok ? r.json() : { productions: [], following: [] }))
      .then((d) => { if (live) setSuggested({ productions: d.productions || [], following: d.following || [] }); })
      .catch(() => { if (live) setSuggested({ productions: [], following: [] }); });
    return () => { live = false; };
  }, []);

  // The search: wait a moment after typing stops, one request at a time,
  // the newest answer wins.
  const ask = useCallback(async () => {
    if (inFlight.current) return;
    const want = latest.current;
    if (!want) return;
    inFlight.current = true;
    let answer = { q: want, people: [], error: null };
    try {
      const res = await fetch(`/api/messages/people?q=${encodeURIComponent(want)}`);
      const data = await res.json().catch(() => ({}));
      answer = res.ok ? { q: want, people: data.people || [], error: null } : { q: want, people: [], error: data.error || null };
    } catch (err) {
      answer = { q: want, people: [], error: null };
    }
    inFlight.current = false;
    if (latest.current === want) setFound(answer);
    else if (latest.current) ask();
  }, []);

  useEffect(() => {
    latest.current = key;
    clearTimeout(timer.current);
    if (!key) return undefined;
    timer.current = setTimeout(ask, SEARCH_WAIT_MS);
    return () => clearTimeout(timer.current);
  }, [key, ask]);

  const typing = text.trim().length > 0;
  const people = found.q === key ? found.people : null;

  return (
    <div ref={backdropRef} className="dm2-new-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="dm2-new" role="dialog" aria-modal="true" aria-labelledby="dm2-new-title" onKeyDown={(e) => trapTab(e, dialogRef.current)}>
        <span className="dm2-grab" aria-hidden="true" />
        <div className="dm2-new-head">
          <h2 id="dm2-new-title">{MESSAGE_WORDS.newMessage}</h2>
          <button type="button" className="dm2-x" aria-label="Close" onClick={onClose}><Icon name="close" size={17} /></button>
        </div>
        <label className="dm2-to">
          <span>{MESSAGE_WORDS.to}</span>
          <input ref={inputRef} type="search" value={text} placeholder={MESSAGE_WORDS.toPlaceholder} aria-label={MESSAGE_WORDS.toPlaceholder} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        </label>
        <div className="dm2-new-list">
          {!typing && suggested && (
            <>
              {suggested.productions.length > 0 && <PeopleGroup title={MESSAGE_WORDS.productions} people={suggested.productions} />}
              {suggested.following.length > 0 && <PeopleGroup title={MESSAGE_WORDS.following} people={suggested.following} />}
            </>
          )}
          {typing && !ready && <div className="dm2-new-line">{MESSAGE_WORDS.typeMore}</div>}
          {typing && ready && people === null && <div className="dm2-new-line">{MESSAGE_WORDS.searching}</div>}
          {typing && ready && people !== null && (found.error ? <div className="dm2-new-line">{found.error}</div> : people.length === 0 ? <div className="dm2-new-line">{MESSAGE_WORDS.nobody}</div> : <PeopleGroup people={people} />)}
        </div>
        <Link href="/crew?tab=people" className="dm2-new-crew" onClick={onClose}>{MESSAGE_WORDS.findPeople} <span aria-hidden="true">→</span></Link>
      </div>
    </div>
  );
}

function PeopleGroup({ title, people }) {
  return (
    <div className="dm2-people">
      {title && <div className="dm2-people-title">{title}</div>}
      {people.map((p) => (
        <Link key={p.userId} href={`/messages?to=${encodeURIComponent(p.userId)}`} className="dm2-person">
          <Face person={p} size="pick" />
          <span className="dm2-person-text">
            <span className="dm2-person-name">{p.displayName}</span>
            {personLine(p) && <span className="dm2-person-line">{personLine(p)}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}
