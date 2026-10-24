import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/theme.css';
import { initScreenReader } from './services/screenReader';
import { initFocusKeeper } from './services/focusKeeper';

initScreenReader();
initFocusKeeper();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
