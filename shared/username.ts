// أسماء المستخدمين — فريدة لكل لاعب لمنع انتحال الأسماء.
// التحقق النهائي من التفرّد يتم في الخادم؛ هذا الملف مشترك بين الواجهة والخادم.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;

// حروف عربية، حروف إنجليزية، أرقام (لاتينية وعربية-هندية)، وشرطة سفلية
const ALLOWED = /^[ء-غف-يa-zA-Z0-9٠-٩_]+$/;

export type UsernameError = 'too-short' | 'too-long' | 'invalid-chars' | 'only-underscores';

export const USERNAME_ERRORS: Record<UsernameError | 'taken' | 'already-set', string> = {
  'too-short': `اسم المستخدم قصير — ${USERNAME_MIN} أحرف على الأقل`,
  'too-long': `اسم المستخدم طويل — ${USERNAME_MAX} حرفاً كحد أقصى`,
  'invalid-chars': 'استخدم حروفاً عربية أو إنجليزية أو أرقاماً أو _ فقط، بدون مسافات',
  'only-underscores': 'يجب أن يحتوي اسم المستخدم على حرف أو رقم',
  taken: 'اسم المستخدم مأخوذ، جرّب اسماً آخر',
  'already-set': 'لديك اسم مستخدم مسبقاً',
};

/** يزيل التشكيل والتطويل والمسافات الطرفية — هذا هو الشكل الذي يُعرض. */
export function cleanUsername(raw: string): string {
  return raw.trim().replace(/[ً-ٰٟـ]/g, '');
}

export function validateUsername(raw: string): UsernameError | null {
  const name = cleanUsername(raw);
  if ([...name].length < USERNAME_MIN) return 'too-short';
  if ([...name].length > USERNAME_MAX) return 'too-long';
  if (!ALLOWED.test(name)) return 'invalid-chars';
  if (/^_+$/.test(name)) return 'only-underscores';
  return null;
}

/**
 * المفتاح الموحّد للتحقق من التفرّد: الأسماء المتشابهة شكلاً تعطي نفس المفتاح
 * (أحمد = احمد = أحـمد، Ahmed = ahmed، ٧ = 7).
 */
export function usernameKey(raw: string): string {
  return cleanUsername(raw)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
