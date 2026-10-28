import { useEffect, useRef, useState } from 'react';
import { COINS } from '../../shared/economy';
import { gameTitle } from '../../shared/games';
import { type GameChoice, GamePicker } from '../components/GamePicker';
import { Switch } from '../components/Switch';
import { announce } from '../services/announcer';
import { API_ERRORS, createTable } from '../services/tables';
import type { Navigate } from '../state/navigation';

const choiceName = (c: GameChoice) => gameTitle(c.game, c.variant) + (c.game === 'jackaroo' && c.variant === 'classic' ? ' عادي' : '');

export function CreateTableScreen({ navigate, openTable, coins }: { navigate: Navigate; openTable: (id: string) => void; coins: number | null }) {
  // أولاً تختار اللعبة (والجاكارو: عادي أو كمبلكس)، ثم إعدادات الطاولة
  const [choice, setChoice] = useState<GameChoice | null>(null);
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (choice) titleRef.current?.focus(); }, [choice]);

  const create = async () => {
    if (!choice) return;
    setBusy(true);
    setError('');
    try {
      const id = await createTable(isPrivate, choice.game, choice.variant);
      announce('تم إنشاء الطاولة');
      openTable(id);
    } catch (e) {
      const msg = API_ERRORS[(e as Error).message] ?? 'تعذّر إنشاء الطاولة، حاول مرة أخرى';
      setError(msg);
      announce(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!choice) {
    return (
      <main className="screen" aria-label="إنشاء طاولة">
        <GamePicker onPick={setChoice} onCancel={() => navigate('menu')} />
      </main>
    );
  }

  return (
    <main className="screen" aria-labelledby="create-title">
      <header className="topbar">
        <h1 id="create-title" ref={titleRef} tabIndex={-1}>طاولة {choiceName(choice)}</h1>
        <button className="secondary back-btn" onClick={() => setChoice(null)}>رجوع</button>
      </header>
      <p className="note" style={{ fontSize: 16 }}>رصيدك: {coins === Infinity ? 'لا محدود' : coins ?? '…'}{coins === Infinity ? '' : ' عملة'}. إنشاء الطاولة بـ{COINS.createTable} عملة، وكل روبوت تضيفه بعملة.</p>
      <Switch
        label="طاولة خاصة"
        checked={isPrivate}
        onChange={setPrivate}
        description="الطاولة الخاصة تظهر في القائمة مقفلة، ولا يدخلها إلا من تدعوه."
      />
      {error && <p role="alert" style={{ color: 'var(--gold-soft)', margin: 0 }}>{error}</p>}
      <button onClick={create} disabled={busy}>إنشاء الطاولة ({COINS.createTable} 🪙)</button>
    </main>
  );
}
