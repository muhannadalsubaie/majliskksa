import { describe, expect, it } from 'vitest';
import type { Seat } from './cards';
import { HAND_TOTAL, SUN_ABNAT_MULTIPLIER, teamOf } from './cards';
import {
  type GameState, IllegalAction, applyAction, availableBids, availableDouble, canDeclareBaloot,
  canDeclareProject, handOver, legalCardsFor, needsRedeal, newMatch, nextHand, redeal,
} from './game';
import { seededRng } from './testing';

const pick = <T>(xs: T[], rng: () => number) => xs[Math.floor(rng() * xs.length)];

/** يلعب صكة كاملة بحركات عشوائية قانونية */
function playHand(s: GameState, rng: () => number): GameState {
  let guard = 0;
  while (!handOver(s) && s.phase !== 'matchOver') {
    if (++guard > 500) throw new Error('stuck');
    if (needsRedeal(s)) { s = redeal(s, rng); continue; }
    const seat = s.phase === 'doubling'
      ? ([0, 1, 2, 3] as Seat[]).find((x) => teamOf(x) === s.doubling.awaitingTeam && !s.doubling.passed.includes(x))!
      : s.turn;
    if (s.phase === 'bidding') {
      const bids = availableBids(s, seat);
      // نميل للمرور حتى تُختبر الجولة الثانية والصنكة أيضاً
      s = applyAction(s, { type: 'bid', seat, bid: rng() < 0.7 ? bids[0] : pick(bids, rng) });
    } else if (s.phase === 'doubling') {
      const d = availableDouble(s, seat);
      s = d && rng() < 0.4
        ? applyAction(s, { type: 'double', seat, locked: d.needsLockChoice ? rng() < 0.5 : undefined })
        : applyAction(s, { type: 'doublePass', seat });
    } else {
      if (canDeclareProject(s, seat)) s = applyAction(s, { type: 'declareProject', seat });
      for (const x of [0, 1, 2, 3] as Seat[]) if (canDeclareBaloot(s, x)) s = applyAction(s, { type: 'declareBaloot', seat: x });
      s = applyAction(s, { type: 'play', seat, card: pick(legalCardsFor(s, seat), rng) });
    }
  }
  return s;
}

