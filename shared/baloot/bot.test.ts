import { describe, expect, it } from 'vitest';
import type { Seat } from './cards';
import { DEFAULT_BOT, botAction, hokmStrength, sunStrength } from './bot';
import { winRate } from './botSim';
import { applyAction, availableDouble, newMatch } from './game';
import { cards, seededRng } from './testing';

describe('bot', () => {
  it('evaluates hands sensibly', () => {
    expect(hokmStrength(cards('JH 9H AH 10H KS'), 'H')).toBeGreaterThan(hokmStrength(cards('7H 8H QH AS KS'), 'H'));
    expect(sunStrength(cards('AS 10S AH 10H AD'))).toBeGreaterThan(sunStrength(cards('JS 9S 8H 7D QC')));
  });

  it('always produces legal actions and beats random play clearly', () => {
    const rate = winRate(DEFAULT_BOT, 'random', 60, 3);
    expect(rate).toBeGreaterThan(0.75);
  });

  it('doubling options are respected', () => {
    let s = newMatch(seededRng(5), 0);
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'hokm', suit: s.qaba!.suit } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: 'bid', seat, bid: { type: 'pass' } });
    s = applyAction(s, { type: 'bid', seat: 1, bid: { type: 'confirmHokm' } });
    const a = botAction(s, 0)!;
    expect(['double', 'doublePass']).toContain(a.type);
    if (a.type === 'double' && availableDouble(s, 0)?.needsLockChoice) expect(typeof a.locked).toBe('boolean');
  });
});
