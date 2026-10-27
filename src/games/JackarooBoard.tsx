// الجاكارو على طاولة مجلسك: الحالة من الخادم (أوراق الآخرين مخفية) والحركات تُرسل إليه.
// لقارئ الشاشة: كل ورقة زر يقول ماذا تفعل، والضغط عليها يعرض الحركات الممكنة أزراراً بنص واضح،
// وحركات الجميع يعلنها الخادم، والضغط على اللوحة يقرأ أماكن كل الأحجار.
// إيماءة الإصبعين: من اليمين لليسار = أماكن كل الأحجار، من اليسار لليمين = أحجارك فقط.
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  type Card, type JackarooState, type MoveSpec, SAFE_SIZE, controlledOwner, movesForCard, mustBurn, startOf, teamOf, trackLen,
} from '../../shared/jackaroo/engine';
import { boardSummary, cardHint, cardName, marblePlace, moveText } from '../../shared/jackaroo/labels';
import { announce, announceNow } from '../services/announcer';
import { isSystemReaderOn } from '../services/nativeA11y';
import { TWO_FINGER, type SwipeDir, isScreenReaderOn } from '../services/screenReader';
import { sounds } from '../services/sounds';

const COLORS = ['#d4af37', '#c0392b', '#2e86de', '#27ae60'];
const SUIT_SYMBOL: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

interface Props {
  s: JackarooState;
  mySeat: number | null;
  names: string[];
  isOwner: boolean;
  act: (action: Record<string, unknown>) => void;
  restart: () => void;
}

