// شاشة لعبة لودو (لعب محلي ضد الروبوتات) — جاهزة للربط بمجلسك لاحقاً.
// لقارئ الشاشة: زر "ارمِ النرد"، ثم كل حجر يمكن تحريكه زر يقول أين يصل وماذا يحدث (أكل، خانة آمنة، خطر)،
// وكل رمية وحركة تُعلن، والضغط على اللوحة يقرأ أماكن كل الأحجار.
// إيماءة الإصبعين: من اليمين لليسار = أماكن كل الأحجار، من اليسار لليمين = أحجارك فقط.
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { announce, announceNow } from '../../src/services/announcer';
import { TWO_FINGER, type SwipeDir } from '../../src/services/screenReader';
import { ludoBotAction } from './bot';
import {
  type LudoRules, type LudoState, DEFAULT_RULES, FINISH, LAST_TRACK, SAFE, STARTS, absPos, applyLudo, controlledOwner, movableTokens, newGame, teamOf,
} from './engine';
import { COLOR_NAMES, boardSummary, moveAnnouncement, optionText, placeText, rollName } from './labels';
import './ludo.css';

const ME = 0;
const BOT_DELAY_MS = 900;
export const COLORS = ['#d9453b', '#2ea661', '#e6b422', '#2f7fd8'];

interface Props { onExit: () => void; rules?: LudoRules; names?: string[]; /** حالة بداية (للمعاينة والاختبار) */ initial?: LudoState }

