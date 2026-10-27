// الدومينو والجاكارو على طاولات مجلسك: بدء المباراة، تطبيق الحركات وإعلاناتها، دور الروبوت،
// وما يراه كل لاعب (بلا كشف قطع/أوراق غيره). البلوت له منطقه في table.ts.
import type { TableData } from './table';
import { BOT_THINK_MS } from './economy';
import {
  type DominoAction, type DominoState, type Side, type Tile, applyDomino, newMatch as newDomino, nextHand as nextDominoHand,
} from './domino/engine';
import { dominoBotAction } from './domino/bot';
import { handAnnouncement as dominoHandText, moveAnnouncement as dominoMoveText } from './domino/labels';
import {
  type Card, type JackarooAction, type JackarooState, type MoveSpec, COMPLEX_RULES, DEFAULT_RULES as JACKAROO_CLASSIC,
  applyJackaroo, newGame as newJackaroo, teamOf,
} from './jackaroo/engine';
import { jackarooBotAction } from './jackaroo/bot';
import { moveAnnouncement as jackarooMoveText } from './jackaroo/labels';

export type GameKind = 'baloot' | 'domino' | 'jackaroo';
export type GameVariant = 'classic' | 'complex';
export const GAME_NAMES: Record<GameKind, string> = { baloot: 'بلوت', domino: 'دومينو', jackaroo: 'جاكارو' };

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
  return false;
}

export function startOther(t: TableData, rng: Rng): { table: TableData; events: string[] } {
  if (kindOf(t) === 'domino') {
    const domino = newDomino(rng, { ...TABLE_DOMINO_RULES });
    return {
      table: { ...t, domino, jackaroo: null, game: null },
      events: ['بدأت مباراة الدومينو، الهدف 100 نقطة', `يبدأ ${names(t)[domino.turn]} بدوس الستة`],
    };
  }
  const jackaroo = newJackaroo(rng, t.variant === 'complex' ? COMPLEX_RULES : JACKAROO_CLASSIC);
  return {
    table: { ...t, jackaroo, domino: null, game: null },
    events: [`بدأت الجاكارو${t.variant === 'complex' ? ' كمبلكس' : ''}. وُزّعت ${jackaroo.hands[0].length} أوراق، يبدأ ${names(t)[jackaroo.turn]}`],
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

export function applyOther(t: TableData, action: DominoAction | JackarooAction, rng: Rng): { table: TableData; events: string[] } {
  if (t.domino) {
    const after = applyDomino(t.domino, action as DominoAction);
    const events = [dominoMoveText(after, names(t))];
    if (after.phase !== 'playing') events.push(...dominoHandText(after, names(t)).filter((e) => !e.startsWith('انتهت المباراة')));
    if (after.phase === 'matchOver') {
      const best = after.scores.indexOf(Math.max(...after.scores));
      events.push(`انتهت المباراة — فاز ${teamName(t, best)}`);
    }
    return { table: { ...t, domino: after }, events };
  }
  const before = t.jackaroo!;
  const after = applyJackaroo(before, action as JackarooAction, rng);
  // الإعلان للجميع بالأسماء (بلا "أنت")، ونهاية اللعبة باسم الفريق الفائز
  const events = jackarooMoveText(after, names(t), -1).filter((e) => !e.startsWith('فاز'));
  if (after.phase === 'over' && after.winnerTeam !== null) events.push(`انتهت اللعبة — فاز ${teamName(t, after.winnerTeam)}`);
  if (after.dealNo !== before.dealNo && after.phase === 'playing') events.push(`توزيع جديد: ${after.hands[0].length} أوراق، يبدأ ${names(t)[after.turn]}`);
  return { table: { ...t, jackaroo: after }, events };
}

/** هل يجب أن يحدث شيء تلقائياً (روبوت، أو صكة دومينو جديدة)؟ ومتى؟ */
export function otherAutoDelay(t: TableData, rng: Rng): number | null {
  const think = () => BOT_THINK_MS.min + Math.floor(rng() * (BOT_THINK_MS.max - BOT_THINK_MS.min));
  if (t.domino) {
    if (t.domino.phase === 'handOver') return 5000;
    if (t.domino.phase === 'playing' && t.seats[t.domino.turn]?.isBot) return think();
  }
  if (t.jackaroo?.phase === 'playing' && t.seats[t.jackaroo.turn]?.isBot) return think();
  return null;
}

export function runOtherAuto(t: TableData, rng: Rng): { table: TableData; events: string[] } {
  if (t.domino?.phase === 'handOver') {
    const domino = nextDominoHand(t.domino, rng);
    return { table: { ...t, domino }, events: [`صكة جديدة، يبدأ ${names(t)[domino.turn]}`] };
  }
  if (t.domino) {
    const a = dominoBotAction(t.domino, t.domino.turn);
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
    hands: s.hands.map((h, i) => (i === mySeat || s.phase !== 'playing' ? h : h.map(() => HIDDEN_TILE))),
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
  return 'waiting';
}

export { teamOf as jackarooTeamOf };
