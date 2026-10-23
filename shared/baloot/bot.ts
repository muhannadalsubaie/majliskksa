import { type Card, type Seat, type Suit, cardPoints, cardStrength, teamOf } from './cards';
import {
  type Action, type Bid, type GameState, availableBids, availableDouble, canDeclareBaloot, canDeclareProject,
  legalCardsFor,
} from './game';
import { trickWinner } from './play';

/** الروبوت: يختار حركة قانونية دائماً، باستراتيجية بسيطة ومعقولة. */

const TRUMP_VALUE: Record<string, number> = { J: 4, '9': 3, A: 2, '10': 1.5, K: 1, Q: 1, '8': 0.5, '7': 0.5 };

function hokmStrength(hand: Card[], suit: Suit): number {
  let score = 0;
  for (const c of hand) {
    if (c.suit === suit) score += TRUMP_VALUE[c.rank];
    else if (c.rank === 'A') score += 1;
  }
  return score;
}

function sunStrength(hand: Card[]): number {
  return hand.reduce((s, c) => s + (c.rank === 'A' ? 3 : c.rank === '10' ? 1.5 : c.rank === 'K' ? 0.5 : 0), 0);
}

function chooseBid(s: GameState, seat: Seat): Bid {
  const bids = availableBids(s, seat);
  const hand = s.hands[seat];
  const qaba = s.qaba!;
  // المشتري يأخذ القبلة، فنحسبها ضمن اليد عند التقييم
  const withQaba = [...hand, qaba];
  if (bids.some((b) => b.type === 'sun') && sunStrength(withQaba) >= 7.5) return { type: 'sun' };
  let best: { bid: Bid; score: number } | null = null;
  for (const b of bids) {
    if (b.type !== 'hokm') continue;
    const score = hokmStrength(b.suit === qaba.suit ? withQaba : hand, b.suit);
    if (score >= 7 && (!best || score > best.score)) best = { bid: b, score };
  }
  return best?.bid ?? { type: 'pass' };
}

function chooseDouble(s: GameState, seat: Seat): Action {
  const option = availableDouble(s, seat);
  const c = s.contract!;
  const hand = s.hands[seat];
  const strength = c.mode === 'hokm' ? hokmStrength(hand, c.trump!) : sunStrength(hand);
  // الخصم يدبّل بيد قوية جداً؛ المشتري يرفع فقط بيد ممتازة
  const threshold: Record<string, number> = { 'دبل': 10, 'ثري': 11, 'فور': 13, 'قهوة': 15 };
  if (option && strength >= threshold[option.label]) {
    return { type: 'double', seat, locked: option.needsLockChoice ? false : undefined };
  }
  return { type: 'doublePass', seat };
}

function value(c: Card, s: GameState) {
  const { mode, trump } = s.contract!;
  return cardPoints(c, mode, trump) * 10 + cardStrength(c, mode, trump);
}

function choosePlay(s: GameState, seat: Seat): Card {
  const legal = legalCardsFor(s, seat);
  const { mode, trump } = s.contract!;
  const isTrump = (c: Card) => mode === 'hokm' && c.suit === trump;
  const byValue = [...legal].sort((a, b) => value(a, s) - value(b, s));
  const lowest = byValue.find((c) => !isTrump(c)) ?? byValue[0];

  if (s.trick.length === 0) {
    // افتتاح: أكة من لون غير الحكم، أو ولد الحكم إن كان فريقنا المشتري، وإلا أصغر ورقة
    const ace = legal.find((c) => c.rank === 'A' && !isTrump(c));
    if (ace) return ace;
    const buyerTeam = teamOf(s.contract!.buyer) === teamOf(seat);
    const jack = legal.find((c) => isTrump(c) && c.rank === 'J');
    if (buyerTeam && jack) return jack;
    return lowest;
  }

  const winner = trickWinner(s.trick, mode, trump);
  const partnerWinning = teamOf(winner) === teamOf(seat);
  if (partnerWinning) {
    // الشريك متقدم: نعطيه نقاطاً بورقة غير حكم إن أمكن
    const feed = [...legal].filter((c) => !isTrump(c)).sort((a, b) => cardPoints(b, mode, trump) - cardPoints(a, mode, trump));
    const lastToPlay = s.trick.length === 3;
    return lastToPlay && feed[0] ? feed[0] : lowest;
  }
  // نحاول الفوز بأرخص ورقة رابحة
  const winners = byValue.filter((c) => trickWinner([...s.trick, { seat, card: c }], mode, trump) === seat);
  if (winners.length) return winners[0];
  return lowest;
}

/** الحركة التالية للروبوت في هذا المقعد (أو null إن لم يكن دوره). */
export function botAction(s: GameState, seat: Seat): Action | null {
  if (s.phase === 'bidding' && s.turn === seat && s.qaba) return { type: 'bid', seat, bid: chooseBid(s, seat) };
  if (s.phase === 'doubling' && s.doubling.awaitingTeam === teamOf(seat) && !s.doubling.passed.includes(seat)) {
    return chooseDouble(s, seat);
  }
  if (s.phase === 'playing') {
    if (canDeclareBaloot(s, seat)) return { type: 'declareBaloot', seat };
    if (s.turn !== seat || s.trickNo >= 8) return null;
    if (canDeclareProject(s, seat)) return { type: 'declareProject', seat };
    return { type: 'play', seat, card: choosePlay(s, seat) };
  }
  return null;
}

