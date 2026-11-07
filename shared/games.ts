// الدومينو والجاكارو على طاولات مجلسك: بدء المباراة، تطبيق الحركات وإعلاناتها، دور الروبوت،
// وما يراه كل لاعب (بلا كشف قطع/أوراق غيره). البلوت له منطقه في table.ts.
import type { TableData } from './table';
import { human } from './botPace';
import {
  type DominoAction, type DominoState, type Side, type Tile, applyDomino, newMatch as newDomino, nextHand as nextDominoHand, playable as dominoPlayable,
} from './domino/engine';
import { dominoBotAction } from './domino/bot';
import { handAnnouncement as dominoHandText, moveAnnouncement as dominoMoveText } from './domino/labels';
import {
  type Card, type JackarooAction, type JackarooState, type MoveSpec, COMPLEX_RULES, DEFAULT_RULES as JACKAROO_CLASSIC,
  applyJackaroo, legalMoves as jackarooLegal, newGame as newJackaroo, teamOf,
} from './jackaroo/engine';
import { jackarooBotAction } from './jackaroo/bot';
import { moveAnnouncement as jackarooMoveText } from './jackaroo/labels';
import { type LudoAction, type LudoState, DEFAULT_RULES as LUDO_SOLO, TEAM_RULES as LUDO_TEAMS, applyLudo, moveOptions, poolOf, newGame as newLudo } from './ludo/engine';
import { ludoBotAction } from './ludo/bot';
import { COLOR_NAMES, moveAnnouncement as ludoMoveText, rollName } from './ludo/labels';

export type GameKind = 'baloot' | 'domino' | 'jackaroo' | 'ludo';
/** classic: الافتراضي (والفردي في لودو)، complex: جاكارو كمبلكس، teams: لودو فرق */
/** نسخ الألعاب: الجاكارو كمبلكس، اللودو فرق، الدومينو هدف 150 أو 200 (العادي 100) */
export type GameVariant = 'classic' | 'complex' | 'teams' | 't150' | 't200';
export const GAME_NAMES: Record<GameKind, string> = { baloot: 'بلوت', domino: 'دومينو', jackaroo: 'جاكارو', ludo: 'لودو' };
/** اسم اللعبة مع نسختها: "جاكارو كمبلكس"، "لودو فرق" */
export const gameTitle = (kind: GameKind, variant?: GameVariant, target?: number) =>
  GAME_NAMES[kind] + (kind === 'jackaroo' && variant === 'complex' ? ' كمبلكس' : kind === 'ludo' && variant === 'teams' ? ' فرق'
    : kind === 'domino' ? ` ${target ?? dominoTarget(variant)}` : '');
/** هدف مباراة الدومينو: 100 أو 150 أو 200 */
export const dominoTarget = (variant?: GameVariant) => (variant === 't150' ? 150 : variant === 't200' ? 200 : 100);
/** النسخ الصالحة لكل لعبة (الأولى هي الافتراضية) */
export const VARIANTS: Record<GameKind, GameVariant[]> = { baloot: ['classic'], domino: ['classic', 't150', 't200'], jackaroo: ['classic', 'complex'], ludo: ['classic', 'teams'] };

/** الدومينو على الطاولة: 4 لاعبين شراكة حتى 100 */
export const TABLE_DOMINO_RULES = { players: 4, target: 100 } as const;

type Rng = () => number;
const names = (t: TableData) => t.seats.map((m, i) => m?.username ?? `المقعد ${i + 1}`);
const teamName = (t: TableData, team: number) => `فريق ${names(t)[team]} و${names(t)[team + 2]}`;
export const kindOf = (t: TableData): GameKind => t.kind ?? 'baloot';

/** هل المباراة جارية (للدومينو والجاكارو) */
export function otherActive(t: TableData): boolean {
  if (t.domino) return t.domino.phase !== 'matchOver';
  if (t.jackaroo) return t.jackaroo.phase === 'playing';
  if (t.ludo) return t.ludo.phase !== 'over';
  return false;
}

