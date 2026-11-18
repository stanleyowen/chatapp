/** Crockford-style base32 (no i, l, o, u) – easy to read aloud and type. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const GROUPS = 4;
const GROUP_LEN = 5; // 20 chars × 5 bits = 100 bits of entropy
const GENERATED = new RegExp(`^[${ALPHABET}]{${GROUP_LEN}}(?:-[${ALPHABET}]{${GROUP_LEN}}){${GROUPS - 1}}$`);
export const MAX_ROOM_CHARS = 64;

export function generateRoomCode(): string {
  // 256 is a multiple of 32, so `& 31` has no modulo bias.
  const bytes = crypto.getRandomValues(new Uint8Array(GROUPS * GROUP_LEN));
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  return chars.match(new RegExp(`.{${GROUP_LEN}}`, 'g'))!.join('-');
}

/**
 * Canonicalise whatever the user typed so the same room always derives the
 * same key: Unicode NFKC, lowercase, collapsed whitespace. Codes that look like
 * a generated code (in any case / spacing) are reformatted with dashes.
 */
export function normalizeRoom(input: string): string {
  const s = input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const compact = s.replace(/[\s-]/g, '');
  if (compact.length === GROUPS * GROUP_LEN && [...compact].every((c) => ALPHABET.includes(c))) {
    return compact.match(new RegExp(`.{${GROUP_LEN}}`, 'g'))!.join('-');
  }
  return s;
}

export function isGeneratedCode(code: string): boolean {
  return GENERATED.test(code);
}

export function roomFromHash(hash: string): string | null {
  if (hash.length < 2) return null;
  try {
    const room = normalizeRoom(decodeURIComponent(hash.slice(1)));
    return room && room.length <= MAX_ROOM_CHARS ? room : null;
  } catch {
    return null;
  }
}

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#${encodeURIComponent(code)}`;
}
