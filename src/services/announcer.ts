// إعلان أحداث اللعبة لقارئات الشاشة (TalkBack / VoiceOver) + نطق اختياري داخل التطبيق.
//
// نستخدم منطقة "سجل" (role="log" + aria-live="polite"): كل إعلان يُضاف كسطر جديد،
// فيقرؤه قارئ الشاشة بالترتيب دون أن يقطع الإعلانُ التالي الإعلانَ السابق
// (بخلاف استبدال نص منطقة واحدة الذي قد يُسقط أحداثاً متتالية).
import { speak } from './speech';
import { isScreenReaderOn } from './screenReader';

let liveRegion: HTMLElement | null = null;
let speechEnabled = loadSpeechSetting();
const MAX_LINES = 20;

function loadSpeechSetting(): boolean {
  // مغلق افتراضياً: مستخدمو TalkBack/VoiceOver يسمعون الأحداث من قارئهم مباشرة،
  // وتشغيل نطق التطبيق معه يكرر الكلام.
  try { return localStorage.getItem('majlisk.speech') === 'on'; } catch { return false; }
}

export function mountAnnouncer(el: HTMLElement) {
  liveRegion = el;
}

export function announce(message: string) {
  if (!message) return;
  if (liveRegion) {
    const line = document.createElement('p');
    line.textContent = message;
    liveRegion.appendChild(line);
    while (liveRegion.childElementCount > MAX_LINES) liveRegion.firstElementChild?.remove();
  }
  // نطق التطبيق: للمستخدمين بدون قارئ شاشة النظام، أو مع قارئ التطبيق المدمج
  if (speechEnabled || isScreenReaderOn()) speak(message);
}

export function isSpeechEnabled() { return speechEnabled; }

export function setSpeechEnabled(on: boolean) {
  speechEnabled = on;
  try { localStorage.setItem('majlisk.speech', on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) speak('تم تفعيل النطق', true);
  announce(on ? 'تم تفعيل النطق' : 'تم إيقاف النطق');
}
