import {
  type Card, type GameMode, type Seat, type Suit, type Team,
  LAST_TRICK_BONUS, SUN_DOUBLE_THRESHOLD, cardPoints, cardStrength, createDeck, nextSeat, otherTeam, sameCard, teamOf,
} from './cards';
import { type PlayedCard, legalCards, trickWinner } from './play';
import { type DeclaredProjects, type ProjectResolution, findProjects, hasBaloot, resolveProjects } from './projects';
import { type HandScore, type MatchOutcome, matchOutcome, scoreHand } from './scoring';

/** آلة حالة اللعبة — تعمل في Cloud Functions، والعميل يرسل "أفعالاً" فقط. */

export type Rng = () => number;

/** waraq: بعد الشراء وقبل توزيع باقي الورق — اللي معه «ورق» يختار بس أو ورق */
export type Phase = 'bidding' | 'waraq' | 'doubling' | 'playing' | 'matchOver';

export type Bid =
  | { type: 'pass' }
  | { type: 'hokm'; suit: Suit }
  | { type: 'sun' }
  | { type: 'ashkal' }
  | { type: 'secondHokm' }
  | { type: 'qablak' }
  /** بعد أن قال الجميع بس على حكمه: المشتري يؤكد الحكم (أو يحوّل صن) */
  | { type: 'confirmHokm' }
  /** خصم صاحب الحكم يدبّل قبل تأكيد الشراء: يصير الحكم لصاحبه مدبّلاً، ثم يختار المدبّل مقفل أو مفتوح */
  | { type: 'double' };

export interface Contract {
  mode: GameMode;
  trump: Suit | null;
  /** المشتري الأساسي */
  buyer: Seat;
  /** من يأخذ القبلة (في الأشكل: شريك المشتري) */
  qabaTo: Seat;
}

export interface DoublingState {
  /** 1 بدون، 2 دبل، 3 ثري، 4 فور */
  level: 1 | 2 | 3 | 4;
  gahwa: boolean;
  locked: boolean;
  doublerTeam: Team | null;
  awaitingTeam: Team | null;
  passed: Seat[];
  /** من دبّل أولاً: بعد الدبل تصبح المزايدة بينه وبين المشتري فقط */
  doubler: Seat | null;
  /** صاحب القرار الآن (بعد الدبل الأول) — null في الدبل الأول حيث يقرر أيٌّ من فريق الخصم */
  awaitingSeat: Seat | null;
  /** أعلن الدبل (أو الفور) وبقي أن يختار مقفل أو مفتوح — لا يتحرك أحد غيره حتى يختار */
  lockPending?: Seat | null;
}

export interface Discard { seat: Seat; card: Card; led: Suit; toPartner: boolean }

export interface GameState {
  phase: Phase;
  dealer: Seat;
  scores: [number, number];
  turn: Seat;
  hands: Card[][];
  qaba: Card | null;
  stock: Card[];
  bidRound: 1 | 2;
  bidsInRound: number;
  hokmBid: { seat: Seat; suit: Suit } | null;
  /** قال الجميع بس على الحكم: الدور للمشتري ليؤكد الحكم أو يحوّل صن */
  hokmConfirm?: boolean;
  /**
   * "حكم ثاني" في اللفة الأولى: يمر الدور على البقية (بس أو صن فقط)،
   * فإن قالوا كلهم بس يعود لصاحبه ليختار حكماً بغير لون القبلة.
   * remaining = عدد من بقي عليهم الدور، 0 = صاحب الثاني يختار اللون الآن.
   */
  /** confirmed: أكّد صاحب الثاني الحكم (بعد أن قال الجميع بس) ويختار اللون الآن */
  /** doubledBy: خصمٌ دبّل قبل أن يختار صاحب الثاني اللون؛ يُطبَّق الدبل لحظة اختياره */
  secondHokm: { seat: Seat; remaining: number; confirmed?: boolean; doubledBy?: Seat } | null;
  /**
   * "قبلك": عندما يقول لاعب صن، يُعطى اللاعب الذي قبله مباشرة (وقد تكلّم في نفس اللفة)
   * فرصة أخذ الصن والقبلة بدلاً منه، فيصبح هو المشتري.
   */
  /** ashkal: صاحب الشراء الحالي (caller) اشترى أشكل — إن لم يأخذه أحد بـ"قبلك" تروح القبلة لشريكه */
  sunClaim: { caller: Seat; challenger: Seat; ashkal?: boolean } | null;
  contract: Contract | null;
  doubling: DoublingState;
  initialHands: Card[][];
  declared: DeclaredProjects[];
  projects: ProjectResolution | null;
  balootSeat: Seat | null;
  trick: PlayedCard[];
  /** آخر أكلة مكتملة ومن أكلها */
  lastTrick: { cards: PlayedCard[]; winner: Seat } | null;
  trickNo: number;
  /**
   * ما ظهر علناً أثناء اللعب: الألوان اللي خلصت عند كل لاعب (ما تبع اللون المطلوب،
   * أو في الحكم ما قطع والقطع إجباري عليه). يستخدمها الروبوت ليلعب كما يلعب الناس.
   */
  voids?: Suit[][];
  /**
   * التهريب (علني): كل ورقة رماها لاعب من غير اللون المطلوب وبغير الحكم، بالترتيب،
   * ومعها هل كان شريكه ماسك الأكلة وقتها. يقرأها الروبوت كما يقرأها الناس.
   */
  discards?: Discard[];
  tricksWon: [number, number];
  cardAbnat: [number, number];
  lastHand: HandScore | null;
  outcome: MatchOutcome;
  /** «ورق» بعد الشراء: من بقي يُسأل (بالترتيب)، ووش يجي بعدهم (الدبل أو توزيع باقي الورق) */
  waraqAsk?: Seat[];
  waraqThen?: 'doubling' | 'deal';
  /** من أعلن «ورق» (للإعلان)، وهل يعيد التوزيع نفس الموزع (ما اشترى أحد) أو اللي بعده */
  waraqBy?: Seat;
  redealSame?: boolean;
}

