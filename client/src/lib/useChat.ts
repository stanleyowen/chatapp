import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { ServerFrame } from '../../../shared/protocol';
import { Connection, type ConnStatus, type FatalReason } from './connection';
import { deriveRoomKeys, open, randomToken, seal, type RoomKeys } from './crypto';
import { cleanMessage, cleanName } from './text';

const WS_URL: string = import.meta.env.VITE_WS_URL || 'ws://localhost:8787/ws';
const MAX_ITEMS = 500;
const TYPING_TTL_MS = 5000;
const TYPING_THROTTLE_MS = 3000;
const SEND_TIMEOUT_MS = 10_000;

export interface MemberView {
  id: string;
  name: string;
}

export type Item =
  | {
      kind: 'msg';
      key: string;
      cid: string;
      name: string;
      text: string;
      ts: number;
      mine: boolean;
      state: 'pending' | 'sent' | 'failed';
    }
  | { kind: 'event'; key: string; text: string; ts: number };

export interface ChatState {
  status: ConnStatus | 'deriving';
  fatal: FatalReason | null;
  selfId: string | null;
  members: MemberView[];
  items: Item[];
  typing: Record<string, number>;
  notice: string | null;
  /** Count of messages received from others (drives the unread badge). */
  received: number;
}

type Action =
  | { type: 'status'; status: ChatState['status'] }
  | { type: 'fatal'; reason: FatalReason }
  | { type: 'welcome'; selfId: string; members: MemberView[] }
  | { type: 'joined'; member: MemberView }
  | { type: 'left'; id: string }
  | { type: 'append'; item: Item; from?: string }
  | { type: 'replace'; key: string; item: Item }
  | { type: 'msgState'; cid: string; state: 'sent' | 'failed'; ts?: number }
  | { type: 'typing'; id: string }
  | { type: 'pruneTyping' }
  | { type: 'notice'; text: string | null };

const initial: ChatState = {
  status: 'deriving',
  fatal: null,
  selfId: null,
  members: [],
  items: [],
  typing: {},
  notice: null,
  received: 0,
};

const event = (text: string): Item => ({ kind: 'event', key: randomToken(6), text, ts: Date.now() });

function append(items: Item[], item: Item): Item[] {
  const next = [...items, item];
  return next.length > MAX_ITEMS ? next.slice(next.length - MAX_ITEMS) : next;
}

function reducer(s: ChatState, a: Action): ChatState {
  switch (a.type) {
    case 'status':
      return s.status === a.status ? s : { ...s, status: a.status };
    case 'fatal':
      return { ...s, fatal: a.reason };
    case 'welcome':
      return {
        ...s,
        selfId: a.selfId,
        members: a.members,
        typing: {},
        // Anything unconfirmed from before a reconnect didn't make it.
        items: s.items.map((i) => (i.kind === 'msg' && i.state === 'pending' ? { ...i, state: 'failed' } : i)),
      };
    case 'joined':
      return {
        ...s,
        members: [...s.members.filter((m) => m.id !== a.member.id), a.member],
        items: append(s.items, event(`${a.member.name} joined`)),
      };
    case 'left': {
      const m = s.members.find((x) => x.id === a.id);
      const { [a.id]: _, ...typing } = s.typing;
      return {
        ...s,
        typing,
        members: s.members.filter((x) => x.id !== a.id),
        items: m ? append(s.items, event(`${m.name} left`)) : s.items,
      };
    }
    case 'append': {
      let typing = s.typing;
      if (a.from && a.from in typing) {
        const { [a.from]: _, ...rest } = typing;
        typing = rest;
      }
      return {
        ...s,
        typing,
        items: append(s.items, a.item),
        received: a.item.kind === 'msg' && !a.item.mine ? s.received + 1 : s.received,
      };
    }
    case 'replace':
      return { ...s, items: s.items.map((i) => (i.key === a.key ? a.item : i)) };
    case 'msgState':
      return {
        ...s,
        items: s.items.map((i) =>
          i.kind === 'msg' && i.mine && i.cid === a.cid && i.state !== 'sent'
            ? { ...i, state: a.state, ts: a.ts ?? i.ts }
            : i,
        ),
      };
    case 'typing':
      return { ...s, typing: { ...s.typing, [a.id]: Date.now() + TYPING_TTL_MS } };
    case 'pruneTyping': {
      const now = Date.now();
      const typing = Object.fromEntries(Object.entries(s.typing).filter(([, exp]) => exp > now));
      return Object.keys(typing).length === Object.keys(s.typing).length ? s : { ...s, typing };
    }
    case 'notice':
      return { ...s, notice: a.text };
  }
}

interface MsgPayload {
  text: string;
  from: string;
  cid: string;
}

function isMsgPayload(v: unknown): v is MsgPayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.text === 'string' && typeof o.from === 'string' && typeof o.cid === 'string';
}

async function openName(keys: RoomKeys, profile: string): Promise<string> {
  const p = await open(keys, 'profile', profile);
  const name = typeof p === 'object' && p !== null ? cleanName((p as Record<string, unknown>).n) : '';
  return name || 'Anonymous';
}

