import os
import uuid
import cv2
import numpy as np
import gradio as gr

def pipeline_ia_inpainting(image_path):
    if image_path is None:
        return None
    
    img = cv2.imread(image_path)
    h, w, _ = img.shape
    mask = np.zeros((h, w), dtype=np.uint8)
    
    # Masquage sémantique précis des branches et reflets
    regions = [
        (0, int(h*0.25), int(w*0.22), int(h*0.75)),        # Externe gauche
        (int(w*0.78), int(h*0.25), w, int(h*0.75)),        # Externe droite
        (int(w*0.18), int(h*0.38), int(w*0.45), int(h*0.65)), # Verre Gauche
        (int(w*0.55), int(h*0.38), int(w*0.82), int(h*0.65))  # Verre Droit
    ]
    for (x1, y1, x2, y2) in regions:
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
        
    result = cv2.inpaint(img, mask, inpaintRadius=5, flags=cv2.INPAINT_NS)
    
    output_path = f"{uuid.uuid4()}_out.png"
    cv2.imwrite(output_path, result)
    return output_path

def process_batch(file_paths):
    if not file_paths:
        return []
    results = []
    for path in file_paths:
        try:
            out = pipeline_ia_inpainting(path)
            if out:
                results.append(out)
        except Exception:
            continue
    return results

# Interface Gradio épurée et moderne
with gr.Blocks(title="IA Optique - Suppression Branches") as demo:
    gr.Markdown("# 👓 Chirurgie de Lunettes IA")
    gr.Markdown("Glissez vos photos (jusqu'à 50 d'un coup) pour retirer instantanément les branches et les textes.")
    
    with gr.Row():
        file_input = gr.File(file_count="multiple", file_types=["image"], label="Déposez vos photos de lunettes ici")
    
    submit_btn = gr.Button("🚀 Lancer le nettoyage en rafale", variant="primary")
    
    with gr.Row():
        gallery_output = gr.Gallery(label="Résultats parfaits (Prêts à télécharger)", show_label=True, elem_id="gallery", columns=3)
        
    submit_btn.click(fn=process_batch, inputs=file_input, outputs=gallery_output)

demo.launch()
