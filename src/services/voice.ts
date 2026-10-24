// المحادثة الصوتية للطاولة عبر Cloudflare Realtime (WebRTC).
// كل شخص ينشر ميكروفونه في جلسة خاصة به، ويسحب أصوات بقية المنضمين إلى نفس الاتصال.
// الخادم (غرفة الطاولة) يمرر الطلبات ويتحقق أن الشخص في الطاولة ويملك جلسته.
// يبدأ الميكروفون مكتوماً دائماً (استماع فقط)، والكتم محلي: نوقف الصوت دون إعادة تفاوض.
import { useEffect, useState } from 'react';
import type { TableView } from '../../shared/table';
import { announce } from './announcer';
import { API_URL } from './api';
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

/** الانضمام: طلب إذن الميكروفون، نشره مكتوماً، ثم سحب أصوات الموجودين */
export function joinVoice(id: string, uid: string): Promise<void> {
  return serial(async () => {
    if (state.joined || state.busy) return;
    set({ busy: true });
    tableId = id;
    myUid = uid;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mic = stream.getAudioTracks()[0];
      mic.enabled = false; // يبدأ مكتوماً
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
      pc.ontrack = (e) => playRemote(e.transceiver.mid, e.track);
      const tx = pc.addTransceiver(mic, { direction: 'sendonly' });
      await pc.setLocalDescription(await pc.createOffer());
      const r = await request<{ sessionId: string; answer: Desc }>({
        op: 'publish', offer: pc.localDescription!.toJSON(), mid: tx.mid,
      });
      sessionId = r.sessionId;
      await pc.setRemoteDescription(r.answer);
      set({ joined: true, muted: true, busy: false });
      announce('انضممت للمحادثة الصوتية، الميكروفون مكتوم. اضغط زر الصوت لفتحه');
    } catch (e) {
      cleanup();
      const msg = (e as Error).name === 'NotAllowedError'
        ? 'لم يُسمح باستخدام الميكروفون. فعّله من إعدادات الجهاز للتطبيق'
        : (e as Error).message === 'voice-not-configured'
          ? 'المحادثة الصوتية غير مفعّلة بعد'
          : (e as Error).message === 'voice-limit'
            ? 'المحادثة الصوتية وصلت لحدها هذا الشهر، وترجع بداية الشهر الجاي'
            : 'تعذّر الانضمام للمحادثة الصوتية، حاول مرة أخرى';
      announce(msg);
      return;
    }
  }).then(() => syncVoice(members));
}

export function leaveVoice(): Promise<void> {
  return serial(async () => {
    if (!state.joined) return;
    await request({ op: 'leave' }).catch(() => {});
    cleanup();
    announce('غادرت المحادثة الصوتية');
  });
}

export function setVoiceMuted(muted: boolean): Promise<void> {
  if (!state.joined || !mic) return Promise.resolve();
  mic.enabled = !muted;
  set({ muted });
  announce(muted ? 'تم كتم الميكروفون' : 'الميكروفون مفتوح');
  return request({ op: 'mute', sessionId, muted }).then(() => {}, () => {});
}

/** يطابق الأصوات المسحوبة مع قائمة المنضمين: يسحب الجدد ويغلق من غادر */
export function syncVoice(list: TableView['voice']) {
  members = list;
  if (!state.joined) return Promise.resolve();
  return serial(async () => {
    if (!pc || !sessionId) return;
    const others = new Map(members.filter((m) => m.uid !== myUid).map((m) => [m.uid, m]));
    // من غادر (أو أعاد الانضمام بجلسة جديدة)
    const gone = [...pulled.keys()].filter((u) => !others.has(u));
    if (gone.length) {
      const mids = gone.map((u) => pulled.get(u)!);
      gone.forEach((u) => pulled.delete(u));
      mids.forEach(stopPlayer);
      await request({ op: 'close', sessionId, mids }).catch(() => {});
    }
    for (const uid of others.keys()) {
      if (pulled.has(uid)) continue;
      try {
        const r = await request<{ requiresImmediateRenegotiation?: boolean; sessionDescription?: Desc; tracks?: { mid?: string }[] }>(
          { op: 'pull', sessionId, uid },
        );
        const mid = r.tracks?.[0]?.mid;
        if (!mid) continue;
        pulled.set(uid, mid);
        if (r.requiresImmediateRenegotiation && r.sessionDescription) {
          await pc.setRemoteDescription(r.sessionDescription);
          await pc.setLocalDescription(await pc.createAnswer());
          await request({ op: 'renegotiate', sessionId, answer: pc.localDescription!.toJSON() });
        }
      } catch { /* نحاول مع التحديث التالي */ }
    }
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
  [...players.keys()].forEach(stopPlayer);
  pulled.clear();
  mic?.stop();
  mic = null;
  pc?.close();
  pc = null;
  sessionId = null;
  set({ joined: false, muted: true, busy: false });
}

/** عند الخروج من شاشة الطاولة: نغادر المحادثة بهدوء */
export function disposeVoice() {
  if (state.joined) void leaveVoice();
}

export function useVoice(): VoiceState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}
