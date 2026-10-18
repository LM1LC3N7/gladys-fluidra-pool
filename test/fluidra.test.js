// -----------------------------------------------------------------------------
// The answers of the Fluidra API and the equipment profiles (pure).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decode,
  identify,
  numberOf,
  parseComponents,
  parsePools,
  parseTree,
  pumpSpeedOf,
} from '../src/fluidra.js';
import { parseJson } from '../src/http.js';

const device = (fields) => ({ id: 'X1', name: '', family: '', thingType: '', ...fields });
const comps = (object) =>
  new Map(Object.entries(object).map(([k, v]) => [Number(k), { reported: v }]));
const keyOf = (fields, components) =>
  identify(device(fields), components && comps(components))?.key;

test('parseJson drops the keys that could pollute a prototype, and bounds the depth', () => {
  const value = parseJson('{"__proto__":{"polluted":1},"a":{"constructor":{"prototype":{"x":1}}}}');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(value, { a: {} });
  assert.throws(() => parseJson('['.repeat(50) + ']'.repeat(50)), /nested too deep/);
  assert.throws(() => parseJson('{oops'), /not JSON/);
  assert.equal(parseJson(''), undefined);
});

test('parsePools and parseTree: lists or envelopes, bridges replaced by their children', () => {
  assert.deepEqual(
    parsePools({ pools: [{ id: 'p1', name: 'Pool' }, { id: 'p1' }, { id: '../x' }] }),
    [{ id: 'p1', name: 'Pool' }],
  );
  assert.equal(parsePools({}), undefined);
  const devices = parseTree(
    {
      devices: [
        {
          id: 'BR1',
          info: { family: 'Bridges' },
          devices: [{ id: 'BR1.nn_1', type: 'connected', info: { name: 'Chlorinator' } }],
        },
        { id: 'P1', type: 'offline', info: { name: 'E30iQ' } },
        { id: 'P1', type: 'connected', info: { name: 'E30iQ' }, thingType: 'eppvs' },
        { id: 'bad id/1' },
      ],
    },
    'p1',
  );
  assert.deepEqual(
    devices.map((d) => [d.id, d.parentId, d.online, d.thingType]),
    [
      ['BR1.nn_1', 'BR1', true, ''],
      ['P1', undefined, true, 'eppvs'],
    ],
  );
});

test('parseComponents: a list, a wrapper or an id-keyed object; bounded', () => {
  const expected = new Map([[9, { reported: 1, desired: 0 }]]);
  assert.deepEqual(parseComponents([{ id: 9, reportedValue: 1, desiredValue: 0 }]), expected);
  assert.deepEqual(
    parseComponents({ components: [{ id: '9', reportedValue: 1, desiredValue: 0 }] }),
    expected,
  );
  assert.deepEqual(parseComponents({ 9: { reportedValue: 1, desiredValue: 0 }, x: {} }), expected);
  assert.equal(parseComponents('nope'), undefined);
  assert.equal(parseComponents([]), undefined);
  const many = Array.from({ length: 2000 }, (_, id) => ({ id, reportedValue: id }));
  assert.equal(parseComponents(many).size, 600);
});

test('numberOf is strict: null, empty, booleans and words are not numbers', () => {
  assert.equal(numberOf(7), 7);
  assert.equal(numberOf('721'), 721);
  for (const value of [null, undefined, '', ' ', true, false, 'abc', NaN, Infinity, [], {}]) {
    assert.equal(numberOf(value), undefined, String(value));
  }
});

