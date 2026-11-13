import { describe, expect, it } from 'vitest';
import { newTable, join, startAny, applyWithEvents, stampMatchOptions, type TableData } from './table';
import { availableBids, canDeclareProject, canWaraq, isDoublingTurn, legalCardsFor } from './baloot/game';
import { botAction } from './baloot/bot';
import { timeoutAction, refreshClock } from './turnClock';
import type { Seat } from './baloot/cards';
import { seededRng, cards } from './baloot/testing';

/** طاولة بلوت بدأت، والمقعد 0 معه خمسين (شايب هاص) */
function table(opts: Partial<TableData>): { t: TableData; rng: () => number } {
  const rng = seededRng(5);
  let t: TableData = newTable('x'.repeat(64), { uid: 'u0', username: 'a' }, false, 0);
  for (const i of [1, 2, 3]) t = join(t, { uid: 'u' + i, username: 'p' + i }).table;
  t = { ...startAny({ ...t, ...opts }, rng).table, hold: undefined };
  const hands = [cards('KH QH JH 10H 7C 8D'), cards('7H 8H 9C 10C 7D 8S'), cards('KS QS JS 9S 7S 9D'), cards('AH 9H AC KC QC JC')];
  t = stampMatchOptions({ ...t, game: { ...t.game!, hands: hands as NonNullable<TableData['game']>['hands'] } });
  return { t, rng };
}

/** نمشي المزايدة لين يبدأ اللعب والدور عند المقعد 0 */
function toPlay(t: TableData, rng: () => number): TableData {
  let now = 10_000;
  for (let step = 0; step < 40; step++) {
    const g = t.game!;
    if (g.phase === 'playing') break;
    let seat: Seat = g.turn; let a: any;
    if (g.phase === 'waraq') a = { type: 'waraq', seat, call: false };
    else if (g.phase === 'bidding') { const b = availableBids(g, seat); a = { type: 'bid', seat, bid: b.find((x) => x.type === 'sun') ?? b.find((x) => x.type === 'pass')! }; }
    else { const s2 = ([0, 1, 2, 3] as Seat[]).find((x) => isDoublingTurn(g, x))!; seat = s2; a = { type: 'doublePass', seat }; }
    t = stampMatchOptions({ ...applyWithEvents(t, a, rng, now).table, hold: undefined }); now += 5000;
  }
  return t;
}

describe('خيارات الباقة الاحترافية في البلوت', () => {
  it('إعلان المشاريع يدوي: اللي يلعب ورقته بدون ما يعلن يروح عليه مشروعه', () => {
    const { t: t0, rng } = table({ manualProjects: true });
    let t = toPlay(t0, rng);
    const g = t.game!;
    expect(g.manualProjects).toBe(true);
    const seat = ([0, 2] as Seat[]).find((s) => g.turn === s || canDeclareProject({ ...g, turn: s }, s))!;
    // نخلي الدور عند صاحب المشروع ونلعب ورقته بدون إعلان
    t = { ...t, game: { ...g, turn: seat } };
    expect(canDeclareProject(t.game!, seat)).toBe(true);
    const r = applyWithEvents(t, { type: 'play', seat, card: legalCardsFor(t.game!, seat)[0] }, rng, 99_000);
    expect(r.table.game!.declared.some((d) => d.seat === seat)).toBe(false);
  });

  it('بدون الخيار: المشروع ينعلن تلقائياً مع أول ورقة', () => {
    const { t: t0, rng } = table({});
    let t = toPlay(t0, rng);
    const g = t.game!;
    const seat = ([0, 2] as Seat[]).find((s) => canDeclareProject({ ...g, turn: s }, s))!;
    t = { ...t, game: { ...g, turn: seat } };
    const r = applyWithEvents(t, { type: 'play', seat, card: legalCardsFor(t.game!, seat)[0] }, rng, 99_000);
    expect(r.table.game!.declared.some((d) => d.seat === seat)).toBe(true);
  });

  it('إعلان يدوي: الروبوت يعلن مشروعه قبل ورقته، واللي خلص وقته ما ينعلن عنه', () => {
    const { t: t0, rng } = table({ manualProjects: true, turnLimit: 10 });
    let t = toPlay(t0, rng);
    const g = t.game!;
    const seat = ([0, 2] as Seat[]).find((s) => canDeclareProject({ ...g, turn: s }, s))!;
    t = { ...t, game: { ...g, turn: seat } };
    expect(botAction(t.game!, seat)).toEqual({ type: 'declareProject', seat });
    const clocked = refreshClock({ ...t, clock: undefined }, 1000);
    const out = timeoutAction(clocked, clocked.clock!.deadline + 1);
    expect(out?.action.type).toBe('play');
  });

  it('زر «ورق» للمشترك متاح حتى لو مو دوره، ولغير المشترك في دوره بس', () => {
    const { t } = table({ proSeats: [1] });
    const g0 = t.game!;
    // المقعد 1 معه ورق (كل أوراقه 7 و8 و9)، والدور مو عنده
    const waraqHand = cards('7H 8H 9C 7D 8S');
    const hands = g0.hands.map((h, i) => (i === 1 ? waraqHand : h.slice(0, 5))) as typeof g0.hands;
    const turn = ([0, 2, 3] as Seat[])[0];
    const g = { ...g0, hands, turn };
    expect(g.phase).toBe('bidding');
    expect(canWaraq({ ...g, waraqFree: [1] }, 1)).toBe(true);
    expect(canWaraq({ ...g, waraqFree: [] }, 1)).toBe(false);
  });
});
