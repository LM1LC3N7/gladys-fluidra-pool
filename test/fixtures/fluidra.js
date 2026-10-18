// -----------------------------------------------------------------------------
// A made-up Fluidra account, shaped like what foXaCe/Fluidra-pool reads
// (fluidra_api/_devices.py, _components.py) and the register maps of its
// device_registry: one pool with a tecnoLC2 chlorinator behind a bridge, an
// E30iQ pump, a Z550iQ+ heat pump, a LumiPlus light and a robot (no profile).
// -----------------------------------------------------------------------------

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const NOW = Date.UTC(2026, 6, 14, 10, 0, 0);

export const USERNAME = 'swimmer@example.com';
export const PASSWORD = 'Pool pass 42!';
export const POOL_ID = '6f1c2a10-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

export const IDS = {
  chlorinator: 'CC24047102.nn_1',
  pump: 'E30IQ24012345',
  heatPump: 'LD24001234',
  light: 'LM24005678',
  robot: 'RB24009999',
};

/** The device tree of the pool (`format=tree`): the chlorinator is behind its bridge. */
export const tree = () => [
  {
    id: 'CC24047102',
    type: 'connected',
    info: { name: 'Bridge', family: 'Bridges' },
    thingType: 'lc2',
    devices: [
      {
        id: IDS.chlorinator,
        type: 'connected',
        info: { name: 'Chlorinator', family: 'Chlorinators' },
        thingType: 'tecnoLC2',
      },
    ],
  },
  {
    id: IDS.pump,
    type: 'connected',
    info: { name: 'E30iQ', family: 'Filtration Pumps' },
    thingType: 'eppvs',
  },
  {
    id: IDS.heatPump,
    type: 'connected',
    info: { name: 'Z550iQ+', family: 'Heat Pumps' },
    thingType: 'zs500',
  },
  {
    id: IDS.light,
    type: 'connected',
    info: { name: 'LumiPlus Connect', family: 'Light Controllers' },
    thingType: 'LWM',
  },
  {
    id: IDS.robot,
    type: 'connected',
    info: { name: 'Freedom', family: 'Robot Cleaners' },
    thingType: 'N30L',
  },
];

/** The reported values of each device, by component. */
export const components = () => ({
  [IDS.chlorinator]: {
    0: IDS.chlorinator,
    8: 0,
    10: 80,
    16: 720,
    20: 700,
    154: 100,
    165: 721,
    170: 654,
    172: 260,
    174: 627,
    178: null,
  },
  [IDS.pump]: { 0: IDS.pump, 9: 1, 10: 0, 11: 1, 20: [] },
  [IDS.heatPump]: { 15: 280, 16: 0, 17: 0, 21: 1, 37: 251, 40: 194, 61: 2 },
  [IDS.light]: { 11: '0', 17: 80 },
  [IDS.robot]: { 0: 1 },
});
