"""Build the attributed, compact catalogue shipped with Starmap."""
import csv, io, json, pathlib, requests, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'public/data'; FONT=ROOT/'public/fonts'
def download(url):
 r=requests.get(url, timeout=90); r.raise_for_status(); return r.content
def jsave(name,data):
 (DATA/name).write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False))
fontbase='https://raw.githubusercontent.com/rektdeckard/departure-mono/main/public/assets/'
for name in ['DepartureMono-Regular.woff2','LICENSE']:
 (FONT/name).write_bytes(download(fontbase+name))
base='https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/'
raw=download(base+'hygdata_v41.csv').decode()
rows=list(csv.DictReader(io.StringIO(raw)))
stars=[]
for r in rows:
 if r['id']=='0': continue
 mag=float(r['mag'] or 99); dist=float(r['dist'] or 100000)
 if mag>7.5 and dist>25 and not r['proper']: continue
 number=lambda k: round(float(r[k]),6) if r.get(k) else None
 stars.append({'id':'s'+r['id'],'hip':r['hip'],'name':r['proper'] or (r['bf'].strip() or (r['gl'].strip() if r['gl'] else 'HIP '+r['hip'] if r['hip'] else 'HD '+r['hd'] if r['hd'] else 'HYG '+r['id'])),'named':bool(r['proper']),'ra':number('ra'),'dec':number('dec'),'mag':mag,'dist':round(dist*3.2615638,3) if 0<dist<100000 else None,'spec':r['spect'],'con':r['con'],'lum':number('lum'),'ci':number('ci'),'pmra':number('pmra'),'pmdec':number('pmdec'),'x':number('x'),'y':number('y'),'z':number('z')})
jsave('stars.json',stars)
(DATA/'HYG-LICENSE.txt').write_bytes(download(base+'LICENSE'))
cb='https://raw.githubusercontent.com/ofrohn/d3-celestial/master/'
for name in ['messier.json','constellations.lines.json','constellations.json']:
 (DATA/name).write_bytes(download(cb+'data/'+name))
(DATA/'CELESTIAL-LICENSE.txt').write_bytes(download(cb+'LICENSE'))
sat=json.loads(download('https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=JSON'))
jsave('satellites.json',{'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'CelesTrak visual group','elements':sat})
starlink=json.loads(download('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=JSON'))
jsave('starlink.json',{'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'CelesTrak Starlink group','elements':starlink})
print(f'Saved {len(stars)} stars, {len(sat)} satellite elements, Messier catalogue, constellations and font.')
print('HYG license:',(DATA/'HYG-LICENSE.txt').read_text()[:500])

from fetch_satellite_catalogue import fetch_catalogue
fetch_catalogue()
