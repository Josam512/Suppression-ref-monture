from pathlib import Path
from urllib.parse import urljoin
import re
import requests
from bs4 import BeautifulSoup

URL='https://www.afm-optic.com/maryll-france-optiques-po.88,3-852-2723.htm'
out=Path('probe'); out.mkdir(exist_ok=True)
s=requests.Session(); s.headers['User-Agent']='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
r=s.get(URL,timeout=60); r.raise_for_status(); out.joinpath('page.html').write_bytes(r.content)
soup=BeautifulSoup(r.text,'html.parser')
rows=[]
attrs=['src','data-src','data-original','data-lazy','data-lazy-src','data-full','data-large','href','srcset']
for i,tag in enumerate(soup.find_all(True)):
    vals=[]
    for a in attrs:
        v=tag.get(a)
        if v: vals.append(f'{a}={v}')
    st=tag.get('style','')
    if 'url(' in st: vals.append('style='+st)
    if vals:
        txt=' '.join(tag.get_text(' ',strip=True).split())[:180]
        parent=tag.parent
        pdesc=''
        if parent:
            pdesc=f'parent={parent.name}#{parent.get("id","")}.{".".join(parent.get("class",[]))}'
        rows.append(f'[{i}] <{tag.name}> id={tag.get("id","")} class={" ".join(tag.get("class",[]))} {pdesc} text={txt!r}\n  ' + '\n  '.join(vals))
out.joinpath('elements.txt').write_text('\n\n'.join(rows),encoding='utf-8')
# Extract every image-like URL and download for inspection.
urls=[]
for tag in soup.find_all(True):
    for a in attrs:
        v=tag.get(a)
        if not v: continue
        parts=[v]
        if a=='srcset': parts=[x.strip().split()[0] for x in v.split(',')]
        for p in parts:
            if re.search(r'\.(?:jpe?g|png|webp)(?:\?|$)',p,re.I): urls.append(urljoin(URL,p))
for m in re.finditer(r'''["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']''',r.text,re.I): urls.append(urljoin(URL,m.group(1)))
seen=[]
for u in urls:
    if u not in seen: seen.append(u)
lines=[]
for n,u in enumerate(seen):
    try:
        rr=s.get(u,timeout=60); ct=rr.headers.get('content-type','')
        ext='.bin'
        for e in ('.webp','.jpg','.jpeg','.png'):
            if e in u.lower().split('?')[0]: ext=e; break
        fn=out/f'{n:03d}{ext}'
        if rr.ok: fn.write_bytes(rr.content)
        lines.append(f'{n:03d} {rr.status_code} {len(rr.content)} {ct} {u}')
    except Exception as e: lines.append(f'{n:03d} ERROR {e} {u}')
out.joinpath('urls.txt').write_text('\n'.join(lines),encoding='utf-8')
print('HTML',len(r.content),'URLs',len(seen))