export function LudoTable({ onExit, rules = DEFAULT_RULES, names: given, initial }: Props) {
  const names = useMemo(() => given ?? ['أنت', 'سالم', 'فهد', 'علي'], [given]);
  const rng = useRef(Math.random);
  const [s, setS] = useState<LudoState>(() => initial ?? newGame(rng.current, rules));
  const prev = useRef<LudoState | null>(null);

  // الإعلانات: كل رمية وحركة، و"دورك"
  useEffect(() => {
    const before = prev.current;
    prev.current = s;
    if (!before) {
      announce(rules.teams ? `بدأت اللعبة. أنت و${names[2]} ضد ${names[1]} و${names[3]}` : `بدأت اللعبة. لونك ${COLOR_NAMES[ME]}`);
    } else if (s.lastMove !== before.lastMove) moveAnnouncement(s, names, ME).forEach(announce);
    if (s.phase === 'move' && s.turn === ME && before?.phase !== 'move') {
      const n = movableTokens(s, ME).length;
      announce(`رميت ${rollName(s.dice!)}${n > 1 ? `، اختر الحجر` : ''}`);
    }
    if (s.phase === 'roll' && s.turn === ME && (before?.turn !== ME || before.phase !== 'roll' || before.lastMove !== s.lastMove)) announce('دورك، ارمِ النرد');
  }, [s, names, rules]);

  // دور الروبوتات
  useEffect(() => {
    if (s.phase === 'over' || s.turn === ME) return;
    const t = setTimeout(() => setS((cur) => {
      const a = ludoBotAction(cur, cur.turn);
      return a ? applyLudo(cur, a, rng.current) : cur;
    }), BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [s]);

  const act = (a: Parameters<typeof applyLudo>[1]) => {
    try { setS(applyLudo(s, a, rng.current)); } catch (e) { announceNow((e as Error).message); }
  };

  // حجر واحد فقط يمكن تحريكه: يتحرك تلقائياً بعد لحظة
  const options = movableTokens(s, ME);
  useEffect(() => {
    if (options.length !== 1) return;
    const t = setTimeout(() => setS((cur) => (cur === s ? applyLudo(cur, { type: 'move', seat: ME, token: options[0] }, rng.current) : cur)), 700);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const readBoard = useCallback(() => announceNow(boardSummary(s, names, ME)), [s, names]);
  const readMine = useCallback(() => {
    const owner = controlledOwner(s, ME);
    announceNow(`${owner === ME ? 'أحجارك' : `أنهيت أحجارك، تلعب بأحجار ${names[owner]}`}: ${s.tokens[owner].map((p, i) => `${i + 1} ${placeText(owner, p)}`).join('، ')}`);
  }, [s, names]);
  useEffect(() => {
    const onTwo = (e: Event) => {
      const dir = (e as CustomEvent<SwipeDir>).detail;
      if (dir === 'left') readBoard(); else if (dir === 'right') readMine();
    };
    window.addEventListener(TWO_FINGER, onTwo);
    return () => window.removeEventListener(TWO_FINGER, onTwo);
  }, [readBoard, readMine]);

  const myTurn = s.phase !== 'over' && s.turn === ME;
  const home = (o: number) => s.tokens[o].filter((p) => p === FINISH).length;
  const won = s.winner !== null && (rules.teams ? s.winner === teamOf(ME) : s.winner === ME);

  return (
    <main className="screen ludo-screen" aria-labelledby="ludo-title">
      <header className="topbar">
        <h1 id="ludo-title">لودو</h1>
        <button className="secondary back-btn" onClick={onExit}>خروج</button>
      </header>

      <ul className="ludo-players" aria-label="اللاعبون">
        {s.seats.map((o) => (
          <li key={o} className={s.turn === o && s.phase !== 'over' ? 'turn' : ''} style={{ borderInlineStartColor: COLORS[o] }}>
            <span className="sr-only">{names[o]}{rules.teams && o === 2 ? ' شريكك' : ''}، {COLOR_NAMES[o]}، وصل {home(o)} من 4</span>
            <span aria-hidden="true">{names[o]}{rules.teams && o === 2 ? ' (شريكك)' : ''}</span>
            <span aria-hidden="true" className="ludo-home">{home(o)}/4</span>
          </li>
        ))}
      </ul>

      <button className="ludo-board-btn" onClick={readBoard} aria-label={`اللوحة: ${boardSummary(s, names, ME)}`}>
        <Board s={s} bottom={ME} movable={myTurn && s.phase === 'move' ? options.map((index) => ({ owner: controlledOwner(s, ME), index })) : []} />
      </button>

      {s.phase === 'over' ? (
        <>
          <p className="turn-line">{won ? '🎉 فزت!' : rules.teams ? 'فاز الفريق الآخر' : `فاز ${names[s.winner!]}`}</p>
          <button onClick={() => { prev.current = null; setS(newGame(rng.current, rules)); }}>لعبة جديدة</button>
        </>
      ) : (
        <div className="ludo-controls">
          <Dice value={s.phase === 'move' ? s.dice : s.lastMove?.roll ?? null} color={COLORS[s.turn]} />
          {myTurn && s.phase === 'roll' && <button className="ludo-roll" onClick={() => act({ type: 'roll', seat: ME })}>ارمِ النرد</button>}
          {!myTurn && <p className="note" aria-hidden="true">دور {names[s.turn]}</p>}
        </div>
      )}

      {myTurn && s.phase === 'move' && options.length > 1 && (
        <section className="stack" aria-labelledby="ludo-opts">
          <h2 id="ludo-opts" className="sr-only">رميت {rollName(s.dice!)}: اختر الحجر</h2>
          {options.map((i) => (
            <button key={i} className="secondary ludo-option" onClick={() => act({ type: 'move', seat: ME, token: i })}>
              {optionText(s, ME, i, names)}
            </button>
          ))}
        </section>
      )}
    </main>
  );
}

/** النرد: نقاط للعين، والرقم يُعلن صوتياً */
function Dice({ value, color }: { value: number | null; color: string }) {
  const spots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <span className="ludo-dice" style={{ borderColor: color }} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={value && spots[value].includes(i) ? 'on' : ''} />)}
    </span>
  );
}

// ───── رسم اللوحة (15×15) — للعين فقط ─────

type Cell = [number, number];
/** المسار العام: 52 خانة مع عقارب الساعة، تبدأ من خانة بداية الأحمر */
const TRACK_CELLS: Cell[] = [
  ...[1, 2, 3, 4, 5].map((c): Cell => [6, c]),
  ...[5, 4, 3, 2, 1, 0].map((r): Cell => [r, 6]),
  [0, 7],
  ...[0, 1, 2, 3, 4, 5].map((r): Cell => [r, 8]),
  ...[9, 10, 11, 12, 13, 14].map((c): Cell => [6, c]),
  [7, 14],
  ...[14, 13, 12, 11, 10, 9].map((c): Cell => [8, c]),
  ...[9, 10, 11, 12, 13, 14].map((r): Cell => [r, 8]),
  [14, 7],
  ...[14, 13, 12, 11, 10, 9].map((r): Cell => [r, 6]),
  ...[5, 4, 3, 2, 1, 0].map((c): Cell => [8, c]),
  [7, 0], [6, 0],
];
/** الممر الملوّن لكل لون (5 خانات) */
const HOME_CELLS: Cell[][] = [
  [1, 2, 3, 4, 5].map((c): Cell => [7, c]),
  [1, 2, 3, 4, 5].map((r): Cell => [r, 7]),
  [13, 12, 11, 10, 9].map((c): Cell => [7, c]),
  [13, 12, 11, 10, 9].map((r): Cell => [r, 7]),
];
/** البيوت: أعلى اليسار، أعلى اليمين، أسفل اليمين، أسفل اليسار */
const YARDS: Cell[] = [[0, 0], [0, 9], [9, 9], [9, 0]];
const YARD_SPOTS: Cell[] = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]];
const CENTER_SPOT: Cell[] = [[7, 6.25], [6.25, 7], [7, 7.75], [7.75, 7]];

