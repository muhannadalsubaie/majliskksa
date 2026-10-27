import { describe, expect, it } from 'vitest';
import { seededRng } from './baloot/testing';
import { applyOther, parseDomino, parseJackaroo } from './games';
import { addBot, leave, newTable, nextAutoStep, runAutoStep, startAny, stopGame, viewFor, type TableData } from './table';
import { playable } from './domino/engine';
import { legalMoves } from './jackaroo/engine';

const owner = { uid: 'u1', username: 'مهند' };

function table(kind: 'domino' | 'jackaroo', variant: 'classic' | 'complex' = 'classic'): TableData {
  let t = newTable('t1', owner, false, 0, kind, variant);
  t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
  return t;
}

/** تشغيل الروبوتات (والمالك كروبوت) حتى نهاية المباراة */
function playOut(t: TableData, rng: () => number): TableData {
  let cur = { ...t, seats: t.seats.map((m, i) => (i === 0 ? { uid: 'bot-x', username: 'روبوت', isBot: true } : m)) };
  for (let i = 0; i < 20000; i++) {
    const step = nextAutoStep(cur, rng);
    if (!step) break;
    cur = runAutoStep(cur, step, rng).table;
  }
  return cur;
}

describe('domino and jackaroo tables', () => {
  it('domino: starts, hides other hands, bots finish the match', () => {
    const rng = seededRng(3);
    const { table: t, events } = startAny(table('domino'), rng);
    expect(t.domino?.rules.players).toBe(4);
    expect(events[0]).toContain('الدومينو');
    const v = viewFor(t, 'u1');
    expect(v.kind).toBe('domino');
    expect(v.game).toBeNull();
    expect(v.domino!.hands[0]).toEqual(t.domino!.hands[0]);
    expect(v.domino!.hands[1].every((x) => x.a === 0 && x.b === 0)).toBe(true);
    expect(v.domino!.hands[1].length).toBe(t.domino!.hands[1].length);
    const done = playOut(t, rng);
    expect(done.domino!.phase).toBe('matchOver');
    expect(Math.max(...done.domino!.scores)).toBeGreaterThanOrEqual(100);
  });

  it('domino: the human plays a legal tile through parseDomino', () => {
    const rng = seededRng(5);
    let t = startAny(table('domino'), rng).table;
    // ننتظر دور المالك
    for (let i = 0; i < 50 && t.domino!.turn !== 0; i++) t = runAutoStep(t, nextAutoStep(t, rng)!, rng).table;
    expect(nextAutoStep(t, rng)).toBeNull();
    const tile = playable(t.domino!, 0)[0];
    if (tile) {
      const r = applyOther(t, parseDomino({ type: 'play', tile, side: 'right' }, 0)!, rng);
      expect(r.events[0]).toContain('مهند لعب');
    }
    expect(parseDomino({ type: 'play', tile: { a: 9, b: 1 } }, 0)).toBeNull();
  });

  it('jackaroo complex: starts with complex rules, bots finish, game over is announced', () => {
    const rng = seededRng(7);
    const { table: t } = startAny(table('jackaroo', 'complex'), rng);
    expect(t.jackaroo!.rules.complex).toBe(true);
    const v = viewFor(t, 'u1');
    expect(v.jackaroo!.hands[0]).toEqual(t.jackaroo!.hands[0]);
    expect(v.jackaroo!.deck.length).toBe(t.jackaroo!.deck.length);
    const done = playOut(t, rng);
    expect(done.jackaroo!.phase).toBe('over');
  });

  it('jackaroo: human move, leaving mid-game puts a bot, stop clears the game', () => {
    const rng = seededRng(11);
    let t = startAny(table('jackaroo'), rng).table;
    for (let i = 0; i < 50 && t.jackaroo!.turn !== 0; i++) t = runAutoStep(t, nextAutoStep(t, rng)!, rng).table;
    const mv = legalMoves(t.jackaroo!, 0)[0];
    if (mv) {
      const a = parseJackaroo({ type: 'play', card: mv.card, move: mv.move }, 0)!;
      t = applyOther(t, a, rng).table;
    }
    const r = leave(t, 'u1');
    expect(r.botReplaced).toBe(true);
    expect(r.table.seats[0]!.isBot).toBe(true);
    const stopped = stopGame(t);
    expect(stopped.jackaroo).toBeNull();
    expect(() => startAny(table('jackaroo'), rng)).not.toThrow();
  });
});
