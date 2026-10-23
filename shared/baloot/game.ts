import {
  type Card, type GameMode, type Seat, type Suit, type Team,
  LAST_TRICK_BONUS, SUN_DOUBLE_THRESHOLD, cardPoints, createDeck, nextSeat, otherTeam, sameCard, teamOf,
} from './cards';
import { type PlayedCard, legalCards, trickWinner } from './play';
import { type DeclaredProjects, type ProjectResolution, findProjects, hasBaloot, resolveProjects } from './projects';
import { type HandScore, type MatchOutcome, matchOutcome, scoreHand } from './scoring';

/** آلة حالة اللعبة — تعمل في Cloud Functions، والعميل يرسل "أفعالاً" فقط. */

export type Rng = () => number;

export type Phase = 'bidding' | 'doubling' | 'playing' | 'matchOver';

export type Bid =
  | { type: 'pass' }
  | { type: 'hokm'; suit: Suit }
  | { type: 'sun' }
  | { type: 'ashkal' }
  | { type: 'secondHokm' }
  | { type: 'qablak' };

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
}

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
  /**
   * "حكم ثاني" في اللفة الأولى: يمر الدور على البقية (بس أو صن فقط)،
   * فإن قالوا كلهم بس يعود لصاحبه ليختار حكماً بغير لون القبلة.
   * remaining = عدد من بقي عليهم الدور، 0 = صاحب الثاني يختار اللون الآن.
   */
  secondHokm: { seat: Seat; remaining: number } | null;
  /**
   * "قبلك": عندما يقول لاعب صن، يُعطى اللاعب الذي قبله مباشرة (وقد تكلّم في نفس اللفة)
   * فرصة أخذ الصن والقبلة بدلاً منه، فيصبح هو المشتري.
   */
  sunClaim: { caller: Seat; challenger: Seat } | null;
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
  tricksWon: [number, number];
  cardAbnat: [number, number];
  lastHand: HandScore | null;
  outcome: MatchOutcome;
}

export type Action =
  | { type: 'bid'; seat: Seat; bid: Bid }
  | { type: 'double'; seat: Seat; locked?: boolean }
  | { type: 'doublePass'; seat: Seat }
  | { type: 'declareProject'; seat: Seat }
  | { type: 'declareBaloot'; seat: Seat }
  | { type: 'play'; seat: Seat; card: Card };

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

const freshDoubling = (): DoublingState => ({ level: 1, gahwa: false, locked: false, doublerTeam: null, awaitingTeam: null, passed: [] });

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
  const otherSuits = (['S', 'H', 'C', 'D'] as Suit[]).filter((suit) => suit !== s.qaba!.suit);
  // صاحب "حكم ثاني" بعد أن قال الجميع بس: يختار لوناً غير لون القبلة
  if (s.secondHokm?.remaining === 0) return otherSuits.map((suit) => ({ type: 'hokm', suit }));
  const bids: Bid[] = [{ type: 'pass' }, { type: 'sun' }];
  if (s.hokmBid || s.secondHokm) return bids; // بعد الحكم أو الثاني: يحق فقط بس أو صن
  if (s.bidRound === 1) {
    bids.push({ type: 'hokm', suit: s.qaba.suit });
    // أشكل: للاعب الذي بعد الموزع ولشريك الموزع
    if (seat === nextSeat(s.dealer, 1) || seat === nextSeat(s.dealer, 2)) bids.push({ type: 'ashkal' });
  } else {
    // اللفة الثانية (بعد أن قال الجميع بس): حكم ثاني
    bids.push({ type: 'secondHokm' });
  }
  return bids;
}

const bidEquals = (a: Bid, b: Bid) => a.type === b.type && (a.type !== 'hokm' || a.suit === (b as typeof a).suit);

