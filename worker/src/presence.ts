import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { Firestore } from './firestore';

/**
 * المتصلون في التطبيق كله: غرفة وحدة يتصل فيها كل جوال مفتوح على التطبيق.
 * ترسل للكل عدد المتصلين (يتحدث على طول)، وتعطي قائمة أسمائهم لما أحد يطلبها.
 */

/** التطبيق ينبض كل 15 ثانية: اللي انقطعت نبضته أكثر من هذا ما ينحسب (انقطع نته بلا إغلاق) */
const STALE_MS = 45_000;
/** نجمع التغييرات القريبة في رسالة وحدة (ما نرسل لكل دخول وطلوع لحاله) */
const BATCH_MS = 1_500;
/** فحص دوري للي انقطعوا بصمت */
const SWEEP_MS = 30_000;
const MAX_LIST = 1000;
/** فحص اللي اتصلوا عن طريق مركزهم (كل نسخ التطبيق): هل باقين متصلين؟ */
const HUB_SWEEP_MS = 120_000;

/** hidden: مشترك أخفى ظهوره — ينحسب في العدد، بس ما يطلع في قائمة المتصلين */
interface Who { uid: string; name: string; at: number; hidden?: boolean }

export class Presence extends DurableObject<Env> {
  private lastSent = -1;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // النبضة يرد عليها النظام مباشرة دون إيقاظ الغرفة
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private live(except?: WebSocket): { ws: WebSocket; who: Who }[] {
    const now = Date.now();
    const out: { ws: WebSocket; who: Who }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const who = ws.deserializeAttachment() as Who | null;
      if (!who) continue;
      const beat = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? who.at;
      if (now - Math.max(beat, who.at) < STALE_MS) out.push({ ws, who });
    }
    return out;
  }

  /**
   * المتصلون عن طريق مركز اللاعب (/me/ws): كل نسخ التطبيق، حتى القديمة اللي ما تتصل بهالغرفة.
   * uid ← الاسم (فاضي لين نحتاجه في القائمة)
   */
  private hubs: Record<string, string> | null = null;
  private async hubMap(): Promise<Record<string, string>> {
    if (!this.hubs) this.hubs = (await this.ctx.storage.get<Record<string, string>>('hubs')) ?? {};
    return this.hubs;
  }
  private async saveHubs() { await this.ctx.storage.put('hubs', this.hubs ?? {}); }

  async hubOnline(uid: string) {
    const m = await this.hubMap();
    if (uid in m) return;
    m[uid] = '';
    await this.saveHubs();
    await this.soon();
  }

  /** أخفى ظهوره أو رجّعه: اتصالاته الحالية تنحسب في العدد، وتطلع في القائمة أو لا */
  async markHidden(uid: string, hidden: boolean) {
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as Who | null;
      if (who?.uid === uid) ws.serializeAttachment({ ...who, hidden });
    }
  }

  async hubOffline(uid: string) {
    const m = await this.hubMap();
    if (!(uid in m)) return;
    delete m[uid];
    await this.saveHubs();
    await this.soon();
  }

  /** عدد اللاعبين المتصلين (اللاعب المفتوح على جهازين ينحسب مرة) */
  private async total(except?: WebSocket): Promise<number> {
    const set = new Set(this.live(except).map((l) => l.who.uid).filter(Boolean));
    for (const u of Object.keys(await this.hubMap())) set.add(u);
    return set.size;
  }

  private async broadcast(except?: WebSocket) {
    const n = await this.total(except);
    this.lastSent = n;
    const msg = JSON.stringify({ type: 'online', count: n });
    for (const { ws } of this.live(except)) { try { ws.send(msg); } catch { /* مغلق */ } }
  }

  private async soon() {
    const cur = await this.ctx.storage.getAlarm();
    const at = Date.now() + BATCH_MS;
    if (cur === null || cur > at) await this.ctx.storage.setAlarm(at);
  }

  /** المتصلون الآن (كل لاعب مرة، واللي بدون اسم ما يطلع) — للقائمة مع طاولة كل واحد */
  async players(): Promise<{ uid: string; username: string }[]> {
    const seen = new Map<string, string>();
    for (const { who } of this.live()) if (who.name && !who.hidden && !seen.has(who.uid)) seen.set(who.uid, who.name);
    // المتصلون بنسخ قديمة: نجيب أسماءهم من ملفاتهم مرة وحدة ونحفظها
    const m = await this.hubMap();
    const missing = Object.keys(m).filter((u) => !seen.has(u) && !m[u]).slice(0, 200);
    if (missing.length) {
      const db = new Firestore(this.env.FIREBASE_PROJECT_ID, this.env.FIREBASE_SERVICE_ACCOUNT);
      await Promise.all(missing.map(async (u) => { try { m[u] = String((await db.get('users', u))?.username ?? ''); } catch { /* بدون اسم */ } }));
      await this.saveHubs();
    }
    for (const [u, name] of Object.entries(m)) if (name && !seen.has(u)) seen.set(u, name);
    return [...seen].slice(0, MAX_LIST).map(([uid, username]) => ({ uid, username }));
  }

  async alarm() {
    // كل دقيقتين: اللي اتصلوا عن طريق مركزهم، هل باقين متصلين؟ (لو انقطع نتهم بدون إغلاق)
    const lastSweep = (await this.ctx.storage.get<number>('hubSweep')) ?? 0;
    const m = await this.hubMap();
    if (Date.now() - lastSweep >= HUB_SWEEP_MS && Object.keys(m).length) {
      await this.ctx.storage.put('hubSweep', Date.now());
      const gone = (await Promise.all(Object.keys(m).map(async (u) => {
        const on = await this.env.HUBS.get(this.env.HUBS.idFromName(u)).isOnline().catch(() => true);
        return on ? null : u;
      }))).filter((u): u is string => !!u);
      if (gone.length) { for (const u of gone) delete m[u]; await this.saveHubs(); }
    }
    const n = await this.total();
    if (n !== this.lastSent) await this.broadcast();
    // انقطعت النبضة عند أحد: نحذف اتصاله
    const alive = new Set(this.live().map((l) => l.ws));
    for (const ws of this.ctx.getWebSockets()) if (!alive.has(ws)) { try { ws.close(4000, 'stale'); } catch { /* مغلق */ } }
    if (this.ctx.getWebSockets().length || Object.keys(m).length) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  /** التطبيق يتصل (بعد التحقق من الدخول في الخادم الرئيسي) */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('bad request', { status: 400 });
    const url = new URL(request.url);
    const uid = url.searchParams.get('uid') ?? '';
    const name = url.searchParams.get('name') ?? '';
    const hidden = url.searchParams.get('hidden') === '1';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name, at: Date.now(), ...(hidden ? { hidden } : {}) } satisfies Who);
    pair[1].send(JSON.stringify({ type: 'online', count: await this.total() }));
    await this.soon();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (raw === 'ping') { ws.send('pong'); return; }
    let msg: { type?: string };
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (msg.type === 'list') {
      const me = (ws.deserializeAttachment() as Who | null)?.uid;
      const seen = new Map<string, string>();
      // المخفي ما يطلع في القائمة (حتى لنفسه)، بس العدد يحسبه
      for (const { who } of this.live()) if (who.name && !who.hidden && !seen.has(who.uid)) seen.set(who.uid, who.name);
      const players = [...seen].map(([uid, username]) => ({ uid, username, me: uid === me }))
        .sort((a, b) => Number(b.me) - Number(a.me) || a.username.localeCompare(b.username, 'ar'))
        .slice(0, MAX_LIST);
      ws.send(JSON.stringify({ type: 'onlineList', count: await this.total(), players }));
    }
  }

  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* مغلق */ }
    await this.soon();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}
