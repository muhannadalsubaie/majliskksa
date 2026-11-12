import { applyAction as rawApply, newMatch, type Action, type GameState } from './game';
import type { Card, Rank, Seat, Suit } from './cards';

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

/**
 * يوصل لمرحلة الدبل عن طريق الحكم الثاني (الحكم الأول بعد تأكيده ما فيه دبل):
 * الكل يقول بس في اللفة الأولى، ثم المقعد 1 «حكم ثاني» والباقين بس، يؤكد ويختار لوناً غير لون القبلة.
 */
export function toSecondHokmDoubling(seed: number): GameState {
  let s = newMatch(seededRng(seed), 0);
  for (const seat of [1, 2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
  s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'secondHokm' } });
  for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
  s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'confirmHokm' } });
  const suit = (['S', 'H', 'C', 'D'] as Suit[]).find((x) => x !== s.qaba!.suit)!;
  return applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit } });
}

/** يطبّق الحركة، وإذا انفتحت نافذة «ورق» بعد الشراء يقول الكل بس (لاختبارات ما تخص «ورق») */
export function passWaraq(s: GameState): GameState {
  while (s.phase === 'waraq') s = rawApply(s, { type: 'waraq', seat: s.turn, call: false });
  return s;
}
export const applyAction = (s: GameState, a: Action): GameState => passWaraq(rawApply(s, a));
