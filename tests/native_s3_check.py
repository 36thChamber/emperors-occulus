"""Read an entire 250m source grid without zooming, check pixels and mobile layout."""
import json,io,time
from pathlib import Path
import boto3,numpy as np
from rasterio.io import MemoryFile
from playwright.sync_api import sync_playwright,expect
P=Path('artifacts/native');P.mkdir(parents=True,exist_ok=True)
key='predictions/caraya/Alouatta_caraya_rs_250m_anual_2015_2024_adequabilidade.tif'
s=boto3.client('s3',region_name='sa-east-1');head=s.head_object(Bucket='ste-siapesq',Key=key)
# Test reference exists only in RAM, not a local TIFF file.
raw=s.get_object(Bucket='ste-siapesq',Key=key,IfMatch=head['ETag'])['Body'].read()
with MemoryFile(raw) as mem:
 with mem.open() as src:array=src.read(1);height,width=array.shape
item={'module':'ste','area':'Alouatta_caraya','region':'rs_250m','product':'adequabilidade','date':'anual_2015_2024','key':key,'bytes':len(raw),'etag':head['ETag']}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':900})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/api/config',lambda r:r.fulfill(json={'hosted':False,'googleMapsKey':''}))
 page.route('**/api/catalog*',lambda r:r.fulfill(json={'items':[item],'updated':1}))
 page.route('**/*.tile.openstreetmap.org/**',lambda r:r.abort())
 page.goto('http://127.0.0.1:8876');page.select_option('#module','ste')
 expect(page.locator('#quality')).to_have_value('native');expect(page.locator('#quality')).to_be_disabled()
 catalog=page.request.get('http://127.0.0.1:8876/api/catalog?module=ste',headers=page.evaluate('window.occulusHeaders()'))
 assert catalog.status==200
 started=time.monotonic();page.click('#load')
 expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=180000)
 stats=page.evaluate('overlayA.getStats()');assert stats['cells']==width*height==15840000,stats
 assert stats['screenReduced'] is True
 assert page.evaluate('overlayA.meta.w')==4400 and page.evaluate('overlayA.meta.h')==3600
 assert '0,0025' in page.locator('#map-subtitle').inner_text()
 points=[]
 finite=np.argwhere(np.isfinite(array)&(array>=0)&(array<=1))
 for index in np.linspace(0,len(finite)-1,15,dtype=int):
  row,col=map(int,finite[index]);points.append({'row':row,'column':col,'expected':float(array[row,col])})
 actual=page.evaluate('''async points=>{const out=[];for(const p of points){const r=await overlayA.reader.read([p.column,p.row,p.column+1,p.row+1]);out.push(r.data[0]);}return out;}''',points)
 for point,v in zip(points,actual):assert abs(v-point['expected'])<1e-7,(point,v)
 page.screenshot(path=str(P/'rs250-native-overview.png'))
 before=page.evaluate('overlayA.reader.transferred')
 page.evaluate('occulusMap.setView([-30.1,-52.1],13,{animate:false})')
 page.wait_for_timeout(300)
 expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=45000)
 assert page.evaluate('overlayA.reader.transferred')==before
 zoomed=page.evaluate('overlayA.getStats()');assert zoomed['screenReduced'] is False,zoomed
 page.screenshot(path=str(P/'rs250-native-zoom.png'))
 # Source precision persists after changing viewport size.
 page.set_viewport_size({'width':390,'height':844});page.click('#sidebar-close')
 page.wait_for_timeout(300)
 expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=45000)
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(P/'rs250-native-mobile.png'))
 assert not errors,errors
 result={'source':key,'shape':[width,height],'overview':stats,'zoomed':zoomed,'sample_count':len(points),'max_pixel_error':max(abs(v-p['expected']) for v,p in zip(actual,points)),'no_extra_bytes_on_zoom':True,'elapsed_seconds':round(time.monotonic()-started,1),'browser_errors':errors}
 (P/'s3-results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
 browser.close()