function finalizeContract(s: GameState, contract: Contract): GameState {
  const stock = [...s.stock];
  const hands = s.hands.map((h) => [...h]);
  hands[contract.qabaTo].push(s.qaba!);
  for (let n = 1; n <= 4; n++) {
    const seat = nextSeat(s.dealer, n);
    const count = seat === contract.qabaTo ? 2 : 3;
    hands[seat].push(...stock.splice(0, count));
  }
  const next: GameState = {
    ...s, hands, stock, contract, initialHands: hands.map((h) => [...h]),
    turn: nextSeat(s.dealer), phase: 'playing', doubling: freshDoubling(),
  };
  const buyerTeam = teamOf(contract.buyer);
  const opp = otherTeam(buyerTeam);
  const canDouble = contract.mode === 'hokm'
    || (s.scores[buyerTeam] > SUN_DOUBLE_THRESHOLD && s.scores[opp] < SUN_DOUBLE_THRESHOLD);
  if (canDouble) {
    next.phase = 'doubling';
    next.doubling = { ...freshDoubling(), awaitingTeam: opp };
  }
  return next;
}

function applyBid(s: GameState, seat: Seat, bid: Bid): GameState {
  if (!availableBids(s, seat).some((b) => bidEquals(b, bid))) fail('مزايدة غير مسموحة');

  // ───── قبلك ─────
  if (s.sunClaim) {
    const { caller, challenger } = s.sunClaim;
    const buyer = bid.type === 'qablak' ? challenger : caller;
    return finalizeContract({ ...s, sunClaim: null }, { mode: 'sun', trump: null, buyer, qabaTo: buyer });
  }

  if (bid.type === 'sun') {
    // إن تكلّم أحد قبله في هذه اللفة، يُعطى اللاعب الذي قبله مباشرة فرصة "قبلك"
    if (!s.secondHokm && s.bidsInRound > 0) {
      const challenger = nextSeat(seat, 3);
      return { ...s, sunClaim: { caller: seat, challenger }, turn: challenger };
    }
    return finalizeContract(s, { mode: 'sun', trump: null, buyer: seat, qabaTo: seat });
  }
  if (bid.type === 'ashkal') {
    return finalizeContract(s, { mode: 'sun', trump: null, buyer: seat, qabaTo: nextSeat(seat, 2) });
  }

  // ───── حكم ثاني ─────
  if (bid.type === 'secondHokm') return { ...s, secondHokm: { seat, remaining: 3 }, turn: nextSeat(seat) };
  if (s.secondHokm) {
    const owner = s.secondHokm.seat;
    if (s.secondHokm.remaining === 0 && bid.type === 'hokm') {
      return finalizeContract(s, { mode: 'hokm', trump: bid.suit, buyer: owner, qabaTo: owner });
    }
    // بس من أحد البقية
    const remaining = s.secondHokm.remaining - 1;
    return { ...s, secondHokm: { seat: owner, remaining }, turn: remaining === 0 ? owner : nextSeat(seat) };
  }

  const next: GameState = { ...s, bidsInRound: s.bidsInRound + 1, turn: nextSeat(seat) };
  if (bid.type === 'hokm') next.hokmBid = { seat, suit: bid.suit };

  if (next.bidsInRound < 4) return next;
  // انتهت الجولة
  if (next.hokmBid) {
    const { seat: buyer, suit } = next.hokmBid;
    return finalizeContract(next, { mode: 'hokm', trump: suit, buyer, qabaTo: buyer });
  }
  if (s.bidRound === 1) return { ...next, bidRound: 2, bidsInRound: 0, turn: nextSeat(s.dealer) };
  // صنكة: الجميع مرّ مرتين — إعادة توزيع
  return { ...next, phase: 'bidding', qaba: null, outcome: { status: 'ongoing' } };
}

/** هل انتهت المزايدة بصنكة وتحتاج إعادة توزيع؟ */
export const needsRedeal = (s: GameState) => s.phase === 'bidding' && s.qaba === null;

