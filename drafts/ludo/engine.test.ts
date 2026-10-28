import { describe, expect, it } from 'vitest';
import { seededRng } from '../../shared/baloot/testing';
import { ludoBotAction } from './bot';
import { type LudoState, DEFAULT_RULES, FINISH, TEAM_RULES, applyLudo, capturesAt, movableTokens, newGame } from './engine';
import { moveAnnouncement, optionText } from './labels';

/** نرد مضبوط: يرجع القيم بالترتيب */
const dice = (...vals: number[]) => { let i = 0; return () => (vals[i++ % vals.length] - 1) / 6 + 0.01; };

function base(over: Partial<LudoState> = {}): LudoState {
  return { ...newGame(() => 0, DEFAULT_RULES), turn: 0, ...over };
}

describe('ludo', () => {
  it('needs a six to leave home; six gives another roll', () => {
    let s = base();
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(4));
    expect(s.turn).toBe(1); // لا حركة
    expect(s.lastMove?.token).toBeNull();
    s = base();
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(6));
    expect(s.phase).toBe('move');
    expect(movableTokens(s, 0)).toEqual([0, 1, 2, 3]);
    s = applyLudo(s, { type: 'move', seat: 0, token: 2 }, dice(1));
    expect(s.tokens[0][2]).toBe(0);
    expect(s.turn).toBe(0);
    expect(s.phase).toBe('roll');
  });

  it('exact roll to finish; finishing gives another roll', () => {
    let s = base({ tokens: [[54, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(3));
    expect(s.turn).toBe(1); // 54+3 يتجاوز الوسط
    s = base({ tokens: [[54, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(2));
    s = applyLudo(s, { type: 'move', seat: 0, token: 0 }, dice(1));
    expect(s.tokens[0][0]).toBe(FINISH);
    expect(s.turn).toBe(0);
    expect(s.lastMove?.extraTurn).toBe(true);
  });

  it('captures on normal squares, not on safe squares; capture gives another roll', () => {
    // الأحمر على 10 (مطلق 10)، الأخضر على 50 (مطلق (13+50)%52 = 11)
    let s = base({ tokens: [[10, -1, -1, -1], [50, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(1));
    expect(optionText(s, 0, 0, ['أنت', 'سالم', 'فهد', 'علي'])).toContain('يأكل حجر سالم 1');
    s = applyLudo(s, { type: 'move', seat: 0, token: 0 }, dice(1));
    expect(s.tokens[1][0]).toBe(-1);
    expect(s.turn).toBe(0);
    expect(moveAnnouncement(s, ['أنت', 'سالم', 'فهد', 'علي'], 0)).toContain('أكل حجر سالم 1، ورجع للبيت');
    // خانة النجمة 8 آمنة: الأخضر عند 47 (مطلق 8)
    const t = base({ tokens: [[2, -1, -1, -1], [47, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    expect(capturesAt(t, 0, 8)).toEqual([]);
  });

  it('three sixes in a row lose the turn', () => {
    let s = base({ tokens: [[5, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    const r = dice(6, 6, 6);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    s = applyLudo(s, { type: 'move', seat: 0, token: 0 }, r);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    s = applyLudo(s, { type: 'move', seat: 0, token: 0 }, r);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    expect(s.lastMove?.threeSixes).toBe(true);
    expect(s.turn).toBe(1);
    expect(s.tokens[0][0]).toBe(17);
  });

  it('teams: partners are not captured; a finished player moves the partner', () => {
    let s: LudoState = { ...newGame(() => 0, TEAM_RULES), turn: 0, tokens: [[10, -1, -1, -1], [-1, -1, -1, -1], [36, -1, -1, -1], [-1, -1, -1, -1]] };
    // الأصفر (شريك الأحمر) عند 36 = مطلق (26+36)%52 = 10: الأحمر لا يأكله
    expect(capturesAt(s, 0, 10)).toEqual([]);
    s = { ...s, tokens: [[FINISH, FINISH, FINISH, FINISH], [-1, -1, -1, -1], [5, -1, -1, -1], [-1, -1, -1, -1]] };
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(3));
    expect(movableTokens(s, 0)).toEqual([0]);
    s = applyLudo(s, { type: 'move', seat: 0, token: 0 }, dice(1));
    expect(s.tokens[2][0]).toBe(8);
  });

  it('two players sit opposite; bots play full games to a winner', () => {
    expect(newGame(() => 0, { ...DEFAULT_RULES, players: 2 }).seats).toEqual([0, 2]);
    for (const rules of [DEFAULT_RULES, TEAM_RULES, { ...DEFAULT_RULES, players: 3 as const }, { ...DEFAULT_RULES, players: 2 as const }]) {
      for (let seed = 1; seed <= 15; seed++) {
        const rng = seededRng(seed);
        let s = newGame(rng, rules);
        let n = 0;
        while (s.phase !== 'over' && n++ < 20000) s = applyLudo(s, ludoBotAction(s, s.turn)!, rng);
        expect(s.phase).toBe('over');
        expect(s.winner).not.toBeNull();
        for (const o of [0, 1, 2, 3]) if (!s.seats.includes(o)) expect(s.tokens[o].every((p) => p === -1)).toBe(true);
      }
    }
  });
});
