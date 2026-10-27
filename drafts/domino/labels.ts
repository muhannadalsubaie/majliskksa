// أسماء القطع ونصوص الإعلانات بالعربي — لقارئ الشاشة (TalkBack / VoiceOver) وللنطق.
import { type DominoState, type Pip, type PlacedTile, type Tile, ends, isDouble, pips, sideOf, sidesCount } from './engine';

const NUM: Record<Pip, string> = { 0: 'فاضي', 1: 'واحد', 2: 'اثنين', 3: 'ثلاثة', 4: 'أربعة', 5: 'خمسة', 6: 'ستة' };

/** "دوس ستة"، "ستة وثلاثة"، "خمسة وفاضي" — الأكبر أولاً */
export function tileLabel(t: Tile): string {
  if (isDouble(t)) return `دوس ${NUM[t.a]}`;
  const hi = Math.max(t.a, t.b) as Pip;
  const lo = Math.min(t.a, t.b) as Pip;
  return `${NUM[hi]} و${NUM[lo]}`;
}

export const pipName = (p: Pip) => NUM[p];

/** طرفا اللعب الآن */
export function endsLabel(s: DominoState): string {
  const e = ends(s);
  if (!e) return 'الطاولة فارغة';
  return `الطرفان: يمين ${NUM[e.right]}، يسار ${NUM[e.left]}`;
}

/** خط اللعب كاملاً من اليمين لليسار (كما يُرى في الصفحة العربية) */
export function lineLabel(s: DominoState): string {
  if (!s.line.length) return 'لم تُلعب أي قطعة بعد';
  return `على الطاولة ${s.line.length} قطع: ${[...s.line].reverse().map((p) => tileLabel(p.tile)).join('، ')}`;
}

/** اسم الجانب: "فريقك" أو "فريق سالم وعلي" (أو اسم اللاعب في اللعب الفردي). me = مقعد صاحب الجهاز */
export function sideName(s: DominoState, side: number, names: string[], me?: number): string {
  if (me !== undefined && sideOf(s.rules, me) === side) return sidesCount(s.rules) === s.rules.players ? 'أنت' : 'فريقك';
  if (sidesCount(s.rules) === s.rules.players) return names[side];
  const members = names.filter((_, seat) => sideOf(s.rules, seat) === side);
  return `فريق ${members.join(' و')}`;
}

/** إعلان آخر حركة: "سالم لعب ستة وثلاثة على اليمين" / "سالم سحب قطعة" / "سالم دق" */
export function moveAnnouncement(s: DominoState, names: string[]): string {
  const m = s.lastMove;
  if (!m) return '';
  const who = names[m.seat];
  if (m.kind === 'draw') return `${who} سحب قطعة`;
  if (m.kind === 'pass') return `${who} دق`;
  const p = m.placed as PlacedTile;
  const where = p.side === 'first' ? '' : p.side === 'right' ? ' على اليمين' : ' على اليسار';
  return `${who} لعب ${tileLabel(p.tile)}${where}`;
}

/** إعلان نهاية الصكة: النقاط فقط (والتفاصيل تُعرض في السجل) */
export function handAnnouncement(s: DominoState, names: string[]): string[] {
  const r = s.lastHand;
  if (!r) return [];
  const out: string[] = [];
  if (r.kind === 'blocked') out.push('انسدّ اللعب');
  else if (r.winnerSeat !== null) out.push(`قفل ${names[r.winnerSeat]}`);
  out.push(`نتيجة الصكة: ${r.points.map((n, side) => `${sideName(s, side, names)} ${n}`).join('، ')}`);
  out.push(`المجموع: ${s.scores.join(' مقابل ')}`);
  if (s.phase === 'matchOver') {
    const best = s.scores.indexOf(Math.max(...s.scores));
    out.push(`انتهت المباراة — فاز ${sideName(s, best, names)}`);
  }
  return out;
}

/** وصف قطعة في اليد لقارئ الشاشة، مع أين تصلح */
export function handTileLabel(s: DominoState, t: Tile, sides: ('left' | 'right')[], legal: boolean): string {
  const base = `${tileLabel(t)}، ${pips(t)} نقطة`;
  if (!legal) return `${base}، لا تصلح`;
  const e = ends(s);
  if (sides.length === 2 && e && e.left !== e.right) return `${base}، تصلح على الطرفين`;
  return base;
}
