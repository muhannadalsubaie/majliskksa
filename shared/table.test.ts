import { describe, expect, it } from 'vitest';
import { seededRng } from './baloot/testing';
import { HAND_TOTAL, SUN_ABNAT_MULTIPLIER } from './baloot/cards';
import { addBot, join, leave, newTable, nextAutoStep, runAutoStep, start, TableError, viewFor, type TableData } from './table';

const owner = { uid: 'u1', username: 'مهند' };

function botsTable(seed: number): TableData {
  let t = newTable('t1', owner, false, 0);
  t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
  // المالك نفسه يصبح روبوتاً للمحاكاة الكاملة
  t = { ...t, seats: t.seats.map((m, i) => (i === 0 ? { uid: 'bot-x', username: 'روبوت', isBot: true } : m)) };
  return start(t, seededRng(seed));
}

describe('table', () => {
  it('join: seats first, then spectators; charged once', () => {
    let t = newTable('t1', owner, false, 0);
    const r1 = join(t, { uid: 'u2', username: 'أحمد' });
    expect(r1.charge).toBe(true);
    t = r1.table;
    expect(t.seats[1]?.username).toBe('أحمد');
    expect(join(t, { uid: 'u2', username: 'أحمد' }).charge).toBe(false);
    t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(1));
    t = join(t, { uid: 'u5', username: 'سعد' }).table;
    expect(t.spectators.map((m) => m.username)).toEqual(['سعد']);
    // المشاهد يغادر ويعود: لا يُخصم مرة أخرى
    t = leave(t, 'u5').table;
    expect(join(t, { uid: 'u5', username: 'سعد' }).charge).toBe(false);
  });

  it('cannot start until 4 seats are filled', () => {
    const t = newTable('t1', owner, false, 0);
    expect(() => start(t, seededRng(1))).toThrow(TableError);
  });

  it('player leaving mid-game is replaced by a bot', () => {
    let t = newTable('t1', owner, false, 0);
    t = join(t, { uid: 'u2', username: 'أحمد' }).table;
    t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(2));
    const r = leave(t, 'u2');
    expect(r.botReplaced).toBe(true);
    expect(r.table.seats[1]?.isBot).toBe(true);
  });

  it('view hides other hands', () => {
    let t = newTable('t1', owner, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(3));
    const v = viewFor(t, 'u1');
    expect(v.mySeat).toBe(0);
    expect(v.game!.myHand).toHaveLength(5);
    expect(v.game!.handCounts).toEqual([5, 5, 5, 5]);
    expect(JSON.stringify(v)).not.toContain('"hands"');
    const spectator = viewFor(t, 'someone-else');
    expect(spectator.game!.myHand).toEqual([]);
    expect(spectator.game!.actions.legal).toEqual([]);
  });

  it('four bots play full matches to the end', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seededRng(seed);
      let t = botsTable(seed);
      let steps = 0;
      const events: string[] = [];
      while (t.game!.phase !== 'matchOver') {
        const step = nextAutoStep(t, rng);
        expect(step, `seed ${seed}: stuck at ${t.game!.phase}`).not.toBeNull();
        const r = runAutoStep(t, step!, rng);
        if (r.table.game!.lastHand && !t.game!.lastHand) {
          const g = r.table.game!;
          const total = (g.cardAbnat[0] + g.cardAbnat[1]) * (g.contract!.mode === 'sun' ? SUN_ABNAT_MULTIPLIER : 1);
          expect(total).toBe(HAND_TOTAL[g.contract!.mode]);
        }
        t = r.table;
        events.push(...r.events);
        if (++steps > 20000) throw new Error(`seed ${seed}: too many steps`);
      }
      expect(events.at(-1)).toMatch(/^انتهت المباراة — فاز/);
    }
  });

  it('bots wait for the human whose turn it is', () => {
    let t = newTable('t1', owner, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(4)); // dealer 0 → seat 1 bids first (bot)
    const rng = seededRng(4);
    let guard = 0;
    while (t.game!.turn !== 0 || t.game!.phase !== 'bidding') {
      const step = nextAutoStep(t, rng);
      if (!step) break;
      t = runAutoStep(t, step, rng).table;
      if (++guard > 50) break;
    }
    if (t.game!.phase === 'bidding' && t.game!.turn === 0) expect(nextAutoStep(t, rng)).toBeNull();
  });
});
