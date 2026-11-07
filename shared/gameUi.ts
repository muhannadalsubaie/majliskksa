// مساعدات العرض للتطبيقات الأصلية (أندرويد وآيفون) في الدومينو والجاكارو واللودو:
// الخادم يحسب لكل لاعب حركاته المسموحة ونصوصها بالعربي، وقراءات اللوحة، ونص بداية دوره،
// فلا تحتاج التطبيقات تعيد كتابة قوانين الألعاب — ترسم اللوحة وتعرض الأزرار وترسل الحركة كما هي.
import { type DominoState, type Tile, canDraw, canPass, ends, fits, playable, sameTile, sideOf } from './domino/engine';
import { endsLabel, handTileLabel, lineLabel, sideName as dominoSideName } from './domino/labels';
import { type JackarooState, controlledOwner as jkOwner, movesForCard, mustBurn, nextPlayer as jkNext } from './jackaroo/engine';
import { boardSummary as jkBoard, cardHint, cardName, marblePlace, moveText } from './jackaroo/labels';
import { type LudoState, controlledOwner as ludoOwner, moveOptions, poolOf } from './ludo/engine';
import { boardSummary as ludoBoard, optionText, rollName, squareText } from './ludo/labels';

export interface DominoUi {
  myTurn: boolean;
  /** الفريق الفائز يختار من يبدأ الصكة: خياراتك (أنت أو شريكك) لو الاختيار لك */
  starterOptions: { seat: number; text: string }[];
  canDraw: boolean;
  canPass: boolean;
  /** قطعك مرتبة (الأكبر أولاً): نصها لقارئ الشاشة، وهل تصلح، وعلى أي طرف */
  hand: { tile: Tile; label: string; legal: boolean; sides: ('left' | 'right')[]; askSide: boolean }[];
  ends: { left: number; right: number } | null;
  endsText: string;
  lineText: string;
  scoreText: string;
  /** اسم كل جانب (فريق أو لاعب) للنقاط */
  sideNames: string[];
  mySide: number;
  /** نص بداية دورك */
  prompt: string;
}

export interface JackarooUi {
  myTurn: boolean;
  burning: boolean;
  hand: { label: string; usable: boolean; moves: { move: unknown; text: string }[] }[];
  boardText: string;
  mineText: string;
  prompt: string;
}

export interface LudoUi {
  myTurn: boolean;
  /** قائمة الأماكن: كل لاعب وأحجاره في أي خانة */
  positions: { name: string; color: number; tokens: string[] }[];
  /** الدور عند مين */
  turnText: string;
  /** آخر رمية نرد ولمن */
  diceText: string;
  /** تقدر ترمي النرد الحين */
  canRoll: boolean;
  /** كل حركة ممكنة: الحجر، والرقم اللي يمشيه، ونصها لقارئ الشاشة */
  options: { token: number; die: number; text: string }[];
  /** الأرقام المتجمعة بانتظار الحركة (الستة ومعها اللي بعدها) */
  pool: number[];
  /** الأحجار اللي تتحرك الآن (للتمييز على اللوحة) */
  movableOwner: number;
  boardText: string;
  mineText: string;
  prompt: string;
}

export function dominoUi(s: DominoState, mySeat: number | null, names: string[]): DominoUi {
  const me = mySeat ?? undefined;
  const myTurn = mySeat !== null && s.phase === 'playing' && s.turn === mySeat;
  const legal = mySeat === null ? [] : playable(s, mySeat);
  const e = ends(s);
  const sideNames = s.scores.map((_, side) => dominoSideName(s, side, names, me));
  const hand = mySeat === null ? [] : [...s.hands[mySeat]]
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || Math.min(y.a, y.b) - Math.min(x.a, x.b))
    .map((tile) => {
      const ok = myTurn && legal.some((l) => sameTile(l, tile));
      const sides = fits(s, tile);
      return { tile, label: handTileLabel(s, tile, sides, ok), legal: ok, sides, askSide: ok && s.line.length > 0 && sides.length === 2 && !!e && e.left !== e.right };
    });
  const draw = mySeat !== null && canDraw(s, mySeat);
  const pass = mySeat !== null && canPass(s, mySeat);
  const choosing = mySeat !== null && s.phase === 'chooseStarter' && s.chooser === mySeat;
  const starterOptions = choosing ? [{ seat: mySeat!, text: 'أبدأ أنا' }, { seat: (mySeat! + 2) % 4, text: `يبدأ شريكي ${names[(mySeat! + 2) % 4]}` }] : [];
  return {
    // الاختيار لك يُعد دورك (فيُنقال «دورك» مع نص الاختيار)
    myTurn: myTurn || choosing, starterOptions, canDraw: draw, canPass: pass, hand, ends: e, endsText: endsLabel(s), lineText: lineLabel(s),
    scoreText: `النقاط: ${s.scores.map((n, side) => `${sideNames[side]} ${n}`).join('، ')}. الهدف ${s.rules.target}`,
    sideNames, mySide: mySeat === null ? -1 : sideOf(s.rules, mySeat),
    prompt: choosing ? 'فاز فريقك بالصكة: اختر من يبدأ، أنت أو شريكك' : !myTurn ? '' : legal.length ? `دورك. ${endsLabel(s)}` : draw ? `دورك. لا قطعة تصلح، اسحب من البنك. ${endsLabel(s)}` : `دورك. لا قطعة تصلح، جلا. ${endsLabel(s)}`,
  };
}

