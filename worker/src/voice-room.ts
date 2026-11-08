import { DurableObject } from 'cloudflare:workers';
import { VOICE_MONTHLY_LISTEN_HOURS } from '../../shared/economy';
import type { VoiceMember } from '../../shared/table';
import type { Env } from './env';
import { Realtime, type SessionDescription } from './realtime';

/**
 * غرفة المحادثة الصوتية لطاولة واحدة — منفصلة تماماً عن غرفة الطاولة (اللعب):
 * لها حفظها وطابورها الخاص، فما تقدر توقف حركات اللعب ولا تكتب فوقها، ولو تعطّلت يكمل اللعب عادي.
 * الطاولة تعطيها بس «مين عضو وش اسمه ومين مكتوم» (قراءة فقط)، وهي ترسل للطاولة قائمة المتكلمين لتعرضها.
 */

/** اسم مسار الميكروفون داخل جلسة كل شخص */
const VOICE_TRACK = 'mic';
/** انقطاع قصير لا يُخرج الشخص من المحادثة الصوتية إلا إن لم يعد خلال هذه المدة */
export const VOICE_DROP_GRACE_MS = 60_000;

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

/** ما تعطيه الطاولة عن الشخص: اسمه (null = مو في الطاولة) والمكتومين من المالك */
export interface VoiceInfo { name: string | null; blocked: string[] }

type Member = VoiceMember & { name: string };

/** خطأ Realtime لجلسة انتهت لخمولها (لم يتصل بها أي اتصال صوتي بعد) */
const isStaleSession = (e: unknown) => /session_error|disconnected/i.test(String((e as Error)?.message ?? e));

const isSdp = (d: unknown, type: 'offer' | 'answer'): d is SessionDescription =>
  typeof d === 'object' && d !== null && (d as SessionDescription).type === type
  && typeof (d as SessionDescription).sdp === 'string' && (d as SessionDescription).sdp.length < 20_000;

export class VoiceRoom extends DurableObject<Env> {
  private members: Record<string, Member> | null = null;
  private ver = 0;

  private async load(): Promise<Record<string, Member>> {
    if (!this.members) {
      this.members = (await this.ctx.storage.get<Record<string, Member>>('members')) ?? {};
      this.ver = (await this.ctx.storage.get<number>('ver')) ?? 0;
    }
    return this.members;
  }

  private usage() {
    return this.env.HUBS.get(this.env.HUBS.idFromName('__voice_usage__'));
  }

  /** العدّاد الشهري العام للاستماع (في الخلفية): يُحسب قبل أي تغيير في المنضمين */
  private async account(members: Record<string, Member>) {
    const now = Date.now();
    const list = Object.values(members);
    const listening = list.filter((m) => m.mic !== false).length * (list.length - 1);
    const since = (await this.ctx.storage.get<number>('since')) ?? now;
    if (listening > 0 && now > since) void this.usage().addVoiceUsage(((now - since) / 1000) * listening).catch((e) => console.error('voice usage', e));
    await this.ctx.storage.put('since', now);
  }

  /**
   * تعديل القائمة: على النسخة الحالية في الذاكرة مباشرة (بدون انتظار بين القراءة والكتابة) فما يضيع تعديل،
   * ثم نرسل القائمة الجديدة للطاولة لتعرضها (برقم نسخة: ما تعتمد قائمة أقدم لو وصلت متأخرة)
   */
  private async change(tableId: string, fn: (m: Record<string, Member>) => void, events: string[] = [], except?: string) {
    const members = await this.load();
    await this.account(members);
    fn(members);
    this.ver += 1;
    await this.ctx.storage.put({ members, ver: this.ver, tableId });
    await this.push(tableId, events, except);
  }

  private async push(tableId: string, events: string[] = [], except?: string) {
    const members = await this.load();
    const list: Record<string, VoiceMember> = Object.fromEntries(Object.entries(members).map(([u, m]) => [u, { sessionId: m.sessionId, muted: m.muted, mic: m.mic }]));
    await this.env.TABLES.get(this.env.TABLES.idFromString(tableId)).voiceChanged(list, this.ver, events, except)
      .catch((e) => console.error('voice push', (e as Error).message));
  }

