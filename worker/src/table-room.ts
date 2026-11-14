import { isPro } from '../../shared/pro';
import { usernameKey } from '../../shared/username';
import { DurableObject } from 'cloudflare:workers';
import type { Card, Rank, Seat, Suit } from '../../shared/baloot/cards';
import { RANKS, SUITS } from '../../shared/baloot/cards';
import { type Action, type Bid, IllegalAction, isQaidKind } from '../../shared/baloot/game';
import { BOT_REPLACE_AFTER_MS, COINS, LOBBY_LEAVE_AFTER_MS } from '../../shared/economy';
import {
  type TableData, TableError, addBot, addInvite, applyWithEvents, assignSeat, seatBot, stopGame, kick, setVoiceBlocked, isMember as inTable, lobbyExpired, stampMatchOptions, pinnedPass, emptyPinned, markLobbyAway, markLobbyBack, nextLobbyDeadline, sweepLobbyGhosts, hasHumans, vacateSeat, isFull, join, leave, newTable, nextAutoStep, peopleCount,
  awayExpired, markAway, markBack, memberName, setGameOptions, gameOptions, nextAwayDeadline, replaceWithBot, runAutoStep, seatOf, holding, changeGame, startAny, viewFor, type VoiceMember,
  JOIN_REQUEST_HOLD_MS, JOIN_REJECT_BLOCK_MS, isJoinApproved,
} from '../../shared/table';
import { type GameKind, type GameVariant, GAME_NAMES, VARIANTS, gameTitle, applyOther, kindOf, otherActive, otherStatus, parseDomino, parseJackaroo, parseLudo, scoreSummary } from '../../shared/games';
import { LudoError } from '../../shared/ludo/engine';
import { personalize as personalizeLudo } from '../../shared/ludo/labels';
import { DominoError } from '../../shared/domino/engine';
import { JackarooError } from '../../shared/jackaroo/engine';
import type { VoiceInfo } from './voice-room';
import type { Env } from './env';
import { Firestore } from './firestore';
import { rigTieDeal, tieHint } from '../../shared/baloot/tieRig';
import { refreshClock, timeoutAction, validTurnLimit } from '../../shared/turnClock';

/** تجربة التعادل 81–81: مرة وحدة بس، لأول توزيع حكم في طاولة جالس فيها هالأربعة */
const TIE_RIG_USERS = ['ياسر', 'البرجوازي', 'محمد', 'خالد'].map(usernameKey);

/**
 * غرفة طاولة واحدة: تحفظ حالة اللعبة، تستقبل حركات اللاعبين عبر WebSocket،
 * تتحقق منها بمحرك القواعد، تشغّل الروبوتات، وترسل لكل شخص ما يحق له رؤيته فقط.
 */

type ClientMessage =
  | { type: 'action'; action: unknown }
  | { type: 'domino'; action: unknown }
  | { type: 'jackaroo'; action: unknown }
  | { type: 'ludo'; action: unknown }
  | { type: 'addBot'; seat: number }
  | { type: 'start'; turnLimit?: number; manualProjects?: boolean; qaid?: boolean; sawa?: boolean }
  | { type: 'turnLimit'; turnLimit?: number }
  | { type: 'leave' }
  | { type: 'replace'; seat: number; uid: string }
  | { type: 'vacate'; seat: number }
  | { type: 'botNow'; seat: number }
  | { type: 'stop' }
  /** المالك يغيّر لعبة الطاولة (ينتقل الكل للعبة الجديدة) */
  | { type: 'changeGame'; kind: string; variant?: string }
  | { type: 'setOptions'; teams?: boolean; complex?: boolean; target?: number }
  | { type: 'kick'; uid: string }
  | { type: 'ban'; uid: string }
  | { type: 'voiceBlock'; uid: string; blocked: boolean }
  | { type: 'setPrivate'; isPrivate: boolean }
  /** المالك يرد على طلب انضمام لطاولته الخاصة */
  | { type: 'joinAnswer'; uid: string; accept?: boolean; answer?: 'accept' | 'ignore' | 'reject' }
  | { type: 'setOwner'; uid: string }
  /** الدردشة الكتابية: رسالة، أو اختيار هذا الاتصال (off = ما توصله الرسائل ولا يرسل) */
  | { type: 'chat'; text: string }
  | { type: 'chatPref'; off: boolean }
  /** التطبيق يفهم رسالة «voice» الخفيفة (قائمة المحادثة الصوتية بدون الطاولة كاملة) */
  | { type: 'caps'; voice?: boolean };

/** الدردشة الكتابية: حد طول الرسالة، وأقل مدة بين رسالتين لنفس الشخص */
const CHAT_MAX = 200;
const CHAT_GAP_MS = 2000;

/**
 * عشوائية آمنة لخلط الورق والتوزيع: من مولّد التشفير في النظام (crypto.getRandomValues)،
 * لا يمكن توقعه ولا التلاعب به، وكل توزيع مستقل تماماً عن الذي قبله.
 */
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

const isSeat = (n: unknown): n is Seat => n === 0 || n === 1 || n === 2 || n === 3;
const isSuit = (s: unknown): s is Suit => SUITS.includes(s as Suit);
const isCard = (c: unknown): c is Card =>
  typeof c === 'object' && c !== null && isSuit((c as Card).suit) && RANKS.includes((c as Card).rank as Rank);

type SimpleBid = Exclude<Bid['type'], 'hokm'>;
// كل المزايدات بلا لون (Record يجبرنا على إضافة أي نوع جديد هنا، وإلا لا يُبنى الخادم)
const SIMPLE_BIDS = Object.keys({
  pass: 1, sun: 1, ashkal: 1, secondHokm: 1, qablak: 1, confirmHokm: 1, double: 1,
} satisfies Record<SimpleBid, 1>) as SimpleBid[];

/** يبني حركة من رسالة العميل. المقعد يُحدد من هوية المتصل، لا مما يرسله. */
function parseAction(raw: unknown, seat: Seat): Action | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'bid': {
      const b = a.bid as Record<string, unknown> | undefined;
      if (!b) return null;
      let bid: Bid | null = null;
      // المحرك يتحقق بعدها أن المزايدة مسموحة لهذا اللاعب الآن
      if (typeof b.type === 'string' && SIMPLE_BIDS.includes(b.type as SimpleBid)) bid = { type: b.type as SimpleBid };
      else if (b.type === 'hokm' && isSuit(b.suit)) bid = { type: 'hokm', suit: b.suit };
      return bid ? { type: 'bid', seat, bid } : null;
    }
    case 'double': return { type: 'double', seat, locked: typeof a.locked === 'boolean' ? a.locked : undefined };
    case 'doublePass': return { type: 'doublePass', seat };
    case 'doubleLock': return typeof a.locked === 'boolean' ? { type: 'doubleLock', seat, locked: a.locked } : null;
    case 'declareProject': return { type: 'declareProject', seat };
    case 'declareBaloot': return { type: 'declareBaloot', seat };
    case 'sawa': return { type: 'sawa', seat };
    case 'play': return isCard(a.card) ? { type: 'play', seat, card: { suit: a.card.suit, rank: a.card.rank } } : null;
    case 'waraq': return { type: 'waraq', seat, call: a.call !== false };
    // القيد والقطع: إعلان نوع المشروع، وفرش أوراقه، والتسجيلة
    case 'declareKind':
      return a.kind === 'sira' || a.kind === 'fifty' || a.kind === 'hundred' || a.kind === 'fourHundred' ? { type: 'declareKind', seat, kind: a.kind } : null;
    case 'showProject': {
      if (!Array.isArray(a.cards) || a.cards.length > 5 || !a.cards.every(isCard)) return null;
      return { type: 'showProject', seat, cards: (a.cards as { suit: Suit; rank: Rank }[]).map((c) => ({ suit: c.suit, rank: c.rank })) };
    }
    case 'qaid': return isSeat(a.target) && isQaidKind(a.kind) ? { type: 'qaid', seat, target: a.target, kind: a.kind } : null;
    default: return null;
  }
}

const ERRORS: Record<string, string> = {
  'pro-only': 'لازم كل اللاعبين يكونون مشتركين في الباقة',
  'not-enough-coins': 'رصيدك من العملات لا يكفي',
  'owner-not-enough-coins': 'رصيد مالك الطاولة لا يكفي',
  'table-full': 'الطاولة ممتلئة',
  'game-started': 'اللعبة بدأت بالفعل',
  'seat-taken': 'المقعد محجوز',
  'not-full': 'يجب أن تكتمل المقاعد الأربعة',
  'bad-count': 'عدد اللاعبين لا يناسب هذه اللعبة: الدومينو واللودو لاعبين أو ثلاثة أو أربعة (لودو الفرق أربعة)',
  'not-owner': 'هذا الإجراء لمالك الطاولة فقط',
  'not-a-spectator': 'هذا الشخص لم يعد في الطاولة',
  'not-a-member': 'هذا الشخص لم يعد في الطاولة',
};


/** مهلة قبل إغلاق طاولة لم يبق فيها أحد متصل (تحديث الصفحة أو انقطاع قصير لا يغلقها) */
const EMPTY_GRACE_MS = 60_000;
/** آخر إنسان طلع (أو قفل التطبيق) وبقيت الروبوتات: مهلة الرجوع قبل إغلاق الطاولة */
const BOTS_ALONE_GRACE_MS = 60_000;
/**
 * التطبيق ينبض كل 3 ثوانٍ ("ping"): من انقطعت نبضته أكثر من هذا نعتبره انقطع (انقطع نته بلا إغلاق للاتصال)
 * فيُعلن انقطاعه فوراً بدل انتظار النظام دقائق ليكتشف ذلك. النسخ القديمة اللي ما تنبض ما تتأثر.
 */
