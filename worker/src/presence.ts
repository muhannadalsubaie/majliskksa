import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

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

interface Who { uid: string; name: string; at: number }

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

  /** عدد اللاعبين المتصلين (اللاعب المفتوح على جهازين ينحسب مرة) */
  private count(except?: WebSocket): number {
    return new Set(this.live(except).map((l) => l.who.uid)).size;
  }

  private broadcast(except?: WebSocket) {
    const n = this.count(except);
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
    for (const { who } of this.live()) if (who.name && !seen.has(who.uid)) seen.set(who.uid, who.name);
    return [...seen].slice(0, MAX_LIST).map(([uid, username]) => ({ uid, username }));
  }

  async alarm() {
    const n = this.count();
    if (n !== this.lastSent) this.broadcast();
    // انقطعت النبضة عند أحد: نحذف اتصاله
    const alive = new Set(this.live().map((l) => l.ws));
    for (const ws of this.ctx.getWebSockets()) if (!alive.has(ws)) { try { ws.close(4000, 'stale'); } catch { /* مغلق */ } }
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  /** التطبيق يتصل (بعد التحقق من الدخول في الخادم الرئيسي) */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('bad request', { status: 400 });
    const url = new URL(request.url);
    const uid = url.searchParams.get('uid') ?? '';
    const name = url.searchParams.get('name') ?? '';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name, at: Date.now() } satisfies Who);
    pair[1].send(JSON.stringify({ type: 'online', count: this.count() }));
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
      for (const { who } of this.live()) if (who.name && !seen.has(who.uid)) seen.set(who.uid, who.name);
      const players = [...seen].map(([uid, username]) => ({ uid, username, me: uid === me }))
        .sort((a, b) => Number(b.me) - Number(a.me) || a.username.localeCompare(b.username, 'ar'))
        .slice(0, MAX_LIST);
      ws.send(JSON.stringify({ type: 'onlineList', count: seen.size, players }));
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
