import { describe, expect, it } from 'vitest';
import { PRO_GIFT_MS, extendGift, isPro, proUntilOf } from './pro';

describe('الباقة الاحترافية', () => {
  it('مشترك لين تاريخ النهاية بس', () => {
    expect(isPro(2000, 1000)).toBe(true);
    expect(isPro(1000, 1000)).toBe(false);
    expect(isPro(undefined, 1000)).toBe(false);
    expect(isPro('2000', 1000)).toBe(false);
  });
  it('الهدية تنضاف بعد الهدية الشغالة، أو من الحين لو منتهية', () => {
    expect(extendGift(undefined, 1000)).toBe(1000 + PRO_GIFT_MS);
    expect(extendGift(500, 1000)).toBe(1000 + PRO_GIFT_MS);
    expect(extendGift(5000, 1000)).toBe(5000 + PRO_GIFT_MS);
  });
  it('نهاية الباقة هي الأبعد من الاشتراك والهدية', () => {
    expect(proUntilOf(3000, 9000)).toBe(9000);
    expect(proUntilOf(3000, undefined)).toBe(3000);
    expect(proUntilOf(undefined, undefined)).toBe(0);
  });
});
