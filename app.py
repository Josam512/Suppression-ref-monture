import os
import sys
import uuid
import shutil
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

def pipeline_ia_inpainting(input_path, output_path):
    img = cv2.imread(input_path)
    h, w, _ = img.shape
    mask = np.zeros((h, w), dtype=np.uint8)
    
    # Masquage chirurgical des branches et reflets de texte
    regions = [
        (0, int(h*0.25), int(w*0.22), int(h*0.75)),        # Externe gauche
        (int(w*0.78), int(h*0.25), w, int(h*0.75)),        # Externe droite
        (int(w*0.18), int(h*0.38), int(w*0.45), int(h*0.65)), # Verre Gauche
        (int(w*0.55), int(h*0.38), int(w*0.82), int(h*0.65))  # Verre Droit
    ]
    for (x1, y1, x2, y2) in regions:
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
        
    result = cv2.inpaint(img, mask, inpaintRadius=5, flags=cv2.INPAINT_NS)
    cv2.imwrite(output_path, result)

HTML_CONTENT = """
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Chirurgie Optique IA</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-12">
    <div class="max-w-4xl mx-auto">
        <header class="text-center mb-10">
            <h1 class="text-3xl font-black text-amber-400 mb-2">Nettoyage de Lunettes IA</h1>
            <p class="text-slate-400">Glissez vos 50 photos pour retirer les branches et marquages d'un coup.</p>
        </header>
        
        <div id="dropzone" class="border-3 border-dashed border-slate-700 hover:border-amber-500 rounded-2xl p-12 text-center bg-slate-800/40 cursor-pointer transition-all">
            <input type="file" id="fileInput" multiple accept="image/*" class="hidden">
            <p class="text-lg font-semibold">Déposez vos images ici ou cliquez pour parcourir</p>
        </div>

        <div id="progress" class="hidden mt-6 bg-slate-800 p-4 rounded-xl">
            <div class="w-full bg-slate-700 h-2 rounded-full overflow-hidden"><div id="bar" class="bg-amber-400 h-full w-0 transition-all"></div></div>
        </div>

        <div id="results" class="hidden mt-8 grid grid-cols-3 gap-4"></div>
    </div>

    <script>
        const dz = document.getElementById('dropzone');
        const fi = document.getElementById('fileInput');
        
        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('border-amber-500'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('border-amber-500'));
        dz.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
        fi.addEventListener('change', (e) => handleFiles(e.target.files));

        async function handleFiles(files) {
            if(!files.length) return;
            document.getElementById('progress').classList.remove('hidden');
            const fd = new FormData();
            for(let i=0; i<files.length; i++) fd.append('files', files[i]);
            
            document.getElementById('bar').style.width = '50%';
            
            const res = await fetch('/process-batch/', { method: 'POST', body: fd });
            const data = await res.json();
            
            document.getElementById('bar').style.width = '100%';
            const resDiv = document.getElementById('results');
            resDiv.classList.remove('hidden');
            resDiv.innerHTML = '';
            
            data.processed_files.forEach(f => {
                if(f.status === 'success') {
                    resDiv.innerHTML += `
                        <div class="bg-slate-800 p-2 rounded-xl border border-slate-700">
                            <img src="${f.result_url}" class="w-full object-contain bg-white rounded-lg aspect-video">
                            <a href="${f.result_url}" download class="block text-center bg-amber-500 text-slate-950 font-bold text-xs py-1.5 rounded-md mt-2">Télécharger</a>
                        </div>`;
                }
            });
        }
    </script>
</body>
</html>
"""

@app.get("/")
async def get_index():
    return HTMLResponse(HTML_CONTENT)

@app.post("/process-batch/")
async def process_batch(files: list[UploadFile] = File(...)):
    results = []
    for file in files:
        file_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1]
        input_path = os.path.join(UPLOAD_DIR, f"{file_id}_in{ext}")
        output_filename = f"{file_id}_out.png"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        try:
            pipeline_ia_inpainting(input_path, output_path)
            results.append({
                "original_name": file.filename,
                "status": "success",
                "result_url": f"/download/{output_filename}"
            })
        except Exception as e:
            results.append({"original_name": file.filename, "status": f"error: {str(e)}"})
            
    return JSONResponse(content={"processed_files": results})

@app.get("/download/{filename}")
async def download_file(filename: str):
    return FileResponse(os.path.join(OUTPUT_DIR, filename))
