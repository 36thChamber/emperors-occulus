import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('COG evaluation is opt-in, allowlisted, version-matched, and never falls back to official TIFFs', async () => {
  const source = fs.readFileSync('dist/server/index.js','utf8')+'\n// isolated evaluation tests';
  const worker = (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
  const key='predictions/caraya/Alouatta_caraya_rs_250m_anual_2015_2024_adequabilidade.tif';
  const stale=key.replace('adequabilidade','incerteza');
  const excluded=key.replace('caraya/','aranha/');
  const prefix='auspex/cog-avaliacao/2026-10-20/';
  const entry=k=>({module:'ste',source_key:k,source_bucket:'ste-siapesq',bucket:'ste-siapesq',key:prefix+'ste/'+k,source_etag:'"source"',etag:'"cog"',bytes:100,cog_valid:true,pixels_bitwise_equal:true,masks_equal:true,range_read_verified:true});
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async(url,options)=>{
    const u=new URL(url);calls.push(u);
    assert.equal(u.hostname,'ste-siapesq.s3.sa-east-1.amazonaws.com');
    if(u.searchParams.has('list-type')) return new Response('<ListBucketResult>'+[key,stale].map(k=>`<Contents><Key>${k}</Key><Size>200</Size><ETag>&quot;${k===key?'source':'updated'}&quot;</ETag><LastModified>2026-10-20</LastModified></Contents>`).join('')+'</ListBucketResult>');
    if(u.pathname.endsWith('pilot-manifest.json')) return Response.json({status:'validated',errors:[],files:[entry(key),entry(stale),{...entry(excluded),key:'private/file.tif'}]});
    assert.equal(decodeURIComponent(u.pathname),'/'+prefix+'ste/'+key);
    assert.equal(options.headers.range,'bytes=0-15');
    return new Response(new Uint8Array(16),{status:206,headers:{etag:'"cog"','content-length':'16'}});
  };
  const env={AWS_ACCESS_KEY_ID:'test',AWS_SECRET_ACCESS_KEY:'test'};
  const req=path=>worker.fetch(new Request('https://example.test'+path),env,{});
  try {
    const official=await (await req('/api/catalog?module=ste')).json();
    assert(official.items.every(x=>!x.dataset && x.bytes===200));
    assert(!calls.some(u=>u.pathname.endsWith('pilot-manifest.json')));
    const catalog=await (await req('/api/catalog?module=ste&dataset=cog')).json();
    assert(catalog.experimental);assert(catalog.items.every(x=>x.key===key && x.etag==='"cog"' && x.bytes===100 && x.dataset==='cog'));
    assert(catalog.items.length>0);assert(!catalog.items.some(x=>x.key===stale));
    const query=new URLSearchParams({module:'ste',dataset:'cog',key,start:'0',end:'15',etag:'"cog"'});
    assert.equal((await req('/api/range?'+query)).status,200);
    query.set('etag','"source"');assert.equal((await req('/api/range?'+query)).status,409);
    query.set('key',excluded);assert.equal((await req('/api/range?'+query)).status,404);
    query.set('key',prefix+'ste/'+key);assert.equal((await req('/api/range?'+query)).status,400);
    assert.equal((await req('/api/catalog?module=siapresp&dataset=cog')).status,400);
  } finally {globalThis.fetch=original;}
});
