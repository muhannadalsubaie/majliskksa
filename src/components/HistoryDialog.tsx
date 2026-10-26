import { useEffect, useRef } from 'react';
import type { HandRecord } from '../../shared/table';

const LEVELS: Record<number, string> = { 2: 'دبل', 3: 'ثري', 4: 'فور' };

/** نص سطر واحد في السجل: يُقرأ كاملاً بنقرة واحدة من قارئ الشاشة */
function line(r: HandRecord, i: number): { title: string; rows: string[] } {
  const level = r.gahwa ? 'قهوة' : LEVELS[r.level] ?? '';
  const winner = r.kaboot ?? (r.buyerFailed ? 1 - r.buyerTeam : r.buyerTeam);
  const loser = 1 - winner;
  return {
    title: `الصكة ${i + 1}: ${r.contract}${level ? ` ${level}` : ''}${r.kaboot !== null ? '، كبوت' : ''}`,
    rows: [
      `المشتري: ${r.buyer} (${r.teams[r.buyerTeam]})`,
      `${r.teams[0]}: ${r.abnat[0]} بنط، ${r.points[0]} نقطة`,
      `${r.teams[1]}: ${r.abnat[1]} بنط، ${r.points[1]} نقطة`,
      `الخاسر: ${r.teams[loser]}${r.buyerFailed && r.kaboot === null ? ' (خسر المشتري)' : ''}`,
    ],
  };
}

/** سجل المباراة: نتيجة كل صكة فقط (نوع اللعب، المشتري، أبناط ونقاط كل فريق، الخاسر) بلا أوراق */
export function HistoryDialog({ history, onClose }: { history: HandRecord[]; onClose: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <h2 id="history-title" ref={titleRef} tabIndex={-1}>السجل</h2>
        {history.length === 0 ? <p>لم تنتهِ أي صكة بعد</p> : (
          <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {history.map((r, i) => {
              const l = line(r, i);
              return (
                <li key={i} className="history-item">
                  {/* فقرة واحدة: يقرؤها قارئ الشاشة كاملة دفعة واحدة */}
                  <p style={{ margin: 0 }}>
                    <strong>{l.title}.</strong>
                    {l.rows.map((row) => <span key={row}><br />{row}.</span>)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        <button className="secondary" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
}