export type Action =
  | { type: 'bid'; seat: Seat; bid: Bid }
  | { type: 'double'; seat: Seat; locked?: boolean }
  | { type: 'doublePass'; seat: Seat }
  /** بعد إعلان الدبل/الفور: اختيار مقفل أو مفتوح */
  | { type: 'doubleLock'; seat: Seat; locked: boolean }
  | { type: 'declareProject'; seat: Seat }
  | { type: 'declareBaloot'; seat: Seat }
  | { type: 'play'; seat: Seat; card: Card }
  /** سوا: كل أوراقك مضمونة تاكل، فتنلعب كلها وتنحسب الأكلات الباقية لك */
  | { type: 'sawa'; seat: Seat }
  /** «ورق»: أوراقك الخمس الأولى كلها ٧ و٨ و٩ بس — يعاد التوزيع. call=false = بس (في نافذة ما بعد الشراء) */
  | { type: 'waraq'; seat: Seat; call: boolean };

export class IllegalAction extends Error {}

const fail = (msg: string): never => { throw new IllegalAction(msg); };

export function shuffle(cards: Card[], rng: Rng): Card[] {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const freshDoubling = (): DoublingState => ({ level: 1, gahwa: false, locked: false, doublerTeam: null, awaitingTeam: null, passed: [], doubler: null, awaitingSeat: null });

/** توزيع أولي: 3 ثم 2 لكل لاعب بدءاً من يمين الموزع، والورقة 21 هي القبلة. */
export function dealHand(dealer: Seat, scores: [number, number], rng: Rng): GameState {
  const deck = shuffle(createDeck(), rng);
  const hands: Card[][] = [[], [], [], []];
  let i = 0;
  for (const count of [3, 2]) {
    for (let n = 1; n <= 4; n++) {
      const seat = nextSeat(dealer, n);
      for (let k = 0; k < count; k++) hands[seat].push(deck[i++]);
    }
  }
  return {
    phase: 'bidding', dealer, scores, turn: nextSeat(dealer), hands, qaba: deck[20], stock: deck.slice(21),
    bidRound: 1, bidsInRound: 0, hokmBid: null, secondHokm: null, sunClaim: null, contract: null, doubling: freshDoubling(),
    initialHands: [], declared: [], projects: null, balootSeat: null,
    trick: [], lastTrick: null, trickNo: 0, tricksWon: [0, 0], cardAbnat: [0, 0], lastHand: null, outcome: { status: 'ongoing' },
  };
}

export function newMatch(rng: Rng, dealer: Seat = 0): GameState {
  return dealHand(dealer, [0, 0], rng);
}

/** الأزرار المتاحة للاعب في المزايدة. */
export function availableBids(s: GameState, seat: Seat): Bid[] {
  if (s.phase !== 'bidding' || s.turn !== seat || !s.qaba) return [];
  // "قبلك": اللاعب الذي قبل قائل الصن يقرر
  if (s.sunClaim) return seat === s.sunClaim.challenger ? [{ type: 'pass' }, { type: 'qablak' }] : [];
  // رجع الدور للمشتري بعد أن قال الجميع بس: تأكيد الحكم أو صن
  if (s.hokmConfirm) return seat === s.hokmBid?.seat ? [{ type: 'confirmHokm' }, { type: 'sun' }] : [];
  const otherSuits = (['S', 'H', 'C', 'D'] as Suit[]).filter((suit) => suit !== s.qaba!.suit);
  // صاحب "حكم ثاني" بعد أن قال الجميع بس: تأكيد الحكم أو صن، وبعد التأكيد يختار لوناً غير لون القبلة
  if (s.secondHokm?.remaining === 0) {
    return s.secondHokm.confirmed ? otherSuits.map((suit): Bid => ({ type: 'hokm', suit })) : [{ type: 'confirmHokm' }, { type: 'sun' }];
  }
  const bids: Bid[] = [{ type: 'pass' }, { type: 'sun' }];
  // أشكل: للموزع وللاعب الذي قبله فقط، في اللفتين
  const ashkal = seat === s.dealer || seat === nextSeat(s.dealer, 3);
  // بعد الحكم أو الثاني: بس أو صن، وأشكل لمن يحق له، ودبل لخصم صاحبه (وفي الثاني قبل أن يختار اللون)
  if (s.hokmBid || s.secondHokm) {
    const bidder = s.hokmBid?.seat ?? s.secondHokm!.seat;
    const canDouble = teamOf(seat) !== teamOf(bidder);
    return [...bids, ...(ashkal ? [{ type: 'ashkal' } as Bid] : []), ...(canDouble ? [{ type: 'double' } as Bid] : [])];
  }
  if (s.bidRound === 1) bids.push({ type: 'hokm', suit: s.qaba.suit });
  // اللفة الثانية (بعد أن قال الجميع بس): حكم ثاني
  else bids.push({ type: 'secondHokm' });
  if (ashkal) bids.push({ type: 'ashkal' });
  return bids;
}

/**
 * من يُسأل "قبلك" بعد from: اللاعبون الذين يسبقونه في ترتيب الكلام (بدءاً من الذي بعد الموزع)، بعكس سريان الدور.
 * لا يُسأل الموزع أبداً، ولا شريك صاحب الصن الحالي (فإن أخذها خصمٌ بـ"قبلك" صار شريك الأول يحق له).
 */
function nextQablak(s: GameState, from: Seat, holder: Seat): Seat | null {
  const pos = (x: Seat) => (x - s.dealer + 4) % 4 || 4; // الذي بعد الموزع = 1، والموزع = 4
  for (let p = pos(from) - 1; p >= 1; p--) {
    const seat = nextSeat(s.dealer, p);
    if (seat !== s.dealer && teamOf(seat) !== teamOf(holder)) return seat;
  }
  return null;
}

/** «قبلك» على الصن أو الأشكل: دائماً في اللفة الأولى، وفي الثانية بس لو ورقة الأرض إكة */
const qablakAllowed = (s: GameState) => s.bidRound === 1 || s.qaba?.rank === 'A';

const bidEquals = (a: Bid, b: Bid) => a.type === b.type && (a.type !== 'hokm' || a.suit === (b as typeof a).suit);

/**
 * بعد الشراء: إن كان الدبل ممكناً يبدأ الدبل والكل ما زال بخمس أوراق (وورقة الأرض على الطاولة)،
 * ولا تُوزّع بقية الأوراق إلا بعد انتهاء الدبل. وإلا تُوزّع مباشرة ويبدأ اللعب.
 */
function finalizeContract(s: GameState, contract: Contract, noDouble = false, skipWaraq = false): GameState {
  const buyerTeam = teamOf(contract.buyer);
  const opp = otherTeam(buyerTeam);
  // الحكم: دبل عادي. إلا تأكيد الحكم الأول (noDouble): ما فيه دبل، إلا لو فريق الخصم فوق المية
  // (فريق المشتري فوق المية والخصم تحتها: ما يدبّل الخصم)
  // الصن: الدبل بس لو المشتري فوق المية والخصم تحتها
  const canDouble = contract.mode === 'hokm'
    ? !noDouble || s.scores[opp] > SUN_DOUBLE_THRESHOLD
    : s.scores[buyerTeam] > SUN_DOUBLE_THRESHOLD && s.scores[opp] < SUN_DOUBLE_THRESHOLD;
  const base: GameState = { ...s, contract, turn: nextSeat(s.dealer), doubling: freshDoubling() };
  // قبل الدبل وتوزيع باقي الورق: اللي معه «ورق» (بالترتيب من بعد الموزع) يختار بس أو ورق
  // (دبّل أحد قبل التأكيد: ندخل الدبل على طول، واللي معه ورق يقدر يقوله أثناء الدبل)
  const ask = skipWaraq ? [] : waraqSeats({ ...base, phase: 'waraq' });
  if (ask.length) return { ...base, phase: 'waraq', waraqAsk: ask, waraqThen: canDouble ? 'doubling' : 'deal', turn: ask[0] };
  return afterContract(base, canDouble);
}

function afterContract(base: GameState, canDouble: boolean): GameState {
  const opp = otherTeam(teamOf(base.contract!.buyer));
  if (canDouble) return { ...base, phase: 'doubling', turn: nextSeat(base.dealer), doubling: { ...freshDoubling(), awaitingTeam: opp } };
  return dealRest({ ...base, turn: nextSeat(base.dealer) });
}

// ───── «ورق» ─────

/** أوراقه الخمس الأولى كلها ٧ و٨ و٩ (ما فيها صورة ولا عشرة ولا إكة) */
export function hasWaraq(s: GameState, seat: Seat): boolean {
  const h = s.hands[seat];
  // كل أوراقه الخمس ٧ أو ٨ أو ٩ بس (لو معه ولو ورقة وحدة صورة أو عشرة أو أكة: ما فيه ورق)
  return h.length === 5 && h.every((c) => c.rank === '7' || c.rank === '8' || c.rank === '9');
}

/** هل اشترى أحد (حكم، صن، أشكل، حكم ثاني) — قبل توزيع باقي الورق */
const purchased = (s: GameState) => !!(s.contract || s.hokmBid || s.secondHokm || s.sunClaim);

/** من يُسأل «بس أو ورق» بعد الشراء: كل من معه ورق، بالترتيب من بعد الموزع */
function waraqSeats(s: GameState): Seat[] {
  return [1, 2, 3, 4].map((n) => nextSeat(s.dealer, n)).filter((seat) => hasWaraq(s, seat));
}

/**
 * يقدر يقول «ورق» الحين؟
 *  • ما اشترى أحد: في دوره (اللفة الأولى أو الثانية) → يعاد التوزيع من نفس الموزع
 *  • اشترى أحد ولسا ما توزع باقي الورق: في أي وقت (أو لما يجي دوره في نافذة بس/ورق) → التوزيع للي بعد الموزع
 */
export function canWaraq(s: GameState, seat: Seat): boolean {
  if (!hasWaraq(s, seat) || !s.qaba && s.phase === 'bidding') return false;
  if (s.phase === 'waraq') return s.turn === seat;
  if (s.phase === 'doubling') return true;
  if (s.phase !== 'bidding') return false;
  return purchased(s) || s.turn === seat;
}

function applyWaraq(s: GameState, seat: Seat, call: boolean): GameState {
  if (!call) {
    // بس (في نافذة ما بعد الشراء): ننتقل للي بعده، وإذا خلصوا نكمل (الدبل أو توزيع باقي الورق)
    if (s.phase !== 'waraq' || s.turn !== seat) fail('ليس دورك');
    const rest = (s.waraqAsk ?? []).filter((x) => x !== seat);
    if (rest.length) return { ...s, waraqAsk: rest, turn: rest[0] };
    const { waraqAsk: _a, waraqThen, ...base } = s;
    void _a;
    return afterContract({ ...base, phase: 'bidding' } as GameState, waraqThen === 'doubling');
  }
  if (!canWaraq(s, seat)) fail('ما تقدر تقول ورق الحين');
  // يعاد التوزيع: ما اشترى أحد → نفس الموزع، اشترى أحد → اللي بعده (الخادم يوزّع مثل «الكل قال بس»)
  return {
    ...s, phase: 'bidding', qaba: null, contract: null, hokmBid: null, hokmConfirm: false, secondHokm: null, sunClaim: null,
    waraqAsk: undefined, waraqThen: undefined, waraqBy: seat, redealSame: !purchased(s), outcome: { status: 'ongoing' },
  };
}

/** توزيع بقية الأوراق: ورقة الأرض لصاحبها، والباقي حتى يصبح مع كل لاعب ثماني أوراق، ثم يبدأ اللعب */
function dealRest(s: GameState): GameState {
  const contract = s.contract!;
  const stock = [...s.stock];
  const hands = s.hands.map((h) => [...h]);
  hands[contract.qabaTo].push(s.qaba!);
  for (let n = 1; n <= 4; n++) {
    const seat = nextSeat(s.dealer, n);
    const count = seat === contract.qabaTo ? 2 : 3;
    hands[seat].push(...stock.splice(0, count));
  }
  return { ...s, hands, stock, initialHands: hands.map((h) => [...h]), turn: nextSeat(s.dealer), phase: 'playing' };
}

function applyBid(s: GameState, seat: Seat, bid: Bid): GameState {
  if (!availableBids(s, seat).some((b) => bidEquals(b, bid))) fail('مزايدة غير مسموحة');

  // ───── قبلك ─────
  if (s.sunClaim) {
    const { caller, challenger } = s.sunClaim;
    const holder = bid.type === 'qablak' ? challenger : caller;
    // أشكل يبقى أشكل ما دام صاحبه محتفظاً به؛ من يأخذه بـ"قبلك" يصير صناً له وتروح له ورقة الأرض
    const ashkal = !!s.sunClaim.ashkal && holder === caller;
    // يستمر "قبلك" بعكس سريان الدور على من تكلّم قبله، حتى لا يبقى أحد يحق له
    const next = nextQablak(s, challenger, holder);
    if (next !== null) return { ...s, sunClaim: { caller: holder, challenger: next, ashkal }, turn: next };
    return finalizeContract({ ...s, sunClaim: null }, { mode: 'sun', trump: null, buyer: holder, qabaTo: ashkal ? nextSeat(holder, 2) : holder });
  }

  // ───── دبل على الحكم قبل تأكيده: الحكم لصاحبه، والدبل من هذا الخصم ─────
  if (bid.type === 'double') {
    // الحكم الثاني: اللون ما اختير بعد — ينتهي الدور على صاحبه ليختار اللون، ويُطبَّق الدبل بعده
    if (s.secondHokm) return { ...s, secondHokm: { seat: s.secondHokm.seat, remaining: 0, confirmed: true, doubledBy: seat }, turn: s.secondHokm.seat };
    const { seat: buyer, suit } = s.hokmBid!;
    const bought = finalizeContract(s, { mode: 'hokm', trump: suit, buyer, qabaTo: buyer }, false, true);
    return applyDouble(bought, seat);
  }

  // ───── تأكيد الحكم ─────
  if (s.hokmConfirm) {
    const { seat: buyer, suit } = s.hokmBid!;
    const after = { ...s, hokmConfirm: false };
    return bid.type === 'sun'
      ? finalizeContract(after, { mode: 'sun', trump: null, buyer, qabaTo: buyer })
      // الحكم الأول بعد تأكيده: ما فيه دبل — توزّع بقية الأوراق ويبدأ اللعب مباشرة
      : finalizeContract(after, { mode: 'hokm', trump: suit, buyer, qabaTo: buyer }, true);
  }

  if (bid.type === 'sun') {
    // إن تكلّم أحد قبله في هذه اللفة: يُعطى من قبله (بعكس سريان الدور) فرصة "قبلك"
    // (في اللفة الثانية: ما فيه «قبلك» لللي قالوا ولا، إلا إذا كانت ورقة الأرض إكة)
    if (!s.secondHokm && s.bidsInRound > 0 && qablakAllowed(s)) {
      const challenger = nextQablak(s, seat, seat);
      if (challenger !== null) return { ...s, sunClaim: { caller: seat, challenger }, turn: challenger };
    }
    return finalizeContract(s, { mode: 'sun', trump: null, buyer: seat, qabaTo: seat });
  }
  if (bid.type === 'ashkal') {
    // نفس قاعدة "قبلك" في الصن: من تكلّم قبله (بعكس سريان الدور) يقدر يأخذه صناً له
    if (!s.secondHokm && s.bidsInRound > 0 && qablakAllowed(s)) {
      const challenger = nextQablak(s, seat, seat);
      if (challenger !== null) return { ...s, sunClaim: { caller: seat, challenger, ashkal: true }, turn: challenger };
    }
    return finalizeContract(s, { mode: 'sun', trump: null, buyer: seat, qabaTo: nextSeat(seat, 2) });
  }

  // ───── حكم ثاني ─────
  // الحكم الثاني: اللي قالوا «ولا» قبله ما ينسألون مرة ثانية — يُسأل بس اللي بعده (لين الموزع)
  if (bid.type === 'secondHokm') {
    const remaining = 3 - s.bidsInRound;
    return { ...s, secondHokm: { seat, remaining }, turn: remaining === 0 ? seat : nextSeat(seat) };
  }
  if (s.secondHokm) {
    const owner = s.secondHokm.seat;
    if (s.secondHokm.remaining === 0 && bid.type === 'confirmHokm') return { ...s, secondHokm: { ...s.secondHokm, confirmed: true } };
    if (s.secondHokm.remaining === 0 && bid.type === 'hokm') {
      const doubledBy = s.secondHokm.doubledBy;
      const bought = finalizeContract(s, { mode: 'hokm', trump: bid.suit, buyer: owner, qabaTo: owner }, false, doubledBy != null);
      return doubledBy != null ? applyDouble(bought, doubledBy) : bought;
    }
    // بس من أحد البقية
    const remaining = s.secondHokm.remaining - 1;
    return { ...s, secondHokm: { seat: owner, remaining }, turn: remaining === 0 ? owner : nextSeat(seat) };
  }

  const next: GameState = { ...s, bidsInRound: s.bidsInRound + 1, turn: nextSeat(seat) };
  // شراء حكم: يلف الدور على الثلاثة الباقين كلهم (حتى من قال بس قبله) ليقولوا بس أو صن،
  // ثم يرجع للمشتري ليؤكد الحكم أو يحوّل صن
  if (bid.type === 'hokm') { next.hokmBid = { seat, suit: bid.suit }; next.bidsInRound = 1; }

  if (next.bidsInRound < 4) return next;
  // انتهت الجولة
  // قال الجميع بس على الحكم: يرجع الدور للمشتري ليؤكد الحكم أو يحوّل صن
  if (next.hokmBid) return { ...next, hokmConfirm: true, turn: next.hokmBid.seat };
  if (s.bidRound === 1) return { ...next, bidRound: 2, bidsInRound: 0, turn: nextSeat(s.dealer) };
  // صكة: الجميع مرّ مرتين — إعادة توزيع
  return { ...next, phase: 'bidding', qaba: null, outcome: { status: 'ongoing' } };
}

/** هل انتهت المزايدة بصكة وتحتاج إعادة توزيع؟ */
export const needsRedeal = (s: GameState) => s.phase === 'bidding' && s.qaba === null;

export function redeal(s: GameState, rng: Rng): GameState {
  // «ورق» قبل أي شراء: نفس الموزع يعيد التوزيع
  return dealHand(s.redealSame ? s.dealer : nextSeat(s.dealer), s.scores, rng);
}

/** خيارات الدبل المتاحة لهذا المقعد الآن. */
/**
 * سلسلة الدبل في الحكم:
 *   دبل (الخصم، يختار مقفل/مفتوح) → ثري ×3 (المشتري، مفتوح تلقائياً)
 *   → فور ×4 (الخصم، يختار مقفل/مفتوح) → قهوة (المشتري، مفتوح تلقائياً، تحسم اللعبة)
 * في الصن: دبل واحد فقط بلا مقفل/مفتوح.
 */
/**
 * هل على هذا اللاعب قرار في الدبل الآن؟
 * الدبل الأول: أيٌّ من فريق الخصم (ولا ينتهي إلا إذا مرّر الاثنان). بعده المزايدة بين المدبّل والمشتري فقط.
 */
export function isDoublingTurn(s: GameState, seat: Seat): boolean {
  if (s.phase !== 'doubling') return false;
  const d = s.doubling;
  if (d.lockPending != null) return false; // ننتظر اختياره مقفل أو مفتوح
  if (d.awaitingSeat != null) return d.awaitingSeat === seat; // != null: الطاولات القديمة بلا هذا الحقل
  return d.awaitingTeam === teamOf(seat) && !d.passed.includes(seat);
}

/** هل على هذا اللاعب أن يختار مقفل أو مفتوح الآن؟ */
export const isLockChoiceTurn = (s: GameState, seat: Seat) => s.phase === 'doubling' && s.doubling.lockPending === seat;

export function availableDouble(s: GameState, seat: Seat): { label: 'دبل' | 'ثري' | 'فور' | 'قهوة'; needsLockChoice: boolean } | null {
  if (!isDoublingTurn(s, seat)) return null;
  const hokm = s.contract!.mode === 'hokm';
  switch (s.doubling.level) {
    case 1: return { label: 'دبل', needsLockChoice: hokm };
    case 2: return hokm ? { label: 'ثري', needsLockChoice: false } : null;
    case 3: return { label: 'فور', needsLockChoice: true };
    case 4: return s.doubling.gahwa ? null : { label: 'قهوة', needsLockChoice: false };
  }
}

function applyDouble(s: GameState, seat: Seat, locked?: boolean): GameState {
  const option = availableDouble(s, seat);
  if (!option) fail('الدبل غير متاح');
  const d = { ...s.doubling, passed: [] as Seat[] };
  const hokm = s.contract!.mode === 'hokm';
  if (d.level === 1) {
    d.level = 2;
    d.doublerTeam = teamOf(seat);
    d.doubler = seat;
    d.locked = hokm && !!locked;
  } else if (d.level === 2) {
    d.level = 3; // ثري: مفتوح تلقائياً
    d.locked = false;
  } else if (d.level === 3) {
    d.level = 4; // فور: الخصم يختار مقفل/مفتوح من جديد
    d.locked = !!locked;
  } else {
    d.gahwa = true; // قهوة: مفتوح تلقائياً
    d.locked = false;
  }
  // بلا اختيار بعد: يُعلن الدبل الآن، ثم يختار صاحبه مقفل أو مفتوح (doubleLock)
  if (option!.needsLockChoice && locked === undefined) {
    return { ...s, doubling: { ...d, locked: false, lockPending: seat, awaitingSeat: null, awaitingTeam: null }, phase: 'doubling' };
  }
  return settleDoubling(s, d);
}

function applyDoubleLock(s: GameState, seat: Seat, locked: boolean): GameState {
  if (!isLockChoiceTurn(s, seat)) fail('ليس وقت اختيار مقفل أو مفتوح');
  const hokm = s.contract!.mode === 'hokm';
  return settleDoubling(s, { ...s.doubling, locked: hokm && locked, lockPending: null });
}

/** بعد اكتمال الدبل: من يرد عليه، أو انتهى الدبل ونوزع بقية الورق */
function settleDoubling(s: GameState, d: DoublingState): GameState {
  const hokm = s.contract!.mode === 'hokm';
  const finished = !hokm || d.gahwa;
  // التالي: المشتري يرد على الدبل والفور، والمدبّل يرد على الثري
  const buyer = s.contract!.buyer;
  d.awaitingSeat = finished ? null : d.level === 3 ? d.doubler : buyer;
  d.awaitingTeam = d.awaitingSeat === null ? null : teamOf(d.awaitingSeat);
  return finished ? dealRest({ ...s, doubling: d }) : { ...s, doubling: d, phase: 'doubling' };
}

function applyDoublePass(s: GameState, seat: Seat): GameState {
  if (!isDoublingTurn(s, seat)) fail('ليس دورك في الدبل');
  // بعد الدبل الأول: تمرير صاحب القرار ينهي الدبل
  if (s.doubling.awaitingSeat != null) {
    return dealRest({ ...s, doubling: { ...s.doubling, awaitingSeat: null, awaitingTeam: null } });
  }
  const passed = [...new Set([...s.doubling.passed, seat])];
  if (passed.length < 2) return { ...s, doubling: { ...s.doubling, passed } };
  return dealRest({ ...s, doubling: { ...s.doubling, passed, awaitingTeam: null } });
}

export function canDeclareProject(s: GameState, seat: Seat): boolean {
  return s.phase === 'playing' && s.trickNo === 0 && s.turn === seat
    && !s.declared.some((d) => d.seat === seat)
    && findProjects(s.initialHands[seat], s.contract!.mode).length > 0;
}

/** البلوت صار تلقائياً مع لعب الورقة الثانية منه، فلا يوجد إعلان يدوي */
export function canDeclareBaloot(_s: GameState, _seat: Seat): boolean {
  return false;
}

export function lockedSeat(s: GameState): Seat | null {
  return s.doubling.locked ? s.contract!.buyer : null;
}

export function legalCardsFor(s: GameState, seat: Seat): Card[] {
  if (s.phase !== 'playing' || s.turn !== seat) return [];
  const c = s.contract!;
  return legalCards({ mode: c.mode, trump: c.trump, trick: s.trick, hand: s.hands[seat], seat, lockedSeat: lockedSeat(s), outstanding: s.hands.filter((_, i) => i !== seat).flat() });
}

function applyPlay(s: GameState, seat: Seat, card: Card): GameState {
  if (!legalCardsFor(s, seat).some((c) => sameCard(c, card))) fail('ورقة غير مسموحة');
  const c = s.contract!;
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((x) => !sameCard(x, card)) : h));
  const trick = [...s.trick, { seat, card }];
  // الإعلان عن المشاريع إجباري وتلقائي: يُسجَّل مع أول ورقة يلعبها صاحبه
  const declared = s.trickNo === 0 && !s.declared.some((d) => d.seat === seat)
    && findProjects(s.initialHands[seat], c.mode).length > 0
    ? [...s.declared, { seat, projects: findProjects(s.initialHands[seat], c.mode) }]
    : s.declared;
  // البلوت تلقائي: يُعلن عندما يلعب صاحب الشايب والبنت من الحكم ثانيهما
  const isKQ = c.mode === 'hokm' && card.suit === c.trump && (card.rank === 'K' || card.rank === 'Q');
  const balootSeat = s.balootSeat === null && isKQ && hasBaloot(s.initialHands[seat], c.trump)
    && !hands[seat].some((x) => x.suit === c.trump && (x.rank === 'K' || x.rank === 'Q'))
    ? seat : s.balootSeat;
  let next: GameState = { ...s, hands, trick, declared, balootSeat, turn: nextSeat(seat), voids: noteVoids(s, seat, card), discards: noteDiscard(s, seat, card) };
  if (trick.length < 4) return next;

  const winner = trickWinner(trick, c.mode, c.trump);
  const team = teamOf(winner);
  const tricksWon: [number, number] = [...s.tricksWon];
  const cardAbnat: [number, number] = [...s.cardAbnat];
  tricksWon[team]++;
  cardAbnat[team] += trick.reduce((sum, p) => sum + cardPoints(p.card, c.mode, c.trump), 0);
  if (s.trickNo === 7) cardAbnat[team] += LAST_TRICK_BONUS;

  next = { ...next, trick: [], lastTrick: { cards: trick, winner }, trickNo: s.trickNo + 1, tricksWon, cardAbnat, turn: winner };
  if (s.trickNo === 0) next.projects = resolveProjects(next.declared, nextSeat(s.dealer), c.mode);
  if (next.trickNo < 8) return next;
  return finishHand(next);
}

