import { describe, expect, it } from 'vitest';
import { applyAction, canShowProject, declarableKinds, playableCardsFor, qaidTargets, sawaAvailable, type GameState } from './game';
import { projectFromCards } from './projects';
import { botAction } from './bot';
import { cards } from './testing';
import type { Card, Seat } from './cards';

/** صكة حكم سبيت (المشتري 0)، الدور على المقعد 0، القيد مفعّل */
function hokm(hands: string[], extra: Partial<GameState> = {}): GameState {
  const h = hands.map(cards) as Card[][];
  return {
    phase: 'playing', dealer: 3, scores: [0, 0], turn: 0, hands: h, qaba: null, stock: [], bidRound: 1, bidsInRound: 0,
    hokmBid: null, secondHokm: null, sunClaim: null,
    contract: { mode: 'hokm', trump: 'S', buyer: 0, qabaTo: 0 },
    doubling: { level: 1, gahwa: false, locked: false, doublerTeam: null, awaitingTeam: null, passed: [], doubler: null, awaitingSeat: null },
    initialHands: h.map((x) => [...x]), declared: [], projects: null, balootSeat: null, trick: [], lastTrick: null, trickNo: 0,
    tricksWon: [0, 0], cardAbnat: [0, 0], lastHand: null, outcome: { status: 'ongoing' }, qaid: true, ...extra,
  };
}
const play = (s: GameState, seat: Seat, c: string) => applyAction(s, { type: 'play', seat, card: cards(c)[0] });

