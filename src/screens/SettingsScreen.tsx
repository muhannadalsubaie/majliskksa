import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { connectFirebase } from '../services/firebase';
import { isSpeechEnabled, setSpeechEnabled } from '../services/announcer';
import type { Navigate } from '../state/navigation';

export function SettingsScreen({ navigate }: { navigate: Navigate }) {
  const [speech, setSpeech] = useState(isSpeechEnabled());
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <main className="screen" aria-labelledby="settings-title">
      <header className="topbar">
        <h1 id="settings-title">الإعدادات</h1>
        <button className="secondary" onClick={() => navigate('menu')}>رجوع</button>
      </header>

      <section aria-labelledby="sec-sound" className="stack">
        <h2 id="sec-sound">الصوت</h2>
        <label><input type="checkbox" style={{ width: 'auto' }} /> كتم عام لجميع الأصوات</label>
      </section>

      <section aria-labelledby="sec-a11y" className="stack">
        <h2 id="sec-a11y">إمكانية الوصول</h2>
        <label>
          <input
            type="checkbox" style={{ width: 'auto' }} checked={speech}
            onChange={(e) => { setSpeech(e.target.checked); setSpeechEnabled(e.target.checked); }}
          /> نطق أحداث اللعبة تلقائياً
        </label>
      </section>

      <section aria-labelledby="sec-account" className="stack">
        <h2 id="sec-account">الحساب</h2>
        <button
          className="secondary"
          onClick={async () => {
            try { await signOut((await connectFirebase()).auth); } catch { /* وضع التطوير بدون خادم */ }
            navigate('auth');
          }}
        >تسجيل الخروج</button>
        <button className="danger" onClick={() => setConfirmDelete(true)}>حذف الحساب</button>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="حذف الحساب"
          message="سيتم حذف حسابك وجميع عملاتك نهائياً. لا يمكن التراجع عن هذا الإجراء."
          confirmLabel="حذف نهائياً"
          danger
          onConfirm={() => setConfirmDelete(false) /* TODO: Cloud Function deleteAccount */}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </main>
  );
}
