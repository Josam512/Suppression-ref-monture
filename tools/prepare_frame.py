#!/usr/bin/env python3
"""
tools/prepare_frame.py — prepare un sprite de monture depuis une photo fond blanc.

Complete la chaine Python deja presente dans ce depot (app.py, batch_clean.py),
qui elle nettoie les marquages. Ici on produit l'actif dont l'essayage a besoin :
front.png a canal alpha + spec.json conforme au §12 du CLAUDE.md.

CE QUE CE SCRIPT NE FAIT PAS
Il ne devine aucune cote. La largeur totale bord a bord vient du REGLET, saisie
en argument. C'est elle qui donne l'echelle du sprite :

    spritePxPerMm = alphaBBox.w / totalWidthMm

CONTROLE DE COHERENCE (l'equivalent du garde-fou a 3 cotes du §4)
Les deux verres sont detectes comme des trous fermes dans la silhouette. Leur
ecart centre-a-centre doit valoir A + pont, la relation du systeme boxing. Si
l'ecart depasse la tolerance, la photo n'est pas perpendiculaire ou les cotes
ne correspondent pas a cette monture : on refuse, on ne corrige pas en douce.

Usage :
  python3 tools/prepare_frame.py photo.jpg --slug s --a 47 --pont 22 --b 43 \
      --branche 145 --largeur 136 --out public/frames
"""

import argparse
import json
import sys
from collections import deque
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image

# Un pixel est "fond" s'il est clair ET neutre.
#
# La clarte seule ne suffit pas : sur une ecaille blonde, la rime basse devient
# presque blanche et le remplissage fuit a travers, emportant l'interieur du
# verre avec le fond. L'acetate pale reste colore la ou le fond studio est
# neutre — c'est la saturation qui les separe.
WHITE_MIN = 215
NEUTRAL_MAX = 14
# Tolerance sur le controle A + pont, en pourcentage.
BOXING_TOLERANCE = 0.04
# Surface minimale d'un trou pour etre considere comme un verre.
MIN_LENS_AREA_RATIO = 0.01


def crop_black_bars(rgb: np.ndarray) -> np.ndarray:
    """Retire les bandes noires des captures d'ecran verticales."""
    row_max = rgb.max(axis=(1, 2))
    keep = np.where(row_max > 40)[0]
    if len(keep) == 0:
        return rgb
    return rgb[keep[0] : keep[-1] + 1]


