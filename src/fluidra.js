// -----------------------------------------------------------------------------
// The answers of the Fluidra API, checked, and the equipment profiles (pure).
//
// Fluidra gives no model field and no documentation: every device exposes
// numbered "components" whose meaning changes with the family. The profiles
// below are ported from foXaCe/Fluidra-pool (device_registry/configs, MIT),
// and only the ones whose registers were checked against the official app by
// its users: an equipment no profile matches is listed but never read, so a
// value is never shown under a wrong meaning (TODO.md "Decisions").
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';

/** A cloud id kept as is when it is short and plain; anything else is dropped. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const cleanId = (value) => {
  const id = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  return typeof id === 'string' && ID.test(id) ? id : undefined;
};

/** Control characters: never kept in a name shown in Gladys or written to a log. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

const text = (value) =>
  typeof value === 'string' ? value.replace(CONTROL, ' ').trim().slice(0, LIMITS.textLength) : '';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** `[{ id, name }]` from `GET /generic/users/me/pools` (a list or `{ pools }`). */
export function parsePools(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.pools) ? data.pools : undefined;
  if (!list) {
    return undefined;
  }
  const pools = [];
  for (const pool of list) {
    const id = cleanId(pool?.id);
    if (id && !pools.some((p) => p.id === id) && pools.length < LIMITS.pools) {
      pools.push({ id, name: text(pool.name) });
    }
  }
  return pools;
}

/** The fields of one entry of the device tree. */
function entryOf(raw, poolId, parentId) {
  const id = cleanId(raw?.id);
  if (!id) {
    return undefined;
  }
  const info = isObject(raw.info) ? raw.info : {};
  const connection = typeof raw.type === 'string' ? raw.type : 'unknown';
  return {
    id,
    poolId,
    parentId,
    name: text(info.name),
    family: text(info.family),
    thingType: text(raw.thingType) || text(raw.status?.thingType),
    // Only an explicit state is trusted: anything else stays unknown.
    online: connection === 'connected' ? true : connection === 'disconnected' ? false : undefined,
  };
}

/**
 * The devices of one pool from `GET /generic/devices?poolId=…&format=tree`
 * (a list or `{ devices }`): bridges are replaced by the devices behind them,
 * and an id seen twice keeps its "connected" entry (foXaCe _devices.py).
 */
export function parseTree(data, poolId) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.devices) ? data.devices : undefined;
  if (!list) {
    return undefined;
  }
  const found = new Map();
  const add = (entry) => {
    if (!entry) {
      return;
    }
    const existing = found.get(entry.id);
    if (!existing || (entry.online === true && existing.online !== true)) {
      if (existing || found.size < LIMITS.devices) {
        found.set(entry.id, entry);
      }
    }
  };
  for (const raw of list) {
    if (!isObject(raw)) {
      continue;
    }
    const entry = entryOf(raw, poolId);
    const children = Array.isArray(raw.devices) ? raw.devices : [];
    const bridge = /bridge/i.test(entry?.family ?? '') || children.length > 0;
    if (!bridge) {
      add(entry);
      continue;
    }
    for (const child of children) {
      if (isObject(child)) {
        add(entryOf(child, poolId, entry?.id));
      }
    }
  }
  return [...found.values()];
}

/**
 * `Map<componentId, { reported, desired }>` from
 * `GET /generic/devices/{id}/components?details=true` (a list of components,
 * `{ components: [...] }` or an id-keyed object: foXaCe _components.py), or
 * undefined when the shape is not one of them.
 */
export function parseComponents(data) {
  let entries;
  if (Array.isArray(data)) {
    entries = data.map((c) => [c?.id, c]);
  } else if (isObject(data) && Array.isArray(data.components)) {
    entries = data.components.map((c) => [c?.id, c]);
  } else if (isObject(data)) {
    entries = Object.entries(data);
  } else {
    return undefined;
  }
  const components = new Map();
  for (const [rawId, component] of entries) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 0 || id > 100_000 || !isObject(component)) {
      continue;
    }
    if (components.size >= LIMITS.components) {
      break;
    }
    components.set(id, { reported: component.reportedValue, desired: component.desiredValue });
  }
  return components.size > 0 ? components : undefined;
}

