import { describe, expect, it } from 'vitest';
import type { Seat } from './cards';
import { legalCards, trickWinner, type PlayedCard } from './play';
import { cards } from './testing';

const trick = (spec: string, first: Seat): PlayedCard[] =>
  cards(spec).map((card, i) => ({ seat: ((first + i) % 4) as Seat, card }));
const ids = (cs: { rank: string; suit: string }[]) => cs.map((c) => c.rank + c.suit).sort();

describe('trickWinner', () => {
  it('highest of led suit in sun', () => {
    expect(trickWinner(trick('10S AS KH QS', 0), 'sun', null)).toBe(1);
  });
  it('trump beats led suit; trump J beats trump 9', () => {
    expect(trickWinner(trick('AS 7H KS 8S', 0), 'hokm', 'H')).toBe(1);
    expect(trickWinner(trick('AS 9H JH 8S', 0), 'hokm', 'H')).toBe(2);
  });
});

describe('legalCards', () => {
  const base = { mode: 'hokm' as const, trump: 'H' as const, lockedSeat: null };

  it('must follow suit', () => {
    expect(ids(legalCards({ ...base, trick: trick('AS', 0), hand: cards('7S KD 9H'), seat: 1 }))).toEqual(['7S']);
  });
  it('void and partner not winning → must trump', () => {
    expect(ids(legalCards({ ...base, trick: trick('AS', 0), hand: cards('KD 9H 7H'), seat: 1 }))).toEqual(['7H', '9H']);
  });
  it('void and partner winning → free', () => {
    expect(ids(legalCards({ ...base, trick: trick('AS 7S', 0), hand: cards('KD 9H'), seat: 2 }))).toEqual(['9H', 'KD']);
  });
  it('must over-trump the opponent when possible', () => {
    expect(ids(legalCards({ ...base, trick: trick('AS 10H', 0), hand: cards('KD 9H 7H'), seat: 2 }))).toEqual(['9H']);
  });
  it('cannot over-trump → free', () => {
    expect(ids(legalCards({ ...base, trick: trick('AS JH', 0), hand: cards('KD 7H'), seat: 2 }))).toEqual(['7H', 'KD']);
  });
  it('trump led → must play higher trump if possible', () => {
    expect(ids(legalCards({ ...base, trick: trick('10H', 0), hand: cards('7H AH KS'), seat: 1 }))).toEqual(['AH']);
    expect(ids(legalCards({ ...base, trick: trick('JH', 0), hand: cards('7H AH KS'), seat: 1 }))).toEqual(['7H', 'AH']);
  });
  it('sun: void → anything', () => {
    expect(ids(legalCards({ mode: 'sun', trump: null, lockedSeat: null, trick: trick('AS', 0), hand: cards('KD 9H'), seat: 1 }))).toEqual(['9H', 'KD']);
  });
  it('locked double: buyer cannot lead trump unless only trumps remain', () => {
    expect(ids(legalCards({ ...base, lockedSeat: 0, trick: [], hand: cards('JH 7S'), seat: 0 }))).toEqual(['7S']);
    expect(ids(legalCards({ ...base, lockedSeat: 0, trick: [], hand: cards('JH 9H'), seat: 0 }))).toEqual(['9H', 'JH']);
    expect(ids(legalCards({ ...base, lockedSeat: 0, trick: [], hand: cards('JH 7S'), seat: 2 }))).toEqual(['7S', 'JH']);
  });
});
