// محرّك لعبة الدومينو (قطع 0–6، 28 قطعة) — دوال نقية مثل محرّك البلوت، تصلح للخادم والتطبيق.
//
// القوانين (قابلة للتعديل من DominoRules):
//  • 2 أو 3 أو 4 لاعبين. مع 4: فريقان، كل لاعب وشريكه متقابلان (0 و2 ضد 1 و3).
//  • لكل لاعب 7 قطع. مع 4 لاعبين لا يبقى "بنك" فمن لا يملك قطعة مناسبة "يدق" (يمرّر)؛
//    مع 2 أو 3 يسحب من البنك حتى يجد قطعة مناسبة، فإن فرغ البنك يدق.
//  • أول صكة يبدأها صاحب دوس الستة (أو أعلى دوس، أو أعلى قطعة إن لم يوجد دوس) ويلعبه إجبارياً.
//    الصكات التالية يبدأها الفائز بالصكة السابقة بأي قطعة.
//  • تنتهي الصكة عندما "يقفل" لاعب (تخلص قطعه): يأخذ هو (أو فريقه) مجموع نقاط قطع الخصوم.
//  • إن انسدّ اللعب (لا أحد يستطيع اللعب): يفوز الأقل مجموعاً في يده (أو فريقه) ويأخذ مجموع
//    قطع الخصوم. عند التعادل لا يأخذ أحد شيئاً.
//  • تنتهي المباراة عند الوصول لهدف النقاط (101 افتراضياً).

export type Pip = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export interface Tile { a: Pip; b: Pip }
export type Side = 'left' | 'right';

export interface DominoRules {
  players: 2 | 3 | 4;
  /** هدف المباراة */
  target: number;
}

export const DEFAULT_RULES: DominoRules = { players: 4, target: 101 };

export interface PlacedTile {
  tile: Tile;
  seat: number;
  /** الوجه الظاهر للخارج بعد وضعها (الطرف الجديد) */
  outer: Pip;
  side: Side | 'first';
}

export interface HandResult {
  /** "قفل": خلصت قطع لاعب — "مسدود": لا أحد يستطيع اللعب */
  kind: 'domino' | 'blocked';
  /** الفائز: مقعد (للفردي) — مع الفرق نحفظ مقعد اللاعب الذي قفل أو الأقل مجموعاً */
  winnerSeat: number | null;
  /** نقاط كل جانب في هذه الصكة (فريق أو لاعب) */
  points: number[];
  /** مجموع ما بقي في يد كل لاعب */
  remaining: number[];
}

export interface DominoState {
  rules: DominoRules;
  hands: Tile[][];
  boneyard: Tile[];
  /** خط اللعب من اليسار لليمين */
  line: PlacedTile[];
  turn: number;
  /** عدد الدقّات المتتالية (لاكتشاف الانسداد) */
  passes: number;
  /** نقاط المباراة لكل جانب */
  scores: number[];
  handNo: number;
  /** من يبدأ الصكة التالية */
  nextStarter: number | null;
  phase: 'playing' | 'handOver' | 'matchOver';
  lastHand: HandResult | null;
  /** آخر حركة (للإعلانات والمؤثرات) */
  lastMove: { seat: number; kind: 'play' | 'draw' | 'pass'; placed?: PlacedTile } | null;
}

export type DominoAction =
  | { type: 'play'; seat: number; tile: Tile; side?: Side }
  | { type: 'draw'; seat: number }
  | { type: 'pass'; seat: number };

export class DominoError extends Error {}
const fail = (m: string): never => { throw new DominoError(m); };

export type Rng = () => number;

// ───── القطع ─────

export const pips = (t: Tile) => t.a + t.b;
export const isDouble = (t: Tile) => t.a === t.b;
export const sameTile = (x: Tile, y: Tile) => (x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a);
export const tileId = (t: Tile) => `${Math.max(t.a, t.b)}-${Math.min(t.a, t.b)}`;

