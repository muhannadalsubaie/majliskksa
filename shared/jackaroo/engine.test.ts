import { describe, expect, it } from 'vitest';
import { seededRng } from '../baloot/testing';
import { jackarooBotAction } from './bot';
import {
  type Card, type JackarooState, type Marble, COMPLEX_RULES, JackarooError, applyJackaroo, fullDeck, legalMoves,
  movesForCard, mustBurn, newGame, startOf, trackLen,
} from './engine';
import { boardSummary, cardName, moveAnnouncement } from './labels';

const card = (rank: Card['rank'], suit: Card['suit'] = 'S'): Card => ({ rank, suit });
const home: Marble = { zone: 'home' };
const track = (pos: number): Marble => ({ zone: 'track', pos });

/** حالة مصنوعة: أحجار محددة وورقة في يد اللاعب 0 */
function setup(marbles: Marble[][], hand: Card[], extra: Partial<JackarooState> = {}): JackarooState {
  const base = newGame(seededRng(1));
  const full = marbles.map((row) => [...row, ...Array(4 - row.length).fill(home)]);
  return { ...base, marbles: full, hands: [hand, [card('2', 'H')], [card('2', 'D')], [card('2', 'C')]], turn: 0, ...extra };
}

describe('jackaroo', () => {
  it('uses one 52-card deck dealt 4, 4 then 5 cards', () => {
    expect(fullDeck()).toHaveLength(52);
    const s = newGame(seededRng(2));
    // 4 لكل لاعب (اللي ما عنده لعب انحرقت أوراقه تلقائياً)
    expect(s.hands.map((h) => h.length + 0).reduce((x, y) => x + y, 0) + s.pile.length).toBe(16);
    for (const i of s.autoBurned ?? []) expect(s.hands[i]).toHaveLength(0);
    expect(s.deck).toHaveLength(36);
  });

  it('a player with no legal move burns all cards automatically and is skipped', () => {
    // كل الأحجار في البيت ومعه أوراق بلا أص ولا شايب
    const s = setup([[], [], [], []], [card('5'), card('Q'), card('9')]);
    const s1 = { ...s, turn: 3, hands: [[card('5')], [card('A')], [card('7')], [card('2')]] };
    const after = applyJackaroo(s1, { type: 'burn', seat: 3, card: card('2') }, seededRng(1));
    // الدور على 0: ما عنده لعب (5 وكل أحجاره في البيت) فتنحرق ورقته ويروح الدور لـ1
    expect(after.autoBurned).toEqual([0]);
    expect(after.hands[0]).toHaveLength(0);
    expect(after.turn).toBe(1);
  });

  it('only Ace or King brings a marble out to its base', () => {
    const s = setup([[], [], [], []], [card('A'), card('5'), card('Q')]);
    expect(movesForCard(s, 0, card('A'))).toEqual([{ kind: 'out', marble: { owner: 0, index: 0 } }]);
    expect(movesForCard(s, 0, card('Q'))).toEqual([]);
    const out = applyJackaroo(s, { type: 'play', seat: 0, card: card('A'), move: { kind: 'out', marble: { owner: 0, index: 0 } } }, seededRng(3));
    expect(out.marbles[0][0]).toEqual(track(startOf(out.rules, 0)));
  });

  it('a marble on its own base cannot be passed or captured', () => {
    // حجر اللاعب 1 على قاعدته (19)، وحجرنا قبله بخانتين
    const s = setup([[track(17)], [track(19)], [], []], [card('3'), card('2')]);
    expect(movesForCard(s, 0, card('3'))).toEqual([]); // يتخطاه: ممنوع
    expect(movesForCard(s, 0, card('2'))).toEqual([]); // يقف عليه: ممنوع
  });

  it('landing on a marble sends it home; you cannot land on your own', () => {
    const s = setup([[track(5), track(8)], [track(10)], [], []], [card('5', 'H'), card('3')]);
    // 3 من 5 → 8 حجري: ممنوع
    expect(movesForCard(s, 0, card('3')).some((m) => m.kind === 'forward' && m.marble.index === 0)).toBe(false);
    const after = applyJackaroo(s, { type: 'play', seat: 0, card: card('5', 'H'), move: { kind: 'forward', marble: { owner: 0, index: 0 }, steps: 5 } }, seededRng(4));
    expect(after.marbles[1][0]).toEqual(home);
    expect(after.lastMove!.captured).toEqual([{ owner: 1, index: 0 }]);
  });

  it('enters the safe zone only by the exact count, without jumping over safe marbles', () => {
    const L = 76;
    const s = setup([[track(L - 2)], [], [], []], [card('3'), card('5'), card('6')]);
    // من خانة 74: خطوة لآخر المسار، ثم الأمان — 3 → الأمان 2، 5 → الأمان 4 (آخرها)، 6 → تتعدّاها: ممنوع
    expect(movesForCard(s, 0, card('3'))).toHaveLength(1);
    expect(movesForCard(s, 0, card('5')).filter((m) => m.kind === 'forward' && m.marble.owner === 0)).toHaveLength(1);
    expect(movesForCard(s, 0, card('6'))).toHaveLength(0);
    // حجر في الأمان 2: لا يُتخطّى
    const blocked = setup([[track(L - 2), { zone: 'safe', pos: 1 }], [], [], []], [card('6', 'H'), card('5')]);
    expect(movesForCard(blocked, 0, card('5')).filter((m) => m.kind === 'forward' && m.marble.index === 0)).toHaveLength(0);
  });

  it('seven can be split between two marbles; four moves backward; five can move an opponent', () => {
    const s = setup([[track(30), track(40)], [track(50)], [], []], [card('7'), card('4'), card('5')]);
    const sevens = movesForCard(s, 0, card('7'));
    expect(sevens.some((m) => m.kind === 'split')).toBe(true);
    expect(movesForCard(s, 0, card('4'))).toContainEqual({ kind: 'back', marble: { owner: 0, index: 0 }, steps: 4 });
    expect(movesForCard(s, 0, card('5'))).toContainEqual({ kind: 'forward', marble: { owner: 1, index: 0 }, steps: 5 });
  });

  it('jack swaps with another player marble (not one on its base); ten can make the next player burn', () => {
    const s = setup([[track(30)], [track(50), track(19)], [], []], [card('J'), card('10')]);
    const jacks = movesForCard(s, 0, card('J'));
    expect(jacks).toEqual([{ kind: 'swap', mine: { owner: 0, index: 0 }, other: { owner: 1, index: 0 } }]);
    const after = applyJackaroo(s, { type: 'play', seat: 0, card: card('10'), move: { kind: 'skipNext' } }, seededRng(5));
    expect(after.forcedBurn).toBe(1);
    expect(mustBurn(after, 1)).toBe(true);
    expect(legalMoves(after, 1)).toEqual([]);
  });

  it('burning is only allowed when nothing can be played', () => {
    const s = setup([[], [], [], []], [card('Q'), card('9')]);
    expect(mustBurn(s, 0)).toBe(true);
    const ok = setup([[], [], [], []], [card('A')]);
    expect(() => applyJackaroo(ok, { type: 'burn', seat: 0, card: card('A') }, seededRng(6))).toThrow(JackarooError);
  });

  it('a finished player moves his partner marbles', () => {
    const safe: Marble[] = [0, 1, 2, 3].map((pos) => ({ zone: 'safe', pos }));
    const s = setup([safe, [], [track(startOf(newGame(seededRng(1)).rules, 2) + 3)], []], [card('2')]);
    expect(movesForCard(s, 0, card('2'))).toEqual([{ kind: 'forward', marble: { owner: 2, index: 0 }, steps: 2 }]);
  });

  it('bots play complete games until one team brings all 8 marbles home', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = seededRng(seed);
      let s = newGame(rng);
      let steps = 0;
      while (s.phase === 'playing') {
        const a = jackarooBotAction(s, s.turn);
        expect(a, `seed ${seed}: stuck`).not.toBeNull();
        s = applyJackaroo(s, a!, rng);
        // لا تتكرر خانة بحجرين، والأوراق كلها محفوظة
        const occupied = s.marbles.flat().filter((m) => m.zone === 'track').map((m) => (m as { pos: number }).pos);
        expect(new Set(occupied).size).toBe(occupied.length);
        expect(s.hands.flat().length + s.deck.length + s.pile.length).toBe(52);
        if (++steps > 20000) throw new Error(`seed ${seed}: too long`);
      }
      expect(s.winnerTeam).not.toBeNull();
      const t = s.winnerTeam!;
      expect([t, t + 2].every((o) => s.marbles[o].every((m) => m.zone === 'safe'))).toBe(true);
      expect(trackLen(s.rules)).toBe(76);
    }
  });

  it('speaks moves and the board in Arabic', () => {
    const s = setup([[], [track(10)], [], []], [card('A')]);
    const names = ['أنت', 'سالم', 'فهد', 'علي'];
    const after = applyJackaroo(s, { type: 'play', seat: 0, card: card('A'), move: { kind: 'out', marble: { owner: 0, index: 0 } } }, seededRng(7));
    expect(cardName(card('K'))).toBe('شايب سبيت');
    expect(moveAnnouncement(after, names, 0)[0]).toBe('أنت لعب أكة سبيت: إنزال حجرك 1');
    expect(boardSummary(after, names, 0)).toMatch(/^أحجارك: 1 في الخانة 0، على قاعدته/);
    // رقم الخانة نفسه للجميع
    expect(boardSummary(after, names, 1)).toMatch(/أحجار أنت: 1 في الخانة 0،/);
    expect(moveAnnouncement(after, names, 0)[1]).toBe('حجرك 1 في الخانة 0، على قاعدته');
  });
});

