import { describe, expect, it } from 'vitest';
import { type Seat, cardLabel } from './cards';
import { applyAction, availableBids, dealHand, isDoublingTurn, type GameState } from './game';
import { rigTieDeal, tieHint, TIE_RIG } from './tieRig';

/** يلعب الصكة كاملة باتباع التوجيهات بس (مثل اللاعبين) */
function playByHints(dealer: Seat): GameState {
  let s = rigTieDeal(dealHand(dealer, [0, 0], Math.random));
  for (let step = 0; step < 60 && s.phase !== 'scored' && !s.lastHand; step++) {
    const seat = ([0, 1, 2, 3] as Seat[]).find((x) => tieHint(s, x) !== null);
    if (seat === undefined) throw new Error(`no hint at phase ${s.phase}`);
    const h = tieHint(s, seat)!;
    if (h === 'اشترِ حكم') s = applyAction(s, { type: 'bid', seat, bid: { type: 'hokm', suit: TIE_RIG.trump } });
    else if (h === 'أكّد الحكم') s = applyAction(s, { type: 'bid', seat, bid: { type: 'confirmHokm' } });
    else if (h === 'قل بس') s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    else if (h.startsWith('قل بس، لا تدبل')) s = applyAction(s, { type: 'doublePass', seat });
    else {
      const card = s.hands[seat].find((c) => h === `العب ${cardLabel(c)}`)!;
      s = applyAction(s, { type: 'play', seat, card });
    }
  }
  return s;
}

describe('tie rig', () => {
  for (const dealer of [0, 1, 2, 3] as Seat[]) {
    it(`dealer ${dealer}: following the hints ends 81–81 (8–8), no projects or baloot`, () => {
      const s = playByHints(dealer);
      expect(s.lastHand?.cardAbnat ?? s.cardAbnat).toEqual([81, 81]);
      expect(s.lastHand?.points).toEqual([8, 8]);
      expect(s.declared.length).toBe(0);
      expect(s.balootSeat).toBeNull();
    });
  }
  it('only the player whose turn it is gets a hint', () => {
    const s = rigTieDeal(dealHand(2, [0, 0], Math.random));
    expect(([0, 1, 2, 3] as Seat[]).filter((x) => tieHint(s, x) !== null)).toEqual([3]);
    void availableBids; void isDoublingTurn;
  });
});
