// محرك النطق المشترك — سرعة واحدة لكل ما ينطقه التطبيق.
// في المتصفح: Web Speech API. في تطبيق الجوال: محرك النطق في الجهاز
// (WebView في Android لا يدعم speechSynthesis).
import { Capacitor } from '@capacitor/core';
import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';

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
  if (!text) return;
  if (Capacitor.isNativePlatform()) {
    TextToSpeech.speak({
      text, lang: 'ar-SA', rate,
      queueStrategy: interrupt ? QueueStrategy.Flush : QueueStrategy.Add,
    }).catch(() => {});
    return;
  }
  if (!('speechSynthesis' in window)) return;
  if (interrupt) window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar-SA';
  u.rate = rate;
  window.speechSynthesis.speak(u);
}
