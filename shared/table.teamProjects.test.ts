import { describe, expect, it } from 'vitest';
import { newTable, join, startAny, applyWithEvents, type TableData } from './table';
import { availableBids, canDeclareProject, isDoublingTurn, legalCardsFor } from './baloot/game';
import type { Seat } from './baloot/cards';
import { seededRng, cards } from './baloot/testing';

/**
 * شريكين عندهم «خمسين» متساوية (لنفس الشايب): الاثنين ينحسبون، فلازم الاثنين ينعلنون في اللفة الأولى
 * وينكشفون في الثانية (كان مشروع الشريك الثاني يُحسب بس ما ينكشف).
 */
describe('equal projects of two partners', () => {
  it('both are announced and revealed', () => {
    const rng = seededRng(5);
    let t: TableData = newTable('x'.repeat(64), { uid: 'u0', username: 'a' }, false, 0);
    for (const i of [1, 2, 3]) t = join(t, { uid: 'u' + i, username: 'p' + i }).table;
    t = { ...startAny(t, rng).table, hold: undefined };
    // يدين بخمسين للشايب: المقعد 0 (هاص) وشريكه المقعد 2 (سبيت)، والخصوم بدون مشاريع
    const hands = [cards('KH QH JH 10H 7C 8D'), cards('7H 8H 9C 10C 7D 8S'), cards('KS QS JS 10S 7S 9D'), cards('AH 9H AC KC QC JC')];
    t = { ...t, game: { ...t.game!, hands: hands as NonNullable<TableData['game']>['hands'] } };
    let now = 10_000;
    const events: string[] = [];
    for (let step = 0; step < 60; step++) {
      const g = t.game!;
      if (g.phase === 'playing' && g.trickNo >= 2) break;
      if (!['bidding', 'waraq', 'doubling', 'playing'].includes(g.phase)) break;
      let seat: Seat = g.turn; let a: any;
      if (g.phase === 'waraq') a = { type: 'waraq', seat, call: false };
      else if (g.phase === 'bidding') { const b = availableBids(g, seat); a = { type: 'bid', seat, bid: b.find((x) => x.type === 'sun') ?? b.find((x) => x.type === 'pass')! }; }
      else if (g.phase === 'doubling') { const s2 = ([0, 1, 2, 3] as Seat[]).find((x) => isDoublingTurn(g, x)); if (s2 === undefined) break; seat = s2; a = { type: 'doublePass', seat }; }
      else if (canDeclareProject(g, seat)) a = { type: 'declareProject', seat };
      else { const l = legalCardsFor(g, seat); a = { type: 'play', seat, card: l[0] }; }
      const r = applyWithEvents(t, a, rng, now);
      events.push(...r.events);
      t = { ...r.table, hold: undefined }; now += 5000;
    }
    const g = t.game!;
    const partners = g.declared.filter((d) => d.seat === 0 || d.seat === 2);
    expect(partners.length).toBe(2);
    expect(events.filter((e) => /: مشروع خمسين/.test(e)).length).toBe(2);
    expect(events.filter((e) => e.startsWith('مشروع ') && e.includes('خمسين')).length).toBe(2);
  });
});
