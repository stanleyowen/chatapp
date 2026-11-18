import type { CSSProperties } from 'react';

import { hueFor, initials } from '../lib/text';

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ '--hue': hueFor(name), '--size': `${size}px` } as CSSProperties}
    >
      {initials(name)}
    </span>
  );
}
