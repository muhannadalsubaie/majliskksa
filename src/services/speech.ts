// محرك النطق المشترك (Web Speech API) — سرعة واحدة لكل ما ينطقه التطبيق.

const RATE_KEY = 'majlisk.speechRate';
export const RATE_MIN = 0.5;
export const RATE_MAX = 3;
export const RATE_STEP = 0.25;

let rate = loadRate();

function loadRate(): number {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return v >= RATE_MIN && v <= RATE_MAX ? v : 1;
  } catch { return 1; }
}

export function getSpeechRate() { return rate; }

export function setSpeechRate(value: number) {
  rate = Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(value / RATE_STEP) * RATE_STEP));
  try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* ignore */ }
  return rate;
}

/** ينطق النص. interrupt=true يقطع أي كلام سابق (مناسب للاستكشاف باللمس). */
export function speak(text: string, interrupt = false) {
  if (!text || !('speechSynthesis' in window)) return;
  if (interrupt) window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar-SA';
  u.rate = rate;
  window.speechSynthesis.speak(u);
}
