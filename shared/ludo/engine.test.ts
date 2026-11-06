import { describe, expect, it } from 'vitest';
import { seededRng } from '../baloot/testing';
import { ludoBotAction } from './bot';
import { type LudoState, DEFAULT_RULES, FINISH, TEAM_RULES, applyLudo, capturesAt, movableTokens, moveOptions, newGame } from './engine';
import { moveAnnouncement, optionText, personalize, squareText } from './labels';

/** نرد مضبوط: يرجع القيم بالترتيب */
const dice = (...vals: number[]) => { let i = 0; return () => { const v = vals[i++ % vals.length]; return v === 6 ? 0.1 : 0.25 + (v - 1) * 0.15 + 0.01; }; };

function base(over: Partial<LudoState> = {}): LudoState {
  return { ...newGame(() => 0, DEFAULT_RULES), turn: 0, ...over };
}

describe('ludo', () => {
  it('needs a six to leave home; a six rolls again first, then the player picks a die per move', () => {
    let s = base();
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(4));
    expect(s.turn).toBe(1); // لا حركة
    expect(s.lastMove?.token).toBeNull();
    s = base();
    const r = dice(6, 3);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    // ستة: يرمي مرة ثانية قبل ما يحرك
    expect(s.phase).toBe('roll');
    expect(s.turn).toBe(0);
    expect(s.lastMove?.rollAgain).toBe(true);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    expect(s.phase).toBe('move');
    expect(s.pool).toEqual([6, 3]);
    // بالستة يطلع أي حجر، والثلاثة ما تطلّع من البيت
    expect(moveOptions(s, 0)).toEqual([0, 1, 2, 3].map((token) => ({ token, die: 6 })));
    s = applyLudo(s, { type: 'move', seat: 0, token: 2, die: 6 }, r);
    expect(s.tokens[0][2]).toBe(0);
    // باقي الثلاثة: نفس الحجر يكمل
    expect(s.phase).toBe('move');
    expect(moveOptions(s, 0)).toEqual([{ token: 2, die: 3 }]);
    s = applyLudo(s, { type: 'move', seat: 0, token: 2, die: 3 }, r);
    expect(s.tokens[0][2]).toBe(3);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('roll');
  });

  it('a six and another number can move two different tokens', () => {
    let s = base({ tokens: [[10, 20, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    const r = dice(6, 2);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    s = applyLudo(s, { type: 'move', seat: 0, token: 0, die: 2 }, r);
    expect(s.tokens[0][0]).toBe(12);
    s = applyLudo(s, { type: 'move', seat: 0, token: 1, die: 6 }, r);
    expect(s.tokens[0][1]).toBe(26);
    expect(s.turn).toBe(1);
    expect(() => applyLudo(base({ phase: 'move', pool: [3], dice: 3, tokens: [[10, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] }), { type: 'move', seat: 0, token: 0, die: 5 }, r)).toThrow();
  });

  it('exact roll to finish; finishing gives another roll', () => {
    let s = base({ tokens: [[56, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(3));
    expect(s.turn).toBe(1); // 56+3 يتجاوز المنزل
    s = base({ tokens: [[56, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
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
    const names = ['مهند', 'سالم', 'فهد', 'علي'];
    const lines = moveAnnouncement(s, names, -1);
    // لك: أرقام من خانة بدايتك، و"أنت"
    expect(lines.map((l) => personalize(l, names, 0))).toEqual(['رميت واحد، وتحركت من 11 إلى 12', 'أكلت حجر سالم 1، ورجع للبيت', 'ترمي مرة أخرى']);
    // لسالم: نفس الأرقام (ثابتة للجميع)، وحجره اللي انأكل "حجرك"
    expect(lines.map((l) => personalize(l, names, 1))).toEqual(['مهند رمى واحد، وتحرك من 11 إلى 12', 'مهند أكل حجرك 1، ورجع للبيت', 'مهند يرمي مرة أخرى']);
    // خانة النجمة 8 آمنة: الأخضر عند 47 (مطلق 8)
    const t = base({ tokens: [[2, -1, -1, -1], [47, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    expect(capturesAt(t, 0, 8)).toEqual([]);
  });

  it('announces moves by the same board numbers (1–52) for everyone, and "منطقة أمان" only on the safe squares', () => {
    const names = ['مهند', 'سالم', 'فهد', 'علي'];
    // من 5 إلى 8 (خانة نجمة آمنة)
    let s = base({ tokens: [[5, -1, -1, -1], [20, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(3));
    s = applyLudo(s, { type: 'move', seat: 0, token: 0 }, dice(3));
    expect(moveAnnouncement(s, names, -1, false).map((l) => personalize(l, names, 0))).toEqual(['أنت تحركت من 6 إلى 9', 'في منطقة أمان']);
    // من 26 إلى 29: خانة عادية، يقرأ الرقم بس
    s = base({ tokens: [[26, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    s = applyLudo(s, { type: 'roll', seat: 0 }, dice(3));
    s = applyLudo(s, { type: 'move', seat: 0, token: 0 }, dice(3));
    expect(moveAnnouncement(s, names, -1, false).map((l) => personalize(l, names, 0))).toEqual(['أنت تحركت من 27 إلى 30']);
    expect(moveAnnouncement(s, names, -1, false).map((l) => personalize(l, names, 2))).toEqual(['مهند تحرك من 27 إلى 30']);
    // أماكن الأحجار: "منطقة أمان" بس على خانات الأمان، والباقي رقم بس
    expect(squareText(s, 0, 29, 0)).toBe('في الخانة 30');
    // نفس الرقم لكل لاعب
    expect(squareText(s, 0, 29, 2)).toBe('في الخانة 30');
    expect(squareText(s, 0, 8, 0)).toBe('في الخانة 9، منطقة أمان');
  });

  it('three sixes in a row lose the turn (and all its numbers)', () => {
    let s = base({ tokens: [[5, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] });
    const r = dice(6, 6, 6);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    s = applyLudo(s, { type: 'roll', seat: 0 }, r);
    expect(s.lastMove?.threeSixes).toBe(true);
    expect(s.turn).toBe(1);
    expect(s.pool).toEqual([]);
    expect(s.tokens[0][0]).toBe(5);
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
