// منطق الطاولة (المقاعد، الأعضاء، الروبوتات، نصوص الإعلانات) — دوال نقية يستخدمها الخادم.
import { type Card, type Seat, type Suit, type Team, MAX_PEOPLE_AT_TABLE, SUIT_NAMES, cardLabel, nextSeat, teamOf } from './baloot/cards';
import { botAction } from './baloot/bot';
import {
  type Action, type Bid, type GameState, type Rng, applyAction, availableBids, availableDouble, canDeclareBaloot, isDoublingTurn, isLockChoiceTurn,
  canDeclareProject, handOver, legalCardsFor, needsRedeal, newMatch, nextHand, redeal,
} from './baloot/game';
import { type DeclaredProjects, PROJECT_NAMES, compareProjects } from './baloot/projects';
import { type GameKind, type GameVariant, dominoViewFor, jackarooViewFor, otherActive, otherAutoDelay, runOtherAuto, startOther } from './games';
import type { DominoState } from './domino/engine';
import type { JackarooState } from './jackaroo/engine';
import type { LudoState } from './ludo/engine';
import { personalize as personalizeLudo } from './ludo/labels';
import { human } from './botPace';
import { type DominoUi, type JackarooUi, type LudoUi, dominoUi, jackarooUi, ludoUi } from './gameUi';

/** أسماء المقاعد (للنصوص) */
const seatNames = (t: TableData) => t.seats.map((m, i) => m?.username ?? `المقعد ${i + 1}`);
import { BOT_REPLACE_AFTER_MS, KICK_BLOCK_MS, LOBBY_LEAVE_AFTER_MS, SPECTATOR_LEAVE_AFTER_MS } from './economy';

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
  /** سجل المباراة الحالية: نتيجة كل صكة فيها (بلا أوراق) — يبدأ من جديد مع كل مباراة */
  history?: HandRecord[];
  /** رقم المباراة الحالية */
  matchNo?: number;
  /** خارج اللعب: من انقطع اتصاله ومتى (يخرج من الطاولة إن لم يعد خلال LOBBY_LEAVE_AFTER_MS) */
  lobbyAway?: Record<string, number>;
  /** مهلة بعد شراء حكم أو صن قبل انتقال الدور: حتى هذا الوقت يبقى الدور ظاهراً عند صاحب القرار ولا أزرار لأحد */
  hold?: { until: number; seat: Seat };
  /** محظورون من الطاولة (حظرهم المالك): لا يستطيعون الدخول مرة أخرى */
  banned?: string[];
  /** مطرودون: uid → متى يُسمح له بالعودة لهذه الطاولة */
  kicked?: Record<string, number>;
  /** كتمهم المالك في المحادثة الصوتية: لا يصل صوتهم لأحد ولا يستطيعون فتح الميكروفون */
  voiceBlocked?: string[];
  /** نوع اللعبة على الطاولة (الافتراضي بلوت) ونسختها (الجاكارو: عادي أو كمبلكس) */
  kind?: GameKind;
  variant?: GameVariant;
  domino?: DominoState | null;
  jackaroo?: JackarooState | null;
  ludo?: LudoState | null;
  /** سجل الدومينو: حركات كل جولة (صكة) بالترتيب ونتيجتها */
  dominoLog?: { hand: number; lines: string[] }[];
  /** سجل اللودو: الرميات والحركات بالترتيب */
  ludoLog?: string[];
}

/** سطر في السجل: نوع اللعب والمشتري وأبناط ونقاط كل فريق */
export interface HandRecord {
  /** رقم المباراة على هذه الطاولة (السجل يحفظ كل المباريات، كل واحدة لحالها) */
  match?: number;
  /** نقاط المشاريع (والبلوت) لكل فريق — تُعرض في السجل منفصلة عن الأبناط */
  projects?: [number, number];
  /** أسماء الفريقين وقت الصكة */
  teams: [string, string];
  contract: string;
  /** 1 بدون، 2 دبل، 3 ثري، 4 فور */
  level: number;
  gahwa: boolean;
  buyer: string;
  buyerTeam: Team;
  abnat: [number, number];
  points: [number, number];
  buyerFailed: boolean;
  kaboot: Team | null;
}

const gameActive = (t: TableData) => Boolean(t.game && t.game.phase !== 'matchOver') || otherActive(t);
/** بدأت لعبة على الطاولة (حتى لو انتهت المباراة) */
const hasGame = (t: TableData) => Boolean(t.game || t.domino || t.jackaroo || t.ludo);

/** انقطع اتصال لاعب جالس أثناء المباراة: نحجز مقعده */
export function markAway(t: TableData, uid: string, now: number): TableData {
  if (!gameActive(t) || seatOf(t, uid) === null || t.away?.[uid] !== undefined) return t;
  return { ...t, away: { ...(t.away ?? {}), [uid]: now } };
}

