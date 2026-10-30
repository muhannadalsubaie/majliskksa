import { describe, expect, it } from 'vitest';
import { abnatToPoints, matchOutcome, scoreHand, sunAbnatToPoints, type HandScoreInput } from './scoring';

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
  it('hokm double is not split: the winning team takes the whole hand multiplied', () => {
    expect(scoreHand(hokm({ multiplier: 2, doublerTeam: 1 })).points).toEqual([32, 0]);
    expect(scoreHand(hokm({ multiplier: 3, doublerTeam: 1 })).points).toEqual([48, 0]);
    expect(scoreHand(hokm({ cardAbnat: [60, 102], multiplier: 3, doublerTeam: 1 })).points).toEqual([0, 48]);
  });
  it('exactly 81 fails normally, but succeeds when opponents doubled', () => {
    expect(scoreHand(hokm({ cardAbnat: [81, 81] })).buyerFailed).toBe(true);
    expect(scoreHand(hokm({ cardAbnat: [81, 81], multiplier: 2, doublerTeam: 1 })).buyerFailed).toBe(false);
  });
  it('baloot: +2 to its owner, never multiplied, kept even on failure', () => {
    expect(scoreHand(hokm({ balootTeam: 0, multiplier: 2, doublerTeam: 1 })).points).toEqual([34, 0]);
    expect(scoreHand(hokm({ balootTeam: 1, multiplier: 2, doublerTeam: 1 })).points).toEqual([32, 2]);
    expect(scoreHand(hokm({ cardAbnat: [60, 102], balootTeam: 0 })).points).toEqual([2, 16]);
  });
  it('projects are never multiplied by the double', () => {
    expect(scoreHand(hokm({ projectAbnat: [20, 0], multiplier: 2, doublerTeam: 1 })).points).toEqual([34, 0]);
    // دبل الحكم: مشاريع الخاسر تذهب للفائز أيضاً، بلا مضاعفة
    const r = scoreHand(hokm({ projectAbnat: [0, 20], multiplier: 2, doublerTeam: 1 }));
    expect(r.points).toEqual([34, 0]);
    expect(r.projectPoints).toEqual([2, 0]);
    expect(scoreHand(hokm({ cardAbnat: [60, 102], projectAbnat: [0, 50], multiplier: 3, doublerTeam: 1 })).points).toEqual([0, 53]);
  });
  it('kaboot = 25 (not doubled), projects added on top', () => {
    expect(scoreHand(hokm({ cardAbnat: [162, 0], tricksWon: [8, 0] })).points).toEqual([25, 0]);
    expect(scoreHand(hokm({ cardAbnat: [162, 0], tricksWon: [8, 0], multiplier: 2, doublerTeam: 1, projectAbnat: [50, 0] })).points).toEqual([30, 0]);
    expect(scoreHand(hokm({ cardAbnat: [0, 162], tricksWon: [0, 8], balootTeam: 0 })).points).toEqual([2, 25]);
  });
  it('kaboot does not take the opponents\' projects (hokm and sun)', () => {
    const h = scoreHand(hokm({ cardAbnat: [162, 0], tricksWon: [8, 0], projectAbnat: [0, 50] }));
    expect(h.points).toEqual([25, 0]);
    expect(h.projectPoints).toEqual([0, 0]);
    const s = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [0, 130], tricksWon: [0, 8], projectAbnat: [100, 0] });
    expect(s.points).toEqual([0, 44]);
  });
  it('gahwa: hand winner wins the match', () => {
    expect(scoreHand(hokm({ multiplier: 4, gahwa: true, doublerTeam: 1 })).gahwaWinner).toBe(0);
    expect(scoreHand(hokm({ cardAbnat: [60, 102], multiplier: 4, gahwa: true, doublerTeam: 1 })).gahwaWinner).toBe(1);
  });
});

describe('scoreHand — sun', () => {
  it('card abnat doubled, divided by 10, both teams score', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [66, 64], projectAbnat: [0, 0] });
    expect(r.points).toEqual([14, 12]);
  });
  it('buyer under half loses everything to the opponents', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [60, 70] });
    expect(r.buyerFailed).toBe(true);
    expect(r.points).toEqual([0, 26]);
  });
  it('exactly half is not a loss; buyer projects count', () => {
    expect(scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [65, 65] }).buyerFailed).toBe(false);
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [60, 70], projectAbnat: [20, 0] });
    expect(r.buyerFailed).toBe(false);
    expect(r.points).toEqual([14, 14]);
  });
  it('sun loss with a double: opponents get everything ×2, projects not multiplied', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [40, 90], projectAbnat: [0, 50], multiplier: 2, doublerTeam: 1 });
    expect(r.points).toEqual([0, 57]);
  });
  it('kaboot = 44', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [130, 0], tricksWon: [8, 0] });
    expect(r.kaboot).toBe(0);
    expect(r.points).toEqual([44, 0]);
  });
  it('projects are not doubled in sun', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [66, 64], projectAbnat: [20, 0] });
    expect(r.points).toEqual([16, 12]);
  });
  it('sun kaboot ignores the double; its project is added', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [130, 0], tricksWon: [8, 0], projectAbnat: [100, 0], multiplier: 2, doublerTeam: 1 });
    expect(r.points).toEqual([54, 0]);
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

  it('sun: each 5 abnat (cards + ground, out of 130) is one point; log keeps abnat and projects apart', () => {
    for (let a = 0; a <= 130; a++) expect(sunAbnatToPoints(a) + sunAbnatToPoints(130 - a)).toBe(26);
    // الآحاد: 1–4 لا تُحسب، 5 بنقطة، 6–9 تُجبر للعشرة التالية
    expect(sunAbnatToPoints(64)).toBe(12);
    expect(sunAbnatToPoints(62)).toBe(12);
    expect(sunAbnatToPoints(65)).toBe(13);
    expect(sunAbnatToPoints(66)).toBe(14);
    expect(sunAbnatToPoints(70)).toBe(14);
    const r = scoreHand({
      mode: 'sun', buyerTeam: 0, cardAbnat: [72, 58], tricksWon: [5, 3], projectAbnat: [40, 0],
      balootTeam: null, multiplier: 1, gahwa: false, doublerTeam: null,
    });
    expect(r.cardAbnat).toEqual([72, 58]);
    expect(r.projectPoints).toEqual([4, 0]);
    expect(r.points).toEqual([14 + 4, 12]); // 72 ← 14 ، 58 ← 12
  });

  it('hokm: buyer rounds up from 6, down at 5 and below; opponents get the rest of 16', () => {
    expect(scoreHand(hokm({ cardAbnat: [126, 36] })).points).toEqual([13, 3]);
    expect(scoreHand(hokm({ cardAbnat: [125, 37] })).points).toEqual([12, 4]);
    expect(scoreHand(hokm({ cardAbnat: [36, 126], buyerTeam: 1 })).points).toEqual([3, 13]);
  });

  it('sun double is not split: the winner takes the whole hand', () => {
    const r = scoreHand({ ...hokm({}), mode: 'sun', cardAbnat: [80, 50], multiplier: 2, doublerTeam: 1 });
    expect(r.points).toEqual([52, 0]);
  });
});
