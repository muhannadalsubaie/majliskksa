import { describe, expect, it } from 'vitest';
import type { Seat } from './cards';
import { HAND_TOTAL, SUN_ABNAT_MULTIPLIER, teamOf } from './cards';
import {
  type GameState, IllegalAction, applyAction, availableBids, availableDouble, isDoublingTurn,
  canDeclareProject, dealHand, handOver, legalCardsFor, needsRedeal, newMatch, nextHand, redeal,
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
      ? ([0, 1, 2, 3] as Seat[]).find((x) => isDoublingTurn(s, x))!
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
      s = applyAction(s, { type: 'play', seat, card: pick(legalCardsFor(s, seat), rng) });
    }
  }
  return s;
}

// التوزيع عادل: كل ورقة لها نفس الفرصة أن تكون مع أي لاعب (اختبار إحصائي على آلاف التوزيعات)
it('deals are uniformly random: every card is equally likely to land with each seat', () => {
  const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  const N = 8000;
  const counts = new Map<string, number[]>();
  for (let n = 0; n < N; n++) {
    const s = dealHand(0, [0, 0], rng);
    s.hands.forEach((hand, seat) => hand.forEach((c) => {
      const k = `${c.rank}${c.suit}`;
      if (!counts.has(k)) counts.set(k, [0, 0, 0, 0]);
      counts.get(k)![seat]++;
    }));
  }
  // كل لاعب يأخذ 5 من 32 ورقة: المتوقع لكل ورقة عند كل لاعب N×5/32 = 1250، ونسمح بانحراف ±12%
  const expected = (N * 5) / 32;
  for (const [, perSeat] of counts) for (const n of perSeat) expect(Math.abs(n - expected) / expected).toBeLessThan(0.12);
  // وتوزيعان متتاليان لا يتكرران
  const a = dealHand(0, [0, 0], rng).hands.flat().map((c) => c.rank + c.suit).join();
  const b = dealHand(0, [0, 0], rng).hands.flat().map((c) => c.rank + c.suit).join();
  expect(a).not.toBe(b);
});

