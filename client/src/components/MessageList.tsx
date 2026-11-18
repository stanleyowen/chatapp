import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { Item } from '../lib/useChat';
import { Avatar } from './Avatar';
import { AlertIcon, ArrowDownIcon, ClockIcon, LinkIcon, LockIcon } from './Icons';

const GROUP_WINDOW_MS = 5 * 60_000;
const NEAR_BOTTOM_PX = 120;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function scrollToBottom(el: HTMLElement | null, smooth: boolean) {
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
}

interface Props {
  items: Item[];
  ready: boolean;
  onRetry(item: Item): void;
  onInvite(): void;
}

export function MessageList({ items, ready, onRetry, onInvite }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const prevLen = useRef(items.length);

  useLayoutEffect(() => {
    const added = items.length - prevLen.current;
    prevLen.current = items.length;
    const last = items.at(-1);
    if (atBottom.current || (last?.kind === 'msg' && last.mine && last.state === 'pending')) {
      scrollToBottom(scroller.current, false);
      setUnseen(0);
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [items]);

  // Keep pinned to the bottom when the viewport resizes (mobile keyboard).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) scrollToBottom(el, false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current) setUnseen(0);
  };

  return (
    <div className="messages-wrap">
      <div
        className="messages"
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Messages"
        // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        {items.length === 0 ? (
          <EmptyState ready={ready} onInvite={onInvite} />
        ) : (
          <ol className="message-items">
            {items.map((item, i) => (
              <Row key={item.key} item={item} prev={items[i - 1]} onRetry={onRetry} />
            ))}
          </ol>
        )}
      </div>
      {unseen > 0 && (
        <button className="jump" type="button" onClick={() => scrollToBottom(scroller.current, true)}>
          <ArrowDownIcon size={16} /> {unseen === 1 ? '1 new message' : `${unseen} new messages`}
        </button>
      )}
    </div>
  );
}

function EmptyState({ ready, onInvite }: { ready: boolean; onInvite(): void }) {
  if (!ready) {
    return (
      <div className="empty" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p className="empty-title">Securing your connection…</p>
        <p className="empty-text">Deriving the room key in your browser.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <span className="empty-icon">
        <LockIcon size={22} />
      </span>
      <p className="empty-title">This room is end-to-end encrypted</p>
      <p className="empty-text">
        Only people with the invite link can read messages here. Nothing is saved – new arrivals won’t see earlier
        messages.
      </p>
      <button className="btn btn-secondary" type="button" onClick={onInvite}>
        <LinkIcon size={16} /> Copy invite link
      </button>
    </div>
  );
}

const Row = memo(function Row({ item, prev, onRetry }: { item: Item; prev: Item | undefined; onRetry(i: Item): void }) {
  if (item.kind === 'event') {
    return (
      <li className="event">
        <span>{item.text}</span>
      </li>
    );
  }

  const grouped =
    prev?.kind === 'msg' && prev.mine === item.mine && prev.name === item.name && item.ts - prev.ts < GROUP_WINDOW_MS;
  const time = timeFmt.format(item.ts);

  return (
    <li className={`msg ${item.mine ? 'msg-mine' : 'msg-theirs'} ${grouped ? 'msg-grouped' : ''}`}>
      {!item.mine && <div className="msg-avatar">{!grouped && <Avatar name={item.name} />}</div>}
      <div className="msg-body">
        {!grouped && (
          <div className="msg-meta">
            <span className="msg-name">{item.mine ? 'You' : item.name}</span>
            <time dateTime={new Date(item.ts).toISOString()}>{time}</time>
          </div>
        )}
        <div className={`bubble bubble-${item.state}`} title={grouped ? time : undefined}>
          <p dir="auto">{item.text}</p>
        </div>
        {item.state === 'pending' && (
          <span className="msg-status">
            <ClockIcon size={12} /> Sending…
          </span>
        )}
        {item.state === 'failed' && (
          <span className="msg-status msg-status-failed">
            <AlertIcon size={12} /> Not delivered ·{' '}
            <button type="button" className="link-btn" onClick={() => onRetry(item)}>
              Retry
            </button>
          </span>
        )}
      </div>
    </li>
  );
});
