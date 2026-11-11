import { describe, expect, it } from 'vitest';
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

it('reveals a project in the second trick as soon as it is its owner\'s turn, before they play, and holds the turn', async () => {
  const { addBot, nextAutoStep, runAutoStep, REVEAL_GAP_MS } = await import('./table');
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
      const now = Date.now();
      const r = runAutoStep(t, step, rng);
      const reveal = r.events.findIndex((e) => e.startsWith('مشروع ') && e.includes('—'));
      if (reveal >= 0) {
        const g = r.table.game!;
        expect(g.trickNo).toBe(1); // اللفة الثانية
        const owner = r.table.seats[g.turn]!.username;
        expect(r.events[reveal]).toContain(owner); // دوره الحين
        expect(g.trick.some((p) => p.seat === g.turn)).toBe(false); // قبل ما يلعب
        expect(r.table.hold?.seat).toBe(g.turn);
        expect(r.table.hold!.until - now).toBeGreaterThanOrEqual(REVEAL_GAP_MS);
        // أوراق المشروع ظاهرة في العرض من الحين
        const v = viewFor(r.table, 'b').game!;
        expect(v.declared.find((d) => d.seat === g.turn)?.faces?.length).toBeGreaterThan(0);
        found = true;
      }
      t = { ...r.table, hold: undefined };
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

describe('lobby cleanup', () => {
  it('a member who stays disconnected outside a match leaves the table after the timeout', async () => {
    const { newTable, join, markLobbyAway, markLobbyBack, lobbyExpired, sweepLobbyGhosts, nextLobbyDeadline } = await import('./table');
    const { LOBBY_LEAVE_AFTER_MS } = await import('./economy');
    let t = newTable('t1', { uid: 'o', username: 'مهند' }, false, 0);
    t = join(t, { uid: 'g', username: 'ضيف' }).table;
    // الضيف انقطع قبل وجود الميزة: يلتقطه الفحص عند دخول أي أحد
    t = sweepLobbyGhosts(t, new Set(['o']), 1000);
    expect(t.lobbyAway).toEqual({ g: 1000 });
    expect(nextLobbyDeadline(t)).toBe(1000 + LOBBY_LEAVE_AFTER_MS);
    expect(lobbyExpired(t, 1000 + LOBBY_LEAVE_AFTER_MS - 1)).toEqual([]);
    expect(lobbyExpired(t, 1000 + LOBBY_LEAVE_AFTER_MS)).toEqual(['g']);
    // عاد قبل المهلة: لا يخرج
    expect(lobbyExpired(markLobbyBack(t, 'g'), 1e12)).toEqual([]);
    // لا تتكرر المهلة لنفس الشخص
    expect(markLobbyAway(t, 'g', 5000)).toBe(t);
  });
});
