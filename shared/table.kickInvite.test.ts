import { describe, expect, it } from 'vitest';
import { newTable, join, kick, addInvite, type TableData } from './table';

describe('المطرود يرجع بدعوة المالك', () => {
  it('بدون دعوة ينتظر ساعة، وبدعوة يدخل على طول', () => {
    let t: TableData = newTable('x'.repeat(64), { uid: 'u0', username: 'a' }, false, 0);
    t = join(t, { uid: 'u1', username: 'b' }).table;
    t = kick(t, 'u1', false, Math.random, 1000).table;
    expect(() => join(t, { uid: 'u1', username: 'b' }, undefined, 2000)).toThrow();
    t = addInvite(t, 'code1', undefined, 'u0');
    const back = join(t, { uid: 'u1', username: 'b' }, 'code1', 2000).table;
    expect(back.spectators.some((m) => m.uid === 'u1') || back.seats.some((m) => m?.uid === 'u1')).toBe(true);
    expect(back.kicked?.u1).toBeUndefined();
  });
});
