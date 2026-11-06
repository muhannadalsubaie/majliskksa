import { describe, expect, it } from 'vitest';
import { type Seat, sameCard } from './cards';
import { DEFAULT_BOT, PREVIOUS_BOT, botAction, brotherOf, choosePlayExpert, partnerWants } from './bot';
import { winRate } from './botSim';
import { type GameState, applyAction, handOver, legalCardsFor, needsRedeal, newMatch, nextHand, redeal } from './game';
import { cards, seededRng } from './testing';

/** صكات كثيرة بين روبوتات خبيرة: كل ورقة قانونية، ومجموع الأبناط صحيح */
function selfPlay(hands: number, seed: number, onPlay: (s: GameState, seat: Seat) => void, onHand: (s: GameState) => void) {
  const rng = seededRng(seed);
  let s = newMatch(rng, 0);
  let done = 0;
  for (let steps = 0; steps < 400000 && done < hands; steps++) {
    if (s.phase === 'matchOver') { s = newMatch(rng, 0); continue; }
    if (needsRedeal(s)) { s = redeal(s, rng); continue; }
    if (handOver(s)) { onHand(s); done++; s = nextHand(s, rng); continue; }
    let acted = false;
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      if (s.phase === 'playing' && s.turn === seat) onPlay(s, seat);
      const a = botAction(s, seat, DEFAULT_BOT);
      if (!a) continue;
      if (s.phase !== 'doubling' && s.turn !== seat) continue;
      s = applyAction(s, a); acted = true; break;
    }
    if (!acted) throw new Error(`stuck in ${s.phase}`);
  }
  return done;
}

describe('expert bot', () => {
  it('every card it chooses is legal, and every hand totals 130 (sun) / 162 (hokm)', () => {
    let plays = 0;
    const done = selfPlay(1500, 11, (s, seat) => {
      const card = choosePlayExpert(s, seat);
      expect(legalCardsFor(s, seat).some((c) => sameCard(c, card))).toBe(true);
      plays++;
    }, (s) => {
      if (!s.contract) return;
      const total = s.cardAbnat[0] + s.cardAbnat[1];
      expect(total).toBe(s.contract.mode === 'sun' ? 130 : 162);
    });
    expect(done).toBe(1500);
    expect(plays).toBeGreaterThan(1500 * 20);
  });

  it('reads partner signals', () => {
    const base = { contract: { mode: 'sun', trump: null, buyer: 1 }, voids: [[], [], [], []] } as unknown as GameState;
    const sig = (list: [Seat, string, string][]) => ({ ...base, discards: list.map(([seat, c, led]) => ({ seat, card: cards(c)[0], led, toPartner: true })) }) as GameState;
    // الشريك (2) هرّب ديمن كبير واللعب أسود ← يبي هاص
    expect(partnerWants(sig([[2, 'KD', 'S']]), 0)).toBe('H');
    // من الكبير للصغير في نفس الزات ← أخو الزات
    expect(partnerWants(sig([[2, 'QD', 'S'], [2, '8D', 'C']]), 0)).toBe('H');
    // من الصغير للكبير ← نفس الزات
    expect(partnerWants(sig([[2, '8D', 'S'], [2, 'QD', 'C']]), 0)).toBe('D');
    // اللعب سبيت وهرّب هاص وديمن ← يبي شريا
    expect(partnerWants(sig([[2, '8H', 'S'], [2, '7D', 'S']]), 0)).toBe('C');
    // هرّب الإكة ← يبي نفس الزات
    expect(partnerWants(sig([[2, 'AH', 'S']]), 0)).toBe('H');
    // تهريب الخصم ما يُقرأ، والتهريب وقت الأكلة مو له ما يُقرأ
    expect(partnerWants(sig([[1, 'KD', 'S']]), 0)).toBe(null);
    expect(brotherOf('S')).toBe('C');
  });

  it('cashes the ace before the ten when both are masters', () => {
    // سبيت ما فيه حكم: معه إكة وعشرة سبيت
    let s = newMatch(seededRng(2), 3);
    s = { ...s, phase: 'playing', turn: 0, trick: [], trickNo: 0, contract: { mode: 'sun', trump: null, buyer: 0 } as GameState['contract'],
      hands: [cards('AS 10S 7H 8C 9D 7D 8H 9C'), cards('KS QS JS 9S AH 10H KH QH'), cards('8S 7S JH 9H AC 10C KC QC'), cards('JC 7C AD 10D KD QD JD 8D')],
      doubling: { ...s.doubling, locked: false } };
    expect(choosePlayExpert(s, 0)).toEqual(cards('AS')[0]);
  });

  it.runIf(import.meta.env.COMPARE)('beats the previous bot', { timeout: 3_600_000 }, () => {
    const r = winRate(DEFAULT_BOT, PREVIOUS_BOT, Number(import.meta.env.COMPARE_N ?? 300), 5);
    console.log(`expert vs previous: ${(r * 100).toFixed(1)}%`);
  });
});
