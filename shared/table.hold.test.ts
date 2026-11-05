import { describe, expect, it } from 'vitest';
import { seededRng } from './baloot/testing';
import { DEAL_GAP_MS, DECISION_GAP_MS, addBot, applyWithEvents, holding, newTable, start, startAny, viewFor } from './table';

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

describe('مهلة التوزيع', () => {
  it('بعد التوزيع ثانية ونص ما يبدأ الدور: بلا أزرار و dealing، ثم يبدأ', () => {
    let t = newTable('t2', { uid: 'u1', username: 'مهند' }, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    const r = startAny(t, seededRng(4));
    const h = r.table.hold!;
    expect(h.deal).toBe(true);
    expect(h.seat).toBe(r.table.game!.turn);
    expect(h.until - Date.now()).toBeLessThanOrEqual(DEAL_GAP_MS);
    expect(holding(r.table)).toBe(true);
    const v = viewFor(r.table, 'u1').game!;
    expect(v.dealing).toBe(true);
    expect(v.actions.bids).toEqual([]);
    const after = viewFor({ ...r.table, hold: undefined }, 'u1').game!;
    expect(after.dealing).toBe(false);
    expect(after.turn).toBe(r.table.game!.turn);
  });
});

describe('المنقطع ما يبقى معلق', () => {
  it('مشاهد انقطع أثناء المباراة يخرج بعد المهلة', async () => {
    const { join, lobbyExpired, markLobbyAway } = await import('./table');
    const { SPECTATOR_LEAVE_AFTER_MS } = await import('./economy');
    let t = newTable('t1', { uid: 'u1', username: 'مهند' }, false, 0);
    t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
    t = start(t, seededRng(4));
    t = join(t, { uid: 'u9', username: 'زائر' }).table;
    const now = Date.now();
    t = markLobbyAway(t, 'u9', now);
    expect(lobbyExpired(t, now + SPECTATOR_LEAVE_AFTER_MS - 1000)).toEqual([]);
    expect(lobbyExpired(t, now + SPECTATOR_LEAVE_AFTER_MS)).toEqual(['u9']);
    // الجالس أثناء المباراة ما يخرج بهذي المهلة (له حجز المقعد)
    expect(markLobbyAway(t, 'u1', now).lobbyAway?.u1).toBeUndefined();
  });
});

describe('سوا', () => {
  it('يطلع بس لما يكون دورك تبدأ الأكلة وكل أوراقك مضمونة، ويحسب الأكلات الباقية لفريقك وينهي الصكة', async () => {
    const { nextAutoStep, runAutoStep } = await import('./table');
    const { canSawa, applyAction } = await import('./baloot/game');
    const { teamOf } = await import('./baloot/cards');
    let found = 0;
    for (let seed = 1; seed < 200 && found < 5; seed++) {
      let t = newTable('s', { uid: 'a', username: 'أحمد' }, false, 0);
      t = addBot(t, 1); t = addBot(t, 2); t = addBot(t, 3);
      t = { ...t, seats: t.seats.map((m, i) => (i === 0 ? { uid: 'bot-x', username: 'روبوت', isBot: true } : m)) };
      t = start(t, seededRng(seed));
      const rng = seededRng(seed + 7);
      for (let i = 0; i < 200 && t.game && !t.game.lastHand; i++) {
        const g = t.game!;
        if (g.phase === 'playing' && canSawa(g, g.turn)) {
          expect(g.trick.length).toBe(0);
          const seat = g.turn;
          const remaining = g.hands[seat].length;
          const before = [...g.tricksWon] as number[];
          const r = applyWithEvents(t, { type: 'sawa', seat }, seededRng(1));
          const after = r.table.game!;
          expect(after.lastHand).not.toBeNull();
          expect(after.tricksWon[teamOf(seat)] - before[teamOf(seat)]).toBe(remaining);
          expect(r.events.some((e) => e.includes('سوا'))).toBe(true);
          expect(r.events.some((e) => e.startsWith('انتهت الصكة'))).toBe(true);
          // اللي مو دوره ما يقدر يقول سوا
          expect(canSawa(g, ((seat + 1) % 4) as 0 | 1 | 2 | 3)).toBe(false);
          expect(() => applyAction(g, { type: 'sawa', seat: ((seat + 1) % 4) as 0 | 1 | 2 | 3 })).toThrow();
          found++;
          break;
        }
        const step = nextAutoStep(t, rng);
        if (!step) break;
        t = { ...runAutoStep(t, step, rng).table, hold: undefined };
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('إكة في الحكم', () => {
  it('أول ورقة غير حكم صارت الأكبر في نوعها (اللي فوقها نزل) تطلع صوت إكة، والإكة نفسها والحكم والصن لا', async () => {
    const { isBossLead } = await import('./table');
    const base = { phase: 'playing', trick: [], contract: { mode: 'hokm', trump: 'S', buyer: 0, qabaTo: 0 } } as unknown as Parameters<typeof isBossLead>[0];
    const hands = (cards: string[][]) => cards.map((h) => h.map((x) => ({ rank: x.slice(0, -1), suit: x.slice(-1) })));
    const g = { ...base, hands: hands([['KH', '7S'], ['9H'], ['8D'], ['QH']]) } as typeof base;
    expect(isBossLead(g, { rank: 'K', suit: 'H' } as never)).toBe(true); // الإكة والعشرة نزلوا
    const withTen = { ...g, hands: hands([['KH'], ['10H'], [], []]) } as typeof base;
    expect(isBossLead(withTen, { rank: 'K', suit: 'H' } as never)).toBe(false); // العشرة باقية
    expect(isBossLead({ ...g, hands: hands([['AH'], [], [], []]) } as typeof base, { rank: 'A', suit: 'H' } as never)).toBe(false); // الإكة نفسها
    expect(isBossLead(g, { rank: '7', suit: 'S' } as never)).toBe(false); // حكم
    expect(isBossLead({ ...g, trick: [{ seat: 3, card: { rank: '8', suit: 'H' } }] } as typeof base, { rank: 'K', suit: 'H' } as never)).toBe(false); // مو أول ورقة
    expect(isBossLead({ ...g, contract: { mode: 'sun', buyer: 0, qabaTo: 0 } } as typeof base, { rank: 'K', suit: 'H' } as never)).toBe(false); // صن
  });
});
