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

it('reveals a project in the second trick, right after its owner plays', async () => {
  const { addBot, nextAutoStep, runAutoStep } = await import('./table');
  let found = false;
  for (let seed = 1; seed < 60 && !found; seed++) {
    let t = newTable('t', { uid: 'a', username: 'أحمد' }, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    t = { ...t, seats: t.seats.map((m, i) => (i === 0 ? { uid: 'bot-x', username: 'روبوت', isBot: true } : m)) };
    t = start(t, seededRng(seed));
    const rng = seededRng(seed + 100);
    for (let i = 0; i < 80 && t.game && t.game.trickNo < 2; i++) {
      const step = nextAutoStep(t, rng);
      if (!step) break;
      const before = t.game!.trickNo;
      const r = runAutoStep(t, step, rng);
      const reveal = r.events.findIndex((e) => e.startsWith('مشروع ') && e.includes('—'));
      if (reveal >= 0) {
        expect(before).toBe(1); // اللفة الثانية
        expect(step.kind).toBe('bot');
        const owner = t.seats[(step as { seat: number }).seat]!.username;
        expect(r.events[reveal]).toContain(owner);
        expect(r.events[reveal - 1].startsWith(`${owner}: `)).toBe(true); // بعد ورقته مباشرة
        found = true;
      }
      t = r.table;
    }
  }
  expect(found).toBe(true);
});

it('passes ownership to a seated player, or a spectator, when the owner leaves', async () => {
  const { leave } = await import('./table');
  const t = playing(); // المالك a، والجالسون b c d، والمشاهد e
  const r = leave(t, 'a', seededRng(3));
  expect(r.table.ownerUid).toBe('b');
  expect(r.newOwner).toBe('بدر');
  let lobby = newTable('t', { uid: 'a', username: 'أحمد' }, false, 0);
  lobby = { ...lobby, spectators: [{ uid: 'z', username: 'زياد', isBot: false }] };
  expect(leave(lobby, 'a').table.ownerUid).toBe('z');
});
