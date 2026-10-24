import { expect, it } from 'vitest';
import { join, leave, newTable, viewFor, withoutVoice } from './table';

it('lists voice members in the view and drops them when they leave', () => {
  let t = newTable('t1', { uid: 'a', username: 'أحمد' }, false, 0);
  t = join(t, { uid: 'b', username: 'بدر' }).table;
  t = { ...t, voice: { a: { sessionId: 's-a', muted: true }, b: { sessionId: 's-b', muted: false } } };
  expect(viewFor(t, 'a').voice).toEqual([
    { uid: 'a', username: 'أحمد', sessionId: 's-a', muted: true },
    { uid: 'b', username: 'بدر', sessionId: 's-b', muted: false },
  ]);
  expect(Object.keys(leave(t, 'b').table.voice ?? {})).toEqual(['a']);
  expect(withoutVoice(t, 'a').voice).toEqual({ b: { sessionId: 's-b', muted: false } });
});
