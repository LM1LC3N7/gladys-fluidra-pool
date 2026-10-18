// -----------------------------------------------------------------------------
// Fluidra equipment -> Gladys devices, and their states (pure).
//
// One Gladys device per Fluidra device whose profile is known (src/fluidra.js),
// `ext:<selector>:fluidra:<cloud id>`: the id the Fluidra cloud gives the
// equipment (its serial, a bridged child "CC24047102.nn_1"). The features are
// keyed by their role (the last part of their external id): those keys are
// published forever, never rename them. A device already created keeps all its
// features when it is published again.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { GLADYS, PUMP_SPEEDS, SETPOINT_CEILING } from './constants.js';
import { pumpSpeedOf, setpointRange } from './fluidra.js';
import { DEVICE_NAMES, FEATURE_NAMES, MODE_LABELS, SPEED_LABELS, word } from './i18n.js';

const binary = { category: C.UNKNOWN, type: TYPES.SENSOR.BINARY, min: 0, max: 1 };
const temperature = (min, max) => ({
  category: C.TEMPERATURE_SENSOR,
  type: TYPES.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min,
  max,
});
// Gladys has no salinity, chlorine nor "production level" category, and the
// unknown category takes no unit: the unit is in the feature name.
const plain = (max) => ({ category: C.UNKNOWN, type: TYPES.UNKNOWN.UNKNOWN, min: 0, max });

/** The shape of each role (`range`: the setpoint range of a heat pump). */
const SHAPES = {
  running: () => binary,
  'auto-mode': () => binary,
  speed: () => ({
    category: C.TEXT,
    type: TYPES.TEXT.SELECT,
    min: 0,
    max: 0,
    read_only: false,
    has_feedback: true,
    keep_history: false,
  }),
  'speed-percent': () => plain(100),
  power: () => ({
    category: C.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: 10_000,
  }),
  'water-temperature': () => temperature(-5, 60),
  'air-temperature': () => temperature(-40, 70),
  setpoint: (range) => ({
    category: C.THERMOSTAT,
    type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
    unit: U.CELSIUS,
    min: range.min,
    max: range.max,
    read_only: false,
    has_feedback: true,
  }),
  mode: () => ({ category: C.TEXT, type: TYPES.TEXT.TEXT, min: 0, max: 0, keep_history: false }),
  ph: () => ({ category: C.PH_SENSOR, type: TYPES.PH_SENSOR.DECIMAL, unit: U.PH, min: 0, max: 14 }),
  orp: () => ({
    category: C.ORP_SENSOR,
    type: TYPES.ORP_SENSOR.DECIMAL,
    unit: U.MILLI_VOLT,
    min: 0,
    max: 2000,
  }),
  'free-chlorine': () => plain(20),
  salinity: () => plain(60),
  level: () => plain(100),
  production: () => plain(100),
  light: () => ({
    category: C.LIGHT,
    type: TYPES.LIGHT.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
  }),
};

export const ROLES = Object.keys(SHAPES);
/** The roles a command can be sent to (behind allow_commands). */
export const COMMAND_ROLES = ['speed', 'setpoint', 'light'];

/** Chlorinator readings: value key -> role. */
const READINGS = {
  waterTemperature: 'water-temperature',
  ph: 'ph',
  orp: 'orp',
  freeChlorine: 'free-chlorine',
  salinity: 'salinity',
  level: 'level',
  production: 'production',
};

export const deviceIds = (gladys, id) => gladys.externalIds('fluidra', String(id));

/** `{ id, role }` of a feature external id of this integration, undefined otherwise. */
export function parseFeatureId(gladys, featureId) {
  const prefix = gladys.externalId('fluidra:');
  if (typeof featureId !== 'string' || !featureId.startsWith(prefix)) {
    return undefined;
  }
  const rest = featureId.slice(prefix.length);
  const cut = rest.lastIndexOf(':');
  const role = rest.slice(cut + 1);
  return cut > 0 && ROLES.includes(role) ? { id: rest.slice(0, cut), role } : undefined;
}

