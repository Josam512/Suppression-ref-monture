import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DetourTool } from './DetourTool.js';

const root = document.getElementById('root');
if (root === null) throw new Error('#root introuvable dans prep.html');

createRoot(root).render(
  <StrictMode>
    <DetourTool />
  </StrictMode>,
);