  /** كل طلبات الصوت: الطاولة تأكدت قبلها إنه عضو (info) */
  async voice(tableId: string, uid: string, req: VoiceRequest, info: VoiceInfo): Promise<unknown> {
    const name = info.name;
    if (!name) throw new Error('not-a-member');
    if (!this.env.REALTIME_APP_ID || !this.env.REALTIME_APP_SECRET) throw new Error('voice-not-configured');
    const rt = new Realtime(this.env.REALTIME_APP_ID, this.env.REALTIME_APP_SECRET);
    const members = await this.load();
    const mine = members[uid];
    const blocked = (u: string) => info.blocked.includes(u);
    const own = (sessionId: unknown) => {
      if (!mine || mine.sessionId !== sessionId) throw new Error('bad-session');
      return mine.sessionId;
    };

    switch (req.op) {
      case 'session': {
        // الانضمام (تلقائياً عند دخول الطاولة): استماع فقط بلا ميكروفون، ويُعلن للبقية
        if ((await this.usage().voiceUsageSeconds()) >= VOICE_MONTHLY_LISTEN_HOURS * 3600) throw new Error('voice-limit');
        const connected = isSdp(req.offer, 'offer')
          ? await rt.connectedSession(req.offer).catch((e) => { console.error('voice session offer', (e as Error).message); return undefined; })
          : undefined;
        const sessionId = connected?.sessionId ?? await rt.newSession();
        await this.back(uid);
        // إعادة اتصال صامتة (كان في المحادثة): لا نعلن "انضم" مرة أخرى
        await this.change(tableId, (m) => { m[uid] = { sessionId, muted: true, mic: false, name }; }, mine ? [] : [`${name} انضم للمحادثة الصوتية`], uid);
        return connected ? { sessionId, answer: connected.answer } : { sessionId };
      }
      case 'publish': {
        let sessionId = own(req.sessionId);
        if (blocked(uid)) throw new Error('voice-blocked');
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
        await this.change(tableId, (m) => { m[uid] = { ...(m[uid] ?? mine!), sessionId, muted: false, mic: true }; });
        return { answer, sessionId };
      }
      case 'pull': {
        const sessionId = own(req.sessionId);
        const remote = typeof req.uid === 'string' ? members[req.uid] : undefined;
        if (!remote || remote.mic === false || req.uid === uid) throw new Error('bad-request');
        if (blocked(req.uid as string)) throw new Error('voice-blocked');
        // سحب بعرض من التطبيق (نسخ قديمة): نرفضه قبل ما يوصل للخدمة عشان الاتصال يبقى سليم
        if (req.offer !== undefined) throw new Error('bad-request');
        try {
          return await rt.pull(sessionId, remote.sessionId, VOICE_TRACK);
        } catch (e) {
          // جلسة المستمع انتهت لخمولها: جلسة جديدة له ثم نسحب الصوت إليها
          if (!isStaleSession(e) || mine!.mic) throw e;
          const fresh = await rt.newSession();
          await this.change(tableId, (m) => { m[uid] = { ...(m[uid] ?? mine!), sessionId: fresh }; });
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
        if (req.muted !== true && blocked(uid)) throw new Error('voice-blocked');
        await this.change(tableId, (m) => { if (m[uid]) m[uid] = { ...m[uid], muted: req.muted === true }; });
        return { ok: true };
      }
      case 'leave': {
        if (!mine) return { ok: true };
        await this.change(tableId, (m) => { delete m[uid]; }, [`${name} غادر المحادثة الصوتية`], uid);
        return { ok: true };
      }
      default:
        throw new Error('bad-request');
    }
  }

  // ───── أوامر من الطاولة (ما تنتظرها الطاولة: تُرسل وتكمل لعبها) ─────

  /** خرج من الطاولة (غادر، أُخرج، انتهت مهلته): يخرج من الصوت */
  async remove(tableId: string, uid: string, quiet = true): Promise<void> {
    const members = await this.load();
    const m = members[uid];
    if (!m) return;
    await this.back(uid);
    await this.change(tableId, (x) => { delete x[uid]; }, quiet ? [] : [`${m.name} غادر المحادثة الصوتية`], uid);
  }

  /** كتمه المالك: نسكّر ميكروفونه */
  async block(tableId: string, uid: string): Promise<void> {
    const members = await this.load();
    if (!members[uid] || members[uid].muted) return;
    await this.change(tableId, (x) => { if (x[uid]) x[uid] = { ...x[uid], muted: true }; });
  }

  /** انقطع اتصاله بالطاولة: يبقى في الصوت مهلة، وإن ما رجع يخرج */
  async gone(tableId: string, uid: string): Promise<void> {
    const members = await this.load();
    if (!members[uid]) return;
    const gone = (await this.ctx.storage.get<Record<string, number>>('gone')) ?? {};
    gone[uid] = Date.now();
    await this.ctx.storage.put({ gone, tableId });
    await this.scheduleDrop(gone);
  }

  /** رجع اتصاله: يبقى في المحادثة */
  async back(uid: string): Promise<void> {
    const gone = (await this.ctx.storage.get<Record<string, number>>('gone')) ?? {};
    if (gone[uid] === undefined) return;
    delete gone[uid];
    await this.ctx.storage.put('gone', gone);
  }

  /** الطاولة انقفلت: نحسب الاستهلاك ونمسح كل شي */
  async closeAll(): Promise<void> {
    const members = await this.load();
    await this.account(members);
    this.members = {};
    await this.ctx.storage.deleteAll();
  }

  /** الطاولة تطلب القائمة الحالية (بعد ما تصحى أو لو فاتها تحديث) */
  async current(tableId: string): Promise<void> {
    await this.load();
    await this.push(tableId);
  }

  private async scheduleDrop(gone: Record<string, number>) {
    const times = Object.values(gone);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times) + VOICE_DROP_GRACE_MS);
  }

  async alarm() {
    const gone = (await this.ctx.storage.get<Record<string, number>>('gone')) ?? {};
    const tableId = await this.ctx.storage.get<string>('tableId');
    const now = Date.now();
    const members = await this.load();
    const expired = Object.entries(gone).filter(([, at]) => now - at >= VOICE_DROP_GRACE_MS - 500).map(([u]) => u);
    for (const u of expired) delete gone[u];
    await this.ctx.storage.put('gone', gone);
    const leaving = expired.filter((u) => members[u]);
    if (tableId && leaving.length) {
      const names = leaving.map((u) => members[u].name);
      await this.change(tableId, (x) => { for (const u of leaving) delete x[u]; }, names.map((n) => `${n} غادر المحادثة الصوتية`));
    }
    await this.scheduleDrop(gone);
  }
}
