// نصوص الجاكارو بالعربي لقارئ الشاشة: أسماء الأوراق، أماكن الأحجار، وإعلانات الحركات.
import { RANK_NAMES as BALOOT_RANKS, SUIT_NAMES as SUIT } from '../baloot/cards';
import {
  type Card, type JackarooState, type MarbleRef, type MoveSpec,
  SAFE_SIZE, activeSeats, isTeams, nextPlayer, previewMove, progressOf, teamOf, trackLen,
} from './engine';

// نفس أسماء البلوت (أكة، شايب، بنت، ولد، والأرقام)
const RANK: Record<Card['rank'], string> = {
  ...(BALOOT_RANKS as Record<string, string>),
  '6': '6', '5': '5', '4': '4', '3': '3', '2': '2',
} as Record<Card['rank'], string>;

/** اسم الورقة مثل البلوت: الرقم/الصورة ثم اللون (إكة شريا، بنت هاص، عشرة ديمن) */
export const cardName = (c: Card) => `${RANK[c.rank]} ${SUIT[c.suit]}`;

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
    case '5': return 'تحرك أي حجر على اللوحة 5 للأمام، إلا اللي لسا على قاعدته';
    case '4': return 'ترجع 4 للخلف';
    default: return `تتقدم ${c.rank}`;
  }
}

/** "حجرك 2" أو "حجر سالم 3" */
export function marbleName(r: MarbleRef, names: string[], me: number): string {
  return r.owner === me ? `حجرك ${r.index + 1}` : `حجر ${names[r.owner]} ${r.index + 1}`;
}

/**
 * أين الحجر: في البيت، في منطقة الأمان، أو رقم خانته على المسار. خانات المسار مرقّمة من 0 إلى آخر الطاولة
 * (نفس الأرقام المرسومة على اللوحة)، ثابتة للجميع، فكل اللاعبين يسمعون نفس الرقم لنفس الخانة.
 */
export function marblePlace(s: JackarooState, r: MarbleRef): string {
  const m = s.marbles[r.owner][r.index];
  if (m.zone === 'home') return 'في البيت';
  if (m.zone === 'safe') return `في منطقة الأمان، الخانة ${m.pos + 1} من ${SAFE_SIZE}`;
  return progressOf(s.rules, r.owner, m.pos) === 0 ? `في الخانة ${m.pos}، على قاعدته` : `في الخانة ${m.pos}`;
}

/** الأحجار اللي تحركت في الحركة (لنقول وين وقفت) */
function movedMarbles(move: MoveSpec): MarbleRef[] {
  switch (move.kind) {
    case 'out': case 'forward': case 'back': case 'kingRun': return [move.marble];
    case 'split': return move.parts.map((p) => p.marble);
    case 'swap': return [move.mine, move.other];
    default: return [];
  }
}

