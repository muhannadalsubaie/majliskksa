// لاعب آلي للجاكارو: يقيّم كل حركة ممكنة ويختار الأفضل —
// الدخول لمنطقة الأمان، أكل أحجار الخصم، إنزال الأحجار، والتقدم، ويتجنب أكل شريكه.
import {
  type Card, type JackarooAction, type JackarooState, type LegalMove, type Rank,
  applyJackaroo, legalMoves, mustBurn, nextSeat, progressOf, teamOf,
} from './engine';

const BURN_ORDER: Rank[] = ['2', '3', '6', '8', '9', 'Q', '10', '4', '5', 'J', '7', 'A', 'K'];

export function jackarooBotAction(s: JackarooState, seat: number): JackarooAction | null {
  if (s.phase !== 'playing' || s.turn !== seat) return null;
  if (mustBurn(s, seat)) {
    // نحرق أقل الأوراق فائدة ونحتفظ بالأص والشايب والسبعة
    const card = [...s.hands[seat]].sort((a, b) => BURN_ORDER.indexOf(a.rank) - BURN_ORDER.indexOf(b.rank))[0];
    return card ? { type: 'burn', seat, card } : null;
  }
  const options = legalMoves(s, seat);
  let best: { m: LegalMove; score: number } | null = null;
  for (const m of options) {
    const score = evaluate(s, seat, m);
    if (!best || score > best.score) best = { m, score };
  }
  return best ? { type: 'play', seat, card: best.m.card, move: best.m.move } : null;
}

function evaluate(s: JackarooState, seat: number, m: LegalMove): number {
  const after = applyJackaroo(s, { type: 'play', seat, card: m.card, move: m.move }, () => 0.5);
  const myTeam = teamOf(seat);
  let score = teamProgress(after, myTeam) - teamProgress(after, 1 - myTeam) - (teamProgress(s, myTeam) - teamProgress(s, 1 - myTeam));
  const rec = after.lastMove!;
  for (const c of rec.captured) score += teamOf(c.owner) === myTeam ? -60 : 40;
  score += rec.enteredSafe.length * 30;
  if (m.move.kind === 'out') score += 25;
  if (m.move.kind === 'skipNext') score += teamOf(nextSeat(seat)) !== myTeam ? 12 : -30;
  // نحتفظ بالأوراق القوية إن كان لها بديل متقارب
  if (m.card.rank === 'A' || m.card.rank === 'K') score -= 4;
  if (m.card.rank === '7') score -= 2;
  return score;
}

/** تقدّم الفريق: مجموع ما قطعه كل حجر (منطقة الأمان أعلى قيمة) */
function teamProgress(s: JackarooState, team: number): number {
  let sum = 0;
  for (const owner of [team, team + 2]) {
    for (const m of s.marbles[owner]) {
      if (m.zone === 'track') sum += 10 + progressOf(s.rules, owner, m.pos);
      else if (m.zone === 'safe') sum += 120 + m.pos * 3;
    }
  }
  return sum;
}

export const cardsEqual = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
