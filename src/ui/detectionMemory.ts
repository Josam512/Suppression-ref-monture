/**
 * ui/detectionMemory.ts — la stratégie de détection NÉGOCIÉE, mémorisée par
 * APPAREIL/NAVIGATEUR (arbitrage humain 2026-08-22).
 *
 * La négociation (tracking/) élimine les stratégies qui lèvent ou restent
 * muettes et ne déclare STABLE que celle qui a produit ≥ 478 landmarks validés
 * sur plusieurs frames. Ce module mémorise CE verdict-là : au prochain
 * démarrage, la stratégie prouvée est essayée EN PREMIER — plus de tour de
 * catalogue à chaque ouverture sur un appareil déjà négocié.
 *
 * Propriété de l'APPAREIL, pas du client : « Nouveau client » n'y touche pas
 * (le stockage est par navigateur, c'est exactement la bonne portée — aucune
 * règle par modèle d'appareil nulle part). `?resetSession=1` la purge comme le
 * reste : les bancs repartent d'une négociation vierge, déterministe.
 *
 * Enveloppe versionnée : une version inconnue ou un id absent du catalogue
 * (catalogue remanié depuis la mémorisation) rendent null — on renégocie,
 * jamais on ne devine.
 */

import { strategyIndexOf } from '../tracking/detectionPlan.js';

export const DETECTION_STORAGE_KEY = 'essayage.detection.v1';
export const DETECTION_MEMORY_VERSION = 1;

/** L'id mémorisé s'il est lisible ET encore au catalogue — sinon null. */
export function loadNegotiatedStrategy(): string | null {
  try {
    const raw = localStorage.getItem(DETECTION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const env = parsed as { v?: unknown; strategyId?: unknown };
    if (env.v !== DETECTION_MEMORY_VERSION) return null;
    if (typeof env.strategyId !== 'string') return null;
    return strategyIndexOf(env.strategyId) !== null ? env.strategyId : null;
  } catch {
    return null; // stockage mort ou JSON corrompu : négociation vierge
  }
}

/** Mémorise la stratégie PROUVÉE stable (écrase la précédente si différente). */
export function saveNegotiatedStrategy(strategyId: string): void {
  try {
    localStorage.setItem(
      DETECTION_STORAGE_KEY,
      JSON.stringify({ v: DETECTION_MEMORY_VERSION, strategyId }),
    );
  } catch {
    // Stockage mort : la négociation refera son travail au prochain démarrage.
  }
}
