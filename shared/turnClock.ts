// مؤقت الدور: المالك يختار وقت لكل دور (١٠ إلى ٦٠ ثانية، أو بدون) لما يبدأ المباراة.
// لو خلص الوقت واللاعب ما لعب، الروبوت يلعب عنه أفضل حركة. يشمل كل الألعاب.
import type { TableData } from './table';
import type { Seat } from './baloot/cards';
import { type Action, type GameState, handOver, isDoublingTurn, isLockChoiceTurn, needsRedeal } from './baloot/game';
import { botAction } from './baloot/bot';
import type { DominoAction } from './domino/engine';
import { dominoBotAction } from './domino/bot';
import type { JackarooAction } from './jackaroo/engine';
import { jackarooBotAction } from './jackaroo/bot';
import { type LudoAction, moveOptions } from './ludo/engine';
import { ludoBotAction } from './ludo/bot';

/** الخيارات المسموحة (ثواني)؛ ٠ = بدون وقت */
export const TURN_LIMITS = [0, 10, 20, 30, 40, 50, 60] as const;
export const validTurnLimit = (n: unknown): number | null =>
  typeof n === 'number' && (TURN_LIMITS as readonly number[]).includes(n) ? n : null;

export interface TurnClock {
  /** بصمة الدور: لو تغيّرت (لعب أحد، أو تغيّر القرار) يبدأ وقت جديد */
  key: string;
  seat: number;
  deadline: number;
}

/** المقعد يلعبه الروبوت أصلاً (روبوت، أو لاعب منقطع في الألعاب الثانية) */
const auto = (t: TableData, seat: number, awayToo: boolean) => {
  const m = t.seats[seat];
  return !m || m.isBot || (awayToo && t.away?.[m.uid] !== undefined);
};

/** البلوت: مين عليه القرار الحين (لاعب حقيقي بس) */
function balootTurn(t: TableData, g: GameState): { seat: number; key: string } | null {
  if (g.phase === 'matchOver' || needsRedeal(g) || handOver(g) || t.sawa) return null;
  let seat: Seat | null = null;
  if (g.phase === 'doubling') {
    if (g.doubling.lockPending !== null && g.doubling.lockPending !== undefined) seat = g.doubling.lockPending;
    else for (const s of [0, 1, 2, 3] as Seat[]) if ((isDoublingTurn(g, s) || isLockChoiceTurn(g, s)) && !auto(t, s, false)) { seat = s; break; }
  } else seat = g.turn;
  if (seat === null || auto(t, seat, false)) return null;
  const d = g.doubling;
  const key = ['b', g.dealer, g.scores.join(','), g.phase, g.bidRound, g.bidsInRound, g.turn, g.trickNo, g.trick.length,
    g.hands[seat].length, d.level, d.gahwa, d.passed.join(','), d.lockPending ?? '', g.secondHokm?.remaining ?? '', g.waraqAsk?.join(',') ?? '', seat].join('|');
  return { seat, key };
}

/** مين عليه الدور الحين وبصمة دوره (null = ما فيه لاعب حقيقي ينتظره أحد) */
export function humanTurn(t: TableData): { seat: number; key: string } | null {
  if (t.game) return balootTurn(t, t.game);
  if (t.domino) {
    const d = t.domino;
    if ((d.phase !== 'playing' && d.phase !== 'chooseStarter') || auto(t, d.turn, true)) return null;
    return { seat: d.turn, key: ['d', d.handNo, d.phase, d.turn, d.line.length, d.hands.map((h) => h.length).join(','), d.boneyard.length].join('|') };
  }
  if (t.jackaroo) {
    const j = t.jackaroo;
    if (j.phase !== 'playing' || auto(t, j.turn, true)) return null;
    return { seat: j.turn, key: ['j', j.dealNo, j.turn, j.hands.map((h) => h.length).join(','), JSON.stringify(j.marbles)].join('|') };
  }
  if (t.ludo) {
    const l = t.ludo;
    if (l.phase === 'over' || auto(t, l.turn, true)) return null;
    // حركة وحدة بس: تتحرك تلقائياً على طول، ما تحتاج وقت
    if (l.phase === 'move' && moveOptions(l, l.turn).length === 1) return null;
    return { seat: l.turn, key: ['l', l.turn, l.phase, (l.pool ?? []).join(','), l.dice ?? '', JSON.stringify(l.tokens)].join('|') };
  }
  return null;
}

/**
 * بعد كل تغيير في الطاولة: يبدأ وقت جديد لو تغيّر الدور، ويبقى نفسه لو ما تغيّر.
 * الوقت يبدأ بعد ما تخلص مهلة العرض (توزيع، كشف مشروع، مشي الحجر)
 */
export function refreshClock(t: TableData, now = Date.now()): TableData {
  const limit = t.turnLimit ?? 0;
  const turn = limit > 0 ? humanTurn(t) : null;
  if (!turn) {
    if (!t.clock) return t;
    const { clock: _c, ...rest } = t;
    void _c;
    return rest as TableData;
  }
  if (t.clock?.key === turn.key) return t;
  const start = Math.max(now, t.hold?.until ?? 0);
  return { ...t, clock: { key: turn.key, seat: turn.seat, deadline: start + limit * 1000 } };
}

/** خلص الوقت: الحركة اللي يلعبها الروبوت عن اللاعب (null = الوقت ما خلص، أو ما فيه حركة) */
export function timeoutAction(t: TableData, now = Date.now()):
  | { game: 'baloot'; action: Action }
  | { game: 'other'; action: DominoAction | JackarooAction | LudoAction }
  | null {
  const c = t.clock;
  if (!c || now < c.deadline - 50) return null;
  const turn = humanTurn(t);
  if (!turn || turn.key !== c.key) return null;
  // (إعلان المشاريع يدوي: اللي خلص وقته ما ينعلن مشروعه عنه — تنلعب ورقته بس)
  if (t.game) { const a = botAction({ ...t.game, manualProjects: false }, turn.seat as Seat); return a ? { game: 'baloot', action: a } : null; }
  if (t.domino) { const a = dominoBotAction(t.domino, turn.seat); return a ? { game: 'other', action: a } : null; }
  if (t.jackaroo) { const a = jackarooBotAction(t.jackaroo, turn.seat); return a ? { game: 'other', action: a } : null; }
  if (t.ludo) { const a = ludoBotAction(t.ludo, turn.seat); return a ? { game: 'other', action: a } : null; }
  return null;
}

/** للعرض: مين عليه الوقت وكم باقي له (التطبيق يعد تنازلياً من لحظة وصول الحالة) */
export function clockView(t: TableData, now = Date.now()): { limit: number; seat: number | null; remainingMs: number | null } {
  const limit = t.turnLimit ?? 0;
  if (!limit || !t.clock) return { limit, seat: null, remainingMs: null };
  return { limit, seat: t.clock.seat, remainingMs: Math.max(0, t.clock.deadline - now) };
}