/** ما تكشفه الورقة الملعوبة علناً: لم يتبع اللون (خلص عنده)، أو في الحكم لم يقطع والقطع إجباري (خلص حكمه) */
function noteVoids(s: GameState, seat: Seat, card: Card): Suit[][] | undefined {
  if (!s.trick.length) return s.voids;
  const led = s.trick[0].card.suit;
  if (card.suit === led) return s.voids;
  const c = s.contract!;
  const add: Suit[] = [led];
  const opponentWinning = teamOf(trickWinner(s.trick, c.mode, c.trump)) !== teamOf(seat);
  const tableHasTrump = s.trick.some((p) => c.mode === 'hokm' && p.card.suit === c.trump);
  if (c.mode === 'hokm' && card.suit !== c.trump && opponentWinning && !tableHasTrump) add.push(c.trump!);
  const voids = (s.voids ?? [[], [], [], []]).map((v) => [...v]);
  for (const suit of add) if (!voids[seat].includes(suit)) voids[seat].push(suit);
  return voids;
}

/** تهريب: ورقة من غير اللون المطلوب وبغير الحكم */
function noteDiscard(s: GameState, seat: Seat, card: Card): Discard[] | undefined {
  if (!s.trick.length) return s.discards;
  const c = s.contract!;
  const led = s.trick[0].card.suit;
  if (card.suit === led || (c.mode === 'hokm' && card.suit === c.trump)) return s.discards;
  const toPartner = teamOf(trickWinner(s.trick, c.mode, c.trump)) === teamOf(seat);
  return [...(s.discards ?? []), { seat, card, led, toPartner }];
}

