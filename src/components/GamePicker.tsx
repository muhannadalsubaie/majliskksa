// اختيار اللعبة عند إنشاء طاولة:
//   1) تظهر أسماء الألعاب: بلوت، دومينو، جاكارو
//   2) إن اخترت جاكارو: تختار النسخة — عادي أو كمبلكس
// لقارئ الشاشة: كل خطوة عنوان يُركَّز عليه، والخيارات أزرار راديو تُقرأ مع حالتها وشرحها.
import { useEffect, useRef, useState } from 'react';

export type GameChoice =
  | { game: 'baloot' }
  | { game: 'domino' }
  | { game: 'jackaroo'; variant: 'classic' | 'complex' };

const GAMES = [
  { id: 'baloot', name: 'بلوت' },
  { id: 'domino', name: 'دومينو' },
  { id: 'jackaroo', name: 'جاكارو' },
] as const;

const VARIANTS = [
  { id: 'classic', name: 'عادي' },
  { id: 'complex', name: 'كمبلكس' },
] as const;

interface Props { onPick: (choice: GameChoice) => void; onCancel: () => void }

export function GamePicker({ onPick, onCancel }: Props) {
  const [step, setStep] = useState<'game' | 'variant'>('game');
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, [step]);

  const choose = (id: (typeof GAMES)[number]['id']) => {
    if (id === 'jackaroo') setStep('variant');
    else onPick({ game: id });
  };

  return (
    <section className="stack" aria-labelledby="picker-title">
      {step === 'game' ? (
        <>
          <h2 id="picker-title" ref={titleRef} tabIndex={-1}>اختر اللعبة</h2>
          <div className="stack" role="list">
            {GAMES.map((g) => (
              <div key={g.id} role="listitem"><button className="secondary game-option" onClick={() => choose(g.id)}>
                <strong>{g.name}</strong>
              </button></div>
            ))}
          </div>
          <button className="secondary back-btn" onClick={onCancel}>رجوع</button>
        </>
      ) : (
        <>
          <h2 id="picker-title" ref={titleRef} tabIndex={-1}>جاكارو: اختر النسخة</h2>
          <div className="stack" role="list">
            {VARIANTS.map((v) => (
              <div key={v.id} role="listitem"><button className="secondary game-option" onClick={() => onPick({ game: 'jackaroo', variant: v.id })}>
                <strong>{v.name}</strong>
              </button></div>
            ))}
          </div>
          <button className="secondary back-btn" onClick={() => setStep('game')}>رجوع</button>
        </>
      )}
    </section>
  );
}
