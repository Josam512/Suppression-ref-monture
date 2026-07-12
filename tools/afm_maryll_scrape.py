import csv,hashlib,io,re,shutil,zipfile
from collections import defaultdict,deque
from pathlib import Path
from urllib.parse import urljoin,urlparse,unquote
import requests
from bs4 import BeautifulSoup
from PIL import Image

START='https://www.afm-optic.com/maryll-france-maryll-france-optiques,3.htm'
HOST='www.afm-optic.com'; ROOT=Path('AFM_Maryll_Optiques_photos'); ZIP=Path('AFM_Maryll_Optiques_photos.zip')
S=requests.Session(); S.headers['User-Agent']='Mozilla/5.0'

def clean(s):
 s=unquote(s); s=re.sub(r'[\\/:*?"<>|]+','_',s); return re.sub(r'\s+',' ',s).strip(' ._')[:100] or 'sans_nom'
def model(u):
 m=re.search(r'optiques-([^,%]+)',urlparse(u).path,re.I); return clean((m.group(1) if m else 'PAGE_PRINCIPALE').replace('-',' ').upper())
def pageok(u):
 p=urlparse(u); return p.netloc==HOST and (u==START or '/maryll-france-optiques-' in p.path)
def imgok(u):
 p=urlparse(u); q=p.path.lower(); return p.netloc==HOST and re.search(r'\.(jpg|jpeg|png|webp|gif|avif)$',q) and ('/photos/' in q or '/photo/' in q) and not any(x in q for x in ('logo','drapeau','bouton','picto','icone'))
def urls(soup,base):
 out=set()
 for t in soup.find_all(True):
  for a in ('src','href','data-src','data-original','data-image','data-full','data-zoom-image'):
   v=t.get(a)
   if isinstance(v,str): out.add(urljoin(base,v))
  for a in ('srcset','data-srcset'):
   v=t.get(a)
   if isinstance(v,str): out|={urljoin(base,x.strip().split()[0]) for x in v.split(',') if x.strip()}
 return out

q=deque([START]); seen=set(); uses=defaultdict(set); pages=[]
while q:
 u=q.popleft()
 if u in seen: continue
 seen.add(u)
 try:
  r=S.get(u,timeout=35); r.raise_for_status(); soup=BeautifulSoup(r.text,'lxml')
 except Exception as e:
  pages.append((model(u),'',u,'ERREUR '+str(e))); continue
 title=(soup.find('h1') or soup.find('title'))
 title=' '.join(title.get_text(' ',strip=True).split()) if title else ''
 pages.append((model(u),title,u,r.status_code))
 for x in urls(soup,u):
  x=x.split('#')[0]
  if pageok(x) and x not in seen: q.append(x)
  if imgok(x): uses[x].add((model(u),title,u))
 print('PAGE',len(seen),model(u),len(uses))

if ROOT.exists(): shutil.rmtree(ROOT)
ROOT.mkdir(); rows=[]; hashes=defaultdict(set)
for i,u in enumerate(sorted(uses),1):
 try:
  r=S.get(u,timeout=45); r.raise_for_status(); data=r.content; h=hashlib.sha256(data).hexdigest()
  try:
   im=Image.open(io.BytesIO(data)); w,hgt=im.size
  except: w=hgt=0
  ext=Path(urlparse(u).path).suffix.lower() or '.jpg'
  for mod,title,page in sorted(uses[u]):
   if h in hashes[mod]: continue
   hashes[mod].add(h); d=ROOT/clean(mod); d.mkdir(exist_ok=True)
   name=clean(Path(urlparse(u).path).stem)+'__'+h[:10]+ext; p=d/name; p.write_bytes(data)
   rows.append((mod,title,page,u,p.as_posix(),h,w,hgt,len(data),'OK',''))
  print('IMG',i,len(uses),u)
 except Exception as e:
  mod,title,page=sorted(uses[u])[0]; rows.append((mod,title,page,u,'','',0,0,0,'ERREUR',str(e)))
with (ROOT/'manifest_images.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.writer(f); w.writerow(['modele','titre_page','page_url','image_url','chemin','sha256','largeur','hauteur','octets','statut','erreur']); w.writerows(rows)
with (ROOT/'pages_visitees.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.writer(f); w.writerow(['modele','titre','page_url','statut']); w.writerows(pages)
(ROOT/'LISEZ_MOI.txt').write_text(f'Source: {START}\nPages: {len(pages)}\nURLs images: {len(uses)}\nFichiers: {sum(len(x) for x in hashes.values())}\n',encoding='utf-8')
with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED) as z:
 for p in ROOT.rglob('*'):
  if p.is_file(): z.write(p,p.as_posix())
print('DONE',ZIP,ZIP.stat().st_size)