// --- Values --------------------------------------------------------------------

/** A number from a reported value: a finite number or a plain numeric string, never null/''/true. */
export function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** `raw / divisor` within [min, max], else undefined. `zeroIsNone`: no probe reads 0. */
const scaled = (value, divisor, { min, max, digits = 2, zeroIsNone = false }) => {
  const n = numberOf(value);
  if (n === undefined || (zeroIsNone && n === 0)) {
    return undefined;
  }
  const v = round(n / divisor, digits);
  return v >= min && v <= max ? v : undefined;
};

/** 0/1 (or "0"/"1", false/true) -> 0/1; anything else undefined. */
export function binaryOf(value) {
  if (value === true || value === 1 || value === '1') {
    return 1;
  }
  if (value === false || value === 0 || value === '0') {
    return 0;
  }
  return undefined;
}

// --- Profiles -------------------------------------------------------------------

/** LG Eco Elyo, Gre HPGIC, Z250iQ, Z260iQ (c14, foXaCe const.py LG_MODE_TO_VALUE). */
const LG_MODES = [
  'smart-heating',
  'smart-cooling',
  'smart-heat-cool',
  'boost-heating',
  'silence-heating',
  'boost-cooling',
  'silence-cooling',
];
/** Z650iQ c14 (Z650_MODE_TO_VALUE). */
const Z650_MODES = ['smart-plus', 'boost', 'smart', 'ecosilence'];
/** Z550iQ c16 (heating/cooling/auto). */
const Z550_MODES = ['heating', 'cooling', 'auto'];
/** Z350iQ c16 (Boost/Silence/Smart, heat only). */
const Z350_MODES = ['boost', 'silence', 'smart'];

const water = (c, divisor) => scaled(c, divisor, { min: -5, max: 60, digits: 1 });
const air = (c, divisor) => scaled(c, divisor, { min: -40, max: 70, digits: 1 });
const setpointOf = (c) => scaled(c, 10, { min: 5, max: 45, digits: 1 });
const modeOf = (list) => (c) => {
  const n = numberOf(c);
  return Number.isInteger(n) && n >= 0 && n < list.length ? list[n] : undefined;
};
const percent = (c) => scaled(c, 1, { min: 0, max: 100, digits: 0 });

/**
 * Heat pump layouts: on/off, setpoint (°C × 10, also the write register),
 * water and air temperatures, mode. `range`: what the family accepts.
 */
const AMT = {
  on: 13,
  setpoint: 15,
  water: [19, 10],
  mode: [14, LG_MODES],
  range: { min: 10, max: 40, step: 1 },
};
const Z260 = { ...AMT, air: [67, 10], range: { min: 7, max: 40, step: 1 } };
const Z550 = {
  on: 21,
  setpoint: 15,
  water: [37, 10],
  air: [40, 10],
  mode: [16, Z550_MODES],
  range: { min: 15, max: 40, step: 1 },
};
const Z350 = { ...Z550, mode: [16, Z350_MODES] };
const Z650 = {
  on: 10,
  setpoint: 12,
  water: [13, 10],
  air: [44, 10],
  mode: [14, Z650_MODES],
  range: { min: 15, max: 35, step: 0.5 },
};

/**
 * Water analysers and chlorinators: `[component, divisor]` of each reading;
 * `level`: the chlorination setpoint (%), `production`: the real output (%).
 */
const TECNO_LC2 = {
  ph: [165, 100],
  orp: [170, 1],
  temperature: [172, 10],
  salinity: [174, 100],
  freeChlorine: [178, 100],
  level: 10,
  production: 154,
};
const DOMOTIC_S2 = {
  ph: [172, 100],
  orp: [177, 1],
  temperature: [183, 10],
  salinity: [185, 100],
  freeChlorine: [178, 100],
  level: 4,
  production: 164,
};

