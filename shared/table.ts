// منطق الطاولة (المقاعد، الأعضاء، الروبوتات، نصوص الإعلانات) — دوال نقية يستخدمها الخادم.
import { type Card, type Seat, type Team, MAX_PEOPLE_AT_TABLE, SUIT_NAMES, cardLabel, nextSeat, teamOf } from './baloot/cards';
import { botAction } from './baloot/bot';
import {
  type Action, type Bid, type GameState, type Rng, applyAction, availableBids, availableDouble, canDeclareBaloot,
  canDeclareProject, handOver, legalCardsFor, needsRedeal, newMatch, nextHand, redeal,
} from './baloot/game';
import { PROJECT_NAMES } from './baloot/projects';
import { BOT_REPLACE_AFTER_MS, BOT_THINK_MS } from './economy';

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
  /** دعوات صالحة (لمرة واحدة) — مدفوعة مسبقاً من المالك، وقد تحجز مقعداً محدداً */
  invites?: (string | { code: string; seat?: Seat })[];
  /** المحادثة الصوتية: من انضم (جلسة Cloudflare Realtime الخاصة به) وهل ميكروفونه مكتوم */
  voice?: Record<string, VoiceMember>;
  /** آخر لحظة حُسب فيها استهلاك الصوت (للسقف الشهري) */
  voiceSince?: number;
  /** لاعبون انقطع اتصالهم أثناء المباراة: uid → وقت الانقطاع (مقعدهم محجوز 3 دقائق) */
  away?: Record<string, number>;
}

const gameActive = (t: TableData) => Boolean(t.game && t.game.phase !== 'matchOver');

/** انقطع اتصال لاعب جالس أثناء المباراة: نحجز مقعده */
export function markAway(t: TableData, uid: string, now: number): TableData {
  if (!gameActive(t) || seatOf(t, uid) === null || t.away?.[uid] !== undefined) return t;
  return { ...t, away: { ...(t.away ?? {}), [uid]: now } };
}

/** عاد اللاعب قبل انتهاء المهلة */
export function markBack(t: TableData, uid: string): TableData {
  if (t.away?.[uid] === undefined) return t;
  const away = { ...t.away };
  delete away[uid];
  return { ...t, away };
}

/** من انتهت مهلته (يُستبدل بروبوت) */
export function awayExpired(t: TableData, now: number): string[] {
  return Object.entries(t.away ?? {}).filter(([, at]) => now - at >= BOT_REPLACE_AFTER_MS).map(([uid]) => uid);
}

/** أقرب موعد لانتهاء مهلة لاعب منقطع (null إن لم يوجد) */
export function nextAwayDeadline(t: TableData): number | null {
  const times = Object.values(t.away ?? {});
  return times.length ? Math.min(...times) + BOT_REPLACE_AFTER_MS : null;
}

/** يحل روبوت مكان لاعب منقطع، ويصبح اللاعب مشاهداً (يستطيع المالك إعادته لاحقاً) */
export function replaceWithBot(t: TableData, uid: string, rng: () => number = Math.random): TableData {
  const seat = seatOf(t, uid);
  const base = withoutVoice(markBack(t, uid), uid);
  if (seat === null) return base;
  const human = base.seats[seat]!;
  const n = base.botCount + 1;
  const seats = [...base.seats];
  seats[seat] = { uid: `bot-${n}`, username: botName(base, rng), isBot: true };
  const spectators = base.spectators.some((m) => m.uid === uid) ? base.spectators : [...base.spectators, human];
  return { ...base, seats, spectators, botCount: n };
}

export interface VoiceMember { sessionId: string; muted: boolean }

/** اسم أي حاضر بالطاولة (لاعب أو مشاهد) */
export function memberName(t: TableData, uid: string): string | null {
  return t.seats.find((m) => m?.uid === uid && !m.isBot)?.username ?? t.spectators.find((m) => m.uid === uid)?.username ?? null;
}

