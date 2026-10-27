// محرّك لعبة الجاكارو — دوال نقية تصلح للخادم والتطبيق (مثل محرك البلوت).
//
// القوانين (حسب قوانين جواكر الكلاسيكية، والفروقات بين المجالس خيارات في JackarooRules):
//  • 4 لاعبين، فريقان: كل لاعب وشريكه متقابلان (0 و2 ضد 1 و3). لكل لاعب 4 أحجار.
//  • ورقة لعب واحدة 52 ورقة بلا جوكر. التوزيع 4 ثم 4 ثم 5 أوراق لكل لاعب (= 52)، ثم تُخلط من جديد.
//  • كل دور: تلعب ورقة واحدة. إن كان عندك لعب صالح يجب أن تلعب؛ وإن لم يكن "تحرق" ورقة.
//  • الأحجار: في "البيت" ← تنزل لـ"القاعدة" (أول خانة لك على المسار) ← تلف المسار ← تدخل
//    "منطقة الأمان" (4 خانات). الفريق الذي يُدخل أحجاره الثمانية كلها منطقة الأمان يفوز.
//  • الأوراق:
//      أص: إنزال حجر من البيت، أو التقدم 1 أو 11.     شايب: إنزال حجر من البيت (أو 13 إن فُعّل الخيار).
//      بنت: 12.     ولد: تبديل حجر لك بحجر لاعب آخر على المسار.
//      10: التقدم 10، أو إجبار اللاعب التالي أن يحرق ورقة ويضيع دوره.
//      7: تقسيمها خطوات بين حجرين (مثلاً 5 و2) أو كلها لحجر.     5: تحريك أي حجر على اللوحة 5 للأمام (حتى حجر الخصم).
//      4: الرجوع 4 خطوات للخلف.     9، 8، 6، 3، 2: التقدم بقيمتها.
//  • الحجر على قاعدته (نزل للتو) محمي: لا يُتخطّى ولا يُؤكل ولا يُبدَّل.
//  • من يقف على حجر غيره (حتى شريكه) يرجعه لبيته. لا يجوز الوقوف على حجرك.
//  • لا يُتخطّى حجر داخل منطقة الأمان، والدخول إليها بالعدد المضبوط فقط.
//  • من أدخل أحجاره الأربعة منطقة الأمان يلعب بأوراقه أحجار شريكه.

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export interface Card { rank: Rank; suit: Suit }

export interface JackarooRules {
  /** عدد خانات المسار لكل لاعب (المسار كله = 4 × هذا) */
  segment: number;
  /** الشايب يتقدم 13 أيضاً (في كثير من المجالس) */
  kingThirteen: boolean;
}
export const DEFAULT_RULES: JackarooRules = { segment: 19, kingThirteen: true };

export const SAFE_SIZE = 4;
export const PLAYERS = 4;

export type Marble =
  | { zone: 'home' }
  | { zone: 'track'; pos: number } // موضع مطلق على المسار
  | { zone: 'safe'; pos: number }; // 0..3

export interface MarbleRef { owner: number; index: number }

export type MoveSpec =
  | { kind: 'out'; marble: MarbleRef }
  | { kind: 'forward'; marble: MarbleRef; steps: number }
  | { kind: 'back'; marble: MarbleRef; steps: number }
  | { kind: 'swap'; mine: MarbleRef; other: MarbleRef }
  | { kind: 'split'; parts: { marble: MarbleRef; steps: number }[] }
  | { kind: 'skipNext' };

export interface LegalMove { card: Card; move: MoveSpec }

export interface MoveRecord {
  seat: number;
  card: Card;
  move: MoveSpec | null; // null = حرق
  captured: MarbleRef[];
  enteredSafe: MarbleRef[];
}

