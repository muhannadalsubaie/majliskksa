// المحادثة الصوتية للطاولة عبر Cloudflare Realtime (WebRTC).
// كل شخص ينشر ميكروفونه في جلسة خاصة به، ويسحب أصوات بقية المنضمين إلى نفس الاتصال.
// الخادم (غرفة الطاولة) يمرر الطلبات ويتحقق أن الشخص في الطاولة ويملك جلسته.
// يبدأ الميكروفون مكتوماً دائماً (استماع فقط)، والكتم محلي: نوقف الصوت دون إعادة تفاوض.
import { useEffect, useState } from 'react';
import type { TableView } from '../../shared/table';
import { announce } from './announcer';
import { API_URL } from './api';
import { backgroundVoice, keepVoiceLevel } from './nativeA11y';
import { getToken } from './tables';

export interface VoiceState { joined: boolean; muted: boolean; busy: boolean }

type Desc = { type: 'offer' | 'answer'; sdp: string };

let state: VoiceState = { joined: false, muted: true, busy: false };
const listeners = new Set<(s: VoiceState) => void>();

let tableId: string | null = null;
let pc: RTCPeerConnection | null = null;
let mic: MediaStreamTrack | null = null;
let sessionId: string | null = null;
/** من أسحب صوته: uid → mid، وعناصر التشغيل لكل mid */
const pulled = new Map<string, string>();
const players = new Map<string, HTMLAudioElement>();
/** آخر قائمة منضمين من الخادم */
let members: TableView['voice'] = [];
let myUid = '';

// كل عمليات التفاوض متسلسلة (WebRTC لا يقبل عرضين في نفس اللحظة)
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

function set(next: Partial<VoiceState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn(state));
}

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_URL}/tables/${tableId}/voice`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http-${res.status}`);
  return data as T;
}

/**
 * الانضمام (تلقائي عند دخول الطاولة): جلسة استماع فقط بلا ميكروفون — لا يُطلب إذن الميكروفون
 * ولا يُسمع صوتك حتى تفتحه بنفسك أول مرة.
 */
export function joinVoice(id: string, uid: string, mode: 'manual' | 'auto' | 'rejoin' = 'manual'): Promise<void> {
  return serial(async () => {
    if (state.joined || state.busy) return;
    set({ busy: true });
    tableId = id;
    myUid = uid;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
      pc.ontrack = (e) => playRemote(e.transceiver.mid, e.track);
      // انقطع اتصال الصوت نفسه (تغيّر الشبكة، مكالمة): نعيد الانضمام مكتومين
      const thisPc = pc;
      pc.onconnectionstatechange = () => {
        if (thisPc === pc && thisPc.connectionState === 'failed' && state.joined && !leaving) void rejoin();
      };
      const r = await request<{ sessionId: string }>({ op: 'session' });
      sessionId = r.sessionId;
      // نضيف أنفسنا محلياً حتى لا تبدو القائمة القديمة وكأن الخادم أخرجنا
      members = [...members.filter((m) => m.uid !== uid), { uid, username: '', sessionId: r.sessionId, muted: true, mic: false }];
      set({ joined: true, muted: true, busy: false });
      keepVoiceLevel(true);
      backgroundVoice(true);
      autoRetries = 0;
      if (mode !== 'rejoin') announce('أنت في المحادثة الصوتية تسمع الآخرين، والميكروفون مغلق. اضغط زر الميكروفون لفتحه');
    } catch (e) {
      cleanup();
      const code = (e as Error).message;
      // الانضمام التلقائي يفشل بصمت، ويعيد المحاولة بعد قليل إن كان الخطأ عابراً (شبكة)
      if (mode !== 'manual' && code !== 'voice-not-configured' && code !== 'voice-limit' && autoRetries < 3) {
        autoRetries++;
        setTimeout(() => { if (!state.joined && tableId === id) void joinVoice(id, uid, mode); }, 5000 * autoRetries);
      }
      if (mode === 'manual') {
        announce(code === 'voice-not-configured' ? 'المحادثة الصوتية غير مفعّلة بعد'
          : code === 'voice-limit' ? 'المحادثة الصوتية وصلت لحدها هذا الشهر، وترجع بداية الشهر الجاي'
            : 'تعذّر الانضمام للمحادثة الصوتية، حاول مرة أخرى');
      }
      return;
    }
  }).then(() => syncVoice(members));
}