function finishHand(s: GameState): GameState {
  const c = s.contract!;
  const result = scoreHand({
    mode: c.mode,
    buyerTeam: teamOf(c.buyer),
    cardAbnat: s.cardAbnat,
    tricksWon: s.tricksWon,
    projectAbnat: s.projects?.abnat ?? [0, 0],
    balootTeam: s.balootSeat === null ? null : teamOf(s.balootSeat),
    multiplier: s.doubling.level,
    gahwa: s.doubling.gahwa,
    doublerTeam: s.doubling.doublerTeam,
  });
  const scores: [number, number] = [s.scores[0] + result.points[0], s.scores[1] + result.points[1]];
  const outcome = matchOutcome(scores, result.gahwaWinner);
  return { ...s, scores, lastHand: result, outcome, phase: outcome.status === 'won' ? 'matchOver' : s.phase };
}

/** هل انتهت الصكة وتنتظر توزيع الصكة التالية؟ */
export const handOver = (s: GameState) => s.lastHand !== null && s.trickNo === 8;

/** الصكة التالية (أو الجولة الفاصلة عند التعادل). */
export function nextHand(s: GameState, rng: Rng): GameState {
  if (!handOver(s) || s.phase === 'matchOver') fail('لا يمكن بدء صكة جديدة الآن');
  return dealHand(nextSeat(s.dealer), s.scores, rng);
}

