// شاشة الجاكارو (لعب محلي: أنت وشريكك الروبوت ضد روبوتين) — جاهزة للربط بمجلسك لاحقاً.
// لقارئ الشاشة: كل ورقة زر يقول ماذا تفعل، والضغط عليها يعرض الحركات الممكنة أزراراً بنص واضح،
// وكل حركة تُعلن، والضغط على اللوحة يقرأ أماكن كل الأحجار.
// إيماءة الإصبعين: من اليمين لليسار = أماكن كل الأحجار، من اليسار لليمين = أحجارك فقط.
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { announce, announceNow } from '../../src/services/announcer';
import { TWO_FINGER, type SwipeDir } from '../../src/services/screenReader';
import { jackarooBotAction } from './bot';
import {
  type Card, type JackarooRules, type JackarooState, type MoveSpec, DEFAULT_RULES, SAFE_SIZE,
  applyJackaroo, controlledOwner, movesForCard, mustBurn, newGame, startOf, teamOf, trackLen,
} from './engine';
import { boardSummary, cardHint, cardName, marbleName, marblePlace, moveAnnouncement, moveText } from './labels';
import './jackaroo.css';

const ME = 0;
const BOT_DELAY_MS = 1100;
const COLORS = ['#d4af37', '#c0392b', '#2e86de', '#27ae60'];
const SUIT_SYMBOL: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

interface Props { onExit: () => void; rules?: JackarooRules; names?: string[] }

