import { type GameMode, type Team, HAND_TOTAL, SUN_ABNAT_MULTIPLIER, WINNING_SCORE, otherTeam } from './cards';
import { BALOOT_ABNAT } from './projects';

/**
 * قواعد قابلة للتعديل — النقاط التي لم تحسمها المواصفة بعد مُعلّمة بـ(بانتظار التأكيد).
 */
export const RULES = {
  /** الحكم: ينجح المشتري إذا تجاوزت أبناطه (مع مشاريعه) هذا الحد */
  hokmBuyerThreshold: 81,
  /** الصن: هل يخسر المشتري كل النقاط إن لم يتجاوز النصف؟ (بانتظار التأكيد — المواصفة الأخيرة: تُسجل للطرفين) */
  sunBuyerCanFail: false,
  /** كبوت الصن بالأبناط (المواصفة: 520) — بانتظار التأكيد: 52 نقطة أم 520؟ */
  sunKabootAbnat: 520,
  /** كبوت الحكم: كل أبناط الصكة (162) — بانتظار التأكيد */
  hokmKabootAbnat: HAND_TOTAL.hokm,
};

/** القسمة على 10 مع جبر الكسر من 5 فما فوق. */
export const abnatToPoints = (abnat: number) => Math.floor((abnat + 5) / 10);

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
  /** 1 بدون دبل، 2 دبل، 3 ذهب/ثري، 4 فور */
  multiplier: number;
  gahwa: boolean;
  /** الفريق الذي طلب الدبل أولاً — عليه الخسارة عند التعادل */
  doublerTeam: Team | null;
}

export interface HandScore {
  points: [number, number];
  buyerFailed: boolean;
  kaboot: Team | null;
  /** القهوة: الفائز بهذه الصكة يفوز باللعبة فوراً */
  gahwaWinner: Team | null;
}

export function scoreHand(input: HandScoreInput): HandScore {
  const { mode, buyerTeam, tricksWon, projectAbnat, multiplier, gahwa, doublerTeam } = input;
  const opp = otherTeam(buyerTeam);
  const factor = mode === 'sun' ? SUN_ABNAT_MULTIPLIER : 1;
  const cards: [number, number] = [input.cardAbnat[0] * factor, input.cardAbnat[1] * factor];
  const total: [number, number] = [cards[0] + projectAbnat[0], cards[1] + projectAbnat[1]];
  const points: [number, number] = [0, 0];
  let buyerFailed = false;
  let kaboot: Team | null = null;
  let handWinner: Team;

  const kabootTeam = tricksWon[0] === 8 ? 0 : tricksWon[1] === 8 ? 1 : null;
  if (kabootTeam !== null) {
    kaboot = kabootTeam;
    const base = mode === 'sun' ? RULES.sunKabootAbnat : RULES.hokmKabootAbnat;
    points[kabootTeam] = abnatToPoints(base + projectAbnat[0] + projectAbnat[1]) * multiplier;
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
      success = total[buyerTeam] > total[opp] || (total[buyerTeam] === total[opp] && doublerTeam === opp);
    } else {
      success = true;
    }

    if (success) {
      points[0] = abnatToPoints(total[0]) * multiplier;
      points[1] = abnatToPoints(total[1]) * multiplier;
      handWinner = buyerTeam;
    } else {
      buyerFailed = true;
      points[opp] = abnatToPoints(total[0] + total[1]) * multiplier;
      handWinner = opp;
    }
  }

  // البلوت: نقطة ثابتة لصاحبها، لا تُضاعف ولا تُسحب
  if (mode === 'hokm' && input.balootTeam !== null) points[input.balootTeam] += abnatToPoints(BALOOT_ABNAT);

  return { points, buyerFailed, kaboot, gahwaWinner: gahwa ? handWinner : null };
}

export type MatchOutcome = { status: 'ongoing' } | { status: 'won'; winner: Team } | { status: 'tiebreak' };

/** بعد إضافة نقاط الصكة: هل انتهت المباراة؟ */
export function matchOutcome(scores: [number, number], gahwaWinner: Team | null = null): MatchOutcome {
  if (gahwaWinner !== null) return { status: 'won', winner: gahwaWinner };
  if (scores[0] < WINNING_SCORE && scores[1] < WINNING_SCORE) return { status: 'ongoing' };
  if (scores[0] === scores[1]) return { status: 'tiebreak' };
  return { status: 'won', winner: scores[0] > scores[1] ? 0 : 1 };
}
