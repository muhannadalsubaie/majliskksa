// اختيار اللعبة عند إنشاء طاولة:
//   1) تظهر أسماء الألعاب: بلوت، دومينو، جاكارو، لودو
//   2) الجاكارو: عادي أو كمبلكس — لودو: فردي أو فرق
// لقارئ الشاشة: كل خطوة عنوان يُركَّز عليه، والخيارات أزرار داخل قائمة.
import { useEffect, useRef, useState } from 'react';
import { type GameKind, type GameVariant, GAME_NAMES, VARIANTS } from '../../shared/games';

export interface GameChoice { game: GameKind; variant: GameVariant }

const GAMES: GameKind[] = ['baloot', 'domino', 'jackaroo', 'ludo'];
const VARIANT_NAMES: Record<GameKind, Partial<Record<GameVariant, string>>> = {
  baloot: {}, domino: {},
  jackaroo: { classic: 'عادي', complex: 'كمبلكس' },
  ludo: { classic: 'فردي', teams: 'فرق' },
};

interface Props { onPick: (choice: GameChoice) => void; onCancel: () => void }

export function GamePicker({ onPick, onCancel }: Props) {
  const [game, setGame] = useState<GameKind | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, [game]);

  const choose = (id: GameKind) => {
    if (VARIANTS[id].length > 1) setGame(id);
    else onPick({ game: id, variant: 'classic' });
  };

  return (
    <section className="stack" aria-labelledby="picker-title">
      {game === null ? (
        <>
          <h2 id="picker-title" ref={titleRef} tabIndex={-1}>اختر اللعبة</h2>
          <div className="stack" role="list">
            {GAMES.map((g) => (
              <div key={g} role="listitem">
                <button className="secondary game-option" onClick={() => choose(g)}><strong>{GAME_NAMES[g]}</strong></button>
              </div>
            ))}
          </div>
          <button className="secondary back-btn" onClick={onCancel}>رجوع</button>
        </>
      ) : (
        <>
          <h2 id="picker-title" ref={titleRef} tabIndex={-1}>{GAME_NAMES[game]}: اختر النسخة</h2>
          <div className="stack" role="list">
            {VARIANTS[game].map((v) => (
              <div key={v} role="listitem">
                <button className="secondary game-option" onClick={() => onPick({ game, variant: v })}><strong>{VARIANT_NAMES[game][v]}</strong></button>
              </div>
            ))}
          </div>
          <button className="secondary back-btn" onClick={() => setGame(null)}>رجوع</button>
        </>
      )}
    </section>
  );
}
