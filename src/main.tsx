import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';

const root = document.getElementById('root');
if (root === null) throw new Error('#root introuvable dans index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