export interface JackarooState {
  rules: JackarooRules;
  marbles: Marble[][];
  hands: Card[][];
  deck: Card[];
  /** أوراق ملعوبة ومحروقة */
  pile: Card[];
  dealer: number;
  /** رقم التوزيعة داخل الورقة (0: 4 أوراق، 1: 4، 2: 5) */
  dealNo: number;
  turn: number;
  /** على هذا اللاعب أن يحرق ورقة (بسبب عشرة الخصم) ثم يضيع دوره */
  forcedBurn: number | null;
  phase: 'playing' | 'over';
  winnerTeam: number | null;
  lastMove: MoveRecord | null;
}

export type JackarooAction =
  | { type: 'play'; seat: number; card: Card; move: MoveSpec }
  | { type: 'burn'; seat: number; card: Card };

export class JackarooError extends Error {}
const fail = (m: string): never => { throw new JackarooError(m); };
export type Rng = () => number;

// ───── أساسيات ─────

export const teamOf = (seat: number) => seat % 2;
export const partnerOf = (seat: number) => (seat + 2) % PLAYERS;
export const nextSeat = (seat: number) => (seat + 1) % PLAYERS;
export const trackLen = (r: JackarooRules) => r.segment * PLAYERS;
export const startOf = (r: JackarooRules, owner: number) => owner * r.segment;
export const sameCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

/** كم قطع الحجر من مساره (0 = على قاعدته) */
export const progressOf = (r: JackarooRules, owner: number, pos: number) => (pos - startOf(r, owner) + trackLen(r)) % trackLen(r);

export function fullDeck(): Card[] {
  const ranks: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  return (['S', 'H', 'D', 'C'] as Suit[]).flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
}

export function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DEAL_SIZES = [4, 4, 5];

function deal(s: JackarooState, rng: Rng): JackarooState {
  let deck = s.deck;
  let pile = s.pile;
  let dealer = s.dealer;
  let dealNo = s.dealNo;
  if (dealNo >= DEAL_SIZES.length || deck.length < DEAL_SIZES[dealNo] * PLAYERS) {
    // ورقة جديدة: نخلط كل الأوراق، وينتقل التوزيع للاعب التالي
    deck = shuffle(fullDeck(), rng);
    pile = [];
    dealNo = 0;
    dealer = nextSeat(dealer);
  }
  const n = DEAL_SIZES[dealNo];
  const hands = Array.from({ length: PLAYERS }, (_, i) => deck.slice(i * n, i * n + n));
  return { ...s, hands, deck: deck.slice(n * PLAYERS), pile, dealer, dealNo: dealNo + 1, turn: nextSeat(dealer), forcedBurn: null };
}

export function newGame(rng: Rng, rules: JackarooRules = DEFAULT_RULES): JackarooState {
  const s: JackarooState = {
    rules,
    marbles: Array.from({ length: PLAYERS }, () => Array.from({ length: 4 }, () => ({ zone: 'home' }) as Marble)),
    hands: [], deck: [], pile: [], dealer: PLAYERS - 1, dealNo: DEAL_SIZES.length,
    turn: 0, forcedBurn: null, phase: 'playing', winnerTeam: null, lastMove: null,
  };
  return deal(s, rng);
}

// ───── المواضع ─────

/** من على هذه الخانة من المسار */
function occupantAt(s: JackarooState, pos: number): MarbleRef | null {
  for (let owner = 0; owner < PLAYERS; owner++) {
    const i = s.marbles[owner].findIndex((m) => m.zone === 'track' && m.pos === pos);
    if (i >= 0) return { owner, index: i };
  }
  return null;
}

/** حجر جالس على قاعدته: محمي، لا يُتخطّى ولا يُؤكل ولا يُبدَّل */
function protectedAt(s: JackarooState, pos: number): boolean {
  const o = occupantAt(s, pos);
  return !!o && pos === startOf(s.rules, o.owner);
}

export const isFinished = (s: JackarooState, owner: number) => s.marbles[owner].every((m) => m.zone === 'safe');

/** الأحجار التي يحرّكها هذا اللاعب: أحجاره، وإن أنهاها كلها فأحجار شريكه */
export function controlledOwner(s: JackarooState, seat: number): number {
  return isFinished(s, seat) ? partnerOf(seat) : seat;
}