describe('jackaroo complex', () => {
  const cx = (marbles: Marble[][], hand: Card[]) => ({ ...setup(marbles, hand), rules: COMPLEX_RULES });

  it('king runs 13 and captures every marble it passes, even one protected on its base', () => {
    // حجر اللاعب 1 على قاعدته (19) في الطريق، وحجر للاعب 2 مكان الوقوف
    const s = cx([[track(10)], [track(19)], [track(23)], []], [card('K')]);
    const runs = movesForCard(s, 0, card('K')).filter((m) => m.kind === 'kingRun');
    expect(runs).toHaveLength(1);
    const after = applyJackaroo(s, { type: 'play', seat: 0, card: card('K'), move: runs[0] }, seededRng(1));
    expect(after.marbles[0][0]).toEqual(track(23));
    expect(after.marbles[1][0]).toEqual(home);
    expect(after.marbles[2][0]).toEqual(home);
    expect(after.lastMove!.captured).toHaveLength(2);
  });

  it('red jack moves 11, black jack swaps', () => {
    const s = cx([[track(30)], [track(50)], [], []], [card('J', 'H'), card('J', 'S')]);
    expect(movesForCard(s, 0, card('J', 'H'))).toEqual([{ kind: 'forward', marble: { owner: 0, index: 0 }, steps: 11 }]);
    expect(movesForCard(s, 0, card('J', 'S'))).toEqual([{ kind: 'swap', mine: { owner: 0, index: 0 }, other: { owner: 1, index: 0 } }]);
  });

  it('red queen moves 12; black queen makes the next player burn the card you pick (he keeps his turn)', () => {
    const s = cx([[track(30)], [], [], []], [card('Q', 'D'), card('Q', 'C')]);
    expect(movesForCard(s, 0, card('Q', 'D'))).toEqual([{ kind: 'forward', marble: { owner: 0, index: 0 }, steps: 12 }]);
    const picks = movesForCard(s, 0, card('Q', 'C'));
    expect(picks).toEqual([{ kind: 'discardNext', index: 0 }]);
    const after = applyJackaroo(s, { type: 'play', seat: 0, card: card('Q', 'C'), move: picks[0] }, seededRng(2));
    expect(after.hands[1]).toHaveLength(0);
    expect(after.lastMove!.discarded).toEqual(card('2', 'H'));
  });

  it('bots finish complete complex games', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = seededRng(seed * 7);
      let s = newGame(rng, COMPLEX_RULES);
      let steps = 0;
      while (s.phase === 'playing') {
        const a = jackarooBotAction(s, s.turn);
        expect(a, `seed ${seed}: stuck`).not.toBeNull();
        s = applyJackaroo(s, a!, rng);
        expect(s.hands.flat().length + s.deck.length + s.pile.length).toBe(52);
        if (++steps > 20000) throw new Error('too long');
      }
      expect(s.winnerTeam).not.toBeNull();
    }
  });
});