// ───── خارج اللعب: المنقطع طويلاً يخرج من الطاولة ─────

const humanMembers = (t: TableData) => [...t.seats.filter((m): m is Member => m !== null && !m.isBot), ...t.spectators];

/** انقطع اتصال حاضر والطاولة ليست في مباراة: نبدأ مهلة خروجه */
export function markLobbyAway(t: TableData, uid: string, now: number): TableData {
  // أثناء المباراة: الجالس له حجز المقعد (away)، والمشاهد المنقطع تبدأ مهلة خروجه مثل خارج اللعب
  if ((gameActive(t) && seatOf(t, uid) !== null) || t.lobbyAway?.[uid] !== undefined || !humanMembers(t).some((m) => m.uid === uid)) return t;
  return { ...t, lobbyAway: { ...(t.lobbyAway ?? {}), [uid]: now } };
}

export function markLobbyBack(t: TableData, uid: string): TableData {
  if (t.lobbyAway?.[uid] === undefined) return t;
  const lobbyAway = { ...t.lobbyAway };
  delete lobbyAway[uid];
  return { ...t, lobbyAway };
}

/** كل حاضر غير متصل الآن تبدأ مهلته (يلتقط من انقطع قبل وجود هذه الميزة) */
export function sweepLobbyGhosts(t: TableData, connected: Set<string>, now: number): TableData {
  let cur = t;
  for (const m of humanMembers(t)) if (!connected.has(m.uid)) cur = markLobbyAway(cur, m.uid, now);
  return cur;
}

/** المنقطعون اللي تبدأ مهلة خروجهم: أثناء المباراة المشاهدون فقط (الجالس محجوز مقعده) */
const lobbyWaiting = (t: TableData) => Object.entries(t.lobbyAway ?? {}).filter(([uid]) => !gameActive(t) || seatOf(t, uid) === null);

/** مهلة خروج المنقطع: المشاهد دقيقتين، والجالس خارج اللعب ٥ دقائق */
const leaveAfter = (t: TableData, uid: string) => (seatOf(t, uid) === null ? SPECTATOR_LEAVE_AFTER_MS : LOBBY_LEAVE_AFTER_MS);

export function lobbyExpired(t: TableData, now: number): string[] {
  return lobbyWaiting(t).filter(([uid, at]) => now - at >= leaveAfter(t, uid)).map(([uid]) => uid);
}

