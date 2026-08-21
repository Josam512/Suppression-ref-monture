import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';
import { SESSION_STORAGE_KEYS } from './ui/calibrationStorage.js';

// ⭐ Guide point 59 — `?resetSession=1` : remise à zéro EXPLICITE pour les
// bancs de test. Un `?v=12` ne purge rien : sans ce levier, on croit tester
// une correction qui ne s'exécute jamais (l'ancienne calibration mémorisée
// court-circuite le parcours). Outil de banc : ne décide de rien d'autre.
try {
  if (new URLSearchParams(window.location.search).get('resetSession') === '1') {
    for (const key of SESSION_STORAGE_KEYS) localStorage.removeItem(key);
  }
} catch {
  // Stockage inaccessible : rien à purger, la session mémoire suffit.
}

const root = document.getElementById('root');
if (root === null) throw new Error('#root introuvable dans index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
