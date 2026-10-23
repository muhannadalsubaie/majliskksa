import { useState } from 'react';
import { COINS } from '../../shared/economy';
import { Switch } from '../components/Switch';
import { announce } from '../services/announcer';
import { API_ERRORS, createTable } from '../services/tables';
import type { Navigate } from '../state/navigation';

export function CreateTableScreen({ navigate, openTable, coins }: { navigate: Navigate; openTable: (id: string) => void; coins: number | null }) {
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const id = await createTable(isPrivate);
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

  return (
    <main className="screen" aria-labelledby="create-title">
      <header className="topbar">
        <h1 id="create-title">إنشاء طاولة</h1>
        <button className="secondary" onClick={() => navigate('menu')}>رجوع</button>
      </header>
      <p className="note" style={{ fontSize: 16 }}>رصيدك: {coins ?? '…'} عملة. إنشاء الطاولة بـ{COINS.createTable} عملة، وكل روبوت تضيفه بعملة.</p>
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
