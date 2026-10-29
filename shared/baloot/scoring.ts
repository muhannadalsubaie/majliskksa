import { type GameMode, type Team, SUN_ABNAT_MULTIPLIER, WINNING_SCORE, otherTeam } from './cards';
import { BALOOT_ABNAT } from './projects';

/**
 * قواعد قابلة للتعديل.
 * - المشاريع لا تتضاعف أبداً: لا بمضاعفة الصن ولا بالدبل/ثري/فور.
 * - دبل الحكم (دبل/ثري/فور) لا ينقسم: نقاط الصكة كاملة مضاعفة للفريق الفائز.
 * - البلوت ثابت لصاحبه دائماً.
 */
export const RULES = {
  /** الحكم: ينجح المشتري إذا تجاوزت أبناطه (مع مشاريعه) هذا الحد */
  hokmBuyerThreshold: 81,
  /** الصن: إذا جاب المشتري أقل من النص يخسر وتذهب كل النقاط للخصم */
  sunBuyerCanFail: true,
  /** نقاط الكبوت بدون مشاريع (تُضرب في معامل الدبل) */
  sunKabootPoints: 44,
  hokmKabootPoints: 25,
};

/** القسمة على 10 مع جبر الكسر من 5 فما فوق. */
export const abnatToPoints = (abnat: number) => Math.floor((abnat + 5) / 10);

/**
 * الصن: أبناط الأوراق مع الأرض مجموعها 130، وكل 5 أبناط بنقطة (القسمة على 5 مع جبر الكسر لأقرب نقطة).
 * المجموع دائماً 26 نقطة، والكسور لا تتساوى أبداً لأن الأبناط أعداد صحيحة.
 */
export const sunAbnatToPoints = (abnat: number) => Math.floor((abnat * 2 + 5) / 10);

export interface HandScoreInput {
  mode: GameMode;
  buyerTeam: Team;
  /** أبناط الأوراق + الأرض لكل فريق (خام، قبل مضاعفة الصن) */
  cardAbnat: [number, number];
  tricksWon: [number, number];
  /** أبناط المشاريع بعد إلغاء الأضعف */
  projectAbnat: [number, number];
  /** الفريق الذي أعلن البلوت (حكم فقط) */
  balootTeam: Team | null;
  /** 1 بدون دبل، 2 دبل، 3 ثري، 4 فور */
  multiplier: number;
  gahwa: boolean;
  /** الفريق الذي طلب الدبل أولاً — عليه الخسارة عند التعادل */
  doublerTeam: Team | null;
}

export interface HandScore {
  points: [number, number];
  /** أبناط الأوراق مع الأرض لكل فريق كما هي (الصن من 130، الحكم من 162) — للسجل */
  cardAbnat?: [number, number];
  /** نقاط المشاريع (والبلوت) التي ذهبت فعلاً لكل فريق في هذه الصكة — للسجل */
  projectPoints?: [number, number];
  /** أبناط كل فريق في الصكة (أوراق + أرض + مشاريع؛ أوراق الصن مضاعفة) — قد تغيب في صكات قديمة */
  abnat?: [number, number];
  buyerFailed: boolean;
  kaboot: Team | null;
  /** القهوة: الفائز بهذه الصكة يفوز باللعبة فوراً */
  gahwaWinner: Team | null;
}

