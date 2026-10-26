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
  keepVoiceLevel(opts: { on: boolean }): Promise<void>;
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

/** يرسل نصاً لقارئ شاشة النظام مباشرة (الترتيب والتباعد يتولاهما announcer) */
export function systemAnnounce(text: string) {
  if (platform === 'android') Announce.announce({ text }).catch(() => {});
  else ScreenReader.speak({ value: text, language: 'ar' }).catch(() => {});
}

/**
 * أثناء المحادثة الصوتية (Android): يمنع خفض صوت اللاعبين كلما تكلم TalkBack.
 * في الآيفون الخفض من إعداد VoiceOver نفسه (الصوت ← خفض الصوت) ولا يتحكم به التطبيق.
 */
export function keepVoiceLevel(on: boolean) {
  if (platform === 'android') Announce.keepVoiceLevel({ on }).catch(() => {});
}