export function fullSet(): Tile[] {
  const set: Tile[] = [];
  for (let a = 0; a <= 6; a++) for (let b = 0; b <= a; b++) set.push({ a: a as Pip, b: b as Pip });
  return set;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const x = [...items];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

// ───── الفرق ─────

/** عدد الجوانب: فريقان مع 4 لاعبين، وإلا كل لاعب لنفسه */
export const sidesCount = (r: DominoRules) => (r.players === 4 ? 2 : r.players);
export const sideOf = (r: DominoRules, seat: number) => (r.players === 4 ? seat % 2 : seat);
export const nextSeat = (r: DominoRules, seat: number) => (seat + 1) % r.players;

// ───── الأطراف ─────

export function ends(s: DominoState): { left: Pip; right: Pip } | null {
  if (!s.line.length) return null;
  const first = s.line[0];
  const last = s.line[s.line.length - 1];
  return { left: first.side === 'first' ? first.tile.a : first.outer, right: last.side === 'first' ? last.tile.b : last.outer };
}

/** الأطراف التي تصلح لها القطعة */
export function fits(s: DominoState, t: Tile): Side[] {
  const e = ends(s);
  if (!e) return ['left'];
  const out: Side[] = [];
  if (t.a === e.left || t.b === e.left) out.push('left');
  if (t.a === e.right || t.b === e.right) out.push('right');
  return out;
}

export function playable(s: DominoState, seat: number): Tile[] {
  if (s.phase !== 'playing' || s.turn !== seat) return [];
  // أول قطعة في أول صكة: الإجبارية فقط
  if (!s.line.length && s.handNo === 1) {
    const forced = openingTile(s.hands);
    return s.hands[seat].filter((t) => forced && sameTile(t, forced));
  }
  return s.hands[seat].filter((t) => fits(s, t).length > 0);
}

export const canDraw = (s: DominoState, seat: number) =>
  s.phase === 'playing' && s.turn === seat && s.line.length > 0 && playable(s, seat).length === 0 && s.boneyard.length > 0;
export const canPass = (s: DominoState, seat: number) =>
  s.phase === 'playing' && s.turn === seat && s.line.length > 0 && playable(s, seat).length === 0 && s.boneyard.length === 0;

/** قطعة الافتتاح الإجبارية في أول صكة: دوس الستة، أو أعلى دوس، أو أعلى قطعة */
export function openingTile(hands: Tile[][]): Tile | null {
  const all = hands.flat();
  const doubles = all.filter(isDouble).sort((x, y) => y.a - x.a);
  if (doubles.length) return doubles[0];
  return [...all].sort((x, y) => pips(y) - pips(x) || Math.max(y.a, y.b) - Math.max(x.a, x.b))[0] ?? null;
}

// ───── التوزيع ─────

export function dealHand(rules: DominoRules, scores: number[], handNo: number, starter: number | null, rng: Rng): DominoState {
  const set = shuffle(fullSet(), rng);
  const hands = Array.from({ length: rules.players }, (_, i) => set.slice(i * 7, i * 7 + 7));
  const boneyard = set.slice(rules.players * 7);
  let turn = starter ?? 0;
  if (handNo === 1 || starter === null) {
    const opening = openingTile(hands)!;
    turn = hands.findIndex((h) => h.some((t) => sameTile(t, opening)));
  }
  return {
    rules, hands, boneyard, line: [], turn, passes: 0, scores, handNo, nextStarter: null,
    phase: 'playing', lastHand: null, lastMove: null,
  };
}

export function newMatch(rng: Rng, rules: DominoRules = DEFAULT_RULES): DominoState {
  return dealHand(rules, Array(sidesCount(rules)).fill(0), 1, null, rng);
}

export function nextHand(s: DominoState, rng: Rng): DominoState {
  if (s.phase !== 'handOver') fail('الصكة لم تنته');
  return dealHand(s.rules, s.scores, s.handNo + 1, s.nextStarter, rng);
}

// ───── الحركات ─────

export function applyDomino(s: DominoState, a: DominoAction): DominoState {
  if (s.phase !== 'playing') fail('اللعب متوقف');
  if (s.turn !== a.seat) fail('ليس دورك');
  switch (a.type) {
    case 'play': return applyPlay(s, a.seat, a.tile, a.side);
    case 'draw': {
      if (!canDraw(s, a.seat)) fail('لا يمكنك السحب الآن');
      const [tile, ...rest] = s.boneyard;
      const hands = s.hands.map((h, i) => (i === a.seat ? [...h, tile] : h));
      return { ...s, hands, boneyard: rest, lastMove: { seat: a.seat, kind: 'draw' } };
    }
    case 'pass': {
      if (!canPass(s, a.seat)) fail('عندك قطعة تصلح، أو يمكنك السحب');
      const passes = s.passes + 1;
      const next = { ...s, passes, turn: nextSeat(s.rules, a.seat), lastMove: { seat: a.seat, kind: 'pass' as const } };
      // دقّ الجميع: انسدّ اللعب
      return passes >= s.rules.players ? finishHand(next, 'blocked', null) : next;
    }
  }
}

function applyPlay(s: DominoState, seat: number, tile: Tile, side?: Side): DominoState {
  const held = s.hands[seat].find((t) => sameTile(t, tile));
  if (!held) fail('القطعة ليست معك');
  if (!playable(s, seat).some((t) => sameTile(t, tile))) fail('القطعة لا تصلح');
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((t) => !sameTile(t, tile)) : h));
  let line: PlacedTile[];
  let placed: PlacedTile;
  if (!s.line.length) {
    placed = { tile: held!, seat, outer: held!.b, side: 'first' };
    line = [placed];
  } else {
    const options = fits(s, held!);
    const e = ends(s)!;
    // الطرفان بنفس الرقم: لا فرق بينهما، فلا نسأل
    const where = side && options.includes(side) ? side
      : options.length === 1 || e.left === e.right ? options[options.length - 1]
        : fail('اختر الطرف');
    const match = where === 'left' ? e.left : e.right;
    const outer = (held!.a === match ? held!.b : held!.a) as Pip;
    placed = { tile: held!, seat, outer, side: where as Side };
    line = where === 'left' ? [placed, ...s.line] : [...s.line, placed];
  }
  const next: DominoState = { ...s, hands, line, passes: 0, turn: nextSeat(s.rules, seat), lastMove: { seat, kind: 'play', placed } };
  if (!hands[seat].length) return finishHand(next, 'domino', seat);
  // مع 4 لاعبين لا سحب: إن لم يستطع أحد اللعب بعد هذه القطعة فهو انسداد فوري
  if (s.rules.players === 4 && hands.every((h) => !h.some((t) => fits(next, t).length))) {
    return finishHand(next, 'blocked', null);
  }
  return next;
}

