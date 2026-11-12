import { describe, expect, it } from 'vitest';
import type { Card, Seat } from './cards';
import { applyAction, availableBids, canWaraq, dealHand, hasWaraq, needsRedeal, redeal, type GameState } from './game';
import { cards, seededRng } from './testing';

/** صكة بأيدي محددة: المقعد 1 معه «ورق» (ما فيه إكة ولا عشرة)، والباقين معهم إكك */
function deal(): GameState {
  const s = dealHand(0, [0, 0], seededRng(1));
  const hands = [cards('AS AH KS QS JS'), cards('9S 8S 7S 9H 8H'), cards('AD AC KD QD JD'), cards('10S 10H 10D 10C KH')];
  const used = new Set(hands.flat().map((c) => c.suit + c.rank));
  const rest = s.hands.flat().concat(s.qaba!, s.stock).filter((c) => !used.has(c.suit + c.rank));
  return { ...s, hands, qaba: rest[0], stock: rest.slice(1) };
}
const bid = (s: GameState, seat: Seat, b: Parameters<typeof availableBids>[0] extends never ? never : any) => applyAction(s, { type: 'bid', seat, bid: b });

describe('ورق', () => {
  it('eligible only with five cards and no ace or ten', () => {
    const s = deal();
    expect(hasWaraq(s, 1)).toBe(true);
    expect(([0, 2, 3] as Seat[]).some((x) => hasWaraq(s, x))).toBe(false);
  });

  it('before anyone buys: only on your turn, and the same dealer redeals', () => {
    let s = deal();
    expect(s.turn).toBe(1);
    expect(canWaraq(s, 1)).toBe(true);
    s = applyAction(s, { type: 'waraq', seat: 1, call: true });
    expect(needsRedeal(s)).toBe(true);
    expect(s.redealSame).toBe(true);
    expect(redeal(s, seededRng(2)).dealer).toBe(0);
  });

  it('round 2 too, on your turn', () => {
    let s = deal();
    for (const seat of [1, 2, 3, 0] as Seat[]) s = bid(s, seat, { type: 'pass' });
    expect(s.bidRound).toBe(2);
    expect(canWaraq(s, 1)).toBe(true);
    expect(canWaraq(s, 2)).toBe(false);
  });

  it('after someone buys: any time before the rest is dealt, and the next dealer redeals', () => {
    let s = deal();
    s = bid(s, 1, { type: 'pass' });
    s = bid(s, 2, { type: 'hokm', suit: s.qaba!.suit });
    // ما هو دوره، بس فيه شراء: يقدر
    expect(s.turn).not.toBe(1);
    expect(canWaraq(s, 1)).toBe(true);
    s = applyAction(s, { type: 'waraq', seat: 1, call: true });
    expect(needsRedeal(s)).toBe(true);
    expect(s.redealSame).toBe(false);
    expect(redeal(s, seededRng(2)).dealer).toBe(1);
  });

  it('after the purchase is final: a بس/ورق window for those with ورق, then the game goes on', () => {
    let s = deal();
    s = bid(s, 1, { type: 'pass' });
    s = bid(s, 2, { type: 'sun' });
    // الصن انتهى (قبلك على 1 → بس)
    if (s.phase === 'bidding' && s.sunClaim) s = bid(s, s.turn, { type: 'pass' });
    expect(s.phase).toBe('waraq');
    expect(s.turn).toBe(1);
    expect(canWaraq(s, 1)).toBe(true);
    const passed = applyAction(s, { type: 'waraq', seat: 1, call: false });
    expect(['doubling', 'playing']).toContain(passed.phase);
    if (passed.phase === 'playing') expect(passed.hands.every((h: Card[]) => h.length === 8)).toBe(true);
    const called = applyAction(s, { type: 'waraq', seat: 1, call: true });
    expect(needsRedeal(called)).toBe(true);
    expect(called.redealSame).toBe(false);
  });

  it('nobody else may call ورق', () => {
    const s = deal();
    expect(() => applyAction(s, { type: 'waraq', seat: 2, call: true })).toThrow();
  });
});
