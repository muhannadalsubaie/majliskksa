import {
  type Card, type Rank, type Seat, type Suit, SUITS, cardPoints, cardStrength, createDeck, sameCard, teamOf,
} from './cards';
import {
  type Action, type Bid, type GameState, availableBids, availableDouble, canDeclareBaloot, legalCardsFor,
} from './game';
import { trickWinner } from './play';

/**
 * الروبوت: يقيّم يده على أصول البلوت، ويتذكّر الأوراق التي نزلت في الصكة
 * (معلومات علنية فقط — لا ينظر أبداً في أوراق غيره)، ويختار حركة قانونية دائماً.
 * العتبات مضبوطة بمباريات تجريبية بين نسخ الروبوت (انظر bot.tuning.test.ts).
 */

export interface BotParams {
  /** أقل قوة يد ليشتري حكماً */
  hokm: number;
  /** أقل قوة يد ليشتري صن */
  sun: number;
  /** قوة إضافية مطلوبة لتجاوز حكم الشريك بصن */
  overPartner: number;
  /** عتبات الدبل والرفع */
  double: number;
  raise: number;
}

// مضبوطة بمباريات تجريبية (bot.tuning.test.ts) مع ميل للتحفظ أمام اللاعبين البشر:
// حكم ≈ ولد+تسعة، أو ولد مع حكم طويل وأكة جانبية. صن ≈ ثلاث أكات، أو أكتان مع عشرة وشايب.
export const DEFAULT_BOT: BotParams = { hokm: 3.8, sun: 3.8, overPartner: 4, double: 6.5, raise: 9 };

// ───── تقييم اليد ─────

const has = (hand: Card[], suit: Suit, rank: Rank) => hand.some((c) => c.suit === suit && c.rank === rank);

/**
 * قوة الحكم بلون معين (≈ عدد الأكلات المتوقعة):
 * الولد والتسعة من أقوى الأوراق، وطول لون الحكم مهم، والأكات الجانبية أكلات شبه مضمونة.
 */
export function hokmStrength(hand: Card[], trump: Suit): number {
  const trumps = hand.filter((c) => c.suit === trump);
  let s = 0;
  if (has(hand, trump, 'J')) s += 2.2;
  if (has(hand, trump, '9')) s += has(hand, trump, 'J') ? 1.6 : 1.1;
  if (has(hand, trump, 'A')) s += 1;
  if (has(hand, trump, '10')) s += 0.6;
  s += Math.max(0, trumps.length - 2) * 0.8; // كل ورقة حكم بعد الثانية قوة إضافية
  for (const suit of SUITS) {
    if (suit === trump) continue;
    if (has(hand, suit, 'A')) s += 1;
    if (has(hand, suit, 'A') && has(hand, suit, '10')) s += 0.6;
  }
  // لون فارغ مع حكم كافٍ = فرصة قطع
  const voids = SUITS.filter((x) => x !== trump && !hand.some((c) => c.suit === x)).length;
  if (trumps.length >= 3) s += voids * 0.5;
  return s;
}

/** قوة الصن (≈ عدد الأكلات المتوقعة): الأكات، والعشرات المحمية، والألوان الطويلة الكبيرة. */
export function sunStrength(hand: Card[]): number {
  let s = 0;
  for (const suit of SUITS) {
    const cards = hand.filter((c) => c.suit === suit);
    const a = has(hand, suit, 'A');
    const t = has(hand, suit, '10');
    const k = has(hand, suit, 'K');
    if (a) s += 1.3;
    if (t) s += a ? 1 : cards.length >= 2 ? 0.4 : 0;
    if (k) s += a && t ? 0.7 : 0.15;
    if (a && cards.length >= 4) s += 0.6 * (cards.length - 3);
  }
  return s;
}

// ───── ذاكرة الأوراق (علنية فقط) ─────

/** الأوراق التي لعبت في الصكة الحالية (لا في يد أي أحد ولا على الطاولة الآن). */
function playedCards(s: GameState): Card[] {
  const live = [...s.hands.flat(), ...s.trick.map((p) => p.card), ...s.stock];
  if (s.qaba && s.phase === 'bidding') live.push(s.qaba);
  return createDeck().filter((c) => !live.some((l) => sameCard(l, c)));
}