/** "7102" from "CC24047102.nn_1": the end of the serial, for names and logs. */
export const shortId = (id) => {
  const base = String(id)
    .split('.')[0]
    .replace(/[^A-Za-z0-9]/g, '');
  return base.slice(-4) || '?';
};

/** "Électrolyseur 7102", or the name the cloud gives followed by the end of the serial. */
export function deviceName(device, language) {
  const name = device.name && !/^device\b/i.test(device.name) ? device.name : undefined;
  const label = name ?? word(DEVICE_NAMES[device.profile.kind], language);
  return `${label} ${shortId(device.id)}`.slice(0, 120);
}

/**
 * The roles of one device: those of its profile (for a chlorinator, those
 * seen with a value: an absent probe reads nothing), plus those of the
 * device already created in Gladys (`created`), so a republished device
 * never loses a feature.
 */
export function rolesOf(device, created = new Set()) {
  const roles = new Set();
  const { profile } = device;
  if (profile.kind === 'heat_pump') {
    roles.add('running').add('water-temperature').add('setpoint').add('mode');
    if (profile.layout.air) {
      roles.add('air-temperature');
    }
  } else if (profile.kind === 'chlorinator') {
    for (const key of device.seen ?? []) {
      if (READINGS[key]) {
        roles.add(READINGS[key]);
      }
    }
  } else if (profile.key === 'e30iq') {
    roles.add('running').add('auto-mode').add('speed');
  } else if (profile.key === 'victoria') {
    roles.add('running').add('speed-percent').add('power');
  } else if (profile.kind === 'light') {
    roles.add('light');
  }
  for (const role of created) {
    if (ROLES.includes(role)) {
      roles.add(role);
    }
  }
  return ROLES.filter((role) => roles.has(role));
}

const speedOptions = (language) =>
  PUMP_SPEEDS.map((value, i) => ({
    value,
    label: word(SPEED_LABELS[value], language),
    sort_order: i,
  }));

/** The Gladys device of one Fluidra device. `created`: the roles of the device already in Gladys. */
export function buildDevice(gladys, device, language, created) {
  const ids = deviceIds(gladys, device.id);
  const range =
    device.profile.kind === 'heat_pump'
      ? setpointRange(device.profile, SETPOINT_CEILING)
      : { min: 0, max: 0 };
  return {
    name: deviceName(device, language),
    external_id: ids.device,
    features: rolesOf(device, created).map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...SHAPES[role](range),
      ...(role === 'speed' ? { supported_options: speedOptions(language) } : {}),
    })),
    params: [
      { name: 'cloud_id', value: device.id },
      { name: 'profile', value: device.profile.key },
    ],
  };
}

/** The Gladys states of one device: `[{ role, state }]` or `[{ role, text }]`. */
export function statesOf(device, language) {
  const v = device.values ?? {};
  const states = [];
  const add = (role, state) => {
    if (state !== undefined) {
      states.push({ role, state });
    }
  };
  const { profile } = device;
  if (profile.kind === 'heat_pump') {
    add('running', v.running);
    add('water-temperature', v.waterTemperature);
    add('air-temperature', v.airTemperature);
    add('setpoint', v.setpoint);
    if (v.mode !== undefined) {
      states.push({ role: 'mode', text: word(MODE_LABELS[v.mode], language) });
    }
  } else if (profile.kind === 'chlorinator') {
    for (const [key, role] of Object.entries(READINGS)) {
      add(role, v[key]);
    }
  } else if (profile.key === 'e30iq') {
    add('running', v.running);
    add('auto-mode', v.auto);
    const speed = pumpSpeedOf(v);
    if (speed !== undefined) {
      states.push({ role: 'speed', text: speed });
    }
  } else if (profile.key === 'victoria') {
    add('running', v.running);
    add('speed-percent', v.speedPercent);
    add('power', v.power);
  } else if (profile.kind === 'light') {
    add('light', v.light === undefined ? undefined : v.light ? GLADYS.ON : GLADYS.OFF);
  }
  return states;
}