function finishHand(s: DominoState, kind: 'domino' | 'blocked', dominoSeat: number | null): DominoState {
  const r = s.rules;
  const remaining = s.hands.map((h) => h.reduce((sum, t) => sum + pips(t), 0));
  const sides = sidesCount(r);
  const sideTotals = Array(sides).fill(0);
  remaining.forEach((n, seat) => { sideTotals[sideOf(r, seat)] += n; });
  const points = Array(sides).fill(0);
  let winnerSeat: number | null = dominoSeat;
  if (kind === 'blocked') {
    // الأقل مجموعاً (فريقاً أو لاعباً) يفوز؛ التعادل بلا نقاط
    const min = Math.min(...sideTotals);
    const winners = sideTotals.map((n, i) => (n === min ? i : -1)).filter((i) => i >= 0);
    if (winners.length === 1) {
      const side = winners[0];
      // اللاعب الأقل في الفريق الفائز يبدأ الصكة التالية
      winnerSeat = remaining.map((n, seat) => ({ n, seat })).filter((x) => sideOf(r, x.seat) === side).sort((x, y) => x.n - y.n)[0].seat;
    } else {
      winnerSeat = null;
    }
  }
  if (winnerSeat !== null) {
    const side = sideOf(r, winnerSeat);
    points[side] = sideTotals.reduce((sum, n, i) => (i === side ? sum : sum + n), 0);
  }
  const scores = s.scores.map((n, i) => n + points[i]);
  const done = scores.some((n) => n >= r.target);
  return {
    ...s, scores,
    phase: done ? 'matchOver' : 'handOver',
    lastHand: { kind, winnerSeat, points, remaining },
    // لا فائز (تعادل الانسداد): يبدأ من بدأ الصكة نفسها
    nextStarter: winnerSeat ?? s.line[0]?.seat ?? 0,
  };
}

/** الفائز بالمباراة (جانب) أو null */
export function matchWinner(s: DominoState): number | null {
  if (s.phase !== 'matchOver') return null;
  const max = Math.max(...s.scores);
  return s.scores.indexOf(max);
}
