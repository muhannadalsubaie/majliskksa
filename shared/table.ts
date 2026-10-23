// منطق الطاولة (المقاعد، الأعضاء، الروبوتات، نصوص الإعلانات) — دوال نقية يستخدمها الخادم.
import { type Card, type Seat, type Team, MAX_PEOPLE_AT_TABLE, SUIT_NAMES, cardLabel, nextSeat, teamOf } from './baloot/cards';
import { botAction } from './baloot/bot';
import {
  type Action, type Bid, type GameState, type Rng, applyAction, availableBids, availableDouble, canDeclareBaloot,
  canDeclareProject, handOver, legalCardsFor, needsRedeal, newMatch, nextHand, redeal,
} from './baloot/game';
import { PROJECT_NAMES } from './baloot/projects';
import { BOT_THINK_MS } from './economy';

export interface Member { uid: string; username: string; isBot: boolean }

export interface TableData {
  id: string;
  ownerUid: string;
  isPrivate: boolean;
  createdAt: number;
  seats: (Member | null)[];
  spectators: Member[];
  /** من دفع رسوم الدخول (حتى لا يُخصم مرتين) */
  paid: string[];
  game: GameState | null;
  botCount: number;
}

export function newTable(id: string, owner: { uid: string; username: string }, isPrivate: boolean, now: number): TableData {
  return {
    id, ownerUid: owner.uid, isPrivate, createdAt: now,
    seats: [{ uid: owner.uid, username: owner.username, isBot: false }, null, null, null],
    spectators: [], paid: [owner.uid], game: null, botCount: 0,
  };
}

export const seatOf = (t: TableData, uid: string): Seat | null => {
  const i = t.seats.findIndex((m) => m?.uid === uid && !m.isBot);
  return i < 0 ? null : (i as Seat);
};

export const isMember = (t: TableData, uid: string) => seatOf(t, uid) !== null || t.spectators.some((m) => m.uid === uid);
export const peopleCount = (t: TableData) => t.seats.filter((m) => m && !m.isBot).length + t.spectators.length;
export const isFull = (t: TableData) => t.seats.every(Boolean);

export class TableError extends Error {}

/** ينضم مستخدم: مقعد فارغ إن وُجد وإلا مشاهد. يرجع هل يجب خصم رسوم الدخول. */
export function join(t: TableData, user: { uid: string; username: string }): { table: TableData; charge: boolean } {
  if (isMember(t, user.uid)) return { table: t, charge: false };
  if (peopleCount(t) >= MAX_PEOPLE_AT_TABLE) throw new TableError('table-full');
  const charge = !t.paid.includes(user.uid);
  const paid = charge ? [...t.paid, user.uid] : t.paid;
  const free = t.game ? -1 : t.seats.findIndex((m) => m === null);
  const member: Member = { uid: user.uid, username: user.username, isBot: false };
  if (free >= 0) {
    const seats = [...t.seats];
    seats[free] = member;
    return { table: { ...t, seats, paid }, charge };
  }
  return { table: { ...t, spectators: [...t.spectators, member], paid }, charge };
}

/** يغادر مستخدم. أثناء اللعب يحل مكانه روبوت. يرجع هل حلّ روبوت مكانه. */
export function leave(t: TableData, uid: string): { table: TableData; botReplaced: boolean } {
  const seat = seatOf(t, uid);
  if (seat === null) return { table: { ...t, spectators: t.spectators.filter((m) => m.uid !== uid) }, botReplaced: false };
  const seats = [...t.seats];
  if (t.game && t.game.phase !== 'matchOver') {
    const n = t.botCount + 1;
    seats[seat] = { uid: `bot-${n}`, username: `روبوت ${n.toLocaleString('ar-SA')}`, isBot: true };
    return { table: { ...t, seats, botCount: n }, botReplaced: true };
  }
  seats[seat] = null;
  return { table: { ...t, seats }, botReplaced: false };
}

export function addBot(t: TableData, seat: Seat): TableData {
  if (t.game) throw new TableError('game-started');
  if (t.seats[seat]) throw new TableError('seat-taken');
  const n = t.botCount + 1;
  const seats = [...t.seats];
  seats[seat] = { uid: `bot-${n}`, username: `روبوت ${n.toLocaleString('ar-SA')}`, isBot: true };
  return { ...t, seats, botCount: n };
}

export function removeBot(t: TableData, seat: Seat): TableData {
  if (t.game) throw new TableError('game-started');
  if (!t.seats[seat]?.isBot) throw new TableError('not-a-bot');
  const seats = [...t.seats];
  seats[seat] = null;
  return { ...t, seats };
}