export function startOther(t: TableData, rng: Rng): { table: TableData; events: string[] } {
  if (kindOf(t) === 'domino') {
    // لاعبين أو ثلاثة (كل واحد لنفسه) أو أربعة (فريقين)، والهدف 100 أو 150 أو 200
    const players = t.seats.filter(Boolean).length as 2 | 3 | 4;
    const domino = newDomino(rng, { players, target: t.dominoTarget ?? dominoTarget(t.variant), teams: t.dominoTeams !== false });
    const opening = domino.hands[domino.turn].filter((x) => x.a === x.b).sort((x, y) => y.a - x.a)[0];
    return {
      table: { ...t, domino, jackaroo: null, ludo: null, game: null, dominoLog: [{ hand: domino.handNo, lines: [] }] },
      events: [`بدأت مباراة الدومينو${players < 4 ? ` بين ${players} لاعبين، كل واحد لنفسه` : ''}، الهدف ${domino.rules.target} نقطة`, opening ? `يبدأ ${names(t)[domino.turn]} بـ ${opening.a} ${opening.a}` : `يبدأ ${names(t)[domino.turn]}، صاحب أعلى مجموع`],
    };
  }
  if (kindOf(t) === 'ludo') {
    const players = t.seats.filter(Boolean).length as 2 | 3 | 4;
    const ludo = newLudo(rng, t.variant === 'teams' ? LUDO_TEAMS : { ...LUDO_SOLO, players });
    return {
      table: { ...t, ludo, domino: null, jackaroo: null, game: null, ludoLog: [] },
      events: [
        `بدأت لودو${t.variant === 'teams' ? ' فرق' : ''}. ${ludo.seats.map((i) => `${names(t)[i]} ${COLOR_NAMES[i]}`).join('، ')}`,
        `يبدأ ${names(t)[ludo.turn]}`,
      ],
    };
  }
  // لاعبين أو ثلاثة: كل واحد لنفسه؛ أربعة: فريقين
  const seats = t.seats.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  const jackaroo = newJackaroo(rng, t.variant === 'complex' ? COMPLEX_RULES : JACKAROO_CLASSIC, seats);
  return {
    table: { ...t, jackaroo, domino: null, ludo: null, game: null },
    events: [`بدأت الجاكارو${t.variant === 'complex' ? ' كمبلكس' : ''}${seats.length < 4 ? ` بين ${seats.length} لاعبين، كل واحد لنفسه` : ''}. وُزّعت ${jackaroo.hands[jackaroo.turn].length} أوراق، يبدأ ${names(t)[jackaroo.turn]}`],
  };
}

// ───── الحركات (من اللاعب أو الروبوت) ─────

const isTile = (x: unknown): x is Tile => {
  const t = x as Tile;
  return !!t && Number.isInteger(t.a) && Number.isInteger(t.b) && t.a >= 0 && t.a <= 6 && t.b >= 0 && t.b <= 6;
};

/** يبني حركة الدومينو من رسالة العميل (المقعد من هوية المتصل) */
export function parseDomino(raw: unknown, seat: number): DominoAction | null {
  const a = raw as Record<string, unknown> | null;
  if (!a) return null;
  if (a.type === 'draw') return { type: 'draw', seat };
  if (a.type === 'pass') return { type: 'pass', seat };
  if (a.type === 'starter' && typeof a.starter === 'number') return { type: 'starter', seat, starter: a.starter };
  if (a.type === 'play' && isTile(a.tile)) {
    const side = a.side === 'left' || a.side === 'right' ? (a.side as Side) : undefined;
    return { type: 'play', seat, tile: { a: a.tile.a, b: a.tile.b }, side };
  }
  return null;
}

/** حركة الجاكارو: المحرك نفسه يتحقق أن الورقة معه وأن الحركة من حركاتها المسموحة */
export function parseJackaroo(raw: unknown, seat: number): JackarooAction | null {
  const a = raw as { type?: unknown; card?: Card; move?: MoveSpec } | null;
  if (!a || !a.card || typeof a.card.rank !== 'string' || typeof a.card.suit !== 'string') return null;
  const card = { rank: a.card.rank, suit: a.card.suit };
  if (a.type === 'burn') return { type: 'burn', seat, card };
  if (a.type === 'play' && a.move && typeof a.move === 'object' && typeof a.move.kind === 'string') {
    return { type: 'play', seat, card, move: JSON.parse(JSON.stringify(a.move)) as MoveSpec };
  }
  return null;
}