const marble = (s: JackarooState, r: MarbleRef) => s.marbles[r.owner][r.index];

function setMarble(s: JackarooState, r: MarbleRef, m: Marble): JackarooState {
  const marbles = s.marbles.map((row, o) => (o === r.owner ? row.map((x, i) => (i === r.index ? m : x)) : row));
  return { ...s, marbles };
}

interface StepResult { state: JackarooState; captured: MarbleRef[]; enteredSafe: boolean }

/** يحرك حجراً للأمام: يرجع null إن كانت الحركة غير ممكنة */
function stepForward(s: JackarooState, ref: MarbleRef, steps: number): StepResult | null {
  const m = marble(s, ref);
  const L = trackLen(s.rules);
  if (m.zone === 'home' || steps <= 0) return null;
  if (m.zone === 'safe') {
    const to = m.pos + steps;
    if (to >= SAFE_SIZE) return null;
    for (let p = m.pos + 1; p <= to; p++) if (s.marbles[ref.owner].some((x) => x.zone === 'safe' && x.pos === p)) return null;
    return { state: setMarble(s, ref, { zone: 'safe', pos: to }), captured: [], enteredSafe: false };
  }
  const prog = progressOf(s.rules, ref.owner, m.pos);
  const target = prog + steps;
  // المسار حتى نهاية لفّته (تقدّم حتى L−1)، ثم منطقة الأمان
  const trackSteps = Math.min(target, L - 1) - prog;
  for (let k = 1; k <= trackSteps; k++) {
    const pos = (m.pos + k) % L;
    if (protectedAt(s, pos)) return null; // لا يُتخطّى ولا يُؤكل الحجر على قاعدته
  }
  if (target <= L - 1) {
    const pos = (m.pos + steps) % L;
    const occ = occupantAt(s, pos);
    if (occ && occ.owner === ref.owner) return null; // لا تقف على حجرك
    let next = s;
    const captured: MarbleRef[] = [];
    if (occ) { next = setMarble(next, occ, { zone: 'home' }); captured.push(occ); }
    return { state: setMarble(next, ref, { zone: 'track', pos }), captured, enteredSafe: false };
  }
  // دخول منطقة الأمان بالعدد المضبوط، بلا تخطي حجر فيها
  const safePos = target - L;
  if (safePos >= SAFE_SIZE) return null;
  for (let p = 0; p <= safePos; p++) if (s.marbles[ref.owner].some((x) => x.zone === 'safe' && x.pos === p)) return null;
  return { state: setMarble(s, ref, { zone: 'safe', pos: safePos }), captured: [], enteredSafe: true };
}

function stepBack(s: JackarooState, ref: MarbleRef, steps: number): StepResult | null {
  const m = marble(s, ref);
  if (m.zone !== 'track') return null;
  const L = trackLen(s.rules);
  for (let k = 1; k <= steps; k++) {
    const pos = (m.pos - k + L) % L;
    if (protectedAt(s, pos)) return null;
  }
  const pos = (m.pos - steps + L) % L;
  const occ = occupantAt(s, pos);
  if (occ && occ.owner === ref.owner) return null;
  let next = s;
  const captured: MarbleRef[] = [];
  if (occ) { next = setMarble(next, occ, { zone: 'home' }); captured.push(occ); }
  return { state: setMarble(next, ref, { zone: 'track', pos }), captured, enteredSafe: false };
}

function takeOut(s: JackarooState, ref: MarbleRef): StepResult | null {
  if (marble(s, ref).zone !== 'home') return null;
  const pos = startOf(s.rules, ref.owner);
  const occ = occupantAt(s, pos);
  if (occ && occ.owner === ref.owner) return null;
  let next = s;
  const captured: MarbleRef[] = [];
  if (occ) { next = setMarble(next, occ, { zone: 'home' }); captured.push(occ); }
  return { state: setMarble(next, ref, { zone: 'track', pos }), captured, enteredSafe: false };
}

