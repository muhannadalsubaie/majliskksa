// الباقة الاحترافية: اشتراك شهري من المتجر (يتجدد تلقائياً)، أو هدية شهر يدفعها لاعب عن لاعب (ما تتجدد).
// ملف اللاعب يحفظ: proSubUntil (نهاية الاشتراك من المتجر)، proGiftUntil (نهاية الهدايا)، proUntil (الأبعد منهما).

/** معرّف منتج الاشتراك الشهري (نفسه في Google Play وApp Store) */
export const PRO_SUB_ID = 'pro_monthly';
/** معرّف منتج الهدية: شراء لمرة وحدة = شهر للاعب ثاني */
export const PRO_GIFT_ID = 'pro_gift_1m';
/** مدة الهدية */
export const PRO_GIFT_MS = 30 * 24 * 60 * 60 * 1000;

export const isPro = (proUntil: unknown, now = Date.now()) => typeof proUntil === 'number' && proUntil > now;

/** هدية جديدة: تنضاف بعد نهاية الهدية الحالية لو لسا شغالة، وإلا من الحين */
export const extendGift = (giftUntil: unknown, now = Date.now(), ms = PRO_GIFT_MS) =>
  Math.max(typeof giftUntil === 'number' ? giftUntil : 0, now) + ms;

/** نهاية الباقة = الأبعد من الاشتراك والهدية */
export const proUntilOf = (subUntil: unknown, giftUntil: unknown) =>
  Math.max(typeof subUntil === 'number' ? subUntil : 0, typeof giftUntil === 'number' ? giftUntil : 0);