let autoRetries = 0;

/** خروج مقصود: حتى لا يظن التحديث القادم من الخادم (وأنت لست في القائمة) أنه انقطاع فيعيدك */
let leaving = false;

export function leaveVoice(quiet = false): Promise<void> {
  if (state.joined) leaving = true;
  return serial(async () => {
    if (!state.joined) return;
    try {
      await request({ op: 'leave' }).catch(() => {});
      cleanup();
      if (!quiet) announce('أنت خارج المحادثة الصوتية');
    } finally {
      leaving = false;
    }
  });
}

/** فتح/كتم الميكروفون. أول فتح يطلب إذن الميكروفون وينشره في الجلسة. */
export function setVoiceMuted(muted: boolean): Promise<void> {
  if (!state.joined) return Promise.resolve();
  // كتمه مالك الطاولة: لا يستطيع فتح الميكروفون حتى يلغي المالك الكتم
  if (!muted && members.find((m) => m.uid === myUid)?.blocked) {
    announce('كتمك مالك الطاولة، لا يمكنك فتح الميكروفون الآن');
    return Promise.resolve();
  }
  if (mic) {
    mic.enabled = !muted;
    set({ muted });
    announce(muted ? 'الميكروفون مغلق' : 'الميكروفون مفتوح');
    return request({ op: 'mute', sessionId, muted }).then(() => {}, () => {});
  }
  if (muted) return Promise.resolve();
  return serial(async () => {
    if (!pc || !sessionId || mic) return;
    set({ busy: true });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mic = stream.getAudioTracks()[0];
      const tx = pc.addTransceiver(mic, { direction: 'sendonly' });
      await pc.setLocalDescription(await pc.createOffer());
      const r = await request<{ answer: Desc; sessionId?: string }>({ op: 'publish', sessionId, offer: pc.localDescription!.toJSON(), mid: tx.mid });
      // الخادم أنشأ جلسة جديدة (انتهت جلسة الاستماع لخمولها)
      if (r.sessionId && r.sessionId !== sessionId) sessionId = r.sessionId;
      await pc.setRemoteDescription(r.answer);
      set({ muted: false, busy: false });
      backgroundVoice(true, true); // من الآن تحتاج الخدمة صلاحية الميكروفون في الخلفية
      announce('الميكروفون مفتوح');
    } catch (e) {
      mic?.stop();
      mic = null;
      set({ busy: false, muted: true });
      announce((e as Error).name === 'NotAllowedError'
        ? 'لم يُسمح باستخدام الميكروفون. فعّله من إعدادات الجهاز للتطبيق'
        : 'تعذّر فتح الميكروفون، حاول مرة أخرى');
    }
  });
}

/** مهلة قبل اعتبار غيابنا عن قائمة الخادم انقطاعاً حقيقياً */
const MISSING_GRACE_MS = 4000;
let missingTimer: ReturnType<typeof setTimeout> | null = null;

/** يطابق الأصوات المسحوبة مع قائمة المنضمين: يسحب الجدد ويغلق من غادر */
type PullResponse = { requiresImmediateRenegotiation?: boolean; sessionDescription?: Desc; tracks?: { mid?: string }[]; sessionId?: string };