export function scoreHand(input: HandScoreInput): HandScore {
  const { mode, buyerTeam, tricksWon, projectAbnat, multiplier, gahwa, doublerTeam } = input;
  const opp = otherTeam(buyerTeam);
  const factor = mode === 'sun' ? SUN_ABNAT_MULTIPLIER : 1;
  // للمقارنة فقط (نجاح المشتري): أوراق الصن مضاعفة لتكون بمقياس أبناط المشاريع
  const cards: [number, number] = [input.cardAbnat[0] * factor, input.cardAbnat[1] * factor];
  const raw = input.cardAbnat;
  // نقاط الأوراق: الصن كل 5 أبناط بنقطة، والحكم كل 10
  const cardPoints = (abnat: number) => (mode === 'sun' ? sunAbnatToPoints(abnat) : abnatToPoints(abnat));
  const credited: [number, number] = [0, 0];
  // تُستخدم لتحديد نجاح المشتري فقط (أوراقه + مشاريعه)
  const total: [number, number] = [cards[0] + projectAbnat[0], cards[1] + projectAbnat[1]];
  // نقاط المشاريع ثابتة لا تتضاعف
  const projectPoints: [number, number] = [abnatToPoints(projectAbnat[0]), abnatToPoints(projectAbnat[1])];
  const allProjectPoints = projectPoints[0] + projectPoints[1];
  const points: [number, number] = [0, 0];
  let buyerFailed = false;
  let kaboot: Team | null = null;
  let handWinner: Team;

  const kabootTeam = tricksWon[0] === 8 ? 0 : tricksWon[1] === 8 ? 1 : null;
  if (kabootTeam !== null) {
    kaboot = kabootTeam;
    const base = mode === 'sun' ? RULES.sunKabootPoints : RULES.hokmKabootPoints;
    points[kabootTeam] = base * multiplier + allProjectPoints;
    credited[kabootTeam] = allProjectPoints;
    buyerFailed = kabootTeam !== buyerTeam;
    handWinner = kabootTeam;
  } else {
    let success: boolean;
    if (mode === 'hokm') {
      const t = RULES.hokmBuyerThreshold;
      success = total[buyerTeam] > t;
      // تعادل بعد الدبل: الخسارة على طالب الدبل
      if (total[buyerTeam] === t && doublerTeam === opp) success = true;
    } else if (RULES.sunBuyerCanFail) {
      // يخسر فقط إن جاب أقل من النص (أوراقه + مشاريعه مقابل الخصم)؛ النص بالضبط لا يُعد خسارة
      success = total[buyerTeam] >= total[opp];
    } else {
      success = true;
    }

    if (success && mode === 'hokm' && multiplier > 1) {
      // دبل الحكم لا ينقسم: الفائز يأخذ نقاط الصكة كاملة مضاعفة، والمشاريع كلها معها بلا مضاعفة
      points[buyerTeam] = cardPoints(raw[0] + raw[1]) * multiplier + allProjectPoints;
      credited[buyerTeam] = allProjectPoints;
      handWinner = buyerTeam;
    } else if (success) {
      points[0] = cardPoints(raw[0]) * multiplier + projectPoints[0];
      points[1] = cardPoints(raw[1]) * multiplier + projectPoints[1];
      credited[0] = projectPoints[0];
      credited[1] = projectPoints[1];
      handWinner = buyerTeam;
    } else {
      buyerFailed = true;
      points[opp] = cardPoints(raw[0] + raw[1]) * multiplier + allProjectPoints;
      credited[opp] = allProjectPoints;
      handWinner = opp;
    }
  }

  // البلوت: نقطة ثابتة لصاحبها، لا تُضاعف ولا تُسحب
  if (mode === 'hokm' && input.balootTeam !== null) {
    points[input.balootTeam] += abnatToPoints(BALOOT_ABNAT);
    credited[input.balootTeam] += abnatToPoints(BALOOT_ABNAT);
  }

  return {
    points, abnat: total, cardAbnat: [raw[0], raw[1]], projectPoints: credited,
    buyerFailed, kaboot, gahwaWinner: gahwa ? handWinner : null,
  };
}

export type MatchOutcome = { status: 'ongoing' } | { status: 'won'; winner: Team } | { status: 'tiebreak' };

/** بعد إضافة نقاط الصكة: هل انتهت المباراة؟ */
export function matchOutcome(scores: [number, number], gahwaWinner: Team | null = null): MatchOutcome {
  if (gahwaWinner !== null) return { status: 'won', winner: gahwaWinner };
  if (scores[0] < WINNING_SCORE && scores[1] < WINNING_SCORE) return { status: 'ongoing' };
  if (scores[0] === scores[1]) return { status: 'tiebreak' };
  return { status: 'won', winner: scores[0] > scores[1] ? 0 : 1 };
}
