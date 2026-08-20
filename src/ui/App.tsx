/**
 * ui/App.tsx — l'essayage, directement.
 *
 * ⚖️ Arbitrage humain (2026-08-20) : plus d'écran de choix de version. La V2
 * « mode magasin » est abandonnée et ne se présente plus ; le texte carte/iris
 * de l'ancien écran d'accueil disparaît avec elle. La page ouvre la caméra et
 * l'essayage — c'est tout le produit. Le code V2 reste dans le dépôt (TryOn
 * accepte toujours `mode: 'store'`) mais rien ne l'affiche.
 */

import { TryOn } from './TryOn.js';

export function App(): JSX.Element {
  return <TryOn mode="online" onQuit={() => window.location.reload()} />;
}
