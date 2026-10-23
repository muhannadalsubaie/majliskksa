import { describe, expect, it } from 'vitest';
import { createDeck, cardPoints, HAND_TOTAL, LAST_TRICK_BONUS, cardStrength, SUN_ABNAT_MULTIPLIER } from './cards';

describe('cards', () => {
  it('deck has 32 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(32);
    expect(new Set(deck.map((c) => c.rank + c.suit)).size).toBe(32);
  });

  it('sun totals 260 abnat (doubled) with the last-trick bonus', () => {
    const sum = createDeck().reduce((s, c) => s + cardPoints(c, 'sun', null), 0);
    expect((sum + LAST_TRICK_BONUS) * SUN_ABNAT_MULTIPLIER).toBe(HAND_TOTAL.sun);
  });

  it('hokm totals 162 with the last-trick bonus', () => {
    const sum = createDeck().reduce((s, c) => s + cardPoints(c, 'hokm', 'H'), 0);
    expect(sum + LAST_TRICK_BONUS).toBe(HAND_TOTAL.hokm);
  });

  it('trump jack beats trump nine; sun ace beats ten', () => {
    expect(cardStrength({ suit: 'H', rank: 'J' }, 'hokm', 'H')).toBeGreaterThan(cardStrength({ suit: 'H', rank: '9' }, 'hokm', 'H'));
    expect(cardStrength({ suit: 'S', rank: 'A' }, 'sun', null)).toBeGreaterThan(cardStrength({ suit: 'S', rank: '10' }, 'sun', null));
  });
});
