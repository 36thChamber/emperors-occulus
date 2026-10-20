"""Source-cell fidelity, native rendering, comparison clipping and cancellation."""
import io,json
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import numpy as np,rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from playwright.sync_api import sync_playwright,expect
W,H=1024,768
source=((np.arange(W*H,dtype='float32').reshape(H,W)%997)/996).astype('float32')
source[0,0]=np.nan;source[17,33]=1
fixtures={}
for codec in ['LZW','DEFLATE','NONE']:
 with MemoryFile() as mem:
  profile=dict(driver='GTiff',width=W,height=H,count=1,dtype='float32',crs='EPSG:4326',transform=from_origin(-55,-29,.0025,.0025),nodata=np.nan)
  if codec=='LZW':profile.update(compress='LZW',predictor=3,blockysize=1)
  if codec=='DEFLATE':profile.update(compress='DEFLATE',predictor=3,tiled=True,blockxsize=128,blockysize=128)
  with mem.open(**profile) as d:d.write(source,1)
  fixtures[codec]=mem.read()
rgb=np.stack([np.arange(256*128,dtype='uint16').reshape(128,256)+b*100 for b in range(3)])
with MemoryFile() as mem:
 with mem.open(driver='GTiff',width=256,height=128,count=3,dtype='uint16',crs='EPSG:4326',transform=from_origin(-55,-29,.0025,.0025),compress='DEFLATE',predictor=2,tiled=True,blockxsize=128,blockysize=128,interleave='pixel') as d:d.write(rgb)
 fixtures['RGB']=mem.read()