/** حركة لودو: رمي النرد، أو تحريك حجر برقمه */
export function parseLudo(raw: unknown, seat: number): LudoAction | null {
  const a = raw as { type?: unknown; token?: unknown; die?: unknown } | null;
  if (!a) return null;
  if (a.type === 'roll') return { type: 'roll', seat };
  if (a.type === 'move' && Number.isInteger(a.token)) {
    return { type: 'move', seat, token: a.token as number, ...(Number.isInteger(a.die) ? { die: a.die as number } : {}) };
  }
  return null;
}

function applyLudoEvents(t: TableData, action: LudoAction, rng: Rng): { table: TableData; events: string[] } {
  const after = applyLudo(t.ludo!, action, rng);
  // رمية تنتظر اختيار الحجر: نعلن الرمية وحدها (والحركة تُعلن بعدها بلا تكرار الرمية)
  // الأرقام المتجمعة (مثلاً ستة وثلاثة) بانتظار الاختيار
  const pool = poolOf(after).map(rollName).join(' و');
  const events = action.type === 'roll' && after.phase === 'move'
    ? [`⟦v|${action.seat}|رميت ${pool}|%n رمى ${pool}⟧`]
    : ludoMoveText(after, names(t), -1, action.type === 'roll');
  // سجل اللودو: كل رمية وحركة بالترتيب (آخر 150)
  const ludoLog = [...(t.ludoLog ?? []), ...events.filter(Boolean)].slice(-150);
  return { table: { ...t, ludo: after, ludoLog }, events };
}

/** وقت كل خطوة يمشيها الحجر في اللودو والجاكارو (نفس سرعة صوت الطقطقة في التطبيقات) */
export const STEP_MS = 220;

/** كم خطوة مشى الحجر في آخر حركة (لين يوصل): لودو أو جاكارو */
function movedSteps(before: TableData, after: TableData): { steps: number; captured: boolean } {
  if (after.ludo) {
    const m = after.ludo.lastMove;
    if (!m || m === before.ludo?.lastMove || !m.token || m.from === null || m.to === null) return { steps: 0, captured: false };
    return { steps: m.from === -1 ? 1 : m.to - m.from, captured: m.captured.length > 0 };
  }
  if (after.jackaroo) {
    const m = after.jackaroo.lastMove;
    if (!m || m === before.jackaroo?.lastMove || !m.move) return { steps: 0, captured: false };
    const mv = m.move as { kind: string; steps?: number; parts?: { steps: number }[] };
    const steps = mv.kind === 'split' ? (mv.parts ?? []).reduce((a, p) => a + p.steps, 0) : mv.kind === 'out' || mv.kind === 'swap' ? 1 : mv.steps ?? 0;
    return { steps, captured: m.captured.length > 0 };
  }
  return { steps: 0, captured: false };
}

/** يطبق حركة لعبة غير البلوت، ولو مشى حجر: ما يبدأ اللاعب اللي بعده لين يوصل الحجر لمكانه */
export function applyOther(t: TableData, action: DominoAction | JackarooAction | LudoAction, rng: Rng, now = Date.now()): { table: TableData; events: string[] } {
  const { hold: _old, ...base } = t;
  void _old;
  const r = applyOtherMove(base, action, rng);
  const { steps, captured } = movedSteps(t, r.table);
  if (steps <= 0) return r;
  // هامش للنرد قبل المشي (التطبيق يبدأ الطقطقة بعد صوت النرد) وصوت الأكل بعدها
  const ms = Math.min(Math.max(steps, 1), 13) * STEP_MS + (captured ? 1200 : 700);
  return { ...r, table: { ...r.table, hold: { until: now + ms, seat: 0 } } };
}