/**
 * The profiles, by priority (the first one with the best score wins). The
 * patterns are those of foXaCe device_registry/configs: `ids` (cloud serial,
 * `*` wildcard), `things` (Fluidra's family id, `thingType`), `names` and `models` (both
 * against the device name: the cloud has no model field), `families` (the
 * family label). See identify().
 */
export const PROFILES = [
  {
    key: 'hpgic',
    kind: 'heat_pump',
    names: ['hpgic'],
    models: ['hpgic'],
    layout: AMT,
    priority: 101,
  },
  {
    key: 'lg-eco-elyo',
    kind: 'heat_pump',
    ids: ['LG*'],
    names: ['eco', 'elyo'],
    models: ['astralpool'],
    families: ['eco elyo'],
    signature: ['BXWAA', 'BXWAB'],
    layout: AMT,
    priority: 100,
  },
  {
    key: 'z350iq',
    kind: 'heat_pump',
    things: ['hpc'],
    names: ['z350', 'z35'],
    models: ['z350', 'z35'],
    layout: Z350,
    priority: 98,
  },
  {
    key: 'z650iq',
    kind: 'heat_pump',
    ids: ['ZB*'],
    names: ['z650', 'z65'],
    models: ['z650', 'z65'],
    layout: Z650,
    priority: 98,
  },
  {
    key: 'z260iq',
    kind: 'heat_pump',
    ids: ['LF*'],
    signature: ['BXWAD'],
    signatureRequired: true,
    layout: Z260,
    priority: 97,
  },
  {
    key: 'z550iq',
    kind: 'heat_pump',
    ids: ['LD*'],
    things: ['zs500'],
    names: ['z550', 'z55'],
    layout: Z550,
    priority: 96,
  },
  {
    key: 'z250iq',
    kind: 'heat_pump',
    ids: ['LF*'],
    names: ['z250', 'z25'],
    layout: Z260,
    priority: 95,
  },
  // Serial-specific chlorinators whose layout differs from the tecnoLC2 one.
  {
    key: 'cc24058902',
    kind: 'chlorinator',
    ids: ['CC24058902*'],
    sensors: { ...TECNO_LC2, orp: [177, 1] },
    priority: 93,
  },
  {
    key: 'energy-connect-bridged',
    kind: 'chlorinator',
    ids: ['CC24054221*', 'CC24041107*'],
    sensors: { ...TECNO_LC2, orp: undefined, freeChlorine: undefined, salinity: [160, 1000] },
    priority: 93,
  },
  {
    key: 'blue-connect-gold',
    kind: 'chlorinator',
    ids: ['QX*'],
    names: ['blue connect gold'],
    families: ['data collectors'],
    sensors: { temperature: [12, 1], ph: [13, 1], orp: [14, 1], salinity: [16, 1] },
    priority: 90,
  },
  {
    key: 'tecno2',
    kind: 'chlorinator',
    things: ['tecno2'],
    sensors: {
      ph: [99, 100],
      orp: [110, 1],
      temperature: [69, 10],
      salinity: [78, 100],
      level: 2,
      production: 54,
    },
    priority: 90,
  },
  {
    key: 'blue-connect',
    kind: 'chlorinator',
    ids: ['WA*'],
    things: ['BC3'],
    families: ['data collectors'],
    sensors: { temperature: [12, 1], ph: [13, 1], orp: [14, 1] },
    priority: 88,
  },
  {
    key: 'exo',
    kind: 'chlorinator',
    ids: ['NS*'],
    things: ['exr'],
    sensors: { ph: [62, 10], orp: [63, 1], temperature: [64, 1], level: 38 },
    priority: 85,
  },
  {
    key: 'tecnolc2',
    kind: 'chlorinator',
    things: ['tecnolc2'],
    sensors: TECNO_LC2,
    priority: 84,
  },
  {
    key: 'domotics2',
    kind: 'chlorinator',
    ids: ['DM*'],
    things: ['domoticS2', 'domS2'],
    sensors: DOMOTIC_S2,
    priority: 83,
  },
  { key: 'e30iq', kind: 'pump', ids: ['E30*', 'LE*', 'PUMP*'], things: ['eppvs'], priority: 50 },
  {
    key: 'victoria',
    kind: 'pump',
    models: ['victoria smart connect'],
    things: ['mppvs'],
    priority: 50,
  },
  {
    key: 'lumiplus',
    kind: 'light',
    names: ['lumiplus'],
    things: ['LWM'],
    families: ['light'],
    priority: 40,
  },
];

