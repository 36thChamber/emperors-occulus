import test from 'node:test';
import assert from 'node:assert/strict';
import '../occulus/static/occurrences.js';
const { prepare, sourceFor } = OcculusOccurrences;
test('mixed tables exclude pseudoabsences, conflicts and undefined classes before table/map use', () => {
  const data = prepare('sp,registro,decimalLatitude,decimalLongitude,locality\n1,presenca,-29,-51,"Rio, Sul"\n0,pseudoausencia,-28,-52,falso\n1,pseudoausencia,-27,-53,conflito\n,presenca,-26,-54,indefinido\n1,presenca,,-55,sem latitude\n1,presenca,0,0,equador\n1,presenca,91,-50,invalido\n', 'species-table/caraya.csv');
  assert.equal(data.rows.length, 4);
  assert.equal(data.stats.excluded, 3);
  assert.equal(data.stats.invalidCoordinates, 2);
  assert.deepEqual(data.coordinates.filter(Boolean), [[-29,-51],[0,0]]);
  assert.equal(data.rows[0][4], 'Rio, Sul');
});
test('occurrence-only files support quoted multiline fields, UTF-8 BOM and decimal comma', () => {
  const data = prepare('\uFEFFdecimalLatitude;decimalLongitude;locality\r\n"-29,5";"-51,2";"Local\ncom ""aspas"""\r\n', 'species-table/Occurrence_Test_species_01_01_26.csv');
  assert.equal(data.rows.length, 1);
  assert.deepEqual(data.coordinates[0], [-29.5,-51.2]);
  assert.equal(data.rows[0][2], 'Local\ncom "aspas"');
  assert.equal(prepare('decimalLatitude,decimalLongitude\n-1,-2', 'unknown.csv').rows.length, 0);
  assert.throws(() => prepare('sp,decimalLatitude,decimalLongitude\n1,"-2,-3', 'caraya.csv'));
});
test('explicit absence statuses override occurrence-file naming', () => {
  const data = prepare('occurrenceStatus,decimalLatitude,decimalLongitude\npresent,-1,-2\nabsent,-3,-4\nunknown,-5,-6', 'species-table/Occurrence_Test_species_01_01_26.csv');
  assert.equal(data.rows.length, 1);
});
test('source discovery preserves primate aliases, dates and exact species boundaries', () => {
  const objects = ['species-table/aranha.csv','species-table/Occurrence_Thunnus_obesus_03_09_26.csv','species-table/Occurrence_Thunnus_obesus_04_09_26 (1).csv','species-table/Occurrence_Thunnus_obesus_04_09_26.csv','species-table/Occurrence_Thunnus_obesus_other_05_09_26.csv'].map(key => ({key}));
  assert.equal(sourceFor('Primatas_grupo', objects).key, 'species-table/aranha.csv');
  assert.equal(sourceFor('thunnus_obesus', objects).key, 'species-table/Occurrence_Thunnus_obesus_04_09_26.csv');
  assert.equal(sourceFor('camarao', objects), null);
});