/** يزيل الشخص من المحادثة الصوتية */
export function withoutVoice(t: TableData, uid: string): TableData {
  if (!t.voice?.[uid]) return t;
  const voice = { ...t.voice };
  delete voice[uid];
  return { ...t, voice };
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
/** هل بقي على الطاولة أي إنسان (لاعب أو مشاهد)؟ */
export const hasHumans = (t: TableData) => peopleCount(t) > 0;

export class TableError extends Error {}

/** أسماء عربية للروبوتات (رجال) */
export const BOT_NAMES = [
  'فهد', 'سلطان', 'عبدالله', 'خالد', 'ناصر', 'تركي', 'فيصل', 'سعود', 'ماجد', 'بندر',
  'راشد', 'منصور', 'يوسف', 'عبدالرحمن', 'محمد', 'سلمان', 'نايف', 'عمر', 'حمد', 'بدر',
  'مشعل', 'عبدالعزيز', 'طلال', 'زياد', 'نواف', 'ثامر', 'سامي', 'وليد', 'هشام', 'إبراهيم',
  'صالح', 'علي', 'أحمد', 'مساعد', 'عادل', 'سعد', 'حسن', 'ياسر', 'عبدالمجيد', 'متعب',
];

/** اسم عشوائي غير مستخدم على هذه الطاولة */
function botName(t: TableData, rng: () => number): string {
  const taken = new Set(t.seats.filter(Boolean).map((m) => m!.username));
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  return free[Math.floor(rng() * free.length)] ?? `روبوت ${t.botCount + 1}`;
}

/**
 * ينضم مستخدم: مقعد فارغ إن وُجد وإلا مشاهد. يرجع هل يجب خصم رسوم الدخول.
 * بدعوة صالحة: لا رسوم (دفعها المالك)، ويمكن دخول الطاولة الخاصة. الدعوة تُستهلك.
 */
export function join(t: TableData, user: { uid: string; username: string }, invite?: string): { table: TableData; charge: boolean } {
  if (isMember(t, user.uid)) return { table: t, charge: false };
  if (peopleCount(t) >= MAX_PEOPLE_AT_TABLE) throw new TableError('table-full');
  const invites = (t.invites ?? []).map((i) => (typeof i === 'string' ? { code: i } : i));
  const inv = invite ? invites.find((i) => i.code === invite) : undefined;
  const invited = !!inv;
  if (t.isPrivate && !invited && !t.paid.includes(user.uid)) throw new TableError('private');
  const charge = !invited && !t.paid.includes(user.uid);
  const paid = t.paid.includes(user.uid) ? t.paid : [...t.paid, user.uid];
  if (invited) t = { ...t, invites: invites.filter((i) => i.code !== invite) };
  // المقعد المحجوز في الدعوة أولاً، ثم أول مقعد فارغ (قبل بدء اللعب فقط)
  const reserved = inv?.seat !== undefined && !t.game && t.seats[inv.seat] === null ? inv.seat : -1;
  const free = t.game ? -1 : reserved >= 0 ? reserved : t.seats.findIndex((m) => m === null);
  const member: Member = { uid: user.uid, username: user.username, isBot: false };
  if (free >= 0) {
    const seats = [...t.seats];
    seats[free] = member;
    return { table: { ...t, seats, paid }, charge };
  }
  return { table: { ...t, spectators: [...t.spectators, member], paid }, charge };
}

/** يغادر مستخدم. أثناء اللعب يحل مكانه روبوت. يرجع هل حلّ روبوت مكانه. */
export function leave(t0: TableData, uid: string, rng: () => number = Math.random): { table: TableData; botReplaced: boolean } {
  const t = markBack(withoutVoice(t0, uid), uid);
  const seat = seatOf(t, uid);
  if (seat === null) return { table: { ...t, spectators: t.spectators.filter((m) => m.uid !== uid) }, botReplaced: false };
  const seats = [...t.seats];
  if (t.game && t.game.phase !== 'matchOver') {
    const n = t.botCount + 1;
    seats[seat] = { uid: `bot-${n}`, username: botName(t, rng), isBot: true };
    return { table: { ...t, seats, botCount: n }, botReplaced: true };
  }
  seats[seat] = null;
  return { table: { ...t, seats }, botReplaced: false };
}

/** دعوة جديدة (يدفعها المالك)، ويمكن أن تحجز مقعداً */
export function addInvite(t: TableData, code: string, seat?: Seat): TableData {
  return { ...t, invites: [...(t.invites ?? []), { code, seat }].slice(-30) };
}

const inLobby = (t: TableData) => !t.game || t.game.phase === 'matchOver';

/**
 * المالك يضع شخصاً في مقعد:
 * - مشاهد → يجلس (حتى أثناء اللعب)، ومن كان في المقعد يصبح مشاهداً (أو يُزال إن كان روبوتاً)
 * - جالس في مقعد آخر → يتبادلان المقعدين (قبل بدء اللعب فقط)
 */
export function assignSeat(t: TableData, seat: Seat, uid: string): TableData {
  if (t.spectators.some((m) => m.uid === uid)) return replaceSeat(t, seat, uid);
  const from = t.seats.findIndex((m) => m?.uid === uid);
  if (from < 0) throw new TableError('not-a-member');
  if (!inLobby(t)) throw new TableError('game-started');
  if (from === seat) return t;
  const seats = [...t.seats];
  [seats[seat], seats[from]] = [seats[from], seats[seat]];
  return { ...t, seats };
}

/** المالك يُخلي مقعداً (قبل بدء اللعب): الإنسان يصبح مشاهداً، والروبوت يُزال */
export function vacateSeat(t: TableData, seat: Seat): TableData {
  if (!inLobby(t)) throw new TableError('game-started');
  const m = t.seats[seat];
  if (!m) return t;
  const seats = [...t.seats];
  seats[seat] = null;
  return { ...t, seats, spectators: m.isBot ? t.spectators : [...t.spectators, m] };
}

/**
 * المالك يستبدل من في المقعد بأحد المشاهدين (حتى أثناء اللعب: يأخذ البديل أوراق المقعد).
 * إن كان المُستبدَل إنساناً يصبح مشاهداً، وإن كان روبوتاً يُزال.
 */
export function replaceSeat(t: TableData, seat: Seat, spectatorUid: string): TableData {
  const incoming = t.spectators.find((m) => m.uid === spectatorUid);
  if (!incoming) throw new TableError('not-a-spectator');
  const outgoing = t.seats[seat];
  const seats = [...t.seats];
  seats[seat] = incoming;
  let spectators = t.spectators.filter((m) => m.uid !== spectatorUid);
  if (outgoing && !outgoing.isBot) spectators = [...spectators, outgoing];
  const cleared = outgoing && !outgoing.isBot ? markBack(t, outgoing.uid) : t;
  return { ...cleared, seats, spectators };
}

export function addBot(t: TableData, seat: Seat, rng: () => number = Math.random): TableData {
  if (!inLobby(t)) throw new TableError('game-started');
  if (t.seats[seat]) throw new TableError('seat-taken');
  const n = t.botCount + 1;
  const seats = [...t.seats];
  seats[seat] = { uid: `bot-${n}`, username: botName(t, rng), isBot: true };
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
    case 'secondHokm': return 'حكم ثاني';
    case 'qablak': return 'قبلك';
    case 'hokm': return `حكم ${SUIT_NAMES[b.suit]}`;
  }
}

