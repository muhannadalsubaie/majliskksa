import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** صندوق تأكيد عام للإجراءات الحساسة. */
export function ConfirmDialog({ title, message, confirmLabel = 'تأكيد', danger, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h2 id="dlg-title">{title}</h2>
        <p id="dlg-msg">{message}</p>
        <div className="actions">
          <button className={danger ? 'danger' : undefined} onClick={onConfirm}>{confirmLabel}</button>
          <button ref={cancelRef} className="secondary" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