export function applyAction(s: GameState, a: Action): GameState {
  if (s.phase === 'matchOver') fail('انتهت المباراة');
  switch (a.type) {
    case 'bid': return applyBid(s, a.seat, a.bid);
    case 'double': return applyDouble(s, a.seat, a.locked);
    case 'doubleLock': return applyDoubleLock(s, a.seat, a.locked);
    case 'doublePass': return applyDoublePass(s, a.seat);
    case 'declareProject': {
      if (!canDeclareProject(s, a.seat)) fail('لا يوجد مشروع');
      const projects = findProjects(s.initialHands[a.seat], s.contract!.mode);
      return { ...s, declared: [...s.declared, { seat: a.seat, projects }] };
    }
    case 'declareBaloot':
      if (!canDeclareBaloot(s, a.seat)) fail('لا يوجد بلوت');
      return { ...s, balootSeat: a.seat };
    case 'play': return applyPlay(s, a.seat, a.card);
    case 'sawa': return applySawa(s, a.seat);
    case 'waraq': return applyWaraq(s, a.seat, a.call);
  }
}

/**
 * سوا: دورك تبدأ الأكلة، وكل أوراقك (أنت بس، بدون شريكك) مضمونة تاكل مهما لعب الباقين:
 *  • كل ورقة معك أعلى من كل أوراق الباقين من نفس النوع (حكم أو صن).
 *  • في الحكم ومعك أوراق غير حكم: ما يبقى حكم عند أحد بعد ما تلعب حكمك (كل واحد مجبور يتبع الحكم لما تلعبه)،
 *    فما أحد يقدر يقطع أوراقك الثانية.
 */
