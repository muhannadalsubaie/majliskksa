import {
  type Card, type Rank, type Seat, type Suit, SUITS, cardPoints, cardStrength, createDeck, nextSeat, sameCard, teamOf,
} from './cards';
import {
  type Action, type Bid, type GameState, availableBids, availableDouble, isDoublingTurn, isLockChoiceTurn, legalCardsFor,
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
  /** لعب متقدم: يتذكّر من خلص عنده لون (علناً)، ويختار الافتتاح والرمي كما يلعب الخبير */
  smart?: boolean;
  /** اللعب الخبير: التهريب وقراءته، والسيدات أول (الأكبر أول)، وحساب القطع، والقطع بأصغر حكم يكفي */
  expert?: boolean;
}

// مضبوطة بمباريات تجريبية (bot.tuning.test.ts و bot.compare.test.ts) مع ميل للتحفظ أمام اللاعبين البشر:
// حكم ≈ ولد مع تسعة أو أكة، أو ولد مع حكم طويل. صن ≈ ثلاث أكات، أو أكتان مع عشرة وشايب.
// مع اللعب المتقدم وعتبة الحكم 3.4 يفوز على النسخة السابقة (3.8 بلا لعب متقدم) في ≈59% من المباريات.
// والخبير (التهريب وقراءته، السيدات أول، حساب القطع، تقييم أشمل للشراء، دبل بأكلات الدفاع) يفوز على «المتقدم» في ≈55% (600 مباراة).
export const DEFAULT_BOT: BotParams = { hokm: 3.4, sun: 3.8, overPartner: 4, double: 6.5, raise: 9, smart: true, expert: true };

/** النسخة السابقة (للمقارنة فقط) */
export const PREVIOUS_BOT: BotParams = { hokm: 3.4, sun: 3.8, overPartner: 4, double: 6.5, raise: 9, smart: true };

// ───── تقييم اليد ─────

const has = (hand: Card[], suit: Suit, rank: Rank) => hand.some((c) => c.suit === suit && c.rank === rank);

/**
 * قوة الحكم بلون معين (≈ عدد الأكلات المتوقعة):
 * الولد والتسعة من أقوى الأوراق، وطول لون الحكم مهم، والأكات الجانبية أكلات شبه مضمونة.
 */