export function redeal(s: GameState, rng: Rng): GameState {
  return dealHand(nextSeat(s.dealer), s.scores, rng);
}

/** خيارات الدبل المتاحة لهذا المقعد الآن. */
/**
 * سلسلة الدبل في الحكم:
 *   دبل (الخصم، يختار مقفل/مفتوح) → ثري ×3 (المشتري، مفتوح تلقائياً)
 *   → فور ×4 (الخصم، يختار مقفل/مفتوح) → قهوة (المشتري، مفتوح تلقائياً، تحسم اللعبة)
 * في الصن: دبل واحد فقط بلا مقفل/مفتوح.
 */
export function availableDouble(s: GameState, seat: Seat): { label: 'دبل' | 'ثري' | 'فور' | 'قهوة'; needsLockChoice: boolean } | null {
  if (s.phase !== 'doubling' || s.doubling.awaitingTeam !== teamOf(seat) || s.doubling.passed.includes(seat)) return null;
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
  if (option!.needsLockChoice && locked === undefined) fail('اختر مقفل أو مفتوح');
  const d = { ...s.doubling, passed: [] as Seat[] };
  const hokm = s.contract!.mode === 'hokm';
  if (d.level === 1) {
    d.level = 2;
    d.doublerTeam = teamOf(seat);
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
  const finished = !hokm || d.gahwa;
  d.awaitingTeam = finished ? null : otherTeam(teamOf(seat));
  return { ...s, doubling: d, phase: finished ? 'playing' : 'doubling' };
}

function applyDoublePass(s: GameState, seat: Seat): GameState {
  if (s.phase !== 'doubling' || s.doubling.awaitingTeam !== teamOf(seat)) fail('ليس دورك في الدبل');
  const passed = [...new Set([...s.doubling.passed, seat])];
  if (passed.length < 2) return { ...s, doubling: { ...s.doubling, passed } };
  return { ...s, phase: 'playing', doubling: { ...s.doubling, passed, awaitingTeam: null } };
}

export function canDeclareProject(s: GameState, seat: Seat): boolean {
  return s.phase === 'playing' && s.trickNo === 0 && s.turn === seat
    && !s.declared.some((d) => d.seat === seat)
    && findProjects(s.initialHands[seat], s.contract!.mode).length > 0;
}

export function canDeclareBaloot(s: GameState, seat: Seat): boolean {
  return s.phase === 'playing' && s.contract!.mode === 'hokm' && s.balootSeat === null
    && hasBaloot(s.initialHands[seat], s.contract!.trump);
}

export function lockedSeat(s: GameState): Seat | null {
  return s.doubling.locked ? s.contract!.buyer : null;
}

export function legalCardsFor(s: GameState, seat: Seat): Card[] {
  if (s.phase !== 'playing' || s.turn !== seat) return [];
  const c = s.contract!;
  return legalCards({ mode: c.mode, trump: c.trump, trick: s.trick, hand: s.hands[seat], seat, lockedSeat: lockedSeat(s) });
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
  let next: GameState = { ...s, hands, trick, declared, turn: nextSeat(seat) };
  if (trick.length < 4) return next;

  const winner = trickWinner(trick, c.mode, c.trump);
  const team = teamOf(winner);
  const tricksWon: [number, number] = [...s.tricksWon];
  const cardAbnat: [number, number] = [...s.cardAbnat];
  tricksWon[team]++;
  cardAbnat[team] += trick.reduce((sum, p) => sum + cardPoints(p.card, c.mode, c.trump), 0);
  if (s.trickNo === 7) cardAbnat[team] += LAST_TRICK_BONUS;

  next = { ...next, trick: [], lastTrick: { cards: trick, winner }, trickNo: s.trickNo + 1, tricksWon, cardAbnat, turn: winner };
  if (s.trickNo === 0) next.projects = resolveProjects(next.declared, nextSeat(s.dealer));
  if (next.trickNo < 8) return next;
  return finishHand(next);
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
  }
}