/** هل هذه الورقة أعلى ما بقي في لونها (بالنظر لما لُعب وما في يدي فقط)؟ */
function isMaster(card: Card, s: GameState, myHand: Card[], gone: Card[]): boolean {
  const { mode, trump } = s.contract!;
  const mine = cardStrength(card, mode, trump);
  return createDeck().every((c) =>
    c.suit !== card.suit
    || cardStrength(c, mode, trump) <= mine
    || gone.some((g) => sameCard(g, c))
    || myHand.some((h) => sameCard(h, c)));
}

// ───── المزايدة ─────

function chooseBid(s: GameState, seat: Seat, p: BotParams): Bid {
  const bids = availableBids(s, seat);
  const hand = s.hands[seat];
  const qaba = s.qaba!;
  const withQaba = [...hand, qaba]; // المشتري يأخذ القبلة

  // اختيار لون "الثاني"
  if (bids.every((b) => b.type === 'hokm')) {
    return bids.reduce((a, b) => (hokmStrength(withQaba, (b as { suit: Suit }).suit) > hokmStrength(withQaba, (a as { suit: Suit }).suit) ? b : a));
  }

  const partnerBid = s.hokmBid && teamOf(s.hokmBid.seat) === teamOf(seat);
  const sun = sunStrength(withQaba);
  const sunNeeded = p.sun + (partnerBid ? p.overPartner : 0);
  if (bids.some((b) => b.type === 'sun') && sun >= sunNeeded) return { type: 'sun' };

  // أشكل: لشريك الموزع إن كانت يده تصلح صناً والقبلة تقوّي الموزع
  if (bids.some((b) => b.type === 'ashkal') && sunStrength(hand) >= sunNeeded - 0.5 && qaba.rank === 'A') {
    return { type: 'ashkal' };
  }

  let best: { bid: Bid; score: number } | null = null;
  for (const b of bids) {
    if (b.type !== 'hokm') continue;
    const score = hokmStrength(b.suit === qaba.suit ? withQaba : hand, b.suit);
    if (score >= p.hokm && (!best || score > best.score)) best = { bid: b, score };
  }
  if (best) return best.bid;

  if (bids.some((b) => b.type === 'secondHokm')) {
    const strong = SUITS.some((suit) => suit !== qaba.suit && hokmStrength(withQaba, suit) >= p.hokm + 0.5);
    if (strong) return { type: 'secondHokm' };
  }
  return { type: 'pass' };
}

function chooseDouble(s: GameState, seat: Seat, p: BotParams): Action {
  const option = availableDouble(s, seat);
  const c = s.contract!;
  const hand = s.hands[seat];
  // الخصم يقيس قوته ضد لون الحكم نفسه؛ المشتري يقيس قوة يده
  const strength = c.mode === 'hokm' ? hokmStrength(hand, c.trump!) : sunStrength(hand);
  const need = option?.label === 'دبل' ? p.double : option?.label === 'قهوة' ? p.raise + 2 : p.raise;
  if (option && strength >= need) {
    // مقفل إذا كانت أوراق الحكم القوية عندنا (يمنع المشتري من سحب الحكم)
    const locked = c.mode === 'hokm' && (has(hand, c.trump!, 'J') || has(hand, c.trump!, '9'));
    return { type: 'double', seat, locked: option.needsLockChoice ? locked : undefined };
  }
  return { type: 'doublePass', seat };
}

// ───── اللعب ─────