export function useChat(room: string, name: string) {
  const [state, dispatch] = useReducer(reducer, initial);
  const conn = useRef<Connection | null>(null);
  const keys = useRef<RoomKeys | null>(null);
  const self = useRef<string | null>(null);
  const names = useRef(new Map<string, string>());
  const seen = useRef(new Set<string>());
  const lastTyping = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let cancelled = false;
    let chain = Promise.resolve();
    let connection: Connection | null = null;
    const pending = timers.current;

    // Frames are handled strictly in order even though decryption is async.
    const handle = async (f: ServerFrame, k: RoomKeys): Promise<void> => {
      switch (f.t) {
        case 'welcome': {
          self.current = f.self;
          const members = await Promise.all(
            f.members.map(async (m) => ({ id: m.id, name: await openName(k, m.profile) })),
          );
          names.current = new Map(members.map((m) => [m.id, m.name]));
          dispatch({ type: 'welcome', selfId: f.self, members });
          return;
        }
        case 'joined': {
          const member = { id: f.member.id, name: await openName(k, f.member.profile) };
          names.current.set(member.id, member.name);
          dispatch({ type: 'joined', member });
          return;
        }
        case 'left':
          dispatch({ type: 'left', id: f.id });
          names.current.delete(f.id);
          return;
        case 'msg': {
          const p = await open(k, 'msg', f.data);
          // Bind attribution: the encrypted payload must agree with the relay's
          // claim about sender and id, and replays are dropped.
          if (!isMsgPayload(p) || p.from !== f.from || p.cid !== f.cid) return;
          const dedupe = `${f.from}:${f.cid}`;
          if (seen.current.has(dedupe)) return;
          seen.current.add(dedupe);
          if (seen.current.size > 5000) {
            const oldest = seen.current.values().next().value;
            if (oldest !== undefined) seen.current.delete(oldest);
          }

          if (f.from === self.current) {
            clearTimeout(pending.get(f.cid));
            pending.delete(f.cid);
            dispatch({ type: 'msgState', cid: f.cid, state: 'sent', ts: f.ts });
            return;
          }
          const text = cleanMessage(p.text);
          if (!text) return;
          dispatch({
            type: 'append',
            from: f.from,
            item: {
              kind: 'msg',
              key: dedupe,
              cid: f.cid,
              name: names.current.get(f.from) ?? 'Anonymous',
              text,
              ts: f.ts,
              mine: false,
              state: 'sent',
            },
          });
          return;
        }
        case 'typing':
          if (f.from !== self.current) dispatch({ type: 'typing', id: f.from });
          return;
        case 'error':
          if (f.code === 'rate_limited' && !f.fatal) {
            dispatch({ type: 'notice', text: 'You’re sending messages too quickly. Slow down a little.' });
          }
          return;
      }
    };

    void (async () => {
      dispatch({ type: 'status', status: 'deriving' });
      const k = await deriveRoomKeys(room);
      const profile = await seal(k, 'profile', { n: name });
      if (cancelled) return;
      keys.current = k;

      connection = new Connection(WS_URL, {
        onOpen: () => connection?.send({ t: 'join', room: k.roomId, profile }),
        onFrame: (f) => {
          chain = chain.then(() => (cancelled ? undefined : handle(f, k))).catch(() => undefined);
        },
        onStatus: (status) => {
          if (status !== 'online') self.current = null;
          dispatch({ type: 'status', status });
        },
        onFatal: (reason) => dispatch({ type: 'fatal', reason }),
      });
      conn.current = connection;
      connection.start();
    })();

    const prune = setInterval(() => dispatch({ type: 'pruneTyping' }), 1000);

    return () => {
      cancelled = true;
      clearInterval(prune);
      connection?.stop();
      conn.current = null;
      keys.current = null;
      self.current = null;
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, [room, name]);

  const transmit = useCallback(async (cid: string, text: string) => {
    const k = keys.current;
    const from = self.current;
    const c = conn.current;
    const fail = () => dispatch({ type: 'msgState', cid, state: 'failed' });
    if (!k || !from || !c) return fail();

    const data = await seal(k, 'msg', { text, from, cid });
    if (!c.send({ t: 'msg', cid, data })) return fail();
    timers.current.set(
      cid,
      setTimeout(() => {
        timers.current.delete(cid);
        fail();
      }, SEND_TIMEOUT_MS),
    );
  }, []);

  const send = useCallback(
    (raw: string): boolean => {
      const text = cleanMessage(raw);
      if (!text) return false;
      const cid = randomToken(9);
      dispatch({
        type: 'append',
        item: { kind: 'msg', key: `me:${cid}`, cid, name, text, ts: Date.now(), mine: true, state: 'pending' },
      });
      dispatch({ type: 'notice', text: null });
      void transmit(cid, text);
      return true;
    },
    [name, transmit],
  );

  const retry = useCallback(
    (item: Item) => {
      if (item.kind !== 'msg' || !item.mine || item.state !== 'failed') return;
      // Same visible bubble, fresh id (the old one may have been half-delivered).
      const cid = randomToken(9);
      dispatch({ type: 'replace', key: item.key, item: { ...item, cid, state: 'pending', ts: Date.now() } });
      void transmit(cid, item.text);
    },
    [transmit],
  );

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTyping.current < TYPING_THROTTLE_MS) return;
    if (conn.current?.send({ t: 'typing' })) lastTyping.current = now;
  }, []);

  const dismissNotice = useCallback(() => dispatch({ type: 'notice', text: null }), []);

  return { state, send, retry, notifyTyping, dismissNotice };
}