describe('game flow', () => {
  it('initial deal: 5 cards each + qaba, bidding starts right of dealer', () => {
    const s = newMatch(seededRng(1), 0);
    expect(s.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
    expect(s.stock).toHaveLength(11);
    expect(s.turn).toBe(1);
    // اللفة الأولى: بس/صن/حكم بلون القبلة/أشكل (للذي بعد الموزع) — بدون حكم ثاني
    expect(availableBids(s, 1).map((b) => b.type)).toEqual(['pass', 'sun', 'hokm', 'ashkal']);
    expect(availableBids(s, 2).map((b) => b.type)).toEqual([]);
  });

  it('ashkal for the player after the dealer: qaba goes to his partner', () => {
    let s = newMatch(seededRng(2), 0);
    const qaba = s.qaba!;
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'ashkal' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 1, qabaTo: 3 });
    expect(s.hands[3]).toContainEqual(qaba);
  });

  it('ashkal is not offered to the dealer or the third player', () => {
    let s = newMatch(seededRng(2), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'pass' } });
    expect(availableBids(s, 3).some((b) => b.type === 'ashkal')).toBe(false);
    s = applyAction(s, { type: 'bid', seat: 3, bid: { type: 'pass' } });
    expect(availableBids(s, 0).some((b) => b.type === 'ashkal')).toBe(false);
  });

  it('ashkal for dealer partner; qaba goes to the dealer', () => {
    let s = newMatch(seededRng(2), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'pass' } });
    expect(availableBids(s, 2).some((b) => b.type === 'ashkal')).toBe(true);
    const qaba = s.qaba!;
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'ashkal' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 2, qabaTo: 0 });
    expect(s.hands[0]).toContainEqual(qaba);
    expect(s.hands.map((h) => h.length)).toEqual([8, 8, 8, 8]);
  });

  const allPassRound1 = (seed: number) => {
    let s = newMatch(seededRng(seed), 0);
    for (const seat of [1, 2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    return s;
  };

  it('حكم ثاني appears only in round 2 (after everyone passed)', () => {
    const s0 = newMatch(seededRng(11), 0);
    expect(availableBids(s0, 1).some((b) => b.type === 'secondHokm')).toBe(false);
    const s = allPassRound1(11);
    expect(s.bidRound).toBe(2);
    expect(availableBids(s, 1).map((b) => b.type)).toEqual(['pass', 'sun', 'secondHokm']);
  });

  it('حكم ثاني: others may only pass or sun, then the caller picks a non-qaba suit (or switches to sun)', () => {
    let s = allPassRound1(11);
    const qabaSuit = s.qaba!.suit;
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'secondHokm' } });
    expect(s.turn).toBe(2);
    expect(availableBids(s, 2).map((b) => b.type)).toEqual(['pass', 'sun']);
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    // back to the caller: confirm hokm in one of the other three suits, or switch to sun
    expect(s.turn).toBe(1);
    const all = availableBids(s, 1);
    expect(all).toHaveLength(4);
    expect(all).toContainEqual({ type: 'sun' });
    const choices = all.filter((b) => b.type === 'hokm');
    expect(choices).toHaveLength(3);
    expect(choices.every((b) => b.type === 'hokm' && b.suit !== qabaSuit)).toBe(true);
    expect(availableBids(s, 1).some((b) => b.type === 'pass')).toBe(false);
    const suit = (choices[0] as { suit: string }).suit;
    expect(() => applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: qabaSuit } })).toThrow(IllegalAction);
    s = applyAction(s, { type: 'bid', seat: 1, bid: choices[0] });
    expect(s.contract).toMatchObject({ mode: 'hokm', trump: suit, buyer: 1, qabaTo: 1 });
    // الدبل قبل بقية الورق: الكل ما زال بخمس أوراق
    expect(s.phase).toBe('doubling');
    expect(s.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
    // الخصم (0 و2) يمرر الدبل → تُوزّع البقية ويبدأ اللعب
    for (const seat of [0, 2] as Seat[]) s = applyAction(s, { type: 'doublePass', seat });
    expect(s.phase).toBe('playing');
    expect(s.hands.map((h) => h.length)).toEqual([8, 8, 8, 8]);
    expect(s.hands[1]).toContainEqual(expect.objectContaining({ suit: qabaSuit }));
  });

  it('حكم ثاني: after everyone passes, the caller may switch to sun', () => {
    let s = allPassRound1(11);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'secondHokm' } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'sun' } });
    expect(s.contract).toMatchObject({ mode: 'sun', trump: null, buyer: 1, qabaTo: 1 });
  });

  it('حكم ثاني: anyone may take sun instead', () => {
    let s = allPassRound1(12);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'secondHokm' } });
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 3, bid: { type: 'sun' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 3 });
  });

  it('قبلك: pass, pass, sun → the player just before may take the sun and the qaba', () => {
    let s = newMatch(seededRng(13), 0);
    const qaba = s.qaba!;
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 3, bid: { type: 'sun' } });
    expect(s.contract).toBeNull();
    expect(s.turn).toBe(2);
    expect(availableBids(s, 2).map((b) => b.type)).toEqual(['pass', 'qablak']);
    expect(availableBids(s, 1)).toEqual([]); // فقط الذي قبله مباشرة
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'qablak' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 2, qabaTo: 2 });
    expect(s.hands[2]).toContainEqual(qaba);
  });

  it('قبلك declined: the sun stays with the caller', () => {
    let s = newMatch(seededRng(14), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'sun' } });
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'pass' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 2, qabaTo: 2 });
  });

  it('first speaker taking sun gets no قبلك challenge', () => {
    let s = newMatch(seededRng(15), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'sun' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 1 });
  });

  it('after hokm, later players may only take sun', () => {
    let s = newMatch(seededRng(3), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    expect(availableBids(s, 2).map((b) => b.type)).toEqual(['pass', 'sun']);
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 3, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 0, bid: { type: 'pass' } });
    // رجع الدور للمشتري: تأكيد الحكم أو صن فقط
    expect(s.contract).toBeNull();
    expect(s.turn).toBe(1);
    expect(availableBids(s, 1).map((b) => b.type)).toEqual(['confirmHokm', 'sun']);
    expect(availableBids(s, 2)).toEqual([]);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'confirmHokm' } });
    expect(s.contract).toMatchObject({ mode: 'hokm', buyer: 1 });
    expect(s.phase).toBe('doubling');
    expect(availableDouble(s, 1)).toBeNull(); // الفريق المشتري لا يبدأ الدبل
    expect(availableDouble(s, 0)).toEqual({ label: 'دبل', needsLockChoice: true });
  });

  it('round 2 forbids the qaba suit; all pass twice → redeal by next dealer', () => {
    let s = newMatch(seededRng(4), 0);
    for (const seat of [1, 2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    expect(s.bidRound).toBe(2);
    expect(availableBids(s, 1).some((b) => b.type === 'hokm')).toBe(false);
    for (const seat of [1, 2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    expect(needsRedeal(s)).toBe(true);
    expect(redeal(s, seededRng(5)).dealer).toBe(1);
  });

  it('hokm double chain: دبل (announced, then lock choice) → ثري (open) → فور (lock choice) → قهوة (open)', () => {
    let s = newMatch(seededRng(6), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'confirmHokm' } });
    // الدبل يُعلن أولاً، ثم يختار صاحبه مقفل أو مفتوح — ولا يتحرك أحد غيره قبل اختياره
    s = applyAction(s, { type: 'double', seat: 0 });
    expect(s.doubling).toMatchObject({ level: 2, lockPending: 0 });
    expect(availableDouble(s, 1)).toBeNull();
    expect(() => applyAction(s, { type: 'doublePass', seat: 1 })).toThrow(IllegalAction);
    expect(() => applyAction(s, { type: 'doubleLock', seat: 1, locked: true })).toThrow(IllegalAction);
    s = applyAction(s, { type: 'doubleLock', seat: 0, locked: true });
    expect(s.doubling).toMatchObject({ level: 2, locked: true, lockPending: null, awaitingSeat: 1 });
    // بعد الدبل: المزايدة بين المدبّل (0) والمشتري (1) فقط
    expect(availableDouble(s, 1)).toEqual({ label: 'ثري', needsLockChoice: false });
    expect(availableDouble(s, 3)).toBeNull();
    s = applyAction(s, { type: 'double', seat: 1 });
    expect(s.doubling).toMatchObject({ level: 3, locked: false });
    expect(availableDouble(s, 0)).toEqual({ label: 'فور', needsLockChoice: true });
    expect(availableDouble(s, 2)).toBeNull();
    // الروبوت يرسل اختياره مع الدبل مباشرة
    s = applyAction(s, { type: 'double', seat: 0, locked: true });
    expect(s.doubling).toMatchObject({ level: 4, locked: true });
    expect(availableDouble(s, 1)?.label).toBe('قهوة');
    s = applyAction(s, { type: 'double', seat: 1 });
    expect(s.phase).toBe('playing');
    expect(s.doubling).toMatchObject({ level: 4, gahwa: true, locked: false, doublerTeam: 0 });
  });

  it('after a hokm bid every other player gets a turn, including those who passed before it', () => {
    let s = newMatch(seededRng(11), 0);
    // الموزع 0: الدور يبدأ من 1
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 2, bid: { type: 'hokm', suit: s.qaba!.suit } });
    // يلف على 3 ثم 0 ثم 1 (الذي قال بس قبل الحكم) — كلهم بس أو صن
    for (const seat of [3, 0, 1] as Seat[]) {
      expect(s.turn).toBe(seat);
      expect(availableBids(s, seat).map((b) => b.type)).toEqual(['pass', 'sun']);
      s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    }
    // ثم يرجع للمشتري: تأكيد الحكم أو صن
    expect(s.turn).toBe(2);
    expect(availableBids(s, 2).map((b) => b.type)).toEqual(['confirmHokm', 'sun']);
  });

  it('three stays open even after a locked double', () => {
    let s = newMatch(seededRng(9), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'confirmHokm' } });
    s = applyAction(s, { type: 'double', seat: 2, locked: true });
    s = applyAction(s, { type: 'double', seat: 1 });
    // شريك المدبّل لا يقرر؛ تمرير المدبّل وحده ينهي الدبل
    expect(() => applyAction(s, { type: 'doublePass', seat: 0 })).toThrow(IllegalAction);
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