export function hokmStrength(hand: Card[], trump: Suit): number { return hokmStrengthBase(hand, trump); }
function hokmStrengthBase(hand: Card[], trump: Suit): number {
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

/**
 * تقييم الحكم الكامل (للروبوت الخبير): نفس أساس hokmStrength مع اليد كاملة —
 * الحكم بدون ولد ولا تسعة ضعيف، والعشرة والشايب مع الإكة الجانبية، والزات الطويل مع الإكة، والفردة الجانبية مع حكم كافٍ.
 */
export function hokmStrengthPro(hand: Card[], trump: Suit): number {
  const trumps = hand.filter((c) => c.suit === trump);
  const J = has(hand, trump, 'J'), N = has(hand, trump, '9');
  let s = 0;
  if (J) s += 2.2;
  if (N) s += J ? 1.6 : 1.1;
  if (has(hand, trump, 'A')) s += J || N || trumps.length >= 3 ? 1 : 0.7;
  if (has(hand, trump, '10')) s += J || has(hand, trump, 'A') ? 0.6 : 0.4;
  s += Math.max(0, trumps.length - 2) * 0.8;
  if (!J && !N) s -= 0.8;
  for (const suit of SUITS) {
    if (suit === trump) continue;
    const len = hand.filter((c) => c.suit === suit).length;
    const a = has(hand, suit, 'A'), t = has(hand, suit, '10'), k = has(hand, suit, 'K');
    if (a) s += 1;
    if (a && t) s += 0.6;
    if (a && t && k) s += 0.3;
    if (!a && t && k) s += 0.3;
    if (a && len >= 4) s += 0.3;
    if (trumps.length >= 3) s += len === 0 ? 0.5 : len === 1 && !a ? 0.25 : 0;
  }
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

  const hokmStrength = p.expert ? hokmStrengthPro : hokmStrengthBase;
  const sun = sunStrength(withQaba);
  // صاحب "الثاني" بعد أن قال الجميع بس: تأكيد الحكم أو صن (إن كانت اليد أقوى صناً بوضوح)، ثم أقوى لون
  if (s.secondHokm?.remaining === 0) {
    const others = SUITS.filter((suit) => suit !== qaba.suit);
    const bestSuit = others.reduce((a, b) => (hokmStrength(withQaba, b) > hokmStrength(withQaba, a) ? b : a));
    if (!s.secondHokm.confirmed) return sun >= p.sun + 1 && sun > hokmStrength(withQaba, bestSuit) ? { type: 'sun' } : { type: 'confirmHokm' };
    return { type: 'hokm', suit: bestSuit };
  }
  // تأكيد الحكم بعد أن قال الجميع بس: نحوّل صن فقط إن كانت اليد أقوى صناً بوضوح
  if (bids.some((b) => b.type === 'confirmHokm')) {
    const trump = s.hokmBid!.suit;
    return sun >= p.sun + 1 && sun > hokmStrength(withQaba, trump) ? { type: 'sun' } : { type: 'confirmHokm' };
  }
  // قبلك: نأخذ الصن من اللاعب الذي بعدنا إن كانت يدنا تصلح صناً (والقائل ليس شريكنا)
  if (bids.some((b) => b.type === 'qablak')) {
    const callerIsPartner = s.sunClaim && teamOf(s.sunClaim.caller) === teamOf(seat);
    return !callerIsPartner && sun >= p.sun + 0.5 ? { type: 'qablak' } : { type: 'pass' };
  }

  const partnerBid = s.hokmBid && teamOf(s.hokmBid.seat) === teamOf(seat);
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

/** مقفل إذا كانت أوراق الحكم القوية عندنا (يمنع المشتري من سحب الحكم) */
function wantsLock(s: GameState, seat: Seat): boolean {
  const c = s.contract!;
  const hand = s.hands[seat];
  return c.mode === 'hokm' && (has(hand, c.trump!, 'J') || has(hand, c.trump!, '9'));
}

/**
 * أكلات الدفاع المتوقعة ضد المشتري (للدبل): ما يعتمد على الحظ، بس الأوراق اللي تاكل فعلاً ضد العقد.
 * في الحكم: الولد، والتسعة (مع الولد أو مع حكم طويل)، والحكم الطويل، والأكات الجانبية.
 * في الصن: الأكات، والعشرة مع الإكة، والزات الطويل مع الإكة.
 */
export function defenseTricks(hand: Card[], mode: 'sun' | 'hokm', trump: Suit | null): number {
  let t = 0;
  if (mode === 'hokm') {
    const trumps = hand.filter((c) => c.suit === trump).length;
    if (has(hand, trump!, 'J')) t += 1;
    if (has(hand, trump!, '9')) t += has(hand, trump!, 'J') || trumps >= 3 ? 1 : 0.4;
    if (has(hand, trump!, 'A') && trumps >= 3) t += 0.5;
    t += Math.max(0, trumps - 3) * 0.6;
    for (const suit of SUITS) {
      if (suit === trump) continue;
      const len = hand.filter((c) => c.suit === suit).length;
      // الإكة الجانبية: لو الزات طويل تنقطع أسرع
      if (has(hand, suit, 'A')) t += len >= 5 ? 0.6 : 0.9;
      if (has(hand, suit, 'A') && has(hand, suit, '10') && len <= 4) t += 0.6;
    }
    return t;
  }
  for (const suit of SUITS) {
    const len = hand.filter((c) => c.suit === suit).length;
    const a = has(hand, suit, 'A'), ten = has(hand, suit, '10');
    if (a) t += 1;
    if (a && ten) t += 0.9;
    else if (ten && has(hand, suit, 'K')) t += 0.4;
    if (a && len >= 4) t += 0.5 * (len - 3);
  }
  return t;
}

function chooseDoubleExpert(s: GameState, seat: Seat, p: BotParams): Action {
  const option = availableDouble(s, seat);
  const c = s.contract!;
  if (!option) return { type: 'doublePass', seat };
  const buyerSide = teamOf(c.buyer) === teamOf(seat);
  const hand = c.qabaTo === seat && s.hands[seat].length < 8 && s.qaba ? [...s.hands[seat], s.qaba] : s.hands[seat];
  const scale = 8 / Math.max(hand.length, 1);
  let go: boolean;
  if (buyerSide) {
    // المشتري يرفع (ثري/قهوة) بس لو يده قوية جداً
    const raw = c.mode === 'hokm' ? hokmStrength(hand, c.trump!) : sunStrength(hand);
    go = raw * scale >= (option.label === 'قهوة' ? p.raise + 2 : p.raise);
  } else {
    // الخصم يدبّل (أو يرفع فور) بس لو يده قوية فعلاً ضد الحاكم: أكلات مضمونة كافية
    const d = defenseTricks(hand, c.mode, c.trump ?? null) * scale;
    const strongTrump = c.mode === 'sun' || has(hand, c.trump!, 'J') || (has(hand, c.trump!, '9') && hand.filter((x) => x.suit === c.trump).length >= 3);
    go = strongTrump && d >= (option.label === 'دبل' ? 4.6 : 5.6);
  }
  if (!go) return { type: 'doublePass', seat };
  return { type: 'double', seat, locked: option.needsLockChoice ? wantsLock(s, seat) : undefined };
}

function chooseDouble(s: GameState, seat: Seat, p: BotParams): Action {
  if (p.expert) return chooseDoubleExpert(s, seat, p);
  const option = availableDouble(s, seat);
  const c = s.contract!;
  // الدبل قبل توزيع بقية الورق: المشتري (أو صاحب القبلة) يعرف أن ورقة الأرض له
  const hand = c.qabaTo === seat && s.hands[seat].length < 8 && s.qaba ? [...s.hands[seat], s.qaba] : s.hands[seat];
  // الخصم يقيس قوته ضد لون الحكم نفسه؛ المشتري يقيس قوة يده — مقدّرة لثماني أوراق
  const raw = c.mode === 'hokm' ? hokmStrength(hand, c.trump!) : sunStrength(hand);
  const strength = raw * (8 / Math.max(hand.length, 1));
  const need = option?.label === 'دبل' ? p.double : option?.label === 'قهوة' ? p.raise + 2 : p.raise;
  if (option && strength >= need) {
    // مقفل إذا كانت أوراق الحكم القوية عندنا (يمنع المشتري من سحب الحكم)
    const locked = wantsLock(s, seat);
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

/**
 * اللعب المتقدم: نفس أصول choosePlay، مع ما يعرفه اللاعب الخبير من اللعب العلني:
 * من خلص عنده لون (فلا نفتح لوناً يقطعه الخصم، ونفتح لوناً يقطعه الشريك)، ومتى تكون أكلة الشريك مضمونة،
 * والرمي من اللون القصير مع الاحتفاظ بالأوراق السيدة والعشرة المحمية.
 */
function choosePlaySmart(s: GameState, seat: Seat): Card {
  const legal = legalCardsFor(s, seat);
  if (legal.length === 1) return legal[0];
  const { mode, trump } = s.contract!;
  const hand = s.hands[seat];
  const gone = playedCards(s);
  const isTrump = (c: Card) => mode === 'hokm' && c.suit === trump;
  const pts = (c: Card) => cardPoints(c, mode, trump);
  const str = (c: Card) => cardStrength(c, mode, trump);
  const partner = nextSeat(seat, 2);
  const opps = [nextSeat(seat, 1), nextSeat(seat, 3)];
  const isVoid = (p: Seat, suit: Suit) => s.voids?.[p]?.includes(suit) ?? false;
  // أوراق لون ما زالت خارج يدي ولم تُلعب
  const outside = (suit: Suit) => createDeck().filter((c) => c.suit === suit && !gone.some((g) => sameCard(g, c)) && !hand.some((h) => sameCard(h, c)) && !s.trick.some((p) => sameCard(p.card, c)));
  const oppsHaveTrump = mode === 'hokm' && outside(trump!).length > 0 && opps.some((o) => !isVoid(o, trump!));
  // الخصم يقدر يقطع هذا اللون: خلص عنده وما خلص حكمه
  const oppCuts = (suit: Suit, who = opps) => mode === 'hokm' && suit !== trump && oppsHaveTrump && who.some((o) => isVoid(o, suit) && !isVoid(o, trump!));
  const master = (c: Card) => isMaster(c, s, hand, gone);
  const suitLen = (suit: Suit) => hand.filter((h) => h.suit === suit).length;
  // العشرة المحمية في الصن: ما نرميها والأكة لسا برا
  const guarded10 = (c: Card) => c.rank === '10' && !isTrump(c) && !has(hand, c.suit, 'A') && outside(c.suit).some((x) => x.rank === 'A');
  const cheapest = (cards: Card[]) => [...cards].sort((a, b) => pts(a) - pts(b) || str(a) - str(b))[0];
  /** الرمي: أقل نقاط، بلا أوراق سيدة ولا عشرة محمية إن أمكن، ومن أقصر لون (يفتح باب القطع في الحكم) */
  const discard = () => {
    const pool = legal.filter((c) => !isTrump(c));
    const base = pool.length ? pool : legal;
    const keep = base.filter((c) => !master(c) && !guarded10(c));
    const from = keep.length ? keep : base;
    return [...from].sort((a, b) => pts(a) - pts(b) || suitLen(a.suit) - suitLen(b.suit) || str(a) - str(b))[0];
  };
  const buyerTeam = teamOf(s.contract!.buyer) === teamOf(seat);

  // ── الافتتاح ──
  if (s.trick.length === 0) {
    // سحب الحكم: فريق المشتري يبدأ بالحكم الأعلى إن كان عند الخصوم حكم
    if (mode === 'hokm' && buyerTeam && oppsHaveTrump) {
      const masterTrump = legal.find((c) => isTrump(c) && master(c));
      if (masterTrump) return masterTrump;
      // حكمنا أكثر من حكم الخصوم: نسحبه بأصغر حكم
      const myTrumps = legal.filter(isTrump);
      if (myTrumps.length > outside(trump!).length && myTrumps.length >= 3) return cheapest(myTrumps);
    }
    // ورقة سيدة من لون ما يقطعه الخصم
    const masters = legal.filter((c) => !isTrump(c) && master(c) && !oppCuts(c.suit));
    if (masters.length) return [...masters].sort((a, b) => pts(b) - pts(a))[0];
    // لون خلص عند الشريك وعنده حكم، وما يقطعه الخصم: نفتحه بأصغر ورقة فيقطع الشريك
    if (mode === 'hokm' && !isVoid(partner, trump!)) {
      const forPartner = legal.filter((c) => !isTrump(c) && isVoid(partner, c.suit) && !oppCuts(c.suit) && !guarded10(c));
      if (forPartner.length) return cheapest(forPartner);
    }
    // أصغر ورقة من أطول لون آمن (ما يقطعه الخصم، وبلا عشرة محمية)
    const small = legal.filter((c) => !isTrump(c) && pts(c) === 0 && !oppCuts(c.suit));
    if (small.length) return [...small].sort((a, b) => suitLen(b.suit) - suitLen(a.suit) || str(a) - str(b))[0];
    return discard();
  }

  // ── المتابعة ──
  const winner = trickWinner(s.trick, mode, trump);
  const partnerWinning = teamOf(winner) === teamOf(seat);
  const last = s.trick.length === 3;
  const led = s.trick[0].card.suit;
  const trickPoints = s.trick.reduce((sum, p) => sum + pts(p.card), 0);
  const winners = legal.filter((c) => trickWinner([...s.trick, { seat, card: c }], mode, trump) === seat);
  // الخصم اللي يلعب بعدي في هذه الأكلة (إن بقي أحد)
  const nextOpp = s.trick.length < 3 ? [nextSeat(seat)] : [];

  if (partnerWinning) {
    const partnerCard = s.trick.find((p) => p.seat === winner)!.card;
    // أكلة الشريك مضمونة: آخر واحد، أو ورقته سيدة (وما يقطعها الخصم اللي بعدي)، أو الخصم اللي بعدي ما يقدر يغلبها
    const nextCanCut = isTrump(partnerCard) ? false : oppCuts(led, nextOpp);
    const nextIsOut = nextOpp.every((o) => isVoid(o, led) && (mode === 'sun' || isTrump(partnerCard) || isVoid(o, trump!)));
    const partnerSafe = last || (master(partnerCard) && !nextCanCut) || nextIsOut;
    if (partnerSafe) {
      // نعطيه نقاطاً بدون التفريط بالحكم، ونقدّم غير السيدة
      const feed = legal.filter((c) => !isTrump(c)).sort((a, b) => Number(master(a)) - Number(master(b)) || pts(b) - pts(a));
      if (feed.length) return feed[0];
    }
    // غير مضمونة والأكلة ثمينة: نضمنها بورقة سيدة ما تنقطع
    const secure = winners.filter((c) => master(c) && (isTrump(c) || !oppCuts(led, nextOpp)));
    if (!partnerSafe && secure.length) return cheapest(secure);
    return discard();
  }

  if (winners.length) {
    const cheapWin = cheapest(winners);
    if (last) return cheapWin;
    // نفوز بورقة سيدة ما يقطعها الخصم اللي بعدي
    const safeMaster = winners.filter((c) => master(c) && (isTrump(c) || !oppCuts(led, nextOpp)));
    if (safeMaster.length) return cheapest(safeMaster);
    if (trickPoints >= 10 || s.trickNo === 7) return cheapWin;
  }
  return discard();
}

// ───── اللعب الخبير: التهريب وقراءته، وعدّ الورق، وحساب القطع ─────

/** أخو الزات: الديمن والهاص إخوان، والسبيت والشريا إخوان */
export const brotherOf = (suit: Suit): Suit => ({ S: 'C', C: 'S', H: 'D', D: 'H' } as const)[suit];

/** ورقة كبيرة في التهريب: الإكة والعشرة والشايب والبنت (ترتيب الصن) */
const isBigSignal = (c: Card) => c.rank === 'A' || c.rank === '10' || c.rank === 'K' || c.rank === 'Q';

/**
 * وش يبي الشريك (من تهريبه وهو ماسك الأكلة فقط، والتهريب وقت ما الأكلة مو له ما يُقرأ):
 *  • هرّب ورقة كبيرة من زات ← يبي أخوها. ومن الكبير للصغير في نفس الزات ← يتأكد إنه يبي الأخ.
 *  • من الصغير للكبير في نفس الزات ← يبي نفس الزات.
 *  • هرّب من الزاتين الإخوان (مثلاً هاص وديمن واللعب سبيت) ← يبي أخو الزات الملعوب.
 *  • هرّب الإكة ← يبي نفس الزات (معه العشرة: «تعال معي العشرة»).
 * آخر إشارة واضحة هي المعتمدة، وما نرجع إشارة لزات ما عنده (بان إنه خلص) أو للحكم.
 */
export function partnerWants(s: GameState, seat: Seat): Suit | null {
  const partner = nextSeat(seat, 2);
  const { mode, trump } = s.contract!;
  const mine = (s.discards ?? []).filter((d) => d.seat === partner && d.toPartner);
  if (!mine.length) return null;
  const ok = (x: Suit) => !(mode === 'hokm' && x === trump);
  let want: Suit | null = null;
  const seen: Record<string, Card[]> = {};
  for (const d of mine) {
    const suit = d.card.suit;
    const prev = seen[suit] ?? [];
    seen[suit] = [...prev, d.card];
    const bro = brotherOf(suit);
    if (d.card.rank === 'A') { want = suit; continue; }
    if ((seen[bro] ?? []).length) {
      // هرّب من الزاتين الإخوان: يبي أخو الزات الملعوب
      want = brotherOf(d.led);
      continue;
    }
    if (prev.length) {
      const before = prev[prev.length - 1];
      const up = cardStrength(d.card, 'sun', null) > cardStrength(before, 'sun', null);
      want = up ? suit : bro;
      continue;
    }
    if (isBigSignal(d.card)) want = bro;
  }
  if (!want || !ok(want)) return null;
  // بان إن الشريك خلص منه: ما عاد يبيه
  if (s.voids?.[partner]?.includes(want)) return null;
  return want;
}

export function choosePlayExpert(s: GameState, seat: Seat): Card {
  const legal = legalCardsFor(s, seat);
  if (legal.length === 1) return legal[0];
  const { mode, trump } = s.contract!;
  const hand = s.hands[seat];
  const gone = playedCards(s);
  const isTrump = (c: Card) => mode === 'hokm' && c.suit === trump;
  const pts = (c: Card) => cardPoints(c, mode, trump);
  const str = (c: Card) => cardStrength(c, mode, trump);
  const partner = nextSeat(seat, 2);
  const opps = [nextSeat(seat, 1), nextSeat(seat, 3)] as Seat[];
  const isVoid = (p: Seat, suit: Suit) => s.voids?.[p]?.includes(suit) ?? false;
  // أوراق ما نعرف مكانها: لا انلعبت ولا معي ولا على الطاولة
  const outside = (suit: Suit) => createDeck().filter((c) => c.suit === suit && !gone.some((g) => sameCard(g, c)) && !hand.some((h) => sameCard(h, c)) && !s.trick.some((p) => sameCard(p.card, c)));
  // حكم الخصوم: باقي حكم برا، وواحد منهم على الأقل ما بان إنه خلص حكمه
  const oppsHaveTrump = mode === 'hokm' && outside(trump!).length > 0 && opps.some((o) => !isVoid(o, trump!));
  // خطر القطع على زات: الخصم خلص منه وعنده حكم، أو أغلب ورق الزات طلع (باقي برا ورقتين أو أقل)
  const cutRisk = (suit: Suit, who: Seat[] = opps) => mode === 'hokm' && suit !== trump && oppsHaveTrump
    && (who.some((o) => isVoid(o, suit) && !isVoid(o, trump!)) || outside(suit).length <= 2);
  const master = (c: Card) => isMaster(c, s, hand, gone);
  const suitLen = (suit: Suit) => hand.filter((h) => h.suit === suit).length;
  const guarded10 = (c: Card) => c.rank === '10' && !isTrump(c) && !has(hand, c.suit, 'A') && outside(c.suit).some((x) => x.rank === 'A');
  const cheapest = (cards: Card[]) => [...cards].sort((a, b) => pts(a) - pts(b) || str(a) - str(b))[0];
  const strongest = (cards: Card[]) => [...cards].sort((a, b) => str(b) - str(a))[0];
  const buyerTeam = teamOf(s.contract!.buyer) === teamOf(seat);
  /** الرمي وقت الأكلة مو لنا: أصغر ورقة (بدون إشارة غلط)، بلا حكم ولا سيدة ولا عشرة محمية ولا إكة */
  const lowest = () => {
    const pool = legal.filter((c) => !isTrump(c));
    const base = pool.length ? pool : legal;
    const keep = base.filter((c) => !master(c) && !guarded10(c) && c.rank !== 'A');
    const from = keep.length ? keep : base;
    return [...from].sort((a, b) => pts(a) - pts(b) || str(a) - str(b) || suitLen(a.suit) - suitLen(b.suit))[0];
  };

  // ── الافتتاح ──
  if (s.trick.length === 0) {
    // ١) فريق المشتري في الحكم: نسحب حكم الخصوم بالحكم السيد، ونوقف إذا خلص حكمهم
    if (mode === 'hokm' && buyerTeam && oppsHaveTrump) {
      const masterTrump = legal.filter((c) => isTrump(c) && master(c));
      if (masterTrump.length) return strongest(masterTrump);
      const myTrumps = legal.filter(isTrump);
      if (myTrumps.length > outside(trump!).length && myTrumps.length >= 3) return cheapest(myTrumps);
    }
    // ٢) الأوراق الحرة (السيدة) أول، من زات ما ينقطع، والأكبر أول في نفس الزات (الإكة قبل العشرة)
    const masters = legal.filter((c) => !isTrump(c) && master(c) && !cutRisk(c.suit));
    if (masters.length) return [...masters].sort((a, b) => str(b) - str(a) || pts(b) - pts(a))[0];
    // ٣) نلبّي تهريب الشريك: ورقة صغيرة من الزات اللي يبيه (ما نفتحه بورقة كبيرة)
    const want = partnerWants(s, seat);
    if (want) {
      const ofWant = legal.filter((c) => c.suit === want && !isTrump(c));
      if (ofWant.length && !(mode === 'hokm' && cutRisk(want, opps) && opps.some((o) => isVoid(o, want)))) return cheapest(ofWant);
    }
    // ٤) زات خلص عند الشريك وعنده حكم (وما يقطعه الخصم): نفتحه صغير فيقطع الشريك
    if (mode === 'hokm' && !isVoid(partner, trump!)) {
      const forPartner = legal.filter((c) => !isTrump(c) && isVoid(partner, c.suit) && !opps.some((o) => isVoid(o, c.suit) && !isVoid(o, trump!)) && !guarded10(c) && c.rank !== 'A');
      if (forPartner.length) return cheapest(forPartner);
    }
    // ٥) أصغر ورقة من أطول زات آمن
    const small = legal.filter((c) => !isTrump(c) && pts(c) === 0 && !cutRisk(c.suit));
    if (small.length) return [...small].sort((a, b) => suitLen(b.suit) - suitLen(a.suit) || str(a) - str(b))[0];
    return lowest();
  }

  // ── المتابعة ──
  const winner = trickWinner(s.trick, mode, trump);
  const partnerWinning = teamOf(winner) === teamOf(seat);
  const last = s.trick.length === 3;
  const led = s.trick[0].card.suit;
  const trickPoints = s.trick.reduce((sum, p) => sum + pts(p.card), 0);
  const winners = legal.filter((c) => trickWinner([...s.trick, { seat, card: c }], mode, trump) === seat);
  // اللاعبين اللي بعدي في هذه الأكلة
  const after = ([1, 2, 3] as const).slice(0, 3 - s.trick.length).map((n) => nextSeat(seat, n));
  const oppsAfter = after.filter((p) => teamOf(p) !== teamOf(seat));
  const following = legal.some((c) => c.suit === led);

  if (partnerWinning) {
    const partnerCard = s.trick.find((p) => p.seat === winner)!.card;
    // أكلة الشريك مضمونة: آخر واحد، أو ورقته سيدة وما يقطعها اللي بعدي، أو اللي بعدي ما يقدر يغلبها
    const nextCanCut = isTrump(partnerCard) ? false : oppsAfter.some((o) => mode === 'hokm' && isVoid(o, led) && !isVoid(o, trump!) && oppsHaveTrump);
    const partnerTop = isTrump(partnerCard)
      ? outside(trump!).every((c) => str(c) < str(partnerCard))
      : master(partnerCard);
    const nextIsOut = oppsAfter.every((o) => isVoid(o, led) && (mode === 'sun' || isTrump(partnerCard) || isVoid(o, trump!)));
    const partnerSafe = last || oppsAfter.length === 0 || (partnerTop && !nextCanCut) || nextIsOut;
    if (partnerSafe) {
      if (!following) {
        // تهريب لخوينا (هو ماسك الأكلة): نعلّمه وش نبي
        const sig = signalCard(legal);
        if (sig) return sig;
      }
      // نعطيه أبناط بدون ما نضيّع حكم، ولا سيدة، ولا إكة
      const feed = legal.filter((c) => !isTrump(c)).sort((a, b) => Number(master(a) || a.rank === 'A') - Number(master(b) || b.rank === 'A') || pts(b) - pts(a));
      if (feed.length) return feed[0];
      return cheapest(legal);
    }
    // مو مضمونة والأكلة ثمينة: نضمنها بورقة سيدة ما تنقطع
    // (بالحكم بس لو الأكلة فيها أبناط)
    const secure = winners.filter((c) => master(c) && (isTrump(c) ? trickPoints >= 10 : !cutRisk(led, oppsAfter)));
    if (secure.length) return cheapest(secure);
    return lowest();
  }

  // الخصم ماسك الأكلة
  if (winners.length) {
    if (last) return cheapest(winners);
    const trumpWins = winners.filter(isTrump);
    const plainWins = winners.filter((c) => !isTrump(c));
    // نفوز بورقة سيدة ما يقطعها اللي بعدي، والأكبر أول لو معي أكثر من سيدة في الزات (الإكة قبل العشرة)
    const safeMasters = plainWins.filter((c) => master(c) && !cutRisk(led, oppsAfter));
    if (safeMasters.length) return safeMasters.length > 1 ? strongest(safeMasters) : safeMasters[0];
    if (plainWins.length && (trickPoints >= 10 || s.trickNo === 7)) return cheapest(plainWins);
    if (trumpWins.length) {
      // القطع: بأصغر حكم يكفي (ويغلب أي حكم ممكن يجي بعدي لو نقدر)، وما نقطع أكلة فاضية لو نحتاج الحكم بعدين
      const optional = legal.some((c) => !isTrump(c));
      const needTrumpLater = buyerTeam && oppsHaveTrump && hand.filter(isTrump).length <= outside(trump!).length;
      if (optional && trickPoints < 5 && needTrumpLater) return lowest();
      const topOutside = Math.max(0, ...outside(trump!).map(str));
      const unbeatable = trumpWins.filter((c) => str(c) > topOutside);
      const othersCanOvercut = oppsAfter.some((o) => isVoid(o, led) && !isVoid(o, trump!));
      if (othersCanOvercut && unbeatable.length) return cheapest(unbeatable);
      return cheapest(trumpWins);
    }
  }
  return lowest();

  /** التهريب لخوينا وهو ماسك: نختار ورقة توصّل له الزات اللي نبيه */
  function signalCard(cards: Card[]): Card | null {
    const plain = cards.filter((c) => !isTrump(c));
    if (!plain.length) return null;
    // الإكة والعشرة من نفس الزات والحاكم خصم (في الحكم): نهرّب الإكة = «تعال معي العشرة»
    if (mode === 'hokm' && !buyerTeam) {
      const aceSig = plain.find((c) => c.rank === 'A' && has(hand, c.suit, '10') && outside(c.suit).length >= 2);
      if (aceSig) return aceSig;
    }
    // زات نبيه: معنا فيه ورقة سيدة وورقة ثانية (نقدر ناكل فيه أكثر من مرة)
    const wanted = SUITS.filter((x) => !(mode === 'hokm' && x === trump) && x !== led && hand.some((h) => h.suit === x && master(h)) && suitLen(x) >= 2);
    for (const w of wanted) {
      // ورقة كبيرة (مو إكة ولا سيدة) من أخو الزات اللي نبيه
      const bro = plain.filter((c) => c.suit === brotherOf(w) && isBigSignal(c) && c.rank !== 'A' && !master(c));
      if (bro.length) return strongest(bro);
    }
    return null;
  }
}

/** الحركة التالية للروبوت في هذا المقعد (أو null إن لم يكن دوره). */
export function botAction(s: GameState, seat: Seat, params: BotParams = DEFAULT_BOT): Action | null {
  if (s.phase === 'bidding' && s.turn === seat && s.qaba) return { type: 'bid', seat, bid: chooseBid(s, seat, params) };
  if (isDoublingTurn(s, seat)) {
    return chooseDouble(s, seat, params);
  }
  // حلّ روبوت مكان لاعب أعلن الدبل ولم يختر بعد
  if (isLockChoiceTurn(s, seat)) return { type: 'doubleLock', seat, locked: wantsLock(s, seat) };
  if (s.phase === 'playing') {
    if (s.turn !== seat || s.trickNo >= 8) return null;
    const card = params.expert ? choosePlayExpert(s, seat) : params.smart ? choosePlaySmart(s, seat) : choosePlay(s, seat);
    // حماية: لو لأي سبب طلعت ورقة غير قانونية، نرجع لأول ورقة قانونية
    const legal = legalCardsFor(s, seat);
    return { type: 'play', seat, card: legal.some((c) => sameCard(c, card)) ? card : legal[0] };
  }
  return null;
}

