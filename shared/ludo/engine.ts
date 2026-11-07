// محرك لعبة لودو — دوال نقية (بلا واجهة)، تصلح للعب المحلي وللخادم لاحقاً.
//
// القوانين (المتعارف عليها في لودو، وهي قوانين لودو كنق الافتراضية):
//  • 2 إلى 4 لاعبين، لكل لاعب 4 أحجار تبدأ في البيت (الحوش).
//  • يرمي اللاعب نرداً واحداً. لا يخرج الحجر من البيت إلا بستة، ويوضع على خانة البداية.
//  • المسار 52 خانة، يمشي الحجر منها 51 (من خانة بدايته لين الخانة اللي قبل بيته: الأحمر لين 51) ثم يدخل
//    ممره الملوّن على طول: 5 خانات داخل المنزل، والسادسة الوسط (الفوز).
//  • الوصول للوسط بالعدد المضبوط فقط (لا يُسمح بتجاوزه).
//  • الوقوف على خانة فيها حجر خصم يأكله ويرجعه لبيته — إلا في الخانات الآمنة (خانات البداية والنجوم).
//  • الستة: يرمي مرة ثانية فوراً (قبل ما يحرك)، والأرقام تتجمع (مثلاً 6 و3)، وبعدها يختار لكل رقم الحجر اللي يمشيه:
//    يطلّع حجر بالستة، أو يمشي حجر 6 وحجر 3، أو نفس الحجر 6 ثم 3.
//  • رمية إضافية بعد الحركة عند: أكل حجر، أو إدخال حجر للوسط.
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
/** يمشي الحجر 51 خانة من المسار (0..50 نسبةً لكل لون)، ثم ممر المنزل 5 خانات (51..55)، ثم المنزل 56 */
export const LAST_TRACK = 50;
/** المنزل (النهاية) */
export const FINISH = 56;
export const TOKENS = 4;
/** خانات البداية (أماكن خروج كل لون) */
export const STARTS = [0, 13, 26, 39];
/** الخانات الآمنة على المسار العام: البدايات والنجوم */
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** تقدم الحجر: -1 في القاعدة، 0..50 على المسار العام، 51..55 في ممر المنزل، 56 في المنزل */
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
  /** رمى ستة: يرمي مرة ثانية قبل ما يحرك */
  rollAgain?: boolean;
}

export interface LudoState {
  rules: LudoRules;
  /** المقاعد المشاركة بترتيب اللعب (مع عقارب الساعة) */
  seats: number[];
  /** أحجار كل مقعد (4 مقاعد دائماً؛ غير المشارك أحجاره في البيت ولا يلعب) */
  tokens: Progress[][];
  turn: number;
  phase: 'roll' | 'move' | 'over';
  /** أول رقم بانتظار الحركة (للتوافق: نفس pool[0]) */
  dice: number | null;
  /** كل الأرقام اللي رماها في هذا الدور وما استخدمها بعد (الستات تتجمع مع اللي بعدها) */
  pool?: number[];
  /** أكل أو وصّل حجر للمنزل في هذا الدور: يرمي مرة ثانية بعد ما يخلص أرقامه */
  bonus?: boolean;
  /** عدد الستات المتتالية في هذا الدور */
  sixes: number;
  lastMove: MoveRecord | null;
  /** آخر رمية نرد (مين رماها وكم) ومعها عدّاد يزيد مع كل رمية — الواجهة تعرض النرد الجديد على طول منه */
  lastRolled?: { seat: number; roll: number; seq: number };
  /** الفائز: مقعد (فردي) أو رقم الفريق 0/1 (فرق) */
  winner: number | null;
  /** من أنهى أحجاره بالترتيب */
  finishedOrder: number[];
}

/** die: أي رقم من الأرقام المتجمعة يستخدم (بدونه: أول رقم يقدر يحرك هالحجر) */
export type LudoAction = { type: 'roll'; seat: number } | { type: 'move'; seat: number; token: number; die?: number };
export interface MoveOption { token: number; die: number }

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

/** الأرقام المتجمعة اللي تنتظر الحركة */
export const poolOf = (s: LudoState): number[] => s.pool ?? (s.dice !== null ? [s.dice] : []);

/** كل حركة ممكنة الحين: (الحجر، الرقم) — رقم مكرر يُحسب مرة وحدة */
export function moveOptions(s: LudoState, seat: number): MoveOption[] {
  if (s.phase !== 'move' || s.turn !== seat) return [];
  const owner = controlledOwner(s, seat);
  const out: MoveOption[] = [];
  for (const die of [...new Set(poolOf(s))]) for (const token of [0, 1, 2, 3]) if (canMove(s, owner, token, die)) out.push({ token, die });
  return out;
}

/** أرقام الأحجار التي يمكن تحريكها بأي رقم من الأرقام المتجمعة */
export function movableTokens(s: LudoState, seat: number): number[] {
  return [...new Set(moveOptions(s, seat).map((o) => o.token))];
}

/** هل الحجر (لمالكه) في مكان آمن من الأكل الآن؟ */
export function isSafeSpot(owner: number, p: Progress): boolean {
  return !onTrack(p) || SAFE.has(absPos(owner, p));
}

/**
 * الأحجار التي تُؤكل لو وصل حجر owner إلى p: قطعة خصم وحدة على خانة غير آمنة ترجع للقاعدة.
 * قطعتين أو أكثر من نفس اللون على خانة = حاجز: تقدر تنزل عليها (تتكدس) بس ما تاكلها.
 */