export function start(t: TableData, rng: Rng): TableData {
  if (!isFull(t)) throw new TableError('not-full');
  if (t.game && t.game.phase !== 'matchOver') throw new TableError('game-started');
  return { ...t, game: newMatch(rng, 0) };
}

// ───── أسماء ونصوص الإعلانات ─────

const nameOf = (t: TableData, seat: Seat) => t.seats[seat]?.username ?? `المقعد ${seat + 1}`;
export const teamName = (t: TableData, team: Team) => `فريق ${nameOf(t, team as Seat)} و${nameOf(t, (team + 2) as Seat)}`;

function bidText(b: Bid): string {
  switch (b.type) {
    case 'pass': return 'بس';
    case 'sun': return 'صن';
    case 'ashkal': return 'أشكل';
    case 'hokm': return `حكم ${SUIT_NAMES[b.suit]}`;
  }
}

export function contractText(g: GameState): string {
  const c = g.contract;
  if (!c) return '';
  return c.mode === 'sun' ? 'صن' : `حكم ${SUIT_NAMES[c.trump!]}`;
}

/** يطبق حركة ويرجع نصوص الإعلانات المناسبة لكل اللاعبين. */
export function applyWithEvents(t: TableData, action: Action, rng: Rng): { table: TableData; events: string[] } {
  const before = t.game!;
  const after = applyAction(before, action);
  const events: string[] = [];
  const who = 'seat' in action ? nameOf(t, action.seat) : '';

  switch (action.type) {
    case 'bid':
      events.push(`${who}: ${bidText(action.bid)}`);
      if (!before.contract && after.contract) {
        events.push(`المشتري ${nameOf(t, after.contract.buyer)}، ${contractText(after)}`);
      }
      if (needsRedeal(after)) events.push('الكل مرّ مرتين — صنكة، إعادة توزيع');
      break;
    case 'double': {
      const d = after.doubling;
      const label = d.gahwa ? 'قهوة' : ({ 2: 'دبل', 3: 'ثري', 4: 'فور' } as const)[d.level as 2 | 3 | 4];
      const lock = after.contract!.mode === 'hokm' && !d.gahwa ? (d.locked ? ' مقفل' : ' مفتوح') : '';
      events.push(`${who}: ${label}${lock}`);
      break;
    }
    case 'doublePass':
      if (after.phase === 'playing') events.push('بدأ اللعب');
      break;
    case 'declareProject': {
      const mine = after.declared.find((d) => d.seat === action.seat)!;
      events.push(`${who}: مشروع ${mine.projects.map((p) => PROJECT_NAMES[p.kind]).join(' و')}`);
      break;
    }
    case 'declareBaloot':
      events.push(`${who}: بلوت`);
      break;
    case 'play':
      events.push(`${who}: ${cardLabel(action.card)}`);
      if (after.lastTrick && after.trickNo !== before.trickNo) {
        events.push(`الأكلة لـ${nameOf(t, after.lastTrick.winner)}`);
        if (before.trickNo === 0 && after.projects?.winningTeam != null) {
          events.push(`تُحتسب مشاريع ${teamName(t, after.projects.winningTeam)}`);
        }
      }
      if (after.lastHand && !before.lastHand) {
        const r = after.lastHand;
        if (r.kaboot !== null) events.push(`كبوت لـ${teamName(t, r.kaboot)}`);
        else if (r.buyerFailed) events.push('خسر المشتري');
        events.push(`نتيجة الصكة: ${teamName(t, 0)} ${r.points[0]}، ${teamName(t, 1)} ${r.points[1]}`);
        events.push(`المجموع: ${after.scores[0]} مقابل ${after.scores[1]}`);
        if (after.outcome.status === 'won') events.push(`انتهت المباراة — فاز ${teamName(t, after.outcome.winner)}`);
        if (after.outcome.status === 'tiebreak') events.push('تعادل — جولة فاصلة');
      }
      break;
  }
  void rng;
  return { table: { ...t, game: after }, events };
}

// ───── الخطوة التلقائية التالية (روبوت أو توزيع) ─────

export type AutoStep =
  | { kind: 'bot'; seat: Seat; action: Action; delayMs: number }
  | { kind: 'redeal'; delayMs: number }
  | { kind: 'nextHand'; delayMs: number };

