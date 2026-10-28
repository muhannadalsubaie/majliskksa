interface Props {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** شرح إضافي تحت المفتاح (نص عادي — لا يُقرأ كتلميح بعد الزر) */
  description?: string;
}

/**
 * مفتاح تشغيل/إيقاف قياسي (role="switch") — يقرؤه TalkBack وVoiceOver
 * بالاسم والنوع والحالة، ومساحة اللمس هي الصف كاملاً.
 */
export function Switch({ label, checked, onChange, description }: Props) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch-row${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-label">{label}</span>
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      </button>
      {description && <p className="note">{description}</p>}
    </div>
  );
}
