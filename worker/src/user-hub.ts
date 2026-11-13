import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * مركز اللاعب (واحد لكل مستخدم): الأصدقاء، طلبات الصداقة، الحالة (متصل/غير متصل)،
 * والدعوات الواردة للطاولات. التطبيق يبقي اتصالاً واحداً مفتوحاً معه طوال تشغيله،
 * فالحالة لحظية والدعوات تصل فوراً.
 */

export interface FriendInfo { uid: string; username: string }
export interface TableInvite { tableId: string; code: string; fromUid: string; fromName: string; at: number }

export interface HubState {
  friends: FriendInfo[];
  requests: FriendInfo[];
  invites: TableInvite[];
}

/** الدعوة صالحة لعشر دقائق */
const INVITE_TTL_MS = 10 * 60_000;
/** التطبيق ينبض كل 15 ثانية: من انقطعت نبضته أكثر من هذا يُعتبر غير متصل (انقطع نته بلا إغلاق للاتصال) */
const ONLINE_STALE_MS = 45_000;

export class UserHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // النبضة يرد عليها النظام مباشرة دون إيقاظ المركز، ونقرأ وقتها لنعرف أن الاتصال حي
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async map(key: string): Promise<Record<string, string>> {
    return (await this.ctx.storage.get<Record<string, string>>(key)) ?? {};
  }

  private async invitesNow(): Promise<TableInvite[]> {
    const all = (await this.ctx.storage.get<TableInvite[]>('invites')) ?? [];
    return all.filter((i) => Date.now() - i.at < INVITE_TTL_MS);
  }

  // ───── جوال واحد لكل حساب ─────

  /**
   * سجّل دخول من جوال جديد: يصير هو جوال الحساب، وأي جوال ثاني متصل يتسجل خروجه على طول.
   * الجوال اللي كان مقفل يتسجل خروجه أول ما يتصل (يشوف إن الجوال الحالي غيره)
   */
  async claimDevice(device: string) {
    if (!device) return;
    const before = await this.ctx.storage.get<string>('device');
    await this.ctx.storage.put('device', device);
    if (before !== device) this.logDevice(`دخول من جوال جديد ${device.slice(0, 6)} (كان ${before ? before.slice(0, 6) : 'ولا شي'})`);
    for (const ws of this.ctx.getWebSockets()) {
      const d = (ws.deserializeAttachment() as { device?: string } | null)?.device;
      if (d && d !== device) this.kickDevice(ws, `جوال ${d.slice(0, 6)} طلع لأن الحساب دخل من ${device.slice(0, 6)}`);
    }
  }

  /** هل هذا هو جوال الحساب الحالي؟ (التطبيق يتأكد قبل ما يسجّل خروجه) */
  async isCurrentDevice(device: string): Promise<boolean> {
    const current = await this.ctx.storage.get<string>('device');
    return !current || current === device;
  }

  /** سجل التشخيص: متى ولماذا انسجل خروج جوال (أول ٦ حروف من رقم الجوال بس) */
  private logDevice(line: string) {
    void this.env.HUBS.get(this.env.HUBS.idFromName('__slow__')).appendNote(`${new Date().toISOString()} حساب: ${line}`).catch(() => {});
  }

  private kickDevice(ws: WebSocket, why?: string) {
    if (why) this.logDevice(why);
    try {
      ws.send(JSON.stringify({ type: 'loggedOut', reason: 'other-device' }));
      ws.close(4001, 'other device');
    } catch { /* مغلق */ }
  }

  async getState(): Promise<HubState> {
    const friends = await this.map('friends');
    const requests = await this.map('requests');
    return {
      friends: Object.entries(friends).map(([uid, username]) => ({ uid, username })),
      requests: Object.entries(requests).map(([uid, username]) => ({ uid, username })),
      invites: await this.invitesNow(),
    };
  }

  // ───── إخفاء الظهور (الباقة الاحترافية): لين نهاية الاشتراك ─────
  async isHidden(): Promise<boolean> {
    return ((await this.ctx.storage.get<number>('hiddenUntil')) ?? 0) > Date.now();
  }

  /** until = نهاية الاشتراك (0 = يظهر). يطلع من قائمة المتصلين أو يرجع لها على طول */
  async setHidden(until: number) {
    await this.ctx.storage.put('hiddenUntil', until);
    const uid = await this.ctx.storage.get<string>('uid');
    const presence = this.env.PRESENCE.get(this.env.PRESENCE.idFromName('global'));
    if (!uid) return;
    if (until > Date.now()) await presence.hubOffline(uid).catch(() => {});
    else if (this.ctx.getWebSockets().length) await presence.hubOnline(uid).catch(() => {});
    this.notifyFriends();
  }

  /** تجدد الاشتراك: الإخفاء يمتد معه (لو كان مفعّل) */
  async extendHidden(until: number) {
    const cur = (await this.ctx.storage.get<number>('hiddenUntil')) ?? 0;
    if (cur > 0 && until > cur) await this.ctx.storage.put('hiddenUntil', until);
  }

  /** تنبيه يطلع للاعب داخل التطبيق لو كان مفتوح (مثل: وصلتك هدية الباقة الاحترافية) */
  async notify(text: string) { await this.push({ type: 'notice', text }); }

  /** يرسل الحالة لكل اتصالات هذا اللاعب (قد يكون مفتوحاً على أكثر من جهاز) */
  private async push(extra?: Record<string, unknown>) {
    const state = await this.getState();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: 'state', ...state }));
        if (extra) ws.send(JSON.stringify(extra));
      } catch { /* closed */ }
    }
  }

  /** آخر طاولة دخلها (للضغط المطوّل على اسمه في قائمة أصدقائه) */
  async setTable(id: string): Promise<void> {
    await this.ctx.storage.put('table', id);
  }

  async currentTable(): Promise<string | null> {
    return (await this.ctx.storage.get<string>('table')) ?? null;
  }

  async isOnline(): Promise<boolean> {
    return this.liveSockets().length > 0;
  }

  /** اتصالات حية: مفتوحة ووصلت منها نبضة (أو فُتحت) خلال المهلة */
  private liveSockets(except?: WebSocket): WebSocket[] {
    const now = Date.now();
    return this.ctx.getWebSockets().filter((w) => {
      if (w === except || w.readyState !== WebSocket.OPEN) return false;
      const opened = (w.deserializeAttachment() as { at?: number } | null)?.at ?? 0;
      const beat = this.ctx.getWebSocketAutoResponseTimestamp(w)?.getTime() ?? 0;
      return now - Math.max(opened, beat) < ONLINE_STALE_MS;
    });
  }

  /** تغيّرت حالة صديق (اتصل أو خرج): نبلغ تطبيق هذا اللاعب ليحدّث قائمة أصدقائه فوراً */
  async presence(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: 'presence' })); } catch { /* closed */ }
    }
  }

  /** نبلغ كل الأصدقاء أن حالتي تغيّرت */
  private notifyFriends() {
    this.ctx.waitUntil((async () => {
      const friends = Object.keys(await this.map('friends'));
      await Promise.all(friends.map((f) => this.env.HUBS.get(this.env.HUBS.idFromName(f)).presence().catch(() => {})));
    })());
  }

  async isFriend(uid: string): Promise<boolean> {
    return uid in (await this.map('friends'));
  }

  async hasRequestFrom(uid: string): Promise<boolean> {
    return uid in (await this.map('requests'));
  }

  async addRequest(from: FriendInfo): Promise<void> {
    const requests = await this.map('requests');
    if (from.uid in (await this.map('friends'))) return;
    requests[from.uid] = from.username;
    await this.ctx.storage.put('requests', requests);
    await this.push({ type: 'notice', text: `طلب صداقة من ${from.username}` });
  }

  async removeRequest(uid: string): Promise<void> {
    const requests = await this.map('requests');
    delete requests[uid];
    await this.ctx.storage.put('requests', requests);
    await this.push();
  }

  async addFriend(friend: FriendInfo, notice?: string): Promise<void> {
    const friends = await this.map('friends');
    friends[friend.uid] = friend.username;
    const requests = await this.map('requests');
    delete requests[friend.uid];
    await this.ctx.storage.put({ friends, requests });
    await this.push(notice ? { type: 'notice', text: notice } : undefined);
  }

  /** صديق تغيّر اسمه: نحدّث الاسم في قائمة الأصدقاء والطلبات */
  async renameFriend(uid: string, username: string): Promise<void> {
    const friends = await this.map('friends');
    const requests = await this.map('requests');
    if (!(uid in friends) && !(uid in requests)) return;
    if (uid in friends) friends[uid] = username;
    if (uid in requests) requests[uid] = username;
    await this.ctx.storage.put({ friends, requests });
    await this.push();
  }

  /** معرّفات الأصدقاء (لتحديث اسمي عندهم) */
  async friendIds(): Promise<string[]> {
    return Object.keys(await this.map('friends'));
  }

  async removeFriend(uid: string): Promise<void> {
    const friends = await this.map('friends');
    delete friends[uid];
    await this.ctx.storage.put('friends', friends);
    await this.push();
  }

  /** رموز إشعارات أجهزة المستخدم (آخر 5 أجهزة) */
  async addPushToken(token: string): Promise<void> {
    const list = ((await this.ctx.storage.get<string[]>('pushTokens')) ?? []).filter((t) => t !== token);
    list.push(token);
    await this.ctx.storage.put('pushTokens', list.slice(-5));
  }

  async pushTokens(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>('pushTokens')) ?? [];
  }

  async removePushTokens(dead: string[]): Promise<void> {
    if (!dead.length) return;
    const list = ((await this.ctx.storage.get<string[]>('pushTokens')) ?? []).filter((t) => !dead.includes(t));
    await this.ctx.storage.put('pushTokens', list);
  }

  async pushInvite(invite: TableInvite): Promise<void> {
    const invites = (await this.invitesNow()).filter((i) => i.tableId !== invite.tableId);
    invites.push(invite);
    await this.ctx.storage.put('invites', invites);
    await this.push({ type: 'invite', invite });
  }

  /** يأخذ الدعوة (ويحذفها) عند القبول أو الرفض */
  async takeInvite(tableId: string): Promise<TableInvite | null> {
    const invites = await this.invitesNow();
    const found = invites.find((i) => i.tableId === tableId) ?? null;
    await this.ctx.storage.put('invites', invites.filter((i) => i.tableId !== tableId));
    await this.push();
    return found;
  }

  /**
   * تسجيل مكافأة إعلان: يمنع تكرار نفس العملية، ويطبق الحد اليومي (بتوقيت السعودية).
   * يرجع 'ok' أو سبب الرفض.
   */
  async claimAdReward(transactionId: string, maxPerDay: number): Promise<'ok' | 'duplicate' | 'daily-limit'> {
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const log = (await this.ctx.storage.get<{ day: string; count: number; tx: string[] }>('ads')) ?? { day, count: 0, tx: [] };
    if (log.day !== day) { log.day = day; log.count = 0; }
    if (transactionId && log.tx.includes(transactionId)) return 'duplicate';
    if (log.count >= maxPerDay) return 'daily-limit';
    log.count++;
    if (transactionId) log.tx = [...log.tx, transactionId].slice(-50);
    await this.ctx.storage.put('ads', log);
    return 'ok';
  }

  async adsLeftToday(maxPerDay: number): Promise<number> {
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const log = await this.ctx.storage.get<{ day: string; count: number }>('ads');
    return log?.day === day ? Math.max(0, maxPerDay - log.count) : maxPerDay;
  }

  /** عدّاد استهلاك الصوت الشهري (بالثواني) — يُستخدم في نسخة واحدة عامة لكل الطاولات */
  async addVoiceUsage(seconds: number): Promise<number> {
    const month = new Date().toISOString().slice(0, 7);
    const u = (await this.ctx.storage.get<{ month: string; seconds: number }>('voiceUsage')) ?? { month, seconds: 0 };
    if (u.month !== month) { u.month = month; u.seconds = 0; }
    u.seconds += Math.max(0, seconds);
    await this.ctx.storage.put('voiceUsage', u);
    return u.seconds;
  }

  async voiceUsageSeconds(): Promise<number> {
    const u = await this.ctx.storage.get<{ month: string; seconds: number }>('voiceUsage');
    return u?.month === new Date().toISOString().slice(0, 7) ? u.seconds : 0;
  }

  /** ملاحظة تشخيصية قصيرة (تُستخدم لآخر سبب رفض لطلبات SSV) */
  // ───── الحظر: من حظرهم هذا اللاعب لا يدخلون أي طاولة يملكها ─────
  async ban(uid: string, username: string): Promise<void> {
    const banned = await this.map('banned');
    await this.ctx.storage.put('banned', { ...banned, [uid]: username });
  }

  async bans(): Promise<{ uid: string; username: string }[]> {
    return Object.entries(await this.map('banned')).map(([uid, username]) => ({ uid, username }));
  }

  async unban(uid: string): Promise<void> {
    const banned = await this.map('banned');
    delete banned[uid];
    await this.ctx.storage.put('banned', banned);
  }

  async isBanned(uid: string): Promise<boolean> {
    return uid in (await this.map('banned'));
  }

  /** الصورة الشخصية (صغيرة، مضغوطة من التطبيق): تُحفظ هنا مع وقت آخر تغيير */
  async setAvatar(data: ArrayBuffer | null, type = 'image/jpeg'): Promise<number> {
    const at = Date.now();
    if (data) await this.ctx.storage.put({ avatar: data, avatarType: type, avatarAt: at });
    else await this.ctx.storage.delete(['avatar', 'avatarType', 'avatarAt']);
    return at;
  }
  async getAvatar(): Promise<{ data: ArrayBuffer; type: string; at: number } | null> {
    const m = await this.ctx.storage.get(['avatar', 'avatarType', 'avatarAt']);
    const data = m.get('avatar') as ArrayBuffer | undefined;
    if (!data) return null;
    return { data, type: (m.get('avatarType') as string) ?? 'image/jpeg', at: (m.get('avatarAt') as number) ?? 0 };
  }

  // ───── تذاكر الدعم (في مركز واحد باسم __support__) ─────
  /** تذكرة جديدة: الصور تنحفظ لحالها (كل صورة مفتاح) */
  async supportCreate(t: { uid: string; username: string; kind: 'complaint' | 'question'; text: string }, images: ArrayBuffer[]): Promise<string> {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ticket: SupportTicket = { id, ...t, images: images.length, at: Date.now(), status: 'open', messages: [{ from: 'user', text: t.text, at: Date.now() }] };
    const put: Record<string, unknown> = { [`t:${id}`]: ticket };
    images.forEach((img, i) => { put[`img:${id}:${i}`] = img; });
    await this.ctx.storage.put(put);
    return id;
  }

  async supportList(uid?: string): Promise<SupportTicket[]> {
    const all = [...(await this.ctx.storage.list<SupportTicket>({ prefix: 't:' })).values()];
    return all.filter((t) => !uid || t.uid === uid).sort((a, b) => b.at - a.at).slice(0, 200);
  }

  async supportGet(id: string): Promise<SupportTicket | null> {
    return (await this.ctx.storage.get<SupportTicket>(`t:${id}`)) ?? null;
  }

  async supportImage(id: string, i: number): Promise<ArrayBuffer | null> {
    return (await this.ctx.storage.get<ArrayBuffer>(`img:${id}:${i}`)) ?? null;
  }

  /** رد على التذكرة: من المطور (تصير «تم الرد») أو من صاحبها (ترجع «مفتوحة») */
  async supportReply(id: string, from: 'user' | 'dev', text: string): Promise<SupportTicket | null> {
    const t = await this.supportGet(id);
    if (!t) return null;
    t.messages.push({ from, text, at: Date.now() });
    t.status = from === 'dev' ? 'answered' : 'open';
    await this.ctx.storage.put(`t:${id}`, t);
    return t;
  }

  async supportClose(id: string): Promise<void> {
    const t = await this.supportGet(id);
    if (t) { t.status = 'closed'; await this.ctx.storage.put(`t:${id}`, t); }
  }

  async setNote(note: string): Promise<void> { await this.ctx.storage.put('note', note.slice(0, 400)); }
  async getNote(): Promise<string> { return (await this.ctx.storage.get<string>('note')) ?? ''; }
  /** سجل تشخيص: آخر 80 سطر */
  async appendNote(line: string): Promise<void> {
    const lines = ((await this.ctx.storage.get<string>('note')) ?? '').split('\n').filter(Boolean);
    lines.push(line.slice(0, 200));
    await this.ctx.storage.put('note', lines.slice(-400).join('\n'));
  }

  /** حذف الحساب: يمسح كل بيانات اللاعب هنا ويغلق اتصالاته، ويرجع قائمة أصدقائه لإزالته عندهم */
  async wipe(): Promise<string[]> {
    const friends = Object.keys(await this.map('friends'));
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'account deleted'); } catch { /* closed */ } }
    await this.ctx.storage.deleteAll();
    return friends;
  }

  // ───── اتصال التطبيق ─────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('bad request', { status: 400 });
    const wasOnline = this.liveSockets().length > 0;
    const uid = request.headers.get('X-Uid') ?? '';
    const device = request.headers.get('X-Device') ?? '';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    // جوال قديم والحساب انفتح من جوال ثاني بعده: يتسجل خروجه (النسخ القديمة بدون رقم جوال ما تتأثر)
    if (device) {
      const current = await this.ctx.storage.get<string>('device');
      if (!current) await this.ctx.storage.put('device', device);
      else if (current !== device) {
        pair[1].serializeAttachment({ at: 0, uid });
        this.kickDevice(pair[1], `جوال ${device.slice(0, 6)} رجع يتصل والحساب صار على ${current.slice(0, 6)}`);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
    }
    pair[1].serializeAttachment({ at: Date.now(), uid, device });
    // عدد المتصلين في التطبيق كله: كل نسخ التطبيق تتصل هنا (حتى القديمة اللي ما تعرف غرفة المتصلين)
    // (المخفي ما ينحسب: الباقة الاحترافية)
    if (uid && await this.ctx.storage.get<string>('uid') !== uid) await this.ctx.storage.put('uid', uid);
    if (uid && !(await this.isHidden())) void this.env.PRESENCE.get(this.env.PRESENCE.idFromName('global')).hubOnline(uid).catch(() => {});
    pair[1].send(JSON.stringify({ type: 'state', ...(await this.getState()) }));
    // صار متصلاً: أصدقاؤه يشوفونه متصل فوراً
    if (!wasOnline) this.notifyFriends();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    // نبضة للإبقاء على الاتصال
    if (msg === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* already closed */ }
    // خرج من التطبيق (آخر اتصال له): أصدقاؤه يشوفونه غير متصل فوراً
    if (this.liveSockets(ws).length === 0) {
      this.notifyFriends();
      const uid = (ws.deserializeAttachment() as { uid?: string } | null)?.uid;
      if (uid) void this.env.PRESENCE.get(this.env.PRESENCE.idFromName('global')).hubOffline(uid).catch(() => {});
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}

export interface SupportTicket {
  id: string; uid: string; username: string;
  kind: 'complaint' | 'question';
  text: string;
  /** عدد الصور المرفقة (٠ إلى ٤) */
  images: number;
  at: number;
  status: 'open' | 'answered' | 'closed';
  messages: { from: 'user' | 'dev'; text: string; at: number }[];
}
