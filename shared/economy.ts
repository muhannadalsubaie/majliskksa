// تكاليف الاقتصاد — مصدر واحد للحقيقة، والخصم الفعلي يتم في Cloud Functions فقط.
export const COINS = {
  signupBonus: 15,
  createTable: 2,
  joinTable: 1,
  inviteFriend: 1,
  addBot: 1,
  watchAdReward: 2,
} as const;

export const BOT_REPLACE_AFTER_MS = 3 * 60 * 1000;
// وقت تفكير الروبوت قبل كل حركة (أبطأ قليلاً ليسهل متابعته مع قارئ الشاشة)
export const BOT_THINK_MS = { min: 1200, max: 2600 } as const;

/** حد مشاهدة الإعلانات المكافئة يومياً (يحمي حساب AdMob من الحظر) */
export const MAX_ADS_PER_DAY = 10;

/**
 * سقف المحادثة الصوتية الشهري (حماية من تجاوز الحد المجاني في Cloudflare Realtime: 1000 جيجا).
 * نحسب "ساعات استماع": كل شخص في المحادثة يسمع كل من سواه، فطاولة فيها 4 منضمين = 12 ساعة استماع في الساعة.
 * الصوت ≈ 50 كيلوبت/ث (مع هامش)، أي ~22.5 ميجا لكل ساعة استماع → 40,000 ساعة ≈ 900 جيجا.
 */
export const VOICE_MONTHLY_LISTEN_HOURS = 40_000;
