import { useCallback, useEffect, useRef, useState } from 'react';

import type { FatalReason } from '../lib/connection';
import { inviteLink, isGeneratedCode } from '../lib/room';
import { useChat, type MemberView } from '../lib/useChat';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { AlertIcon, ArrowLeftIcon, CloseIcon, CopyIcon, LinkIcon, LockIcon, UsersIcon } from './Icons';
import { MessageList } from './MessageList';

const BASE_TITLE = document.title;

const FATAL_COPY: Record<FatalReason, { title: string; body: string }> = {
  room_full: { title: 'This room is full', body: 'Rooms hold up to 50 people. Try again later or start a new room.' },
  server_full: { title: 'The server is busy', body: 'Too many rooms are open right now. Please try again in a moment.' },
  rate_limited: { title: 'Disconnected', body: 'You were sending messages too quickly. Rejoin to keep chatting.' },
  bad_request: { title: 'Connection rejected', body: 'Something went wrong talking to the server. Try rejoining.' },
  not_joined: { title: 'Connection rejected', body: 'Something went wrong talking to the server. Try rejoining.' },
  already_joined: { title: 'Connection rejected', body: 'Something went wrong talking to the server. Try rejoining.' },
  unknown: { title: 'Disconnected', body: 'The connection was closed. Try rejoining.' },
};

interface Props {
  room: string;
  name: string;
  onLeave(): void;
  onRejoin(): void;
}

export function ChatRoom({ room, name, onLeave, onRejoin }: Props) {
  const { state, send, retry, notifyTyping, dismissNotice } = useChat(room, name);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isPrivate = isGeneratedCode(room);
  const title = isPrivate ? 'Private room' : room;
  const online = state.status === 'online' && state.selfId !== null;

  const showToast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const copyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(room));
      showToast('Invite link copied');
    } catch {
      setPanelOpen(true);
      showToast('Copy the link from the room panel');
    }
  }, [room, showToast]);

  useUnreadTitle(state.received);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanelOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  if (state.fatal) {
    const copy = FATAL_COPY[state.fatal];
    return (
      <div className="center-screen">
        <div className="card fatal" role="alert">
          <span className="fatal-icon">
            <AlertIcon size={22} />
          </span>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <div className="fatal-actions">
            <button className="btn btn-primary" type="button" onClick={onRejoin}>
              Rejoin
            </button>
            <button className="btn btn-ghost" type="button" onClick={onLeave}>
              Back to start
            </button>
          </div>
        </div>
      </div>
    );
  }

  const typingNames = Object.keys(state.typing)
    .map((id) => state.members.find((m) => m.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <div className="chat">
      <header className="chat-header">
        <button className="icon-btn" type="button" onClick={onLeave} aria-label="Leave room" title="Leave room">
          <ArrowLeftIcon />
        </button>
        <div className="chat-heading">
          <h1 className="chat-title">{title}</h1>
          <p className="chat-sub">
            <span className={`dot ${online ? 'dot-on' : 'dot-off'}`} aria-hidden="true" />
            {online ? `${state.members.length} online` : statusLabel(state.status)}
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <LockIcon size={12} /> End-to-end encrypted
          </p>
        </div>
        <button className="btn btn-secondary btn-sm hide-sm" type="button" onClick={copyInvite}>
          <LinkIcon size={16} /> Invite
        </button>
        <button
          className="icon-btn panel-toggle"
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
          aria-controls="room-panel"
          aria-label={`People in room (${state.members.length})`}
        >
          <UsersIcon />
          {state.members.length > 0 && <span className="badge">{state.members.length}</span>}
        </button>
      </header>

      {state.status === 'reconnecting' && (
        <div className="banner banner-warn" role="status">
          <span className="spinner spinner-sm" aria-hidden="true" /> Connection lost. Reconnecting…
        </div>
      )}
      {state.notice && (
        <div className="banner banner-warn" role="status">
          {state.notice}
          <button className="link-btn" type="button" onClick={dismissNotice}>
            Dismiss
          </button>
        </div>
      )}

      <div className="chat-body">
        <main className="chat-main">
          <MessageList items={state.items} ready={online} onRetry={retry} onInvite={copyInvite} />
          <div className="typing" aria-hidden="true">
            {typingNames.length > 0 && (
              <>
                <span className="typing-dots">
                  <i />
                  <i />
                  <i />
                </span>
                {typingLabel(typingNames)}
              </>
            )}
          </div>
          <Composer disabled={!online} onSend={send} onTyping={notifyTyping} />
        </main>

        {panelOpen && <div className="scrim" onClick={() => setPanelOpen(false)} aria-hidden="true" />}
        <aside id="room-panel" className={`panel ${panelOpen ? 'is-open' : ''}`} aria-label="Room details">
          <div className="panel-head">
            <h2>Room</h2>
            <button className="icon-btn panel-close" type="button" onClick={() => setPanelOpen(false)} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <InviteBox room={room} onCopy={copyInvite} />
          <h2 className="panel-subhead">People · {state.members.length}</h2>
          <MemberList members={state.members} selfId={state.selfId} />
          <p className="panel-note">
            <LockIcon size={14} /> Names and messages are encrypted with a key derived from the invite link. The
            server can’t read them.
          </p>
        </aside>
      </div>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}

function InviteBox({ room, onCopy }: { room: string; onCopy(): void }) {
  const link = inviteLink(room);
  return (
    <div className="invite-box">
      <label htmlFor="invite-link" className="sr-only">
        Invite link
      </label>
      <input id="invite-link" className="input input-sm" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      <button className="btn btn-primary btn-sm" type="button" onClick={onCopy}>
        <CopyIcon size={16} /> Copy
      </button>
    </div>
  );
}

function MemberList({ members, selfId }: { members: MemberView[]; selfId: string | null }) {
  const sorted = [...members].sort((a, b) =>
    a.id === selfId ? -1 : b.id === selfId ? 1 : a.name.localeCompare(b.name),
  );
  return (
    <ul className="members">
      {sorted.map((m) => (
        <li key={m.id}>
          <Avatar name={m.name} size={28} />
          <span className="member-name">{m.name}</span>
          {m.id === selfId && <span className="you">you</span>}
        </li>
      ))}
    </ul>
  );
}

function statusLabel(status: string): string {
  if (status === 'deriving') return 'Securing…';
  if (status === 'reconnecting') return 'Reconnecting…';
  return 'Connecting…';
}

function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

/** Show "(3) quietroom" in the tab title while the tab is hidden. */
function useUnreadTitle(theirCount: number) {
  const baseline = useRef(theirCount);
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) {
        baseline.current = theirCount;
        document.title = BASE_TITLE;
      }
    };
    if (document.hidden) {
      const unread = theirCount - baseline.current;
      document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    } else {
      baseline.current = theirCount;
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [theirCount]);
  useEffect(() => () => void (document.title = BASE_TITLE), []);
}
