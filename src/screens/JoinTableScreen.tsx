import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { COINS } from '../../shared/economy';
import { type GameKind, GAME_NAMES } from '../../shared/games';
import { announce } from '../services/announcer';
import { connectFirebase } from '../services/firebase';
import { API_ERRORS, joinTable } from '../services/tables';
import type { Navigate } from '../state/navigation';

interface TableRow { id: string; ownerName: string; isPrivate: boolean; players: number; people: number; status: string; kind?: GameKind; variant?: string }

/** اسم اللعبة (الطاولات القديمة بلا نوع = بلوت) */
const gameName = (r: TableRow) => GAME_NAMES[r.kind ?? 'baloot'] + (r.kind === 'jackaroo' && r.variant === 'complex' ? ' كمبلكس' : '');

const STATUS: Record<string, string> = { waiting: 'بانتظار اللاعبين', playing: 'جارية', finished: 'بانتظار مباراة جديدة' };

export function JoinTableScreen({ navigate, openTable }: { navigate: Navigate; openTable: (id: string) => void }) {
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void connectFirebase().then(({ db }) => {
      const q = query(collection(db, 'tables'), orderBy('updatedAt', 'desc'), limit(50));
      unsub = onSnapshot(q, (snap) => {
        // كل طاولة فيها أحد تظهر (الطاولات المغلقة يحذفها الخادم من القائمة)
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TableRow, 'id'>) })));
      }, () => setRows([]));
    }).catch(() => setRows([]));
    return () => unsub?.();
  }, []);

  const join = async (id: string) => {
    setBusy(id);
    try {
      await joinTable(id);
      openTable(id);
    } catch (e) {
      announce(API_ERRORS[(e as Error).message] ?? 'تعذّر الانضمام');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="screen" aria-labelledby="join-title">
      <header className="topbar">
        <h1 id="join-title">الطاولات النشطة</h1>
        <button className="secondary back-btn" onClick={() => navigate('menu')}>رجوع</button>
      </header>
      <p className="note" style={{ fontSize: 16 }}>الانضمام بـ{COINS.joinTable} عملة. إن كانت المقاعد ممتلئة تدخل مشاهداً.</p>
      {rows === null && <p role="status">جارٍ التحميل…</p>}
      {rows?.length === 0 && <p role="status">لا توجد طاولات الآن — أنشئ طاولة جديدة.</p>}
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows?.map((r) => (
          <li key={r.id}>
            <button
              className="secondary table-row"
              disabled={r.isPrivate || busy === r.id}
              onClick={() => join(r.id)}
              aria-label={`${gameName(r)}، طاولة ${r.ownerName}، ${r.isPrivate ? 'مقفلة، ' : ''}${r.players} من 4 لاعبين، ${r.people} حاضرين، ${STATUS[r.status] ?? ''}`}
            >
              <span>{r.isPrivate ? '🔒 ' : ''}طاولة {r.ownerName}</span>
              <span className="note">{gameName(r)} · {r.players}/4 · {STATUS[r.status] ?? ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
