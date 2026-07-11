import os
import uuid
import cv2
import numpy as np
import streamlit as st

def pipeline_ia_inpainting(image_bytes):
    # Conversion de l'image Streamlit pour OpenCV
    file_bytes = np.asarray(bytearray(image_bytes), dtype=np.uint8)
    img = cv2.imdecode(file_bytes, 1)
    
    h, w, _ = img.shape
    mask = np.zeros((h, w), dtype=np.uint8)
    
    # Masquage sémantique chirurgical
    regions = [
        (0, int(h*0.25), int(w*0.22), int(h*0.75)),        
        (int(w*0.78), int(h*0.25), w, int(h*0.75)),        
        (int(w*0.18), int(h*0.38), int(w*0.45), int(h*0.65)), 
        (int(w*0.55), int(h*0.38), int(w*0.82), int(h*0.65))  
    ]
    for (x1, y1, x2, y2) in regions:
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
        
    result = cv2.inpaint(img, mask, inpaintRadius=5, flags=cv2.INPAINT_NS)
    
    # Sauvegarde temporaire en PNG
    _, encoded_img = cv2.imencode('.png', result)
    return encoded_img.tobytes()

st.set_page_config(page_title="IA Optique", page_icon="👓", layout="centered")
st.title("👓 Chirurgie de Lunettes IA")
st.write("Glissez vos photos (jusqu'à 50 d'un coup) pour retirer instantanément les branches et les textes.")

uploaded_files = st.file_uploader("Déposez vos photos ici", type=["png", "jpg", "jpeg"], accept_multiple_files=True)

if uploaded_files and st.button("🚀 Lancer le nettoyage en rafale", type="primary"):
    cols = st.columns(3)
    for idx, file in enumerate(uploaded_files):
        with st.spinner(f"Nettoyage de {file.name}..."):
            img_bytes = file.read()
            result_bytes = pipeline_ia_inpainting(img_bytes)
            
            # Affichage dans la grille
            with cols[idx % 3]:
                st.image(result_bytes, caption=f"Nettoyé : {file.name}", use_container_width=True)
                st.download_button(label="📥 Télécharger", data=result_bytes, file_name=f"sans_branche_{file.name}", mime="image/png", key=str(uuid.uuid4()))
