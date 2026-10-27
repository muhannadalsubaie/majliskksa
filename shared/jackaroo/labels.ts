// نصوص الجاكارو بالعربي لقارئ الشاشة: أسماء الأوراق، أماكن الأحجار، وإعلانات الحركات.
import {
  type Card, type JackarooState, type MarbleRef, type MoveSpec,
  SAFE_SIZE, progressOf, teamOf, trackLen,
} from './engine';

const RANK: Record<Card['rank'], string> = {
  A: 'أص', K: 'شايب', Q: 'بنت', J: 'ولد', '10': 'عشرة', '9': 'تسعة', '8': 'ثمانية', '7': 'سبعة',
  '6': 'ستة', '5': 'خمسة', '4': 'أربعة', '3': 'ثلاثة', '2': 'اثنين',
};

export const cardName = (c: Card) => RANK[c.rank];

/** ماذا تفعل الورقة (للتلميح) */
export function cardHint(c: Card, kingThirteen: boolean, complex = false): string {
  const red = c.suit === 'H' || c.suit === 'D';
  switch (c.rank) {
    case 'A': return 'تنزل حجراً، أو تتقدم 1 أو 11';
    case 'K':
      if (complex) return 'تنزل حجراً، أو تتقدم 13 وتأكل كل حجر تمر عليه';
      return kingThirteen ? 'تنزل حجراً، أو تتقدم 13' : 'تنزل حجراً';
    case 'Q': return complex && !red ? 'بنت سوداء: تختار ورقة من أوراق اللاعب التالي ليحرقها' : 'تتقدم 12';
    case 'J': return complex && red ? 'ولد أحمر: تتقدم 11' : 'تبدّل حجرك بحجر لاعب آخر';
    case '10': return 'تتقدم 10، أو تجبر التالي يحرق ورقة ويضيع دوره';
    case '7': return 'تتقدم 7، أو تقسمها بين حجرين';
    case '5': return 'تحرك أي حجر على اللوحة 5 للأمام';
    case '4': return 'ترجع 4 للخلف';
    default: return `تتقدم ${c.rank}`;
  }
}

/** "حجرك 2" أو "حجر سالم 3" */
export function marbleName(r: MarbleRef, names: string[], me: number): string {
  return r.owner === me ? `حجرك ${r.index + 1}` : `حجر ${names[r.owner]} ${r.index + 1}`;
}

/** أين الحجر: في البيت، على القاعدة، يبعد كذا عن منطقة الأمان، أو في منطقة الأمان */
export function marblePlace(s: JackarooState, r: MarbleRef): string {
  const m = s.marbles[r.owner][r.index];
  if (m.zone === 'home') return 'في البيت';
  if (m.zone === 'safe') return `في منطقة الأمان، الخانة ${m.pos + 1} من ${SAFE_SIZE}`;
  const prog = progressOf(s.rules, r.owner, m.pos);
  if (prog === 0) return 'على قاعدته';
  return `على المسار، باقي له ${trackLen(s.rules) - prog} خانة لمنطقة الأمان`;
}

/** نص الحركة. actor = من لعبها (لمعرفة اللاعب التالي له) */
export function moveText(move: MoveSpec, names: string[], me: number, actor = me): string {
  const n = (r: MarbleRef) => marbleName(r, names, me);
  switch (move.kind) {
    case 'out': return `إنزال ${n(move.marble)}`;
    case 'forward': return `${n(move.marble)} يتقدم ${move.steps}`;
    case 'back': return `${n(move.marble)} يرجع ${move.steps} للخلف`;
    case 'swap': return `تبديل ${n(move.mine)} مع ${n(move.other)}`;
    case 'split': return move.parts.map((p) => `${n(p.marble)} ${p.steps}`).join('، و');
    case 'skipNext': return `${names[(actor + 1) % 4]} يحرق ورقة ويضيع دوره`;
    case 'kingRun': return `${n(move.marble)} يتقدم ${move.steps} ويأكل كل حجر يمر عليه`;
    case 'discardNext': return `حرق الورقة رقم ${move.index + 1} من أوراق ${names[(actor + 1) % 4]}`;
  }
}

/** إعلان آخر حركة لكل الحاضرين */
export function moveAnnouncement(s: JackarooState, names: string[], me: number): string[] {
  const r = s.lastMove;
  if (!r) return [];
  const who = r.seat === me ? 'أنت' : names[r.seat];
  if (!r.move) return [`${who} حرق ${cardName(r.card)}`];
  const out = [`${who} لعب ${cardName(r.card)}: ${moveText(r.move, names, me, r.seat)}`];
  for (const c of r.captured) out.push(`أكل ${marbleName(c, names, me)}، ورجع للبيت`);
  for (const e of r.enteredSafe) out.push(`دخل ${marbleName(e, names, me)} منطقة الأمان`);
  if (r.discarded) out.push(`حُرقت ${cardName(r.discarded)} من أوراق ${names[(r.seat + 1) % 4]}`);
  if (s.forcedBurn !== null && r.move.kind === 'skipNext') out.push(`${names[s.forcedBurn]} يحرق ورقة ويضيع دوره`);
  if (s.phase === 'over') out.push(s.winnerTeam === teamOf(me) ? 'فاز فريقك!' : 'فاز الفريق الآخر');
  return out;
}

/** ملخص اللوحة: أحجار كل لاعب وأماكنها */
export function boardSummary(s: JackarooState, names: string[], me: number): string {
  return [0, 1, 2, 3].map((owner) => {
    const who = owner === me ? 'أحجارك' : `أحجار ${names[owner]}`;
    const parts = s.marbles[owner].map((_, index) => `${index + 1} ${marblePlace(s, { owner, index })}`);
    return `${who}: ${parts.join('، ')}`;
  }).join('. ');
}