describe('القيد والقطع', () => {
  const H = ['AH 7C 8D 9D', 'KH 7H AC 8C', 'QH 9H 10C JC', 'JH 8H KC QC'];

  it('اللعب حر: تقدر تلعب أي ورقة، والغلط ينسجل سرياً', () => {
    let s = hokm(H);
    s = play(s, 0, 'AH');
    expect(playableCardsFor(s, 1)).toHaveLength(4);
    s = play(s, 1, 'AC'); // معه هاص ولعب كلفس: قاطع
    expect(s.fouls).toEqual([{ seat: 1, kind: 'revoke', trickNo: 0 }]);
  });

  it('تسجيلة صحيحة: الصكة كاملة لفريق المسجّل', () => {
    let s = hokm(H);
    s = play(s, 0, 'AH');
    s = play(s, 1, 'AC');
    expect(qaidTargets(s, 0)).toEqual([1, 3]);
    s = applyAction(s, { type: 'qaid', seat: 0, target: 1, kind: 'revoke' });
    expect(s.qaidResult).toMatchObject({ correct: true });
    expect(s.lastHand!.points).toEqual([16, 0]);
    expect(s.trickNo).toBe(8);
  });

  it('تسجيلة غلط: الصكة كاملة للفريق الثاني', () => {
    let s = hokm(H);
    s = play(s, 0, 'AH');
    s = play(s, 1, 'KH');
    s = applyAction(s, { type: 'qaid', seat: 0, target: 1, kind: 'revoke' });
    expect(s.qaidResult).toMatchObject({ correct: false });
    expect(s.lastHand!.points).toEqual([0, 16]);
  });

  it('ما تسجّل على شريكك', () => {
    const s = hokm(H);
    expect(() => applyAction(s, { type: 'qaid', seat: 0, target: 2, kind: 'revoke' })).toThrow();
  });

  it('مشروع: تعلن النوع، وتفرش الأوراق في اللفة الثانية؛ الفرش الغلط يتسجّل', () => {
    const hands = ['AH KH QH 7C 8D', '7H 8H AC 8C 9C', '9H 10H 10C JC 7D', 'JH 7S KC QC 9D'];
    let s = hokm(hands, { manualProjects: true });
    expect(declarableKinds(s, 0)).toContain('sira');
    s = applyAction(s, { type: 'declareKind', seat: 0, kind: 'sira' });
    for (const [seat, c] of [[0, '7C'], [1, '8C'], [2, '10C'], [3, 'KC']] as [Seat, string][]) s = play(s, seat, c);
    expect(s.trickNo).toBe(1);
    const lead = s.turn;
    expect(canShowProject(s, 0)).toBe(true);
    s = applyAction(s, { type: 'showProject', seat: 0, cards: cards('AH KH 8D') });
    expect(s.qaidProjects![0]).toMatchObject({ shown: true, ok: false });
    const opp: Seat = lead === 1 || lead === 3 ? lead : 1;
    s = applyAction(s, { type: 'qaid', seat: opp, target: 0, kind: 'badProject' });
    expect(s.qaidResult!.correct).toBe(true);
  });

  it('فرش صح ينحسب المشروع', () => {
    const s0 = hokm(['AH KH QH 7C', '7H 8H AC 8C', '9H 10H 10C JC', 'JH 7S KC QC'], { manualProjects: true });
    let s = applyAction(s0, { type: 'declareKind', seat: 0, kind: 'sira' });
    for (const [seat, c] of [[0, '7C'], [1, '8C'], [2, '10C'], [3, 'KC']] as [Seat, string][]) s = play(s, seat, c);
    s = applyAction(s, { type: 'showProject', seat: 0, cards: cards('QH AH KH') });
    expect(s.qaidProjects![0]).toMatchObject({ shown: true, ok: true });
    expect(s.declared).toHaveLength(1);
  });

  it('سوا مع القيد: الزر يطلع كل ما تبدأ الأكلة، وسوا الغلط تنمسك', () => {
    const s = hokm(H);
    expect(sawaAvailable(s, 0)).toBe(true);
    const r = applyAction(s, { type: 'qaid', seat: 1, target: 0, kind: 'badSawa', sawaSeat: 0 });
    expect(r.qaidResult!.correct).toBe(true);
    expect(sawaAvailable({ ...s, noSawa: true }, 0)).toBe(false);
  });

  it('الروبوت ما يغلط: يعلن مشروعه ويلعب الورق المسموح بس', () => {
    const s = hokm(['AH KH QH 7C', '7H 8H AC 8C', '9H 10H 10C JC', 'JH 7S KC QC'], { manualProjects: true });
    expect(botAction(s, 0)).toEqual({ type: 'declareKind', seat: 0, kind: 'sira' });
  });

  it('القيد ياخذ مشاريع الفريق اللي ياخذه بس: مشروع المشتري المقيّد ما ينحسب للخصم', () => {
    // المشتري (0) عنده سرا ومفروشة، والخصم (1) عنده سرا معلنة. المشتري قطع، والخصم سجّل عليه
    const base = hokm(['AH KH QH 7C 8D', '7H JC 10C 9C 8S', '9H 10H AC 7D 9S', 'JH 7S KC QC 9D'], { manualProjects: true });
    let s = applyAction(base, { type: 'declareKind', seat: 0, kind: 'sira' });
    s = play(s, 0, '7C');
    s = applyAction(s, { type: 'declareKind', seat: 1, kind: 'sira' });
    s = play(s, 1, '7H'); // معه كلفس ولعب هاص: قاطع
    s = applyAction(s, { type: 'qaid', seat: 1, target: 0, kind: 'noTrump' }); // نوع غلط: القيد على المسجّل
    expect(s.qaidResult!.correct).toBe(false);
    // القيد للمشتري: ١٦ + سرّاه (٢)، وسرا الخصم ما تنحسب
    expect(s.lastHand!.points).toEqual([18, 0]);
  });

  it('المشروع الأضعف ينلغي وما ينفرش (سرا مقابل سرا: الأعلى ورقة يفوز)', () => {
    const base = hokm(['AH KH QH 7S', '9C 8C 7C 8S', '9H 10H 10C JC', 'JH 9S KC QC'], { manualProjects: true });
    let s = applyAction(base, { type: 'declareKind', seat: 0, kind: 'sira' });
    s = play(s, 0, '7S');
    s = applyAction(s, { type: 'declareKind', seat: 1, kind: 'sira' });
    for (const [seat, c] of [[1, '8S'], [2, '10C'], [3, '9S']] as [Seat, string][]) s = play(s, seat, c);
    expect(s.trickNo).toBe(1);
    expect(canShowProject(s, 0)).toBe(true);
    expect(canShowProject(s, 1)).toBe(false);
  });

  it('أوراق المشروع', () => {
    expect(projectFromCards(cards('9S 10S JS QS'), 'hokm')!.kind).toBe('fifty');
    expect(projectFromCards(cards('AS AH AC AD'), 'sun')!.kind).toBe('fourHundred');
    expect(projectFromCards(cards('9S JS QS'), 'hokm')).toBeNull();
  });
});