describe('five', () => {
  it('cannot move a marble sitting on its own base (even yours), but can move one that left it', () => {
    const s0 = newGame(seededRng(3));
    const L = trackLen(s0.rules);
    const five = { rank: '5' as const, suit: 'S' as const };
    // أحجاري وأحجار سالم توها نازلة على القاعدة
    let s = { ...s0, turn: 0, forcedBurn: null, hands: s0.hands.map((h, i) => (i === 0 ? [five] : h)) };
    s = { ...s, marbles: s.marbles.map((row, o) => (o === 0 || o === 1 ? row.map((m, i) => (i === 0 ? { zone: 'track' as const, pos: startOf(s.rules, o) } : m)) : row)) };
    expect(movesForCard(s, 0, five)).toEqual([]);
    expect(mustBurn(s, 0)).toBe(true);
    // يوسف (مقعد 2) عنده حجر تحرك عن قاعدته: الخمسة تمشيه
    s = { ...s, marbles: s.marbles.map((row, o) => (o === 2 ? row.map((m, i) => (i === 0 ? { zone: 'track' as const, pos: (startOf(s.rules, 2) + 3) % L } : m)) : row)) };
    const moves = movesForCard(s, 0, five);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.kind === 'forward' && m.marble.owner === 2)).toBe(true);
  });
});
