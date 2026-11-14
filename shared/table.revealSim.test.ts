import { it, expect } from 'vitest';
import { newTable, join, startAny, applyWithEvents, nextAutoStep, runAutoStep, stampMatchOptions, holding, type TableData } from './table';
import { seededRng } from './baloot/testing';

it('محاكاة: ما تعلق اللعبة عند كشف المشاريع', () => {
  let stuck = 0, reveals = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seededRng(seed);
    let t: TableData = newTable('x'.repeat(64), { uid: 'u0', username: 'a' }, false, 0);
    for (const i of [1, 2, 3]) t = join(t, { uid: 'u' + i, username: 'p' + i }).table;
    t = { ...t, seats: t.seats.map((m) => m && { ...m, isBot: true }) };
    t = stampMatchOptions(startAny(t, rng).table);
    let now = 1_000_000;
    for (let step = 0; step < 400 && t.game && t.game.phase !== 'matchOver'; step++) {
      if (t.hold) { if (!holding(t, now)) { const { hold: _h, ...r } = t; void _h; t = r; } else { now = t.hold.until + 1; continue; } }
      const s = nextAutoStep(t, rng);
      if (!s) { stuck++; break; }
      const before = t.game.trickNo;
      const r = runAutoStep(t, s, rng, now);
      t = stampMatchOptions(r.table);
      if (r.events.some((e) => e.startsWith('مشروع'))) reveals++;
      now += 100;
      void before;
    }
  }
  console.log('reveals', reveals);
  expect(stuck).toBe(0);
});