export function jackarooUi(s: JackarooState, mySeat: number | null, names: string[]): JackarooUi {
  const me = mySeat ?? -1;
  const myTurn = mySeat !== null && s.phase === 'playing' && s.turn === mySeat;
  const burning = myTurn && mustBurn(s, me);
  const hand = mySeat === null ? [] : s.hands[mySeat].map((c) => {
    const moves = myTurn && !burning ? movesForCard(s, me, c) : [];
    return {
      label: `${cardName(c)}، ${burning ? 'حرق' : cardHint(c, s.rules.kingThirteen, s.rules.complex)}`,
      usable: myTurn && (burning || moves.length > 0),
      moves: moves.map((m) => ({ move: m, text: moveText(m, names, me, me, jkNext(s, me)) })),
    };
  });
  let mineText = jkBoard(s, names, me);
  if (mySeat !== null) {
    const owner = jkOwner(s, mySeat);
    mineText = `${owner === mySeat ? 'أحجارك' : `أنهيت أحجارك، تلعب بأحجار ${names[owner]}`}: ${
      s.marbles[owner].map((_, index) => `${index + 1} ${marblePlace(s, { owner, index })}`).join('، ')}`;
  }
  return {
    myTurn, burning, hand, boardText: jkBoard(s, names, me), mineText,
    prompt: !myTurn ? '' : s.forcedBurn === me ? 'دورك: عليك أن تحرق ورقة' : burning ? 'دورك: لا لعب صالح، احرق ورقة' : 'دورك',
  };
}

export function ludoUi(s: LudoState, mySeat: number | null, names: string[]): LudoUi {
  const me = mySeat ?? -1;
  const myTurn = mySeat !== null && s.phase !== 'over' && s.turn === mySeat;
  const options = mySeat === null ? [] : moveOptions(s, mySeat);
  const pool = poolOf(s);
  const poolText = pool.map(rollName).join(' و');
  // أكثر من رقم مختلف: كل خيار يقول بأي رقم
  const multi = new Set(options.map((o) => o.die)).size > 1;
  let mineText = ludoBoard(s, names, me);
  if (mySeat !== null) {
    const owner = ludoOwner(s, mySeat);
    mineText = `${owner === mySeat ? 'أحجارك' : `أنهيت أحجارك، تلعب بأحجار ${names[owner]}`}: ${s.tokens[owner].map((p, i) => `${i + 1} ${squareText(s, owner, p, me)}`).join('، ')}`;
  }
  const who = (seat: number) => (seat === me ? 'أنت' : names[seat]);
  const turnText = s.phase === 'over' ? 'انتهت اللعبة'
    : s.turn === me ? (s.phase === 'roll' ? 'دورك، ارمِ النرد' : 'دورك، اختر الحجر')
    : `دور ${names[s.turn]}${s.phase === 'move' ? '، يختار الحجر' : ''}`;
  const last = s.lastMove;
  const diceText = (s.phase === 'move' || pool.length) && pool.length
    ? `${s.turn === me ? 'رميت' : `${names[s.turn]} رمى`} ${poolText}${s.phase === 'roll' ? '، ويرمي مرة ثانية' : ''}`
    : last ? `آخر رمية: ${last.seat === me ? 'رميت' : `${names[last.seat]} رمى`} ${rollName(last.roll)}` : 'ما رمى أحد بعد';
  return {
    myTurn,
    positions: s.seats.map((o) => ({ name: who(o), color: o, tokens: s.tokens[o].map((p, i) => `حجر ${i + 1}: ${squareText(s, o, p, me)}`) })),
    turnText, diceText, canRoll: myTurn && s.phase === 'roll',
    options: options.map(({ token, die }) => ({ token, die, text: `${multi ? `بالـ${rollName(die)}: ` : ''}${optionText(s, me, token, names, die)}` })),
    pool,
    movableOwner: mySeat === null ? -1 : ludoOwner(s, mySeat),
    boardText: ludoBoard(s, names, me), mineText,
    prompt: !myTurn ? '' : s.phase === 'roll' ? (pool.length ? 'رميت ستة، ارمِ مرة ثانية' : 'دورك، ارمِ النرد') : options.length > 1 ? `رميت ${poolText}: اختر الحجر` : '',
  };
}
