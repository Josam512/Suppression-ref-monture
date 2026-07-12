"""
Chirurgie de Lunettes IA — v2
=============================
Retire les marquages (references, CE, logos) sur les photos de montures
SANS toucher au design de la monture.

CE QUI CHANGEAIT DANS LA V1 (et pourquoi c'etait rate)
------------------------------------------------------
La v1 effacait des RECTANGLES FIXES (22% a gauche, 78% a droite...) sans
jamais regarder ce qu'il y avait dedans. Sur toute photo ou la monture n'est
pas exactement a la place prevue, ces rectangles tombent en plein sur
l'acetate -> inpaint sur grande zone -> bouillie. C'etait structurellement
condamne.

PRINCIPE DE LA V2
-----------------
1) PINCEAU (mode sur) : tu peins sur le texte, SEUL le peint est efface.
   Garantie : zero pixel touche ailleurs.
2) DETECTION ASSISTEE (mode rapide) : propose un masque, tu le VOIS EN ROUGE
   avant d'appliquer, tu regles la sensibilite. Si ca deborde, tu passes au
   pinceau. On n'applique jamais un masque en aveugle.
3) Inpaint a PETIT rayon (le texte est fin) -> reconstruction propre.
4) Preserve la TRANSPARENCE (alpha) et la resolution d'origine.

INSTALLATION
------------
requirements.txt :
    streamlit
    streamlit-drawable-canvas
    opencv-python-headless
    numpy
    Pillow

LANCEMENT : streamlit run app.py
"""

import io
import uuid

import cv2
import numpy as np
import streamlit as st
from PIL import Image

try:
    from streamlit_drawable_canvas import st_canvas
    CANVAS_OK = True
except ImportError:
    CANVAS_OK = False


# ----------------------------------------------------------------------------
# I/O — on preserve alpha et resolution
# ----------------------------------------------------------------------------
def load_image(file_bytes):
    """Retourne (bgr uint8, alpha uint8|None)."""
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None, None
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        return img[:, :, :3].copy(), img[:, :, 3].copy()
    return img[:, :, :3].copy(), None


def to_png_bytes(bgr, alpha=None):
    if alpha is not None:
        out = np.dstack([bgr, alpha])
    else:
        out = bgr
    ok, buf = cv2.imencode(".png", out)
    return buf.tobytes() if ok else None


