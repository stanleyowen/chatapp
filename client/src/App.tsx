import { useCallback, useEffect, useState } from 'react';

import { ChatRoom } from './components/ChatRoom';
import { Home } from './components/Home';
import { roomFromHash } from './lib/room';
import { cleanName } from './lib/text';

// Per-tab only: survives a refresh, gone when the tab closes.
const NAME_KEY = 'chatapp:name';
function readName(): string {
  try {
    return cleanName(sessionStorage.getItem(NAME_KEY) ?? '');
  } catch {
    return '';
  }
}
function saveName(name: string): void {
  try {
    sessionStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage disabled – fine */
  }
}

interface Session {
  room: string;
  name: string;
  /** Bumped to force a fresh connection on "Rejoin". */
  epoch: number;
}

export function App() {
  const [hashRoom, setHashRoom] = useState(() => roomFromHash(location.hash));
  const [session, setSession] = useState<Session | null>(() => {
    const room = roomFromHash(location.hash);
    const name = readName();
    return room && name ? { room, name, epoch: 0 } : null;
  });

  // Back/forward and manually edited URLs.
  useEffect(() => {
    const onHash = () => {
      const room = roomFromHash(location.hash);
      setHashRoom(room);
      setSession((s) => (s && s.room === room ? s : null));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const join = useCallback((room: string, name: string) => {
    saveName(name);
    const hash = `#${encodeURIComponent(room)}`;
    // Push so the browser/phone back button leaves the room.
    if (location.hash !== hash) history.pushState(null, '', hash);
    setHashRoom(room);
    setSession({ room, name, epoch: 0 });
  }, []);

  const clearRoom = useCallback(() => {
    history.replaceState(null, '', location.pathname + location.search);
    setHashRoom(null);
    setSession(null);
  }, []);

  const rejoin = useCallback(() => setSession((s) => s && { ...s, epoch: s.epoch + 1 }), []);

  if (session) {
    return (
      <ChatRoom
        key={`${session.room}:${session.epoch}`}
        room={session.room}
        name={session.name}
        onLeave={clearRoom}
        onRejoin={rejoin}
      />
    );
  }
  return <Home initialName={readName()} invitedRoom={hashRoom} onJoin={join} onDismissInvite={clearRoom} />;
}