function applyOtherMove(t: TableData, action: DominoAction | JackarooAction | LudoAction, rng: Rng): { table: TableData; events: string[] } {
  if (t.ludo) return applyLudoEvents(t, action as LudoAction, rng);
  if (t.domino) {
    const after = applyDomino(t.domino, action as DominoAction);
    const da = action as DominoAction;
    const events = da.type === 'starter'
      ? [da.starter === da.seat ? `${names(t)[da.seat]} اختار يبدأ بنفسه` : `${names(t)[da.seat]} اختار شريكه ${names(t)[da.starter]} يبدأ`]
      : [dominoMoveText(after, names(t))];
    if (after.phase !== 'playing') events.push(...dominoHandText(after, names(t)).filter((e) => !e.startsWith('انتهت المباراة')));
    if (after.phase === 'matchOver') {
      const best = after.scores.indexOf(Math.max(...after.scores));
      events.push(`انتهت المباراة — فاز ${teamName(t, best)}`);
    }
    // سجل الجولة: كل حركة ونتيجة الصكة
    const log = [...(t.dominoLog ?? [{ hand: t.domino.handNo, lines: [] }])];
    const cur = log[log.length - 1];
    log[log.length - 1] = { ...cur, lines: [...cur.lines, ...events.filter(Boolean)] };
    return { table: { ...t, domino: after, dominoLog: log }, events };
  }
  const before = t.jackaroo!;
  const after = applyJackaroo(before, action as JackarooAction, rng);
  // الإعلان للجميع بالأسماء (بلا "أنت")، ونهاية اللعبة باسم الفريق الفائز
  const events = jackarooMoveText(after, names(t), -1).filter((e) => !e.startsWith('فاز'));
  if (after.phase === 'over' && after.winnerTeam !== null) events.push(`انتهت اللعبة — فاز ${teamName(t, after.winnerTeam)}`);
  if (after.phase === 'over' && after.winner != null) events.push(`انتهت اللعبة — فاز ${names(t)[after.winner]}`);
  if (after.dealNo !== before.dealNo && after.phase === 'playing') events.push(`توزيع جديد: ${after.hands[after.turn].length} أوراق، يبدأ ${names(t)[after.turn]}`);
  return { table: { ...t, jackaroo: after }, events };
}

/** مقعد يلعبه الذكاء الاصطناعي: روبوت، أو لاعب انقطع اتصاله (يلعب عنه مؤقتاً لين يرجع) */
const autoSeat = (t: TableData, seat: number) => {
  const m = t.seats[seat];
  return !!m && (m.isBot || t.away?.[m.uid] !== undefined);
};

/** هل يجب أن يحدث شيء تلقائياً (روبوت، أو صكة دومينو جديدة)؟ ومتى؟ */
export function otherAutoDelay(t: TableData, rng: Rng): number | null {
  // وقت تفكير مثل اللاعب الحقيقي، حسب القرار
  if (t.domino) {
    const d = t.domino;
    if (d.phase === 'handOver') return 5000;
    if (d.phase === 'chooseStarter' && autoSeat(t, d.turn)) return human(rng, 2200, 4000);
    if (d.phase === 'playing' && autoSeat(t, d.turn)) {
      const options = dominoPlayable(d, d.turn).length;
      if (!d.line.length) return human(rng, 2200, 4000); // أول قطعة
      if (options === 0) return human(rng, 1600, 2800); // جلا أو سحب
      if (options === 1) return human(rng, 1600, 2700);
      return human(rng, 2400, 4600);
    }
  }
  if (t.jackaroo?.phase === 'playing' && autoSeat(t, t.jackaroo.turn)) {
    const moves = jackarooLegal(t.jackaroo, t.jackaroo.turn).length;
    if (moves === 0) return human(rng, 2200, 3600); // حرق ورقة
    if (moves === 1) return human(rng, 1900, 3000);
    return human(rng, 2600, 4800);
  }
  if (t.ludo && t.ludo.phase !== 'over') {
    if (autoSeat(t, t.ludo.turn)) {
      if (t.ludo.phase === 'roll') return human(rng, 1300, 2500);
      return moveOptions(t.ludo, t.ludo.turn).length > 1 ? human(rng, 1500, 2900) : human(rng, 1000, 1700);
    }
    // حركة وحدة بس ممكنة (حجر واحد برقم واحد): يتحرك تلقائياً للاعب أيضاً
    if (moveOptions(t.ludo, t.ludo.turn).length === 1) return 900;
  }
  return null;
}

