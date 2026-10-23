// جسر إمكانية الوصول في تطبيق الجوال:
//  • Android: إضافة محلية (Announce) تعلن النص عبر TalkBack مباشرة (announceForAccessibility)
//  • iOS: ScreenReader.speak يرسل إعلاناً لـ VoiceOver
// ومعرفة إن كان قارئ شاشة النظام يعمل الآن، لنوجه الإعلانات إليه بدل منطقة aria-live
// (التي لا يقرؤها WebView بشكل موثوق).
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ScreenReader } from '@capacitor/screen-reader';

interface AnnouncePlugin {
  announce(opts: { text: string }): Promise<void>;
  isScreenReaderOn(): Promise<{ value: boolean }>;
}

const Announce = registerPlugin<AnnouncePlugin>('Announce');
const native = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

let systemReaderOn = false;
const listeners = new Set<(on: boolean) => void>();

function setOn(on: boolean) {
  if (on === systemReaderOn) return;
  systemReaderOn = on;
  listeners.forEach((fn) => fn(on));
}

async function refresh() {
  try {
    if (platform === 'android') setOn((await Announce.isScreenReaderOn()).value);
    else setOn((await ScreenReader.isEnabled()).value);
  } catch { /* ignore */ }
}

export function initNativeA11y() {
  if (!native) return;
  void refresh();
  ScreenReader.addListener('stateChange', ({ value }) => setOn(value)).catch(() => {});
  // احتياط: نعيد الفحص عند العودة للتطبيق
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
}

/** هل TalkBack/VoiceOver يعمل الآن (في تطبيق الجوال فقط) */
export function isSystemReaderOn() { return native && systemReaderOn; }

export function onSystemReaderChange(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// طابور الإعلانات: TalkBack/VoiceOver يقطع الإعلان إذا وصل غيره قبل أن ينتهي،
// فتضيع أوراق اللاعبين المتتالية. لذلك نجمع ما يصل خلال لحظة في جملة واحدة،
// ولا نرسل التالي حتى يقدَّر انتهاء السابق؛ وإن تراكمت إعلانات تُدمج كلها في إعلان واحد.
const BATCH_MS = 150;
const MS_PER_CHAR = 55;
const MIN_GAP_MS = 700;
let pending: string[] = [];
let busyUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  if (pending.length === 0) return;
  const wait = busyUntil - Date.now();
  if (wait > 0) { timer = setTimeout(flush, wait); return; }
  const text = pending.join('. ');
  pending = [];
  busyUntil = Date.now() + Math.max(MIN_GAP_MS, text.length * MS_PER_CHAR);
  if (platform === 'android') Announce.announce({ text }).catch(() => {});
  else ScreenReader.speak({ value: text, language: 'ar' }).catch(() => {});
}

/** يرسل الإعلان لقارئ شاشة النظام (بالترتيب ودون أن يقطع إعلانٌ إعلاناً) */
export function systemAnnounce(text: string) {
  pending.push(text);
  if (!timer) timer = setTimeout(flush, BATCH_MS);
}
