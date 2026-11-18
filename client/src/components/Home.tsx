import { useId, useState, type FormEvent } from 'react';

import { MAX_ROOM_CHARS, generateRoomCode, isGeneratedCode, normalizeRoom } from '../lib/room';
import { LIMITS } from '../../../shared/protocol';
import { cleanName } from '../lib/text';
import { EyeOffIcon, LockIcon, Logo, PlusIcon, VanishIcon } from './Icons';

interface Props {
  initialName: string;
  invitedRoom: string | null;
  onJoin(room: string, name: string): void;
  onDismissInvite(): void;
}

export function Home({ initialName, invitedRoom, onJoin, onDismissInvite }: Props) {
  const [name, setName] = useState(initialName);
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), room: useId(), roomHint: useId(), error: useId() };

  const normalizedRoom = normalizeRoom(room);
  const guessable = normalizedRoom !== '' && !isGeneratedCode(normalizedRoom);

  function requireName(): string | null {
    const n = cleanName(name);
    if (!n) {
      setError('Enter a display name so others know who you are.');
      document.getElementById(ids.name)?.focus();
      return null;
    }
    return n;
  }

  function create() {
    const n = requireName();
    if (n) onJoin(generateRoomCode(), n);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = requireName();
    if (!n) return;
    const target = invitedRoom ?? normalizedRoom;
    if (!target) {
      setError('Enter a room code or name to join.');
      document.getElementById(ids.room)?.focus();
      return;
    }
    onJoin(target, n);
  }

  return (
    <div className="home">
      <main className="home-inner">
        <div className="brand">
          <Logo />
          <span>quietroom</span>
        </div>

        <h1 className="home-title">
          {invitedRoom ? 'You’ve been invited to a private room.' : 'Private rooms for quick conversations.'}
        </h1>
        <p className="home-lede">
          No accounts, no history, no trackers. Messages are end-to-end encrypted in your browser and disappear
          when you leave.
        </p>

        <form className="card" onSubmit={submit} noValidate aria-describedby={error ? ids.error : undefined}>
          <div className="field">
            <label htmlFor={ids.name}>Display name</label>
            <input
              id={ids.name}
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={LIMITS.maxNameChars}
              placeholder="e.g. Alex"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint={invitedRoom ? 'go' : 'next'}
            />
          </div>

          {invitedRoom ? (
            <>
              <div className="invite-chip">
                <LockIcon size={16} />
                <span>
                  {isGeneratedCode(invitedRoom) ? 'Private room' : 'Room'} <code>{invitedRoom}</code>
                </span>
              </div>
              {error && <p className="form-error" id={ids.error} role="alert">{error}</p>}
              <button className="btn btn-primary btn-block" type="submit">
                Join room
              </button>
              <button className="btn btn-ghost btn-block" type="button" onClick={onDismissInvite}>
                Start a different room instead
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary btn-block" type="button" onClick={create}>
                <PlusIcon /> Create private room
              </button>

              <p className="divider">
                <span>or join an existing one</span>
              </p>

              <div className="field">
                <label htmlFor={ids.room}>Room code or name</label>
                <div className="input-row">
                  <input
                    id={ids.room}
                    className="input"
                    value={room}
                    onChange={(e) => {
                      setRoom(e.target.value);
                      setError(null);
                    }}
                    maxLength={MAX_ROOM_CHARS}
                    placeholder="xxxxx-xxxxx-xxxxx-xxxxx"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    aria-describedby={guessable ? ids.roomHint : undefined}
                  />
                  <button className="btn btn-secondary" type="submit">
                    Join
                  </button>
                </div>
                {guessable && (
                  <p className="hint hint-warn" id={ids.roomHint}>
                    Anyone who guesses a typed room name can join and read it. For anything private, create a
                    room instead – it gets an unguessable code.
                  </p>
                )}
              </div>
              {error && <p className="form-error" id={ids.error} role="alert">{error}</p>}
            </>
          )}
        </form>

        <ul className="trust">
          <li>
            <LockIcon />
            <div>
              <strong>End-to-end encrypted</strong>
              <span>The key never leaves your browser. The server only relays ciphertext.</span>
            </div>
          </li>
          <li>
            <VanishIcon />
            <div>
              <strong>Nothing is stored</strong>
              <span>No database, no logs, no message history. Close the tab and it’s gone.</span>
            </div>
          </li>
          <li>
            <EyeOffIcon />
            <div>
              <strong>No tracking</strong>
              <span>No cookies, analytics, or third-party requests. Ever.</span>
            </div>
          </li>
        </ul>
      </main>

      <footer className="home-footer">
        <a href="https://github.com/stanleyowen/quietroom" target="_blank" rel="noopener noreferrer">
          Open source on GitHub
        </a>
      </footer>
    </div>
  );
}