describe('new rules: hokm confirmation, doubling pair, automatic baloot', () => {
  it('the hokm buyer may switch to sun when everyone passed', () => {
    let s = newMatch(seededRng(3), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'sun' } });
    expect(s.contract).toMatchObject({ mode: 'sun', buyer: 1, qabaTo: 1 });
  });

  it('baloot is declared automatically when the second of K/Q of trump is played', () => {
    let checked = 0;
    for (let seed = 1; seed < 400 && checked < 3; seed++) {
      const rng = seededRng(seed);
      let s = newMatch(rng, 0);
      s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
      for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
      s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'confirmHokm' } });
      for (const seat of [0, 2] as Seat[]) s = applyAction(s, { type: 'doublePass', seat });
      const trump = s.contract!.trump!;
      const holder = ([0, 1, 2, 3] as Seat[]).find((x) => ['K', 'Q'].every((r) => s.initialHands[x].some((c) => c.suit === trump && c.rank === r)));
      if (holder === undefined) continue;
      while (s.trickNo < 8 && s.balootSeat === null) {
        const seat = s.turn;
        const card = pick(legalCardsFor(s, seat), rng);
        const before = s;
        s = applyAction(s, { type: 'play', seat, card });
        if (s.balootSeat !== null) {
          expect(s.balootSeat).toBe(holder);
          expect(seat).toBe(holder);
          expect(card.suit === trump && (card.rank === 'K' || card.rank === 'Q')).toBe(true);
          expect(before.hands[holder].filter((c) => c.suit === trump && (c.rank === 'K' || c.rank === 'Q'))).toHaveLength(1);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
