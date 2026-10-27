// شاشة لعبة الدومينو (لعب محلي ضد الروبوتات) — جاهزة للربط بمجلسك لاحقاً.
// مصممة لقارئ الشاشة أولاً: كل قطعة زر بنص واضح، والطاولة تُقرأ كاملة، وكل حركة تُعلن،
// وإيماءة الإصبعين: من اليمين لليسار = قطع الطاولة، من اليسار لليمين = الطرفان والنقاط.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { announce, announceNow } from '../../src/services/announcer';
import { TWO_FINGER, type SwipeDir } from '../../src/services/screenReader';
import { dominoBotAction } from './bot';
import {
  type DominoRules, type DominoState, type Side, type Tile, DEFAULT_RULES,
  applyDomino, canDraw, canPass, ends, fits, newMatch, nextHand, playable, sameTile, tileId,
} from './engine';
import { endsLabel, handAnnouncement, handTileLabel, lineLabel, moveAnnouncement, sideName, tileLabel } from './labels';
import './domino.css';

const BOT_DELAY_MS = 1100;
const ME = 0;

interface Props {
  onExit: () => void;
  rules?: DominoRules;
  /** اسم اللاعب ثم أسماء الروبوتات بالترتيب */
  names?: string[];
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

export function DominoTable({ onExit, rules = DEFAULT_RULES, names: given }: Props) {
  const names = useMemo(
    () => given ?? ['أنت', 'سالم', 'فهد', 'علي'].slice(0, rules.players),
    [given, rules.players],
  );
  const rng = useRef(Math.random);
  const [s, setS] = useState<DominoState>(() => newMatch(rng.current, rules));
  const [chooseSide, setChooseSide] = useState<Tile | null>(null);
  const prev = useRef<DominoState | null>(null);

  // إعلانات: كل حركة، ثم "دورك" مع الطرفين، ونهاية الصكة
  useEffect(() => {
    const before = prev.current;
    prev.current = s;
    if (!before) {
      announce(`بدأت المباراة، ${rules.players === 4 ? 'فريقان: أنت و' + names[2] + ' ضد ' + names[1] + ' و' + names[3] : `${rules.players} لاعبين`}. الهدف ${rules.target} نقطة`);
    } else if (s.lastMove && s.lastMove !== before.lastMove) {
      announce(moveAnnouncement(s, names));
    }
    if (s.phase !== 'playing') { handAnnouncement(s, names).forEach(announce); return; }
    if (before && before.phase !== 'playing') announce(`صكة جديدة. يبدأ ${names[s.turn]}`);
    if (s.turn === ME && (before?.turn !== ME || before?.phase !== 'playing' || before.lastMove?.kind === 'draw')) {
      const options = playable(s, ME);
      announce(options.length ? `دورك. ${endsLabel(s)}` : canDraw(s, ME) ? `دورك. لا قطعة تصلح، اسحب من البنك. ${endsLabel(s)}` : `دورك. لا قطعة تصلح، دق. ${endsLabel(s)}`);
    }
  }, [s, names, rules]);

  // دور الروبوتات
  useEffect(() => {
    if (s.phase !== 'playing' || s.turn === ME) return;
    const t = setTimeout(() => {
      setS((cur) => {
        const a = dominoBotAction(cur, cur.turn);
        return a ? applyDomino(cur, a) : cur;
      });
    }, BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [s]);

  const act = (a: Parameters<typeof applyDomino>[1]) => {
    try { setS(applyDomino(s, a)); } catch (e) { announceNow((e as Error).message); }
  };

  const playTile = (tile: Tile) => {
    if (s.turn !== ME) { announceNow('ليس دورك'); return; }
    if (!playable(s, ME).some((t) => sameTile(t, tile))) { announceNow(`${tileLabel(tile)} لا تصلح`); return; }
    const sides = fits(s, tile);
    const e = ends(s);
    // تصلح على طرفين مختلفين: نسأل أين
    if (s.line.length && sides.length === 2 && e && e.left !== e.right) { setChooseSide(tile); return; }
    act({ type: 'play', seat: ME, tile });
  };

  // إيماءة الإصبعين وقراءة سريعة
  const readBoard = useCallback(() => announceNow(`${lineLabel(s)}. ${endsLabel(s)}`), [s]);
  const readScore = useCallback(() => announceNow(
    `${endsLabel(s)}. النقاط: ${s.scores.map((n, side) => `${sideName(s, side, names, ME)} ${n}`).join('، ')}. في البنك ${s.boneyard.length} قطعة`,
  ), [s, names]);
  useEffect(() => {
    const onTwo = (e: Event) => {
      const dir = (e as CustomEvent<SwipeDir>).detail;
      if (dir === 'left') readBoard();
      else if (dir === 'right') readScore();
    };
    window.addEventListener(TWO_FINGER, onTwo);
    return () => window.removeEventListener(TWO_FINGER, onTwo);
  }, [readBoard, readScore]);

  const legal = playable(s, ME);
  const myTurn = s.phase === 'playing' && s.turn === ME;
  const e = ends(s);

  return (
    <main className="screen domino-screen" aria-labelledby="domino-title">
      <header className="topbar">
        <h1 id="domino-title">دومينو</h1>
        <button className="secondary back-btn" onClick={onExit}>خروج</button>
      </header>

      <section className="scores" aria-label="النقاط">
        <p className="sr-only">النقاط: {s.scores.map((n, side) => `${sideName(s, side, names, ME)} ${n}`).join('، ')}. الهدف {rules.target}</p>
        {s.scores.map((n, side) => (
          <div key={side} className={`score-box${side === 0 ? ' us' : ''}`} aria-hidden="true">
            <span className="score-label">{sideName(s, side, names, ME)}</span><strong>{n}</strong>
          </div>
        ))}
      </section>

      <ul className="domino-players" aria-label="اللاعبون">
        {names.map((n, seat) => seat === ME ? null : (
          <li key={seat} className={s.turn === seat && s.phase === 'playing' ? 'turn' : ''}>
            {n}، {s.hands[seat].length} قطع{s.turn === seat && s.phase === 'playing' ? '، دوره الآن' : ''}
          </li>
        ))}
      </ul>

      {/* الطاولة: تُقرأ كاملة بالضغط عليها */}
      <button className="domino-line" onClick={readBoard} aria-label={`${lineLabel(s)}. ${endsLabel(s)}`}>
        {s.line.length === 0 && <span className="note">الطاولة فارغة</span>}
        {s.line.map((p) => <DominoTile key={tileId(p.tile)} tile={orient(p)} vertical={p.tile.a === p.tile.b} />)}
      </button>
      {e && <p className="domino-ends" aria-hidden="true">يمين {e.right} — يسار {e.left}{s.boneyard.length ? ` — في البنك ${s.boneyard.length}` : ''}</p>}

      <p className="turn-line">
        {s.phase === 'playing' ? (myTurn ? 'دورك' : `دور ${names[s.turn]}`) : s.phase === 'matchOver' ? 'انتهت المباراة' : 'انتهت الصكة'}
      </p>

      {myTurn && (canDraw(s, ME) || canPass(s, ME)) && (
        <div className="action-row">
          {canDraw(s, ME) && <button onClick={() => act({ type: 'draw', seat: ME })}>سحب من البنك</button>}
          {canPass(s, ME) && <button onClick={() => act({ type: 'pass', seat: ME })}>دق</button>}
        </div>
      )}
      {s.phase === 'handOver' && <button onClick={() => setS(nextHand(s, rng.current))}>الصكة التالية</button>}
      {s.phase === 'matchOver' && <button onClick={() => { prev.current = null; setS(newMatch(rng.current, rules)); }}>مباراة جديدة</button>}

      <section className="hand-section" aria-labelledby="domino-hand">
        <h2 id="domino-hand" className="sr-only">قطعك</h2>
        <div className="domino-hand">
          {[...s.hands[ME]].sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || Math.min(y.a, y.b) - Math.min(x.a, x.b)).map((t) => {
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

      {chooseSide && e && (
        <div className="dialog-backdrop">
          <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="side-title">
            <h2 id="side-title">أين تلعب {tileLabel(chooseSide)}؟</h2>
            {(['right', 'left'] as Side[]).map((side) => (
              <button key={side} autoFocus={side === 'right'} onClick={() => { setChooseSide(null); act({ type: 'play', seat: ME, tile: chooseSide, side }); }}>
                {side === 'right' ? `اليمين (على ${e.right})` : `اليسار (على ${e.left})`}
              </button>
            ))}
            <button className="secondary" onClick={() => setChooseSide(null)}>إلغاء</button>
          </div>
        </div>
      )}
    </main>
  );
}

/** نعرض القطعة بحيث يلاصق رقمها المطابق جارتها في الخط */
function orient(p: DominoState['line'][number]): Tile {
  if (p.side === 'first') return p.tile;
  const inner = (p.tile.a === p.outer ? p.tile.b : p.tile.a);
  // الخط مرسوم من اليمين لليسار في الصفحة العربية
  return p.side === 'right' ? { a: inner, b: p.outer } : { a: p.outer, b: inner };
}
