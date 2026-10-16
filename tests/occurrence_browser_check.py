"""Exercise occurrence-only map/table, species changes and retractable CRT layout."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
import json
BASE='http://127.0.0.1:8876'
OUT=Path('artifacts/occurrences');OUT.mkdir(parents=True,exist_ok=True)

def catalog(module):
    rows=[]
    if module=='ste':
        for slug,area in [('caraya','Alouatta_caraya'),('aranha','Primatas_grupo')]:
            for date in ['anual_2015_2024','futuro_2100_ssp585']:
                rows.append({'module':'ste','area':area,'slug':slug,'region':'nacional_1km','date':date,'product':'adequabilidade','key':f'predictions/{slug}/{area}_nacional_1km_{date}_adequabilidade.tif','bytes':1})
    elif module=='siapresp':
        for area in ['camarao','thunnus_obesus']:
            rows.append({'module':'siapresp','area':area,'region':'','date':'2026-10-14','product':'mean','key':f'predictions/daily/2026-10-14/{area}/{area}_rf_2026-10-14_mean.tif','bytes':1})
    else:
        rows=[{'module':'phytobloom','area':'165','date':'2026-10-09','product':'NDCI','key':'165_2026_10_09_NDCI.tif','bytes':1}]
    return {'items':rows,'updated':1}

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/api/catalog*',lambda route:route.fulfill(json=catalog(__import__('urllib.parse',fromlist=['parse_qs']).parse_qs(__import__('urllib.parse',fromlist=['urlparse']).urlparse(route.request.url).query).get('module',['phytobloom'])[0])))
    page.goto(BASE)
    page.select_option('#module','ste')
    expect(page.locator('#show-table')).to_be_enabled(timeout=30000)
    page.click('#show-table')
    expect(page.locator('#occurrence-panel')).to_be_visible(timeout=45000)
    expect(page.locator('#occurrence-status')).to_contain_text('2.318 presenças')
    # All visible records are presence only; full filtering is covered by parser tests.
    values=page.locator('#occurrence-table').evaluate('t=>{const i=[...t.tHead.rows[0].cells].findIndex(x=>x.textContent==="sp");return [...t.tBodies[0].rows].map(r=>r.cells[i].textContent)}')
    assert values and set(values)=={'1'},values
    expect(page.locator('#table-page')).to_contain_text('página 1/58')
    page.click('#table-next');expect(page.locator('#table-page')).to_contain_text('página 2/58')
    page.fill('#occurrence-search','STRING_THAT_DOES_NOT_EXIST')
    expect(page.locator('#table-page')).to_contain_text('0 registros')
    page.fill('#occurrence-search','')
    page.click('#show-points')
    expect(page.locator('#points-count')).to_have_text('2.318 pontos',timeout=30000)
    point_count=page.evaluate('()=>{let n=0;occulusMap.eachLayer(x=>{if(x instanceof L.CircleMarker)n++});return n}')
    assert point_count==2318,point_count
    page.click('#fit-points')
    expect(page.locator('#show-points')).to_have_attribute('aria-pressed','true')
    # The historical points remain when switching to a future raster scenario.
    page.select_option('#date','futuro_2100_ssp585')
    expect(page.locator('#points-count')).to_have_text('2.318 pontos')
    page.locator('#close-table').click()
    page.screenshot(path=str(OUT/'desktop-points.png'))
    before=page.locator('#map').bounding_box()['width']
    page.click('#sidebar-close')
    expect(page.locator('#vision-sidebar')).not_to_be_visible()
    after=page.locator('#map').bounding_box()['width']
    assert after>before+200 and after/1440>.97,(before,after)
    page.screenshot(path=str(OUT/'desktop-map-only.png'))
    page.click('#sidebar-toggle')
    page.select_option('#area','Primatas_grupo')
    expect(page.locator('#points-badge')).not_to_be_visible()
    assert page.evaluate('()=>{let n=0;occulusMap.eachLayer(x=>{if(x instanceof L.CircleMarker)n++});return n}')==0
    page.click('#show-table')
    expect(page.locator('#occurrence-status')).to_contain_text('3.278 presenças',timeout=45000)
    expect(page.locator('#table-species')).to_contain_text('Aranha')
    page.screenshot(path=str(OUT/'desktop-table.png'))
    page.select_option('#module','siapresp')
    expect(page.locator('#occurrence-panel')).not_to_be_visible()
    page.click('#show-table')
    expect(page.locator('#occurrence-status')).to_contain_text('Não há tabela',timeout=30000)
    page.select_option('#area','thunnus_obesus')
    page.click('#show-table')
    expect(page.locator('#occurrence-panel')).to_be_visible(timeout=30000)
    expect(page.locator('#occurrence-status')).to_contain_text('822 presenças')
    page.click('#close-table')
    page.set_viewport_size({'width':390,'height':844})
    page.click('#sidebar-close')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.locator('#map').bounding_box()['height']/844>.85
    page.screenshot(path=str(OUT/'mobile-map.png'))
    page.click('#sidebar-toggle')
    page.click('#show-table')
    expect(page.locator('#occurrence-panel')).to_be_visible()
    page.click('#sidebar-close')
    page.screenshot(path=str(OUT/'mobile-table.png'))
    assert not errors,errors
    print(json.dumps({'presence_points':2318,'group_presences':3278,'ocean_presences':822,'sidebar_map_width':after,'browser_errors':errors}))
    browser.close()
