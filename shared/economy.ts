// تكاليف الاقتصاد — مصدر واحد للحقيقة، والخصم الفعلي يتم في Cloud Functions فقط.
export const COINS = {
  signupBonus: 30,
  createTable: 2,
  joinTable: 1,
  inviteFriend: 1,
  addBot: 1,
  watchAdReward: 2,
} as const;

export const BOT_REPLACE_AFTER_MS = 3 * 60 * 1000;
// قبل بدء اللعب (أو بعد انتهائه): من انقطع اتصاله ولم يعد خلال هذه المدة يخرج من الطاولة،
// حتى لا تبقى طاولات فيها حسابات أُغلقت أو حُذفت
export const LOBBY_LEAVE_AFTER_MS = 5 * 60 * 1000;
// المشاهد المنقطع (في المباراة أو خارجها) يخرج بعد دقيقتين
export const SPECTATOR_LEAVE_AFTER_MS = 2 * 60 * 1000;
// المطرود يستطيع دخول أي طاولة أخرى فوراً، أما الطاولة التي طُرد منها فبعد ساعة
export const KICK_BLOCK_MS = 60 * 60 * 1000;
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

/**
 * هدايا لمرة واحدة لحسابات بعينها (باسم المستخدم). تُمنح عند أول فتح للتطبيق بعد إضافتها،
 * ولا تتكرر أبداً (يُسجَّل منحها في الخادم).
 */
export const ONE_TIME_GIFTS: { id: string; username: string; coins: number }[] = [
  { id: 'gift-burjuazi-2026-10', username: 'البرجوازي', coins: 100 },
];

/** باقات العملات للشراء من داخل التطبيق (معرّفات المنتجات نفسها في Google Play وApp Store) */
export const COIN_PACKS = [
  { id: 'coins_20', coins: 20, bonus: 0, suggestedPrice: '3.99 ر.س' },
  { id: 'coins_70', coins: 70, bonus: 10, suggestedPrice: '9.99 ر.س' },
  { id: 'coins_190', coins: 190, bonus: 40, suggestedPrice: '19.99 ر.س' },
  { id: 'coins_550', coins: 550, bonus: 150, suggestedPrice: '44.99 ر.س' },
] as const;
export type CoinPackId = (typeof COIN_PACKS)[number]['id'];
