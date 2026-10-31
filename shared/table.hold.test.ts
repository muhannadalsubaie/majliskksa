import { describe, expect, it } from 'vitest';
import { seededRng } from './baloot/testing';
import { DECISION_GAP_MS, addBot, applyWithEvents, holding, newTable, start, viewFor } from './table';

describe('مهلة القرار', () => {
  it('بعد شراء صن يبقى الدور عند صاحبه ثانية ونص بلا أزرار، ثم ينتقل', () => {
    let t = newTable('t1', { uid: 'u1', username: 'مهند' }, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(4));
    const g = t.game!;
    const seat = g.turn;
    const now = Date.now();
    const r = applyWithEvents(t, { type: 'bid', seat, bid: { type: 'sun' } }, seededRng(1), now);
    expect(r.table.hold).toEqual({ until: now + DECISION_GAP_MS, seat });
    expect(holding(r.table, now + 1000)).toBe(true);
    expect(holding(r.table, now + DECISION_GAP_MS)).toBe(false);
    const v = viewFor(r.table, 'u1').game!;
    expect(v.turn).toBe(seat);
    expect(v.actions.bids).toEqual([]);
    expect(applyWithEvents(t, { type: 'bid', seat, bid: { type: 'pass' } }, seededRng(1), now).table.hold).toBeUndefined();
    expect(v.myHand.length).toBeGreaterThan(0);
    const after = viewFor({ ...r.table, hold: undefined }, 'u1').game!;
    expect(after.turn).toBe(r.table.game!.turn);
  });
});
