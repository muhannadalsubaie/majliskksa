import { Capacitor } from '@capacitor/core';
import { AdMob } from '@capacitor-community/admob';
import { announce } from './announcer';
import { API_URL } from './api';
import { connectFirebase } from './firebase';
import { getToken } from './tables';

/**
 * إعلانات المكافأة (AdMob) — تعمل داخل تطبيق الجوال فقط.
 * وحدات الإعلان الحقيقية تُضبط في .env؛ بدونها نستخدم وحدات Google التجريبية.
 * المكافأة يضيفها الخادم بعد تحقق Google (SSV)، لا التطبيق.
 */
const REAL_UNIT = Capacitor.getPlatform() === 'ios'
  ? (import.meta.env.VITE_ADMOB_REWARDED_IOS as string | undefined)
  : (import.meta.env.VITE_ADMOB_REWARDED_ANDROID as string | undefined);
const TEST_UNIT = Capacitor.getPlatform() === 'ios' ? 'ca-app-pub-3940256099942544/1712485313' : 'ca-app-pub-3940256099942544/5224354917';
const testing = !REAL_UNIT;

export const adsAvailable = () => Capacitor.isNativePlatform();

let initialized = false;

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${await getToken()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http-${res.status}`);
  return data as T;
}

/** يعرض إعلان مكافأة. يرجع رسالة النتيجة (تُعلن أيضاً لقارئ الشاشة). */
export async function watchRewardedAd(): Promise<string> {
  if (!adsAvailable()) return say('مشاهدة الإعلانات متاحة في تطبيق الجوال فقط');
  try {
    const status = await post<{ left: number }>('/ads/status');
    if (status.left <= 0) return say('وصلت للحد اليومي من الإعلانات، جرّب غداً');
    if (!initialized) { await AdMob.initialize({ initializeForTesting: testing }); initialized = true; }
    const { auth } = await connectFirebase();
    const uid = auth.currentUser?.uid ?? '';
    await AdMob.prepareRewardVideoAd({ adId: REAL_UNIT ?? TEST_UNIT, isTesting: testing, ssv: { userId: uid } });
    say('جارٍ عرض الإعلان');
    const reward = await AdMob.showRewardVideoAd();
    if (!reward || !reward.amount) return say('لم يكتمل الإعلان، فلم تُضف عملات');
    if (testing) {
      await post('/ads/test-reward');
      return say('أُضيفت عملتان إلى رصيدك');
    }
    // الإعلان الحقيقي: الخادم يضيف العملات بعد تأكيد Google خلال ثوانٍ
    return say('شكراً! ستُضاف عملتان إلى رصيدك خلال لحظات');
  } catch (e) {
    const code = (e as Error).message;
    if (code === 'daily-limit') return say('وصلت للحد اليومي من الإعلانات، جرّب غداً');
    return say('لا يتوفر إعلان الآن، حاول بعد قليل');
  }
}

function say(text: string) {
  announce(text);
  return text;
}
