import { describe, expect, it } from 'vitest';
import { abnatToPoints, matchOutcome, scoreHand, type HandScoreInput } from './scoring';

const hokm = (o: Partial<HandScoreInput>): HandScoreInput => ({
  mode: 'hokm', buyerTeam: 0, cardAbnat: [100, 62], tricksWon: [5, 3], projectAbnat: [0, 0],
  balootTeam: null, multiplier: 1, gahwa: false, doublerTeam: null, ...o,
});

describe('abnatToPoints', () => {
  it('rounds .5 and above up', () => {
    expect(abnatToPoints(84)).toBe(8);
    expect(abnatToPoints(85)).toBe(9);
    expect(abnatToPoints(162)).toBe(16);
  });
});

describe('scoreHand — hokm', () => {
  it('buyer over 81 → both teams score', () => {
    expect(scoreHand(hokm({})).points).toEqual([10, 6]);
  });
  it('buyer projects count toward 81', () => {
    const r = scoreHand(hokm({ cardAbnat: [70, 92], projectAbnat: [20, 0] }));
    expect(r.buyerFailed).toBe(false);
    expect(r.points).toEqual([9, 9]);
  });
  it('buyer under 81 → everything (incl. projects) to opponents', () => {
    const r = scoreHand(hokm({ cardAbnat: [60, 102], projectAbnat: [0, 50] }));
    expect(r.buyerFailed).toBe(true);
    expect(r.points).toEqual([0, 21]);
  });
  it('double multiplies', () => {
    expect(scoreHand(hokm({ multiplier: 2, doublerTeam: 1 })).points).toEqual([20, 12]);
    expect(scoreHand(hokm({ cardAbnat: [60, 102], multiplier: 3, doublerTeam: 1 })).points).toEqual([0, 48]);
  });
  it('exactly 81 fails normally, but succeeds when opponents doubled', () => {
    expect(scoreHand(hokm({ cardAbnat: [81, 81] })).buyerFailed).toBe(true);
    expect(scoreHand(hokm({ cardAbnat: [81, 81], multiplier: 2, doublerTeam: 1 })).buyerFailed).toBe(false);
  });
  it('baloot: +1 to its owner, never multiplied, kept even on failure', () => {
    expect(scoreHand(hokm({ balootTeam: 0, multiplier: 2, doublerTeam: 1 })).points).toEqual([21, 12]);
    expect(scoreHand(hokm({ cardAbnat: [60, 102], balootTeam: 0 })).points).toEqual([1, 16]);
  });
  it('gahwa: hand winner wins the match', () => {
    expect(scoreHand(hokm({ multiplier: 4, gahwa: true, doublerTeam: 1 })).gahwaWinner).toBe(0);
    expect(scoreHand(hokm({ cardAbnat: [60, 102], multiplier: 4, gahwa: true, doublerTeam: 1 })).gahwaWinner).toBe(1);
  });
});

describe('scoreHand — sun', () => {
  it('card abnat doubled, divided by 10, both teams score', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [66, 64], projectAbnat: [0, 0] });
    expect(r.points).toEqual([13, 13]);
  });
  it('kaboot', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [130, 0], tricksWon: [8, 0] });
    expect(r.kaboot).toBe(0);
    expect(r.points).toEqual([52, 0]);
  });
});

describe('matchOutcome', () => {
  it('152 wins; both over → higher wins; equal → tiebreak', () => {
    expect(matchOutcome([150, 90])).toEqual({ status: 'ongoing' });
    expect(matchOutcome([152, 90])).toEqual({ status: 'won', winner: 0 });
    expect(matchOutcome([155, 160])).toEqual({ status: 'won', winner: 1 });
    expect(matchOutcome([160, 160])).toEqual({ status: 'tiebreak' });
    expect(matchOutcome([10, 20], 0)).toEqual({ status: 'won', winner: 0 });
  });
});
