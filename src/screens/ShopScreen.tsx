import { useEffect, useState } from 'react';
import type { Navigate } from '../state/navigation';
import type { Profile } from '../services/profile';
import { type StorePack, buyPack, loadPacks, purchasesAvailable } from '../services/purchases';

/** متجر العملات: الباقات بأسعار المتجر، والشراء عبر Google Play أو App Store */
export function ShopScreen({ navigate, profile }: { navigate: Navigate; profile: Profile | null }) {
  const [packs, setPacks] = useState<StorePack[] | null>(null);
  const [busy, setBusy] = useState('');
  const native = purchasesAvailable();

  useEffect(() => { void loadPacks().then(setPacks); }, []);

  const balance = profile?.unlimited ? 'لا محدود' : profile?.coins ?? '…';

  return (
    <main className="screen" aria-labelledby="shop-title">
      <header className="topbar">
        <h1 id="shop-title">شراء عملات</h1>
        <button className="secondary back-btn" onClick={() => navigate('menu')}>رجوع</button>
      </header>
      <p style={{ margin: 0 }}>رصيدك الحالي: {balance} 🪙</p>
      {!native && <p className="note" role="status">الشراء متاح في تطبيق الجوال فقط. هنا يمكنك مشاهدة إعلان من القائمة الرئيسية للحصول على عملتين.</p>}
      {packs === null && <p role="status">جارٍ تحميل الباقات…</p>}
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {packs?.map((p) => {
          // نعرض العملات الأساسية والهدية منفصلتين (لا المجموع)
          const base = p.coins - p.bonus;
          const label = `${base} عملة${p.bonus ? ` زائد ${p.bonus} هدية` : ''}، بسعر ${p.price}`;
          return (
            <li key={p.id} className="seat-row">
              <span>
                <strong>{base} عملة</strong>
                {p.bonus > 0 && <span> + {p.bonus} هدية</span>}
              </span>
              <button
                aria-label={`شراء ${label}`}
                disabled={!native || busy !== ''}
                onClick={async () => { setBusy(p.id); await buyPack(p.id); setBusy(''); }}
              >
                {busy === p.id ? 'جارٍ…' : p.price}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="note" style={{ margin: 0 }}>
        يتم الدفع عبر {native ? 'متجر جهازك' : 'Google Play أو App Store'}، وتُضاف العملات فور تأكيد المتجر. العملات للاستخدام داخل اللعبة فقط.
      </p>
    </main>
  );
}