test('identify: the family id, the serial, the name, the component-7 signature', () => {
  assert.equal(keyOf({ thingType: 'tecnoLC2', family: 'Chlorinators' }), 'tecnolc2');
  assert.equal(keyOf({ thingType: 'tecno2', family: 'Chlorinators' }), 'tecno2');
  assert.equal(keyOf({ thingType: 'domoticS2', family: 'Chlorinators' }), 'domotics2');
  assert.equal(keyOf({ thingType: 'exr', family: 'Chlorinators' }), 'exo');
  assert.equal(keyOf({ id: 'CC24058902.nn_1', thingType: 'tecnoLC2' }), 'cc24058902');
  assert.equal(keyOf({ thingType: 'BC3', family: 'Data collectors' }), 'blue-connect');
  assert.equal(
    keyOf({ id: 'QX25004412', name: 'Blue Connect Gold', thingType: 'BC3' }),
    'blue-connect-gold',
  );
  assert.equal(keyOf({ thingType: 'eppvs', family: 'Filtration Pumps' }), 'e30iq');
  assert.equal(keyOf({ name: 'Victoria Smart Connect VS', thingType: 'mppvs' }), 'victoria');
  assert.equal(keyOf({ thingType: 'zs500', family: 'Heat Pumps' }), 'z550iq');
  assert.equal(keyOf({ thingType: 'hpc', family: 'Heat Pumps' }), 'z350iq');
  assert.equal(keyOf({ id: 'ZB24001', family: 'Heat Pumps' }), 'z650iq');
  assert.equal(keyOf({ name: 'HPGIC 9', id: 'LG25363734' }), 'hpgic');
  assert.equal(keyOf({ thingType: 'LWM', family: 'Light Controllers' }), 'lumiplus');
  // LF* is a Z250iQ by its name, a Z260iQ only with its component-7 signature.
  assert.equal(keyOf({ id: 'LF2400', name: 'Z250iQ' }), 'z250iq');
  assert.equal(keyOf({ id: 'LF2400', name: 'Heat pump' }, { 7: 'BXWAD' }), 'z260iq');
  assert.equal(keyOf({ id: 'LG2400', name: 'Heat pump' }, { 7: 'BXWAA' }), 'lg-eco-elyo');
});

test('identify: nothing is guessed', () => {
  // A heat pump of an unknown family (PX50, "proelyo"): no profile, never read.
  assert.equal(keyOf({ thingType: 'proelyo', family: 'Heat Pumps', name: 'PX50' }), undefined);
  // A chlorinator with no family id: tecnoLC2 only when its registers say so.
  assert.equal(keyOf({ family: 'Chlorinators', name: 'Chlorinator' }), undefined);
  assert.equal(
    keyOf({ family: 'Chlorinators', name: 'Chlorinator' }, { 8: 0, 172: 268 }),
    'tecnolc2',
  );
  assert.equal(
    keyOf({ family: 'Chlorinators', name: 'Chlorinator' }, { 8: 720, 172: 722 }),
    undefined,
    'a domoticS2 pH setpoint on c8: not tecnoLC2',
  );
  // A generic pump, a robot, a valve: no profile.
  assert.equal(keyOf({ family: 'Filtration Pumps', name: 'Pump' }), undefined);
  assert.equal(keyOf({ family: 'Robot Cleaners', thingType: 'N30L' }), undefined);
});

test('decode: each layout, checked values only', () => {
  const tecno = identify(device({ thingType: 'tecnoLC2' }));
  assert.deepEqual(
    decode(tecno, comps({ 10: 80, 154: 0, 165: 0, 170: '702', 172: 254, 174: 0, 178: 150 })),
    { waterTemperature: 25.4, orp: 702, freeChlorine: 1.5, level: 80, production: 0 },
    'pH and salinity at 0: no probe reading',
  );
  const exo = identify(device({ thingType: 'exr' }));
  assert.deepEqual(decode(exo, comps({ 38: 55, 62: 72, 63: 738, 64: 14 })), {
    ph: 7.2,
    orp: 738,
    waterTemperature: 14,
    level: 55,
  });
  const z650 = identify(device({ id: 'ZB1' }));
  assert.deepEqual(decode(z650, comps({ 10: 1, 12: 275, 13: 268, 14: 0, 44: 395 })), {
    running: 1,
    setpoint: 27.5,
    waterTemperature: 26.8,
    airTemperature: 39.5,
    mode: 'smart-plus',
  });
  const victoria = identify(device({ thingType: 'mppvs' }));
  assert.deepEqual(decode(victoria, comps({ 14: 'RUNNING', 21: 65, 22: 512 })), {
    running: 1,
    speedPercent: 65,
    power: 512,
  });
  assert.deepEqual(decode(victoria, comps({ 14: 'PRIMING', 21: 'x' })), {});
  const pump = identify(device({ thingType: 'eppvs' }));
  assert.equal(pumpSpeedOf(decode(pump, comps({ 9: 1, 10: 0, 11: 2 }))), 'high');
  assert.equal(pumpSpeedOf(decode(pump, comps({ 9: 0, 10: 1, 11: 2 }))), 'off');
  assert.equal(pumpSpeedOf(decode(pump, comps({ 9: 1, 10: 1, 11: 2 }))), 'auto');
  assert.equal(pumpSpeedOf(decode(pump, comps({ 9: 1, 10: null, 11: 2 }))), undefined);
  assert.equal(pumpSpeedOf(decode(pump, comps({ 9: 1, 10: 0, 11: 7 }))), undefined);
});
