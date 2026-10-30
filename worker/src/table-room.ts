import { DurableObject } from 'cloudflare:workers';
import type { Card, Rank, Seat, Suit } from '../../shared/baloot/cards';
import { RANKS, SUITS } from '../../shared/baloot/cards';
import { type Action, type Bid, IllegalAction } from '../../shared/baloot/game';
import { BOT_REPLACE_AFTER_MS, COINS, VOICE_MONTHLY_LISTEN_HOURS } from '../../shared/economy';
import {
  type TableData, TableError, addBot, addInvite, applyWithEvents, assignSeat, stopGame, kick, setVoiceBlocked, isVoiceBlocked, isMember as inTable, lobbyExpired, markLobbyAway, markLobbyBack, nextLobbyDeadline, sweepLobbyGhosts, hasHumans, vacateSeat, isFull, join, leave, newTable, nextAutoStep, peopleCount,
  awayExpired, markAway, markBack, memberName, nextAwayDeadline, replaceWithBot, runAutoStep, seatOf, startAny, viewFor, withoutVoice,
} from '../../shared/table';
import { type GameKind, type GameVariant, applyOther, kindOf, otherActive, otherStatus, parseDomino, parseJackaroo, parseLudo } from '../../shared/games';
import { LudoError } from '../../shared/ludo/engine';
import { DominoError } from '../../shared/domino/engine';
import { JackarooError } from '../../shared/jackaroo/engine';
import { Realtime, type SessionDescription } from './realtime';
import type { Env } from './env';
import { Firestore } from './firestore';

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
  | { type: 'start' }
  | { type: 'leave' }
  | { type: 'replace'; seat: number; uid: string }
  | { type: 'vacate'; seat: number }
  | { type: 'botNow'; seat: number }
  | { type: 'stop' }
  | { type: 'kick'; uid: string }
  | { type: 'ban'; uid: string }
  | { type: 'voiceBlock'; uid: string; blocked: boolean }
  | { type: 'setPrivate'; isPrivate: boolean }
  | { type: 'setOwner'; uid: string };

/**
 * عشوائية آمنة لخلط الورق والتوزيع: من مولّد التشفير في النظام (crypto.getRandomValues)،
 * لا يمكن توقعه ولا التلاعب به، وكل توزيع مستقل تماماً عن الذي قبله.
 */
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

/** اسم مسار الميكروفون داخل جلسة كل شخص */
const VOICE_TRACK = 'mic';

export interface VoiceRequest {
  op: 'session' | 'publish' | 'pull' | 'renegotiate' | 'close' | 'mute' | 'leave';
  sessionId?: unknown;
  offer?: unknown;
  answer?: unknown;
  mid?: unknown;
  mids?: unknown;
  uid?: unknown;
  muted?: unknown;
}

/** خطأ Realtime لجلسة انتهت لخمولها (لم يتصل بها أي اتصال صوتي بعد) */
const isStaleSession = (e: unknown) => /session_error|disconnected/i.test(String((e as Error)?.message ?? e));

const isSdp = (d: unknown, type: 'offer' | 'answer'): d is SessionDescription =>
  typeof d === 'object' && d !== null && (d as SessionDescription).type === type
  && typeof (d as SessionDescription).sdp === 'string' && (d as SessionDescription).sdp.length < 20_000;

const isSeat = (n: unknown): n is Seat => n === 0 || n === 1 || n === 2 || n === 3;
const isSuit = (s: unknown): s is Suit => SUITS.includes(s as Suit);
const isCard = (c: unknown): c is Card =>
  typeof c === 'object' && c !== null && isSuit((c as Card).suit) && RANKS.includes((c as Card).rank as Rank);

type SimpleBid = Exclude<Bid['type'], 'hokm'>;
// كل المزايدات بلا لون (Record يجبرنا على إضافة أي نوع جديد هنا، وإلا لا يُبنى الخادم)
const SIMPLE_BIDS = Object.keys({
  pass: 1, sun: 1, ashkal: 1, secondHokm: 1, qablak: 1, confirmHokm: 1,
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
    case 'play': return isCard(a.card) ? { type: 'play', seat, card: { suit: a.card.suit, rank: a.card.rank } } : null;
    default: return null;
  }
}

