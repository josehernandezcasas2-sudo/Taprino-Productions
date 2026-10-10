import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { Avatar } from '../../components/crew/CrewBits';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { listThreads, getConversation, getBlocksBetween } from '../../lib/messages';
import { MAX_MESSAGE_CHARS, CONTEXT_KINDS, CONTEXT_LABELS } from '../../lib/messageRules';
import { getPublicProfile, placeholderProfile, profilePath } from '../../lib/userProfiles';
import { REPORT_REASONS } from '../../lib/reportReasons';
import { SITE } from '../../lib/siteConfig';

// Messages (Crew Call step 2, mockup signed off 2026-10-09): the inbox on
// the left, one conversation on the right; on a phone it's one or the
// other. URLs: /messages (inbox), /messages/<threadId>, and
// /messages?to=<userId>&kind=gear&label=Zoom+F8n to start one from a
// card, a piece of gear or a profile. New messages arrive by polling
// while the tab is visible.
const POLL_MS = 10000;
const INBOX_POLL_MS = 30000;

export async function getServerSideProps({ req, res, params, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
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
  if (!account.isSignedIn) return { props: { ...base, inbox: { threads: [], unread: 0 }, active: null, compose: null, notFound: false } };

  const threadId = params.id && params.id[0] ? String(params.id[0]) : null;
  const to = query.to ? String(query.to) : null;
  let inbox = { threads: [], unread: 0 };
  let active = null;
  let compose = null;
  let notFound = false;
  let loadError = null;
  try {
    inbox = await listThreads(account.userId);
    if (threadId) {
      try {
        active = await getConversation(account.userId, threadId);
      } catch (err) {
        if (err.status === 404) notFound = true; else throw err;
      }
    } else if (to && to !== account.userId) {
      // Starting a conversation: if one exists already, open it instead.
      const existing = inbox.threads.find((t) => t.other.userId === to);
      if (existing) return { redirect: { destination: `/messages/${existing.id}`, permanent: false } };
      const [profile, blocks] = await Promise.all([getPublicProfile(to), getBlocksBetween(account.userId, to)]);
      const kind = CONTEXT_KINDS.includes(query.kind) ? String(query.kind) : null;
      const label = query.label ? String(query.label).slice(0, 80) : '';
      const p = profile || placeholderProfile(to);
      compose = {
        other: { userId: p.userId, displayName: p.displayName, handle: p.handle, avatarUrl: p.avatarUrl, profilePath: profilePath(p) },
        context: kind && label ? { kind, label } : null,
        ...blocks
      };
    }
  } catch (err) {
    console.error('messages page:', err.message);
    loadError = err.status === 503 ? err.message : 'Messages couldn’t load just now.';
  }
  return { props: { ...base, inbox, active, compose, notFound, loadError } };
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (now - d < 6 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const contextLabel = (ctx) => (ctx ? CONTEXT_LABELS[ctx.kind] || 'About' : '');

export default function MessagesPage({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, inbox: initialInbox, active: initialActive, compose, notFound, loadError }) {
  const router = useRouter();
  const [threads, setThreads] = useState(initialInbox.threads);
  const [active, setActive] = useState(initialActive);
  const [composeWith, setComposeWith] = useState(compose);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [toast, setToast] = useState(null);
  const listRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => { setActive(initialActive); setComposeWith(compose); setDraft(''); setError(null); setMenuOpen(false); setReporting(false); }, [initialActive, compose]);
  useEffect(() => { setThreads(initialInbox.threads); }, [initialInbox]);

  // Keep the newest message in view.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [active && active.messages.length, active && active.thread.id]);

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
          setActive((cur) => (cur && cur.thread.id === a.thread.id ? { ...cur, messages: [...cur.messages, ...data.messages.filter((m) => !cur.messages.some((x) => x.id === m.id))] } : cur));
          setThreads((list) => list.map((t) => (t.id === a.thread.id ? { ...t, unread: false, preview: data.messages[data.messages.length - 1].body.slice(0, 120), lastMessageAt: data.messages[data.messages.length - 1].createdAt, lastSenderId: data.messages[data.messages.length - 1].senderId } : t)));
        }
      } catch (err) { /* next tick */ }
    };
    const inboxTick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/messages');
        if (!res.ok) return;
        const data = await res.json();
        const openId = activeRef.current ? activeRef.current.thread.id : null;
        setThreads(data.threads.map((t) => (t.id === openId ? { ...t, unread: false } : t)));
      } catch (err) { /* next tick */ }
    };
    const a = setInterval(tick, POLL_MS);
    const b = setInterval(inboxTick, INBOX_POLL_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [isSignedIn]);

  function showToast(text) {
    setToast(text);
    setTimeout(() => setToast(null), 2600);
  }

  async function send(e) {
    if (e) e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = active ? `/api/messages/${active.thread.id}` : '/api/messages';
      const payload = active ? { body } : { toUserId: composeWith.other.userId, body, context: composeWith.context };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send that.');
      setDraft('');
      if (active) {
        setActive((cur) => ({ ...cur, messages: [...cur.messages, data.message] }));
        setThreads((list) => {
          const t = list.find((x) => x.id === active.thread.id);
          const updated = { ...(t || { id: active.thread.id, other: active.thread.other, context: active.thread.context, muted: active.thread.muted }), preview: body.slice(0, 120), lastMessageAt: data.message.createdAt, lastSenderId: viewerId, unread: false };
          return [updated, ...list.filter((x) => x.id !== active.thread.id)];
        });
      } else {
        router.replace(`/messages/${data.threadId}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMute() {
    if (!active) return;
    setMenuOpen(false);
    const muted = !active.thread.muted;
    const res = await fetch(`/api/messages/${active.thread.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ muted }) });
    if (res.ok) {
      setActive((cur) => ({ ...cur, thread: { ...cur.thread, muted } }));
      setThreads((list) => list.map((t) => (t.id === active.thread.id ? { ...t, muted } : t)));
      showToast(muted ? 'Muted. No emails or badge for this conversation.' : 'Unmuted.');
    }
  }

  async function toggleBlock() {
    const other = active ? active.thread.other : composeWith.other;
    const blocked = !(active ? active.thread.iBlocked : composeWith.iBlocked);
    setMenuOpen(false);
    if (blocked && !window.confirm(`Block ${other.displayName}? They can’t message you and won’t see your card. You can undo this here.`)) return;
    const res = await fetch('/api/messages/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: other.userId, blocked }) });
    if (res.ok) {
      if (active) setActive((cur) => ({ ...cur, thread: { ...cur.thread, iBlocked: blocked } }));
      else setComposeWith((cur) => ({ ...cur, iBlocked: blocked }));
      showToast(blocked ? 'Blocked.' : 'Unblocked.');
    }
  }

  async function sendReport(e) {
    e.preventDefault();
    if (!reportReason || !active) return;
    const res = await fetch('/api/messages/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: active.thread.id, reason: reportReason }) });
    const data = await res.json().catch(() => ({}));
    setReporting(false);
    setReportReason('');
    showToast(res.ok ? 'Reported to Studio Tapa. The last messages went with it.' : data.error || 'Could not send that report.');
  }

  const convo = active ? active.thread : composeWith;
  const blockedEither = convo && (convo.iBlocked || convo.blockedMe);
  const showList = !convo; // on phones: list or thread, not both

  return (
    <>
      <Head>
        <title>Messages — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="stage stage-single crew-page dm-page">
        <div className="crew-head">
          <div>
            <span className="crew-eyebrow">Connect</span>
            <h1>Messages</h1>
            <p>Every conversation starts from a card, a piece of gear or a call, so you always know why someone wrote.</p>
          </div>
          <Link href="/crew" className="crew-btn">Crew Call →</Link>
        </div>

        {!isSignedIn ? (
          <div className="crew-panel crew-signin">
            <p>Sign in to see your messages. Anyone with an account can write to anyone on Crew Call.</p>
            <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in or create an account</button></SignInButton>
          </div>
        ) : (
          <div className={`dm-inbox${convo ? ' has-convo' : ''}`}>
            <div className="dm-threads" aria-label="Conversations">
              {loadError && <div className="crew-panel crew-empty">{loadError}</div>}
              {!loadError && threads.length === 0 && (
                <div className="crew-panel crew-empty">No conversations yet. Say hello to someone on <Link href="/crew">Crew Call</Link>.</div>
              )}
              {threads.map((t) => (
                <Link key={t.id} href={`/messages/${t.id}`} className={`dm-thread${active && active.thread.id === t.id ? ' sel' : ''}`}>
                  <Avatar userId={t.other.userId} name={t.other.displayName} src={t.other.avatarUrl} size="sm" />
                  <span className="dm-thread-body">
                    <b>{t.other.displayName}{t.muted ? <span className="dm-muted" title="Muted"> · muted</span> : null}</b>
                    <small>{t.lastSenderId === viewerId ? 'You: ' : ''}{t.preview || 'New conversation'}</small>
                  </span>
                  <span className="dm-thread-time">{fmtTime(t.lastMessageAt)}{t.unread && <i className="dm-unread" aria-label="Unread" />}</span>
                </Link>
              ))}
            </div>

            <div className="dm-convo-wrap">
              {notFound && <div className="crew-panel crew-empty">That conversation isn’t here.</div>}
              {!convo && !notFound && <div className="crew-panel crew-empty dm-pick">Pick a conversation.</div>}
              {convo && (
                <div className="crew-panel dm-convo">
                  <div className="dm-chead">
                    <Link href="/messages" className="crew-btn sm ghost dm-back" aria-label="Back to conversations">‹</Link>
                    <Avatar userId={convo.other.userId} name={convo.other.displayName} src={convo.other.avatarUrl} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div className="crew-pname" style={{ fontSize: '0.95rem' }}>{convo.other.displayName}</div>
                      {convo.other.handle && <div className="crew-handle">@{convo.other.handle}</div>}
                    </div>
                    <div className="crew-actions dm-cacts">
                      <Link href={convo.other.profilePath} className="crew-btn sm">Profile</Link>
                      <div className="dm-menu">
                        <button type="button" className="crew-btn sm" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>⋯</button>
                        {menuOpen && (
                          <div className="dm-menu-pop" role="menu">
                            {active && <button type="button" role="menuitem" onClick={toggleMute}>{active.thread.muted ? 'Unmute' : 'Mute'}</button>}
                            <button type="button" role="menuitem" className="danger" onClick={toggleBlock}>{convo.iBlocked ? 'Unblock' : 'Block'}</button>
                            {active && <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setReporting(true); }}>Report</button>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {convo.context && (
                    <div className="dm-ctx">
                      <span className={`crew-chip ${convo.context.kind === 'gear' ? 'gear' : 'pink'}`}>{contextLabel(convo.context)}</span>
                      <b>{convo.context.label}</b>
                    </div>
                  )}

                  {reporting && (
                    <form className="dm-report" onSubmit={sendReport}>
                      <span className="crew-mono">Report this conversation — the last messages go to Studio Tapa with it.</span>
                      <div className="crew-place-row">
                        <select className="crew-select" value={reportReason} onChange={(e) => setReportReason(e.target.value)} aria-label="Reason">
                          <option value="">Pick a reason</option>
                          {Object.entries(REPORT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <button type="submit" className="crew-btn sm primary" disabled={!reportReason}>Send report</button>
                        <button type="button" className="crew-btn sm ghost" onClick={() => setReporting(false)}>Cancel</button>
                      </div>
                    </form>
                  )}

                  <div className="dm-msgs" ref={listRef}>
                    {active && active.messages.length === 0 && <div className="crew-empty">Say hello to {convo.other.displayName.split(' ')[0]}.</div>}
                    {!active && <div className="crew-empty">Say hello to {convo.other.displayName.split(' ')[0]}.{convo.context ? ` They’ll see it’s about ${convo.context.label}.` : ''}</div>}
                    {active && active.messages.map((m) => (
                      <div key={m.id} className={`dm-msg${m.senderId === viewerId ? ' me' : ''}`}>
                        {m.body}
                        <small>{fmtTime(m.createdAt)}</small>
                      </div>
                    ))}
                  </div>

                  {blockedEither ? (
                    <div className="crew-mono dm-blocked">
                      {convo.iBlocked ? <>You blocked {convo.other.displayName}. <button type="button" className="crew-btn sm ghost" onClick={toggleBlock}>Unblock</button></> : 'This person isn’t taking messages right now.'}
                    </div>
                  ) : (
                    <form className="dm-composer" onSubmit={send}>
                      <input
                        type="text"
                        className="crew-input"
                        placeholder="Write a message…"
                        value={draft}
                        maxLength={MAX_MESSAGE_CHARS}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="Message"
                        autoComplete="off"
                      />
                      <button type="submit" className="crew-btn primary" disabled={busy || !draft.trim()}>{busy ? '…' : 'Send'}</button>
                    </form>
                  )}
                  {error && <div className="crew-status error" role="alert">{error}</div>}
                </div>
              )}
            </div>
          </div>
        )}
        {showList ? null : null}
      </main>

      {toast && <div className="dm-toast" role="status">{toast}</div>}
      <Footer />
      <MobileTabBar />
    </>
  );
}
