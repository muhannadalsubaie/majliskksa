import { DurableObject } from 'cloudflare:workers';
import type { Card, Rank, Seat, Suit } from '../../shared/baloot/cards';
import { RANKS, SUITS } from '../../shared/baloot/cards';
import { type Action, type Bid, IllegalAction } from '../../shared/baloot/game';
import { COINS } from '../../shared/economy';
import {
  type TableData, TableError, addBot, applyWithEvents, isFull, join, leave, newTable, nextAutoStep, peopleCount,
  runAutoStep, seatOf, start, viewFor,
} from '../../shared/table';
import type { Env } from './env';
import { Firestore } from './firestore';

/**
 * غرفة طاولة واحدة: تحفظ حالة اللعبة، تستقبل حركات اللاعبين عبر WebSocket،
 * تتحقق منها بمحرك القواعد، تشغّل الروبوتات، وترسل لكل شخص ما يحق له رؤيته فقط.
 */

type ClientMessage =
  | { type: 'action'; action: unknown }
  | { type: 'addBot'; seat: number }
  | { type: 'start' }
  | { type: 'leave' };

const rng = () => Math.random();

const isSeat = (n: unknown): n is Seat => n === 0 || n === 1 || n === 2 || n === 3;
const isSuit = (s: unknown): s is Suit => SUITS.includes(s as Suit);
const isCard = (c: unknown): c is Card =>
  typeof c === 'object' && c !== null && isSuit((c as Card).suit) && RANKS.includes((c as Card).rank as Rank);

/** يبني حركة من رسالة العميل. المقعد يُحدد من هوية المتصل، لا مما يرسله. */
function parseAction(raw: unknown, seat: Seat): Action | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'bid': {
      const b = a.bid as Record<string, unknown> | undefined;
      if (!b) return null;
      let bid: Bid | null = null;
      if (b.type === 'pass' || b.type === 'sun' || b.type === 'ashkal') bid = { type: b.type };
      else if (b.type === 'hokm' && isSuit(b.suit)) bid = { type: 'hokm', suit: b.suit };
      return bid ? { type: 'bid', seat, bid } : null;
    }
    case 'double': return { type: 'double', seat, locked: typeof a.locked === 'boolean' ? a.locked : undefined };
    case 'doublePass': return { type: 'doublePass', seat };
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
};

export class TableRoom extends DurableObject<Env> {
  private table: TableData | null = null;

  private db() {
    if (this.env.DEV_AUTH === '1') {
      // تطوير محلي: بدون Firestore
      return { adjustCoins: async () => 99, set: async () => {} } as unknown as Firestore;
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
        ownerName: t.seats.find((m) => m && !m.isBot)?.username ?? '',
        isPrivate: t.isPrivate,
        players: t.seats.filter(Boolean).length,
        people: peopleCount(t),
        status: !t.game ? 'waiting' : t.game.phase === 'matchOver' ? 'finished' : 'playing',
        updatedAt: new Date(),
      });
    } catch (e) {
      console.error('publish failed', e);
    }
  }

  // ───── استدعاءات من الخادم الرئيسي (RPC) ─────

  async create(id: string, owner: { uid: string; username: string }, isPrivate: boolean): Promise<void> {
    const t = newTable(id, owner, isPrivate, Date.now());
    await this.save(t);
    await this.publish(t);
  }

  async joinTable(user: { uid: string; username: string }): Promise<{ ok: true } | { error: string }> {
    const t = await this.load();
    if (!t) return { error: 'not-found' };
    try {
      const r = join(t, user);
      if (r.charge) await this.db().adjustCoins(user.uid, -COINS.joinTable);
      await this.save(r.table);
      this.broadcast([`انضم ${user.username}`]);
      await this.publish(r.table);
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async isMember(uid: string): Promise<boolean> {
    const t = await this.load();
    return !!t && (seatOf(t, uid) !== null || t.spectators.some((m) => m.uid === uid));
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
      const text = e instanceof IllegalAction ? code : ERRORS[code] ?? 'تعذّر تنفيذ الطلب';
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
        const next = start(t, rng);
        await this.save(next);
        this.broadcast(['بدأت المباراة — توزيع الأوراق']);
        await this.publish(next);
        break;
      }
      case 'leave': {
        const r = leave(t, uid);
        await this.save(r.table);
        this.broadcast([r.botReplaced ? 'غادر لاعب وحل مكانه روبوت' : 'غادر أحد الحاضرين']);
        await this.publish(r.table);
        break;
      }
    }
    await this.schedule();
  }

  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* already closed */ }
  }

  // ───── الروبوتات والتوزيع التلقائي ─────

  private async schedule() {
    const t = await this.load();
    const step = t ? nextAutoStep(t, rng) : null;
    // في التطوير المحلي نسرّع الروبوتات للاختبار
    if (step) await this.ctx.storage.setAlarm(Date.now() + (this.env.DEV_AUTH === '1' ? 5 : step.delayMs));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const t = await this.load();
    if (!t) return;
    const step = nextAutoStep(t, rng);
    if (step) {
      const r = runAutoStep(t, step, rng);
      await this.save(r.table);
      this.broadcast(r.events);
      if (r.table.game?.phase === 'matchOver') await this.publish(r.table);
    }
    await this.schedule();
  }

  /** يرسل لكل متصل حالته الخاصة + الإعلانات. */
  private broadcast(events: string[]) {
    const t = this.table;
    if (!t) return;
    for (const ws of this.ctx.getWebSockets()) {
      const { uid } = ws.deserializeAttachment() as { uid: string };
      try {
        if (events.length) ws.send(JSON.stringify({ type: 'events', events }));
        ws.send(JSON.stringify({ type: 'state', view: viewFor(t, uid) }));
      } catch { /* اتصال مغلق */ }
    }
  }
}
