// إعلان أحداث اللعبة لقارئات الشاشة (TalkBack / VoiceOver، أو قارئ التطبيق المدمج).
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

// الأحداث التي تصل في نفس اللحظة (رسالة واحدة من الخادم) تُدمج في إعلان واحد، ويُرسل فوراً.
// بعده ننتظر بقدر ما يحتاجه قارئ الشاشة لينطقه قبل الإعلان التالي حتى لا يقطعه.
const BATCH_MS = 0;
// السرعة ثابتة على "سريعة جداً": أقل انتظار بين الإعلانات دون أن يقطع قارئ الشاشة جملته
// (مقاسة على نطق العربية في TalkBack/VoiceOver)، ومعها مهلة ثابتة لبدء النطق.
const MS_PER_CHAR = 40;
const MIN_GAP_MS = 450;
const START_MS = 200;

/** طول النطق التقريبي بالأحرف: الأرقام تُنطق كلمات أطول من رموزها (10 = "عشرة") */
function spokenLength(text: string): number {
  const digits = (text.match(/\d/g) ?? []).length;
  return text.length + digits * 3;
}

let pending: string[] = [];
let busyUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

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
  busyUntil = Date.now() + speakTime(text);
  deliver(text);
}

/** الوقت المقدّر لنطق النص */
function speakTime(text: string): number {
  return START_MS + Math.max(MIN_GAP_MS, spokenLength(text) * MS_PER_CHAR);
}

/**
 * ردّ فوري على طلب المستخدم نفسه (إيماءة، نقرة): يُنطق الآن دون انتظار الطابور،
 * ثم يكمل الطابور بعده. ما زال ينتظر في الطابور يبقى بترتيبه.
 */
export function announceNow(message: string) {
  if (!message) return;
  deliver(message);
  busyUntil = Date.now() + speakTime(message);
  if (pending.length) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, busyUntil - Date.now());
  }
  if (!isSystemReaderOn() && isScreenReaderOn()) speak(message, true);
}

export function announce(message: string) {
  if (!message) return;
  pending.push(message);
  if (!timer) timer = setTimeout(flush, BATCH_MS);
  // قارئ التطبيق المدمج (إن فعّله المستخدم ولا يعمل قارئ النظام): له طابوره الخاص
  if (!isSystemReaderOn() && isScreenReaderOn()) speak(message);
}