function swap(s: JackarooState, a: MarbleRef, b: MarbleRef): StepResult | null {
  const ma = marble(s, a);
  const mb = marble(s, b);
  if (a.owner === b.owner || ma.zone !== 'track' || mb.zone !== 'track') return null;
  if (protectedAt(s, ma.pos) || protectedAt(s, mb.pos)) return null;
  let next = setMarble(s, a, { zone: 'track', pos: mb.pos });
  next = setMarble(next, b, { zone: 'track', pos: ma.pos });
  return { state: next, captured: [], enteredSafe: false };
}

// ───── الأوراق ─────

const FORWARD: Partial<Record<Rank, number[]>> = {
  A: [1, 11], Q: [12], '10': [10], '9': [9], '8': [8], '6': [6], '3': [3], '2': [2],
};

const refsOf = (owner: number): MarbleRef[] => [0, 1, 2, 3].map((index) => ({ owner, index }));

/** كل الحركات الممكنة بهذه الورقة لهذا اللاعب */
export function movesForCard(s: JackarooState, seat: number, card: Card): MoveSpec[] {
  const owner = controlledOwner(s, seat);
  const mine = refsOf(owner);
  const out: MoveSpec[] = [];
  const can = (r: StepResult | null) => r !== null;
  const forward = (steps: number, refs = mine) => {
    for (const marble of refs) if (can(stepForward(s, marble, steps))) out.push({ kind: 'forward', marble, steps });
  };
  if (card.rank === 'A' || card.rank === 'K') {
    const home = mine.find((r) => s.marbles[r.owner][r.index].zone === 'home');
    if (home && can(takeOut(s, home))) out.push({ kind: 'out', marble: home });
  }
  if (card.rank === 'K' && s.rules.kingThirteen) forward(13);
  for (const n of FORWARD[card.rank] ?? []) forward(n);
  if (card.rank === '10') out.push({ kind: 'skipNext' });
  if (card.rank === '5') {
    // الخمسة: أي حجر على اللوحة (أحجارك أو الشريك أو الخصم)
    forward(5, [0, 1, 2, 3].flatMap(refsOf));
  }
  if (card.rank === '4') {
    for (const marble of mine) if (can(stepBack(s, marble, 4))) out.push({ kind: 'back', marble, steps: 4 });
  }
  if (card.rank === 'J') {
    for (const a of mine) for (let o = 0; o < PLAYERS; o++) {
      if (o === owner) continue;
      for (const b of refsOf(o)) if (can(swap(s, a, b))) out.push({ kind: 'swap', mine: a, other: b });
    }
  }
  if (card.rank === '7') {
    forward(7);
    for (let a = 1; a <= 6; a++) {
      for (const x of mine) for (const y of mine) {
        if (x.index >= y.index) continue;
        const first = stepForward(s, x, a);
        if (first && stepForward(first.state, y, 7 - a)) out.push({ kind: 'split', parts: [{ marble: x, steps: a }, { marble: y, steps: 7 - a }] });
        const firstY = stepForward(s, y, 7 - a);
        if (a !== 7 - a && firstY && stepForward(firstY.state, x, a)) {
          // نفس التقسيم بترتيب آخر قد يختلف أثره (أكل/حجب): نضيفه إن لم يكن مكرراً
          out.push({ kind: 'split', parts: [{ marble: y, steps: 7 - a }, { marble: x, steps: a }] });
        }
      }
    }
  }
  return out;
}

export function legalMoves(s: JackarooState, seat: number): LegalMove[] {
  if (s.phase !== 'playing' || s.turn !== seat || s.forcedBurn === seat) return [];
  return s.hands[seat].flatMap((card) => movesForCard(s, seat, card).map((move) => ({ card, move })));
}

/** لا لعب صالح بأي ورقة: يحرق ورقة */
export const mustBurn = (s: JackarooState, seat: number) =>
  s.phase === 'playing' && s.turn === seat && s.hands[seat].length > 0 && (s.forcedBurn === seat || legalMoves(s, seat).length === 0);