describe('game flow', () => {
  it('initial deal: 5 cards each + qaba, bidding starts right of dealer', () => {
    const s = newMatch(seededRng(1), 0);
    expect(s.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
    expect(s.stock).toHaveLength(11);
    expect(s.turn).toBe(1);
    expect(availableBids(s, 1).map((b) => b.type)).toEqual(['pass', 'sun', 'hokm']);
    expect(availableBids(s, 2).map((b) => b.type)).toEqual([]);
  });

  it('ashkal only for dealer partner; qaba goes to the dealer', () => {
    let s = newMatch(seededRng(2), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'pass' } });
    expect(availableBids(s, 2).some((b) => b.type === 'ashkal')).toBe(true);
    const qaba = s.qaba!;
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'ashkal' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 2, qabaTo: 0 });
    expect(s.hands[0]).toContainEqual(qaba);
    expect(s.hands.map((h) => h.length)).toEqual([8, 8, 8, 8]);
  });

  it('after hokm, later players may only take sun', () => {
    let s = newMatch(seededRng(3), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    expect(availableBids(s, 2).map((b) => b.type)).toEqual(['pass', 'sun']);
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 3, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 0, bid: { type: 'pass' } });
    expect(s.contract).toMatchObject({ mode: 'hokm', buyer: 1 });
    expect(s.phase).toBe('doubling');
    expect(availableDouble(s, 1)).toBeNull(); // الفريق المشتري لا يبدأ الدبل
    expect(availableDouble(s, 0)).toEqual({ label: 'دبل', needsLockChoice: true });
  });

  it('round 2 forbids the qaba suit; all pass twice → redeal by next dealer', () => {
    let s = newMatch(seededRng(4), 0);
    for (const seat of [1, 2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    expect(s.bidRound).toBe(2);
    expect(availableBids(s, 1).some((b) => b.type === 'hokm' && b.suit === s.qaba!.suit)).toBe(false);
    for (const seat of [1, 2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    expect(needsRedeal(s)).toBe(true);
    expect(redeal(s, seededRng(5)).dealer).toBe(1);
  });

  it('hokm double chain: دبل (lock choice) → ثري (open) → فور (lock choice) → قهوة (open)', () => {
    let s = newMatch(seededRng(6), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    expect(() => applyAction(s, { type: 'double', seat: 0 })).toThrow(IllegalAction);
    s = applyAction(s, { type: 'double', seat: 0, locked: true });
    expect(s.doubling).toMatchObject({ level: 2, locked: true });
    expect(availableDouble(s, 1)).toEqual({ label: 'ثري', needsLockChoice: false });
    s = applyAction(s, { type: 'double', seat: 3 });
    expect(s.doubling).toMatchObject({ level: 3, locked: false });
    expect(availableDouble(s, 2)).toEqual({ label: 'فور', needsLockChoice: true });
    expect(() => applyAction(s, { type: 'double', seat: 2 })).toThrow(IllegalAction);
    s = applyAction(s, { type: 'double', seat: 2, locked: true });
    expect(s.doubling).toMatchObject({ level: 4, locked: true });
    expect(availableDouble(s, 1)?.label).toBe('قهوة');
    s = applyAction(s, { type: 'double', seat: 1 });
    expect(s.phase).toBe('playing');
    expect(s.doubling).toMatchObject({ level: 4, gahwa: true, locked: false, doublerTeam: 0 });
  });

  it('three stays open even after a locked double', () => {
    let s = newMatch(seededRng(9), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'double', seat: 2, locked: true });
    s = applyAction(s, { type: 'double', seat: 1 });
    s = applyAction(s, { type: 'doublePass', seat: 0 });
    s = applyAction(s, { type: 'doublePass', seat: 2 });
    expect(s.phase).toBe('playing');
    expect(s.doubling).toMatchObject({ level: 3, locked: false });
  });

  it('sun double only when buyer team > 100 and other team < 100', () => {
    const sunHand = (scores: [number, number]) => {
      let s = { ...newMatch(seededRng(7), 0), scores };
      s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'sun' } });
      return s;
    };
    expect(sunHand([50, 50]).phase).toBe('playing');
    expect(sunHand([120, 110]).phase).toBe('playing');
    const s = sunHand([90, 110]);
    expect(s.phase).toBe('doubling');
    expect(availableDouble(s, 0)).toEqual({ label: 'دبل', needsLockChoice: false });
    expect(applyAction(s, { type: 'double', seat: 0 }).phase).toBe('playing');
  });

  it('rejects out-of-turn and illegal cards', () => {
    let s = newMatch(seededRng(8), 0);
    expect(() => applyAction(s, { type: 'bid', seat: 2, bid: { type: 'pass' } })).toThrow(IllegalAction);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'sun' } });
    expect(() => applyAction(s, { type: 'play', seat: 2, card: s.hands[2][0] })).toThrow(IllegalAction);
    expect(() => applyAction(s, { type: 'play', seat: 1, card: s.hands[2][0] })).toThrow(IllegalAction);
  });

  it('random full matches: invariants hold and a winner is reached', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seededRng(seed);
      let s = newMatch(rng);
      let hands = 0;
      while (s.phase !== 'matchOver') {
        s = playHand(s, rng);
        hands++;
        const c = s.contract!;
        const total = (s.cardAbnat[0] + s.cardAbnat[1]) * (c.mode === 'sun' ? SUN_ABNAT_MULTIPLIER : 1);
        expect(total).toBe(HAND_TOTAL[c.mode]);
        expect(s.tricksWon[0] + s.tricksWon[1]).toBe(8);
        expect(s.hands.every((h) => h.length === 0)).toBe(true);
        if (s.phase !== 'matchOver') s = nextHand(s, rng);
        if (hands > 200) throw new Error(`seed ${seed}: match never ended`);
      }
      expect(s.outcome.status).toBe('won');
    }
  });
});
