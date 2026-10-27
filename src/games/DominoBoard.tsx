// الدومينو على طاولة مجلسك: الحالة من الخادم (قطع الآخرين مخفية) والحركات تُرسل إليه.
// لقارئ الشاشة: كل قطعة زر بنص واضح، والطاولة تُقرأ كاملة بالضغط عليها، وحركات الجميع يعلنها الخادم.
// إيماءة الإصبعين: من اليمين لليسار = قطع الطاولة، من اليسار لليمين = الطرفان والنقاط.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type DominoState, type Side, type Tile, canDraw, canPass, ends, fits, playable, sameTile, tileId } from '../../shared/domino/engine';
import { endsLabel, handTileLabel, lineLabel, sideName, tileLabel } from '../../shared/domino/labels';
import { announce, announceNow } from '../services/announcer';
import { isSystemReaderOn } from '../services/nativeA11y';
import { TWO_FINGER, type SwipeDir, isScreenReaderOn } from '../services/screenReader';
import { sounds } from '../services/sounds';

interface Props {
  s: DominoState;
  mySeat: number | null;
  names: string[];
  isOwner: boolean;
  act: (action: Record<string, unknown>) => void;
  restart: () => void;
}

/** رسم قطعة الدومينو: نصفان بالنقاط — للعين فقط */
function DominoTile({ tile, vertical = false }: { tile: Tile; vertical?: boolean }) {
  const half = (n: number) => (
    <span className={`half p${n}`}>{Array.from({ length: n }, (_, i) => <i key={i} />)}</span>
  );
  return (
    <span className={`domino-tile${vertical ? ' vertical' : ''}`} aria-hidden="true">
      {half(tile.a)}<span className="divider" />{half(tile.b)}
    </span>
  );
}

