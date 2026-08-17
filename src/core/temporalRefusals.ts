/**
 * core/temporalRefusals.ts — pourquoi une mesure d'écart temporal est REFUSÉE.
 *
 * Séparé de la mesure elle-même pour une raison de fond : c'est le fichier
 * qu'on relira le jour où un client dira « ça n'a pas marché chez moi ». Chaque
 * motif de refus y tient en un paragraphe, et chacun rend une phrase affichable
 * telle quelle — jamais un code d'erreur, jamais un silence.
 *
 * ⚠️ Un refus n'est pas une panne. La mesure retombe sur les repères faciaux et
 * l'essayage continue : on ne bloque jamais l'image (§0.0.2). Ce qu'on refuse,
 * c'est de publier un chiffre que la mesure ne porte pas.
 */

import type { TemporalInput } from './temporalWidth.js';

/**
 * Débord maximal admis, PAR CÔTÉ, entre le repère facial et le bord de tête.
 *
 * Les deux seuls essais dont on dispose donnent 20,9 et 14,3 mm au total, soit
 * 10,5 et 7,2 mm par côté. La borne est posée nettement au-dessus pour ne pas
 * refuser une morphologie large, et nettement en dessous d'une chevelure, qui
 * ajoute couramment 20 mm et plus par côté.
 */
export const MAX_TEMPLE_MARGIN_MM = 18;

/** En deçà, le « bord de tête » est le repère lui-même : rien n'a été trouvé. */
export const MIN_TEMPLE_MARGIN_MM = 1;

/** Un visage n'est pas parfaitement symétrique, mais pas à ce point-là. */
export const MAX_TEMPLE_ASYMMETRY_MM = 7;

export interface EdgeVerdict {
  confident: boolean;
  reason: string | null;
}

export interface LineWidth {
  left: EdgeVerdict & { x: number; rows: number };
  right: EdgeVerdict & { x: number; rows: number };
  widthMm: number;
  marginMm: { left: number; right: number };
}

/** Mesure de largeur sur une ligne donnée, fournie par `temporalWidth.ts`. */
export type MeasureLine = (y: number) => LineWidth;

/**
 * Pourquoi la mesure est refusée, ou `null` si elle tient.
 *
 * Séparée du calcul pour que chaque motif de refus soit lisible d'un coup
 * d'œil : c'est la partie du fichier qu'on relira quand un client dira
 * « ça n'a pas marché chez moi ».
 */
export function refusal(
  left: EdgeVerdict,
  right: EdgeVerdict,
  marginMm: { left: number; right: number },
): string | null {
  if (!left.confident) return `À gauche : ${left.reason ?? 'mesure refusée'}.`;
  if (!right.confident) return `À droite : ${right.reason ?? 'mesure refusée'}.`;

  if (marginMm.left < MIN_TEMPLE_MARGIN_MM || marginMm.right < MIN_TEMPLE_MARGIN_MM) {
    return `Aucun débord détecté au-delà du contour du visage : le bord de la tête n'a pas été trouvé.`;
  }

  // ⚠️ Ce contrôle-ci est indispensable, et il ne va PAS de soi. Le balayage
  // part du bord de l'image, donc il trouve aussi les cheveux qui dépassent
  // LARGEMENT de la fenêtre de recherche : la fenêtre borne où l'on s'arrête,
  // pas ce que l'on rencontre avant.
  if (marginMm.left > MAX_TEMPLE_MARGIN_MM || marginMm.right > MAX_TEMPLE_MARGIN_MM) {
    return (
      `Débord de ${Math.max(marginMm.left, marginMm.right).toFixed(0)} mm au-delà du visage : ` +
      `ce sont probablement des cheveux. Dégagez les tempes et recommencez.`
    );
  }

  if (Math.abs(marginMm.left - marginMm.right) > MAX_TEMPLE_ASYMMETRY_MM) {
    return (
      `Débords très différents à gauche (${marginMm.left.toFixed(0)} mm) et à droite ` +
      `(${marginMm.right.toFixed(0)} mm) : cheveux ou objet d'un seul côté.`
    );
  }

  return null;
}

/**
 * ⭐ Le client porte-t-il déjà des lunettes ?
 *
 * ## Pourquoi ce contrôle est indispensable en V1
 *
 * La ligne de balayage passe à hauteur des coins externes des yeux. C'est là
 * que passe la face d'une monture — c'est tout l'intérêt — mais c'est aussi
 * exactement là que passent les BRANCHES d'une monture déjà portée. Le
 * « bord de tête » trouvé serait alors le bord d'une monture, et on mesurerait
 * les lunettes du client au lieu de sa tête, en le lui annonçant au millimètre.
 *
 * Trois erreurs se cumulent d'ailleurs chez un porteur qui ne retire pas ses
 * lunettes : celle-ci, le biais de 10 % sur l'iris du contrôle de cohérence
 * (§4, correctif S2), et l'essayage lui-même, illisible avec une monture réelle
 * sous la monture virtuelle.
 *
 * ## Comment on le détecte sans le deviner
 *
 * On mesure la largeur de la tête à DEUX hauteurs : à hauteur des yeux, et un
 * peu au-dessus, sur la tempe nue. En descendant du front vers la pommette, une
 * tête se rétrécit ou reste égale — elle ne s'élargit pas. Un élargissement
 * franc à hauteur des yeux ne peut donc venir de l'anatomie : quelque chose
 * dépasse, et c'est presque toujours une branche de lunettes.
 *
 * ⚠️ Le test est VOLONTAIREMENT à sens unique. Des cheveux sur la ligne haute
 * élargiraient celle-ci, ce qui rapproche l'écart de zéro : le contrôle se tait
 * alors au lieu de crier à tort. Il rate des cas, il n'en invente pas.
 */
export const GLASSES_STEP_MAX_MM = 4;

/** À quelle hauteur au-dessus des yeux on mesure la tempe nue, en mm réels. */
export const BROW_LINE_OFFSET_MM = 14;

export function glassesRefusal(
  input: TemporalInput,
  eyeY: number,
  eyeLine: LineWidth,
  measureLine: MeasureLine,
): string | null {
  const browY = Math.round(eyeY - BROW_LINE_OFFSET_MM * input.pxPerMm);
  const browLine = measureLine(browY);

  // Ligne haute inexploitable (cheveux, hors cadre) : on ne conclut rien.
  if (!browLine.left.confident || !browLine.right.confident) return null;

  const step = eyeLine.widthMm - browLine.widthMm;
  if (step <= GLASSES_STEP_MAX_MM) return null;

  return (
    `Votre tête paraît ${step.toFixed(0)} mm plus large à hauteur des yeux qu'au-dessus, ` +
    `ce qu'aucune anatomie ne fait : vous portez probablement des lunettes. ` +
    `Retirez-les et recommencez — sinon je mesurerais votre monture, pas votre visage.`
  );
}