export function runOtherAuto(t: TableData, rng: Rng): { table: TableData; events: string[] } {
  if (t.domino?.phase === 'handOver') {
    const domino = nextDominoHand(t.domino, rng);
    const first = domino.phase === 'chooseStarter' ? `صكة جديدة، ${names(t)[domino.chooser!]} يختار من يبدأ: هو أو شريكه` : `صكة جديدة، يبدأ ${names(t)[domino.turn]}`;
    return { table: { ...t, domino, dominoLog: [...(t.dominoLog ?? []), { hand: domino.handNo, lines: [] }] }, events: [first] };
  }
  if (t.domino) {
    const a = dominoBotAction(t.domino, t.domino.turn);
    return a ? applyOther(t, a, rng) : { table: t, events: [] };
  }
  if (t.ludo) {
    const s = t.ludo;
    const only = moveOptions(s, s.turn);
    const a = autoSeat(t, s.turn) ? ludoBotAction(s, s.turn) : only.length === 1 ? { type: 'move' as const, seat: s.turn, token: only[0].token, die: only[0].die } : null;
    return a ? applyOther(t, a, rng) : { table: t, events: [] };
  }
  const a = t.jackaroo ? jackarooBotAction(t.jackaroo, t.jackaroo.turn) : null;
  return a ? applyOther(t, a, rng) : { table: t, events: [] };
}

// ───── ما يراه كل لاعب: قطع وأوراق غيره مخفية (نبقي العدد فقط) ─────

const HIDDEN_TILE: Tile = { a: 0, b: 0 };
const HIDDEN_CARD: Card = { rank: '2', suit: 'S' };

export function dominoViewFor(s: DominoState, mySeat: number | null): DominoState {
  return {
    ...s,
    hands: s.hands.map((h, i) => (i === mySeat || s.phase === 'handOver' || s.phase === 'matchOver' ? h : h.map(() => HIDDEN_TILE))),
    boneyard: s.boneyard.map(() => HIDDEN_TILE),
  };
}

export function jackarooViewFor(s: JackarooState, mySeat: number | null): JackarooState {
  return {
    ...s,
    hands: s.hands.map((h, i) => (i === mySeat ? h : h.map(() => HIDDEN_CARD))),
    deck: s.deck.map(() => HIDDEN_CARD),
  };
}

/** حالة الطاولة في قائمة الطاولات */
export function otherStatus(t: TableData): 'waiting' | 'playing' | 'finished' {
  if (t.domino) return t.domino.phase === 'matchOver' ? 'finished' : 'playing';
  if (t.jackaroo) return t.jackaroo.phase === 'over' ? 'finished' : 'playing';
  if (t.ludo) return t.ludo.phase === 'over' ? 'finished' : 'playing';
  return 'waiting';
}

export { teamOf as jackarooTeamOf };

/** نتيجة اللعب الجاري لقائمة الطاولات (ضغطة مطولة على الطاولة العامة)؛ فاضي إذا ما فيه لعب */
export function scoreSummary(t: TableData): string {
  const n = names(t);
  const team = (a: number, b: number) => `${n[a]} و${n[b]}`;
  if (t.game && t.game.phase !== 'matchOver') {
    const [a, b] = t.game.scores;
    return `النتيجة: ${team(0, 2)} ${a}، ${team(1, 3)} ${b}`;
  }
  if (t.domino && t.domino.phase !== 'matchOver') {
    const d = t.domino;
    const sides = d.scores.map((s, i) => (d.scores.length === 2 && d.rules.players === 4 ? `${team(i, i + 2)} ${s}` : `${n[i]} ${s}`));
    return `النتيجة: ${sides.join('، ')} — اللعب إلى ${d.rules.target}`;
  }
  if (t.ludo && t.ludo.phase !== 'over') {
    const l = t.ludo;
    const home = (o: number) => l.tokens[o].filter((p) => p === 56).length;
    return `النتيجة: ${l.seats.map((o) => `${n[o]} وصل ${home(o)} من 4`).join('، ')}`;
  }
  return '';
}
