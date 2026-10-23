import type { Navigate } from '../state/navigation';

/** شاشة مؤقتة للشاشات التي لم تُبنَ بعد. */
export function Placeholder({ title, navigate }: { title: string; navigate: Navigate }) {
  return (
    <main className="screen" aria-labelledby="ph-title">
      <header className="topbar">
        <h1 id="ph-title">{title}</h1>
        <button className="secondary" onClick={() => navigate('menu')}>رجوع</button>
      </header>
      <p>قيد البناء.</p>
    </main>
  );
}
