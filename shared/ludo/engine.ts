// محرك لعبة لودو — دوال نقية (بلا واجهة)، تصلح للعب المحلي وللخادم لاحقاً.
//
// القوانين (المتعارف عليها في لودو، وهي قوانين لودو كنق الافتراضية):
//  • 2 إلى 4 لاعبين، لكل لاعب 4 أحجار تبدأ في البيت (الحوش).
//  • يرمي اللاعب نرداً واحداً. لا يخرج الحجر من البيت إلا بستة، ويوضع على خانة البداية.
//  • المسار 52 خانة، يدور فيه الحجر دورة كاملة (51 خطوة) ثم يدخل ممره الملوّن (5 خانات) ثم الوسط.
//  • الوصول للوسط بالعدد المضبوط فقط (لا يُسمح بتجاوزه).
//  • الوقوف على خانة فيها حجر خصم يأكله ويرجعه لبيته — إلا في الخانات الآمنة (خانات البداية والنجوم).
//  • رمية إضافية عند: رمي ستة، أكل حجر، أو إدخال حجر للوسط.
//  • ثلاث ستات متتالية: يضيع الدور بلا حركة.
//  • لا حركة ممكنة بعد الرمي: ينتقل الدور تلقائياً.
//  • الفوز: أول من يُدخل أحجاره الأربعة للوسط. في لعب الفرق (4 لاعبين، كل اثنين متقابلين شركاء)
//    من ينهي أحجاره يكمل بأحجار شريكه، ويفوز الفريق عند وصول أحجارهما الثمانية، والشريك لا يأكل شريكه.

export interface LudoRules {
  /** عدد اللاعبين: 2 (متقابلان) أو 3 أو 4 */
  players: 2 | 3 | 4;
  /** فريقان: (0 و2) ضد (1 و3) — لـ 4 لاعبين فقط */
  teams: boolean;
  /** ثلاث ستات متتالية تضيع الدور */
  threeSixes: boolean;
}

export const DEFAULT_RULES: LudoRules = { players: 4, teams: false, threeSixes: true };
export const TEAM_RULES: LudoRules = { players: 4, teams: true, threeSixes: true };

export const TRACK = 52;
/** آخر خطوة على المسار العام قبل الممر الملوّن */
export const LAST_TRACK = 50;
/** الوسط (النهاية) */
export const FINISH = 56;
export const TOKENS = 4;
/** خانات البداية (أماكن خروج كل لون) */
export const STARTS = [0, 13, 26, 39];
/** الخانات الآمنة على المسار العام: البدايات والنجوم */
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** تقدم الحجر: -1 في البيت، 0..50 على المسار العام، 51..55 في الممر الملوّن، 56 في الوسط */
export type Progress = number;
export interface TokenRef { owner: number; index: number }

export interface MoveRecord {
  seat: number;
  roll: number;
  /** null = لم يتحرك (لا حركة ممكنة أو ثلاث ستات) */
  token: TokenRef | null;
  from: Progress | null;
  to: Progress | null;
  captured: TokenRef[];
  finished: boolean;
  threeSixes: boolean;
  extraTurn: boolean;
}

export interface LudoState {
  rules: LudoRules;
  /** المقاعد المشاركة بترتيب اللعب (مع عقارب الساعة) */
  seats: number[];
  /** أحجار كل مقعد (4 مقاعد دائماً؛ غير المشارك أحجاره في البيت ولا يلعب) */
  tokens: Progress[][];
  turn: number;
  phase: 'roll' | 'move' | 'over';
  /** آخر رمية بانتظار الحركة */
  dice: number | null;
  /** عدد الستات المتتالية في هذا الدور */
  sixes: number;
  lastMove: MoveRecord | null;
  /** الفائز: مقعد (فردي) أو رقم الفريق 0/1 (فرق) */
  winner: number | null;
  /** من أنهى أحجاره بالترتيب */
  finishedOrder: number[];
}

export type LudoAction = { type: 'roll'; seat: number } | { type: 'move'; seat: number; token: number };

export class LudoError extends Error {}
const fail = (m: string): never => { throw new LudoError(m); };

type Rng = () => number;

export const teamOf = (seat: number) => seat % 2;
export const absPos = (owner: number, p: Progress) => (STARTS[owner] + p) % TRACK;
export const onTrack = (p: Progress) => p >= 0 && p <= LAST_TRACK;

export function seatsFor(rules: LudoRules): number[] {
  if (rules.players === 2) return [0, 2];
  if (rules.players === 3) return [0, 1, 2];
  return [0, 1, 2, 3];
}

export function newGame(rng: Rng, rules: LudoRules = DEFAULT_RULES): LudoState {
  if (rules.teams && rules.players !== 4) fail('لعب الفرق لأربعة لاعبين فقط');
  const seats = seatsFor(rules);
  return {
    rules, seats,
    tokens: [0, 1, 2, 3].map(() => Array(TOKENS).fill(-1)),
    turn: seats[Math.floor(rng() * seats.length)],
    phase: 'roll', dice: null, sixes: 0, lastMove: null, winner: null, finishedOrder: [],
  };
}

const allHome = (s: LudoState, owner: number) => s.tokens[owner].every((p) => p === FINISH);

