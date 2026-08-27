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
  /**
   * ⭐ Complément 30 — longueur de RÉFÉRENCE du sprite de profil : la longueur
   * de branche telle que le redressement l'a LUE dans les pixels, celle contre
   * laquelle `profilePxPerMm` a été calibrée. Elle ne sert QU'À ça.
   *
   * 🔴 Ce n'est PAS la longueur physique de la branche : c'est `brancheMm`
   * (la cote fabricant) que le renderer peint — les fiches réelles montraient
   * des écarts énormes (147 → 137,1 ; 145 → 174,5) et l'ancien nom
   * `templeRectifiedMm` avait fini par SERVIR de longueur physique. Le rapport
   * `brancheMm / profileReferenceLengthMm` corrige l'échelle du sprite.
   */
  profileReferenceLengthMm?: number;
  /** Nom HISTORIQUE de `profileReferenceLengthMm` — lu en repli, plus jamais écrit. */
  templeRectifiedMm?: number;
  profileAxisRad?: number; // 🔴 pente de MISE EN PAGE du profil, mesurée au chargement (ui/profileAxis.ts) — jamais dans les fiches

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
 * ⭐ Correctif B3 — la largeur vient de la bounding box alpha, JAMAIS du
 * fichier : 20 px de marge transparente à 12 px/mm injecteraient +1,7 mm dans
 * le livrable du projet, sans le moindre signe extérieur.
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
/** ⭐ A15 — les fichiers d'images sont aussi le CONTRAT : jamais vides. */
const REQUIRED_STRINGS = ['slug', 'front', 'profile'] as const;

function isPt(v: unknown): v is Pt {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as Pt).x) && // ⭐ A15 — un NaN n'est pas une coordonnée
    Number.isFinite((v as Pt).y)
  );
}

/**
 * ⭐ T4/A15 — validation stricte au chargement d'un spec.json. Un champ
 * manquant lève une erreur qui LE NOMME ; jamais de valeur par défaut — un
 * `bridgeCenter` à {0,0} décalerait toute la monture sans rien signaler.
 */
export function parseFrameSpec(raw: unknown): FrameSpec {
  if (typeof raw !== 'object' || raw === null) {
    throw new CalibrationError('spec.json : racine absente ou invalide.');
  }
  const o = raw as Record<string, unknown>;

  for (const key of REQUIRED_STRINGS) {
    const v = o[key];
    if (typeof v !== 'string' || v.trim() === '') {
      throw new CalibrationError(`spec.json (${String(o['slug'] ?? '?')}) : champ "${key}" absent ou vide.`);
    }
  }

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

  // ⭐ Guide point 55 — validation STRICTE : une fiche mauvaise est UNE
  // monture invalide, jamais une application invalide (le catalogue l'isole).
  for (const [name, v] of [
    ['aMm', spec.aMm],
    ['pontMm', spec.pontMm],
    ['brancheMm', spec.brancheMm],
    ['totalWidthMm', spec.totalWidthMm],
    ['spritePxPerMm', spec.spritePxPerMm],
  ] as const) {
    if (!(v > 0)) {
      throw new CalibrationError(`spec.json (${spec.slug}) : "${name}" doit être strictement positif (${v}).`);
    }
  }
  const bb = spec.alphaBBox;
  if (!(bb.w > 0) || !(bb.h > 0) || !Number.isFinite(bb.x) || !Number.isFinite(bb.y) || bb.x < 0 || bb.y < 0) {
    throw new CalibrationError(`spec.json (${spec.slug}) : alphaBBox dégénérée (${bb.x},${bb.y},${bb.w},${bb.h}).`);
  }
  // Les ancres doivent vivre DANS l'image. Ici, borne PROVISOIRE dérivée de la
  // bbox (l'image n'est pas encore chargée) ; la borne RÉELLE est vérifiée au
  // chargement du sprite (`core/specAnchors.ts`, branché dans useSprites — A15).
  const maxX = bb.x + bb.w * 1.5;
  const maxY = bb.y + bb.h * 3;
  for (const [name, p] of [
    ['bridgeCenter', spec.bridgeCenter],
    ['lensCenterL', spec.lensCenterL],
    ['lensCenterR', spec.lensCenterR],
  ] as const) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > maxX || p.y > maxY) {
      throw new CalibrationError(
        `spec.json (${spec.slug}) : "${name}" (${p.x}, ${p.y}) hors de l'image du sprite.`,
      );
    }
  }
  for (const [name, v] of [
    ['profilePxPerMm', spec.profilePxPerMm],
    ['profileReferenceLengthMm', spec.profileReferenceLengthMm],
    ['templeRectifiedMm', spec.templeRectifiedMm],
    ['bMm', spec.bMm], // ⭐ A15 — présent, il doit être une vraie cote
  ] as const) {
    if (v !== undefined && !(Number.isFinite(v) && v > 0)) {
      throw new CalibrationError(`spec.json (${spec.slug}) : "${name}" présent mais non positif (${v}).`);
    }
  }
  // ⭐ A15 — un angle de vue de photo 3/4 plausible : ]0°, 90°] (90° = profil pur).
  const angle = spec.profileViewAngleDeg;
  if (angle !== undefined && !(Number.isFinite(angle) && angle > 0 && angle <= 90)) {
    throw new CalibrationError(`spec.json (${spec.slug}) : "profileViewAngleDeg" implausible (${angle}).`);
  }
  // ⭐ A15 — la date de calibration fait partie de la traçabilité : lisible ou refusée.
  if (Number.isNaN(Date.parse(spec.calibratedAt))) {
    throw new CalibrationError(`spec.json (${spec.slug}) : "calibratedAt" illisible (${spec.calibratedAt}).`);
  }

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