export function canSawa(s: GameState, seat: Seat): boolean {
  if (s.phase !== 'playing' || s.turn !== seat || s.trick.length > 0 || !s.contract) return false;
  const mine = s.hands[seat];
  if (mine.length < 2) return false;
  const mode = s.contract.mode;
  const trump = mode === 'hokm' ? s.contract.trump ?? null : null;
  const str = (c: Card) => cardStrength(c, mode, trump);
  const others = ([0, 1, 2, 3] as Seat[]).filter((x) => x !== seat).map((x) => s.hands[x]);
  for (const k of mine) for (const h of others) for (const o of h) if (o.suit === k.suit && str(o) > str(k)) return false;
  if (trump && mine.some((k) => k.suit !== trump)) {
    const myTrumps = mine.filter((k) => k.suit === trump).length;
    for (const h of others) if (h.filter((o) => o.suit === trump).length > myTrumps) return false;
  }
  return true;
}

/** سوا: تنلعب الأكلات الباقية كلها (أنت تبدأ كل أكلة بحكمك أول، والباقين أي ورقة مسموحة) وتنتهي الصكة */
function applySawa(s: GameState, seat: Seat): GameState {
  if (!canSawa(s, seat)) fail('سوا غير ممكن');
  const trump = s.contract!.mode === 'hokm' ? s.contract!.trump ?? null : null;
  let cur = s;
  for (let guard = 0; guard < 40 && cur.phase === 'playing' && cur.lastHand === null; guard++) {
    const p = cur.turn;
    let card: Card;
    if (p === seat && cur.trick.length === 0) {
      const hand = cur.hands[seat];
      card = hand.find((c) => c.suit === trump) ?? hand[0];
    } else {
      card = legalCardsFor(cur, p)[0];
    }
    cur = applyPlay(cur, p, card);
  }
  return cur;
}
