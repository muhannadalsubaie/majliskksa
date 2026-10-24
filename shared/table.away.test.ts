import { expect, it } from 'vitest';
import { seededRng } from './baloot/testing';
import { BOT_REPLACE_AFTER_MS } from './economy';
import { assignSeat, awayExpired, join, markAway, markBack, newTable, nextAwayDeadline, replaceWithBot, seatOf, start, viewFor } from './table';

function playing() {
  let t = newTable('t', { uid: 'a', username: 'أحمد' }, false, 0);
  t = join(t, { uid: 'b', username: 'بدر' }).table;
  t = join(t, { uid: 'c', username: 'خالد' }).table;
  t = join(t, { uid: 'd', username: 'دحيم' }).table;
  t = join(t, { uid: 'e', username: 'عمر' }).table; // مشاهد
  return start(t, seededRng(1));
}

it('holds a disconnected player seat for three minutes, then a bot takes it', () => {
  let t = markAway(playing(), 'b', 1000);
  expect(viewFor(t, 'a').seats[seatOf(t, 'b')!]).toMatchObject({ username: 'بدر', away: true, awayUntil: 1000 + BOT_REPLACE_AFTER_MS });
  expect(nextAwayDeadline(t)).toBe(1000 + BOT_REPLACE_AFTER_MS);
  expect(awayExpired(t, 1000 + BOT_REPLACE_AFTER_MS - 1)).toEqual([]);
  expect(awayExpired(t, 1000 + BOT_REPLACE_AFTER_MS)).toEqual(['b']);

  const seat = seatOf(t, 'b')!;
  t = replaceWithBot(t, 'b', seededRng(2));
  expect(t.seats[seat]?.isBot).toBe(true);
  expect(t.spectators.map((m) => m.uid)).toContain('b'); // يبقى مشاهداً ويمكن إعادته
  expect(t.away).toEqual({});
});

it('returning in time keeps the seat; the owner can seat a spectator instead', () => {
  let t = markAway(playing(), 'c', 0);
  expect(markBack(t, 'c').away).toEqual({});
  const seat = seatOf(t, 'c')!;
  t = assignSeat(t, seat, 'e');
  expect(t.seats[seat]?.uid).toBe('e');
  expect(t.away).toEqual({});
  expect(t.spectators.map((m) => m.uid)).toContain('c');
});

it('does not hold seats outside a running match', () => {
  const lobby = newTable('t', { uid: 'a', username: 'أحمد' }, false, 0);
  expect(markAway(lobby, 'a', 0)).toBe(lobby);
});
