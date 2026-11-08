/**
 * تجربة التعادل (81 مقابل 81 في الحكم) — مرة وحدة بس لطاولة فيها أربعة لاعبين محددين.
 * توزيع محسوب مسبقاً ومجرّب بمحرك اللعب نفسه: كل ورقة فيه قانونية، والنتيجة 81 و81 (8 و8 نقاط)،
 * وما فيه مشاريع ولا بلوت. المقاعد نسبية للموزع: 0 = اللي بعد الموزع (أول من يتكلم ويشتري الحكم).
 * أثناء الصكة يوصل كل لاعب (بس هو) وش يسوي بدوره: «اشترِ حكم»، «قل بس»، «العب ...».
 */
import { type Card, type Seat, type Suit, cardLabel, nextSeat } from './cards';
import { type GameState, isDoublingTurn } from './game';

const c = (s: string): Card => ({ suit: s[0] as Suit, rank: s.slice(1) as Card['rank'] });

export const TIE_RIG = {
  trump: 'H' as Suit,
  qaba: c('H8'),
  /** أول خمس أوراق لكل مقعد نسبي */
  init: [
    ['SK', 'D7', 'CQ', 'C9', 'SA'],
    ['DQ', 'D9', 'S10', 'SQ', 'C7'],
    ['DA', 'D8', 'S8', 'S7', 'CK'],
    ['DK', 'D10', 'SJ', 'S9', 'C10'],
  ].map((h) => h.map(c)),
  /** بقية الأوراق بترتيب التوزيع: المشتري (2) ثم الباقين (3 لكل واحد) */
  stock: ['H10', 'DJ', 'H9', 'HQ', 'C8', 'HK', 'HA', 'CA', 'HJ', 'H7', 'CJ'].map(c),
  /** اللعب: لكل أكلة [مقعد نسبي، ورقة] بالترتيب */
  plan: [
    ['0:DJ', '1:DQ', '2:DA', '3:DK'],
    ['2:D8', '3:D10', '0:D7', '1:D9'],
    ['3:SJ', '0:SK', '1:S10', '2:S8'],
    ['1:SQ', '2:S7', '3:S9', '0:SA'],
    ['0:CQ', '1:C7', '2:CK', '3:C10'],
    ['3:HJ', '0:H8', '1:H9', '2:HK'],
    ['3:H7', '0:H10', '1:HQ', '2:HA'],
    ['2:CA', '3:CJ', '0:C9', '1:C8'],
  ].map((t) => t.map((p) => ({ rel: Number(p[0]), card: c(p.slice(2)) }))),
};

const same = (a: Card, b: Card) => a.suit === b.suit && a.rank === b.rank;
const abs = (dealer: Seat, rel: number): Seat => nextSeat(dealer, rel + 1);

/** توزيع جديد (خمس أوراق لكل واحد، قبل المزايدة) → التوزيع المحسوب */
export function rigTieDeal(g: GameState): GameState {
  const hands: Card[][] = [[], [], [], []];
  TIE_RIG.init.forEach((h, rel) => { hands[abs(g.dealer, rel)] = h.map((x) => ({ ...x })); });
  return { ...g, hands, qaba: { ...TIE_RIG.qaba }, stock: TIE_RIG.stock.map((x) => ({ ...x })), turn: nextSeat(g.dealer) };
}

/** وش يسوي هاللاعب الحين حسب الخطة (null = مو دوره، أو خرج اللعب عن الخطة) */
export function tieHint(g: GameState, seat: Seat): string | null {
  const rel = (seat - g.dealer - 1 + 8) % 4;
  if (g.phase === 'bidding') {
    if (g.turn !== seat) return null;
    if (rel !== 0) return 'قل بس';
    return g.hokmConfirm ? 'أكّد الحكم' : 'اشترِ حكم';
  }
  if (g.phase === 'doubling') return isDoublingTurn(g, seat) ? 'قل بس، لا تدبل' : null;
  if (g.phase !== 'playing' || g.turn !== seat || g.contract?.trump !== TIE_RIG.trump) return null;
  const trick = TIE_RIG.plan[g.trickNo];
  if (!trick) return null;
  // اللعب ماشي على الخطة؟ (لو أحد لعب غيرها توقف التوجيه)
  for (let i = 0; i < g.trick.length; i++) {
    if (abs(g.dealer, trick[i].rel) !== g.trick[i].seat || !same(trick[i].card, g.trick[i].card)) return null;
  }
  const next = trick[g.trick.length];
  if (!next || abs(g.dealer, next.rel) !== seat) return null;
  if (!g.hands[seat].some((x) => same(x, next.card))) return null;
  return `العب ${cardLabel(next.card)}`;
}
