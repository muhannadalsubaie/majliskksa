import { type Card, type GameMode, type Seat, type Suit, cardStrength, teamOf } from './cards';

export interface PlayedCard { seat: Seat; card: Card }

function beats(a: Card, b: Card, led: Suit, mode: GameMode, trump: Suit | null): boolean {
  const aTrump = mode === 'hokm' && a.suit === trump;
  const bTrump = mode === 'hokm' && b.suit === trump;
  if (aTrump !== bTrump) return aTrump;
  if (a.suit !== b.suit) return a.suit === led;
  return cardStrength(a, mode, trump) > cardStrength(b, mode, trump);
}

/** المقعد الفائز بالأكلة حتى الآن (تعمل على أكلة ناقصة أيضاً). */
export function trickWinner(trick: PlayedCard[], mode: GameMode, trump: Suit | null): Seat {
  const led = trick[0].card.suit;
  let best = trick[0];
  for (const p of trick.slice(1)) if (beats(p.card, best.card, led, mode, trump)) best = p;
  return best.seat;
}

export interface LegalContext {
  mode: GameMode;
  trump: Suit | null;
  trick: PlayedCard[];
  hand: Card[];
  seat: Seat;
  /** في الدبل المقفل: مقعد المشتري الممنوع من افتتاح أكلة بالحكم */
  lockedSeat: Seat | null;
}

/** الأوراق المسموح لعبها — المرجع الوحيد لقانونية الحركة (يُستدعى في الخادم). */
export function legalCards({ mode, trump, trick, hand, seat, lockedSeat }: LegalContext): Card[] {
  const isTrump = (c: Card) => mode === 'hokm' && c.suit === trump;

  if (trick.length === 0) {
    if (mode === 'hokm' && lockedSeat === seat) {
      const nonTrump = hand.filter((c) => !isTrump(c));
      return nonTrump.length ? nonTrump : hand;
    }
    return hand;
  }

  const led = trick[0].card.suit;
  const strongestTrumpOnTable = () =>
    trick.filter((p) => isTrump(p.card)).reduce<number>((m, p) => Math.max(m, cardStrength(p.card, mode, trump)), 0);
  const above = (cards: Card[]) => {
    const top = strongestTrumpOnTable();
    return cards.filter((c) => cardStrength(c, mode, trump) > top);
  };

  const follow = hand.filter((c) => c.suit === led);
  if (follow.length) {
    // افتتاح بالحكم: يلزم تغطية الحكم الأعلى إن أمكن
    if (mode === 'hokm' && led === trump) {
      const higher = above(follow);
      return higher.length ? higher : follow;
    }
    return follow;
  }

  if (mode === 'sun') return hand;

  // حكم ولا يملك اللون المطلوب
  const winner = trickWinner(trick, mode, trump);
  if (teamOf(winner) === teamOf(seat)) return hand; // الشريك متصدر: حر
  const trumps = hand.filter(isTrump);
  if (!trumps.length) return hand;
  const tableHasTrump = trick.some((p) => isTrump(p.card));
  if (!tableHasTrump) return trumps; // القطع إجباري
  const higher = above(trumps);
  // يلزم الدق فوق حكم الخصم إن أمكن، وإلا فهو حر
  return higher.length ? higher : hand;
}
