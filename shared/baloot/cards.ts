// تعريفات الأوراق المشتركة بين الواجهة وCloud Functions.
// لا تحتوي على أي منطق تحقق — القرار النهائي دائماً في الخادم.

export const SUITS = ['S', 'H', 'C', 'D'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GameMode = 'sun' | 'hokm';

export const SUIT_NAMES: Record<Suit, string> = { S: 'سبيت', H: 'هاص', C: 'شريا', D: 'ديمن' };
export const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const RANK_NAMES: Record<Rank, string> = {
  A: 'أكة', K: 'شايب', Q: 'بنت', J: 'ولد', '10': '10', '9': '9', '8': '8', '7': '7',
};

// الترتيب من الأقوى إلى الأضعف
export const SUN_ORDER: Rank[] = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];
export const TRUMP_ORDER: Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];

export const SUN_POINTS: Record<Rank, number> = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
export const TRUMP_POINTS: Record<Rank, number> = { J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0 };

export const LAST_TRICK_BONUS = 10; // الأرض
// أبناط الصن تُضاعف: (120 أوراق + 10 أرض) × 2 = 260
export const SUN_ABNAT_MULTIPLIER = 2;
// مجموع أبناط الصكة (أوراق + أرض) بعد مضاعفة الصن
export const HAND_TOTAL: Record<GameMode, number> = { sun: 260, hokm: 162 };
export const WINNING_SCORE = 152;
export const SUN_DOUBLE_THRESHOLD = 100;
export const MAX_PEOPLE_AT_TABLE = 15; // 4 لاعبين + 11 مشاهداً

export function cardPoints(card: Card, mode: GameMode, trump: Suit | null): number {
  return mode === 'hokm' && card.suit === trump ? TRUMP_POINTS[card.rank] : SUN_POINTS[card.rank];
}

/** قوة الورقة داخل لونها (رقم أكبر = أقوى). */
export function cardStrength(card: Card, mode: GameMode, trump: Suit | null): number {
  const order = mode === 'hokm' && card.suit === trump ? TRUMP_ORDER : SUN_ORDER;
  return order.length - order.indexOf(card.rank);
}

export function cardLabel(card: Card): string {
  return `${RANK_NAMES[card.rank]} ${SUIT_NAMES[card.suit]}`;
}

export function cardId(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;
/** الفريق 0 = المقعدان 0 و2 (اللاعب 1+3)، الفريق 1 = المقعدان 1 و3 (اللاعب 2+4). */
export const teamOf = (seat: Seat): Team => (seat % 2) as Team;
export const nextSeat = (seat: Seat, n = 1): Seat => ((seat + n) % 4) as Seat;
export const otherTeam = (team: Team): Team => (1 - team) as Team;