/** أحجار من يحركها اللاعب: أحجاره، أو أحجار شريكه إن أنهى أحجاره (لعب الفرق) */
export function controlledOwner(s: LudoState, seat: number): number {
  if (s.rules.teams && allHome(s, seat)) return (seat + 2) % 4;
  return seat;
}

export const nextSeat = (s: LudoState, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

/** هل يمكن تحريك هذا الحجر بهذه الرمية؟ */
export function canMove(s: LudoState, owner: number, index: number, roll: number): boolean {
  const p = s.tokens[owner][index];
  if (p === FINISH) return false;
  if (p === -1) return roll === 6;
  return p + roll <= FINISH;
}

/** أرقام الأحجار التي يمكن تحريكها بالرمية الحالية */
export function movableTokens(s: LudoState, seat: number): number[] {
  if (s.phase !== 'move' || s.turn !== seat || s.dice === null) return [];
  const owner = controlledOwner(s, seat);
  return [0, 1, 2, 3].filter((i) => canMove(s, owner, i, s.dice!));
}

/** هل الحجر (لمالكه) في مكان آمن من الأكل الآن؟ */
export function isSafeSpot(owner: number, p: Progress): boolean {
  return !onTrack(p) || SAFE.has(absPos(owner, p));
}

/** الأحجار التي تُؤكل لو وصل حجر owner إلى p */
export function capturesAt(s: LudoState, owner: number, p: Progress): TokenRef[] {
  if (!onTrack(p)) return [];
  const sq = absPos(owner, p);
  if (SAFE.has(sq)) return [];
  const out: TokenRef[] = [];
  for (const o of s.seats) {
    if (o === owner || (s.rules.teams && teamOf(o) === teamOf(owner))) continue;
    s.tokens[o].forEach((q, index) => { if (onTrack(q) && absPos(o, q) === sq) out.push({ owner: o, index }); });
  }
  return out;
}

export function applyLudo(s: LudoState, a: LudoAction, rng: Rng): LudoState {
  if (s.phase === 'over') fail('انتهت اللعبة');
  if (a.seat !== s.turn) fail('ليس دورك');
  if (a.type === 'roll') {
    if (s.phase !== 'roll') fail('حرّك حجراً أولاً');
    const roll = 1 + Math.floor(rng() * 6);
    const sixes = roll === 6 ? s.sixes + 1 : 0;
    const blank = (extra: Partial<MoveRecord>): MoveRecord => ({
      seat: a.seat, roll, token: null, from: null, to: null, captured: [], finished: false, threeSixes: false, extraTurn: false, ...extra,
    });
    if (s.rules.threeSixes && sixes === 3) {
      return { ...s, phase: 'roll', dice: null, sixes: 0, turn: nextSeat(s, a.seat), lastMove: blank({ threeSixes: true }) };
    }
    const next = { ...s, phase: 'move' as const, dice: roll, sixes };
    if (movableTokens(next, a.seat).length === 0) {
      // لا حركة: ستة تعطي رمية أخرى، وغيرها ينقل الدور
      const again = roll === 6;
      return { ...s, phase: 'roll', dice: null, sixes: again ? sixes : 0, turn: again ? a.seat : nextSeat(s, a.seat), lastMove: blank({ extraTurn: again }) };
    }
    return { ...next, lastMove: s.lastMove };
  }
  if (s.phase !== 'move' || s.dice === null) fail('ارمِ النرد أولاً');
  const roll = s.dice!;
  const owner = controlledOwner(s, a.seat);
  if (!Number.isInteger(a.token) || a.token < 0 || a.token >= TOKENS) fail('حجر غير صالح');
  if (!canMove(s, owner, a.token, roll)) fail('هذا الحجر لا يتحرك بهذه الرمية');
  const from = s.tokens[owner][a.token];
  const to = from === -1 ? 0 : from + roll;
  const captured = capturesAt(s, owner, to);
  const tokens = s.tokens.map((t) => [...t]);
  tokens[owner][a.token] = to;
  for (const c of captured) tokens[c.owner][c.index] = -1;
  const finished = to === FINISH;
  let after: LudoState = { ...s, tokens };
  // من أنهى أحجاره
  const finishedOrder = [...s.finishedOrder];
  if (finished && tokens[owner].every((p) => p === FINISH) && !finishedOrder.includes(owner)) finishedOrder.push(owner);
  after = { ...after, finishedOrder };
  const winner = winnerOf(after);
  const extraTurn = winner === null && (roll === 6 || captured.length > 0 || finished);
  const record: MoveRecord = { seat: a.seat, roll, token: { owner, index: a.token }, from, to, captured, finished, threeSixes: false, extraTurn };
  if (winner !== null) return { ...after, phase: 'over', dice: null, winner, lastMove: record };
  return {
    ...after, phase: 'roll', dice: null,
    sixes: extraTurn && roll === 6 ? s.sixes : 0,
    turn: extraTurn ? a.seat : nextSeat(after, a.seat),
    lastMove: record,
  };
}

function winnerOf(s: LudoState): number | null {
  // الفوز: أول من يوصّل أحجاره الأربعة (في الفرق يفوز فريقه)
  if (s.rules.teams) {
    const first = s.finishedOrder[0];
    return first === undefined ? null : teamOf(first);
  }
  return s.finishedOrder[0] ?? null;
}

/** كم بقي للحجر حتى الوسط */
export const stepsLeft = (p: Progress) => (p === -1 ? FINISH + 1 : FINISH - p);
