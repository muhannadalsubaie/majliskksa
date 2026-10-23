// قارئ الشاشة المدمج — استكشاف باللمس على طريقة TalkBack:
//  • لمس/سحب إصبع واحد: ينطق العنصر تحت الإصبع ويحدده
//  • لمستان سريعتان في أي مكان: تفعيل العنصر المحدد
//  • سحب سريع لليمين/اليسار: العنصر التالي/السابق
//  • إصبعان: تمرير الصفحة كالمعتاد
// يُترك مغلقاً لمن يستخدم TalkBack أو VoiceOver حتى لا يتعارضا.
import { speak } from './speech';

const KEY = 'majlisk.screenReader';
const DOUBLE_TAP_MS = 350;
const TAP_SLOP = 18;
const SWIPE_MIN = 60;

const SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea',
  '[role="button"]', '[role="checkbox"]', '[role="switch"]', '[role="alert"]', '[role="status"]',
  '[role="progressbar"]', '[role="alertdialog"] h2', 'h1', 'h2', 'h3', 'p', '[aria-label]', 'label > span',
].join(',');

let enabled = load();
let current: HTMLElement | null = null;
let attached = false;
let start: { x: number; y: number; t: number } | null = null;
let moved = false;
let lastTapAt = 0;
let pendingTap: ReturnType<typeof setTimeout> | null = null;
let multiTouch = false;
let lastScrollY: number | null = null;
const listeners = new Set<(on: boolean) => void>();

function load(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export function isScreenReaderOn() { return enabled; }

export function onScreenReaderChange(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setScreenReader(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) {
    attach();
    speak('تم تفعيل قارئ الشاشة. المس أي عنصر لسماعه، والمس مرتين لتفعيله، واسحب يميناً أو يساراً للتنقل.', true);
  } else {
    detach();
    speak('تم إيقاف قارئ الشاشة', true);
  }
  listeners.forEach((fn) => fn(on));
}

export function initScreenReader() {
  if (enabled) attach();
}

// ───── وصف العناصر ─────

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function labelFor(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(' ').map((id) => textOf(document.getElementById(id))).join(' ');
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const label = el.closest('label');
    if (label) {
      // نص التسمية بدون قيمة الحقل نفسه
      const clone = label.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input,textarea,select,[aria-live]').forEach((n) => n.remove());
      return textOf(clone);
    }
  }
  return textOf(el);
}

export function describe(el: HTMLElement): string {
  const label = labelFor(el);
  const tag = el.tagName;
  const role = el.getAttribute('role');
  const parts: string[] = [label];

  if (role === 'switch') {
    parts.push('مفتاح', el.getAttribute('aria-checked') === 'true' ? 'مفعّل' : 'غير مفعّل');
    const hintId = el.getAttribute('aria-describedby');
    const hint = hintId ? textOf(document.getElementById(hintId)) : '';
    if (hint) parts.push(hint);
  } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    parts.push('مربع اختيار', el.checked ? 'محدد' : 'غير محدد');
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    parts.push(el.type === 'password' ? 'حقل كلمة مرور' : 'حقل تعديل');
    if (el.type === 'password') parts.push(el.value ? `${el.value.length} أحرف` : 'فارغ');
    else parts.push(el.value || 'فارغ');
    const hintId = el.getAttribute('aria-describedby');
    const hint = hintId ? textOf(document.getElementById(hintId)) : '';
    if (hint) parts.push(hint);
  } else if (tag === 'BUTTON' || role === 'button' || tag === 'A') {
    parts.push(tag === 'A' ? 'رابط' : 'زر');
    if (el.getAttribute('aria-pressed') === 'true') parts.push('مفعّل');
    if ((el as HTMLButtonElement).disabled) parts.push('غير متاح');
  } else if (/^H[1-3]$/.test(tag)) {
    parts.push('عنوان');
  } else if (role === 'alert') {
    parts.unshift('تنبيه');
  }
  return parts.filter(Boolean).join('، ');
}

// ───── التنقل والتحديد ─────

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"], .sr-only');
}

function candidates(): HTMLElement[] {
  // داخل نافذة حوار مفتوحة نتنقل في الحوار فقط
  const scope = document.querySelector<HTMLElement>('[aria-modal="true"]') ?? document.body;
  // التلميحات المرتبطة بحقل (aria-describedby) تُقرأ مع الحقل نفسه، فلا نتوقف عندها
  const described = new Set([...scope.querySelectorAll('[aria-describedby]')].map((n) => n.getAttribute('aria-describedby')));
  const all = [...scope.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => visible(el) && !described.has(el.id));
  // نتجاهل العناصر الداخلية إن كان أحد أسلافها مرشحاً قابلاً للتفعيل (مثل نص داخل زر)
  return all.filter((el) => !all.some((o) => o !== el && o.contains(el) && o.matches('button, a[href], label, [role="button"]')));
}

function hit(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  const list = candidates();
  let node: HTMLElement | null = el;
  while (node) {
    if (list.includes(node)) return node;
    // لمس تسمية حقل يحدد الحقل نفسه
    if (node.tagName === 'LABEL') {
      const field = node.querySelector<HTMLElement>('input,textarea,select');
      if (field && list.includes(field)) return field;
    }
    node = node.parentElement;
  }
  return null;
}

/** يحدد عنصراً وينطقه. اللمس على مكان فارغ لا يلغي التحديد الحالي. */
function select(el: HTMLElement | null, repeat = false) {
  if (!el) return;
  if (el === current && !repeat) return;
  current?.classList.remove('sr-cursor');
  current = el;
  el.classList.add('sr-cursor');
  el.scrollIntoView({ block: 'nearest' });
  speak(describe(el), true);
  navigator.vibrate?.(8);
}

