// محاكاة مباريات بين نسخ الروبوت (للاختبارات والضبط)
import type { Seat } from './cards';
import { teamOf } from './cards';
import { type BotParams, botAction } from './bot';
import { type GameState, type Rng, applyAction, availableBids, handOver, isDoublingTurn, legalCardsFor, needsRedeal, newMatch, nextHand, redeal } from './game';
import { seededRng } from './testing';

export type Player = BotParams | 'random';

/** مباراة كاملة: الفريق 0 بإعدادات A والفريق 1 بإعدادات B. يرجع الفريق الفائز. */
export function playMatch(a: Player, b: Player, rng: Rng, maxHands = 60): 0 | 1 | null {
  let s: GameState = newMatch(rng, Math.floor(rng() * 4) as Seat);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  for (let steps = 0; steps < 50000; steps++) {
    if (s.phase === 'matchOver') return s.outcome.status === 'won' ? s.outcome.winner : null;
    if (needsRedeal(s)) { s = redeal(s, rng); continue; }
    if (handOver(s)) { if (--maxHands <= 0) return null; s = nextHand(s, rng); continue; }
    let acted = false;
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const who = teamOf(seat) === 0 ? a : b;
      let action;
      if (who === 'random') {
        if (s.phase === 'bidding' && s.turn === seat) action = { type: 'bid' as const, seat, bid: pick(availableBids(s, seat)) };
        else if (isDoublingTurn(s, seat)) action = { type: 'doublePass' as const, seat };
        else if (s.phase === 'playing' && s.turn === seat) action = { type: 'play' as const, seat, card: pick(legalCardsFor(s, seat)) };
      } else {
        action = botAction(s, seat, who) ?? undefined;
        if (action && !(s.phase === 'bidding' ? s.turn === seat : s.phase === 'doubling' ? true : s.turn === seat)) action = undefined;
      }
      if (action) { s = applyAction(s, action); acted = true; break; }
    }
    if (!acted) throw new Error(`stuck in ${s.phase}`);
  }
  return null;
}

export function winRate(a: Player, b: Player, matches: number, seed = 1): number {
  let wins = 0, decided = 0;
  for (let i = 0; i < matches; i++) {
    // نبدّل الجهتين نصف المرات لإلغاء أفضلية المقعد
    const swap = i % 2 === 1;
    const w = playMatch(swap ? b : a, swap ? a : b, seededRng(seed * 7919 + i));
    if (w === null) continue;
    decided++;
    if ((w === 0) !== swap) wins++;
  }
  return wins / decided;
}
