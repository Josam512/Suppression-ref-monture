#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LunEyes — NETTOYAGE PAR LOTS DES PHOTOS DE MONTURES (400 pieces)
================================================================
Retire les marquages (references gravees, "CE", logos, stickers) sur les
photos produit SANS abimer le design de la monture.

PRINCIPE (le point cle)
-----------------------
Un detecteur de texte dit OU est le texte (une boite).
La morphologie dit QUELS PIXELS sont les traits du texte, dans cette boite.
On n'efface QUE les traits.

  -> boite pleine inpaintee   : 1.71 % de l'image effacee  (motif ecaille etale = flou)
  -> traits dans la boite     : 0.10 % de l'image effacee  (17x moins) = propre

Sans le detecteur : faux positifs partout sur l'ecaille (le motif ressemble a du texte).
Sans la morphologie : on efface la boite entiere -> flou.
Les deux ensemble : c'est ce qui rend le 100 % automatique viable a 400 photos.

TRI QUALITE AUTOMATIQUE (indispensable a ce volume)
---------------------------------------------------
Le script classe chaque photo :
  OK      -> nettoyage sur, rien a faire
  REVOIR  -> a verifier / reprendre au pinceau (app.py)
  RIEN    -> aucun texte trouve (verifier que c'est normal)
Il produit une planche-contact avant/apres pour inspecter vite,
et un CSV recapitulatif. Tu ne regardes a la main que les "REVOIR".

INSTALLATION
------------
    pip install opencv-python-headless numpy pillow
    pip install easyocr            # backend recommande (CPU suffit)

    # Backend alternatif, plus leger, sans torch :
    # telecharger frozen_east_text_detection.pb  puis --backend east

USAGE
-----
    python batch_clean.py --in ./photos --out ./photos_clean
    python batch_clean.py --in ./photos --out ./photos_clean --backend east --east-model frozen_east_text_detection.pb

    # options utiles
    --dry-run          n'ecrit rien, produit juste le rapport + planches
    --pad 6            marge autour des boites detectees (px)
    --max-mask 0.8     % max efface avant de flaguer REVOIR
"""

import argparse
import csv
import os
import sys
import time

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Detection : renvoie une liste de boites (x1,y1,x2,y2)
# ---------------------------------------------------------------------------

def detect_boxes_easyocr(bgr, reader):
    """EasyOCR : robuste, trouve le texte meme grave/peu contraste."""
    res = reader.readtext(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), detail=1, paragraph=False)
    boxes = []
    for pts, _txt, conf in res:
        if conf < 0.15:          # tres permissif : on veut trouver, on filtrera par geometrie
            continue
        p = np.array(pts, dtype=np.int32)
        boxes.append((p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()))
    return boxes


def detect_boxes_east(bgr, net, conf_thr=0.35, nms_thr=0.3):
    """EAST (OpenCV DNN) : pas de torch, plus leger, un peu moins sensible."""
    H, W = bgr.shape[:2]
    newW, newH = (int(W / 32) * 32) or 32, (int(H / 32) * 32) or 32
    rW, rH = W / float(newW), H / float(newH)
    blob = cv2.dnn.blobFromImage(cv2.resize(bgr, (newW, newH)), 1.0, (newW, newH),
                                 (123.68, 116.78, 103.94), swapRB=True, crop=False)
    net.setInput(blob)
    scores, geo = net.forward(["feature_fusion/Conv_7/Sigmoid", "feature_fusion/concat_3"])
    rects, confs = [], []
    for y in range(scores.shape[2]):
        s = scores[0, 0, y]
        x0, x1_, x2_, x3_, ang = geo[0, 0, y], geo[0, 1, y], geo[0, 2, y], geo[0, 3, y], geo[0, 4, y]
        for x in range(scores.shape[3]):
            if s[x] < conf_thr:
                continue
            ox, oy = x * 4.0, y * 4.0
            cos, sin = np.cos(ang[x]), np.sin(ang[x])
            h = x0[x] + x2_[x]
            w = x1_[x] + x3_[x]
            ex = int(ox + cos * x1_[x] + sin * x2_[x])
            ey = int(oy - sin * x1_[x] + cos * x2_[x])
            rects.append((int(ex - w), int(ey - h), int(w), int(h)))
            confs.append(float(s[x]))
    idxs = cv2.dnn.NMSBoxes(rects, confs, conf_thr, nms_thr)
    boxes = []
    for i in np.array(idxs).flatten() if len(idxs) else []:
        x, y, w, h = rects[int(i)]
        boxes.append((int(x * rW), int(y * rH), int((x + w) * rW), int((y + h) * rH)))
    return boxes


# ---------------------------------------------------------------------------
# Raffinement : dans chaque boite, ne garder que les TRAITS du texte
# ---------------------------------------------------------------------------

def refine_to_strokes(bgr, boxes, pad=6, pct=97.0):
    H, W = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    mask = np.zeros((H, W), np.uint8)
    for (x1, y1, x2, y2) in boxes:
        x1 = max(0, x1 - pad); y1 = max(0, y1 - pad)
        x2 = min(W, x2 + pad); y2 = min(H, y2 + pad)
        if x2 - x1 < 3 or y2 - y1 < 3:
            continue
        roi = gray[y1:y2, x1:x2]
        k = max(3, (min(roi.shape) // 3) | 1)
        kern = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
        tophat = cv2.morphologyEx(roi, cv2.MORPH_TOPHAT, kern)     # texte clair
        blackhat = cv2.morphologyEx(roi, cv2.MORPH_BLACKHAT, kern)  # texte sombre
        # on garde la polarite dominante dans cette boite
        resp = tophat if tophat.mean() >= blackhat.mean() else blackhat
        thr = int(np.clip(np.percentile(resp, pct), 12, 130))
        _, bw = cv2.threshold(resp, thr, 255, cv2.THRESH_BINARY)
        bw = cv2.dilate(bw, np.ones((3, 3), np.uint8), iterations=1)
        mask[y1:y2, x1:x2] = cv2.bitwise_or(mask[y1:y2, x1:x2], bw)
    return mask


# ---------------------------------------------------------------------------
# I/O + rendu
# ---------------------------------------------------------------------------

def load(path):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None, None
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        return img[:, :, :3].copy(), img[:, :, 3].copy()
    return img[:, :, :3].copy(), None


def save_png(path, bgr, alpha):
    out = np.dstack([bgr, alpha]) if alpha is not None else bgr
    cv2.imwrite(path, out)


def thumb(img, w=380):
    h = int(img.shape[0] * w / img.shape[1])
    return cv2.resize(img, (w, h))


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", default="./clean")
    ap.add_argument("--backend", choices=["easyocr", "east"], default="easyocr")
    ap.add_argument("--east-model", default="frozen_east_text_detection.pb")
    ap.add_argument("--pad", type=int, default=6)
    ap.add_argument("--radius", type=int, default=3, help="rayon inpaint (texte fin => 3)")
    ap.add_argument("--max-mask", type=float, default=0.8,
                    help="%% max efface ; au-dela => flag REVOIR")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    os.makedirs(a.dst, exist_ok=True)
    qc_dir = os.path.join(a.dst, "_qc")
    os.makedirs(qc_dir, exist_ok=True)

    # --- backend
    reader = net = None
    if a.backend == "easyocr":
        try:
            import easyocr
        except ImportError:
            sys.exit("pip install easyocr  (ou --backend east)")
        print("Chargement EasyOCR (1re fois : telechargement du modele)...")
        reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    else:
        if not os.path.exists(a.east_model):
            sys.exit(f"Modele EAST introuvable : {a.east_model}")
        net = cv2.dnn.readNet(a.east_model)

    exts = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")
    files = sorted(f for f in os.listdir(a.src) if f.lower().endswith(exts))
    if not files:
        sys.exit(f"Aucune image dans {a.src}")
    print(f"{len(files)} images | backend={a.backend} | dry-run={a.dry_run}\n")

    rows, t0 = [], time.time()
    counts = {"OK": 0, "REVOIR": 0, "RIEN": 0, "ERREUR": 0}

    for i, name in enumerate(files, 1):
        path = os.path.join(a.src, name)
        bgr, alpha = load(path)
        if bgr is None:
            counts["ERREUR"] += 1
            rows.append({"fichier": name, "statut": "ERREUR", "boites": 0, "masque_pct": 0})
            continue

        boxes = (detect_boxes_easyocr(bgr, reader) if a.backend == "easyocr"
                 else detect_boxes_east(bgr, net))
        mask = refine_to_strokes(bgr, boxes, a.pad)
        pct = 100.0 * (mask > 0).sum() / mask.size

        if not boxes:
            statut = "RIEN"
            result = bgr.copy()
        elif pct > a.max_mask:
            statut = "REVOIR"
            result = cv2.inpaint(bgr, mask, a.radius, cv2.INPAINT_TELEA)
        else:
            statut = "OK"
            result = cv2.inpaint(bgr, mask, a.radius, cv2.INPAINT_TELEA)
        counts[statut] += 1

        if not a.dry_run and statut != "RIEN":
            save_png(os.path.join(a.dst, os.path.splitext(name)[0] + ".png"), result, alpha)

        # planche QC : avant | masque | apres
        vis = bgr.copy()
        vis[mask > 0] = (0, 0, 255)
        sheet = np.hstack([thumb(bgr), thumb(vis), thumb(result)])
        cv2.imwrite(os.path.join(qc_dir, f"{statut}_{os.path.splitext(name)[0]}.jpg"), sheet)

        rows.append({"fichier": name, "statut": statut, "boites": len(boxes),
                     "masque_pct": round(pct, 3)})
        print(f"[{i:3d}/{len(files)}] {name:34} {statut:6} boites={len(boxes):2d} masque={pct:.2f}%")

    with open(os.path.join(a.dst, "rapport.csv"), "w", newline="", encoding="utf-8") as f:
        wcsv = csv.DictWriter(f, fieldnames=["fichier", "statut", "boites", "masque_pct"])
        wcsv.writeheader()
        wcsv.writerows(rows)

    dt = time.time() - t0
    print(f"\n--- TERMINE en {dt/60:.1f} min ---")
    for k, v in counts.items():
        print(f"  {k:7} : {v}")
    print(f"\nPlanches QC : {qc_dir}  (regarde d'abord les fichiers REVOIR_*)")
    print(f"Rapport     : {os.path.join(a.dst, 'rapport.csv')}")
    print("Les REVOIR se reprennent au pinceau dans app.py.")


if __name__ == "__main__":
    main()
