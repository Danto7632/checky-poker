// App entry. The boot module MUST stay the first import: ES modules evaluate imports in order, so this is what
// guarantees the invite/share fragment leaves the address bar before any other code runs (A-APP-BOOT).
import './app/shell/boot.ts';
import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import './styles/index.css';

const root = document.getElementById('root');
if (root !== null) createRoot(root).render(<App />);
