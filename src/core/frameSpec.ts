/**
 * core/frameSpec.ts — Échelle 1 : le sprite de la monture (CLAUDE.md §4).
 *
 * ZONE CRITIQUE. Contient le garde-fou qui attrape une photo prise de
 * trois quarts, laquelle fausserait tout l'aval de façon invisible.
 */

import { CalibrationError, dist, type Pt } from './geom.js';

/** Bounding box du canal alpha, en pixels sprite. Correctif B3. */
export interface AlphaBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Les 6 points cliqués dans l'outil de prep sur la photo de face. */
export interface FrontMarks {
  p1: Pt;
  p2: Pt; // bord nasal ↔ bord temporal du verre gauche  → cote A
  p3: Pt;
  p4: Pt; // bords intérieurs du pont                    → cote pont
  p5?: Pt;
  p6?: Pt; // haut ↔ bas du verre gauche                  → cote B (optionnelle, cf. §11.5)
}

/** Les cotes réelles, mesurées au réglet. */
export interface FrameSpecMm {
  aMm: number;
  pontMm: number;
  bMm?: number;
}

/**
 * Schéma complet de `public/frames/<slug>/spec.json` — correctif T4.
 *
 * L'ancien schéma listait 7 champs ; six autres étaient exigés par le code
 * sans jamais être déclarés. Un spec.json incomplet faisait planter la moitié
 * du projet, ou pire, se complétait par des valeurs par défaut silencieuses.
 */
export interface FrameSpec {
  slug: string;

  aMm: number;
  pontMm: number;
  bMm?: number;
  brancheMm: number;
  /** Largeur réelle bord à bord. Mesurée (alphaBBox.w / spritePxPerMm), jamais 2×A + pont. */
  totalWidthMm: number;

  front: string;
  profile: string;

  spritePxPerMm: number;
  /** ⭐ B3 : SEULE source de la largeur. Les dimensions du FICHIER sont interdites ici. */
  alphaBBox: AlphaBBox;
  bridgeCenter: Pt;
  lensCenterL: Pt;
  lensCenterR: Pt;
  hingeProfile: Pt;

  /**
   * ⭐ Tenons, marqués sur la photo de FACE (arbitrage 2026-08-19) : le point où
   * la branche SORT visuellement de la face, de chaque côté. Ce ne sont PAS des
   * « charnières » — la charnière est un axe mécanique, souvent invisible de
   * face. Optionnels : les fiches préparées avant cette date ne les ont pas, et
   * `templeRootOf` (core/transform.ts) retombe alors sur une APPROXIMATION dite
   * en clair (bord de la bbox alpha à hauteur du pont).
   */
  templeRootL?: Pt;
  templeRootR?: Pt;

  /**
   * ⭐ T10 — grandeurs du sprite de PROFIL, quand il vient d'une photo trois
   * quarts redressee (`tools/prepare_temple.py`). Optionnelles : un profil
   * photographie a plat n'en a pas besoin, son echelle etant `spritePxPerMm`.
   */
  profilePxPerMm?: number;
  /** Angle de vue MESURE sur la photo 3/4, en degres. Traçabilite seulement. */
  profileViewAngleDeg?: number;
  /** Longueur de branche obtenue apres redressement. C'est un CONTROLE, pas un reglage. */
  templeRectifiedMm?: number;

  calibratedAt: string;
}

/**
 * Échelle 1 — px/mm du sprite, depuis 2 ou 3 cotes de contrôle indépendantes.
 *
 * Ces mesures dérivent du MÊME facteur d'échelle : elles doivent concorder.
 * Si elles divergent, la photo n'a pas été prise perpendiculairement.
 */
export function computeSpritePxPerMm(marks: FrontMarks, spec: FrameSpecMm): number {
  const values = [dist(marks.p1, marks.p2) / spec.aMm, dist(marks.p3, marks.p4) / spec.pontMm];

  if (spec.bMm != null) {
    if (marks.p5 == null || marks.p6 == null) {
      throw new CalibrationError(
        `La cote B (${spec.bMm} mm) est fournie mais les points P5/P6 n'ont pas été placés.`,
      );
    }
    values.push(dist(marks.p5, marks.p6) / spec.bMm);
  }

  const mean = values.reduce((a, b) => a + b) / values.length;
  const spread = (Math.max(...values) - Math.min(...values)) / mean;

  // ⚠️ Sans B (cas V2, cf. §11.5) il ne reste que 2 mesures : la redondance
  // baisse, donc le seuil DOIT se durcir de 4 % à 2,5 %.
  const threshold = values.length === 3 ? 0.04 : 0.025;
  if (spread > threshold) {
    throw new CalibrationError(
      `Incohérence de ${(spread * 100).toFixed(1)}% entre les ${values.length} cotes de contrôle. ` +
        `Photo prise en perspective (pas de face) ou points mal placés. Recommencer.`,
    );
  }
  return mean;
}

