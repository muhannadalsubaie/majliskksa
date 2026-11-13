import { describe, expect, it } from 'vitest';
import { newTable, join, emptyPinned, pinnedPass, type TableData } from './table';

describe('الطاولة الثابتة بكلمة مرور', () => {
  it('بصمة كلمة المرور ثابتة لنفس الطاولة، وتختلف لطاولة ثانية أو كلمة ثانية', async () => {
    const a = await pinnedPass('t1', '1234');
    expect(await pinnedPass('t1', '1234')).toBe(a);
    expect(await pinnedPass('t2', '1234')).not.toBe(a);
    expect(await pinnedPass('t1', '12345')).not.toBe(a);
  });

  it('لما تفضى ترجع فاضية بنفس صاحبها ولعبتها وكلمة مرورها', async () => {
    let t: TableData = newTable('t1', { uid: 'owner', username: 'سيف' }, false, 0, 'domino', 't150');
    t = { ...t, pinned: { owner: 'owner', ownerName: 'سيف', pass: await pinnedPass('t1', '1234') }, ownerUid: 'other' };
    const e = emptyPinned(t);
    expect(e.seats).toEqual([null, null, null, null]);
    expect(e.spectators).toEqual([]);
    expect(e.ownerUid).toBe('owner');
    expect(e.kind).toBe('domino');
    expect(e.variant).toBe('t150');
    expect(e.pinned?.pass).toBe(t.pinned!.pass);
  });

  it('صاحبها يرجع مالكها لما يدخل', async () => {
    let t: TableData = emptyPinned({ ...newTable('t1', { uid: 'owner', username: 'سيف' }, false, 0), pinned: { owner: 'owner', ownerName: 'سيف', pass: 'x' } });
    t = join(t, { uid: 'guest', username: 'ضيف' }).table;
    t = { ...t, ownerUid: 'guest' };
    t = join(t, { uid: 'owner', username: 'سيف' }).table;
    expect(t.ownerUid).toBe('owner');
  });
});