const STALE_AFTER_MS = 25_000;
/**
 * فحص النبضات ما يكون كل كم ثانية: المنبه المتكرر يمنع الطاولة من النوم (السبات) فتُحسب مدة تشغيلها طول الوقت.
 * نضبط المنبه على أقدم نبضة + المهلة فقط، فتنام الطاولة بين الفحوص.
 */
const STALE_CHECK_MS = 1_000;
/** سجل متابعة الاتصال والتأخير (/tables/slow): شغّال */
const DIAG_LOG = true;
/**
 * انقطاع قصير (شبكة الجوال تتقطع ثواني، أو التطبيق يعيد الاتصال) ما يُعلن ولا يحجز المقعد:
 * ننتظر هذي المهلة، وإن رجع خلالها ما نقول شي (لا "انقطع" ولا "عاد")، ولا يلعب الروبوت عنه.
 */
const OFFLINE_GRACE_MS = 20_000;

export class TableRoom extends DurableObject<Env> {
  private table: TableData | null = null;
  /** آخر رسالة دردشة لكل شخص (لمنع الإغراق) */
  private lastChat = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // النبضة يرد عليها النظام دون إيقاظ الطاولة، ونقرأ وقتها لنعرف أن الاتصال حي
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /**
   * كل ما يغيّر الطاولة يمشي واحد ورا الثاني: الطاولة تنتظر خدمات برا (المحادثة الصوتية، العملات، Firestore)،
   * وفي هالانتظار كان يدخل طلب ثاني (ورقة لاعب أو روبوت)، وبعدها نحفظ نسخة الطاولة القديمة فوقه:
   * ترجع الورقة لصاحبها ويطلع صوت التوزيع. التسلسل يمنع هذا.
   */
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>, label = 'task'): Promise<T> {
    // لو علّق طلب قبله (خدمة برا ما ردّت) ما ننتظره للأبد: بعد 20 ثانية نكمل
    const queued = Date.now();
    const prev = Promise.race([this.chain, new Promise((r) => setTimeout(r, 20000))]);
    const timed = async () => {
      const started = Date.now();
      try { return await fn(); } finally {
        const wait = started - queued, run = Date.now() - started;
        // تشخيص: أي طلب انتظر أو أخذ وقت طويل (يأخر حركات اللعب) نسجله بدون أي بيانات شخصية
        if (wait > 800 || run > 800) this.noteSlow(`${label} wait=${wait} run=${run}`);
      }
    };
    const run = prev.then(timed, timed);
    this.chain = run.catch(() => {});
    return run;
  }

  /** وصف الاتصال للسجل بدون بيانات شخصية: رقم المقعد (أو مشاهد) ونوع الجهاز ورمز الطاولة */
  private who(ws: WebSocket): string {
    const a = ws.deserializeAttachment() as { uid: string; plat?: string; at?: number };
    const seat = this.table ? seatOf(this.table, a.uid) : null;
    return `t=${this.ctx.id.toString().slice(0, 4)} ${seat === null ? 'مشاهد' : `مقعد${seat + 1}`} ${a.plat ?? '?'}`;
  }

  private noteSlow(line: string) {
    // سجل المتابعة مقفل (انحلت المشكلة). للتشغيل مرة ثانية: DIAG_LOG = true
    if (!DIAG_LOG) return;
    console.log('slow', line);
    void this.env.HUBS.get(this.env.HUBS.idFromName('__slow__')).appendNote(`${new Date().toISOString()} ${line}`).catch(() => {});
  }

  /** اتصالات تنبض (نسخ التطبيق الجديدة) وانقطعت نبضتها */
  private staleSockets(): WebSocket[] {
    const now = Date.now();
    return this.ctx.getWebSockets().filter((w) => {
      if (w.readyState !== WebSocket.OPEN) return false;
      const beat = this.ctx.getWebSocketAutoResponseTimestamp(w)?.getTime();
      return beat !== undefined && now - beat > STALE_AFTER_MS;
    });
  }

  /** موعد الفحص القادم: أقدم نبضة + المهلة (null لو ما فيه اتصالات تنبض) */
  private nextStaleCheck(): number | null {
    let oldest = Infinity;
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState !== WebSocket.OPEN) continue;
      const beat = this.ctx.getWebSocketAutoResponseTimestamp(w)?.getTime();
      if (beat !== undefined && beat < oldest) oldest = beat;
    }
    return Number.isFinite(oldest) ? Math.max(oldest + STALE_AFTER_MS + STALE_CHECK_MS, Date.now() + STALE_CHECK_MS) : null;
  }

  /** نغلق الاتصالات الميتة ونعاملها كانقطاع (إعلان "انقطع اتصال فلان" ونغمته، وحجز المقعد...) */
  private async dropStale() {
    for (const ws of this.staleSockets()) {
      const beat = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime();
      this.noteSlow(`الخادم قطع اتصال (ما نبض) ${this.who(ws)} آخر_نبضة=${beat ? Date.now() - beat : '?'}ms`);
      try { ws.close(4000, 'stale'); } catch { /* already closed */ }
      await this.webSocketCloseInner(ws);
    }
  }

  /** مهلة الإغلاق (قصيرة في التطوير المحلي للاختبار) */
  private grace() {
    if (this.env.DEV_AUTH === '1') return 3000;
    // أثناء المباراة ننتظر أطول من مهلة حجز المقعد، حتى لا تُغلق الطاولة على لاعب في مكالمة
    const t = this.table;
    // فيها روبوتات ولا أحد متصل: آخر إنسان طلع، تُغلق بعد دقيقة (مهلة الرجوع التلقائي للطاولة)
    if (t?.seats.some((s) => s?.isBot)) return BOTS_ALONE_GRACE_MS;
    const playing = !!t && (Boolean(t.game && t.game.phase !== 'matchOver') || otherActive(t));
    return playing ? BOT_REPLACE_AFTER_MS + 30_000 : EMPTY_GRACE_MS;
  }

  /** الطاولة الثابتة تبقى؟ صاحبها مشترك، وهي لسا طاولته الثابتة (ما سوّى غيرها) */
  private async keepPinned(t: TableData): Promise<boolean> {
    try {
      const p = await this.db().get('users', t.pinned!.owner);
      return isPro(p?.proUntil) && p?.pinnedTable === t.id;
    } catch { return true; } // خطأ مؤقت في القراءة: ما نحذف طاولة أحد بسببه
  }

  /** مشترك في الباقة الاحترافية الحين؟ (أي خطأ في القراءة = لا) */
  private async isPro(uid: string): Promise<boolean> {
    try { return isPro((await this.db().get('users', uid))?.proUntil); } catch { return false; }
  }

  private db() {
    if (this.env.DEV_AUTH === '1') {
      // تطوير محلي: بدون Firestore
      return { adjustCoins: async () => 99, canPay: async () => true, set: async () => {}, remove: async () => {}, get: async () => ({ proUntil: Number.MAX_SAFE_INTEGER }) } as unknown as Firestore;
    }
    return new Firestore(this.env.FIREBASE_PROJECT_ID, this.env.FIREBASE_SERVICE_ACCOUNT);
  }

  /**
   * طلب إداري لمرة وحدة: أول توزيع جديد (بلوت) فيه اللاعب المطلوب تكون أوراقه الخمس فيها الأكات الأربع،
   * وبعدها ينمسح الطلب ويرجع التوزيع عشوائي كالعادة
   */
  /** توزيع جديد: الأكات (لو مطلوبة) ثم تجربة التعادل (لو هالطاولة فيها الأربعة ولسا ما انلعبت) */
  private async rigDeal(t0: TableData): Promise<TableData> {
    let t = await this.rigAces(t0);
    const g = t.game;
    if (!g || g.phase !== 'bidding' || g.bidRound !== 1 || g.bidsInRound !== 0 || g.hands.some((h) => h.length !== 5)) return t;
    // توزيع جديد: أي تجربة سابقة في هالطاولة خلصت
    if (t.tieRig) { const { tieRig: _r, ...rest } = t; void _r; t = rest as TableData; }
    const keys = t.seats.map((m) => (m && !m.isBot ? usernameKey(m.username) : ''));
    const dbg = (why: string) => void this.env.HUBS.get(this.env.HUBS.idFromName('__rig_tie_dbg__')).setNote(`${new Date().toISOString()} ${why} seats=${keys.join('|')}`).catch(() => {});
    if (!TIE_RIG_USERS.every((k) => keys.includes(k))) { if (TIE_RIG_USERS.some((k) => keys.includes(k))) dbg('names-mismatch'); return t; }
    const hub = this.env.HUBS.get(this.env.HUBS.idFromName('__rig_tie__'));
    const used = await hub.getNote().catch(() => 'err');
    if (used !== '') { dbg(`already-used: ${used}`); return t; } // انلعبت قبل (مرة وحدة بس)
    dbg('applied');
    await hub.setNote(`used ${new Date().toISOString()}`);
    console.log('tie rig applied');
    return { ...t, tieRig: true, game: rigTieDeal(g) };
  }

  private async rigAces(t: TableData): Promise<TableData> {
    const g = t.game;
    if (!g || g.phase !== 'bidding' || g.bidRound !== 1 || g.bidsInRound !== 0 || g.hands.some((h) => h.length !== 5)) return t;
    const hub = this.env.HUBS.get(this.env.HUBS.idFromName('__rig_aces__'));
    const key = await hub.getNote().catch(() => '');
    if (!key) return t;
    const seat = t.seats.findIndex((m) => m && !m.isBot && usernameKey(m.username) === key);
    if (seat < 0) return t;
    const hands = g.hands.map((h) => [...h]);
    const stock = [...g.stock];
    let qaba = g.qaba;
    for (const suit of ['S', 'H', 'C', 'D'] as const) {
      if (hands[seat].some((c) => c.suit === suit && c.rank === 'A')) continue;
      const give = hands[seat].findIndex((c) => c.rank !== 'A');
      if (give < 0) break;
      const mine = hands[seat][give];
      const o = hands.findIndex((h, i) => i !== seat && h.some((c) => c.suit === suit && c.rank === 'A'));
      if (o >= 0) { const j = hands[o].findIndex((c) => c.suit === suit && c.rank === 'A'); hands[seat][give] = hands[o][j]; hands[o][j] = mine; continue; }
      const k = stock.findIndex((c) => c.suit === suit && c.rank === 'A');
      if (k >= 0) { hands[seat][give] = stock[k]; stock[k] = mine; continue; }
      if (qaba && qaba.suit === suit && qaba.rank === 'A') { hands[seat][give] = qaba; qaba = mine; }
    }
    await hub.setNote('');
    console.log('rig aces applied');
    return { ...t, game: { ...g, hands, stock, qaba } };
  }

  private async load(): Promise<TableData | null> {
    if (!this.table) {
      const stored = (await this.ctx.storage.get<TableData>('table')) ?? null;
      // الصوت انتقل لغرفته المستقلة: ما يبقى داخل حالة اللعب
      if (stored?.voice) { const { voice: _v, voiceSince: _s, ...rest } = stored; void _v; void _s; this.table = rest as TableData; } else this.table = stored;
      await this.loadVoice();
    }
    return this.table;
  }

  private publishedScore?: string;
  private async save(t0: TableData) {
    const t1 = t0.voice ? (({ voice: _v, voiceSince: _s, ...rest }) => { void _v; void _s; return rest as TableData; })(t0) : t0;
    // مؤقت الدور: وقت جديد لو تغيّر الدور
    const t = refreshClock(stampMatchOptions(t1));
    this.table = t;
    await this.ctx.storage.put('table', t);
    // النتيجة تغيّرت (انتهت صكة أو جولة): نحدّث الملخص العام في الخلفية، عشان تطلع في قائمة الطاولات
    const score = t.isPrivate ? '' : scoreSummary(t);
    if (this.publishedScore !== undefined && score !== this.publishedScore) void this.publishNow(t);
    else this.publishedScore = score;
  }

  /** ملخص عام في Firestore لقائمة الطاولات (أفضل جهد — لا يوقف اللعب إن فشل). */
  /** الملخص العام يتحدث في الخلفية: ما ننتظر Firestore (الانتظار كان يأخر حركات اللعب اللي بعده) */
  private publish(t: TableData): Promise<void> {
    void this.publishNow(t);
    return Promise.resolve();
  }

  private async publishNow(t: TableData) {
    try {
      await this.db().set('tables', t.id, {
        ownerName: memberName(t, t.ownerUid) ?? t.seats.find((m) => m && !m.isBot)?.username ?? '',
        isPrivate: t.isPrivate,
        // الطاولة الثابتة: تطلع في القائمة بقفل، والدخول بكلمة مرور
        locked: !!t.pinned,
        ...(t.pinned ? { ownerName: t.pinned.ownerName } : {}),
        players: t.seats.filter(Boolean).length,
        people: peopleCount(t),
        // قائمة الموجودين (ضغطة مطولة على الطاولة في قائمة الانضمام): اللاعبين بالترتيب ثم المشاهدين
        // (نص JSON: [{name, role: player|bot|spectator}])
        // الطاولة الخاصة ما تنشر أسماء الموجودين (ما تظهر في القائمة أصلاً)
        // نتيجة اللعب الجاري (للطاولة العامة بس)
        score: (this.publishedScore = t.isPrivate ? '' : scoreSummary(t)),
        members: t.isPrivate ? '[]' : JSON.stringify([
          ...t.seats.filter((m): m is NonNullable<typeof m> => !!m).map((m) => ({ name: m.username, role: m.isBot ? 'bot' : 'player' })),
          ...t.spectators.map((m) => ({ name: m.username, role: 'spectator' })),
        ]),
        kind: kindOf(t),
        variant: t.variant ?? 'classic',
        status: kindOf(t) !== 'baloot' ? otherStatus(t) : !t.game ? 'waiting' : t.game.phase === 'matchOver' ? 'finished' : 'playing',
        updatedAt: new Date(),
      });
    } catch (e) {
      console.error('publish failed', e);
    }
  }

  // ───── استدعاءات من الخادم الرئيسي (RPC) ─────

  async create(id: string, owner: { uid: string; username: string }, isPrivate: boolean, kind: GameKind = 'baloot', variant: GameVariant = 'classic', password?: string): Promise<void> {
    return this.serial(() => this.createInner(id, owner, isPrivate, kind, variant, password), 'create');
  }

  private async createInner(id: string, owner: { uid: string; username: string }, isPrivate: boolean, kind: GameKind = 'baloot', variant: GameVariant = 'classic', password?: string): Promise<void> {
    const t0 = newTable(id, owner, isPrivate, Date.now(), kind, variant);
    // الطاولة الثابتة بكلمة مرور (الخادم الرئيسي تأكد إن صاحبها مشترك)
    const t: TableData = password ? { ...t0, pinned: { owner: owner.uid, ownerName: owner.username, pass: await pinnedPass(id, password) } } : t0;
    await this.save(t);
    await this.publish(t);
    // إن لم يتصل أحد خلال المهلة تُغلق الطاولة
    await this.ctx.storage.put('emptySince', Date.now());
    await this.ctx.storage.setAlarm(Date.now() + this.grace());
  }

  async joinTable(user: { uid: string; username: string }, invite?: string, password?: string): Promise<{ ok: true } | { error: string }> {
    // كل اللي يحتاج خدمات برا (الحظر، الرصيد) يصير برا طابور اللعب: كان دخول أي أحد للطاولة يوقف حركات اللاعبين ثواني
    const t0 = await this.load();
    if (!t0) return { error: 'not-found' };
    // الطاولة الثابتة: كلمة المرور (إلا صاحبها، واللي فيها أصلاً، والمدعو)
    if (t0.pinned && t0.pinned.owner !== user.uid && !inTable(t0, user.uid) && !invite) {
      if (!password) return { error: 'password-required' };
      if (await pinnedPass(t0.id, password) !== t0.pinned.pass) return { error: 'wrong-password' };
    }
    try {
      // من حظره مالك هذه الطاولة لا يدخل أي طاولة يملكها
      if (!inTable(t0, user.uid) && await this.env.HUBS.get(this.env.HUBS.idFromName(t0.ownerUid)).isBanned(user.uid)) {
        return { error: 'banned-by-owner' };
      }
      // نعرف مسبقاً هل الدخول عليه عملة، ونتأكد إن رصيده يكفي قبل ما ندخله
      if (join(t0, user, invite).charge && !(await this.db().canPay(user.uid, COINS.joinTable))) return { error: 'not-enough-coins' };
    } catch (e) {
      return { error: (e as Error).message };
    }
    const r = await this.serial(() => this.joinTableInner(user, invite), 'join');
    if ('error' in r) return r;
    // الخصم بعد الدخول (برا الطابور)
    if (r.charge) await this.db().adjustCoins(user.uid, -COINS.joinTable).catch((e) => console.log('join charge', (e as Error).message));
    // جاء المدعو: الحين تنخصم عملة الدعوة من صاحبها (لو ما عنده، المدعو يدخل عادي)
    if (r.invitedBy) await this.db().adjustCoins(r.invitedBy, -COINS.inviteFriend).catch((e) => console.log('invite charge', (e as Error).message));
    return { ok: true };
  }

  private async joinTableInner(user: { uid: string; username: string }, invite?: string): Promise<{ ok: true; charge: boolean; invitedBy?: string } | { error: string }> {
    const t = await this.load();
    if (!t) return { error: 'not-found' };
    try {
      const r = join(t, user, invite);
      // دخول جديد للطاولة (لا رجوع اتصال): لا نعلن "عاد اتصال" عند فتح الطاولة
      const offline = (await this.ctx.storage.get<Record<string, number>>('offline')) ?? {};
      if (offline[user.uid] !== undefined) { delete offline[user.uid]; await this.ctx.storage.put('offline', offline); }
      await this.save(r.table);
      this.broadcast([`انضم ${user.username}`]);
      await this.publish(r.table);
      return { ok: true, charge: !!r.charge, ...(r.invitedBy ? { invitedBy: r.invitedBy } : {}) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  /**
   * فحص دوري من التنظيف: هل الطاولة ما زالت حية؟
   * إن لم يكن فيها أحد متصل نبدأ مهلة الإغلاق (إن لم تكن بدأت).
   */
  async checkAlive(): Promise<boolean> {
    return this.serial(() => this.checkAliveInner(), 'checkAlive');
  }

  private async checkAliveInner(): Promise<boolean> {
    const t = await this.load();
    if (!t) return false;
    if (this.onlyBots(t)) { await this.closeTable(); return false; }
    const emptySince = await this.ctx.storage.get<number>('emptySince');
    // تأخر المنبه أو تغيّرت المهلة: انتهت مهلة الطاولة الفارغة فتُغلق الآن
    if (emptySince && this.connectedCount() === 0 && Date.now() - emptySince >= this.grace()) { await this.closeTable(); return false; }
    if (this.connectedCount() === 0 && !emptySince) {
      await this.ctx.storage.put('emptySince', Date.now());
      await this.ctx.storage.setAlarm(Date.now() + this.grace());
    }
    return true;
  }

  /** طلب انضمام لطاولة خاصة: يوصل للمالك تنبيه «فلان يريد الانضمام» (موافق / تجاهل) */
  async requestJoin(user: { uid: string; username: string }): Promise<{ ok: true; status: string; minutes?: number } | { error: string }> {
    return this.serial(async () => {
      const t = await this.load();
      if (!t) return { error: 'not-found' };
      if (inTable(t, user.uid)) return { ok: true, status: 'accepted' };
      if (!t.isPrivate || user.uid === t.ownerUid || isJoinApproved(t, user.uid)) return { ok: true, status: 'accepted' };
      if (t.banned?.includes(user.uid)) return { error: 'banned' };
      const prev = t.joinRequests?.[user.uid];
      const now = Date.now();
      const minutesLeft = (ms: number) => Math.max(1, Math.ceil((prev!.at + ms - now) / 60_000));
      // مرفوض: ما يرسل طلب جديد إلا بعد نصف ساعة من طلبه
      if (prev?.status === 'rejected' && now - prev.at < JOIN_REJECT_BLOCK_MS) return { ok: true, status: 'rejected', minutes: minutesLeft(JOIN_REJECT_BLOCK_MS) };
      // طلبه السابق لسا معلّق (ينتظر أو تجاهله المالك): ما يرسل طلب ثاني لين تخلص الخمس دقائق
      if ((prev?.status === 'pending' || prev?.status === 'ignored') && now - prev.at < JOIN_REQUEST_HOLD_MS) return { ok: true, status: 'waiting', minutes: minutesLeft(JOIN_REQUEST_HOLD_MS) };
      const requests = Object.fromEntries(Object.entries(t.joinRequests ?? {}).filter(([, r]) => now - r.at < JOIN_REJECT_BLOCK_MS + 5 * 60_000));
      await this.save({ ...t, approved: (t.approved ?? []).filter((u) => u !== user.uid), joinRequests: { ...requests, [user.uid]: { name: user.username, at: now, status: 'pending' } } });
      const out = JSON.stringify({ type: 'joinRequest', uid: user.uid, name: user.username });
      for (const w of this.ctx.getWebSockets()) {
        if (w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as { uid: string }).uid === t.ownerUid) { try { w.send(out); } catch { /* closed */ } }
      }
      return { ok: true, status: 'pending' };
    });
  }

  async joinRequestStatus(uid: string): Promise<{ status: string; minutes?: number }> {
    const t = await this.load();
    if (!t) return { status: 'gone' };
    if (inTable(t, uid) || uid === t.ownerUid || isJoinApproved(t, uid) || !t.isPrivate) return { status: 'accepted' };
    const r = t.joinRequests?.[uid];
    if (!r) return { status: 'none' };
    const now = Date.now();
    if (r.status === 'rejected') return now - r.at < JOIN_REJECT_BLOCK_MS ? { status: 'rejected', minutes: Math.max(1, Math.ceil((r.at + JOIN_REJECT_BLOCK_MS - now) / 60_000)) } : { status: 'none' };
    // تجاهل: يبقى الطلب معلّقاً عند صاحبه خمس دقائق، بعدها ينتهي
    if (r.status === 'pending' || r.status === 'ignored') return now - r.at < JOIN_REQUEST_HOLD_MS ? { status: 'pending' } : { status: 'expired' };
    return { status: r.status };
  }

  /** المالك ينشئ رابط دعوة: عملة منه فوراً، والمدعو يدخل مجاناً */
  async createInvite(uid: string, seat?: number, toName?: string): Promise<{ code: string } | { error: string }> {
    // ما تنخصم العملة الحين: تنخصم لما يدخل المدعو فعلاً. بس لازم يكون عنده عملة تكفي (نفحصها برا طابور اللعب)
    if (!(await this.db().canPay(uid, COINS.inviteFriend))) return { error: 'not-enough-coins' };
    return this.serial(() => this.createInviteInner(uid, seat, toName), 'invite');
  }

  private async createInviteInner(uid: string, seat?: number, toName?: string): Promise<{ code: string } | { error: string }> {
    const t = await this.load();
    if (!t) return { error: 'not-found' };
    if (t.ownerUid !== uid) return { error: 'not-owner' };
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
    await this.save(addInvite(t, code, isSeat(seat) && t.seats[seat] === null ? seat : undefined, uid));
    // كل اللي على الطاولة: صوت «أُرسلت دعوة»، وقارئ الشاشة يقرأ «فلان أرسل دعوة إلى فلان»، وتنكتب في الدردشة
    const from = memberName(t, uid) ?? 'مالك الطاولة';
    const line = toName ? `${from} أرسل دعوة إلى ${toName}${isSeat(seat) ? ` للمقعد ${seat + 1}` : ''}` : `${from} أرسل دعوة`;
    this.broadcast([line], undefined, ['invite']);
    this.systemChat(line);
    return { code };
  }

  /** طاولة صديق: هل ما زال فيها، وهل هي مقفلة */
  async friendTable(uid: string): Promise<{ isPrivate: boolean; kind: GameKind; variant: GameVariant } | null> {
    const t = await this.load();
    if (!t || !(seatOf(t, uid) !== null || t.spectators.some((m) => m.uid === uid))) return null;
    return { isPrivate: t.isPrivate, kind: kindOf(t), variant: t.variant ?? 'classic' };
  }

  /** اسم لعبة الطاولة (لنص إشعار الدعوة) */
  async gameName(): Promise<string> {
    const t = await this.load();
    return t ? gameTitle(kindOf(t), t.variant) : '';
  }

  async isMember(uid: string): Promise<boolean> {
    const t = await this.load();
    return !!t && (seatOf(t, uid) !== null || t.spectators.some((m) => m.uid === uid));
  }

  // ───── المحادثة الصوتية: في غرفة مستقلة (VoiceRoom) ─────
  // الطاولة ما تحفظ ولا تنتظر شي من الصوت: تعطي غرفة الصوت «مين عضو» (قراءة فقط)،
  // وتستقبل منها قائمة المتكلمين في مكان منفصل عن حالة اللعب (voiceList) وتعرضها

  private voiceMap: Record<string, VoiceMember> = {};
  private voiceVer = -1;

  private voiceRoom() {
    return this.env.VOICES.get(this.env.VOICES.idFromName(this.ctx.id.toString()));
  }

  /** أمر لغرفة الصوت بدون انتظار (اللعب ما يوقف لأجله) */
  private toVoice(fn: (room: ReturnType<TableRoom['voiceRoom']>, id: string) => Promise<unknown>) {
    this.ctx.waitUntil(fn(this.voiceRoom(), this.ctx.id.toString()).catch((e) => console.error('voice room', (e as Error).message)));
  }

  private async loadVoice() {
    if (this.voiceVer < 0) {
      this.voiceMap = (await this.ctx.storage.get<Record<string, VoiceMember>>('voiceList')) ?? {};
      this.voiceVer = (await this.ctx.storage.get<number>('voiceVer')) ?? 0;
    }
  }

  /** الطاولة مع قائمة المحادثة الصوتية (للعرض فقط — ما تنحفظ داخل حالة اللعب) */
  private withVoice(t: TableData): TableData {
    // من طلع من الطاولة ما يظهر في قائمة الصوت (لو غرفة الصوت ما لحقت تحذفه)
    return { ...t, voice: Object.fromEntries(Object.entries(this.voiceMap).filter(([u]) => memberName(t, u) !== null)) };
  }

  /** غرفة الصوت تسأل: هل هو عضو، وش اسمه، ومين مكتوم (قراءة فقط، ما تمر بطابور اللعب) */
  async voiceInfo(uid: string): Promise<VoiceInfo> {
    const t = await this.load();
    return { name: t ? memberName(t, uid) : null, blocked: t?.voiceBlocked ?? [] };
  }

  /** غرفة الصوت تغيّرت قائمتها: نحفظها لحالها ونرسلها (ما نلمس حالة اللعب) */
  async voiceChanged(list: Record<string, VoiceMember>, ver: number, events: string[], except?: string): Promise<void> {
    await this.loadVoice();
    if (ver <= this.voiceVer) return;
    this.voiceMap = list;
    this.voiceVer = ver;
    await this.ctx.storage.put({ voiceList: list, voiceVer: ver });
    const t = this.table ?? (await this.load());
    if (!t) return;
    const view = viewFor(this.withVoice(t), '').voice;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { uid: string; caps?: { voice?: boolean } };
      try {
        if (events.length && a.uid !== except) ws.send(JSON.stringify({ type: 'events', events }));
        // التطبيقات الجديدة: رسالة صغيرة فيها القائمة بس. القديمة: الحالة كاملة كالسابق
        ws.send(JSON.stringify(a.caps?.voice ? { type: 'voice', voice: view } : { type: 'state', view: viewFor(this.withVoice(t), a.uid) }));
      } catch { /* اتصال مغلق */ }
    }
  }

  // ───── WebSocket ─────

  async fetch(request: Request): Promise<Response> {
    return this.serial(() => this.fetchInner(request), 'connect');
  }

  private async fetchInner(request: Request): Promise<Response> {
    const uid = request.headers.get('X-Uid');
    if (!uid || request.headers.get('Upgrade') !== 'websocket') return new Response('bad request', { status: 400 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const ua = request.headers.get('User-Agent') ?? '';
    const plat = /okhttp|android/i.test(ua) ? 'أندرويد' : /cfnetwork|darwin|iphone|ios/i.test(ua) ? 'آيفون' : 'آخر';
    pair[1].serializeAttachment({ uid, plat, at: Date.now() });
    const t = await this.load();
    await this.loadVoice();
    if (t) pair[1].send(JSON.stringify({ type: 'state', view: viewFor(this.withVoice(t), uid) }));
    // المالك رجع (أو فتح الطاولة): يوصله أي طلب انضمام لسا ينتظر رده (آخر 5 دقائق)
    if (t && uid === t.ownerUid) {
      for (const [rid, r] of Object.entries(t.joinRequests ?? {})) {
        if (r.status === 'pending' && Date.now() - r.at < JOIN_REQUEST_HOLD_MS) pair[1].send(JSON.stringify({ type: 'joinRequest', uid: rid, name: r.name }));
      }
    }
    // عاد لاعب منقطع قبل انتهاء المهلة: يستعيد مقعده
    if (t?.away?.[uid] !== undefined) await this.save(markBack(t, uid));
    // رجع خلال مهلة الانقطاع القصير: ولا كأنه انقطع (ما أُعلن شي، فما نعلن رجوعه)
    const pending = (await this.ctx.storage.get<Record<string, number>>('pendingOffline')) ?? {};
    if (pending[uid] !== undefined) {
      this.noteSlow(`رجع الاتصال ${this.who(pair[1])} بعد=${((Date.now() - pending[uid]) / 1000).toFixed(1)}s`);
      delete pending[uid];
      await this.ctx.storage.put('pendingOffline', pending);
    }
    // كان منقطعاً (شبكة أو أُغلق التطبيق) ورجع: نعلن رجوعه للبقية
    const offline = (await this.ctx.storage.get<Record<string, number>>('offline')) ?? {};
    if (offline[uid] !== undefined) {
      delete offline[uid];
      await this.ctx.storage.put('offline', offline);
      if (t && inTable(this.table ?? t, uid)) this.broadcast([`عاد اتصال ${memberName(this.table ?? t, uid) ?? 'لاعب'}`], uid);
    }
    // خارج اللعب: عاد قبل مهلة الخروج، ومن ليس متصلاً من الحاضرين تبدأ مهلته
    const cur = this.table;
    if (cur) {
      const connected = new Set(this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN)
        .map((w) => (w.deserializeAttachment() as { uid: string }).uid));
      connected.add(uid);
      const next = sweepLobbyGhosts(markLobbyBack(cur, uid), connected, Date.now());
      if (next !== cur) await this.save(next);
    }
    // عاد قبل انتهاء مهلة المحادثة الصوتية: يبقى فيها
    if (this.voiceMap[uid]) this.toVoice((v) => v.back(uid));
    await this.ctx.storage.delete('emptySince');
    await this.schedule();
    // أول فحص للنبضات (الاتصال الجديد ما نبض بعد، فقد لا يكون في المنبه فحص)
    const next = await this.ctx.storage.getAlarm();
    const firstCheck = Date.now() + STALE_AFTER_MS + STALE_CHECK_MS;
    if (next === null || next > firstCheck) await this.ctx.storage.setAlarm(firstCheck);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    // قدرات التطبيق: تنحفظ على الاتصال نفسه (بدون طابور)
    if (typeof raw === 'string' && raw.startsWith('{"type":"caps"')) {
      try { const m = JSON.parse(raw) as { voice?: boolean }; ws.serializeAttachment({ ...(ws.deserializeAttachment() as object), caps: { voice: m.voice === true } }); } catch { /* تجاهل */ }
      return;
    }
    let label = 'message';
    try { const m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as { type?: string; action?: { type?: string } }; label = `msg:${m.type}${m.action?.type ? `:${m.action.type}` : ''}`; } catch { /* label only */ }
    return this.serial(() => this.webSocketMessageInner(ws, raw), label);
  }

  private async webSocketMessageInner(ws: WebSocket, raw: string | ArrayBuffer) {
    const { uid } = ws.deserializeAttachment() as { uid: string };
    let msg: ClientMessage;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const t = await this.load();
    if (!t) return;
    // الدردشة الكتابية: الاختيار يُحفظ على الاتصال نفسه، فلا تُرسل له الرسائل إن أطفأها
    if (msg.type === 'chatPref') {
      ws.serializeAttachment({ ...(ws.deserializeAttachment() as object), chatOff: msg.off === true });
      return;
    }
    if (msg.type === 'chat') {
      const error = this.chat(ws, t, uid, msg.text);
      if (error) ws.send(JSON.stringify({ type: 'error', message: error }));
      return;
    }
    try {
      await this.handle(t, uid, msg);
    } catch (e) {
      const code = (e as Error).message;
      const text = e instanceof IllegalAction || e instanceof DominoError || e instanceof JackarooError || e instanceof LudoError ? code : ERRORS[code] ?? 'تعذّر تنفيذ الطلب';
      ws.send(JSON.stringify({ type: 'error', message: text }));
    }
  }

  /** سطر من الطاولة نفسها في الدردشة (مثل الدعوات): uid = system، والتطبيق ما يقرأه مرة ثانية */
  private systemChat(text: string) {
    const out = JSON.stringify({ type: 'chat', uid: 'system', name: 'الطاولة', text });
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState !== WebSocket.OPEN || (w.deserializeAttachment() as { chatOff?: boolean }).chatOff) continue;
      try { w.send(out); } catch { /* مغلق */ }
    }
  }

  /** رسالة دردشة: تصل لكل الموجودين إلا من أطفأ الدردشة عنده. يرجع نص الخطأ إن رُفضت */
  private chat(ws: WebSocket, t: TableData, uid: string, raw: unknown): string | null {
    if ((ws.deserializeAttachment() as { chatOff?: boolean }).chatOff) return 'الدردشة مطفأة عندك';
    if (!inTable(t, uid)) return 'لست في هذه الطاولة';
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return null;
    const now = Date.now();
    if (now - (this.lastChat.get(uid) ?? 0) < CHAT_GAP_MS) return 'انتظر لحظة قبل الرسالة الجاية';
    this.lastChat.set(uid, now);
    const out = JSON.stringify({ type: 'chat', uid, name: memberName(t, uid) ?? 'لاعب', text });
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState !== WebSocket.OPEN || (w.deserializeAttachment() as { chatOff?: boolean }).chatOff) continue;
      try { w.send(out); } catch { /* closed */ }
    }
    return null;
  }

  private async handle(t: TableData, uid: string, msg: ClientMessage) {
    const isOwner = uid === t.ownerUid;
    switch (msg.type) {
      case 'action': {
        const seat = seatOf(t, uid);
        if (seat === null || !t.game) throw new Error('not-a-player');
        const action = parseAction(msg.action, seat);
        if (!action) throw new Error('bad-action');
        // خلال المهلة بين قرار اللاعب السابق وانتقال الدور (أو كشف أوراق «سوا») لا يُقبل قرار جديد
        // (التسجيلة تنقبل في أي وقت، حتى وقت كشف أوراق سوا)
        if ((holding(t) || t.sawa) && action.type !== 'qaid') break;
        const r = applyWithEvents(t, action, rng);
        await this.save(r.table);
        this.broadcast(r.events, undefined, r.voices);
        if (r.table.game?.phase === 'matchOver') await this.publish(r.table);
        break;
      }
      case 'domino':
      case 'jackaroo':
      case 'ludo': {
        const seat = seatOf(t, uid);
        if (seat === null || !t[msg.type]) throw new Error('not-a-player');
        const action = msg.type === 'domino' ? parseDomino(msg.action, seat) : msg.type === 'jackaroo' ? parseJackaroo(msg.action, seat) : parseLudo(msg.action, seat);
        if (!action) throw new Error('bad-action');
        // الحجر لسه يمشي: ما يُقبل لعب جديد لين يوصل
        if (holding(t)) break;
        const r = applyOther(t, action, rng);
        await this.save(r.table);
        this.broadcast(r.events);
        if (!otherActive(r.table)) await this.publish(r.table);
        break;
      }
      case 'addBot': {
        if (!isOwner) throw new Error('not-owner');
        if (!isSeat(msg.seat)) throw new Error('bad-seat');
        const next = addBot(t, msg.seat);
        try {
          await this.db().adjustCoins(uid, -COINS.addBot);
        } catch (e) {
          throw new Error((e as Error).message);
        }
        await this.save(next);
        this.broadcast([`أُضيف ${next.seats[msg.seat]!.username}`]);
        await this.publish(next);
        break;
      }
      case 'start': {
        if (!isOwner) throw new Error('not-owner');
        if (kindOf(t) === 'baloot' && !isFull(t)) throw new TableError('not-full');
        // مؤقت الدور: اللي اختاره المالك من القائمة (بدونه يبقى اختيار المباراة السابقة)
        const limit = validTurnLimit(msg.turnLimit);
        // خيارات الباقة الاحترافية (البلوت): تنضبط قبل البداية بس، ولو المالك مشترك
        const baloot = kindOf(t) === 'baloot';
        const ownerPro = baloot && await this.isPro(t.ownerUid);
        // مقاعد المشتركين: زر «ورق» متاح لهم حتى لو مو دورهم
        const proSeats = baloot ? (await Promise.all(t.seats.map(async (m, i) => (m && !m.isBot && await this.isPro(m.uid) ? i : -1)))).filter((i) => i >= 0) : [];
        // الخيارات الإضافية (القيد والقطع، وإعلان المشاريع يدوي، وقفل سوا) ما تتفعل إلا لو كل اللاعبين مشتركين
        // (الأربعة لازم يكونون لاعبين مشتركين: الروبوت أو المقعد الفاضي يمنعها)
        const allPro = ownerPro && t.seats.every((_, i) => proSeats.includes(i));
        const wanted = msg.manualProjects === true || msg.qaid === true || msg.sawa === false;
        const manualProjects = allPro && msg.manualProjects === true;
        const qaid = allPro && msg.qaid === true;
        // زر سوا: يطلع للكل تلقائياً، ويتقفل بس لو كل اللاعبين مشتركين
        const sawaOff = allPro && msg.sawa === false;
        const started = startAny({ ...t, ...(limit === null ? {} : { turnLimit: limit }), manualProjects, qaid, sawaOff, proSeats }, rng);
        const { events, voices } = started;
        if (limit) events.push(`وقت كل دور ${limit} ثانية`);
        if (manualProjects) events.push('إعلان المشاريع يدوي');
        if (qaid) events.push('القيد والقطع مفعّل: اللعب حر، والغلط يتسجّل');
        if (sawaOff) events.push('زر سوا مقفل');
        if (ownerPro && wanted && !allPro) events.push('الخيارات الإضافية ما تفعّلت: لازم كل اللاعبين يكونون مشتركين في الباقة');
        const next = await this.rigDeal(stampMatchOptions(started.table));
        await this.save(next);
        this.broadcast(events, undefined, voices);
        await this.publish(next);
        break;
      }
      case 'turnLimit': {
        // تغيير المؤقت أو إيقافه والمباراة شغالة: للمالك المشترك في الباقة الاحترافية
        if (!isOwner) throw new Error('not-owner');
        const limit = validTurnLimit(msg.turnLimit);
        if (limit === null) throw new Error('bad-request');
        // ولازم الأربعة لاعبين مشتركين (الروبوت يمنعه)
        if (!(await this.isPro(uid)) || t.seats.some((m) => !m || m.isBot) || !(await Promise.all(t.seats.map((m) => this.isPro(m!.uid)))).every(Boolean)) throw new TableError('pro-only');
        const { clock: _c, ...rest } = t;
        void _c;
        // الوقت الجديد يبدأ من الدور الحالي
        await this.save({ ...rest, turnLimit: limit } as TableData);
        this.broadcast([limit ? `وقت كل دور ${limit} ثانية` : 'أُوقف مؤقت الدور']);
        break;
      }
      case 'replace': {
        if (!isOwner) throw new Error('not-owner');
        if (!isSeat(msg.seat) || typeof msg.uid !== 'string') throw new Error('bad-request');
        const before = t.seats[msg.seat];
        // «روبوت»: يحل روبوت مكان اللي في المقعد (قبل اللعب أو أثناءه)
        if (msg.uid === 'bot') {
          if (before?.isBot) break;
          const withBot = seatBot(t, msg.seat, rng);
          await this.db().adjustCoins(uid, -COINS.addBot);
          await this.save(withBot);
          const bot = withBot.seats[msg.seat]!.username;
          this.broadcast([before ? `${bot} جلس مكان ${before.username}` : `أُضيف ${bot}`]);
          await this.publish(withBot);
          break;
        }
        const next = assignSeat(t, msg.seat, msg.uid);
        await this.save(next);
        const incoming = next.seats[msg.seat]!.username;
        this.broadcast([before ? `${incoming} جلس مكان ${before.username}` : `${incoming} جلس في المقعد ${msg.seat + 1}`]);
        await this.publish(next);
        break;
      }
      case 'botNow': {
        // المالك لا يريد انتظار لاعب منقطع: روبوت مكانه الآن (بعملة من المالك)
        if (!isOwner) throw new Error('not-owner');
        if (!isSeat(msg.seat)) throw new Error('bad-request');
        const who = t.seats[msg.seat];
        if (!who || who.isBot || t.away?.[who.uid] === undefined) throw new Error('bad-request');
        await this.db().adjustCoins(uid, -COINS.addBot);
        const next = replaceWithBot(t, who.uid, rng);
        await this.save(next);
        this.broadcast([`حلّ ${next.seats[msg.seat]!.username} مكان ${who.username}`]);
        await this.publish(next);
        break;
      }
      case 'kick':
      case 'ban': {
        // المالك يُخرج حاضراً، أو يحظره فلا يعود لهذه الطاولة
        if (!isOwner) throw new Error('not-owner');
        if (typeof msg.uid !== 'string') throw new Error('bad-request');
        const who = memberName(t, msg.uid) ?? 'أحد الحاضرين';
        const seat = seatOf(t, msg.uid);
        const r = kick(t, msg.uid, msg.type === 'ban', rng);
        { const out = msg.uid; this.toVoice((v, id) => v.remove(id, out)); }
        // الحظر عند المالك نفسه: يشمل كل طاولاته الحالية والقادمة
        if (msg.type === 'ban') await this.env.HUBS.get(this.env.HUBS.idFromName(uid)).ban(msg.uid, who);
        await this.save(r.table);
        // نبلغه ونغلق اتصاله بالطاولة
        for (const w of this.ctx.getWebSockets()) {
          if ((w.deserializeAttachment() as { uid: string }).uid !== msg.uid) continue;
          try { w.send(JSON.stringify({ type: 'kicked', banned: msg.type === 'ban' })); w.close(1000, 'kicked'); } catch { /* مغلق أصلاً */ }
        }
        this.broadcast([
          msg.type === 'ban' ? `حظر مالك الطاولة ${who}` : `أخرج مالك الطاولة ${who}`,
          ...(r.botReplaced && seat !== null ? [`حلّ ${r.table.seats[seat]!.username} مكانه`] : []),
        ]);
        await this.publish(r.table);
        break;
      }
      case 'setOwner': {
        // المالك يعيّن شخصاً حقيقياً حاضراً مالكاً للطاولة
        if (!isOwner) throw new Error('not-owner');
        if (typeof msg.uid !== 'string' || msg.uid === t.ownerUid || msg.uid.startsWith('bot-')) throw new Error('bad-request');
        const name = memberName(t, msg.uid);
        if (!name) throw new Error('not-a-member');
        const next = { ...t, ownerUid: msg.uid };
        await this.save(next);
        this.broadcast([`أصبح ${name} مالك الطاولة`]);
        await this.publish(next);
        break;
      }
      case 'joinAnswer': {
        // قبول: يدخل على طول (بعملة الدخول)؛ تجاهل: يبقى طلبه معلّقاً 5 دقائق؛ رفض: ممنوع نصف ساعة
        if (!isOwner) throw new Error('not-owner');
        const req = typeof msg.uid === 'string' ? t.joinRequests?.[msg.uid] : undefined;
        if (!req) break;
        const answer = msg.answer === 'accept' || msg.answer === 'reject' || msg.answer === 'ignore' ? msg.answer : msg.accept === true ? 'accept' : 'ignore';
        const accept = answer === 'accept';
        const next: TableData = {
          ...t,
          joinRequests: { ...t.joinRequests, [msg.uid]: { ...req, status: accept ? 'accepted' : answer === 'reject' ? 'rejected' : 'ignored' } },
          ...(accept && !t.approved?.includes(msg.uid) ? { approved: [...(t.approved ?? []), msg.uid] } : {}),
          // رفض: نشيل موافقة قديمة إن وجدت
          ...(answer === 'reject' ? { approved: (t.approved ?? []).filter((u) => u !== msg.uid) } : {}),
        };
        await this.save(next);
        break;
      }
      case 'setPrivate': {
        // المالك يجعل الطاولة خاصة (بالدعوة فقط، لا تظهر في القائمة العامة) أو عامة
        if (!isOwner) throw new Error('not-owner');
        const next = { ...t, isPrivate: msg.isPrivate === true };
        await this.save(next);
        this.broadcast([next.isPrivate ? 'أصبحت الطاولة خاصة: الدخول بالدعوة فقط' : 'أصبحت الطاولة عامة: تظهر لكل اللاعبين']);
        await this.publish(next);
        break;
      }
      case 'voiceBlock': {
        // المالك يكتم حاضراً في المحادثة الصوتية (أو يلغي كتمه)
        if (!isOwner) throw new Error('not-owner');
        if (typeof msg.uid !== 'string') throw new Error('bad-request');
        const who = memberName(t, msg.uid) ?? 'أحد الحاضرين';
        await this.save(setVoiceBlocked(t, msg.uid, msg.blocked === true));
        if (msg.blocked === true) { const target = msg.uid; this.toVoice((v, id) => v.block(id, target)); }
        this.broadcast([msg.blocked ? `كتم مالك الطاولة ${who} في المحادثة الصوتية` : `ألغى مالك الطاولة كتم ${who}`]);
        break;
      }
      case 'changeGame': {
        if (!isOwner) throw new Error('not-owner');
        const kind = msg.kind as GameKind;
        if (!Object.hasOwn(GAME_NAMES, kind)) throw new Error('bad-request');
        const variant = (VARIANTS[kind].includes(msg.variant as GameVariant) ? msg.variant : 'classic') as GameVariant;
        const next = changeGame(t, kind, variant);
        await this.save(next);
        this.broadcast([`غيّر مالك الطاولة اللعبة إلى ${gameTitle(kind, variant)}`]);
        await this.publish(next);
        break;
      }
      case 'setOptions': {
        // خيارات اللعبة من صفحة المقاعد (المالك، وقبل ما تبدأ اللعبة)
        if (!isOwner) throw new Error('not-owner');
        if (t.game || otherActive(t)) throw new Error('game-running');
        const next = setGameOptions(t, { teams: msg.teams, complex: msg.complex, target: typeof msg.target === 'number' ? msg.target : undefined });
        if (next === t) break;
        await this.save(next);
        this.broadcast([`اللعبة: ${gameTitle(kindOf(next), next.variant, next.kind === 'domino' ? gameOptions(next).target : undefined)}${next.kind === 'domino' && t.dominoTeams !== next.dominoTeams ? (next.dominoTeams === false ? '، فردي' : '، فرق') : ''}`]);
        await this.publish(next);
        break;
      }
      case 'stop': {
        // المالك يوقف اللعبة نهائياً: النتيجة صفر صفر والمقاعد فارغة، ثم يختار من يلعب
        if (!isOwner) throw new Error('not-owner');
        const next = stopGame(t);
        await this.save(next);
        this.broadcast(['أوقف مالك الطاولة اللعبة. النتيجة صفر صفر والمقاعد فارغة، والمالك يختار من يلعب']);
        await this.publish(next);
        break;
      }
      case 'vacate': {
        if (!isOwner) throw new Error('not-owner');
        if (!isSeat(msg.seat)) throw new Error('bad-request');
        const who = t.seats[msg.seat];
        const next = vacateSeat(t, msg.seat);
        await this.save(next);
        if (who) this.broadcast([who.isBot ? `أُزيل ${who.username}` : `${who.username} أصبح مشاهداً`]);
        await this.publish(next);
        break;
      }
      case 'leave': {
        const seat = seatOf(t, uid);
        const who = seat !== null ? t.seats[seat]!.username : t.spectators.find((m) => m.uid === uid)?.username ?? 'أحد الحاضرين';
        const r = leave(t, uid);
        this.toVoice((v, id) => v.remove(id, uid));
        // لم يبق إلا روبوتات (أو لا أحد): تُغلق الطاولة فوراً.
        // الحاضرون غير المتصلين (مشاهد قفل التطبيق) لا يُبقونها، ولا يُبقيها إلا لاعب جالس أو متصل آخر
        const humanSeated = r.table.seats.some((s) => s && !s.isBot);
        const othersConnected = this.ctx.getWebSockets().some((w) => w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as { uid: string }).uid !== uid);
        if (!hasHumans(r.table) || (!humanSeated && !othersConnected)) { await this.closeTable(); return; }
        await this.save(r.table);
        this.broadcast([
          r.botReplaced && seat !== null ? `غادر ${who} وحلّ مكانه ${r.table.seats[seat]!.username}` : `غادر ${who}`,
          ...(r.newOwner ? [`أصبح ${r.newOwner} مالك الطاولة`] : []),
        ]);
        await this.publish(r.table);
        break;
      }
    }
    await this.schedule();
  }

  async webSocketClose(ws: WebSocket, code?: number, reason?: string, wasClean?: boolean) {
    // سجل المتابعة: مين قطع الاتصال (1000/1001 = التطبيق قفله، 1006 = انقطع فجأة: نت أو التطبيق ألغاه، 4000 = الخادم)
    const a = ws.deserializeAttachment() as { at?: number };
    const kind = code === 4000 ? 'الخادم' : code === 1000 || code === 1001 ? 'التطبيق' : code === 1006 ? 'انقطاع مفاجئ' : 'غير معروف';
    if (code !== 4000 && code !== 4001) this.noteSlow(`انقطع اتصال (${kind}) ${this.who(ws)} code=${code ?? '?'} clean=${wasClean ?? '?'} مدة_الاتصال=${a.at ? Math.round((Date.now() - a.at) / 1000) : '?'}s${reason ? ` reason=${reason.slice(0, 30)}` : ''}`);
    return this.serial(() => this.webSocketCloseInner(ws), 'disconnect');
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    this.noteSlow(`خطأ اتصال ${this.who(ws)} ${String((error as Error)?.message ?? error).slice(0, 60)}`);
  }

  private async webSocketCloseInner(ws: WebSocket) {
    try { ws.close(); } catch { /* already closed */ }
    // انقطع اتصاله بالطاولة: يخرج من المحادثة الصوتية (إن لم يكن متصلاً من جهاز آخر)
    const { uid } = ws.deserializeAttachment() as { uid: string };
    const stillHere = this.ctx.getWebSockets().some((w) => w !== ws && w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as { uid: string }).uid === uid);
    const t = await this.load();
    // لا نخرجه فوراً: انقطاع قصير لا يُخرجه من المحادثة، ويخرج إن لم يعد خلال المهلة
    void t;
    if (this.voiceMap[uid] && !stillHere) this.toVoice((v, id) => v.gone(id, uid));
    // انقطع اتصاله وهو في الطاولة: ما نعلن ولا نحجز مقعده فوراً، ننتظر مهلة قصيرة (OFFLINE_GRACE_MS)
    // لأن أغلب الانقطاعات ثواني ويرجع التطبيق لحاله. إن ما رجع خلالها يُعلن ويُحجز مقعده (في المنبه)
    const current = this.table;
    if (current && !stillHere && inTable(current, uid)) {
      const pending = (await this.ctx.storage.get<Record<string, number>>('pendingOffline')) ?? {};
      if (pending[uid] === undefined) pending[uid] = Date.now();
      await this.ctx.storage.put('pendingOffline', pending);
      await this.schedule();
    }
    // خارج اللعب: من لا يعود خلال المهلة يخرج من الطاولة (لا تبقى حسابات مغلقة أو محذوفة جالسة)
    const latest = this.table;
    if (latest && !stillHere) {
      const next = markLobbyAway(latest, uid, Date.now());
      if (next !== latest) {
        await this.save(next);
        await this.schedule();
      }
    }
    // خرج آخر إنسان وبقيت الروبوتات وحدها: تُحذف الطاولة فوراً
    if (this.table && this.onlyBots(this.table, ws)) { await this.closeTable(); return; }
    // آخر متصل خرج: نبدأ مهلة الإغلاق
    if (this.connectedCount(ws) === 0) {
      await this.ctx.storage.put('emptySince', Date.now());
      await this.ctx.storage.setAlarm(Date.now() + this.grace());
    }
  }

  /**
   * لم يبق في الطاولة إنسان: المقاعد كلها روبوتات (أو فارغة وفيها روبوت) ولا أحد متصل يشاهد.
   * تُحذف فوراً حتى لو كانت الروبوتات في منتصف مباراة.
   */
  private onlyBots(t: TableData, except?: WebSocket) {
    if (!hasHumans(t)) return true;
    const botsOnly = t.seats.some((s) => s?.isBot) && t.seats.every((s) => !s || s.isBot);
    return botsOnly && this.connectedCount(except) === 0;
  }

  private connectedCount(except?: WebSocket) {
    return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === WebSocket.OPEN).length;
  }

  /** إغلاق الطاولة نهائياً: إشعار المتصلين، حذف الحالة، وإزالتها من قائمة الطاولات. */
  private async closeTable() {
    const current = this.table ?? (await this.load());
    // الطاولة الثابتة: ما تنقفل طول ما صاحبها مشترك وهي طاولته الثابتة — ترجع فاضية بانتظار أحد
    if (current?.pinned && await this.keepPinned(current)) {
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(JSON.stringify({ type: 'closed' })); ws.close(1000, 'table emptied'); } catch { /* already closed */ }
      }
      this.toVoice((v) => v.closeAll());
      const empty = emptyPinned(current);
      this.table = empty;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete(['emptySince', 'offline']);
      await this.ctx.storage.put('table', empty);
      await this.publish(empty);
      return;
    }
    this.toVoice((v) => v.closeAll());
    const id = current?.id;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: 'closed' }));
        ws.close(1000, 'table closed');
      } catch { /* already closed */ }
    }
    this.table = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (id && this.env.DEV_AUTH !== '1') {
      await this.db().remove('tables', id).catch((e) => console.error('remove failed', e));
    }
  }

  // ───── الروبوتات والتوزيع التلقائي ─────

  /** متى تنتهي أقرب مهلة انقطاع قصير */
  private async nextPendingOffline(): Promise<number | null> {
    const pending = (await this.ctx.storage.get<Record<string, number>>('pendingOffline')) ?? {};
    const times = Object.values(pending);
    return times.length ? Math.min(...times) + OFFLINE_GRACE_MS : null;
  }

  /**
   * انتهت مهلة الانقطاع القصير وما رجع: الحين نحجز مقعده (أثناء المباراة) ونعلن انقطاعه للبقية،
   * ونعلن رجوعه إن رجع بعدها
   */
  private async settlePendingOffline() {
    const pending = (await this.ctx.storage.get<Record<string, number>>('pendingOffline')) ?? {};
    const now = Date.now();
    let changed = false;
    for (const [uid, since] of Object.entries(pending)) {
      if (now - since < OFFLINE_GRACE_MS - 200) continue;
      delete pending[uid];
      changed = true;
      const connected = this.ctx.getWebSockets().some((w) => w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as { uid: string }).uid === uid);
      const cur = this.table;
      if (connected || !cur || !inTable(cur, uid)) continue;
      // مهلة حجز المقعد (ثلاث دقائق) تبدأ من الإعلان
      const next = markAway(cur, uid, now);
      if (next !== cur) await this.save(next);
      const offline = (await this.ctx.storage.get<Record<string, number>>('offline')) ?? {};
      offline[uid] = now;
      await this.ctx.storage.put('offline', offline);
      this.broadcast([`انقطع اتصال ${memberName(cur, uid) ?? 'لاعب'}${next !== cur ? '، مقعده محجوز ثلاث دقائق' : ''}`]);
    }
    if (changed) await this.ctx.storage.put('pendingOffline', pending);
  }

  private async schedule() {
    const t = await this.load();
    // لا أحد متصل: لا داعي لتشغيل الروبوتات، ننتظر مهلة الإغلاق فقط
    const emptySince = await this.ctx.storage.get<number>('emptySince');
    if (emptySince) {
      // تشخيص: دور روبوت والطاولة تحسب ما فيه أحد متصل (فيوقف الروبوت)
      if (t && nextAutoStep(t, rng)) this.noteSlow(`روبوت موقوف (ما فيه متصلين) t=${t.id.slice(0, 4)} ${kindOf(t)}`);
      await this.ctx.storage.setAlarm(emptySince + this.grace());
      return;
    }
    const step = t ? nextAutoStep(t, rng) : null;
    // في التطوير المحلي نسرّع الروبوتات للاختبار
    // الروبوت يفكّر بعد انتهاء مهلة القرار السابق (ينتقل له الدور أولاً)
    const holdUntil = t && holding(t) ? t.hold!.until : 0;
    const botAt = step ? Math.max(Date.now() + (this.env.DEV_AUTH === '1' ? 5 : step.delayMs), holdUntil ? holdUntil + 400 : 0) : null;
    if (botAt) await this.ctx.storage.put('botAt', botAt);
    else await this.ctx.storage.delete('botAt');
    const awayAt = t ? nextAwayDeadline(t) : null;
    const lobbyAt = t ? nextLobbyDeadline(t) : null;
    // فحص النبضات ما دام فيه اتصالات تنبض
    const staleAt = this.nextStaleCheck();
    const pendingAt = await this.nextPendingOffline();
    const clockAt = t?.clock?.deadline ?? Infinity;
    const at = Math.min(holdUntil || Infinity, botAt ?? Infinity, awayAt ?? Infinity, lobbyAt ?? Infinity, staleAt ?? Infinity, pendingAt ?? Infinity, clockAt);
    if (Number.isFinite(at)) await this.ctx.storage.setAlarm(at);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    return this.serial(() => this.alarmInner(), 'alarm');
  }

  private async alarmInner() {
    const t = await this.load();
    if (!t) return;
    await this.dropStale();
    if (!this.table) return;
    await this.settlePendingOffline();
    if (!this.table) return;
    const emptySince = await this.ctx.storage.get<number>('emptySince');
    if (emptySince) {
      if (this.connectedCount() === 0 && Date.now() - emptySince >= this.grace() - 500) {
        await this.closeTable();
        return;
      }
      if (this.connectedCount() > 0) await this.ctx.storage.delete('emptySince');
      await this.schedule();
      return;
    }
    // انتهت مهلة لاعب منقطع: روبوت مكانه (عملة من المالك إن توفرت — اللعب لا يتوقف لأجلها)
    let cur = this.table ?? t;
    for (const uid of awayExpired(cur, Date.now())) {
      const seat = seatOf(cur, uid);
      const name = memberName(cur, uid) ?? 'لاعب';
      cur = replaceWithBot(cur, uid, rng);
      // ما رجع خلال حجز المقعد: ما يبقى اسمه معلقاً بين الحاضرين، يخرج من الطاولة الآن (لو رجع يدخل من جديد)
      cur = markLobbyAway(cur, uid, Date.now() - LOBBY_LEAVE_AFTER_MS);
      await this.save(cur);
      if (seat !== null) {
        void this.db().adjustCoins(cur.ownerUid, -COINS.addBot).catch(() => {}); // في الخلفية: ما يوقف اللعب
        this.broadcast([`انتهت مهلة ${name}، وحلّ مكانه ${cur.seats[seat]!.username}`]);
      }
      await this.publish(cur);
    }
    // حلّت الروبوتات مكان آخر لاعب حقيقي ولا أحد متصل: تُحذف الطاولة
    if (this.onlyBots(cur)) { await this.closeTable(); return; }
    // انتهت مهلة منقطع (خارج اللعب، أو مشاهد أثناء المباراة): يخرج من الطاولة
    for (const uid of lobbyExpired(cur, Date.now())) {
      const name = memberName(cur, uid) ?? 'أحد الحاضرين';
      const r = leave(cur, uid);
      this.toVoice((v, id) => v.remove(id, uid, false));
      if (!hasHumans(r.table)) { await this.closeTable(); return; }
      cur = r.table;
      await this.save(cur);
      this.broadcast([`خرج ${name} من الطاولة لانقطاع اتصاله`, ...(r.newOwner ? [`أصبح ${r.newOwner} مالك الطاولة`] : [])]);
      await this.publish(cur);
    }
    // انتهت مهلة القرار: ينتقل الدور لمن بعده
    if (cur.hold && !holding(cur, Date.now() + 50)) {
      const { hold: _h, ...rest } = cur;
      void _h;
      cur = rest;
      await this.save(cur);
      this.broadcast([]);
    }
    // خلص وقت الدور: الروبوت يلعب عن اللاعب أفضل حركة
    const timeout = timeoutAction(cur);
    if (timeout) {
      const seat = cur.clock!.seat;
      const name = cur.seats[seat]?.username ?? 'اللاعب';
      let r: { table: TableData; events: string[]; voices?: string[] };
      try {
        r = timeout.game === 'baloot'
          ? applyWithEvents(cur, timeout.action as Parameters<typeof applyWithEvents>[1], rng)
          : applyOther(cur, timeout.action as Parameters<typeof applyOther>[1], rng);
      } catch {
        // الحركة ما نفعت: نوقف المؤقت لهالدور بدل ما يعيد المحاولة على طول
        r = { table: { ...cur, clock: { ...cur.clock!, deadline: Infinity } }, events: [] };
      }
      r.table = await this.rigDeal(r.table);
      await this.save(r.table);
      this.broadcast(r.events.length ? [`خلص وقت ${name}`, ...r.events] : [], undefined, r.voices);
      if (r.table.game?.phase === 'matchOver' || ((r.table.domino || r.table.jackaroo || r.table.ludo) && !otherActive(r.table))) await this.publish(r.table);
      await this.schedule();
      return;
    }
    // دور الروبوت (قد يوقظنا المنبه مبكراً لمهلة منقطع، فلا نسبق وقت تفكيره)
    const botAt = await this.ctx.storage.get<number>('botAt');
    const step = !botAt || botAt <= Date.now() + 50 ? nextAutoStep(cur, rng) : null;
    if (step) {
      // تشخيص: الروبوت تأخر عن وقته (السجل: /tables/slow)
      const late = botAt ? Date.now() - botAt : 0;
      if (late > 2500) this.noteSlow(`روبوت تأخر ${late}ms t=${cur.id.slice(0, 4)} ${kindOf(cur)}`);
      const r = runAutoStep(cur, step, rng);
      r.table = await this.rigDeal(r.table);
      await this.save(r.table);
      this.broadcast(r.events, undefined, r.voices);
      if (r.table.game?.phase === 'matchOver' || ((r.table.domino || r.table.jackaroo || r.table.ludo) && !otherActive(r.table))) await this.publish(r.table);
    }
    if (step || !botAt || botAt <= Date.now() + 50) await this.schedule();
    else {
      await this.ctx.storage.setAlarm(Math.min(botAt, cur.hold?.until ?? Infinity, nextAwayDeadline(cur) ?? Infinity, nextLobbyDeadline(cur) ?? Infinity, this.nextStaleCheck() ?? Infinity, this.table?.clock?.deadline ?? Infinity));
    }
  }

  /** يرسل لكل متصل حالته الخاصة + الإعلانات. */
  /** except: لا تُرسل الإعلانات لهذا اللاعب (يسمع إعلانه الخاص من تطبيقه)، لكن تصله الحالة */
  /** voices: أصوات منطوقة للمزايدة والدبل يشغّلها التطبيق (تصل حتى بلا نص إعلان) */
  private broadcast(events: string[], except?: string, voices?: string[]) {
    const t = this.table;
    if (!t) return;
    const names = t.seats.map((m, i) => m?.username ?? `المقعد ${i + 1}`);
    for (const ws of this.ctx.getWebSockets()) {
      const { uid } = ws.deserializeAttachment() as { uid: string };
      try {
        // إعلانات اللودو تُكمَّل لكل واحد: أرقام الخانات من خانة بدايته، و"أنت" بدل اسمه
        const mine = t.ludo ? events.map((e) => personalizeLudo(e, names, seatOf(t, uid) ?? -1)) : events;
        if ((events.length || voices?.length) && uid !== except) ws.send(JSON.stringify({ type: 'events', events: mine, ...(voices?.length ? { voices } : {}) }));
        ws.send(JSON.stringify({ type: 'state', view: viewFor(this.withVoice(t), uid) }));
        // تجربة التعادل: اللي عليه الدور يوصله وش يسوي (هو بس)
        if (t.tieRig && t.game) {
          const seat = seatOf(t, uid);
          const hint = seat === null ? null : tieHint(t.game, seat);
          if (hint) {
            ws.send(JSON.stringify({ type: 'events', events: [`تجربة التعادل: ${hint}`] }));
            ws.send(JSON.stringify({ type: 'chat', uid: 'tie-rig', name: 'تجربة التعادل', text: hint }));
          }
        }
      } catch { /* اتصال مغلق */ }
    }
  }
}