function Board({ s, bottom, movable }: { s: LudoState; bottom: number; movable: { owner: number; index: number }[] }) {
  const U = 22;
  // ندير اللوحة حتى يكون بيت صاحب الجهاز أسفل اليسار
  const turns = (3 - bottom + 4) % 4;
  const rot = ([r, c]: Cell): Cell => {
    let p: Cell = [r, c];
    for (let i = 0; i < turns; i++) p = [p[1], 14 - p[0]];
    return p;
  };
  const xy = (cell: Cell) => { const [r, c] = rot(cell); return { x: c * U + U / 2, y: r * U + U / 2 }; };
  const els: ReactElement[] = [];
  // البيوت
  YARDS.forEach((y, o) => {
    const a = rot(y), b = rot([y[0] + 5, y[1] + 5]);
    const x = Math.min(a[1], b[1]) * U, yy = Math.min(a[0], b[0]) * U;
    els.push(<rect key={`y${o}`} x={x + 1} y={yy + 1} width={6 * U - 2} height={6 * U - 2} rx={10} fill={COLORS[o]} opacity={s.seats.includes(o) ? 0.9 : 0.25} />);
    els.push(<rect key={`yi${o}`} x={x + U} y={yy + U} width={4 * U} height={4 * U} rx={8} fill="#f8f3e3" />);
  });
  // المسار
  TRACK_CELLS.forEach((cell, i) => {
    const { x, y } = xy(cell);
    const start = STARTS.indexOf(i);
    els.push(<rect key={`t${i}`} x={x - U / 2 + 0.5} y={y - U / 2 + 0.5} width={U - 1} height={U - 1} fill={start >= 0 ? COLORS[start] : '#f8f3e3'} stroke="#0d2b2055" />);
    if (SAFE.has(i) && start < 0) els.push(<text key={`st${i}`} x={x} y={y + 5} textAnchor="middle" fontSize={14} fill="#0d2b2099">★</text>);
  });
  HOME_CELLS.forEach((cells, o) => cells.forEach((cell, k) => {
    const { x, y } = xy(cell);
    els.push(<rect key={`h${o}${k}`} x={x - U / 2 + 0.5} y={y - U / 2 + 0.5} width={U - 1} height={U - 1} fill={COLORS[o]} stroke="#0d2b2055" />);
  }));
  // الوسط: أربعة مثلثات
  const c0 = xy([6, 6]), c2 = xy([8, 8]);
  const L = Math.min(c0.x, c2.x) - U / 2, T = Math.min(c0.y, c2.y) - U / 2, R = L + 3 * U, B = T + 3 * U, M = { x: (L + R) / 2, y: (T + B) / 2 };
  // كل مثلث بلون صاحبه: جهة ممره
  [0, 1, 2, 3].forEach((o) => {
    const edge = xy(HOME_CELLS[o][4]);
    const pts = edge.x < L ? [[L, T], [L, B]] : edge.x > R ? [[R, T], [R, B]] : edge.y < T ? [[L, T], [R, T]] : [[L, B], [R, B]];
    els.push(<polygon key={`c${o}`} points={`${pts[0].join(',')} ${pts[1].join(',')} ${M.x},${M.y}`} fill={COLORS[o]} />);
  });
  // الأحجار (أكثر من حجر في خانة: تُزاح قليلاً)
  const seen = new Map<string, number>();
  for (const o of s.seats) {
    s.tokens[o].forEach((p, i) => {
      let cell: Cell;
      if (p === -1) cell = [YARDS[o][0] + YARD_SPOTS[i][0] - 0.5, YARDS[o][1] + YARD_SPOTS[i][1] - 0.5] as Cell;
      else if (p === FINISH) cell = CENTER_SPOT[o];
      else if (p > LAST_TRACK) cell = HOME_CELLS[o][p - LAST_TRACK - 1];
      else cell = TRACK_CELLS[absPos(o, p)];
      const { x, y } = xy(cell);
      const key = `${Math.round(x)},${Math.round(y)}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const off = n * 4;
      els.push(
        <g key={`k${o}${i}`}>
          {movable.some((m) => m.owner === o && m.index === i) && <circle cx={x + off} cy={y - off} r={11} fill="none" stroke="#d4af37" strokeWidth={3} />}
          <circle cx={x + off} cy={y - off} r={p === FINISH ? 5 : 8} fill={COLORS[o]} stroke="#0d2b20" strokeWidth={2} />
          {p !== FINISH && <circle cx={x + off} cy={y - off} r={3} fill="#ffffffaa" />}
        </g>,
      );
    });
  }
  return (
    <svg viewBox={`0 0 ${15 * U} ${15 * U}`} width="100%" aria-hidden="true">
      <rect x={0} y={0} width={15 * U} height={15 * U} rx={12} fill="#0b241b" />
      {els}
    </svg>
  );
}
