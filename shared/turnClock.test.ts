import { describe, expect, it } from 'vitest';
import { newTable, join, startAny, applyWithEvents, viewFor, type TableData } from './table';
import { seededRng } from './baloot/testing';
import { refreshClock, timeoutAction, validTurnLimit } from './turnClock';

function table(limit: number): TableData {
  const rng = seededRng(7);
  let t: TableData = newTable('x'.repeat(64), { uid: 'u0', username: 'a' }, false, 0);
  for (const i of [1, 2, 3]) t = join(t, { uid: 'u' + i, username: 'p' + i }).table;
  return { ...startAny({ ...t, turnLimit: limit }, rng).table, hold: undefined };
}

describe('turn clock', () => {
  it('only the menu values are accepted', () => {
    expect(validTurnLimit(30)).toBe(30);
    expect(validTurnLimit(0)).toBe(0);
    expect(validTurnLimit(15)).toBeNull();
    expect(validTurnLimit('30')).toBeNull();
  });

  it('no limit: no clock', () => {
    const t = refreshClock(table(0), 1000);
    expect(t.clock).toBeUndefined();
    expect(viewFor(t, 'u0').clock).toEqual({ limit: 0, seat: null, remainingMs: null });
  });

  it('starts a clock for the player whose turn it is, and the bot plays when it runs out', () => {
    const rng = seededRng(3);
    let t = refreshClock(table(10), 1000);
    expect(t.clock?.seat).toBe(t.game!.turn);
    expect(t.clock?.deadline).toBe(11_000);
    // ما خلص الوقت
    expect(timeoutAction(t, 5000)).toBeNull();
    // نفس الدور: نفس الوقت
    expect(refreshClock(t, 5000).clock?.deadline).toBe(11_000);
    // خلص الوقت: حركة الروبوت عن صاحب الدور
    const a = timeoutAction(t, 11_000);
    expect(a?.game).toBe('baloot');
    const seat = t.game!.turn;
    expect((a!.action as { seat: number }).seat).toBe(seat);
    const r = applyWithEvents(t, a!.action as Parameters<typeof applyWithEvents>[1], rng, 11_000);
    t = refreshClock({ ...r.table, hold: undefined }, 11_000);
    // الدور تغيّر: وقت جديد لللي بعده
    expect(t.clock?.seat).not.toBe(seat);
    expect(t.clock?.deadline).toBe(21_000);
  });

  it('the clock starts after the display hold ends', () => {
    const t = refreshClock({ ...table(20), hold: { until: 5000, seat: 0 } }, 1000);
    expect(t.clock?.deadline).toBe(25_000);
  });
});
