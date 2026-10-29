import { useEffect, useRef } from 'react';
import type { HandRecord } from '../../shared/table';

const LEVELS: Record<number, string> = { 2: 'دبل', 3: 'ثري', 4: 'فور' };

/** سطر صكة واحدة: نوعها، والمشتري، والأبناط (الصن من 130) ثم المشاريع ثم النقاط كلٌّ في سطر */
function handLines(r: HandRecord, n: number): { title: string; rows: string[] } {
  const level = r.gahwa ? 'قهوة' : LEVELS[r.level] ?? '';
  return {
    title: `الصكة ${n}: ${r.contract}${level ? ` ${level}` : ''}${r.kaboot !== null ? '، كبوت' : ''}`,
    rows: [
      `المشتري: ${r.buyer} (${r.teams[r.buyerTeam]})`,
      `الأبناط: ${r.teams[0]} ${r.abnat[0]}، ${r.teams[1]} ${r.abnat[1]}`,
      `المشاريع: ${r.projects && (r.projects[0] || r.projects[1]) ? `${r.teams[0]} ${r.projects[0]}، ${r.teams[1]} ${r.projects[1]}` : 'لا توجد'}`,
      `النقاط: ${r.teams[0]} ${r.points[0]}، ${r.teams[1]} ${r.points[1]}`,
    ],
  };
}

/** سجل المباراة الحالية: كل صكة بأبناطها ونقاطها هي — بلا أوراق (يبدأ من جديد مع كل مباراة) */
export function HistoryDialog({ history, onClose }: { history: HandRecord[]; onClose: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // صكات المباراة الحالية (وإن بقيت صكات من مباراة سابقة في طاولة قديمة نفصلها)
  const matches = new Map<number, HandRecord[]>();
  for (const r of history) {
    const m = r.match ?? 1;
    matches.set(m, [...(matches.get(m) ?? []), r]);
  }
  const ordered = [...matches.entries()].sort((a, b) => b[0] - a[0]);

  return (
    <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <h2 id="history-title" ref={titleRef} tabIndex={-1}>السجل</h2>
        {ordered.length === 0 && <p>لم تنتهِ أي صكة بعد</p>}
        {ordered.map(([match, hands]) => {
          const total = hands.reduce((acc, r) => [acc[0] + r.points[0], acc[1] + r.points[1]], [0, 0]);
          return (
            <section key={match} className="stack history-match" aria-labelledby={`match-${match}`}>
              <h3 id={`match-${match}`} style={{ margin: 0, fontSize: 18 }}>
                المباراة {match}: {hands[0].teams[0]} {total[0]}، {hands[0].teams[1]} {total[1]}
              </h3>
              <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {hands.map((r, i) => {
                  const l = handLines(r, i + 1);
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
            </section>
          );
        })}
        <button className="secondary" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
}
