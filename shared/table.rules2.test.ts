import { describe, expect, it } from 'vitest';
import { newTable, join, startAny, applyWithEvents, type TableData } from './table';
import { availableBids, legalCardsFor, isDoublingTurn, type GameState } from './baloot/game';
import { legalCards } from './baloot/play';
import type { Card, Seat } from './baloot/cards';
import { seededRng, cards } from './baloot/testing';

/** صكة كاملة بلعب عشوائي، ونرجع كل خطوة لعب */
function playHand(seed: number, onPlay: (r: ReturnType<typeof applyWithEvents>, before: GameState) => void) {
  const rng = seededRng(seed);
  let t: TableData = newTable('x'.repeat(64), { uid: 'u0', username: 'a' }, false, 0);
  for (const i of [1, 2, 3]) t = join(t, { uid: 'u' + i, username: 'p' + i }).table;
  t = { ...startAny(t, rng).table, hold: undefined };
  let now = 10_000;
  for (let step = 0; step < 80; step++) {
    const g = t.game!;
    if (g.lastHand || !['bidding', 'waraq', 'doubling', 'playing'].includes(g.phase)) break;
    let seat: Seat = g.turn; let a: any;
    if (g.phase === 'waraq') a = { type: 'waraq', seat, call: false };
    else if (g.phase === 'bidding') { const b = availableBids(g, seat); if (!b.length) break; a = { type: 'bid', seat, bid: b.find((x) => x.type === 'hokm') ?? b.find((x) => x.type === 'confirmHokm') ?? b.find((x) => x.type === 'pass')! }; }
    else if (g.phase === 'doubling') { const s2 = ([0, 1, 2, 3] as Seat[]).find((x) => isDoublingTurn(g, x)); if (s2 === undefined) break; seat = s2; a = { type: 'doublePass', seat }; }
    else { const l = legalCardsFor(g, seat); a = { type: 'play', seat, card: l[Math.floor(rng() * l.length)] }; }
    const r = applyWithEvents(t, a, rng, now);
    if (a.type === 'play') onPlay(r, g);
    t = { ...r.table, hold: undefined }; now += 5000;
  }
  return t;
}

describe('baloot rules batch', () => {
  it('last trick: after the first card, the other three play automatically and the hand ends', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let sawLast = false;
      const t = playHand(seed, (r, before) => {
        if (before.trickNo === 7 && before.trick.length === 0) {
          sawLast = true;
          expect(r.table.game!.lastHand).not.toBeNull();
          // كل الأوراق الأربع انقرأت
          expect(r.events.filter((e) => /: /.test(e) && !e.startsWith('المجموع')).length).toBeGreaterThanOrEqual(4);
        }
      });
      expect(sawLast).toBe(true);
      expect(t.game!.lastHand).not.toBeNull();
    }
  });

  it('a cancelled project is announced without holding the turn', () => {
    let cancelled = 0;
    for (let seed = 1; seed <= 300; seed++) {
      playHand(seed, (r) => {
        if (r.events.some((e) => e.startsWith('أُلغي مشروع'))) { cancelled++; expect(r.table.hold).toBeUndefined(); }
      });
    }
    expect(cancelled).toBeGreaterThan(0);
  });

  it('hokm, last to play and partner holds the trick: free (no forced cut), even if higher cards are still out', () => {
    // الدور للمقعد 3، شريكه 1 ماسك الأكلة بشايب سبيت (الإكة والعشرة ما نزلت)
    const trick = [{ seat: 0 as Seat, card: { suit: 'S', rank: 'Q' } as Card }, { seat: 1 as Seat, card: { suit: 'S', rank: 'K' } as Card }, { seat: 2 as Seat, card: { suit: 'S', rank: '7' } as Card }];
    const hand = cards('7H 9D KC');
    const outstanding = cards('AS 10S');
    expect(legalCards({ mode: 'hokm', trump: 'H', trick, hand, seat: 3, lockedSeat: null, outstanding })).toHaveLength(3);
  });
});