/** ما الذي يجب أن يحدث تلقائياً بعد الآن؟ (null = ننتظر لاعباً بشرياً) */
export function nextAutoStep(t: TableData, rng: Rng): AutoStep | null {
  const g = t.game;
  if (!g || g.phase === 'matchOver') return null;
  if (needsRedeal(g)) return { kind: 'redeal', delayMs: 2500 };
  if (handOver(g)) return { kind: 'nextHand', delayMs: 5000 };
  const think = () => BOT_THINK_MS.min + Math.floor(rng() * (BOT_THINK_MS.max - BOT_THINK_MS.min));
  // نعطي الأولوية لمن عليه الدور، ثم إعلان البلوت لأي روبوت
  const order: Seat[] = [];
  if (g.phase === 'doubling') {
    for (const s of [0, 1, 2, 3] as Seat[]) if (teamOf(s) === g.doubling.awaitingTeam) order.push(s);
  } else {
    order.push(g.turn, nextSeat(g.turn), nextSeat(g.turn, 2), nextSeat(g.turn, 3));
  }
  for (const seat of order) {
    if (!t.seats[seat]?.isBot) continue;
    const action = botAction(g, seat);
    if (action) return { kind: 'bot', seat, action, delayMs: think() };
  }
  return null;
}

export function runAutoStep(t: TableData, step: AutoStep, rng: Rng): { table: TableData; events: string[] } {
  if (step.kind === 'redeal') {
    return { table: { ...t, game: redeal(t.game!, rng) }, events: ['توزيع جديد'] };
  }
  if (step.kind === 'nextHand') {
    return { table: { ...t, game: nextHand(t.game!, rng) }, events: ['صكة جديدة'] };
  }
  return applyWithEvents(t, step.action, rng);
}

// ───── ما يراه كل شخص (بدون كشف أوراق الآخرين) ─────

export interface GameView {
  phase: GameState['phase'];
  dealer: Seat;
  scores: [number, number];
  turn: Seat;
  qaba: Card | null;
  bidRound: 1 | 2;
  hokmBid: GameState['hokmBid'];
  contract: GameState['contract'];
  doubling: GameState['doubling'];
  trick: GameState['trick'];
  lastTrick: GameState['lastTrick'];
  trickNo: number;
  tricksWon: [number, number];
  lastHand: GameState['lastHand'];
  outcome: GameState['outcome'];
  handCounts: number[];
  myHand: Card[];
  balootSeat: Seat | null;
  projects: GameState['projects'];
  declared: { seat: Seat; kinds: string[] }[];
  actions: {
    bids: Bid[];
    double: ReturnType<typeof availableDouble>;
    canPassDouble: boolean;
    legal: Card[];
    canProject: boolean;
    canBaloot: boolean;
  };
}

export interface TableView {
  id: string;
  ownerUid: string;
  isPrivate: boolean;
  mySeat: Seat | null;
  seats: ({ username: string; isBot: boolean } | null)[];
  spectators: string[];
  game: GameView | null;
}

export function viewFor(t: TableData, uid: string): TableView {
  const mySeat = seatOf(t, uid);
  const g = t.game;
  let game: GameView | null = null;
  if (g) {
    const playing = mySeat !== null;
    game = {
      phase: g.phase, dealer: g.dealer, scores: g.scores, turn: g.turn, qaba: g.qaba, bidRound: g.bidRound,
      hokmBid: g.hokmBid, contract: g.contract, doubling: g.doubling, trick: g.trick, lastTrick: g.lastTrick,
      trickNo: g.trickNo, tricksWon: g.tricksWon, lastHand: g.lastHand, outcome: g.outcome,
      handCounts: g.hands.map((h) => h.length),
      myHand: playing ? g.hands[mySeat] : [],
      balootSeat: g.balootSeat,
      projects: g.trickNo > 0 ? g.projects : null,
      // المشاريع تُكشف بعد الأكلة الأولى فقط
      declared: g.trickNo > 0 ? g.declared.map((d) => ({ seat: d.seat, kinds: d.projects.map((p) => PROJECT_NAMES[p.kind]) })) : [],
      actions: {
        bids: playing ? availableBids(g, mySeat) : [],
        double: playing ? availableDouble(g, mySeat) : null,
        canPassDouble: playing && g.phase === 'doubling' && g.doubling.awaitingTeam === teamOf(mySeat) && !g.doubling.passed.includes(mySeat),
        legal: playing ? legalCardsFor(g, mySeat) : [],
        canProject: playing && canDeclareProject(g, mySeat),
        canBaloot: playing && canDeclareBaloot(g, mySeat),
      },
    };
  }
  return {
    id: t.id, ownerUid: t.ownerUid, isPrivate: t.isPrivate, mySeat,
    seats: t.seats.map((m) => (m ? { username: m.username, isBot: m.isBot } : null)),
    spectators: t.spectators.map((m) => m.username),
    game,
  };
}