keys={codec:f'predictions/caraya/Alouatta_caraya_rs_250m_anual_2015_2024_adequabilidade.tif?fixture={codec}' for codec in fixtures}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':900})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 item={'module':'ste','area':'Alouatta_caraya','region':'rs_250m','product':'adequabilidade','date':'anual_2015_2024','key':keys['LZW'],'bytes':len(fixtures['LZW']),'etag':'v1'}
 page.route('**/api/config',lambda r:r.fulfill(json={'hosted':False,'googleMapsKey':''}))
 page.route('**/api/catalog*',lambda r:r.fulfill(json={'items':[item],'updated':1}))
 page.route('**/*.tile.openstreetmap.org/**',lambda r:r.abort())
 requests=[]
 def read(route):
  q=parse_qs(urlparse(route.request.url).query);codec=q['key'][0].split('fixture=')[-1];data=fixtures[codec]
  a,b=int(q['start'][0]),int(q['end'][0]);assert b-a+1<=262144
  requests.append((codec,a,b));route.fulfill(body=data[a:b+1],content_type='application/octet-stream')
 page.route('**/api/range?*',read)
 page.goto('http://127.0.0.1:8876')
 page.select_option('#module','ste')
 expect(page.locator('#quality')).to_be_disabled()
 expect(page.locator('#quality')).to_have_value('native')
 # Compare every decoded pixel, including a one-cell feature and NoData.
 checks=[]
 for codec,data in [(k,v) for k,v in fixtures.items() if k!="RGB"]:
  test_item={**item,'key':keys[codec],'bytes':len(data)}
  result=page.evaluate('''async item=>{const r=await OcculusRaster.createNativeReader(item);const parts=[];let n=0,error=0;
    for(let y=0;y<r.meta.h;y+=128){const p=await r.read([0,y,r.meta.w,Math.min(r.meta.h,y+128)]);for(let i=0;i<p.data.length;i++){const index=y*r.meta.w+i;const expected=index===17*1024+33?1:(index%997)/996;const value=p.data[i];if(index===0){if(!Number.isNaN(value))throw Error('NoData lost');}else error=Math.max(error,Math.abs(value-Math.fround(expected)));n++;}}
    const before=r.transferred;await r.read([0,0,64,64]);return {pixels:n,error,bytes:r.transferred,cachedBytes:r.transferred-before};}''',test_item)
  assert result['pixels']==W*H and result['error']<1e-7,result
  if codec!='NONE':assert result['cachedBytes']==0,result
  checks.append({'codec':codec,**result})
 rgb_item={**item,'key':keys['RGB'],'bytes':len(fixtures['RGB']),'product':'RGB'}
 values=page.evaluate("""async item=>{const r=await OcculusRaster.createNativeReader(item);const p=await r.read([17,17,19,19]);return Array.from(p.data);}""",rgb_item)
 assert values==rgb[:,17:19,17:19].transpose(1,2,0).reshape(-1).tolist(),values
 page.click('#load')
 expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=60000)
 expect(page.locator('#resolution-status')).to_contain_text('250 m')
 stats=page.evaluate('overlayA.getStats()');assert stats['cells']==W*H and stats['expected']==W*H,stats
 assert page.locator('.leaflet-image-layer').count()>1
 # Overlay tiles retain their native source geometry while CSS reduces their screen footprint.
 shapes=page.evaluate('''()=>[...overlayA.tiles.values()].filter(t=>t.overlay).map(t=>{const e=t.overlay.getElement();return {source:t.cells,image:[e.naturalWidth,e.naturalHeight],width:e.getBoundingClientRect().width};})''')
 assert all(s['image'][0]>0 and s['image'][1]>0 for s in shapes)
 before=page.evaluate('overlayA.reader.transferred')
 page.evaluate('occulusMap.setView([-29.4,-54.5],12,{animate:false})')
 expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=30000)
 assert page.evaluate('overlayA.reader.transferred')==before
 # Comparison uses a common clipping pane for all native tiles.
 page.evaluate("""async ({item,size})=>{const r=await OcculusRaster.createNativeReader({...item,key:item.key.replace('LZW','DEFLATE'),bytes:size});overlayB=new OcculusNative.Layer(r,{pane:'native-raster-b',zIndex:11});overlayB.addTo(occulusMap);clip();}""",{'item':item,'size':len(fixtures['DEFLATE'])})
 page.wait_for_function("()=>overlayB.getStats().state==='native'",timeout=30000)
 page.evaluate("$('swipe').value=25;clip()")
 clipping=page.evaluate("overlayB.getElement().style.clip")
 assert clipping.startswith('rect('),clipping
 # A small pan reuses source-aligned tiles and decoded blocks.
 before=page.evaluate('overlayA.reader.transferred')
 page.evaluate("occulusMap.panBy([15,0],{animate:false})")
 page.wait_for_function("()=>overlayA.getStats().state==='native' && overlayB.getStats().state==='native'",timeout=30000)
 assert page.evaluate('overlayA.reader.transferred')==before
 page.evaluate('window.__oldLayer=overlayA;occulusMap.setView([-29.1,-54.9],13,{animate:false});removeLayers()')
 page.wait_for_timeout(300)
 assert page.evaluate('__oldLayer._map===null && __oldLayer.tiles.size===0')
 assert page.locator('.leaflet-image-layer').count()==0
 page.evaluate("""()=>{window.budgetReads=0;const meta={...__oldLayer.meta,w:10000,h:10000};const reader={meta,read(){budgetReads++;throw Error('Must not read');},clear(){},estimate(){return 0;},startView(){}};window.budgetLayer=new OcculusNative.Layer(reader,{pane:'budget-test'});occulusMap.fitBounds([[-54,-55],[-29,-30]],{animate:false});budgetLayer.addTo(occulusMap);}""")
 page.wait_for_function("()=>budgetLayer.getStats().state==='limited'")
 assert page.evaluate('budgetReads')==0
 page.evaluate('budgetLayer.remove()')
 assert not errors,errors
 Path('artifacts/native').mkdir(parents=True,exist_ok=True)
 Path('artifacts/native/fixture-results.json').write_text(json.dumps({'decode':checks,'native_view':stats,'errors':errors},indent=2))
 print(json.dumps({'decode':checks,'native_view':stats,'errors':errors}),flush=True)
 browser.close()