/** نص الحركة. actor = من لعبها (لمعرفة اللاعب التالي له) */
/** next = اللاعب اللي بعد اللي لعب (يتخطى المقاعد الفاضية في اللعب بلاعبين أو ثلاثة) */
export function moveText(move: MoveSpec, names: string[], me: number, actor = me, next = (actor + 1) % 4, s?: JackarooState): string {
  const n = (r: MarbleRef) => marbleName(r, names, me);
  // خيارات اللاعب: «حجرك رقم ٣ في ٢٤» (رقم الحجر ووين يوصل)
  const after = s ? previewMove(s, move) : null;
  if (s && after) {
    const num = (r: MarbleRef) => r.owner === me ? `حجرك رقم ${r.index + 1}` : `حجر ${names[r.owner]} رقم ${r.index + 1}`;
    const at = (r: MarbleRef) => {
      const m = after.marbles[r.owner][r.index];
      return m.zone === 'safe' ? `في الأمان ${m.pos + 1}` : m.zone === 'home' ? 'في البيت' : `في ${m.pos}`;
    };
    switch (move.kind) {
      case 'out': return `إنزال ${num(move.marble)} ${at(move.marble)}`;
      case 'forward': return `${num(move.marble)} ${at(move.marble)}، يتقدم ${move.steps}`;
      case 'back': return `${num(move.marble)} ${at(move.marble)}، يرجع ${move.steps} للخلف`;
      case 'swap': return `تبديل ${num(move.mine)} مع ${num(move.other)}: ${num(move.mine)} يصير ${at(move.mine)}`;
      case 'split': return move.parts.map((p) => `${num(p.marble)} ${at(p.marble)}`).join(' و');
      case 'kingRun': return `${num(move.marble)} ${at(move.marble)}، يتقدم ${move.steps} ويأكل كل حجر يمر عليه`;
      default: break;
    }
  }
  switch (move.kind) {
    case 'out': return `إنزال ${n(move.marble)}`;
    case 'forward': return `${n(move.marble)} يتقدم ${move.steps}`;
    case 'back': return `${n(move.marble)} يرجع ${move.steps} للخلف`;
    case 'swap': return `تبديل ${n(move.mine)} مع ${n(move.other)}`;
    case 'split': return move.parts.map((p) => `${n(p.marble)} ${p.steps}`).join('، و');
    case 'skipNext': return `${names[next]} يحرق ورقة ويضيع دوره`;
    case 'kingRun': return `${n(move.marble)} يتقدم ${move.steps} ويأكل كل حجر يمر عليه`;
    case 'discardNext': return `حرق الورقة رقم ${move.index + 1} من أوراق ${names[next]}`;
  }
}

/** ما عنده أي لعب صالح: انحرقت أوراقه كلها تلقائياً ويتجاوزه الدور لين التوزيعة الجاية */
function autoBurnText(s: JackarooState, names: string[], me: number): string[] {
  return (s.autoBurned ?? []).map((seat) => seat === me ? 'ما عندك لعب، انحرقت أوراقك' : `${names[seat]} ما عنده لعب، انحرقت أوراقه`);
}

/** إعلان آخر حركة لكل الحاضرين */
export function moveAnnouncement(s: JackarooState, names: string[], me: number): string[] {
  const r = s.lastMove;
  if (!r) return [];
  const who = r.seat === me ? 'أنت' : names[r.seat];
  if (!r.move) return [`${who} حرق ${cardName(r.card)}`, ...autoBurnText(s, names, me)];
  const out = [`${who} لعب ${cardName(r.card)}: ${moveText(r.move, names, me, r.seat, nextPlayer(s, r.seat))}`];
  // وين وقف كل حجر تحرك (رقم الخانة نفسه للجميع)
  const where = movedMarbles(r.move).filter((m) => !r.captured.some((c) => c.owner === m.owner && c.index === m.index))
    .map((m) => `${marbleName(m, names, me)} ${marblePlace(s, m)}`);
  if (where.length) out.push(where.join('، و'));
  for (const c of r.captured) out.push(`أكل ${marbleName(c, names, me)}، ورجع للبيت`);
  for (const e of r.enteredSafe) out.push(`دخل ${marbleName(e, names, me)} منطقة الأمان`);
  if (r.discarded) out.push(`حُرقت ${cardName(r.discarded)} من أوراق ${names[nextPlayer(s, r.seat)]}`);
  if (s.forcedBurn !== null && r.move.kind === 'skipNext') out.push(`${names[s.forcedBurn]} يحرق ورقة ويضيع دوره`);
  if (s.phase === 'over') {
    if (isTeams(s)) out.push(s.winnerTeam === teamOf(me) ? 'فاز فريقك!' : 'فاز الفريق الآخر');
    else if (s.winner != null) out.push(s.winner === me ? 'فزت!' : `فاز ${names[s.winner]}`);
  }
  out.push(...autoBurnText(s, names, me));
  return out;
}

/** ملخص اللوحة: أحجار كل لاعب وأماكنها */
export function boardSummary(s: JackarooState, names: string[], me: number): string {
  return activeSeats(s).map((owner) => {
    const who = owner === me ? 'أحجارك' : `أحجار ${names[owner]}`;
    const parts = s.marbles[owner].map((_, index) => `${index + 1} ${marblePlace(s, { owner, index })}`);
    return `${who}: ${parts.join('، ')}`;
  }).join('. ');
}
