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
const teamOfTurnBuyer = (s: GameState) => s.contract!.buyer % 2;

describe('الدبل بعد تأكيد الحكم الأول', () => {
  it('الكل تحت المية: ما فيه دبل', () => {
    expect(confirmFirstHokm([40, 60]).phase).toBe('playing');
  });
  it('فريق الخصم فوق المية: يقدر يدبّل', () => {
    // نجرب الحالتين: الخصم فوق المية (والمشتري تحتها أو فوقها)
    for (const sc of [[50, 120], [120, 50], [110, 130]] as [number, number][]) {
      const s = confirmFirstHokm(sc);
      const opp = 1 - teamOfTurnBuyer(s);
      expect(s.phase).toBe(sc[opp] > 100 ? 'doubling' : 'playing');
    }
  });
  it('فريق المشتري فوق المية والخصم تحتها: ما يدبّل الخصم', () => {
    for (const sc of [[120, 50], [50, 120]] as [number, number][]) {
      const s = confirmFirstHokm(sc);
      const buyerTeam = teamOfTurnBuyer(s);
      if (sc[buyerTeam] > 100 && sc[1 - buyerTeam] < 100) expect(s.phase).toBe('playing');
    }
  });
});