export function capturesAt(s: LudoState, owner: number, p: Progress): TokenRef[] {
  if (!onTrack(p)) return [];
  const sq = absPos(owner, p);
  if (SAFE.has(sq)) return [];
  const out: TokenRef[] = [];
  for (const o of s.seats) {
    if (o === owner || (s.rules.teams && teamOf(o) === teamOf(owner))) continue;
    const here: TokenRef[] = [];
    s.tokens[o].forEach((q, index) => { if (onTrack(q) && absPos(o, q) === sq) here.push({ owner: o, index }); });
    if (here.length === 1) out.push(here[0]);
  }
  return out;
}

/** النرد: الستة 25%، وكل رقم من 1 إلى 5 بـ 15% */
export function rollDice(rng: Rng): number {
  const r = rng();
  return r < 0.25 ? 6 : 1 + Math.min(4, Math.floor((r - 0.25) / 0.15));
}

export function applyLudo(s: LudoState, a: LudoAction, rng: Rng): LudoState {
  if (s.phase === 'over') fail('انتهت اللعبة');
  if (a.seat !== s.turn) fail('ليس دورك');
  const endTurn = (st: LudoState, again: boolean, lastMove: MoveRecord): LudoState => ({
    ...st, phase: 'roll', dice: null, pool: [], bonus: false, sixes: 0, turn: again ? a.seat : nextSeat(st, a.seat), lastMove,
  });
  if (a.type === 'roll') {
    if (s.phase !== 'roll') fail('حرّك حجراً أولاً');
    const roll = rollDice(rng);
    const sixes = roll === 6 ? s.sixes + 1 : s.sixes;
    s = { ...s, lastRolled: { seat: a.seat, roll, seq: (s.lastRolled?.seq ?? 0) + 1 } };
    const blank = (extra: Partial<MoveRecord>): MoveRecord => ({
      seat: a.seat, roll, token: null, from: null, to: null, captured: [], finished: false, threeSixes: false, extraTurn: false, ...extra,
    });
    // ثلاث ستات ورا بعض: يضيع الدور وكل أرقامه
    if (s.rules.threeSixes && roll === 6 && sixes === 3) return endTurn(s, false, blank({ threeSixes: true }));
    const pool = [...(s.pool ?? []), roll];
    // ستة: يرمي مرة ثانية قبل ما يحرك، والرقم يبقى معه
    if (roll === 6) return { ...s, phase: 'roll', dice: null, pool, sixes, lastMove: blank({ rollAgain: true }) };
    const next: LudoState = { ...s, phase: 'move', pool, dice: pool[0], sixes };
    if (moveOptions(next, a.seat).length === 0) {
      // ما فيه حركة بأي رقم: ينتقل الدور (أو يرمي مرة ثانية لو عنده رمية إضافية من أكل)
      return endTurn(s, s.bonus === true, blank({ extraTurn: s.bonus === true }));
    }
    return { ...next, lastMove: s.lastMove };
  }
  if (s.phase !== 'move') fail('ارمِ النرد أولاً');
  const pool = poolOf(s);
  const owner = controlledOwner(s, a.seat);
  if (!Number.isInteger(a.token) || a.token < 0 || a.token >= TOKENS) fail('حجر غير صالح');
  const die = a.die ?? pool.find((d) => canMove(s, owner, a.token, d));
  if (die === undefined || !pool.includes(die)) fail('ما عندك هالرقم');
  if (!canMove(s, owner, a.token, die!)) fail('هذا الحجر لا يتحرك بهذه الرمية');
  const roll = die!;
  const from = s.tokens[owner][a.token];
  const to = from === -1 ? 0 : from + roll;
  const captured = capturesAt(s, owner, to);
  const tokens = s.tokens.map((t) => [...t]);
  tokens[owner][a.token] = to;
  for (const c of captured) tokens[c.owner][c.index] = -1;
  const finished = to === FINISH;
  const finishedOrder = [...s.finishedOrder];
  if (finished && tokens[owner].every((p) => p === FINISH) && !finishedOrder.includes(owner)) finishedOrder.push(owner);
  const after: LudoState = { ...s, tokens, finishedOrder };
  const winner = winnerOf(after);
  const bonus = s.bonus === true || captured.length > 0 || finished;
  const rest = [...pool]; rest.splice(rest.indexOf(roll), 1);
  const record = (extraTurn: boolean): MoveRecord => ({ seat: a.seat, roll, token: { owner, index: a.token }, from, to, captured, finished, threeSixes: false, extraTurn });
  if (winner !== null) return { ...after, phase: 'over', dice: null, pool: [], winner, lastMove: record(false) };
  // باقي أرقام وتقدر تتحرك فيها: يكمل يختار
  const cont: LudoState = { ...after, phase: 'move', pool: rest, dice: rest[0] ?? null, bonus };
  if (rest.length && moveOptions(cont, a.seat).length) return { ...cont, lastMove: record(false) };
  return endTurn(after, bonus, record(bonus));
}

function winnerOf(s: LudoState): number | null {
  // الفوز الجماعي: تصل كل قطع الزميلين معاً (ومن أنهى قطعه يلعب بقطع زميله)
  if (s.rules.teams) {
    for (const team of [0, 1]) if (allHome(s, team) && allHome(s, team + 2)) return team;
    return null;
  }
  return s.finishedOrder[0] ?? null;
}

/** كم بقي للحجر حتى الوسط */
export const stepsLeft = (p: Progress) => (p === -1 ? FINISH + 1 : FINISH - p);
