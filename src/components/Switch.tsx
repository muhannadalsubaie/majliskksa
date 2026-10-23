import { useId } from 'react';

interface Props {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** شرح إضافي يُقرأ بعد الاسم والحالة */
  description?: string;
}

/**
 * مفتاح تشغيل/إيقاف قياسي (role="switch") — يقرؤه TalkBack وVoiceOver
 * بالاسم والنوع والحالة، ومساحة اللمس هي الصف كاملاً.
 */
export function Switch({ label, checked, onChange, description }: Props) {
  const descId = useId();
  return (
    <div className="stack" style={{ gap: 4 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? descId : undefined}
        className={`switch-row${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-label">{label}</span>
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      </button>
      {description && <p id={descId} className="note">{description}</p>}
    </div>
  );
}
