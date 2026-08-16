#!/usr/bin/env python3
"""
tools/prepare_temple.py — extrait la BRANCHE depuis une photo trois quarts.

Pourquoi c'est possible sans photo de profil a plat
---------------------------------------------------
Quand une monture est vue de trois quarts, elle tourne autour d'un axe
VERTICAL. Les dimensions verticales ne se raccourcissent donc pas du tout —
c'est exactement le raisonnement du correctif S1, applique ici a l'envers :

  • la HAUTEUR du verre (cote B) donne l'echelle s, sans etre affectee par
    l'angle de vue ;
  • l'ecart des centres optiques, lui, est raccourci en cos(theta) :
        ecart_px = (A + pont) x cos(theta) x s
    → theta se deduit, il n'est pas suppose.

La branche est perpendiculaire a la face : sa longueur apparente vaut donc
L x sin(theta) x s. Une fois theta connu, on redresse la branche en l'etirant
horizontalement de 1 / sin(theta), et on obtient le sprite de profil a plat que
le rendu attend.

⚠️ Aucune 3D n'est introduite. On extrait DEUX scalaires — une echelle et un
angle — depuis une image, exactement comme le §4 l'autorise pour la carte.

Usage :
  python3 tools/prepare_temple.py photo34.jpg --slug p8-m252 --a 43 --pont 23 \\
      --b 38 --branche 145
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from prepare_frame import (
    MIN_LENS_AREA_RATIO,
    NEUTRAL_MAX,
    WHITE_MIN,
    crop_black_bars,
    flood_background,
    label_holes,
)

# En deca, la branche est trop de face pour etre redressee sans amplifier le bruit.
MIN_VIEW_ANGLE_DEG = 12


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("photo")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--a", type=float, required=True)
    ap.add_argument("--pont", type=float, required=True)
    ap.add_argument("--b", type=float, required=True, help="hauteur de verre, mm — donne l'echelle")
    ap.add_argument("--branche", type=float, required=True)
    ap.add_argument("--largeur", type=float, required=True, help="largeur totale au reglet, mm")
    ap.add_argument("--out", default="public/frames")
    args = ap.parse_args()

    rgb = crop_black_bars(np.asarray(Image.open(args.photo).convert("RGB")).astype(np.uint8))
    chan_min = rgb.min(axis=2).astype(int)
    sat = rgb.max(axis=2).astype(int) - chan_min
    whiteish = (chan_min >= WHITE_MIN) & (sat <= NEUTRAL_MAX)
    solid = ~flood_background(whiteish)

    ys, xs = np.where(solid)
    if len(xs) == 0:
        print("❌ silhouette vide.")
        return 1
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop_rgb = rgb[y0 : y1 + 1, x0 : x1 + 1]
    crop_solid = solid[y0 : y1 + 1, x0 : x1 + 1]
    crop_white = whiteish[y0 : y1 + 1, x0 : x1 + 1]
    H, W = crop_solid.shape

    _, stats = label_holes(crop_white & crop_solid)
    area_min = MIN_LENS_AREA_RATIO * W * H
    kept = [s for s in stats if s["area"] >= area_min]
    if len(kept) < 2:
        print(f"❌ {len(kept)} verre(s) detecte(s) : impossible de mesurer l'angle de vue.")
        return 1

    kept.sort(key=lambda s: s["cx"])
    lens_a, lens_b = kept[0], kept[-1]

    # ── Echelle : la HAUTEUR du verre, insensible a la rotation verticale.
    heights = [lens_a["y1"] - lens_a["y0"] + 1, lens_b["y1"] - lens_b["y0"] + 1]
    scale = (sum(heights) / len(heights)) / args.b

    # ── Angle de vue : l'ecart des centres, lui, est raccourci en cos(theta).
    gap_px = abs((lens_b["x0"] + lens_b["x1"]) / 2 - (lens_a["x0"] + lens_a["x1"]) / 2)
    cos_theta = min(1.0, gap_px / ((args.a + args.pont) * scale))
    theta = math.acos(cos_theta)
    deg = math.degrees(theta)
    print(f"  echelle {scale:.3f} px/mm (via B) · angle de vue mesure {deg:.1f}°")

    if deg < MIN_VIEW_ANGLE_DEG:
        print(f"❌ vue trop frontale ({deg:.1f}°) : le redressement amplifierait le bruit.")
        return 1

    # ── La branche part du verre le plus eloigne et s'etend vers l'exterieur.
    temple_on_left = lens_a["x0"] > W - lens_b["x1"]

    # ⚠️ On ne coupe PAS au bord du verre : entre le verre et la charniere il y
    # a le TENON, qui appartient a la face. Le tenon se raccourcit en cos(theta),
    # la branche en sin(theta) : les etirer ensemble donne des branches 20 a
    # 30 % trop longues sur les montures a tenon epais.
    #
    # La charniere ne se DEVINE pas non plus : elle est au bord de la face, donc
    # a largeur/2 du centre optique du modele — projetee par le meme cos(theta)
    # qu'on vient de mesurer. Une premiere version la cherchait sur la hauteur de
    # la silhouette : la branche et la face se recouvrent en projection, et le
    # resultat sautait de 12 mm a 179 mm selon la monture. Heuristique abandonnee.
    center_x = ((lens_a["x0"] + lens_a["x1"]) / 2 + (lens_b["x0"] + lens_b["x1"]) / 2) / 2
    half_front_px = (args.largeur / 2) * cos_theta * scale

    if temple_on_left:
        hinge_x = int(round(center_x - half_front_px))
        band = slice(0, max(1, hinge_x))
    else:
        hinge_x = int(round(center_x + half_front_px))
        band = slice(min(W - 1, hinge_x), W)

    print(
        f"  charniere calculee a x={hinge_x} "
        f"(face {'a droite' if temple_on_left else 'a gauche'}, demi-face {half_front_px:.0f} px)"
    )

    temple_solid = crop_solid[:, band]
    if temple_solid.sum() == 0:
        print("❌ aucune branche visible au-dela de la charniere.")
        return 1

    # ── Redressement : la branche est raccourcie en sin(theta) le long de sa
    #    longueur, et pas du tout en hauteur.
    stretch = 1.0 / math.sin(theta)
    src = Image.fromarray(np.dstack([crop_rgb[:, band], np.where(temple_solid, 255, 0).astype(np.uint8)]))
    if temple_on_left:
        src = src.transpose(Image.FLIP_LEFT_RIGHT)  # charniere toujours a gauche
    flat = src.resize((max(1, int(round(src.width * stretch))), src.height), Image.LANCZOS)

    rectified_mm = flat.width / scale
    ecart = (rectified_mm - args.branche) / args.branche
    print(
        f"  branche : {src.width} px apparents → redressee {rectified_mm:.1f} mm "
        f"pour {args.branche} mm annonces → {ecart * 100:+.1f} %"
    )
    print(
        "  ⚠️ cet ecart est un CONTROLE, pas un reglage : la longueur redressee "
        "n'est ajustee sur rien."
    )

    out_dir = Path(args.out) / args.slug
    out_dir.mkdir(parents=True, exist_ok=True)
    flat.save(out_dir / "profile.png")

    spec_path = out_dir / "spec.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    # La charniere est le bord gauche du sprite redresse, a mi-hauteur du verre.
    hinge_y = (lens_a["y0"] + lens_a["y1"]) / 2 if temple_on_left else (lens_b["y0"] + lens_b["y1"]) / 2
    spec["hingeProfile"] = {"x": 0.0, "y": float(hinge_y)}
    spec["profileViewAngleDeg"] = round(deg, 2)
    spec["profilePxPerMm"] = round(scale, 4)
    spec["templeRectifiedMm"] = round(rectified_mm, 1)
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")

    print(f"✅ {args.slug} : profil redresse {flat.width}×{flat.height} px → {out_dir}/profile.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
