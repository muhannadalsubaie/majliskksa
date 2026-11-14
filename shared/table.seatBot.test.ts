import { describe, expect, it } from 'vitest';
import { newTable, join, startAny, seatBot, type TableData } from './table';
import { seededRng } from './baloot/testing';

describe('المالك يحط روبوت مكان لاعب', () => {
  it('أثناء اللعب: الروبوت ياخذ المقعد وأوراقه، واللاعب يصير مشاهد', () => {
    const rng = seededRng(3);
    let t: TableData = newTable('x'.repeat(64), { uid: 'u0', username: 'a' }, false, 0);
    for (const i of [1, 2, 3]) t = join(t, { uid: 'u' + i, username: 'p' + i }).table;
    t = startAny(t, rng).table;
    const hand = t.game!.hands[2];
    const next = seatBot(t, 2, rng);
    expect(next.seats[2]!.isBot).toBe(true);
    expect(next.spectators.some((m) => m.uid === 'u2')).toBe(true);
    expect(next.game!.hands[2]).toEqual(hand);
    expect(seatBot(next, 2, rng)).toBe(next);
  });
});
