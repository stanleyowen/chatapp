import { CLOSE, type ClientFrame, type ErrorCode, type ServerFrame } from '../../../shared/protocol';

export type ConnStatus = 'connecting' | 'online' | 'reconnecting';
export type FatalReason = ErrorCode | 'unknown';

export interface ConnectionHandlers {
  onOpen(): void;
  onFrame(frame: ServerFrame): void;
  onStatus(status: ConnStatus): void;
  onFatal(reason: FatalReason): void;
}

const FATAL_CLOSE_CODES = new Map<number, FatalReason>([
  [CLOSE.policy, 'bad_request'],
  [CLOSE.rateLimited, 'rate_limited'],
  [CLOSE.roomFull, 'room_full'],
  [CLOSE.serverFull, 'server_full'],
]);

/** WebSocket wrapper with exponential backoff + jitter and online/visibility awareness. */
export class Connection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private fatal: FatalReason | null = null;
  private readonly url: string;
  private readonly h: ConnectionHandlers;

  constructor(url: string, handlers: ConnectionHandlers) {
    this.url = url;
    this.h = handlers;
  }

  start(): void {
    window.addEventListener('online', this.retryNow);
    document.addEventListener('visibilitychange', this.onVisible);
    this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    window.removeEventListener('online', this.retryNow);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ws?.close(CLOSE.normal);
    this.ws = null;
  }

  send(frame: ClientFrame): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  private open(): void {
    if (this.stopped) return;
    this.h.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.h.onOpen();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(ev.data) as ServerFrame;
      } catch {
        return;
      }
      if (typeof frame !== 'object' || frame === null || typeof frame.t !== 'string') return;
      if (frame.t === 'welcome') this.h.onStatus('online');
      if (frame.t === 'error' && frame.fatal) this.fatal = frame.code;
      this.h.onFrame(frame);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      const fatal = this.fatal ?? FATAL_CLOSE_CODES.get(ev.code) ?? null;
      if (fatal) {
        this.stopped = true;
        this.h.onFatal(fatal);
        return;
      }
      this.schedule();
    };
  }

  private schedule(): void {
    this.attempt++;
    this.h.onStatus('reconnecting');
    const base = Math.min(15_000, 500 * 2 ** Math.min(this.attempt, 5));
    const delay = base / 2 + Math.random() * (base / 2);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), delay);
  }

  private readonly retryNow = (): void => {
    if (this.stopped || this.ws) return;
    clearTimeout(this.timer);
    this.open();
  };

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') this.retryNow();
  };
}