const ERRORS: Record<string, string> = {
  'not-enough-coins': 'رصيدك من العملات لا يكفي',
  'owner-not-enough-coins': 'رصيد مالك الطاولة لا يكفي',
  'table-full': 'الطاولة ممتلئة',
  'game-started': 'اللعبة بدأت بالفعل',
  'seat-taken': 'المقعد محجوز',
  'not-full': 'يجب أن تكتمل المقاعد الأربعة',
  'not-owner': 'هذا الإجراء لمالك الطاولة فقط',
  'not-a-spectator': 'هذا الشخص لم يعد في الطاولة',
  'not-a-member': 'هذا الشخص لم يعد في الطاولة',
};

/** انقطاع قصير (تبديل شبكة، اتصال يُعاد) لا يُخرج الشخص من المحادثة الصوتية إلا إن لم يعد خلال هذه المدة */
const VOICE_DROP_GRACE_MS = 60_000;

/** مهلة قبل إغلاق طاولة لم يبق فيها أحد متصل (تحديث الصفحة أو انقطاع قصير لا يغلقها) */
const EMPTY_GRACE_MS = 60_000;
/** آخر إنسان طلع (أو قفل التطبيق) وبقيت الروبوتات: مهلة الرجوع قبل إغلاق الطاولة */
const BOTS_ALONE_GRACE_MS = 60_000;
/**
 * التطبيق ينبض كل 10 ثوانٍ ("ping"): من انقطعت نبضته أكثر من هذا نعتبره انقطع (انقطع نته بلا إغلاق للاتصال)
 * فيُعلن انقطاعه فوراً بدل انتظار النظام دقائق ليكتشف ذلك. النسخ القديمة اللي ما تنبض ما تتأثر.
 */
const STALE_AFTER_MS = 30_000;
const STALE_CHECK_MS = 10_000;

export class TableRoom extends DurableObject<Env> {
  private table: TableData | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // النبضة يرد عليها النظام دون إيقاظ الطاولة، ونقرأ وقتها لنعرف أن الاتصال حي
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
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

