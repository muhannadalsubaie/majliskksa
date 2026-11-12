import { describe, expect, it } from 'vitest';
import type { Seat } from './cards';
import { applyAction, availableBids, dealHand, type GameState } from './game';
import { seededRng } from './testing';

/** حكم أول: أول لاعب يشتري حكم، الباقين بس، ويرجع له يأكد. يرجع الحالة بعد التأكيد */
function confirmFirstHokm(scores: [number, number]): GameState {
  for (let seed = 1; seed < 200; seed++) {
    let s: GameState = { ...dealHand(0, scores, seededRng(seed)) };
    const buyer = s.turn;
    if (!availableBids(s, buyer).some((b) => b.type === 'hokm')) continue;
    s = applyAction(s, { type: 'bid', seat: buyer, bid: availableBids(s, buyer).find((b) => b.type === 'hokm')! });
    for (let i = 0; i < 3; i++) s = applyAction(s, { type: 'bid', seat: s.turn, bid: { type: 'pass' } });
    if (s.turn !== buyer || !availableBids(s, buyer).some((b) => b.type === 'confirmHokm')) continue;
    s = applyAction(s, { type: 'bid', seat: buyer as Seat, bid: { type: 'confirmHokm' } });
    // اللي معه «ورق» يقول بس (ما يأثر على الدبل)
    while (s.phase === 'waraq') s = applyAction(s, { type: 'waraq', seat: s.turn, call: false });
    return s;
  }
  throw new Error('ما لقينا توزيعة');
}

describe('الدبل بعد تأكيد الحكم الأول', () => {
  it('ما يطلع الدبل أبداً، مهما كانت النتيجة (فوق المية أو تحتها، للمشتري أو للخصم)', () => {
    for (const sc of [[40, 60], [50, 120], [120, 50], [110, 130], [0, 0]] as [number, number][]) {
      expect(confirmFirstHokm(sc).phase).toBe('playing');
    }
  });
});
