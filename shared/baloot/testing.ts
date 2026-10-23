import type { Card, Rank, Suit } from './cards';

/** "AS KS QS" → أوراق (للاختبارات) */
export function cards(spec: string): Card[] {
  return spec.trim().split(/\s+/).map((t) => ({ rank: t.slice(0, -1) as Rank, suit: t.slice(-1) as Suit }));
}

/** مولّد أرقام عشوائية ثابت البذرة */
export function seededRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