  /** نغلق الاتصالات الميتة ونعاملها كانقطاع (إعلان "انقطع اتصال فلان" ونغمته، وحجز المقعد...) */
  private async dropStale() {
    for (const ws of this.staleSockets()) {
      try { ws.close(4000, 'stale'); } catch { /* already closed */ }
      await this.webSocketClose(ws);
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

  private db() {
    if (this.env.DEV_AUTH === '1') {
      // تطوير محلي: بدون Firestore
      return { adjustCoins: async () => 99, set: async () => {}, remove: async () => {} } as unknown as Firestore;
    }
    return new Firestore(this.env.FIREBASE_PROJECT_ID, this.env.FIREBASE_SERVICE_ACCOUNT);
  }

  private async load(): Promise<TableData | null> {
    if (!this.table) this.table = (await this.ctx.storage.get<TableData>('table')) ?? null;
    return this.table;
  }

  private async save(t: TableData) {
    this.table = t;
    await this.ctx.storage.put('table', t);
  }

  /** ملخص عام في Firestore لقائمة الطاولات (أفضل جهد — لا يوقف اللعب إن فشل). */
  private async publish(t: TableData) {
    try {
      await this.db().set('tables', t.id, {
        ownerName: memberName(t, t.ownerUid) ?? t.seats.find((m) => m && !m.isBot)?.username ?? '',
        isPrivate: t.isPrivate,
        players: t.seats.filter(Boolean).length,
        people: peopleCount(t),
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

  async create(id: string, owner: { uid: string; username: string }, isPrivate: boolean, kind: GameKind = 'baloot', variant: GameVariant = 'classic'): Promise<void> {
    const t = newTable(id, owner, isPrivate, Date.now(), kind, variant);
    await this.save(t);
    await this.publish(t);
    // إن لم يتصل أحد خلال المهلة تُغلق الطاولة
    await this.ctx.storage.put('emptySince', Date.now());
    await this.ctx.storage.setAlarm(Date.now() + this.grace());
  }

  async joinTable(user: { uid: string; username: string }, invite?: string): Promise<{ ok: true } | { error: string }> {
    const t = await this.load();
    if (!t) return { error: 'not-found' };
    try {
      // من حظره مالك هذه الطاولة لا يدخل أي طاولة يملكها
      if (!inTable(t, user.uid) && await this.env.HUBS.get(this.env.HUBS.idFromName(t.ownerUid)).isBanned(user.uid)) {
        return { error: 'banned-by-owner' };
      }
      const r = join(t, user, invite);
      // دخول جديد للطاولة (لا رجوع اتصال): لا نعلن "عاد اتصال" عند فتح الطاولة
      const offline = (await this.ctx.storage.get<Record<string, number>>('offline')) ?? {};
      if (offline[user.uid] !== undefined) { delete offline[user.uid]; await this.ctx.storage.put('offline', offline); }
      if (r.charge) await this.db().adjustCoins(user.uid, -COINS.joinTable);
      await this.save(r.table);
      this.broadcast([`انضم ${user.username}`]);
      await this.publish(r.table);
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  /**
   * فحص دوري من التنظيف: هل الطاولة ما زالت حية؟
   * إن لم يكن فيها أحد متصل نبدأ مهلة الإغلاق (إن لم تكن بدأت).
   */
  async checkAlive(): Promise<boolean> {
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

  /** المالك ينشئ رابط دعوة: عملة منه فوراً، والمدعو يدخل مجاناً */
  async createInvite(uid: string, seat?: number): Promise<{ code: string } | { error: string }> {
    const t = await this.load();
    if (!t) return { error: 'not-found' };
    if (t.ownerUid !== uid) return { error: 'not-owner' };
    try {
      await this.db().adjustCoins(uid, -COINS.inviteFriend);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
    await this.save(addInvite(t, code, isSeat(seat) && t.seats[seat] === null ? seat : undefined));
    return { code };
  }

  /** طاولة صديق: هل ما زال فيها، وهل هي مقفلة */
  async friendTable(uid: string): Promise<{ isPrivate: boolean; kind: GameKind; variant: GameVariant } | null> {
    const t = await this.load();
    if (!t || !(seatOf(t, uid) !== null || t.spectators.some((m) => m.uid === uid))) return null;
    return { isPrivate: t.isPrivate, kind: kindOf(t), variant: t.variant ?? 'classic' };
  }

  async isMember(uid: string): Promise<boolean> {
    const t = await this.load();
    return !!t && (seatOf(t, uid) !== null || t.spectators.some((m) => m.uid === uid));
  }

  // ───── المحادثة الصوتية (Cloudflare Realtime) ─────

  private usage() {
    return this.env.HUBS.get(this.env.HUBS.idFromName('__voice_usage__'));
  }

  /**
   * يضيف استهلاك الصوت منذ آخر تغيير للعدّاد الشهري العام، ويعيد الطاولة بوقت محدّث.
   * يُستدعى قبل أي تغيير في المنضمين (لأن عدد من يسمع من يتغير).
   */
  private async accountVoice(t: TableData): Promise<TableData> {
    const now = Date.now();
    const members = Object.values(t.voice ?? {});
    const n = members.length;
    const mics = members.filter((m) => m.mic !== false).length;
    const listening = mics * (n - 1);
    const since = t.voiceSince ?? now;
    if (listening > 0 && now > since) {
      await this.usage().addVoiceUsage(((now - since) / 1000) * listening).catch((e) => console.error('voice usage', e));
    }
    return { ...t, voiceSince: now };
  }

  /**
   * كل طلبات الصوت تمر من هنا: الغرفة تعرف من في الطاولة ومن يملك أي جلسة،
   * فلا يستطيع أحد سحب صوت طاولة ليس فيها أو التحكم بجلسة غيره.
   */
  async voice(uid: string, req: VoiceRequest): Promise<unknown> {
    const t = await this.load();
    if (!t) throw new Error('not-found');
    const name = memberName(t, uid);
    if (!name) throw new Error('not-a-member');
    if (!this.env.REALTIME_APP_ID || !this.env.REALTIME_APP_SECRET) throw new Error('voice-not-configured');
    const rt = new Realtime(this.env.REALTIME_APP_ID, this.env.REALTIME_APP_SECRET);
    const mine = t.voice?.[uid];
    const own = (sessionId: unknown) => {
      if (!mine || mine.sessionId !== sessionId) throw new Error('bad-session');
      return mine.sessionId;
    };

    switch (req.op) {
      case 'session': {
        // الانضمام (تلقائياً عند دخول الطاولة): استماع فقط بلا ميكروفون، ويُعلن للبقية
        const acc = await this.accountVoice(t);
        if ((await this.usage().voiceUsageSeconds()) >= VOICE_MONTHLY_LISTEN_HOURS * 3600) throw new Error('voice-limit');
        const sessionId = await rt.newSession();
        await this.save({ ...acc, voice: { ...(acc.voice ?? {}), [uid]: { sessionId, muted: true, mic: false } } });
        // إعادة اتصال صامتة (كان في المحادثة): لا نعلن "انضم" مرة أخرى
        this.broadcast(mine ? [] : [`${name} انضم للمحادثة الصوتية`], uid);
        const gone = (await this.ctx.storage.get<Record<string, number>>('voiceGone')) ?? {};
        if (gone[uid] !== undefined) { delete gone[uid]; await this.ctx.storage.put('voiceGone', gone); }
        return { sessionId };
      }
      case 'publish': {
        // أول مرة يفتح الميكروفون: ننشره في جلسته
        let sessionId = own(req.sessionId);
        if (isVoiceBlocked(t, uid)) throw new Error('voice-blocked');
        if (!isSdp(req.offer, 'offer') || typeof req.mid !== 'string') throw new Error('bad-request');
        const offer = req.offer, mid = req.mid;
        let answer: SessionDescription;
        try {
          answer = await rt.pushTrack(sessionId, offer, mid, VOICE_TRACK);
        } catch (e) {
          // جلسة الاستماع انتهت لخمولها قبل أن يفتح الميكروفون: جلسة جديدة بالميكروفون مباشرة
          if (!isStaleSession(e)) throw e;
          ({ sessionId, answer } = await rt.publish(offer, mid, VOICE_TRACK));
        }
        const acc = await this.accountVoice(t);
        await this.save({ ...acc, voice: { ...acc.voice, [uid]: { sessionId, muted: false, mic: true } } });
        this.broadcast([]);
        return { answer, sessionId };
      }
      case 'pull': {
        const sessionId = own(req.sessionId);
        const remote = typeof req.uid === 'string' ? t.voice?.[req.uid] : undefined;
        if (!remote || remote.mic === false || req.uid === uid) throw new Error('bad-request');
        // صوت من كتمه المالك لا يُسحب لأحد
        if (isVoiceBlocked(t, req.uid as string)) throw new Error('voice-blocked');
        try {
          return await rt.pull(sessionId, remote.sessionId, VOICE_TRACK);
        } catch (e) {
          // جلسة المستمع انتهت لخمولها (لم يكن أحد يتكلم): جلسة جديدة له ثم نسحب الصوت إليها
          if (!isStaleSession(e) || mine!.mic) throw e;
          const fresh = await rt.newSession();
          await this.save({ ...t, voice: { ...t.voice, [uid]: { ...mine!, sessionId: fresh } } });
          this.broadcast([]);
          return { ...(await rt.pull(fresh, remote.sessionId, VOICE_TRACK)), sessionId: fresh };
        }
      }
      case 'renegotiate': {
        if (!isSdp(req.answer, 'answer')) throw new Error('bad-request');
        return rt.renegotiate(own(req.sessionId), req.answer);
      }
      case 'close': {
        const mids = Array.isArray(req.mids) ? req.mids.filter((m): m is string => typeof m === 'string').slice(0, 20) : [];
        if (mids.length) await rt.close(own(req.sessionId), mids);
        return { ok: true };
      }
      case 'mute': {
        own(req.sessionId);
        if (req.muted !== true && isVoiceBlocked(t, uid)) throw new Error('voice-blocked');
        const next = { ...t, voice: { ...t.voice, [uid]: { ...mine!, muted: req.muted === true } } };
        await this.save(next);
        this.broadcast([]);
        return { ok: true };
      }
      case 'leave': {
        if (!mine) return { ok: true };
        await this.save(withoutVoice(await this.accountVoice(t), uid));
        this.broadcast([`${name} غادر المحادثة الصوتية`], uid);
        return { ok: true };
      }
      default:
        throw new Error('bad-request');
    }
  }

  // ───── WebSocket ─────

  async fetch(request: Request): Promise<Response> {
    const uid = request.headers.get('X-Uid');
    if (!uid || request.headers.get('Upgrade') !== 'websocket') return new Response('bad request', { status: 400 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid });
    const t = await this.load();
    if (t) pair[1].send(JSON.stringify({ type: 'state', view: viewFor(t, uid) }));
    // عاد لاعب منقطع قبل انتهاء المهلة: يستعيد مقعده
    if (t?.away?.[uid] !== undefined) await this.save(markBack(t, uid));
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
    const gone = (await this.ctx.storage.get<Record<string, number>>('voiceGone')) ?? {};
    if (gone[uid] !== undefined) {
      delete gone[uid];
      await this.ctx.storage.put('voiceGone', gone);
    }
    await this.ctx.storage.delete('emptySince');
    await this.schedule();
    // أول فحص للنبضات (الاتصال الجديد ما نبض بعد، فقد لا يكون في المنبه فحص)
    const next = await this.ctx.storage.getAlarm();
    const firstCheck = Date.now() + STALE_AFTER_MS + STALE_CHECK_MS;
    if (next === null || next > firstCheck) await this.ctx.storage.setAlarm(firstCheck);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const { uid } = ws.deserializeAttachment() as { uid: string };
    let msg: ClientMessage;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const t = await this.load();
    if (!t) return;
    try {
      await this.handle(t, uid, msg);
    } catch (e) {
      const code = (e as Error).message;
      const text = e instanceof IllegalAction || e instanceof DominoError || e instanceof JackarooError || e instanceof LudoError ? code : ERRORS[code] ?? 'تعذّر تنفيذ الطلب';
      ws.send(JSON.stringify({ type: 'error', message: text }));
    }
  }

  private async handle(t: TableData, uid: string, msg: ClientMessage) {
    const isOwner = uid === t.ownerUid;
    switch (msg.type) {
      case 'action': {
        const seat = seatOf(t, uid);
        if (seat === null || !t.game) throw new Error('not-a-player');
        const action = parseAction(msg.action, seat);
        if (!action) throw new Error('bad-action');
        const r = applyWithEvents(t, action, rng);
        await this.save(r.table);
        this.broadcast(r.events);
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
        if (!isFull(t)) throw new TableError('not-full');
        const { table: next, events } = startAny(t, rng);
        await this.save(next);
        this.broadcast(events);
        await this.publish(next);
        break;
      }
      case 'replace': {
        if (!isOwner) throw new Error('not-owner');
        if (!isSeat(msg.seat) || typeof msg.uid !== 'string') throw new Error('bad-request');
        const before = t.seats[msg.seat];
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
        const r = kick(t.voice?.[msg.uid] ? await this.accountVoice(t) : t, msg.uid, msg.type === 'ban', rng);
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
        this.broadcast([msg.blocked ? `كتم مالك الطاولة ${who} في المحادثة الصوتية` : `ألغى مالك الطاولة كتم ${who}`]);
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
        const r = leave(t.voice?.[uid] ? await this.accountVoice(t) : t, uid);
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

  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* already closed */ }
    // انقطع اتصاله بالطاولة: يخرج من المحادثة الصوتية (إن لم يكن متصلاً من جهاز آخر)
    const { uid } = ws.deserializeAttachment() as { uid: string };
    const stillHere = this.ctx.getWebSockets().some((w) => w !== ws && w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as { uid: string }).uid === uid);
    const t = await this.load();
    // لا نخرجه فوراً: انقطاع قصير لا يُخرجه من المحادثة، ويخرج إن لم يعد خلال المهلة
    if (t?.voice?.[uid] && !stillHere) {
      const gone = (await this.ctx.storage.get<Record<string, number>>('voiceGone')) ?? {};
      gone[uid] = Date.now();
      await this.ctx.storage.put('voiceGone', gone);
      await this.schedule();
    }
    // لاعب جالس انقطع اتصاله أثناء المباراة (مكالمة، شبكة ضعيفة...): نحجز مقعده ثلاث دقائق
    const current = this.table;
    if (current && !stillHere) {
      const next = markAway(current, uid, Date.now());
      if (next !== current) {
        await this.save(next);
        await this.schedule();
      }
      // انقطع اتصاله (شبكة أو أُغلق التطبيق) وهو ما زال في الطاولة: نعلن ذلك للبقية، ونعلن رجوعه إن رجع
      if (inTable(current, uid)) {
        const offline = (await this.ctx.storage.get<Record<string, number>>('offline')) ?? {};
        offline[uid] = Date.now();
        await this.ctx.storage.put('offline', offline);
        this.broadcast([`انقطع اتصال ${memberName(current, uid) ?? 'لاعب'}${next !== current ? '، مقعده محجوز ثلاث دقائق' : ''}`]);
      }
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
    if (current?.voice) await this.accountVoice(current);
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

  /** أقرب موعد لإخراج منقطع من المحادثة الصوتية */
  private async nextVoiceDrop(): Promise<number | null> {
    const gone = (await this.ctx.storage.get<Record<string, number>>('voiceGone')) ?? {};
    const times = Object.values(gone);
    return times.length ? Math.min(...times) + VOICE_DROP_GRACE_MS : null;
  }

  /** من انقطع ولم يعد خلال المهلة يخرج من المحادثة الصوتية */
  private async dropExpiredVoice(): Promise<void> {
    const gone = (await this.ctx.storage.get<Record<string, number>>('voiceGone')) ?? {};
    const now = Date.now();
    const connected = new Set(this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN)
      .map((w) => (w.deserializeAttachment() as { uid: string }).uid));
    let changed = false;
    for (const [uid, at] of Object.entries(gone)) {
      if (connected.has(uid)) { delete gone[uid]; changed = true; continue; }
      if (now - at < VOICE_DROP_GRACE_MS) continue;
      delete gone[uid];
      changed = true;
      const t = this.table ?? (await this.load());
      if (t?.voice?.[uid]) {
        const who = memberName(t, uid);
        await this.save(withoutVoice(await this.accountVoice(t), uid));
        this.broadcast(who ? [`${who} غادر المحادثة الصوتية`] : [], uid);
      }
    }
    if (changed) await this.ctx.storage.put('voiceGone', gone);
  }

  // ───── الروبوتات والتوزيع التلقائي ─────

  private async schedule() {
    const t = await this.load();
    // لا أحد متصل: لا داعي لتشغيل الروبوتات، ننتظر مهلة الإغلاق فقط
    const emptySince = await this.ctx.storage.get<number>('emptySince');
    if (emptySince) {
      await this.ctx.storage.setAlarm(emptySince + this.grace());
      return;
    }
    const step = t ? nextAutoStep(t, rng) : null;
    // في التطوير المحلي نسرّع الروبوتات للاختبار
    const botAt = step ? Date.now() + (this.env.DEV_AUTH === '1' ? 5 : step.delayMs) : null;
    if (botAt) await this.ctx.storage.put('botAt', botAt);
    else await this.ctx.storage.delete('botAt');
    const awayAt = t ? nextAwayDeadline(t) : null;
    const lobbyAt = t ? nextLobbyDeadline(t) : null;
    const voiceAt = await this.nextVoiceDrop();
    // فحص النبضات ما دام فيه اتصالات تنبض
    const beating = this.ctx.getWebSockets().some((w) => w.readyState === WebSocket.OPEN && this.ctx.getWebSocketAutoResponseTimestamp(w));
    const staleAt = beating ? Date.now() + STALE_CHECK_MS : null;
    const at = Math.min(botAt ?? Infinity, awayAt ?? Infinity, lobbyAt ?? Infinity, voiceAt ?? Infinity, staleAt ?? Infinity);
    if (Number.isFinite(at)) await this.ctx.storage.setAlarm(at);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const t = await this.load();
    if (!t) return;
    await this.dropStale();
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
    await this.dropExpiredVoice();
    // انتهت مهلة لاعب منقطع: روبوت مكانه (عملة من المالك إن توفرت — اللعب لا يتوقف لأجلها)
    let cur = this.table ?? t;
    for (const uid of awayExpired(cur, Date.now())) {
      const seat = seatOf(cur, uid);
      const name = memberName(cur, uid) ?? 'لاعب';
      cur = replaceWithBot(cur, uid, rng);
      await this.save(cur);
      if (seat !== null) {
        await this.db().adjustCoins(cur.ownerUid, -COINS.addBot).catch(() => {});
        this.broadcast([`انتهت مهلة ${name}، وحلّ مكانه ${cur.seats[seat]!.username}`]);
      }
      await this.publish(cur);
    }
    // حلّت الروبوتات مكان آخر لاعب حقيقي ولا أحد متصل: تُحذف الطاولة
    if (this.onlyBots(cur)) { await this.closeTable(); return; }
    // خارج اللعب: انتهت مهلة منقطع فيخرج من الطاولة
    for (const uid of lobbyExpired(cur, Date.now())) {
      const name = memberName(cur, uid) ?? 'أحد الحاضرين';
      const r = leave(cur.voice?.[uid] ? await this.accountVoice(cur) : cur, uid);
      if (!hasHumans(r.table)) { await this.closeTable(); return; }
      cur = r.table;
      await this.save(cur);
      this.broadcast([`خرج ${name} من الطاولة لانقطاع اتصاله`, ...(r.newOwner ? [`أصبح ${r.newOwner} مالك الطاولة`] : [])]);
      await this.publish(cur);
    }
    // دور الروبوت (قد يوقظنا المنبه مبكراً لمهلة منقطع، فلا نسبق وقت تفكيره)
    const botAt = await this.ctx.storage.get<number>('botAt');
    const step = !botAt || botAt <= Date.now() + 50 ? nextAutoStep(cur, rng) : null;
    if (step) {
      const r = runAutoStep(cur, step, rng);
      await this.save(r.table);
      this.broadcast(r.events);
      if (r.table.game?.phase === 'matchOver' || ((r.table.domino || r.table.jackaroo || r.table.ludo) && !otherActive(r.table))) await this.publish(r.table);
    }
    if (step || !botAt || botAt <= Date.now() + 50) await this.schedule();
    else {
      const beating = this.ctx.getWebSockets().some((w) => w.readyState === WebSocket.OPEN && this.ctx.getWebSocketAutoResponseTimestamp(w));
      await this.ctx.storage.setAlarm(Math.min(botAt, nextAwayDeadline(cur) ?? Infinity, nextLobbyDeadline(cur) ?? Infinity, (await this.nextVoiceDrop()) ?? Infinity,
        beating ? Date.now() + STALE_CHECK_MS : Infinity));
    }
  }

  /** يرسل لكل متصل حالته الخاصة + الإعلانات. */
  /** except: لا تُرسل الإعلانات لهذا اللاعب (يسمع إعلانه الخاص من تطبيقه)، لكن تصله الحالة */
  private broadcast(events: string[], except?: string) {
    const t = this.table;
    if (!t) return;
    for (const ws of this.ctx.getWebSockets()) {
      const { uid } = ws.deserializeAttachment() as { uid: string };
      try {
        if (events.length && uid !== except) ws.send(JSON.stringify({ type: 'events', events }));
        ws.send(JSON.stringify({ type: 'state', view: viewFor(t, uid) }));
      } catch { /* اتصال مغلق */ }
    }
  }
}