/** إعلان بداية كل توزيع: الموزع وورقة الأرض (القبلة) */
export function dealAnnouncement(t: TableData): string {
  const g = t.game;
  if (!g?.qaba) return '';
  return `${nameOf(t, g.dealer)} الموزع. ورقة الأرض: ${cardLabel(g.qaba)}`;
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
    case 'bid': {
      // اختيار لون "الثاني" يُعلن مباشرة كشراء
      const choosingSecond = before.secondHokm?.remaining === 0;
      if (!choosingSecond) events.push(`${who}: ${bidText(action.bid)}`);
      if (!before.contract && after.contract) {
        const c = after.contract;
        events.push(`${nameOf(t, c.buyer)} اشترى ${contractText(after)}`);
        if (c.qabaTo !== c.buyer) events.push(`القبلة لـ${nameOf(t, c.qabaTo)}`);
        if (after.phase === 'doubling') events.push(`الدبل لـ${teamName(t, after.doubling.awaitingTeam!)} قبل توزيع بقية الورق`);
        else events.push('وُزّعت بقية الورق، بدأ اللعب');
      }
      if (after.secondHokm?.remaining === 0 && before.secondHokm?.remaining !== 0) {
        events.push(`الكل قال بس — ${nameOf(t, after.secondHokm.seat)} يختار الحكم`);
      }
      if (needsRedeal(after)) events.push('الكل مرّ مرتين — صنكة، إعادة توزيع');
      break;
    }
    case 'double': {
      const d = after.doubling;
      const label = d.gahwa ? 'قهوة' : ({ 2: 'دبل', 3: 'ثري', 4: 'فور' } as const)[d.level as 2 | 3 | 4];
      const lock = after.contract!.mode === 'hokm' && !d.gahwa ? (d.locked ? ' مقفل' : ' مفتوح') : '';
      events.push(`${who}: ${label}${lock}`);
      if (after.phase === 'playing') events.push('وُزّعت بقية الورق، بدأ اللعب');
      break;
    }
    case 'doublePass':
      if (after.phase === 'playing') events.push('وُزّعت بقية الورق، بدأ اللعب');
      break;
    case 'declareProject': {
      const mine = after.declared.find((d) => d.seat === action.seat)!;
      events.push(`${who}: مشروع ${mine.projects.map((p) => PROJECT_NAMES[p.kind]).join(' و')}`);
      break;
    }
    case 'declareBaloot':
      events.push(`${who}: بلوت`);
      break;
    case 'play': {
      // إعلان المشروع التلقائي قبل الورقة
      const newly = after.declared.find((d) => d.seat === action.seat && !before.declared.some((b) => b.seat === action.seat));
      if (newly) events.push(`${who}: مشروع ${newly.projects.map((p) => PROJECT_NAMES[p.kind]).join(' و')}`);
      events.push(`${who}: ${cardLabel(action.card)}`);
      // كشف المشروع في اللفة الثانية: بعد أن يلعب صاحبه ورقته تُنطق أوراق مشروعه
      // (أو يُعلن إلغاؤه إن كان مشروع الفريق الآخر أقوى)
      const mineDeclared = before.trickNo === 1 ? after.declared.find((d) => d.seat === action.seat) : undefined;
      if (mineDeclared && after.projects) {
        if (after.projects.winningTeam === teamOf(action.seat)) {
          for (const p of mineDeclared.projects) {
            events.push(`مشروع ${who}: ${PROJECT_NAMES[p.kind]} — ${p.cards.map(cardLabel).join('، ')}`);
          }
        } else {
          events.push(`أُلغي مشروع ${who}`);
        }
      }
      if (after.lastTrick && after.trickNo !== before.trickNo) {
        events.push(`الأكلة لـ${nameOf(t, after.lastTrick.winner)}`);
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
    const table = { ...t, game: redeal(t.game!, rng) };
    return { table, events: ['توزيع جديد', dealAnnouncement(table)] };
  }
  if (step.kind === 'nextHand') {
    const table = { ...t, game: nextHand(t.game!, rng) };
    return { table, events: ['صكة جديدة', dealAnnouncement(table)] };
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
  /** cards: أوراق كل مشروع (بعد الأكلة الأولى فقط) */
  declared: { seat: Seat; kinds: string[]; cards?: string[]; cancelled?: boolean }[];
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
  /** away: انقطع اتصاله ومقعده محجوز (awayUntil = متى يحل الروبوت مكانه) */
  seats: ({ username: string; isBot: boolean; away?: boolean; awayUntil?: number } | null)[];
  /** معرّفات الجالسين (لترتيب المقاعد من قبل المالك) — فارغ للمقعد الفارغ */
  seatUids: string[];
  spectators: { uid: string; username: string }[];
  /** من في المحادثة الصوتية */
  voice: { uid: string; username: string; sessionId: string; muted: boolean }[];
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
      // نوع المشروع يُعلن مع أول ورقة لصاحبه، وأوراقه تُكشف في اللفة الثانية بعد أن يلعب صاحبه
      declared: g.declared.map((d) => {
        const shown = g.trickNo > 1 || (g.trickNo === 1 && g.trick.some((p) => p.seat === d.seat));
        const won = g.projects?.winningTeam === teamOf(d.seat);
        return {
          seat: d.seat,
          kinds: d.projects.map((p) => PROJECT_NAMES[p.kind]),
          cards: shown && won ? d.projects.map((p) => p.cards.map(cardLabel).join('، ')) : undefined,
          cancelled: shown && !won ? true : undefined,
        };
      }),
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
    seats: t.seats.map((m) => {
      if (!m) return null;
      const at = t.away?.[m.uid];
      return at !== undefined ? { username: m.username, isBot: m.isBot, away: true, awayUntil: at + BOT_REPLACE_AFTER_MS } : { username: m.username, isBot: m.isBot };
    }),
    seatUids: t.seats.map((m) => m?.uid ?? ''),
    spectators: t.spectators.map((m) => ({ uid: m.uid, username: m.username })),
    voice: Object.entries(t.voice ?? {}).map(([u, v]) => ({ uid: u, username: memberName(t, u) ?? '', sessionId: v.sessionId, muted: v.muted })),
    game,
  };
}
