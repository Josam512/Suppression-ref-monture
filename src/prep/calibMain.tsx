import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CalibTool } from './CalibTool.js';

const root = document.getElementById('root');
if (root === null) throw new Error('#root introuvable dans calib.html');

createRoot(root).render(
  <StrictMode>
    <CalibTool />
  </StrictMode>,
);
