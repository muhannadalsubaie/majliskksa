import { describe, expect, it } from 'vitest';
import { seededRng } from '../../shared/baloot/testing';
import { dominoBotAction } from './bot';
import {
  type DominoState, type Tile, DominoError, applyDomino, canDraw, canPass, defaultTarget, ends, fullSet, newMatch, nextHand,
  openingTile, pips, playable, sideOf,
} from './engine';
import { endsLabel, handAnnouncement, lineLabel, moveAnnouncement, tileLabel } from './labels';

const t = (a: number, b: number) => ({ a, b }) as Tile;

describe('domino', () => {
  it('has 28 tiles and deals 7 each', () => {
    expect(fullSet()).toHaveLength(28);
    const s = newMatch(seededRng(1));
    expect(s.hands.map((h) => h.length)).toEqual([7, 7, 7, 7]);
    expect(s.boneyard).toHaveLength(0);
    const two = newMatch(seededRng(1), { players: 2, target: 100 });
    expect(two.boneyard).toHaveLength(14);
  });

  it('first hand: the holder of double six opens with it', () => {
    const s = newMatch(seededRng(3));
    const holder = s.hands.findIndex((h) => h.some((x) => x.a === 6 && x.b === 6));
    expect(s.turn).toBe(holder);
    expect(playable(s, holder)).toEqual([expect.objectContaining({ a: 6, b: 6 })]);
    expect(openingTile([[t(5, 5), t(6, 1)], [t(3, 3)]])).toEqual(t(5, 5));
  });

  it('places tiles on the right ends and rejects illegal ones', () => {
    let s = newMatch(seededRng(3));
    s = applyDomino(s, { type: 'play', seat: s.turn, tile: t(6, 6) });
    expect(ends(s)).toEqual({ left: 6, right: 6 });
    const seat = s.turn;
    const wrong = s.hands[seat].find((x) => x.a !== 6 && x.b !== 6);
    if (wrong) expect(() => applyDomino(s, { type: 'play', seat, tile: wrong })).toThrow(DominoError);
  });

  it('draw game: draws when stuck, but the last two boneyard tiles are never drawn (Pagat)', () => {
    const base = newMatch(seededRng(5), { players: 2, target: 100 });
    // نصنع حالة: يد بلا قطعة تصلح، وفي البنك 3 قطع
    const s: DominoState = {
      ...base, handNo: 2, turn: 0, line: [{ tile: t(6, 6), seat: 1, outer: 6, side: 'first' }],
      hands: [[t(1, 2)], [t(3, 4)]], boneyard: [t(6, 5), t(0, 0), t(1, 1)],
    };
    expect(canDraw(s, 0)).toBe(true);
    expect(canPass(s, 0)).toBe(false);
    const drawn = applyDomino(s, { type: 'draw', seat: 0 });
    expect(drawn.hands[0]).toHaveLength(2);
    expect(playable(drawn, 0)).toEqual([t(6, 5)]);
    // بقيت قطعتان فقط: لا سحب، يدق
    const stuck: DominoState = { ...s, boneyard: [t(0, 0), t(1, 1)] };
    expect(canDraw(stuck, 0)).toBe(false);
    expect(canPass(stuck, 0)).toBe(true);
    expect(() => applyDomino(stuck, { type: 'draw', seat: 0 })).toThrow(DominoError);
  });

  it('blocked draw game: the lowest player scores the others pips minus his own (Pagat)', () => {
    const base = newMatch(seededRng(13), { players: 2, target: 100 });
    const s: DominoState = {
      ...base, handNo: 2, turn: 0, line: [{ tile: t(6, 6), seat: 1, outer: 6, side: 'first' }],
      hands: [[t(1, 2)], [t(4, 5)]], boneyard: [t(0, 0), t(1, 1)],
    };
    let x = applyDomino(s, { type: 'pass', seat: 0 });
    x = applyDomino(x, { type: 'pass', seat: 1 });
    expect(x.lastHand!.kind).toBe('blocked');
    // 3 مقابل 9: الفائز يأخذ 9 − 3 = 6
    expect(x.lastHand!.points).toEqual([6, 0]);
  });

  it('match targets follow Pagat: 100 for two players and partnerships, 61 for three', () => {
    expect(defaultTarget(2)).toBe(100);
    expect(defaultTarget(4)).toBe(100);
    expect(defaultTarget(3)).toBe(61);
  });

  it('domino: the winner scores the pips left in opponents hands (team play counts both opponents)', () => {
    const base = newMatch(seededRng(7));
    const s: DominoState = {
      ...base, handNo: 2, turn: 0, line: [{ tile: t(6, 6), seat: 3, outer: 6, side: 'first' }],
      hands: [[t(6, 1)], [t(2, 2), t(3, 1)], [t(5, 5)], [t(4, 0)]],
    };
    const after = applyDomino(s, { type: 'play', seat: 0, tile: t(6, 1) });
    expect(after.phase).toBe('handOver');
    expect(after.lastHand!.kind).toBe('domino');
    // الفريق 0 (0 و2) يأخذ قطع الخصوم 1 و3: 4+4+4 = 12 (قطعة الشريك لا تُحسب)
    expect(after.lastHand!.points).toEqual([12, 0]);
    expect(after.nextStarter).toBe(0);
  });

  it('blocked game: the side with the fewest pips wins the opponents pips', () => {
    const base = newMatch(seededRng(9));
    const s: DominoState = {
      ...base, handNo: 2, turn: 0,
      line: [{ tile: t(6, 6), seat: 3, outer: 6, side: 'first' }],
      hands: [[t(1, 1)], [t(2, 2)], [t(0, 1)], [t(3, 3)]],
    };
    let x = s;
    for (const seat of [0, 1, 2, 3]) x = applyDomino(x, { type: 'pass', seat });
    expect(x.lastHand!.kind).toBe('blocked');
    // الفريق 0: 2+1 = 3، الفريق 1: 4+6 = 10 → الفريق 0 يأخذ 10
    expect(x.lastHand!.points).toEqual([10, 0]);
  });

  it('bots play complete matches to the target in 2, 3 and 4 player games', () => {
    for (const players of [2, 3, 4] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        const rng = seededRng(seed * 31 + players);
        let s = newMatch(rng, { players, target: defaultTarget(players) });
        let steps = 0;
        while (s.phase !== 'matchOver') {
          if (s.phase === 'handOver') { s = nextHand(s, rng); continue; }
          const a = dominoBotAction(s, s.turn);
          expect(a, `${players}p seed ${seed}: stuck`).not.toBeNull();
          s = applyDomino(s, a!);
          // لا تضيع ولا تتكرر قطعة
          if (s.phase === 'playing') {
            const all = [...s.hands.flat(), ...s.boneyard, ...s.line.map((p) => p.tile)];
            expect(all).toHaveLength(28);
            expect(new Set(all.map((x) => `${Math.max(x.a, x.b)}${Math.min(x.a, x.b)}`)).size).toBe(28);
          }
          if (++steps > 20000) throw new Error('too many steps');
        }
        expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(defaultTarget(players));
        expect(s.scores).toHaveLength(players === 4 ? 2 : players);
        expect(sideOf(s.rules, 2)).toBe(players === 4 ? 0 : 2);
      }
    }
  });

  it('speaks tiles and moves in Arabic', () => {
    expect(tileLabel(t(6, 6))).toBe('دوس ستة');
    expect(tileLabel(t(3, 6))).toBe('ستة وثلاثة');
    expect(tileLabel(t(0, 5))).toBe('خمسة وفاضي');
    let s = newMatch(seededRng(3));
    const names = ['أنت', 'سالم', 'فهد', 'علي'];
    s = applyDomino(s, { type: 'play', seat: s.turn, tile: t(6, 6) });
    expect(moveAnnouncement(s, names)).toMatch(/لعب دوس ستة$/);
    expect(endsLabel(s)).toBe('الطرفان: يمين ستة، يسار ستة');
    expect(lineLabel(s)).toBe('على الطاولة 1 قطع: دوس ستة');
    expect(pips(t(6, 5))).toBe(11);
    expect(handAnnouncement(s, names)).toEqual([]);
  });
});