const sameRef = (a: MarbleRef, b: MarbleRef) => a.owner === b.owner && a.index === b.index;
export function sameMove(a: MoveSpec, b: MoveSpec): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'out': return sameRef(a.marble, (b as typeof a).marble);
    case 'forward': case 'back': return sameRef(a.marble, (b as typeof a).marble) && a.steps === (b as typeof a).steps;
    case 'swap': return sameRef(a.mine, (b as typeof a).mine) && sameRef(a.other, (b as typeof a).other);
    case 'split': {
      const p = (b as typeof a).parts;
      return a.parts.length === p.length && a.parts.every((x, i) => sameRef(x.marble, p[i].marble) && x.steps === p[i].steps);
    }
    case 'skipNext': return true;
  }
}

// ───── تطبيق الحركة ─────

function execute(s: JackarooState, move: MoveSpec): { state: JackarooState; captured: MarbleRef[]; enteredSafe: MarbleRef[] } {
  const captured: MarbleRef[] = [];
  const enteredSafe: MarbleRef[] = [];
  const apply = (st: JackarooState, r: StepResult | null, who?: MarbleRef): JackarooState => {
    if (!r) fail('حركة غير صالحة');
    captured.push(...r!.captured);
    if (r!.enteredSafe && who) enteredSafe.push(who);
    return r!.state;
  };
  switch (move.kind) {
    case 'out': return { state: apply(s, takeOut(s, move.marble)), captured, enteredSafe };
    case 'forward': return { state: apply(s, stepForward(s, move.marble, move.steps), move.marble), captured, enteredSafe };
    case 'back': return { state: apply(s, stepBack(s, move.marble, move.steps)), captured, enteredSafe };
    case 'swap': return { state: apply(s, swap(s, move.mine, move.other)), captured, enteredSafe };
    case 'split': {
      let st = s;
      for (const p of move.parts) st = apply(st, stepForward(st, p.marble, p.steps), p.marble);
      return { state: st, captured, enteredSafe };
    }
    case 'skipNext': return { state: s, captured, enteredSafe };
  }
}

export function applyJackaroo(s: JackarooState, a: JackarooAction, rng: Rng): JackarooState {
  if (s.phase !== 'playing') fail('انتهت اللعبة');
  if (s.turn !== a.seat) fail('ليس دورك');
  const inHand = s.hands[a.seat].find((c) => sameCard(c, a.card));
  if (!inHand) fail('الورقة ليست معك');
  const hands = s.hands.map((h, i) => (i === a.seat ? h.filter((c) => !sameCard(c, a.card)) : h));
  let next: JackarooState;
  let record: MoveRecord;
  if (a.type === 'burn') {
    if (!mustBurn(s, a.seat)) fail('عندك لعب صالح، لا يجوز الحرق');
    next = { ...s, hands, pile: [...s.pile, a.card], forcedBurn: null };
    record = { seat: a.seat, card: a.card, move: null, captured: [], enteredSafe: [] };
  } else {
    if (s.forcedBurn === a.seat) fail('عليك أن تحرق ورقة');
    if (!movesForCard(s, a.seat, a.card).some((m) => sameMove(m, a.move))) fail('حركة غير صالحة');
    const r = execute(s, a.move);
    next = { ...r.state, hands, pile: [...s.pile, a.card] };
    record = { seat: a.seat, card: a.card, move: a.move, captured: r.captured, enteredSafe: r.enteredSafe };
    // العشرة: اللاعب التالي يحرق ورقة ويضيع دوره
    if (a.move.kind === 'skipNext' && hands[nextSeat(a.seat)].length > 0) next.forcedBurn = nextSeat(a.seat);
  }
  next.lastMove = record;
  // فاز فريق بإدخال أحجاره الثمانية
  for (const team of [0, 1]) {
    if (isFinished(next, team) && isFinished(next, team + 2)) return { ...next, phase: 'over', winnerTeam: team };
  }
  next.turn = nextSeat(a.seat);
  // انتهت أوراق الجميع: توزيعة جديدة
  if (next.hands.every((h) => h.length === 0)) next = deal(next, rng);
  return next;
}