export function JackarooTable({ onExit, rules = DEFAULT_RULES, names: given }: Props) {
  const names = useMemo(() => given ?? ['أنت', 'سالم', 'فهد', 'علي'], [given]);
  const rng = useRef(Math.random);
  const [s, setS] = useState<JackarooState>(() => newGame(rng.current, rules));
  const [picked, setPicked] = useState<Card | null>(null);
  const prev = useRef<JackarooState | null>(null);

  // الإعلانات
  useEffect(() => {
    const before = prev.current;
    prev.current = s;
    if (!before) { announce(`بدأت اللعبة. أنت و${names[2]} ضد ${names[1]} و${names[3]}`); }
    else if (s.lastMove !== before.lastMove) moveAnnouncement(s, names, ME).forEach(announce);
    if (before && s.dealNo !== before.dealNo) announce(`توزيع جديد: ${s.hands[ME].length} أوراق`);
    if (s.phase === 'playing' && s.turn === ME && (before?.turn !== ME || before?.lastMove !== s.lastMove)) {
      announce(s.forcedBurn === ME ? 'دورك: عليك أن تحرق ورقة' : mustBurn(s, ME) ? 'دورك: لا لعب صالح، احرق ورقة' : 'دورك');
    }
  }, [s, names]);

  // دور الروبوتات
  useEffect(() => {
    if (s.phase !== 'playing' || s.turn === ME) return;
    const t = setTimeout(() => setS((cur) => {
      const a = jackarooBotAction(cur, cur.turn);
      return a ? applyJackaroo(cur, a, rng.current) : cur;
    }), BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [s]);

  const play = (card: Card, move: MoveSpec | null) => {
    setPicked(null);
    try {
      setS(applyJackaroo(s, move ? { type: 'play', seat: ME, card, move } : { type: 'burn', seat: ME, card }, rng.current));
    } catch (e) { announceNow((e as Error).message); }
  };

  const onCard = (card: Card) => {
    if (s.phase !== 'playing' || s.turn !== ME) { announceNow('ليس دورك'); return; }
    if (mustBurn(s, ME)) { play(card, null); return; }
    const moves = movesForCard(s, ME, card);
    if (!moves.length) { announceNow(`${cardName(card)} لا تصلح الآن`); return; }
    if (moves.length === 1) { play(card, moves[0]); return; }
    setPicked(card);
  };

  const readBoard = useCallback(() => announceNow(boardSummary(s, names, ME)), [s, names]);
  const readMine = useCallback(() => {
    const owner = controlledOwner(s, ME);
    announceNow(`${owner === ME ? 'أحجارك' : `أنهيت أحجارك، تلعب بأحجار ${names[owner]}`}: ${
      s.marbles[owner].map((_, index) => `${index + 1} ${marblePlace(s, { owner, index })}`).join('، ')}`);
  }, [s, names]);
  useEffect(() => {
    const onTwo = (e: Event) => {
      const dir = (e as CustomEvent<SwipeDir>).detail;
      if (dir === 'left') readBoard(); else if (dir === 'right') readMine();
    };
    window.addEventListener(TWO_FINGER, onTwo);
    return () => window.removeEventListener(TWO_FINGER, onTwo);
  }, [readBoard, readMine]);

  const safeCount = (team: number) => [team, team + 2].reduce((n, o) => n + s.marbles[o].filter((m) => m.zone === 'safe').length, 0);
  const myTurn = s.phase === 'playing' && s.turn === ME;
  const burning = myTurn && mustBurn(s, ME);

  return (
    <main className="screen jackaroo-screen" aria-labelledby="jk-title">
      <header className="topbar">
        <h1 id="jk-title">جاكارو</h1>
        <button className="secondary back-btn" onClick={onExit}>خروج</button>
      </header>

      <section className="scores" aria-label="الفريقان">
        <p className="sr-only">في منطقة الأمان: فريقك {safeCount(teamOf(ME))} من 8، الخصم {safeCount(1 - teamOf(ME))} من 8</p>
        <div className="score-box us" aria-hidden="true"><span className="score-label">فريقك</span><strong>{safeCount(teamOf(ME))}/8</strong></div>
        <div className="score-box them" aria-hidden="true"><span className="score-label">الخصم</span><strong>{safeCount(1 - teamOf(ME))}/8</strong></div>
      </section>

      <button className="jk-board-btn" onClick={readBoard} aria-label={`اللوحة: ${boardSummary(s, names, ME)}`}>
        <Board s={s} />
      </button>

      <ul className="jk-players" aria-label="اللاعبون">
        {names.map((n, seat) => (
          <li key={seat} className={s.turn === seat && s.phase === 'playing' ? 'turn' : ''} style={{ borderInlineStartColor: COLORS[seat] }}>
            {n}{seat === 2 ? ' (شريكك)' : ''}، {s.hands[seat].length} أوراق
          </li>
        ))}
      </ul>

      {s.phase === 'over' && (
        <>
          <p className="turn-line">{s.winnerTeam === teamOf(ME) ? '🎉 فاز فريقك!' : 'فاز الفريق الآخر'}</p>
          <button onClick={() => { prev.current = null; setS(newGame(rng.current, rules)); }}>لعبة جديدة</button>
        </>
      )}

      <section className="hand-section" aria-labelledby="jk-hand">
        <h2 id="jk-hand" className="sr-only">أوراقك{burning ? '، اختر ورقة لحرقها' : ''}</h2>
        {burning && <p className="note" aria-hidden="true">لا لعب صالح: اختر ورقة لحرقها</p>}
        <div className="jk-hand">
          {s.hands[ME].map((c) => {
            const usable = myTurn && (burning || movesForCard(s, ME, c).length > 0);
            const red = c.suit === 'H' || c.suit === 'D';
            return (
              <button
                key={`${c.rank}${c.suit}`} className={`jk-card${red ? ' red' : ''}`} aria-disabled={!usable}
                aria-label={`${cardName(c)}، ${burning ? 'حرق' : cardHint(c, rules.kingThirteen, rules.complex)}`}
                onClick={() => onCard(c)}
              >
                <span aria-hidden="true">{c.rank === '10' ? '10' : c.rank}{SUIT_SYMBOL[c.suit]}</span>
              </button>
            );
          })}
        </div>
      </section>

      {picked && (
        <div className="dialog-backdrop">
          <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="jk-moves">
            <h2 id="jk-moves">{cardName(picked)}: اختر الحركة</h2>
            {movesForCard(s, ME, picked).map((m, i) => (
              <button key={i} autoFocus={i === 0} onClick={() => play(picked, m)}>{moveText(m, names, ME)}</button>
            ))}
            <button className="secondary" onClick={() => setPicked(null)}>إلغاء</button>
          </div>
        </div>
      )}
    </main>
  );
}

/** رسم اللوحة: المسار دائرة، ولكل لاعب بيته وقاعدته ومنطقة أمانه — للعين فقط */
function Board({ s }: { s: JackarooState }) {
  const L = trackLen(s.rules);
  const C = 160, R = 130;
  // نرسم من منظور اللاعب 0 أسفل اللوحة
  const angle = (pos: number) => Math.PI / 2 + (2 * Math.PI * pos) / L;
  const at = (pos: number, r = R) => ({ x: C + r * Math.cos(angle(pos)), y: C + r * Math.sin(angle(pos)) });
  const dots: ReactElement[] = [];
  for (let p = 0; p < L; p++) {
    const { x, y } = at(p);
    const owner = [0, 1, 2, 3].find((o) => startOf(s.rules, o) === p);
    dots.push(<circle key={`t${p}`} cx={x} cy={y} r={owner !== undefined ? 6 : 3.5} fill={owner !== undefined ? COLORS[owner] : '#ffffff33'} />);
  }
  const marbles: ReactElement[] = [];
  for (let o = 0; o < 4; o++) {
    s.marbles[o].forEach((m, i) => {
      let x: number, y: number;
      if (m.zone === 'track') ({ x, y } = at(m.pos));
      else if (m.zone === 'safe') ({ x, y } = at(startOf(s.rules, o) - 1, R - 16 - m.pos * 14));
      else ({ x, y } = at(startOf(s.rules, o) + 3 + i * 1.6, R + 18));
      marbles.push(<circle key={`m${o}${i}`} cx={x} cy={y} r={7} fill={COLORS[o]} stroke="#000a" strokeWidth={1.5} opacity={m.zone === 'home' ? 0.55 : 1} />);
    });
    // منطقة الأمان
    for (let k = 0; k < SAFE_SIZE; k++) {
      const { x, y } = at(startOf(s.rules, o) - 1, R - 16 - k * 14);
      dots.push(<circle key={`s${o}${k}`} cx={x} cy={y} r={5} fill="none" stroke={COLORS[o]} strokeWidth={1.5} />);
    }
  }
  return (
    <svg viewBox="0 0 320 320" width="100%" aria-hidden="true">
      <circle cx={C} cy={C} r={R + 30} fill="#0b241b" stroke="#d4af3733" />
      {dots}{marbles}
    </svg>
  );
}

// تصدير للاستخدام في الاختبارات أو شاشات أخرى
export { marbleName };