# ----------------------------------------------------------------------------
# Detection assistee : trouve les PETITS marquages, pas des rectangles fixes
# ----------------------------------------------------------------------------
def detect_text_mask(bgr, mode="clair", sensibilite=1.0, taille_max_pct=5.0,
                     roi=None):
    """
    mode : 'clair'  -> texte clair sur matiere sombre (cas le plus courant)
           'sombre' -> texte sombre sur matiere claire
           'les deux'
    sensibilite : >1 = detecte plus (et risque de deborder)
    taille_max_pct : hauteur max d'une lettre, en % de la hauteur image
    roi : (x1,y1,x2,y2) pour limiter la detection a une zone. Fortement
          conseille sur les motifs ecaille -> evite les faux positifs.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    zone = np.zeros((h, w), np.uint8)
    if roi:
        x1, y1, x2, y2 = roi
        zone[max(0, y1):min(h, y2), max(0, x1):min(w, x2)] = 255
    else:
        zone[:] = 255

    k = max(3, int(round(min(h, w) * 0.008)) | 1)
    kern = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kern)     # clair sur sombre
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kern)  # sombre sur clair

    if mode == "clair":
        resp = tophat
    elif mode == "sombre":
        resp = blackhat
    else:
        resp = cv2.max(tophat, blackhat)

    thr = int(np.clip(np.percentile(resp, 99.5) / max(sensibilite, 0.15), 20, 130))
    _, bw = cv2.threshold(resp, thr, 255, cv2.THRESH_BINARY)
    bw = cv2.bitwise_and(bw, zone)

    n, lab, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
    mask = np.zeros((h, w), np.uint8)
    hmax = h * (taille_max_pct / 100.0)
    for i in range(1, n):
        x, y, cw, ch, area = stats[i]
        if area < 8:
            continue
        if ch > hmax or cw > w * 0.12:      # une lettre reste petite
            continue
        if area / max(cw * ch, 1) < 0.15:   # forme trop creuse = bruit
            continue
        mask[lab == i] = 255
    return cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)


def overlay_mask(bgr, mask):
    vis = bgr.copy()
    vis[mask > 0] = (0, 0, 255)
    return cv2.cvtColor(cv2.addWeighted(bgr, 0.45, vis, 0.55, 0), cv2.COLOR_BGR2RGB)


def inpaint(bgr, mask, radius=3, method="Telea"):
    if mask is None or mask.max() == 0:
        return bgr.copy()
    flag = cv2.INPAINT_TELEA if method == "Telea" else cv2.INPAINT_NS
    return cv2.inpaint(bgr, mask, radius, flag)


# ----------------------------------------------------------------------------
# UI
# ----------------------------------------------------------------------------
st.set_page_config(page_title="Chirurgie de Lunettes", page_icon="👓", layout="wide")
st.title("👓 Chirurgie de Lunettes — v2")
st.caption("Efface les marquages **sans toucher au design**. Le masque est toujours "
           "visible avant application : on n'efface jamais en aveugle.")

mode_travail = st.radio(
    "Méthode",
    ["🖌️ Pinceau (sûr — recommandé pour l'écaille)",
     "⚡ Détection assistée (rapide — à vérifier)"],
    horizontal=True,
)

with st.sidebar:
    st.header("Réglages")
    inpaint_radius = st.slider("Rayon de reconstruction", 1, 10, 3,
                               help="Le texte est fin : 3 suffit. Trop grand = flou.")
    inpaint_method = st.selectbox("Algorithme", ["Telea", "Navier-Stokes"], index=0)
    st.divider()
    st.caption("⚠️ Rappel : plus la zone effacée est grande, plus le résultat "
               "est flou. Vise le texte, rien que le texte.")

files = st.file_uploader("Déposez vos photos", type=["png", "jpg", "jpeg", "webp"],
                         accept_multiple_files=True)

if not files:
    st.info("Dépose une ou plusieurs photos de montures pour commencer.")
    st.stop()


# ============================ MODE PINCEAU ==================================
if mode_travail.startswith("🖌️"):
    if not CANVAS_OK:
        st.error("Module manquant : `pip install streamlit-drawable-canvas`")
        st.stop()

    noms = [f.name for f in files]
    choix = st.selectbox("Photo à traiter", noms)
    f = files[noms.index(choix)]
    f.seek(0)
    bgr, alpha = load_image(f.read())
    if bgr is None:
        st.error("Image illisible.")
        st.stop()

    H, W = bgr.shape[:2]
    disp_w = 900
    scale = disp_w / W
    disp_h = int(H * scale)

    epaisseur = st.slider("Taille du pinceau", 3, 60, 14)
    st.caption("Peins **sur le texte** (les traits blancs marquent ce qui sera effacé).")

    bg = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).resize((disp_w, disp_h))
    canvas = st_canvas(
        fill_color="rgba(255,255,255,0)",
        stroke_width=epaisseur,
        stroke_color="#FFFFFF",
        background_image=bg,
        update_streamlit=True,
        height=disp_h,
        width=disp_w,
        drawing_mode="freedraw",
        key=f"canvas_{choix}",
    )

    if canvas.image_data is not None:
        painted = canvas.image_data[:, :, 3]  # canal alpha des traits
        if painted.max() > 0:
            mask_small = (painted > 10).astype(np.uint8) * 255
            mask = cv2.resize(mask_small, (W, H), interpolation=cv2.INTER_NEAREST)
            pct = 100.0 * (mask > 0).sum() / mask.size

            c1, c2 = st.columns(2)
            with c1:
                st.image(overlay_mask(bgr, mask), caption=f"Zone effacée ({pct:.2f} % de l'image)")
            result = inpaint(bgr, mask, inpaint_radius, inpaint_method)
            with c2:
                st.image(cv2.cvtColor(result, cv2.COLOR_BGR2RGB), caption="Résultat")

            png = to_png_bytes(result, alpha)
            st.download_button("📥 Télécharger", png, f"clean_{choix.rsplit('.',1)[0]}.png",
                               "image/png", type="primary")
        else:
            st.info("Peins sur le texte à effacer.")


# ====================== MODE DETECTION ASSISTEE ==============================
else:
    c1, c2, c3 = st.columns(3)
    with c1:
        mode = st.selectbox("Type de marquage", ["clair", "sombre", "les deux"], 0,
                            help="Le marquage est le plus souvent CLAIR sur matière sombre.")
    with c2:
        sens = st.slider("Sensibilité", 0.3, 2.5, 1.0, 0.1)
    with c3:
        tmax = st.slider("Hauteur max d'une lettre (% image)", 1.0, 12.0, 5.0, 0.5)

    limiter = st.checkbox("Limiter la détection à une bande (recommandé sur écaille)", True)
    if limiter:
        b1, b2 = st.columns(2)
        y1p = b1.slider("Haut de la bande (%)", 0, 100, 35)
        y2p = b2.slider("Bas de la bande (%)", 0, 100, 65)

    st.divider()
    for f in files:
        f.seek(0)
        bgr, alpha = load_image(f.read())
        if bgr is None:
            continue
        H, W = bgr.shape[:2]
        roi = (0, int(H * y1p / 100), W, int(H * y2p / 100)) if limiter else None

        mask = detect_text_mask(bgr, mode, sens, tmax, roi)
        pct = 100.0 * (mask > 0).sum() / mask.size
        result = inpaint(bgr, mask, inpaint_radius, inpaint_method)

        st.subheader(f.name)
        if pct > 1.0:
            st.warning(f"⚠️ {pct:.2f} % de l'image serait effacé — c'est beaucoup. "
                       "Baisse la sensibilité, resserre la bande, ou passe au pinceau.")
        a, b = st.columns(2)
        a.image(overlay_mask(bgr, mask), caption=f"Rouge = ce qui sera effacé ({pct:.2f} %)")
        b.image(cv2.cvtColor(result, cv2.COLOR_BGR2RGB), caption="Résultat")

        st.download_button("📥 Télécharger", to_png_bytes(result, alpha),
                           f"clean_{f.name.rsplit('.',1)[0]}.png", "image/png",
                           key=str(uuid.uuid4()))
        st.divider()
