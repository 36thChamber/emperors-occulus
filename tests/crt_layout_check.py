"""Browser QA of CRT layout without raster or AWS reads."""
from playwright.sync_api import sync_playwright,expect
import json
from pathlib import Path
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/api/catalog*',lambda route:route.fulfill(json={'items':[{'area':'165','product':'NDCI','date':'2026-10-09','key':'165_2026_10_09_NDCI.tif','bytes':175246172,'etag':'v1'}],'updated':1}))
    page.route('**/api/config',lambda route:route.fulfill(json={'hosted':False,'googleMapsKey':''}))
    page.goto('http://127.0.0.1:8765')
    page.locator('#area option').first.wait_for(state='attached')
    metrics=page.evaluate("""()=>{const r=document.getElementById('map').getBoundingClientRect();return {width:r.width/innerWidth,height:r.height/innerHeight,filter:getComputedStyle(document.querySelector('.leaflet-tile-pane')).filter,overflow:document.documentElement.scrollWidth>innerWidth}}""")
    assert metrics['width']>.95 and metrics['height']>.70 and not metrics['overflow'],metrics
    assert 'grayscale' in metrics['filter']
    # Synthetic analysis overlay: verify scientific colours are excluded from the filter.
    page.evaluate("""()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const c=canvas.getContext('2d');c.fillStyle='red';c.fillRect(0,0,2,2);window.testOverlay=L.imageOverlay(canvas.toDataURL(),[[-23,-44],[-22,-43]]).addTo(window.occulusMap)}""")
    assert page.locator('.leaflet-image-layer').evaluate('(e)=>getComputedStyle(e).filter')=='none'
    page.click('#fullscreen')
    expect(page.locator('#fullscreen')).to_have_attribute('aria-label','Sair da tela inteira')
    assert page.locator('#map').bounding_box()['height']>=898
    page.click('#fullscreen')
    expect(page.locator('#fullscreen')).to_have_attribute('aria-label','Ampliar mapa para tela inteira')
    Path('artifacts').mkdir(exist_ok=True)
    page.screenshot(path='artifacts/crt-desktop.png')
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(150)
    mobile=page.locator('#map').bounding_box()
    assert mobile['height']/844>.65
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='artifacts/crt-mobile.png')
    print('desktop',metrics,'mobile map height',round(mobile['height']/844*100,1),'browser errors',errors)
    assert not errors
    browser.close()
