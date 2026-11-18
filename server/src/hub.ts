import { LIMITS, type ErrorCode, type Member, type ServerFrame } from '../../shared/protocol.ts';

/** A connected client, abstracted away from the transport for testability. */
export interface Peer {
  readonly id: string;
  /** Send an already-serialised frame. */
  send(serialised: string): void;
}

interface Room {
  members: Map<string, { peer: Peer; profile: string }>;
}

export interface HubOptions {
  maxRooms: number;
  maxRoomMembers?: number;
  now?: () => number;
}

/**
 * In-memory room registry. Nothing is persisted: when the last member leaves,
 * the room and everything about it is gone.
 */
export class Hub {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOf = new Map<string, string>();
  private readonly maxRooms: number;
  private readonly maxRoomMembers: number;
  private readonly now: () => number;

  constructor(opts: HubOptions) {
    this.maxRooms = opts.maxRooms;
    this.maxRoomMembers = opts.maxRoomMembers ?? LIMITS.maxRoomMembers;
    this.now = opts.now ?? Date.now;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  isJoined(peer: Peer): boolean {
    return this.roomOf.has(peer.id);
  }

  join(peer: Peer, roomId: string, profile: string): ErrorCode | null {
    if (this.roomOf.has(peer.id)) return 'already_joined';

    let room = this.rooms.get(roomId);
    if (!room) {
      if (this.rooms.size >= this.maxRooms) return 'server_full';
      room = { members: new Map() };
      this.rooms.set(roomId, room);
    }
    if (room.members.size >= this.maxRoomMembers) return 'room_full';

    const members: Member[] = [];
    for (const [id, m] of room.members) members.push({ id, profile: m.profile });

    room.members.set(peer.id, { peer, profile });
    this.roomOf.set(peer.id, roomId);

    send(peer, { t: 'welcome', self: peer.id, members: [...members, { id: peer.id, profile }] });
    this.broadcast(room, { t: 'joined', member: { id: peer.id, profile } }, peer.id);
    return null;
  }

  leave(peer: Peer): void {
    const roomId = this.roomOf.get(peer.id);
    if (roomId === undefined) return;
    this.roomOf.delete(peer.id);

    const room = this.rooms.get(roomId);
    if (!room) return;
    room.members.delete(peer.id);
    if (room.members.size === 0) {
      this.rooms.delete(roomId);
    } else {
      this.broadcast(room, { t: 'left', id: peer.id });
    }
  }

  message(peer: Peer, cid: string, data: string): ErrorCode | null {
    const room = this.roomFor(peer);
    if (!room) return 'not_joined';
    // Echo to the sender too, so it learns the server timestamp / ordering.
    this.broadcast(room, { t: 'msg', from: peer.id, cid, data, ts: this.now() });
    return null;
  }

  typing(peer: Peer): ErrorCode | null {
    const room = this.roomFor(peer);
    if (!room) return 'not_joined';
    this.broadcast(room, { t: 'typing', from: peer.id }, peer.id);
    return null;
  }

  private roomFor(peer: Peer): Room | undefined {
    const roomId = this.roomOf.get(peer.id);
    return roomId === undefined ? undefined : this.rooms.get(roomId);
  }

  private broadcast(room: Room, frame: ServerFrame, exceptId?: string): void {
    const s = JSON.stringify(frame); // serialise once, fan out
    for (const [id, m] of room.members) if (id !== exceptId) m.peer.send(s);
  }
}

export function send(peer: Peer, frame: ServerFrame): void {
  peer.send(JSON.stringify(frame));
}