/**
 * ⭐ Correctif B3 — la largeur vient de la bounding box alpha, jamais du fichier.
 *
 * La largeur du FICHIER inclut les marges transparentes : 20 px
 * de padding sur un sprite à 12 px/mm injectent +1,7 mm dans le livrable du
 * projet, sans le moindre signe extérieur.
 */
export function totalFrameWidthMm(spec: FrameSpec): number {
  return spec.alphaBBox.w / spec.spritePxPerMm;
}

/** Hauteur réelle du sprite, même principe que la largeur. */
export function totalFrameHeightMm(spec: FrameSpec): number {
  return spec.alphaBBox.h / spec.spritePxPerMm;
}

const REQUIRED_POINTS = ['bridgeCenter', 'lensCenterL', 'lensCenterR', 'hingeProfile'] as const;
const REQUIRED_NUMBERS = ['aMm', 'pontMm', 'brancheMm', 'totalWidthMm', 'spritePxPerMm'] as const;

function isPt(v: unknown): v is Pt {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Pt).x === 'number' &&
    typeof (v as Pt).y === 'number'
  );
}

/**
 * ⭐ T4 — validation stricte au chargement d'un spec.json.
 *
 * Un champ manquant lève une erreur qui LE NOMME. Jamais de valeur par défaut :
 * un `bridgeCenter` valant {0,0} décale toute la monture sans rien signaler,
 * ce qui est très exactement le mode d'échec que ce contrat combat.
 */
export function parseFrameSpec(raw: unknown): FrameSpec {
  if (typeof raw !== 'object' || raw === null) {
    throw new CalibrationError('spec.json : racine absente ou invalide.');
  }
  const o = raw as Record<string, unknown>;

  if (typeof o['slug'] !== 'string') throw new CalibrationError('spec.json : champ "slug" absent.');

  for (const key of REQUIRED_NUMBERS) {
    if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) {
      throw new CalibrationError(`spec.json (${o['slug']}) : champ numérique "${key}" absent ou invalide.`);
    }
  }
  for (const key of REQUIRED_POINTS) {
    if (!isPt(o[key])) {
      throw new CalibrationError(`spec.json (${o['slug']}) : point "${key}" absent ou invalide.`);
    }
  }
  // Tenons optionnels : absents = repli documenté ; présents mais malformés = erreur,
  // jamais une valeur par défaut silencieuse (même règle que les champs requis).
  for (const key of ['templeRootL', 'templeRootR'] as const) {
    if (o[key] !== undefined && !isPt(o[key])) {
      throw new CalibrationError(`spec.json (${o['slug']}) : point optionnel "${key}" invalide.`);
    }
  }

  const bbox = o['alphaBBox'];
  if (
    typeof bbox !== 'object' ||
    bbox === null ||
    typeof (bbox as AlphaBBox).w !== 'number' ||
    typeof (bbox as AlphaBBox).h !== 'number'
  ) {
    throw new CalibrationError(
      `spec.json (${o['slug']}) : "alphaBBox" absente. La largeur ne peut pas être dérivée ` +
        `des dimensions du fichier PNG (correctif B3).`,
    );
  }

  const spec = raw as FrameSpec;

  // Cohérence interne : totalWidthMm DOIT être la bbox convertie, pas une saisie libre.
  const derived = totalFrameWidthMm(spec);
  if (Math.abs(derived - spec.totalWidthMm) > 0.5) {
    throw new CalibrationError(
      `spec.json (${spec.slug}) : totalWidthMm vaut ${spec.totalWidthMm.toFixed(1)} mm ` +
        `mais la bbox alpha donne ${derived.toFixed(1)} mm. La cote a été saisie à la main ` +
        `au lieu d'être mesurée, ou la bbox est périmée.`,
    );
  }
  return spec;
}

export const COLORWAY_TOLERANCE = 0.03; // 3 % — variations de fabrication admises

/**
 * Garde-fou n°2 de la V2 (§11.5) : un coloris est le MÊME modèle.
 * Attrape l'erreur la plus probable en magasin : une photo rattachée au mauvais modèle.
 */
export function assertSameModel(ref: FrameSpec, colorway: FrameSpec): void {
  const checks: ReadonlyArray<readonly [string, number]> = [
    ['A', colorway.aMm / ref.aMm],
    ['pont', colorway.pontMm / ref.pontMm],
    ['rapport', colorway.aMm / colorway.pontMm / (ref.aMm / ref.pontMm)],
  ];

  for (const [name, ratio] of checks) {
    if (Math.abs(ratio - 1) > COLORWAY_TOLERANCE) {
      throw new CalibrationError(
        `Coloris "${colorway.slug}" : écart de ${((ratio - 1) * 100).toFixed(1)}% sur ${name} ` +
          `par rapport au modèle "${ref.slug}". Photo ou cotes rattachées au mauvais modèle.`,
      );
    }
  }
}
