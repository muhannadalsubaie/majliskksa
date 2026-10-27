// لاعب آلي للدومينو: يتخلص من القطع الثقيلة والدوس مبكراً، ويختار الطرف الذي يُبقي له
// أكثر لعب لاحقاً، ويصعّب على الخصم التالي إن أمكن.
import {
  type DominoAction, type DominoState, type Pip, type Side, type Tile,
  canDraw, ends, fits, isDouble, nextSeat, pips, playable, sameTile, sideOf,
} from './engine';

export function dominoBotAction(s: DominoState, seat: number): DominoAction | null {
  if (s.phase !== 'playing' || s.turn !== seat) return null;
  const options = playable(s, seat);
  if (!options.length) return canDraw(s, seat) ? { type: 'draw', seat } : { type: 'pass', seat };
  if (!s.line.length) return { type: 'play', seat, tile: best(options, s.hands[seat]) };

  let choice: { tile: Tile; side: Side; score: number } | null = null;
  const e = ends(s)!;
  for (const tile of options) {
    for (const side of fits(s, tile)) {
      const match = side === 'left' ? e.left : e.right;
      const outer = (tile.a === match ? tile.b : tile.a) as Pip;
      const other = side === 'left' ? e.right : e.left;
      const rest = s.hands[seat].filter((t) => !sameTile(t, tile));
      // كم قطعة عندي تصلح بعد هذه الحركة
      const followUps = rest.filter((t) => t.a === outer || t.b === outer || t.a === other || t.b === other).length;
      let score = pips(tile) + (isDouble(tile) ? 4 : 0) + followUps * 3;
      // الخصم التالي: نتجنب فتح طرف يكثر عنده (نقدّر بما لعبه من قبل)
      const opp = nextSeat(s.rules, seat);
      if (sideOf(s.rules, opp) !== sideOf(s.rules, seat)) {
        const oppPlayed = s.line.filter((p) => p.seat === opp && (p.tile.a === outer || p.tile.b === outer)).length;
        score -= oppPlayed * 2;
      }
      if (!choice || score > choice.score) choice = { tile, side, score };
    }
  }
  return { type: 'play', seat, tile: choice!.tile, side: choice!.side };
}

/** أفضل قطعة للبداية: الأثقل، مع تفضيل الدوس */
function best(options: Tile[], hand: Tile[]): Tile {
  void hand;
  return [...options].sort((x, y) => pips(y) + (isDouble(y) ? 4 : 0) - (pips(x) + (isDouble(x) ? 4 : 0)))[0];
}
