// إعلان أحداث اللعبة لقارئات الشاشة (TalkBack / VoiceOver) + نطق اختياري داخل التطبيق.
//
// قارئ الشاشة يقطع الإعلان إذا وصل غيره قبل أن ينتهي، فتضيع حركات اللاعبين المتتالية.
// لذلك كل الإعلانات تمر بطابور: نجمع ما يصل خلال لحظة في جملة واحدة، ولا نرسل التالي
// حتى يقدَّر انتهاء السابق (وما يتراكم يُدمج في إعلان واحد).
//  • تطبيق الجوال مع TalkBack/VoiceOver: الإعلان يذهب للنظام مباشرة
//  • المتصفح: منطقتا aria-live نبدّل بينهما ونفرغ النص ثم نكتبه بعد لحظة — الطريقة الأوثق
//    مع TalkBack في Chrome (إضافة أسطر لمنطقة log لا يقرؤها دائماً)
import { speak } from './speech';
import { isScreenReaderOn } from './screenReader';
import { isSystemReaderOn, systemAnnounce } from './nativeA11y';

let regions: HTMLElement[] = [];
let active = 0;
let speechEnabled = loadSpeechSetting();

// الأحداث التي تصل في نفس اللحظة (رسالة واحدة من الخادم) تُدمج في إعلان واحد، ويُرسل فوراً.
// بعده ننتظر بقدر ما يحتاجه قارئ الشاشة لينطقه قبل الإعلان التالي حتى لا يقطعه؛ وهذا الانتظار
// يتبع "سرعة الإعلانات" في الإعدادات لتطابق سرعة نطق TalkBack/VoiceOver عند المستخدم.
const BATCH_MS = 0;
export const ANNOUNCE_PACES = [
  { id: 'slow', label: 'بطيئة', msPerChar: 85, minGap: 900 },
  { id: 'normal', label: 'عادية', msPerChar: 65, minGap: 700 },
  { id: 'fast', label: 'سريعة', msPerChar: 45, minGap: 450 },
  { id: 'fastest', label: 'سريعة جداً', msPerChar: 30, minGap: 300 },
] as const;
export type AnnouncePace = (typeof ANNOUNCE_PACES)[number]['id'];
const PACE_KEY = 'majlisk.announcePace';
let pace: AnnouncePace = loadPace();

function loadPace(): AnnouncePace {
  try {
    const v = localStorage.getItem(PACE_KEY);
    return ANNOUNCE_PACES.some((p) => p.id === v) ? (v as AnnouncePace) : 'fast';
  } catch { return 'fast'; }
}

export function getAnnouncePace() { return pace; }

export function setAnnouncePace(p: AnnouncePace) {
  pace = p;
  try { localStorage.setItem(PACE_KEY, p); } catch { /* ignore */ }
}

let pending: string[] = [];
let busyUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

// مفتاح جديد: نطق التطبيق يبدأ متوقفاً عند الجميع، ولا يُفعَّل إلا يدوياً من الإعدادات
const SPEECH_KEY = 'majlisk.appSpeechOn';

function loadSpeechSetting(): boolean {
  // مغلق افتراضياً: مستخدمو TalkBack/VoiceOver يسمعون الأحداث من قارئهم مباشرة،
  // وتشغيل نطق التطبيق معه يكرر الكلام.
  try { return localStorage.getItem(SPEECH_KEY) === 'on'; } catch { return false; }
}

export function mountAnnouncer(container: HTMLElement) {
  container.replaceChildren();
  regions = [0, 1].map(() => {
    const r = document.createElement('div');
    r.setAttribute('aria-live', 'polite');
    r.setAttribute('aria-atomic', 'true');
    container.appendChild(r);
    return r;
  });
}

function deliver(text: string) {
  if (isSystemReaderOn()) { systemAnnounce(text); return; }
  if (!regions.length) return;
  // نفرغ المنطقتين، ثم نكتب في الأخرى بعد لحظة: يضمن أن يُعتبر كل إعلان تغييراً جديداً
  regions.forEach((r) => { r.textContent = ''; });
  active = 1 - active;
  const target = regions[active];
  setTimeout(() => { target.textContent = text; }, 30);
}

function flush() {
  timer = null;
  if (pending.length === 0) return;
  const wait = busyUntil - Date.now();
  if (wait > 0) { timer = setTimeout(flush, wait); return; }
  const text = pending.join('. ');
  pending = [];
  const p = ANNOUNCE_PACES.find((x) => x.id === pace)!;
  busyUntil = Date.now() + Math.max(p.minGap, text.length * p.msPerChar);
  deliver(text);
}

export function announce(message: string) {
  if (!message) return;
  pending.push(message);
  if (!timer) timer = setTimeout(flush, BATCH_MS);
  // نطق التطبيق: للمستخدمين بدون قارئ شاشة النظام، أو مع قارئ التطبيق المدمج (له طابوره الخاص)
  if (!isSystemReaderOn() && (speechEnabled || isScreenReaderOn())) speak(message);
}

export function isSpeechEnabled() { return speechEnabled; }

export function setSpeechEnabled(on: boolean) {
  speechEnabled = on;
  try { localStorage.setItem(SPEECH_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) speak('تم تفعيل النطق', true);
  announce(on ? 'تم تفعيل النطق' : 'تم إيقاف النطق');
}
