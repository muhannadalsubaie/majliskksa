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
