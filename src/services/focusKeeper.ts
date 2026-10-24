// حارس التركيز: عندما يختفي العنصر الذي عليه التركيز (ورقة لُعبت، زر مزايدة انتهى دوره...)
// يقفز مؤشر TalkBack/VoiceOver إلى أعلى الصفحة. هنا نحفظ جيران العنصر لحظة التركيز عليه،
// وإذا اختفى نعيد التركيز لأقرب جار ما زال موجوداً (الورقة المجاورة، أو العنصر بجانب الزر).

const FOCUSABLE = [
  'button', 'a[href]', 'input', 'select', 'textarea', '[tabindex]', '[role="button"]', '[role="switch"]', '[role="tab"]',
].join(',');

let last: HTMLElement | null = null;
let after: HTMLElement[] = [];
let before: HTMLElement[] = [];

const usable = (el: HTMLElement) =>
  el.isConnected && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null;

function remember(el: HTMLElement) {
  last = el;
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(usable);
  const i = all.indexOf(el);
  after = i < 0 ? [] : all.slice(i + 1, i + 6);
  before = i < 0 ? [] : all.slice(Math.max(0, i - 5), i).reverse();
}

function restore() {
  const active = document.activeElement;
  if (!last || last === active) return;
  // التركيز ما زال على شيء حي غير الصفحة نفسها: لا نتدخل
  if (active && active !== document.body && active !== document.documentElement) return;
  if (usable(last)) return; // العنصر نفسه ما زال موجوداً
  // في نفس المجموعة أولاً (الورقة المجاورة في يدك)، ثم العنصر الذي قبله مباشرة
  // (مثل سطر الدور فوق أزرار المزايدة)، ثم ما بعده
  const sameGroup = (el: HTMLElement) => el.parentElement === last!.parentElement;
  const target = after.find((el) => usable(el) && sameGroup(el))
    ?? before.find((el) => usable(el) && sameGroup(el))
    ?? before.find(usable)
    ?? after.find(usable);
  if (target) target.focus({ preventScroll: false });
}

export function initFocusKeeper() {
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLElement && e.target !== document.body) remember(e.target);
  });
  // بعد أي تغيير في الصفحة نتحقق هل ضاع التركيز
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; restore(); });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-hidden'] });
}
