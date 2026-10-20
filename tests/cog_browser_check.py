"""Real S3 COG, full 250m native grid, official/experiment switching."""
import json
import os
from pathlib import Path
import boto3
import numpy as np
from rasterio.io import MemoryFile
from playwright.sync_api import sync_playwright, expect

base = os.getenv('OCCULUS_BASE_URL', 'http://127.0.0.1:8876')
key = 'predictions/caraya/Alouatta_caraya_rs_250m_anual_2015_2024_adequabilidade.tif'
s3 = boto3.client('s3', region_name='sa-east-1')
raw = s3.get_object(Bucket='ste-siapesq', Key=key)['Body'].read()
with MemoryFile(raw) as mem:
    with mem.open() as src:
        array = src.read(1)
finite = np.argwhere(np.isfinite(array) & (array >= 0) & (array <= 1))
points = [dict(row=int(finite[i,0]),column=int(finite[i,1]),expected=float(array[tuple(finite[i])])) for i in np.linspace(0,len(finite)-1,15,dtype=int)]
out = Path('artifacts/cog');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=1440,height=900))
    errors=[];ranges=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('request',lambda r:ranges.append(r.url) if '/api/range?' in r.url else None)
    page.route('**/*.tile.openstreetmap.org/**',lambda r:r.abort())
    # Avoid listing unrelated historical satellite products during this focused QA.
    page.route('**/api/catalog?module=phytobloom**',lambda r:r.fulfill(json=dict(items=[],updated=1)))
    page.goto(base)
    expect(page.locator('#dataset-control')).to_be_hidden()
    page.select_option('#module','ste')
    expect(page.locator('#dataset')).to_have_value('original')
    expect(page.locator('#dataset-control')).to_be_visible()
    page.select_option('#dataset','cog')
    expect(page.locator('#catalog-status')).to_contain_text('45 produtos',timeout=60000)
    expect(page.locator('#catalog-status')).to_contain_text('COG experimental')
    page.select_option('#area','Alouatta_caraya')
    page.select_option('#region','rs_250m')
    page.select_option('#product','adequabilidade')
    page.select_option('#date','anual_2015_2024')
    expect(page.locator('#quality')).to_be_disabled()
    expect(page.locator('#quality')).to_have_value('native')
    page.click('#load')
    expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=180000)
    stats = page.evaluate('overlayA.getStats()')
    assert stats['cells']==4400*3600==15840000, stats
    assert page.evaluate('overlayA.meta.w')==4400 and page.evaluate('overlayA.meta.h')==3600
    values = page.evaluate('''async points=>{const values=[];for(const p of points){const r=await overlayA.reader.read([p.column,p.row,p.column+1,p.row+1]);values.push(r.data[0]);}return values;}''', points)
    error=max(abs(v-p['expected']) for v,p in zip(values,points))
    assert error==0, error
    assert ranges and all('dataset=cog' in r for r in ranges), ranges[:2]
    page.screenshot(path=str(out/'evaluation-desktop.png'))
    page.evaluate('occulusMap.setView([-30.1,-52.1],13,{animate:false})')
    page.wait_for_timeout(300)
    expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=60000)
    assert not page.evaluate('overlayA.getStats().screenReduced')
    page.set_viewport_size(dict(width=390,height=844));page.click('#sidebar-close')
    page.wait_for_timeout(300)
    expect(page.locator('#resolution-status')).to_have_attribute('data-state','native',timeout=60000)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(out/'evaluation-mobile.png'))
    page.set_viewport_size(dict(width=1440,height=900));page.click('#sidebar-toggle')
    page.select_option('#dataset','original')
    expect(page.locator('#catalog-status')).not_to_contain_text('COG experimental',timeout=60000)
    assert page.evaluate('overlayA===null')
    assert not errors, errors
    result=dict(base=base,experimental_files=45,native_cells=stats['cells'],source_shape=list(array.shape),pixel_samples=len(points),max_pixel_error=error,range_requests=len(ranges),browser_errors=errors,official_switch_passed=True)
    (out/('public-results.json' if base.startswith('https') else 'local-results.json')).write_text(json.dumps(result,indent=2))
    print(json.dumps(result),flush=True)
    browser.close()
