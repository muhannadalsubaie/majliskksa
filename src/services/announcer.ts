// نطق أحداث اللعبة لقارئات الشاشة + نطق صوتي اختياري (Web Speech API).
import { speak } from './speech';
import { isScreenReaderOn } from './screenReader';

let liveRegion: HTMLElement | null = null;
let speechEnabled = loadSpeechSetting();

function loadSpeechSetting(): boolean {
  try { return localStorage.getItem('majlisk.speech') !== 'off'; } catch { return true; }
}

export function mountAnnouncer(el: HTMLElement) {
  liveRegion = el;
}

export function announce(message: string) {
  if (liveRegion) {
    liveRegion.textContent = '';
    // تأخير بسيط حتى تلتقط قارئات الشاشة التغيير حتى لو تكررت الرسالة
    setTimeout(() => { if (liveRegion) liveRegion.textContent = message; }, 30);
  }
  // قارئ الشاشة المدمج ينطق كل الإعلانات دائماً
  if (speechEnabled || isScreenReaderOn()) speak(message);
}

export function isSpeechEnabled() { return speechEnabled; }

export function setSpeechEnabled(on: boolean) {
  speechEnabled = on;
  try { localStorage.setItem('majlisk.speech', on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) announce('تم تفعيل النطق');
  else if (liveRegion) liveRegion.textContent = 'تم إيقاف النطق';
}
