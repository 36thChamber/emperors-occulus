// Credentials enter via stdin only, never the command line, output or files.
import fs from 'node:fs';
import assert from 'node:assert/strict';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}
const env=JSON.parse(input), source=fs.readFileSync('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const output=[];
for(const [module,key,expected] of [
 ['ste','predictions/caraya/Alouatta_caraya_nacional_1km_anual_2015_2024_adequabilidade.tif',2318],
 ['ste','predictions/aranha/Primatas_grupo_nacional_1km_futuro_2100_ssp585_adequabilidade.tif',3278],
 ['siapresp','predictions/daily/2026-10-14/thunnus_obesus/thunnus_obesus_rf_2026-10-14_mean.tif',822]]){
 const response=await worker.fetch(new Request('https://example.test/api/occurrences?'+new URLSearchParams({module,key})),env,{});
 const json=await response.json();assert.equal(response.status,200,json.error);
 const result=OcculusOccurrences.prepare(json.text,json.source);assert.equal(result.stats.presences,expected);
 output.push({module,source:json.source,...result.stats});
}
console.log(JSON.stringify(output));
