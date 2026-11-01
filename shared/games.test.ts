import { describe, expect, it } from 'vitest';
import { seededRng } from './baloot/testing';
import { applyOther, gameTitle, parseDomino, parseJackaroo, parseLudo } from './games';
import { addBot, leave, newTable, nextAutoStep, runAutoStep, startAny, stopGame, viewFor, type TableData } from './table';
import { playable } from './domino/engine';
import { legalMoves } from './jackaroo/engine';

const owner = { uid: 'u1', username: 'مهند' };

function table(kind: 'domino' | 'jackaroo' | 'ludo', variant: 'classic' | 'complex' | 'teams' = 'classic'): TableData {
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

  it('ludo: solo and teams start, bots finish, nothing hidden', () => {
    for (const variant of ['classic', 'teams'] as const) {
      const rng = seededRng(13);
      const { table: t, events } = startAny(table('ludo', variant), rng);
      expect(t.ludo!.rules.teams).toBe(variant === 'teams');
      expect(events[0]).toContain('لودو');
      expect(viewFor(t, 'u1').ludo).toEqual(t.ludo);
      const done = playOut(t, rng);
      expect(done.ludo!.phase).toBe('over');
      expect(done.ludo!.winner).not.toBeNull();
    }
    expect(gameTitle('ludo', 'teams')).toBe('لودو فرق');
  });

  it('ludo: the human rolls (roll announced alone), single choice moves automatically', () => {
    const rng = seededRng(21);
    let t = startAny(table('ludo'), rng).table;
    t = { ...t, ludo: { ...t.ludo!, turn: 0, tokens: [[10, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] } };
    // نرد ثابت 3: حجر واحد فقط يتحرك (البقية في البيت)
    const three = () => 0.25 + 2 * 0.15 + 0.01;
    const r = applyOther(t, parseLudo({ type: 'roll' }, 0)!, three);
    expect(r.events).toEqual(['مهند رمى ثلاثة']);
    const step = nextAutoStep(r.table, rng);
    expect(step?.kind).toBe('other');
    const moved = runAutoStep(r.table, step!, rng);
    expect(moved.table.ludo!.tokens[0][0]).toBe(13);
    expect(moved.events[0]).toBe('حجر مهند 1 يتقدم ثلاثة');
    expect(parseLudo({ type: 'move', token: 'x' }, 0)).toBeNull();
  });
});


describe('native app helpers (ui)', () => {
  it('each game view carries moves and texts for the viewer', () => {
    for (const kind of ['domino', 'jackaroo', 'ludo'] as const) {
      const rng = seededRng(5);
      let t = startAny(table(kind), rng).table;
      // نوصل لدور المالك
      for (let i = 0; i < 400; i++) {
        const v = viewFor(t, 'u1');
        if ((v.ui as { myTurn: boolean }).myTurn) break;
        const step = nextAutoStep(t, rng);
        if (!step) break;
        t = runAutoStep(t, step, rng).table;
      }
      const ui = viewFor(t, 'u1').ui as unknown as Record<string, unknown>;
      expect(ui).toBeTruthy();
      expect(typeof ui.prompt).toBe('string');
      if (kind === 'jackaroo') {
        const hand = ui.hand as { usable: boolean; moves: { text: string }[] }[];
        expect(hand.length).toBeGreaterThan(0);
        expect(hand.some((h) => h.usable)).toBe(true);
      }
      if (kind === 'domino') expect((ui.hand as unknown[]).length).toBeGreaterThan(0);
      if (kind === 'ludo') expect(ui.boardText).toContain('أحجارك');
    }
  });
});

describe('player counts and changing the game', () => {
  it('domino with 2 players, ludo with 3, and the owner switching games', async () => {
    const { changeGame, canStart } = await import('./table');
    let d = newTable('t1', owner, false, 0, 'domino', 'classic');
    d = addBot(d, 2);
    expect(canStart(d)).toBe(true);
    const ds = startAny(d, seededRng(1)).table;
    // الدومينو أربعة دائماً: المقاعد الفاضية تكتمل بروبوتات
    expect(ds.domino!.rules.players).toBe(4);
    expect(ds.seats.every(Boolean)).toBe(true);
    let l = newTable('t2', owner, false, 0, 'ludo', 'classic');
    l = addBot(l, 1); l = addBot(l, 3);
    const ls = startAny(l, seededRng(2)).table;
    expect(ls.ludo!.seats).toEqual([0, 1, 2]);
    expect(ls.seats[2]?.isBot).toBe(true);
    let b = newTable('t3', owner, false, 0, 'domino', 'classic');
    b = addBot(b, 1);
    expect(canStart(b)).toBe(true);
    b = addBot(b, 2);
    expect(canStart(b)).toBe(true);
    const c = changeGame(ds, 'jackaroo', 'complex');
    expect(c.kind).toBe('jackaroo');
    expect(c.domino).toBeNull();
    expect(c.seats.filter(Boolean).length).toBe(4);
  });
});