def flood_background(whiteish: np.ndarray) -> np.ndarray:
    """Fond = pixels clairs ATTEIGNABLES depuis le bord.

    Les interieurs de verres sont clairs eux aussi, mais enfermes par le
    cerclage : ils ne sont pas atteints, et restent donc distinguables du fond.
    """
    h, w = whiteish.shape
    seen = np.zeros_like(whiteish, dtype=bool)
    q = deque()

    for x in range(w):
        for y in (0, h - 1):
            if whiteish[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if whiteish[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and whiteish[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def label_holes(mask: np.ndarray):
    """Composantes connexes de `mask`. Renvoie (labels, [(aire, cy, cx), ...])."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    stats = []
    current = 0
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or labels[sy, sx]:
                continue
            current += 1
            q = deque([(sy, sx)])
            labels[sy, sx] = current
            area = 0
            sum_y = sum_x = 0
            while q:
                y, x = q.popleft()
                area += 1
                sum_y += y
                sum_x += x
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = current
                        q.append((ny, nx))
            stats.append((area, sum_y / area, sum_x / area))
    return labels, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("photo")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--a", type=float, required=True, help="cote A, mm")
    ap.add_argument("--pont", type=float, required=True, help="pont, mm")
    ap.add_argument("--b", type=float, default=None, help="cote B (hauteur de verre), mm")
    ap.add_argument("--branche", type=float, required=True, help="longueur de branche, mm")
    ap.add_argument(
        "--largeur",
        type=float,
        default=None,
        help="largeur totale au reglet, mm. Si absente, elle est DEDUITE de l'ecart des "
        "centres optiques (= A + pont), ce qui supprime le controle de coherence.",
    )
    ap.add_argument("--out", default="public/frames")
    args = ap.parse_args()

    rgb = np.asarray(Image.open(args.photo).convert("RGB")).astype(np.uint8)
    rgb = crop_black_bars(rgb)

    chan_min = rgb.min(axis=2).astype(int)
    saturation = rgb.max(axis=2).astype(int) - chan_min
    whiteish = (chan_min >= WHITE_MIN) & (saturation <= NEUTRAL_MAX)
    background = flood_background(whiteish)
    solid = ~background

    ys, xs = np.where(solid)
    if len(xs) == 0:
        print("❌ silhouette vide : la photo n'a pas de fond blanc exploitable.")
        return 1
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bbox = {"x": 0, "y": 0, "w": int(x1 - x0 + 1), "h": int(y1 - y0 + 1)}

    # Recadrage serre : la bbox alpha devient l'image entiere, marges exclues.
    crop_rgb = rgb[y0 : y1 + 1, x0 : x1 + 1]
    crop_solid = solid[y0 : y1 + 1, x0 : x1 + 1]
    crop_white = whiteish[y0 : y1 + 1, x0 : x1 + 1]

    # Les verres : zones claires enfermees dans la silhouette.
    holes = crop_white & crop_solid
    _, stats = label_holes(holes)
    area_min = MIN_LENS_AREA_RATIO * bbox["w"] * bbox["h"]
    kept = [s for s in stats if s[0] >= area_min]
    if not kept:
        print("❌ aucun verre detecte — cerclage ouvert, ou photo trop bruitee.")
        return 1

    # ⚠️ Une branche repliee se voit A TRAVERS le verre et coupe le trou en
    # plusieurs morceaux : prendre « les deux plus grands » ramasserait alors
    # deux fragments du MEME verre. On regroupe donc par cote, autour de l'axe
    # de symetrie de la silhouette, et on moyenne en ponderant par l'aire.
    axis = bbox["w"] / 2

    def side_centroid(parts):
        total = sum(p[0] for p in parts)
        return (
            sum(p[0] * p[1] for p in parts) / total,
            sum(p[0] * p[2] for p in parts) / total,
        )

    left = [s for s in kept if s[2] < axis]
    right = [s for s in kept if s[2] >= axis]
    if not left or not right:
        print(f"❌ verres mal repartis ({len(left)} a gauche, {len(right)} a droite).")
        return 1

    ly_l, lx_l = side_centroid(left)
    ly_r, lx_r = side_centroid(right)
    print(f"  verres : {len(left)} fragment(s) a gauche, {len(right)} a droite")

    expected = args.a + args.pont
    center_gap_px = abs(lx_r - lx_l)

    if args.largeur is not None:
        # Echelle donnee par le REGLET. L'ecart des centres devient alors une
        # mesure INDEPENDANTE, donc un vrai controle de coherence.
        spritePxPerMm = bbox["w"] / args.largeur
        center_gap_mm = center_gap_px / spritePxPerMm
        ecart = abs(center_gap_mm - expected) / expected
        verdict = "OK" if ecart <= BOXING_TOLERANCE else "REFUSE"
        print(
            f"  controle boxing : ecart des centres {center_gap_mm:.1f} mm "
            f"pour A+pont = {expected:.1f} mm → {ecart * 100:.1f} % [{verdict}]"
        )
        if ecart > BOXING_TOLERANCE:
            print("❌ Photo non perpendiculaire, ou cotes rattachees a la mauvaise monture.")
            return 1
    else:
        # Sans reglet, l'ecart des centres SERT d'echelle. Il ne peut donc plus
        # servir de controle : la largeur obtenue est deduite, pas verifiee.
        spritePxPerMm = center_gap_px / expected
        print(
            f"  ⚠️ largeur totale DEDUITE de A+pont = {expected:.1f} mm — "
            f"aucun controle de coherence n'est possible dans ce mode."
        )

    # Le pont : matiere opaque sur la colonne mediane, entre les deux verres.
    mid_x = int(round((lx_l + lx_r) / 2))
    column = crop_solid[:, mid_x] & ~crop_white[:, mid_x]
    rows = np.where(column)[0]
    bridge_y = float(rows.mean()) if len(rows) else float((ly_l + ly_r) / 2)

    # Alpha : fond transparent, verres transparents (on regarde a travers).
    alpha = np.where(crop_solid, 255, 0).astype(np.uint8)
    alpha[holes] = 0

    out_dir = Path(args.out) / args.slug
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.dstack([crop_rgb, alpha])).save(out_dir / "front.png")

    # Pas de vraie photo de PROFIL a plat : on ecrit un sprite entierement
    # transparent plutot qu'un 3/4 qui donnerait une branche de geometrie fausse.
    Image.fromarray(np.zeros((8, 8, 4), dtype=np.uint8)).save(out_dir / "profile.png")

    spec = {
        "slug": args.slug,
        "aMm": args.a,
        "pontMm": args.pont,
        "brancheMm": args.branche,
        "totalWidthMm": bbox["w"] / spritePxPerMm,
        "front": "front.png",
        "profile": "profile.png",
        "spritePxPerMm": spritePxPerMm,
        "alphaBBox": bbox,
        "bridgeCenter": {"x": (lx_l + lx_r) / 2, "y": bridge_y},
        "lensCenterL": {"x": lx_l, "y": ly_l},
        "lensCenterR": {"x": lx_r, "y": ly_r},
        "hingeProfile": {"x": 0, "y": 0},
        "calibratedAt": date.today().isoformat(),
    }
    if args.b is not None:
        spec["bMm"] = args.b

    (out_dir / "spec.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
    print(
        f"✅ {args.slug} : {bbox['w']}×{bbox['h']} px · {spritePxPerMm:.3f} px/mm · "
        f"largeur {spec['totalWidthMm']:.1f} mm → {out_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