const byKey = new Map(PROFILES.map((p) => [p.key, p]));
export const profileOf = (key) => byKey.get(key);

/** foXaCe _helpers.py classify_device_type: the coarse type from the family and the name. */
export function classify(family, name) {
  const f = family.toLowerCase();
  const n = name.toLowerCase();
  if (f.includes('pump') && /heat|eco|elyo|thermal/.test(f)) {
    return 'heat_pump';
  }
  if (f.includes('cabinet')) {
    return 'cabinet';
  }
  if (f.includes('pump')) {
    return 'pump';
  }
  if (/heat|thermal|eco elyo|astralpool/.test(f) || /heat|thermal|eco|elyo/.test(n)) {
    return 'heat_pump';
  }
  if (f.includes('chlorinator') || f.includes('electrolyseur')) {
    return 'chlorinator';
  }
  if (f.includes('heater')) {
    return 'heater';
  }
  if (f.includes('light') || n.includes('lumiplus')) {
    return 'light';
  }
  if (/robot|cleaner/.test(f) || n.includes('cleaner')) {
    return 'robot';
  }
  return 'unknown';
}

/** foXaCe identifier.py `_match`: `*` is a wildcard (whole value), else a substring; no case. */
const matches = (value, patterns = []) => {
  const v = String(value ?? '').toLowerCase();
  if (v === '') {
    return false;
  }
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (!p.includes('*')) {
      return v.includes(p);
    }
    const parts = p.split('*');
    if (!v.startsWith(parts[0]) || !v.endsWith(parts.at(-1))) {
      return false;
    }
    let at = parts[0].length;
    for (const part of parts.slice(1, -1)) {
      const found = v.indexOf(part, at);
      if (found < 0) {
        return false;
      }
      at = found + part.length;
    }
    return at <= v.length - parts.at(-1).length;
  });
};

/** A tecnoLC2 chlorinator seen by its registers: c8 blank and c172 in the water band (identifier.py). */
function looksLikeTecnoLc2(components) {
  const c8 = components?.get(8)?.reported;
  if (!(c8 === undefined || c8 === null || c8 === '' || numberOf(c8) === 0)) {
    return false;
  }
  const c172 = numberOf(components?.get(172)?.reported);
  return c172 !== undefined && c172 >= 30 && c172 <= 520;
}

/**
 * The profile of a device (foXaCe identifier.py scoring): serial 50, family
 * id 25, name 30, family label 20, model 20, plus 10 when the coarse type agrees; the
 * component-7 signature of the LG (BXWAA/BXWAB) and Z260iQ (BXWAD) heat
 * pumps adds 100, and the Z260iQ profile needs it. A profile matched only by
 * the coarse type is never used. A chlorinator nobody claims is tecnoLC2 when
 * its registers say so. `components`: the last read, when there is one.
 */
export function identify(device, components) {
  const type = classify(device.family, device.name);
  const comp7 = components?.get(7)?.reported;
  const signature = typeof comp7 === 'string' ? comp7 : '';
  let best;
  let bestScore = 0;
  for (const profile of PROFILES) {
    let signal = 0;
    if (matches(device.id, profile.ids)) signal += 50;
    if (matches(device.thingType, profile.things)) signal += 25;
    if (matches(device.name, profile.names)) signal += 30;
    if (matches(device.family, profile.families)) signal += 20;
    // foXaCe compares its model patterns to the device name too (no model field).
    if (matches(device.name, profile.models)) signal += 20;
    if (profile.signature) {
      if (matches(signature, profile.signature)) {
        signal += 100;
      } else if (profile.signatureRequired) {
        continue;
      }
    }
    if (signal === 0) {
      continue;
    }
    const score = signal + (profile.kind === type ? 10 : 0);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }
  if (!best && type === 'chlorinator' && looksLikeTecnoLc2(components)) {
    return byKey.get('tecnolc2');
  }
  return best;
}

