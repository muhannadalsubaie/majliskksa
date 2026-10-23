import { useEffect, useRef, useState } from 'react';
import { announce } from '../services/announcer';
import { type TableInvite, respondInvite, socialError } from '../services/social';

/** دعوة واردة لطاولة: تظهر فوق أي شاشة */
export function InviteDialog({ invite, onJoined }: { invite: TableInvite; onJoined: (tableId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { acceptRef.current?.focus(); }, [invite.tableId]);

  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await respondInvite(invite.tableId, accept);
      if (accept) onJoined(invite.tableId);
    } catch (e) {
      announce(socialError(e));
    } finally {
      setBusy(false);
    }
  };
  const answerRef = useRef(answer);
  answerRef.current = answer;
  // زر الرجوع (أو Escape) = رفض الدعوة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void answerRef.current(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="inv-title" aria-describedby="inv-msg">
        <h2 id="inv-title">دعوة لطاولة</h2>
        <p id="inv-msg">{invite.fromName} يدعوك للعب معه في طاولته.</p>
        <div className="actions">
          <button ref={acceptRef} onClick={() => answer(true)} disabled={busy}>قبول</button>
          <button className="secondary" onClick={() => answer(false)} disabled={busy}>رفض</button>
        </div>
      </div>
    </div>
  );
}