export function syncVoice(list: TableView['voice']) {
  members = list;
  if (!state.joined || state.busy) return Promise.resolve();
  // لسنا في قائمة الخادم: قد تكون حالة قديمة وصلت قبل تسجيل انضمامنا (لا نتصرف فوراً)،
  // أو أخرجنا الخادم فعلاً (انقطع اتصالنا بالطاولة). نتحقق بعد مهلة من آخر قائمة وصلت، ثم نعود مكتومين.
  if (!members.some((m) => m.uid === myUid)) {
    if (!leaving && !missingTimer) {
      missingTimer = setTimeout(() => {
        missingTimer = null;
        if (state.joined && !state.busy && !leaving && !members.some((m) => m.uid === myUid)) void rejoin();
      }, MISSING_GRACE_MS);
    }
    return Promise.resolve();
  }
  if (missingTimer) { clearTimeout(missingTimer); missingTimer = null; }
  // كتمني المالك وميكروفوني مفتوح: نغلقه فوراً
  if (members.find((m) => m.uid === myUid)?.blocked && mic && !state.muted) {
    mic.enabled = false;
    set({ muted: true });
    announce('كتمك مالك الطاولة في المحادثة الصوتية');
  }
  return serial(async () => {
    if (!pc || !sessionId) return;
    // المفتاح uid + الجلسة: من أعاد الانضمام بجلسة جديدة نسحب صوته من جديد
    const key = (m: { uid: string; sessionId: string }) => `${m.uid}:${m.sessionId}`;
    // من كتمه المالك لا نسحب صوته (والخادم يرفض سحبه أصلاً)
    const others = new Map(members.filter((m) => m.uid !== myUid && m.mic && !m.blocked).map((m) => [key(m), m]));
    const gone = [...pulled.keys()].filter((k) => !others.has(k));
    if (gone.length) {
      const mids = gone.map((k) => pulled.get(k)!);
      gone.forEach((k) => pulled.delete(k));
      mids.forEach(stopPlayer);
      await request({ op: 'close', sessionId, mids }).catch(() => {});
    }
    for (const [k, m] of others) {
      if (pulled.has(k)) continue;
      try {
        const r: PullResponse = await request<PullResponse>({ op: 'pull', sessionId, uid: m.uid });
        if (r.sessionId && r.sessionId !== sessionId) sessionId = r.sessionId; // جلسة جديدة بعد خمول
        const mid = r.tracks?.[0]?.mid;
        if (!mid) continue;
        pulled.set(k, mid);
        if (r.requiresImmediateRenegotiation && r.sessionDescription) {
          await pc.setRemoteDescription(r.sessionDescription);
          await pc.setLocalDescription(await pc.createAnswer());
          await request({ op: 'renegotiate', sessionId, answer: pc.localDescription!.toJSON() });
        }
      } catch { /* نحاول مع التحديث التالي */ }
    }
  });
}

/** إعادة الانضمام بهدوء بعد انقطاع (الميكروفون يعود مكتوماً) */
let rejoining = false;
function rejoin(): Promise<void> {
  if (rejoining || leaving || !tableId) return Promise.resolve();
  rejoining = true;
  const id = tableId;
  cleanup();
  return joinVoice(id, myUid, 'rejoin').finally(() => { rejoining = false; });
}

// بعد مكالمة هاتفية قد يتوقف الميكروفون أو ينقطع اتصال الصوت: نصلحه عند العودة للتطبيق
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.joined || state.busy) return;
    // 'disconnected' عابر غالباً ويتعافى وحده؛ نعيد الانضمام فقط عند فشل حقيقي
    const broken = mic?.readyState === 'ended' || !pc || ['failed', 'closed'].includes(pc.connectionState);
    if (broken) void rejoin();
  });
}

function playRemote(mid: string | null, track: MediaStreamTrack) {
  if (!mid) return;
  stopPlayer(mid);
  const audio = new Audio();
  audio.autoplay = true;
  audio.srcObject = new MediaStream([track]);
  void audio.play().catch(() => {});
  players.set(mid, audio);
}

function stopPlayer(mid: string) {
  const a = players.get(mid);
  if (!a) return;
  a.pause();
  a.srcObject = null;
  players.delete(mid);
}

function cleanup() {
  if (missingTimer) { clearTimeout(missingTimer); missingTimer = null; }
  [...players.keys()].forEach(stopPlayer);
  pulled.clear();
  mic?.stop();
  mic = null;
  pc?.close();
  pc = null;
  sessionId = null;
  keepVoiceLevel(false);
  backgroundVoice(false);
  set({ joined: false, muted: true, busy: false });
}

/** عند الخروج من شاشة الطاولة: نغادر المحادثة بهدوء */
export function disposeVoice() {
  // عبر الطابور: حتى لو كان الانضمام التلقائي ما زال جارياً نغادر بعده
  void leaveVoice(true);
}

// للتشخيص والاختبارات الآلية: حالة الصوت الحالية (بلا أي بيانات حساسة)
if (typeof window !== 'undefined') {
  (window as unknown as { __voice: () => unknown }).__voice = () => ({
    ...state, pc: pc?.connectionState ?? null, players: players.size, pulled: pulled.size, members: members.length,
  });
}

export function useVoice(): VoiceState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}