function choosePlay(s: GameState, seat: Seat): Card {
  const legal = legalCardsFor(s, seat);
  if (legal.length === 1) return legal[0];
  const { mode, trump } = s.contract!;
  const hand = s.hands[seat];
  const gone = playedCards(s);
  const isTrump = (c: Card) => mode === 'hokm' && c.suit === trump;
  const pts = (c: Card) => cardPoints(c, mode, trump);
  const str = (c: Card) => cardStrength(c, mode, trump);
  const cheapest = (cards: Card[]) => [...cards].sort((a, b) => pts(a) - pts(b) || str(a) - str(b))[0];
  const nonTrumpCheapest = cheapest(legal.filter((c) => !isTrump(c))) ?? cheapest(legal);
  const buyerTeam = teamOf(s.contract!.buyer) === teamOf(seat);

  // ── الافتتاح ──
  if (s.trick.length === 0) {
    // سحب الحكم: فريق المشتري يبدأ بالحكم الأعلى المتبقي إن كان معه
    if (mode === 'hokm' && buyerTeam) {
      const masterTrump = legal.find((c) => isTrump(c) && isMaster(c, s, hand, gone));
      const trumpsLeftOutside = createDeck().filter((c) => c.suit === trump && !gone.some((g) => sameCard(g, c)) && !hand.some((h) => sameCard(h, c))).length;
      if (masterTrump && trumpsLeftOutside > 0) return masterTrump;
    }
    // ورقة سيدة (أعلى ما بقي) من لون غير الحكم
    const masters = legal.filter((c) => !isTrump(c) && isMaster(c, s, hand, gone));
    if (masters.length) return [...masters].sort((a, b) => pts(b) - pts(a))[0];
    // وإلا أصغر ورقة من أطول لون (حتى لا نفرّط بالكبار)
    const bySuitLen = (c: Card) => hand.filter((h) => h.suit === c.suit).length;
    const small = legal.filter((c) => !isTrump(c) && pts(c) === 0);
    if (small.length) return [...small].sort((a, b) => bySuitLen(b) - bySuitLen(a) || str(a) - str(b))[0];
    return nonTrumpCheapest;
  }

  // ── المتابعة ──
  const winner = trickWinner(s.trick, mode, trump);
  const partnerWinning = teamOf(winner) === teamOf(seat);
  const last = s.trick.length === 3;
  const trickPoints = s.trick.reduce((sum, p) => sum + pts(p.card), 0);
  const winners = legal.filter((c) => trickWinner([...s.trick, { seat, card: c }], mode, trump) === seat);

  if (partnerWinning) {
    const partnerCard = s.trick.find((p) => p.seat === winner)!.card;
    const partnerSafe = last || isMaster(partnerCard, s, hand, gone) || isTrump(partnerCard);
    if (partnerSafe) {
      // الشريك رابح: نعطيه نقاطاً بدون التفريط بالحكم
      const feed = legal.filter((c) => !isTrump(c)).sort((a, b) => pts(b) - pts(a));
      if (feed.length) return feed[0];
    }
    return nonTrumpCheapest;
  }

  if (winners.length) {
    // آخر لاعب: نفوز بأرخص ورقة. غير ذلك: نفوز إن كانت ورقتنا سيدة أو الأكلة ثمينة
    const cheapWin = cheapest(winners);
    if (last) return cheapWin;
    const masterWin = winners.find((c) => isMaster(c, s, hand, gone));
    if (masterWin) return masterWin;
    if (trickPoints >= 10 || s.trickNo === 7) return cheapWin;
  }
  // لا نستطيع الفوز (أو لا يستحق): نرمي أرخص ورقة
  return nonTrumpCheapest;
}

/** الحركة التالية للروبوت في هذا المقعد (أو null إن لم يكن دوره). */
export function botAction(s: GameState, seat: Seat, params: BotParams = DEFAULT_BOT): Action | null {
  if (s.phase === 'bidding' && s.turn === seat && s.qaba) return { type: 'bid', seat, bid: chooseBid(s, seat, params) };
  if (s.phase === 'doubling' && s.doubling.awaitingTeam === teamOf(seat) && !s.doubling.passed.includes(seat)) {
    return chooseDouble(s, seat, params);
  }
  if (s.phase === 'playing') {
    if (canDeclareBaloot(s, seat)) return { type: 'declareBaloot', seat };
    if (s.turn !== seat || s.trickNo >= 8) return null;
    return { type: 'play', seat, card: choosePlay(s, seat) };
  }
  return null;
}