/** The components a profile reads (and what identify() needs to look at). */
export function componentsOf(profile) {
  const ids = new Set([7, 8, 172]);
  if (profile?.layout) {
    const l = profile.layout;
    [l.on, l.setpoint, l.water?.[0], l.air?.[0], l.mode?.[0]].forEach((c) => c && ids.add(c));
  }
  for (const value of Object.values(profile?.sensors ?? {})) {
    if (Array.isArray(value)) ids.add(value[0]);
    else if (Number.isInteger(value)) ids.add(value);
  }
  if (profile?.key === 'e30iq') [9, 10, 11].forEach((c) => ids.add(c));
  if (profile?.key === 'victoria') [14, 21, 22].forEach((c) => ids.add(c));
  if (profile?.kind === 'light') ids.add(11);
  return [...ids].sort((a, b) => a - b);
}

/** The value a component reports (its `reportedValue`). */
const at = (components, id) => (id === undefined ? undefined : components.get(id)?.reported);

/**
 * The readings of a device under its profile: only what the profile maps,
 * each checked (range, type); a missing or odd value is undefined.
 */
export function decode(profile, components) {
  const values = {};
  if (!profile || !components) {
    return values;
  }
  const get = (id) => at(components, id);
  if (profile.kind === 'heat_pump') {
    const l = profile.layout;
    values.running = binaryOf(get(l.on));
    values.setpoint = setpointOf(get(l.setpoint));
    values.waterTemperature = water(get(l.water[0]), l.water[1]);
    if (l.air) values.airTemperature = air(get(l.air[0]), l.air[1]);
    values.mode = modeOf(l.mode[1])(get(l.mode[0]));
  } else if (profile.kind === 'chlorinator') {
    const s = profile.sensors;
    const read = (entry, range) => entry && scaled(get(entry[0]), entry[1], range);
    values.ph = read(s.ph, { min: 1, max: 13, digits: 2, zeroIsNone: true });
    values.orp = read(s.orp, { min: 1, max: 1500, digits: 0, zeroIsNone: true });
    values.waterTemperature = read(s.temperature, { min: -5, max: 60, digits: 1 });
    values.salinity = read(s.salinity, { min: 0.01, max: 60, digits: 2, zeroIsNone: true });
    values.freeChlorine = read(s.freeChlorine, { min: 0, max: 20, digits: 2 });
    if (s.level !== undefined) values.level = percent(get(s.level));
    if (s.production !== undefined) values.production = percent(get(s.production));
  } else if (profile.key === 'e30iq') {
    values.running = binaryOf(get(9));
    values.auto = binaryOf(get(10));
    const level = numberOf(get(11));
    values.level = Number.isInteger(level) && level >= 0 && level <= 2 ? level : undefined;
  } else if (profile.key === 'victoria') {
    const state = get(14);
    values.running = state === 'RUNNING' ? 1 : state === 'NOT RUNNING' ? 0 : undefined;
    values.speedPercent = percent(get(21));
    values.power = scaled(get(22), 1, { min: 0, max: 10_000, digits: 0 });
  } else if (profile.kind === 'light') {
    values.light = binaryOf(get(11));
  }
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}

/** The E30iQ speed shown by the select: off, auto (the schedule decides), or the level. */
export function pumpSpeedOf(values) {
  if (values.running === 0) {
    return 'off';
  }
  if (values.running !== 1) {
    return undefined;
  }
  if (values.auto === 1) {
    return 'auto';
  }
  if (values.auto !== 0) {
    return undefined;
  }
  return ['low', 'medium', 'high'][values.level];
}

/** The setpoint range Gladys accepts for a heat pump: its family's, capped. */
export const setpointRange = (profile, ceiling) => {
  const r = profile.layout.range;
  return { min: r.min, max: Math.min(r.max, ceiling), step: r.step };
};