export function DominoBoard({ s, mySeat, names, isOwner, act, restart }: Props) {
  const me = mySeat ?? undefined;
  const [chooseSide, setChooseSide] = useState<Tile | null>(null);
  const myTurn = mySeat !== null && s.phase === 'playing' && s.turn === mySeat;

  // "دورك" مع الطرفين عند بداية الدور (وبعد كل سحب). الحالة تصل كائناً جديداً مع كل تحديث
  // من الخادم، فنقارن ببصمة الحركة لا بالكائن
  const prev = useRef<{ sig: string; turn: number; phase: string } | null>(null);
  useEffect(() => {
    const before = prev.current;
    const sig = JSON.stringify([s.lastMove, s.hands.map((h) => h.length), s.phase, s.scores]);
    prev.current = { sig, turn: s.turn, phase: s.phase };
    if (before && before.sig === sig) return;
    if (before && s.lastMove?.kind === 'play') sounds.card();
    if (before && before.phase !== 'playing' && s.phase === 'playing') sounds.deal(true);
    if (!myTurn || mySeat === null) return;
    const turnStarted = !before || before.turn !== mySeat || before.phase !== 'playing';
    if (turnStarted) sounds.turn(isSystemReaderOn() || isScreenReaderOn());
    else if (s.lastMove?.kind !== 'draw') return;
    const options = playable(s, mySeat);
    announce(options.length ? `دورك. ${endsLabel(s)}` : canDraw(s, mySeat) ? `دورك. لا قطعة تصلح، اسحب من البنك. ${endsLabel(s)}` : `دورك. لا قطعة تصلح، دق. ${endsLabel(s)}`);
  }, [s, myTurn, mySeat]);

  const playTile = (tile: Tile) => {
    if (mySeat === null) return;
    if (!myTurn) { announceNow('ليس دورك'); return; }
    if (!playable(s, mySeat).some((t) => sameTile(t, tile))) { announceNow(`${tileLabel(tile)} لا تصلح`); return; }
    const sides = fits(s, tile);
    const e = ends(s);
    // تصلح على طرفين مختلفين: نسأل أين
    if (s.line.length && sides.length === 2 && e && e.left !== e.right) { setChooseSide(tile); return; }
    act({ type: 'play', tile });
  };

  const scoreText = useCallback(
    () => `النقاط: ${s.scores.map((n, side) => `${sideName(s, side, names, me)} ${n}`).join('، ')}. الهدف ${s.rules.target}`,
    [s, names, me],
  );
  const readBoard = useCallback(() => announceNow(`${lineLabel(s)}. ${endsLabel(s)}`), [s]);
  const readScore = useCallback(() => announceNow(`${endsLabel(s)}. ${scoreText()}. في البنك ${s.boneyard.length} قطعة`), [s, scoreText]);
  useEffect(() => {
    const onTwo = (e: Event) => {
      const dir = (e as CustomEvent<SwipeDir>).detail;
      if (dir === 'left') readBoard();
      else if (dir === 'right') readScore();
    };
    window.addEventListener(TWO_FINGER, onTwo);
    return () => window.removeEventListener(TWO_FINGER, onTwo);
  }, [readBoard, readScore]);

  const legal = mySeat === null ? [] : playable(s, mySeat);
  const e = ends(s);
  const mySide = me === undefined ? -1 : me % 2;

  return (
    <>
      <section className="scores" aria-label="النقاط">
        <p className="sr-only">{scoreText()}</p>
        {s.scores.map((n, side) => (
          <div key={side} className={`score-box${side === mySide ? ' us' : ''}`} aria-hidden="true">
            <span className="score-label">{sideName(s, side, names, me)}</span><strong>{n}</strong>
          </div>
        ))}
      </section>

      <ul className="domino-players" aria-label="اللاعبون">
        {names.map((n, seat) => seat === mySeat ? null : (
          <li key={seat} className={s.turn === seat && s.phase === 'playing' ? 'turn' : ''}>
            {n}{mySeat !== null && seat === (mySeat + 2) % 4 ? ' (شريكك)' : ''}، {s.hands[seat].length} قطع
          </li>
        ))}
      </ul>

      {/* الطاولة: تُقرأ كاملة بالضغط عليها */}
      <button className="domino-line" onClick={readBoard} aria-label={`${lineLabel(s)}. ${endsLabel(s)}`}>
        {s.line.length === 0 && <span className="note">الطاولة فارغة</span>}
        {s.line.map((p) => <DominoTile key={tileId(p.tile)} tile={orient(p)} vertical={p.tile.a === p.tile.b} />)}
      </button>
      {e && <p className="domino-ends" aria-hidden="true">يمين {e.right} — يسار {e.left}{s.boneyard.length ? ` — في البنك ${s.boneyard.length}` : ''}</p>}

      {s.phase !== 'playing' && (
        <p className="turn-line">{s.phase === 'matchOver' ? 'انتهت المباراة' : 'انتهت الصكة، الصكة التالية بعد لحظات'}</p>
      )}

      {myTurn && mySeat !== null && (canDraw(s, mySeat) || canPass(s, mySeat)) && (
        <div className="action-row">
          {canDraw(s, mySeat) && <button onClick={() => act({ type: 'draw' })}>سحب من البنك</button>}
          {canPass(s, mySeat) && <button onClick={() => act({ type: 'pass' })}>دق</button>}
        </div>
      )}
      {s.phase === 'matchOver' && isOwner && <button onClick={restart}>مباراة جديدة</button>}

      {mySeat !== null ? (
        <section className="hand-section" aria-labelledby="domino-hand">
          <h2 id="domino-hand" className="sr-only">قطعك</h2>
          <div className="domino-hand">
            {[...s.hands[mySeat]].sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || Math.min(y.a, y.b) - Math.min(x.a, x.b)).map((t) => {
              const ok = myTurn && legal.some((l) => sameTile(l, t));
              return (
                <button
                  key={tileId(t)} className="domino-btn" aria-disabled={!ok}
                  aria-label={handTileLabel(s, t, fits(s, t), ok)}
                  onClick={() => playTile(t)}
                >
                  <DominoTile tile={t} vertical />
                </button>
              );
            })}
          </div>
        </section>
      ) : <p className="note">أنت تشاهد هذه الطاولة.</p>}

      {chooseSide && e && (
        <div className="dialog-backdrop">
          <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="side-title">
            <h2 id="side-title">أين تلعب {tileLabel(chooseSide)}؟</h2>
            {(['right', 'left'] as Side[]).map((side) => (
              <button key={side} autoFocus={side === 'right'} onClick={() => { setChooseSide(null); act({ type: 'play', tile: chooseSide, side }); }}>
                {side === 'right' ? `اليمين (على ${e.right})` : `اليسار (على ${e.left})`}
              </button>
            ))}
            <button className="secondary" onClick={() => setChooseSide(null)}>إلغاء</button>
          </div>
        </div>
      )}
    </>
  );
}

/** نعرض القطعة بحيث يلاصق رقمها المطابق جارتها في الخط */
function orient(p: DominoState['line'][number]): Tile {
  if (p.side === 'first') return p.tile;
  const inner = (p.tile.a === p.outer ? p.tile.b : p.tile.a);
  // الخط مرسوم من اليمين لليسار في الصفحة العربية
  return p.side === 'right' ? { a: inner, b: p.outer } : { a: p.outer, b: inner };
}