function step(dir: 1 | -1) {
  const list = candidates();
  if (!list.length) return;
  const i = current ? list.indexOf(current) : -1;
  const next = list[i + dir] ?? null;
  if (!next) { speak(dir === 1 ? 'نهاية الصفحة' : 'بداية الصفحة', true); return; }
  current?.classList.remove('sr-cursor');
  current = null;
  select(next);
}

function activate() {
  const el = current;
  if (!el || !document.contains(el)) { speak('المس عنصراً أولاً', true); return; }
  if (el instanceof HTMLInputElement && el.type !== 'checkbox' || el instanceof HTMLTextAreaElement) {
    el.focus();
    speak(`تحرير، ${labelFor(el)}`, true);
    return;
  }
  allowNextClick = true;
  el.click();
  allowNextClick = false;
  // بعد التفعيل: أعد وصف العنصر إن بقي في الصفحة (مثل مربع اختيار تغيّرت حالته)
  setTimeout(() => {
    if (current && document.contains(current) && (current.getAttribute('role') === 'switch' || (current instanceof HTMLInputElement && current.type === 'checkbox'))) {
      speak(describe(current), true);
    }
  }, 60);
}

// ───── معالجة اللمس ─────

let allowNextClick = false;
let lastHandledTouch = 0;

function onTouchStart(e: TouchEvent) {
  if (e.touches.length > 1) { multiTouch = true; start = null; return; } // إصبعان: تمرير
  // اللمس داخل حقل نشط للكتابة يبقى طبيعياً (تحريك المؤشر)
  if (document.activeElement === e.target && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
  e.preventDefault();
  const t = e.touches[0];
  start = { x: t.clientX, y: t.clientY, t: performance.now() };
  moved = false;
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length > 1) {
    // تمرير بإصبعين (يدوياً لأن اللمسة الأولى أوقفت التمرير الافتراضي)
    e.preventDefault();
    multiTouch = true;
    start = null;
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (lastScrollY !== null) window.scrollBy(0, lastScrollY - y);
    lastScrollY = y;
    return;
  }
  if (multiTouch || !start) return;
  e.preventDefault();
  const t = e.touches[0];
  if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP) moved = true;
  // استكشاف باللمس أثناء السحب البطيء
  if (performance.now() - start.t > 250) select(hit(t.clientX, t.clientY));
}

function onTouchEnd(e: TouchEvent) {
  if (multiTouch) { if (e.touches.length === 0) { multiTouch = false; lastScrollY = null; } return; }
  if (!start) return;
  e.preventDefault();
  lastHandledTouch = performance.now();
  const t = e.changedTouches[0];
  const dx = t.clientX - start.x;
  const dy = t.clientY - start.y;
  const dt = performance.now() - start.t;
  start = null;

  if (Math.abs(dx) > SWIPE_MIN && Math.abs(dy) < Math.abs(dx) * 0.6 && dt < 400) {
    if (pendingTap) { clearTimeout(pendingTap); pendingTap = null; }
    step(dx > 0 ? 1 : -1); // يمين = التالي، يسار = السابق (مثل TalkBack)
    lastTapAt = 0;
    return;
  }
  if (moved) { lastTapAt = 0; return; }

  // لمستان سريعتان في أي مكان من الشاشة = تفعيل العنصر المحدد مسبقاً.
  // لذلك لا نحدد شيئاً عند اللمسة الأولى إلا بعد التأكد أنها ليست بداية لمستين.
  const now = performance.now();
  if (pendingTap && now - lastTapAt < DOUBLE_TAP_MS) {
    clearTimeout(pendingTap);
    pendingTap = null;
    lastTapAt = 0;
    activate();
    return;
  }
  lastTapAt = now;
  const x = t.clientX;
  const y = t.clientY;
  pendingTap = setTimeout(() => {
    pendingTap = null;
    select(hit(x, y), true);
  }, DOUBLE_TAP_MS);
}

// يمنع فقط النقرات الناتجة عن لمسة عالجناها نحن (حتى لا تُفعِّل اللمسة الواحدة شيئاً).
// النقرات القادمة من TalkBack/VoiceOver أو لوحة المفاتيح لا تسبقها لمسة عندنا فتمر طبيعياً.
function onClick(e: MouseEvent) {
  if (allowNextClick) return;
  if ((e as PointerEvent).pointerType !== 'touch') return; // لوحة مفاتيح/قارئ نظام/نقرة برمجية
  if (performance.now() - lastHandledTouch > 700) return;
  e.preventDefault();
  e.stopPropagation();
}

function attach() {
  if (attached) return;
  attached = true;
  const opts = { capture: true, passive: false } as const;
  window.addEventListener('touchstart', onTouchStart, opts);
  window.addEventListener('touchmove', onTouchMove, opts);
  window.addEventListener('touchend', onTouchEnd, opts);
  window.addEventListener('click', onClick, true);
  document.documentElement.classList.add('sr-mode');
}

function detach() {
  if (!attached) return;
  attached = false;
  const opts = { capture: true } as const;
  window.removeEventListener('touchstart', onTouchStart, opts);
  window.removeEventListener('touchmove', onTouchMove, opts);
  window.removeEventListener('touchend', onTouchEnd, opts);
  window.removeEventListener('click', onClick, true);
  if (pendingTap) { clearTimeout(pendingTap); pendingTap = null; }
  current?.classList.remove('sr-cursor');
  current = null;
  document.documentElement.classList.remove('sr-mode');
}
