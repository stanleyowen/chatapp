import { LIMITS } from '../../../shared/protocol';

// C0/C1 controls (except tab/newline), bidi overrides/isolates, and other
// invisible format characters that enable spoofing ("evil‮txt.exe").
const UNSAFE_IN_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩﻿]/g;
const UNSAFE_IN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const ZWJ = '‍'; // keep so emoji sequences (👩‍💻) survive

export function cleanName(input: unknown): string {
  if (typeof input !== 'string') return '';
  const s = input
    .normalize('NFC')
    .replace(UNSAFE_IN_NAME, (c) => (c === ZWJ ? c : ''))
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, LIMITS.maxNameChars).join('');
}

export function cleanMessage(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFC')
    .replace(UNSAFE_IN_TEXT, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, LIMITS.maxMessageChars);
}

/** Up to two initials from letter/digit-led words; falls back to the first symbol (e.g. an emoji). */
export function initials(name: string): string {
  const words = name.split(' ').filter((w) => /^[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)[Symbol.iterator]().next();
    return seg.done ? '?' : seg.value.segment;
  }
  const first = [...words[0]!][0]!;
  const last = words.length > 1 ? [...words[words.length - 1]!][0]! : '';
  return (first + last).toUpperCase();
}

/** Stable hue per name, so people keep their colour across reconnects. */
export function hueFor(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 360;
}