export function nextLobbyDeadline(t: TableData): number | null {
  const times = lobbyWaiting(t).map(([uid, at]) => at + leaveAfter(t, uid));
  return times.length ? Math.min(...times) : null;
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

/** mic: نشر ميكروفونه (يبدأ الجميع مستمعين فقط حتى يفتح أحدهم الميكروفون أول مرة) */
export interface VoiceMember { sessionId: string; muted: boolean; mic?: boolean }

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

export function newTable(
  id: string, owner: { uid: string; username: string }, isPrivate: boolean, now: number, kind: GameKind = 'baloot', variant: GameVariant = 'classic',
): TableData {
  return {
    id, ownerUid: owner.uid, isPrivate, createdAt: now, kind, variant,
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
export function join(t: TableData, user: { uid: string; username: string }, invite?: string, now = Date.now()): { table: TableData; charge: boolean } {
  if (isMember(t, user.uid)) return { table: t, charge: false };
  if (t.banned?.includes(user.uid)) throw new TableError('banned');
  if ((t.kicked?.[user.uid] ?? 0) > now) throw new TableError('kicked');
  if (peopleCount(t) >= MAX_PEOPLE_AT_TABLE) throw new TableError('table-full');
  const invites = (t.invites ?? []).map((i) => (typeof i === 'string' ? { code: i } : i));
  const inv = invite ? invites.find((i) => i.code === invite) : undefined;
  const invited = !!inv;
  if (t.isPrivate && !invited && !t.paid.includes(user.uid)) throw new TableError('private');
  const charge = !invited && !t.paid.includes(user.uid);
  const paid = t.paid.includes(user.uid) ? t.paid : [...t.paid, user.uid];
  if (invited) t = { ...t, invites: invites.filter((i) => i.code !== invite) };
  // المقعد المحجوز في الدعوة أولاً، ثم أول مقعد فارغ (قبل بدء اللعب فقط)
  const reserved = inv?.seat !== undefined && !hasGame(t) && t.seats[inv.seat] === null ? inv.seat : -1;
  const free = hasGame(t) ? -1 : reserved >= 0 ? reserved : t.seats.findIndex((m) => m === null);
  const member: Member = { uid: user.uid, username: user.username, isBot: false };
  if (free >= 0) {
    const seats = [...t.seats];
    seats[free] = member;
    return { table: { ...t, seats, paid }, charge };
  }
  return { table: { ...t, spectators: [...t.spectators, member], paid }, charge };
}

/** المالك يُخرج حاضراً (ويحظره إن طلب): أثناء اللعب يحل روبوت مكانه */
export function kick(t: TableData, uid: string, ban: boolean, rng: () => number = Math.random, now = Date.now()) {
  if (uid === t.ownerUid || !memberName(t, uid)) throw new TableError('bad-request');
  const r = leave(t, uid, rng);
  const table = ban
    ? { ...r.table, banned: [...new Set([...(r.table.banned ?? []), uid])] }
    : { ...r.table, kicked: { ...pruneKicked(r.table.kicked, now), [uid]: now + KICK_BLOCK_MS } };
  return { ...r, table };
}

/** نحذف من انتهت مدة منعه */
const pruneKicked = (k: TableData['kicked'], now: number) => Object.fromEntries(Object.entries(k ?? {}).filter(([, until]) => until > now));

/** المالك يكتم حاضراً في المحادثة الصوتية أو يلغي كتمه */
export function setVoiceBlocked(t: TableData, uid: string, blocked: boolean): TableData {
  if (uid === t.ownerUid || !memberName(t, uid)) throw new TableError('bad-request');
  const list = (t.voiceBlocked ?? []).filter((u) => u !== uid);
  const voice = blocked && t.voice?.[uid] ? { ...t.voice, [uid]: { ...t.voice[uid], muted: true } } : t.voice;
  return { ...t, voice, voiceBlocked: blocked ? [...list, uid] : list };
}

export const isVoiceBlocked = (t: TableData, uid: string) => Boolean(t.voiceBlocked?.includes(uid));

/** يغادر مستخدم. أثناء اللعب يحل مكانه روبوت. يرجع هل حلّ روبوت مكانه. */
export function leave(t0: TableData, uid: string, rng: () => number = Math.random): { table: TableData; botReplaced: boolean; newOwner?: string } {
  const left = markLobbyBack(markBack(withoutVoice(t0, uid), uid), uid);
  // الكتم يبقى حتى يلغيه المالك أو يغادر صاحبه الطاولة
  const t = left.voiceBlocked?.includes(uid) ? { ...left, voiceBlocked: left.voiceBlocked.filter((u) => u !== uid) } : left;
  const seat = seatOf(t, uid);
  let table: TableData;
  let botReplaced = false;
  if (seat === null) {
    table = { ...t, spectators: t.spectators.filter((m) => m.uid !== uid) };
  } else {
    const seats = [...t.seats];
    if (gameActive(t)) {
      const n = t.botCount + 1;
      seats[seat] = { uid: `bot-${n}`, username: botName(t, rng), isBot: true };
      table = { ...t, seats, botCount: n };
      botReplaced = true;
    } else {
      seats[seat] = null;
      table = { ...t, seats };
    }
  }
  // غادر المالك: تنتقل الملكية لأول لاعب حقيقي جالس، وإلا لأقدم مشاهد
  if (uid === t.ownerUid) {
    const heir = table.seats.find((m) => m && !m.isBot) ?? table.spectators[0];
    if (heir) return { table: { ...table, ownerUid: heir.uid }, botReplaced, newOwner: heir.username };
  }
  return { table, botReplaced };
}

/** دعوة جديدة (يدفعها المالك)، ويمكن أن تحجز مقعداً */
export function addInvite(t: TableData, code: string, seat?: Seat): TableData {
  return { ...t, invites: [...(t.invites ?? []), { code, seat }].slice(-30) };
}

const inLobby = (t: TableData) => !gameActive(t);

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

/**
 * إيقاف اللعبة نهائياً (المالك): تُلغى المباراة وسجلها، ويصبح كل الجالسين مشاهدين
 * وتُزال الروبوتات، فيختار المالك من يجلس. من دفع رسوم الدخول لا يدفعها مرة أخرى.
 */
export function stopGame(t: TableData): TableData {
  const humans = t.seats.filter((m): m is Member => m !== null && !m.isBot);
  return {
    ...t, game: null, domino: null, jackaroo: null, ludo: null, history: [], matchNo: 0, away: {},
    seats: [null, null, null, null],
    spectators: [...humans, ...t.spectators.filter((s) => !humans.some((h) => h.uid === s.uid))],
  };
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
  if (hasGame(t)) throw new TableError('game-started');
  if (!t.seats[seat]?.isBot) throw new TableError('not-a-bot');
  const seats = [...t.seats];
  seats[seat] = null;
  return { ...t, seats };
}

export function start(t: TableData, rng: Rng): TableData {
  if (!isFull(t)) throw new TableError('not-full');
  if (gameActive(t)) throw new TableError('game-started');
  // مباراة جديدة: سجل جديد لها وحدها (سجل المباراة السابقة يُمسح)
  return { ...t, game: newMatch(rng, 0), matchNo: (t.matchNo ?? 0) + 1, history: [], lobbyAway: {} };
}

/** عدد اللاعبين المسموح لكل لعبة: البلوت والجاكارو 4، الدومينو 2 أو 4، اللودو 2 أو 3 أو 4 (الفرق 4) */
export function allowedPlayers(t: TableData): number[] {
  const kind = t.kind ?? 'baloot';
  // الدومينو: لاعبين أو ثلاثة (كل واحد لنفسه، مع السحب من البنك) أو أربعة (فريقين)
  if (kind === 'domino') return [2, 3, 4];
  if (kind === 'ludo') return t.variant === 'teams' ? [4] : [2, 3, 4];
  return [4];
}
export const seatedCount = (t: TableData) => t.seats.filter(Boolean).length;
export const canStart = (t: TableData) => allowedPlayers(t).includes(seatedCount(t));

/** نرتّب الجالسين على المقاعد اللي تلعبها اللعبة: الدومينو المقاعد الأولى، واللودو مقعدين متقابلين أو ثلاثة متتالية */
function compactSeats(t: TableData): TableData {
  const n = seatedCount(t);
  if (n === 4) return t;
  const members = t.seats.filter((m): m is Member => m !== null);
  const targets = (t.kind === 'ludo' ? (n === 2 ? [0, 2] : [0, 1, 2]) : [0, 1, 2, 3].slice(0, n));
  const seats: (Member | null)[] = [null, null, null, null];
  members.forEach((m, i) => { seats[targets[i]] = m; });
  return { ...t, seats };
}

/** بدء مباراة بحسب نوع الطاولة، مع إعلانات البداية */
export function startAny(t: TableData, rng: Rng): { table: TableData; events: string[]; voices?: Voice[] } {
  if ((t.kind ?? 'baloot') === 'baloot') {
    const table = start(t, rng);
    return { table, events: ['بدأت المباراة', dealAnnouncement(table)], voices: ['first'] };
  }
  if (!canStart(t)) throw new TableError(t.kind === 'jackaroo' ? 'not-full' : 'bad-count');
  if (gameActive(t)) throw new TableError('game-started');
  const r = startOther(compactSeats({ ...t, matchNo: (t.matchNo ?? 0) + 1, history: [], lobbyAway: {} }), rng);
  return r;
}

/** المالك يغيّر لعبة الطاولة: تنتهي اللعبة الحالية، ويبقى الكل في أماكنهم للعبة الجديدة */
export function changeGame(t: TableData, kind: GameKind, variant: GameVariant): TableData {
  return {
    ...t, kind, variant,
    game: null, domino: null, jackaroo: null, ludo: null, history: [], matchNo: 0, away: {}, hold: undefined,
    dominoLog: undefined, ludoLog: undefined,
  };
}

// ───── أسماء ونصوص الإعلانات ─────

const nameOf = (t: TableData, seat: Seat) => t.seats[seat]?.username ?? `المقعد ${seat + 1}`;
export const teamName = (t: TableData, team: Team) => `فريق ${nameOf(t, team as Seat)} و${nameOf(t, (team + 2) as Seat)}`;

/** نص المزايدة بعد اسم صاحبها: "خالد اشترى صن"، "خالد بس" */
function bidText(b: Bid, round: 1 | 2 = 1): string {
  switch (b.type) {
    // اللفة الثانية: "ولا" بدل "بس"
    case 'pass': return round === 2 ? 'ولا' : 'بس';
    case 'sun': return 'اشترى صن';
    case 'ashkal': return 'اشترى أشكل';
    case 'secondHokm': return 'اشترى حكم ثاني';
    case 'qablak': return 'قال قبلك';
    case 'confirmHokm': return 'أكد الحكم';
    case 'double': return 'دبّل';
    // «فلان اشترى حكم سبيت» — في الحكم الأول النوع لون ورقة الأرض
    case 'hokm': return `اشترى حكم ${SUIT_NAMES[b.suit]}`;
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

/** مشروع أُعلن بعد مشروع بنفس قوته من لاعب سبقه: لا يُعلن (يُعلن مشروع الأسبق فقط) */
function equalsEarlier(d: DeclaredProjects, earlier: DeclaredProjects[]): boolean {
  const best = (x: DeclaredProjects) => x.projects.reduce((a, b) => (compareProjects(b, a) > 0 ? b : a));
  return earlier.some((e) => e.seat !== d.seat && e.projects.length > 0 && d.projects.length > 0 && compareProjects(best(d), best(e)) === 0);
}

/** يطبق حركة ويرجع نصوص الإعلانات المناسبة لكل اللاعبين. */
/**
 * الأصوات المنطوقة للمزايدة والدبل (يشغّلها التطبيق بالترتيب): مفاتيح ملفات صوتية بشرية
 * pass/wala/sun/hokm/hokm2/ashkal/qablak/double/three/four/gahwa/locked/open
 */
export type Voice = 'pass' | 'wala' | 'sun' | 'hokm' | 'hokm2' | 'ashkal' | 'qablak' | 'double' | 'three' | 'four' | 'gahwa' | 'locked' | 'open' | 'confirm' | `hokm2-${Suit}`
  /** أول (بداية الجولة)، ثاني (الكل قال بس في اللفة الأولى)، ورق (الكل قال بس مرتين: إعادة توزيع) */
  | 'first' | 'second' | 'paper';
const BID_VOICE: Partial<Record<Bid['type'], Voice>> = { sun: 'sun', hokm: 'hokm', secondHokm: 'hokm2', ashkal: 'ashkal', qablak: 'qablak', confirmHokm: 'confirm', double: 'double' };
const DOUBLE_VOICE: Record<string, Voice> = { دبل: 'double', ثري: 'three', فور: 'four', قهوة: 'gahwa' };

/** المهلة بين شراء حكم أو صن وانتقال الدور */
const HOLD_BIDS = new Set<Bid['type']>(['hokm', 'secondHokm', 'sun', 'ashkal', 'qablak', 'confirmHokm']);
export const DECISION_GAP_MS = 1500;
/** هل الدور ما زال موقوفاً عند صاحب القرار الأخير */
export const holding = (t: TableData, now = Date.now()) => !!t.hold && now < t.hold.until;

export function applyWithEvents(t: TableData, action: Action, rng: Rng, now = Date.now()): { table: TableData; events: string[]; voices?: Voice[] } {
  const before = t.game!;
  const after = applyAction(before, action);
  const events: string[] = [];
  const voices: Voice[] = [];
  let history: HandRecord[] | undefined;
  const who = 'seat' in action ? nameOf(t, action.seat) : '';

  switch (action.type) {
    case 'bid': {
      // إعلانات قصيرة بما حدث فقط (اشترى، أكد، بس) — بلا "بانتظار" ولا "من عليه القرار"
      // اختيار نوع الحكم الثاني: «حكم ثاني هاص» وغيره
      const v: Voice | undefined = action.bid.type === 'pass' ? (before.bidRound === 2 ? 'wala' : 'pass')
        : action.bid.type === 'hokm' && before.secondHokm ? `hokm2-${action.bid.suit}` : BID_VOICE[action.bid.type];
      if (v) voices.push(v);
      const bought = !before.contract && after.contract;
      if (bought) {
        const c = after.contract!;
        events.push(action.bid.type === 'confirmHokm'
          ? `${nameOf(t, c.buyer)} أكد الحكم، ${contractText(after)}`
          : `${nameOf(t, c.buyer)} اشترى ${contractText(after)}`);
        if (c.qabaTo !== c.buyer) events.push(`ورقة الأرض لـ${nameOf(t, c.qabaTo)}`);
        // دبل قبل تأكيد الحكم: الحكم لصاحبه، ثم إعلان الدبل
        if (action.bid.type === 'double') events.push(`${who} اشترى دبل`);
      } else if (action.bid.type === 'confirmHokm') {
        events.push(`${who} أكد الحكم`);
      } else {
        events.push(`${who} ${bidText(action.bid, before.bidRound)}`);
      }
      if (needsRedeal(after)) { events.push('الكل مرّ مرتين — صنكة، إعادة توزيع'); voices.push('paper'); }
      // الكل قال بس في اللفة الأولى: تبدأ اللفة الثانية
      else if (before.bidRound === 1 && after.bidRound === 2 && after.phase === 'bidding') voices.push('second');
      break;
    }
    case 'double': {
      const d = after.doubling;
      const label = d.gahwa ? 'قهوة' : ({ 2: 'دبل', 3: 'ثري', 4: 'فور' } as const)[d.level as 2 | 3 | 4];
      events.push(`${who} اشترى ${label}`);
      voices.push(DOUBLE_VOICE[label]);
      if (d.lockPending == null && after.contract!.mode === 'hokm' && !d.gahwa) {
        events.push(d.locked ? 'مقفل' : 'مفتوح');
        voices.push(d.locked ? 'locked' : 'open');
      }
      break;
    }
    case 'doubleLock': {
      events.push(after.doubling.locked ? `${who}: مقفل` : `${who}: مفتوح`);
      voices.push(after.doubling.locked ? 'locked' : 'open');
      break;
    }
    case 'doublePass':
      voices.push('pass');
      break;
    case 'declareProject': {
      const mine = after.declared.find((d) => d.seat === action.seat)!;
      if (!equalsEarlier(mine, before.declared)) events.push(`${who}: مشروع ${mine.projects.map((p) => PROJECT_NAMES[p.kind]).join(' و')}`);
      break;
    }
    case 'declareBaloot':
      events.push(`${who}: بلوت`);
      break;
    case 'play': {
      // إعلان المشروع التلقائي قبل الورقة
      const newly = after.declared.find((d) => d.seat === action.seat && !before.declared.some((b) => b.seat === action.seat));
      if (newly && !equalsEarlier(newly, before.declared)) events.push(`${who}: مشروع ${newly.projects.map((p) => PROJECT_NAMES[p.kind]).join(' و')}`);
      events.push(`${who}: ${cardLabel(action.card)}`);
      // البلوت تلقائي مع الورقة الثانية منه (الشايب أو البنت)
      if (after.balootSeat !== null && before.balootSeat === null) events.push(`${who}: بلوت`);
      // كشف المشروع في اللفة الثانية: بعد أن يلعب صاحبه ورقته تُنطق أوراق مشروعه
      // (أو يُعلن إلغاؤه إن كان مشروع الفريق الآخر أقوى)
      const mineDeclared = before.trickNo === 1 ? after.declared.find((d) => d.seat === action.seat) : undefined;
      const hidden = mineDeclared ? equalsEarlier(mineDeclared, after.declared.slice(0, after.declared.indexOf(mineDeclared))) : false;
      if (mineDeclared && after.projects && !hidden) {
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
        const c = after.contract!;
        const buyerTeam = teamOf(c.buyer);
        // أبناط الأوراق مع الأرض كما هي (الصن من 130)، والمشاريع منفصلة
        const abnat = r.cardAbnat ?? r.abnat ?? [0, 0];
        const level = after.doubling.level;
        const record: HandRecord = {
          match: t.matchNo ?? 1,
          teams: [teamName(t, 0), teamName(t, 1)], contract: contractText(after), level, gahwa: after.doubling.gahwa,
          buyer: nameOf(t, c.buyer), buyerTeam, abnat, projects: r.projectPoints ?? [0, 0], points: r.points, buyerFailed: r.buyerFailed, kaboot: r.kaboot,
        };
        history = [...(t.history ?? []), record];
        // يُنطق نقاط كل فريق فقط — الفائز والأبناط وباقي التفاصيل في السجل
        events.push(`انتهت الصكة. نتيجة الصكة: ${teamName(t, 0)} ${r.points[0]}، ${teamName(t, 1)} ${r.points[1]}`);
        events.push(`المجموع: ${after.scores[0]} مقابل ${after.scores[1]}`);
        if (after.outcome.status === 'won') events.push(`انتهت المباراة — فاز ${teamName(t, after.outcome.winner)}`);
        if (after.outcome.status === 'tiebreak') events.push('تعادل — جولة فاصلة');
      }
      break;
    }
  }
  void rng;
  // ثانية ونص بعد شراء حكم أو صن (أو أشكل/قبلك/تأكيد الحكم) قبل ما ينتقل الدور لمن بعده يختار — لا بعد «بس» ولا الدبل ولا لعب الورق
  const decision = action.type === 'bid' && HOLD_BIDS.has(action.bid.type);
  const hold = decision && after.phase !== 'matchOver' && !needsRedeal(after) ? { until: now + DECISION_GAP_MS, seat: action.seat } : undefined;
  const { hold: _old, ...rest } = t;
  void _old;
  return { table: { ...rest, game: after, ...(history ? { history } : {}), ...(hold ? { hold } : {}) }, events, ...(voices.length ? { voices } : {}) };
}

// ───── الخطوة التلقائية التالية (روبوت أو توزيع) ─────

export type AutoStep =
  | { kind: 'bot'; seat: Seat; action: Action; delayMs: number }
  | { kind: 'redeal'; delayMs: number }
  | { kind: 'nextHand'; delayMs: number }
  /** دومينو أو جاكارو: دور روبوت أو صكة جديدة */
  | { kind: 'other'; delayMs: number };

/** ما الذي يجب أن يحدث تلقائياً بعد الآن؟ (null = ننتظر لاعباً بشرياً) */
export function nextAutoStep(t: TableData, rng: Rng): AutoStep | null {
  if (t.domino || t.jackaroo || t.ludo) {
    const delayMs = otherAutoDelay(t, rng);
    return delayMs === null ? null : { kind: 'other', delayMs };
  }
  const g = t.game;
  if (!g || g.phase === 'matchOver') return null;
  if (needsRedeal(g)) return { kind: 'redeal', delayMs: 2500 };
  // بين نهاية الجولة والجولة اللي بعدها 8 ثوانٍ
  if (handOver(g)) return { kind: 'nextHand', delayMs: 8000 };
  // نعطي الأولوية لمن عليه الدور، ثم إعلان البلوت لأي روبوت
  const order: Seat[] = [];
  if (g.phase === 'doubling') {
    for (const s of [0, 1, 2, 3] as Seat[]) if (isDoublingTurn(g, s) || isLockChoiceTurn(g, s)) order.push(s);
  } else {
    order.push(g.turn, nextSeat(g.turn), nextSeat(g.turn, 2), nextSeat(g.turn, 3));
  }
  for (const seat of order) {
    if (!t.seats[seat]?.isBot) continue;
    const action = botAction(g, seat);
    if (action) return { kind: 'bot', seat, action, delayMs: balootPace(g, seat, action, rng) };
  }
  return null;
}

/** وقت تفكير الروبوت في البلوت مثل اللاعب الحقيقي */
function balootPace(g: GameState, seat: Seat, action: Action, rng: Rng): number {
  switch (action.type) {
    // «بس» و«ولا» أسرع، والشراء (حكم، صن، أشكل، تأكيد...) ياخذ تفكير
    case 'bid': return action.bid.type === 'pass' ? human(rng, 1400, 3200) : human(rng, 2200, 4500);
    case 'double': return human(rng, 2000, 4000);
    case 'doublePass': return human(rng, 1000, 2200);
    case 'doubleLock': return human(rng, 1500, 3000);
    case 'play': {
      const options = legalCardsFor(g, seat).length;
      if (options <= 1) return human(rng, 900, 1600); // ورقة وحدة مسموحة
      if (g.trickNo >= 7) return human(rng, 800, 1500); // آخر أكلة
      // بعد آخر ورقة في الأكلة تبقى الأكلة ظاهرة ٣ ثواني قبل ما تنسحب: الروبوت ما يبدأ الأكلة الجاية قبلها
      if (!g.trick.length && g.trickNo > 0) return human(rng, 3300, 4600);
      if (!g.trick.length) return human(rng, 1600, 3400); // بداية الأكلة
      return human(rng, 1200, 2800);
    }
    default: return human(rng, 600, 1200); // إعلان مشروع أو بلوت
  }
}

export function runAutoStep(t: TableData, step: AutoStep, rng: Rng): { table: TableData; events: string[]; voices?: Voice[] } {
  if (step.kind === 'other') return runOtherAuto(t, rng);
  if (step.kind === 'redeal') {
    const table = { ...t, game: redeal(t.game!, rng) };
    return { table, events: ['توزيع جديد', dealAnnouncement(table)], voices: ['first'] };
  }
  if (step.kind === 'nextHand') {
    const table = { ...t, game: nextHand(t.game!, rng) };
    return { table, events: ['صكة جديدة', dealAnnouncement(table)], voices: ['first'] };
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
  /** من اشترى الحكم الثاني (قبل وبعد ما يحدد اللون) */
  secondHokmSeat: Seat | null;
  /** شراء ما تأكد بعد (قبل ما يصير عقد): مين اشترى وعلى وش — للإيماءة «فلان اشترى حكم» */
  pendingBuy: { seat: Seat; kind: 'hokm' | 'sun' | 'ashkal' | 'secondHokm' } | null;
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
  declared: { seat: Seat; kinds: string[]; cards?: string[]; faces?: Card[]; cancelled?: boolean }[];
  actions: {
    bids: Bid[];
    double: ReturnType<typeof availableDouble>;
    canPassDouble: boolean;
    /** أعلنتَ الدبل: اختر مقفل أو مفتوح */
    chooseLock: boolean;
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
  voice: { uid: string; username: string; sessionId: string; muted: boolean; mic: boolean; blocked?: boolean }[];
  /** من كتمهم المالك في المحادثة الصوتية */
  voiceBlocked?: string[];
  game: GameView | null;
  kind: GameKind;
  variant: GameVariant;
  /** الدومينو والجاكارو: الحالة كاملة مع إخفاء قطع/أوراق الآخرين */
  domino: DominoState | null;
  jackaroo: JackarooState | null;
  /** لودو: لا شيء مخفي (النرد يرميه الخادم) */
  ludo: LudoState | null;
  /** مساعدات العرض للدومينو والجاكارو واللودو (التطبيقات الأصلية) */
  ui: DominoUi | JackarooUi | LudoUi | null;
  /** كم لاعب يقدر يبدأ اللعبة (البلوت والجاكارو 4، الدومينو 2 أو 4، اللودو 2 أو 3 أو 4) */
  startCounts: number[];
  /** سجل الدومينو لكل جولة */
  dominoLog: { hand: number; lines: string[] }[];
  /** سجل اللودو */
  ludoLog: string[];
  /** سجل صكات المباراة الحالية */
  history: HandRecord[];
}

/** الشراء الحالي قبل ما يتأكد: صن/أشكل (يمكن ياخذه اللي قبله)، حكم ثاني، أو حكم */
function pendingBuy(g: GameState): GameView['pendingBuy'] {
  if (g.contract) return null;
  if (g.sunClaim) return { seat: g.sunClaim.caller, kind: g.sunClaim.ashkal ? 'ashkal' : 'sun' };
  if (g.secondHokm) return { seat: g.secondHokm.seat, kind: 'secondHokm' };
  if (g.hokmBid) return { seat: g.hokmBid.seat, kind: 'hokm' };
  return null;
}

export function viewFor(t: TableData, uid: string): TableView {
  const mySeat = seatOf(t, uid);
  const g = t.game;
  let game: GameView | null = null;
  if (g) {
    const held = holding(t);
    const playing = mySeat !== null && !held;
    game = {
      phase: g.phase, dealer: g.dealer, scores: g.scores, turn: held ? t.hold!.seat : g.turn, qaba: g.qaba, bidRound: g.bidRound,
      hokmBid: g.hokmBid, secondHokmSeat: g.secondHokm?.seat ?? null, pendingBuy: pendingBuy(g), contract: g.contract, doubling: g.doubling, trick: g.trick, lastTrick: g.lastTrick,
      trickNo: g.trickNo, tricksWon: g.tricksWon, lastHand: g.lastHand, outcome: g.outcome,
      handCounts: g.hands.map((h) => h.length),
      myHand: mySeat !== null ? g.hands[mySeat] : [],
      balootSeat: g.balootSeat,
      projects: g.trickNo > 0 ? g.projects : null,
      // نوع المشروع يُعلن مع أول ورقة لصاحبه، وأوراقه تُكشف في اللفة الثانية بعد أن يلعب صاحبه
      // مشروع بنفس قوة مشروع أُعلن قبله لا يظهر (يُعلن مشروع الأسبق فقط)
      declared: g.declared.filter((d, i) => !equalsEarlier(d, g.declared.slice(0, i))).map((d) => {
        const shown = g.trickNo > 1 || (g.trickNo === 1 && g.trick.some((p) => p.seat === d.seat));
        const won = g.projects?.winningTeam === teamOf(d.seat);
        return {
          seat: d.seat,
          kinds: d.projects.map((p) => PROJECT_NAMES[p.kind]),
          cards: shown && won ? d.projects.map((p) => p.cards.map(cardLabel).join('، ')) : undefined,
          // أوراق المشروع نفسها (للعرض قدام صاحبه في التطبيق)
          faces: shown && won ? d.projects.flatMap((p) => p.cards) : undefined,
          cancelled: shown && !won ? true : undefined,
        };
      }),
      actions: {
        bids: playing ? availableBids(g, mySeat) : [],
        double: playing ? availableDouble(g, mySeat) : null,
        canPassDouble: playing && isDoublingTurn(g, mySeat),
        chooseLock: playing && isLockChoiceTurn(g, mySeat),
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
    history: t.history ?? [],
    spectators: t.spectators.map((m) => ({ uid: m.uid, username: m.username })),
    voice: Object.entries(t.voice ?? {}).map(([u, v]) => ({ uid: u, username: memberName(t, u) ?? '', sessionId: v.sessionId, muted: v.muted, mic: v.mic !== false, blocked: isVoiceBlocked(t, u) })),
    voiceBlocked: t.voiceBlocked ?? [],
    game,
    kind: t.kind ?? 'baloot',
    variant: t.variant ?? 'classic',
    domino: t.domino ? dominoViewFor(t.domino, mySeat) : null,
    jackaroo: t.jackaroo ? jackarooViewFor(t.jackaroo, mySeat) : null,
    ludo: t.ludo ?? null,
    // للتطبيقات الأصلية: الحركات المسموحة ونصوصها وقراءات اللوحة
    startCounts: allowedPlayers(t),
    dominoLog: t.domino ? t.dominoLog ?? [] : [],
    // السجل يُكمَّل لكل واحد: أرقام الخانات من خانة بدايته و"أنت" بدل اسمه
    ludoLog: t.ludo ? (t.ludoLog ?? []).map((e) => personalizeLudo(e, seatNames(t), mySeat ?? -1)) : [],
    ui: t.domino ? dominoUi(t.domino, mySeat, seatNames(t)) : t.jackaroo ? jackarooUi(t.jackaroo, mySeat, seatNames(t)) : t.ludo ? ludoUi(t.ludo, mySeat, seatNames(t)) : null,
  };
}

/** للعميل: هل بدأت لعبة على الطاولة (أي نوع)، وهل هي جارية الآن */
export const viewHasGame = (v: TableView) => Boolean(v.game || v.domino || v.jackaroo || v.ludo);
export const viewPlaying = (v: TableView) => Boolean(
  (v.game && v.game.phase !== 'matchOver') || (v.domino && v.domino.phase !== 'matchOver') || v.jackaroo?.phase === 'playing' || (v.ludo && v.ludo.phase !== 'over'),
);
