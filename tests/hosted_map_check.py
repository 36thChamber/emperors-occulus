"""Private deployed Site QA. Token is read from stdin, never saved."""
import json,sys
from playwright.sync_api import sync_playwright,expect
config=json.loads(sys.stdin.readline());origin=config['url']
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1440,'height':1100})
 def authorize(route):
  # Scope the service header to this Site; never send it to map tile providers.
  route.continue_(headers={**route.request.headers,'OAI-Sites-Authorization':'Bearer '+config['token']})
 context.route(origin+'/**',authorize)
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(origin,timeout=60000);page.locator('#area option').first.wait_for(state='attached',timeout=120000)
 page.select_option('#quality','96');page.click('#load')
 expect(page.locator('#message')).to_contain_text('Visão estabelecida',timeout=180000)
 print('Deployed map:',page.locator('#map-subtitle').inner_text(),page.locator('#read-info').inner_text(),flush=True)
 assert page.locator('.leaflet-image-layer').count()==1
 assert page.locator('#basemap').input_value()=='osm'
 assert not errors,errors
 print('Private Site end-to-end map verified.',flush=True)
 browser.close()