export function JackarooBoard({ s, mySeat, names, isOwner, act, restart }: Props) {
  const me = mySeat ?? -1;
  const [picked, setPicked] = useState<Card | null>(null);
  const myTurn = mySeat !== null && s.phase === 'playing' && s.turn === mySeat;
  const burning = myTurn && mustBurn(s, me);

  // "دورك" عند بداية الدور، وصوت الورقة مع كل حركة. الحالة تصل كائناً جديداً مع كل تحديث
  // من الخادم، فنقارن ببصمة الحركة لا بالكائن
  const prev = useRef<{ sig: string; deal: number; turn: number; phase: string } | null>(null);
  useEffect(() => {
    const before = prev.current;
    const sig = JSON.stringify([s.lastMove, s.hands.map((h) => h.length), s.dealNo, s.phase]);
    prev.current = { sig, deal: s.dealNo, turn: s.turn, phase: s.phase };
    if (before && before.sig === sig) return;
    if (before && s.lastMove) sounds.card();
    if (before && s.dealNo !== before.deal) sounds.deal(true);
    if (myTurn) {
      sounds.turn(isSystemReaderOn() || isScreenReaderOn());
      announce(s.forcedBurn === me ? 'دورك: عليك أن تحرق ورقة' : mustBurn(s, me) ? 'دورك: لا لعب صالح، احرق ورقة' : 'دورك');
    }
  }, [s, myTurn, me]);

  // انتهى الدور (أو تغيرت الحالة) والقائمة مفتوحة: نغلقها
  useEffect(() => { if (!myTurn) setPicked(null); }, [myTurn]);

  const play = (card: Card, move: MoveSpec | null) => {
    setPicked(null);
    act(move ? { type: 'play', card, move } : { type: 'burn', card });
  };

  const onCard = (card: Card) => {
    if (!myTurn) { announceNow('ليس دورك'); return; }
    if (burning) { play(card, null); return; }
    const moves = movesForCard(s, me, card);
    if (!moves.length) { announceNow(`${cardName(card)} لا تصلح الآن`); return; }
    if (moves.length === 1) { play(card, moves[0]); return; }
    setPicked(card);
  };

  const readBoard = useCallback(() => announceNow(boardSummary(s, names, me)), [s, names, me]);
  const readMine = useCallback(() => {
    if (mySeat === null) { announceNow(boardSummary(s, names, me)); return; }
    const owner = controlledOwner(s, mySeat);
    announceNow(`${owner === mySeat ? 'أحجارك' : `أنهيت أحجارك، تلعب بأحجار ${names[owner]}`}: ${
      s.marbles[owner].map((_, index) => `${index + 1} ${marblePlace(s, { owner, index })}`).join('، ')}`);
  }, [s, names, me, mySeat]);
  useEffect(() => {
    const onTwo = (e: Event) => {
      const dir = (e as CustomEvent<SwipeDir>).detail;
      if (dir === 'left') readBoard(); else if (dir === 'right') readMine();
    };
    window.addEventListener(TWO_FINGER, onTwo);
    return () => window.removeEventListener(TWO_FINGER, onTwo);
  }, [readBoard, readMine]);

  const safeCount = (team: number) => [team, team + 2].reduce((n, o) => n + s.marbles[o].filter((m) => m.zone === 'safe').length, 0);
  const myTeam = mySeat === null ? 0 : teamOf(mySeat);
  const usLabel = mySeat === null ? `فريق ${names[0]}` : 'فريقك';
  const themLabel = mySeat === null ? `فريق ${names[1]}` : 'الخصم';

  return (
    <>
      <section className="scores" aria-label="الفريقان">
        <p className="sr-only">في منطقة الأمان: {usLabel} {safeCount(myTeam)} من 8، {themLabel} {safeCount(1 - myTeam)} من 8</p>
        <div className="score-box us" aria-hidden="true"><span className="score-label">{usLabel}</span><strong>{safeCount(myTeam)}/8</strong></div>
        <div className="score-box them" aria-hidden="true"><span className="score-label">{themLabel}</span><strong>{safeCount(1 - myTeam)}/8</strong></div>
      </section>

      <button className="jk-board-btn" onClick={readBoard} aria-label={`اللوحة: ${boardSummary(s, names, me)}`}>
        <Board s={s} bottom={mySeat ?? 0} />
      </button>

      <ul className="jk-players" aria-label="اللاعبون">
        {names.map((n, seat) => (
          <li key={seat} className={s.turn === seat && s.phase === 'playing' ? 'turn' : ''} style={{ borderInlineStartColor: COLORS[seat] }}>
            {seat === mySeat ? `${n} (أنت)` : n}{mySeat !== null && seat === (mySeat + 2) % 4 ? ' (شريكك)' : ''}، {s.hands[seat].length} أوراق
          </li>
        ))}
      </ul>

      {s.phase === 'over' && (
        <>
          <p className="turn-line">
            {mySeat === null ? `فاز فريق ${names[s.winnerTeam ?? 0]} و${names[(s.winnerTeam ?? 0) + 2]}` : s.winnerTeam === myTeam ? '🎉 فاز فريقك!' : 'فاز الفريق الآخر'}
          </p>
          {isOwner && <button onClick={restart}>لعبة جديدة</button>}
        </>
      )}

      {mySeat !== null ? (
        <section className="hand-section" aria-labelledby="jk-hand">
          <h2 id="jk-hand" className="sr-only">أوراقك{burning ? '، اختر ورقة لحرقها' : ''}</h2>
          {burning && <p className="note" aria-hidden="true">لا لعب صالح: اختر ورقة لحرقها</p>}
          <div className="jk-hand">
            {s.hands[mySeat].map((c, i) => {
              const usable = myTurn && (burning || movesForCard(s, me, c).length > 0);
              const red = c.suit === 'H' || c.suit === 'D';
              return (
                <button
                  key={`${c.rank}${c.suit}${i}`} className={`jk-card${red ? ' red' : ''}`} aria-disabled={!usable}
                  aria-label={`${cardName(c)}، ${burning ? 'حرق' : cardHint(c, s.rules.kingThirteen, s.rules.complex)}`}
                  onClick={() => onCard(c)}
                >
                  <span aria-hidden="true">{c.rank}{SUIT_SYMBOL[c.suit]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : <p className="note">أنت تشاهد هذه الطاولة.</p>}

      {picked && (
        <div className="dialog-backdrop">
          <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="jk-moves">
            <h2 id="jk-moves">{cardName(picked)}: اختر الحركة</h2>
            {movesForCard(s, me, picked).map((m, i) => (
              <button key={i} autoFocus={i === 0} onClick={() => play(picked, m)}>{moveText(m, names, me)}</button>
            ))}
            <button className="secondary" onClick={() => setPicked(null)}>إلغاء</button>
          </div>
        </div>
      )}
    </>
  );
}

/** رسم اللوحة: المسار دائرة، ولكل لاعب بيته وقاعدته ومنطقة أمانه — للعين فقط. bottom = المقعد المرسوم أسفل اللوحة */
function Board({ s, bottom }: { s: JackarooState; bottom: number }) {
  const L = trackLen(s.rules);
  const C = 160, R = 130;
  const base = startOf(s.rules, bottom);
  const angle = (pos: number) => Math.PI / 2 + (2 * Math.PI * (pos - base)) / L;
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
