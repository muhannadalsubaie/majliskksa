import { describe, expect, it } from 'vitest';
import { findProjects, resolveProjects, hasBaloot, projectsAbnat } from './projects';
import { cards } from './testing';

const kinds = (hand: string, mode: 'sun' | 'hokm') => findProjects(cards(hand), mode).map((p) => p.kind).sort();

describe('findProjects', () => {
  it('sira / fifty / hundred sequences', () => {
    expect(kinds('AS KS QS 7H 8D 9C 10D JH', 'hokm')).toEqual(['sira']);
    expect(kinds('KH QH JH 10H 7S 8D 9C AD', 'hokm')).toEqual(['fifty']);
    expect(kinds('AD KD QD JD 10D 7S 8H 9C', 'sun')).toEqual(['hundred']);
  });
  it('sequences use natural order, not trump order (Q J 10 is a sira)', () => {
    expect(kinds('QS JS 10S 7H 8D 9C AH KD', 'hokm')).toEqual(['sira']);
    expect(kinds('9S 8S 7S AH AD KC QH JD', 'hokm')).toEqual(['sira']);
  });
  it('four of a kind', () => {
    expect(kinds('KS KH KC KD 7S 8D 9H 7C', 'hokm')).toEqual(['hundred']);
    // أربعة أولاد: مية في الصن والحكم
    expect(kinds('JS JH JC JD 7S 8D 9H 7C', 'sun')).toEqual(['hundred']);
    expect(kinds('JS JH JC JD 7S 8D 9H 7C', 'hokm')).toEqual(['hundred']);
    expect(kinds('JS JH JC JD 7S 8D 9H 7C', 'hokm')).toEqual(['hundred']);
    expect(kinds('AS AH AC AD 7S 8D 9H 7C', 'sun')).toEqual(['fourHundred']);
    expect(kinds('AS AH AC AD 7S 8D 9H 7C', 'hokm')).toEqual([]);
    expect(kinds('9S 9H 9C 9D 7S 8D 7H 7C', 'sun')).toEqual([]);
  });
  it('8-card run yields hundred + sira', () => {
    expect(kinds('AS KS QS JS 10S 9S 8S 7S', 'sun')).toEqual(['hundred', 'sira']);
  });
  it('no card is used twice', () => {
    const p = findProjects(cards('KS KH KC KD QS JS 7H 8C'), 'hokm');
    expect(projectsAbnat(p)).toBe(100);
  });
});

describe('resolveProjects', () => {
  it('stronger project cancels the other team entirely', () => {
    const r = resolveProjects([
      { seat: 0, projects: findProjects(cards('AS KS QS 7H 8D 9C 7D 8H'), 'hokm') },
      { seat: 1, projects: findProjects(cards('KH QH JH 10H 7S 8C 9D 7C'), 'hokm') },
      { seat: 2, projects: findProjects(cards('AD KD QD 7S 8S 9S 10C JC'), 'hokm') },
    ], 1);
    expect(r.winningTeam).toBe(1);
    expect(r.abnat).toEqual([0, 50]);
  });
  it('equal value: higher top card wins, and team collects all its projects', () => {
    const r = resolveProjects([
      { seat: 1, projects: findProjects(cards('KH QH JH 7S 8C 9D 7C 8D'), 'hokm') },
      { seat: 0, projects: findProjects(cards('AS KS QS 7H 8H 9C 7D 10D'), 'hokm') },
      { seat: 2, projects: findProjects(cards('9C 8C 7C AH JD 10S JS QD'), 'hokm') },
    ], 1);
    expect(r.winningTeam).toBe(0);
    expect(r.abnat).toEqual([40, 0]);
  });
  it('identical projects: first in play order wins', () => {
    const r = resolveProjects([
      { seat: 0, projects: findProjects(cards('AS KS QS'), 'hokm') },
      { seat: 3, projects: findProjects(cards('AH KH QH'), 'hokm') },
    ], 3);
    expect(r.winningTeam).toBe(1);
  });
});

it('baloot needs K and Q of trump', () => {
  expect(hasBaloot(cards('KH QH 7S'), 'H')).toBe(true);
  expect(hasBaloot(cards('KH QS 7S'), 'H')).toBe(false);
  expect(hasBaloot(cards('KH QH'), null)).toBe(false);
});
