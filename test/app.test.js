// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, a fake Cognito and a fake Fluidra API behind the transport. Timers
// and Date are mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FluidraApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS, API } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { FluidraError } from '../src/http.js';
import { HOUR, MINUTE, NOW, PASSWORD, SECOND, USERNAME } from './fixtures/fluidra.js';
import {
  API_URL,
  COGNITO_URL,
  IDS,
  fakeFluidra,
  memoryStore,
  settle,
  to,
} from './helpers/fakeFluidra.js';

const CONFIG = { username: USERNAME, password: PASSWORD };
const ALLOW = { ...CONFIG, allow_commands: true };
const dev = (id) => `ext:test-integration:fluidra:${id}`;

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  { config = CONFIG, store = memoryStore(), server = fakeFluidra(), create = true, logs = [] } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new FluidraApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
    cognitoUrl: COGNITO_URL,
    apiUrl: API_URL,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
    await settle();
  }
  return { gladys, app, server, store, advance, logs };
}

const deviceOf = (gladys, id) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === dev(id));
const featureOf = (gladys, id, role) =>
  deviceOf(gladys, id).features.find((f) => f.external_id === `${dev(id)}:${role}`);
const roles = (gladys, id) =>
  deviceOf(gladys, id).features.map((f) => f.external_id.split(':').pop());
const set = (gladys, id, role, value) =>
  gladys.fake.setValue(deviceOf(gladys, id), featureOf(gladys, id, role), value);
const last = (gladys, id, role) => gladys.fake.lastState(`${dev(id)}:${role}`);
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const badgeOf = (gladys, id) =>
  gladys.fake.transports.filter((b) => b.device_external_id === dev(id)).at(-1);

function assertNoSecret(where, text, server) {
  for (const secret of [PASSWORD, USERNAME, ...server.secrets]) {
    assert.ok(!text.includes(secret), `${where} holds a secret`);
  }
}

/** Holds the next request matching `match` until `release()`. */
function hold(server, match) {
  const gate = {};
  gate.done = new Promise((resolve) => (gate.release = resolve));
  server.queue.push({ match, before: () => gate.done });
  return gate;
}

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { username: '', password: '' } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /e-mail et le mot de passe de votre compte Fluidra/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /e-mail and the password/);
});

test('start: one sign-in, pools, the tree, one bulk read per supported device', async (t) => {
  const { gladys, server, store, logs } = await setup(t);
  assert.deepEqual(
    server.requests.map((r) => r.flow ?? `${r.method} ${r.path}`),
    [
      'USER_PASSWORD_AUTH',
      'GET /generic/users/me/pools',
      'GET /generic/devices',
      `GET /generic/devices/${IDS.chlorinator}/components`,
      `GET /generic/devices/${IDS.pump}/components`,
      `GET /generic/devices/${IDS.heatPump}/components`,
      `GET /generic/devices/${IDS.light}/components`,
    ],
    'the robot (no profile) is never read',
  );
  const [read] = server.api();
  assert.ok(server.access.has(read.headers.Authorization.replace('Bearer ', '')));
  assert.equal(read.headers['User-Agent'], API.userAgent, 'an honest User-Agent');
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to Fluidra: 4 devices read. Open Discovery to add them. 1 other device is not supported yet (see the documentation).',
      fr: "Connecté à Fluidra : 4 appareils lus. Ouvrez Découverte pour les ajouter. 1 autre appareil n'est pas encore pris en charge (voir la documentation).",
    },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 4);
  assert.equal(deviceOf(gladys, IDS.chlorinator).name, 'Chlorinator 7102');
  assert.deepEqual(roles(gladys, IDS.chlorinator), [
    'water-temperature',
    'ph',
    'orp',
    'salinity',
    'level',
    'production',
  ]);
  assert.deepEqual(roles(gladys, IDS.pump), ['running', 'auto-mode', 'speed']);
  assert.deepEqual(roles(gladys, IDS.heatPump), [
    'running',
    'water-temperature',
    'air-temperature',
    'setpoint',
    'mode',
  ]);
  assert.deepEqual(roles(gladys, IDS.light), ['light']);

  assert.equal(last(gladys, IDS.chlorinator, 'ph'), 7.21);
  assert.equal(last(gladys, IDS.chlorinator, 'orp'), 654);
  assert.equal(last(gladys, IDS.chlorinator, 'water-temperature'), 26);
  assert.equal(last(gladys, IDS.chlorinator, 'salinity'), 6.27);
  assert.equal(last(gladys, IDS.chlorinator, 'level'), 80);
  assert.equal(last(gladys, IDS.chlorinator, 'production'), 100);
  assert.equal(last(gladys, IDS.pump, 'running'), 1);
  assert.equal(last(gladys, IDS.pump, 'auto-mode'), 0);
  assert.equal(last(gladys, IDS.pump, 'speed'), 'medium');
  assert.equal(last(gladys, IDS.heatPump, 'setpoint'), 28);
  assert.equal(last(gladys, IDS.heatPump, 'water-temperature'), 25.1);
  assert.equal(last(gladys, IDS.heatPump, 'air-temperature'), 19.4);
  assert.equal(last(gladys, IDS.heatPump, 'mode'), 'Chauffage');
  assert.equal(last(gladys, IDS.light, 'light'), 0);
  assert.equal(badgeOf(gladys, IDS.pump).transport, 'cloud');

  const setpoint = featureOf(gladys, IDS.heatPump, 'setpoint');
  assert.deepEqual([setpoint.min, setpoint.max, setpoint.read_only], [15, 35, false]);
  const speed = featureOf(gladys, IDS.pump, 'speed');
  assert.deepEqual(
    speed.supported_options.map((o) => o.value),
    ['off', 'low', 'medium', 'high', 'auto'],
  );
  for (const device of gladys.fake.discoveredDevices) {
    for (const feature of device.features) {
      assert.notEqual(feature.category, 'switch', 'no switch an "everything off" could reach');
      if (!feature.read_only) {
        assert.ok(['speed', 'setpoint', 'light'].includes(feature.external_id.split(':').pop()));
      }
    }
  }

  assertNoSecret('the devices', JSON.stringify(gladys.fake.discoveredDevices), server);
  assertNoSecret('the logs', logs.join('\n'), server);
  for (const id of Object.values(IDS)) {
    assert.ok(!logs.join('\n').includes(id), 'no whole serial in the logs');
  }
  const kept = JSON.stringify(store.data);
  assert.ok(!kept.includes(PASSWORD) && !kept.includes(USERNAME), 'no credentials in /data');
  assert.equal(store.data.account, accountKey(USERNAME));
  assert.ok(store.data.tokens.refreshToken.startsWith('refresh-'));
});

test('a probe that reads 0 or nothing gives no feature; a created feature is never lost', async (t) => {
  const server = fakeFluidra();
  server.set(IDS.chlorinator, 170, 0);
  server.set(IDS.chlorinator, 174, null);
  const { gladys, app } = await setup(t, { server, create: false });
  assert.deepEqual(roles(gladys, IDS.chlorinator), [
    'water-temperature',
    'ph',
    'level',
    'production',
  ]);
  // The device was created earlier with an ORP feature: it keeps it.
  const created = structuredClone(deviceOf(gladys, IDS.chlorinator));
  created.features.push({ ...created.features[1], external_id: `${dev(IDS.chlorinator)}:orp` });
  await gladys.fake.deviceCreated(created);
  app.published = undefined;
  await app.publishDevices();
  assert.ok(roles(gladys, IDS.chlorinator).includes('orp'));
});

test('a restart reuses the tokens kept in /data: no new sign-in', async (t) => {
  const store = memoryStore();
  const server = fakeFluidra();
  const first = await setup(t, { store, server });
  first.app.stop();
  const gladys = createFakeGladys({ config: CONFIG });
  const app = new FluidraApp({
    gladys,
    logger: recorder([]),
    transport: server.transport,
    store,
    cognitoUrl: COGNITO_URL,
    apiUrl: API_URL,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  assert.equal(server.signIns().length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the token is renewed by a timer before it expires, never by a new sign-in', async (t) => {
  const { server, advance } = await setup(t);
  await advance(HOUR, MINUTE);
  assert.equal(server.signIns().length, 1);
  assert.ok(server.refreshes().length >= 1);
});

test('a 401 on the account renews once and retries; refused again: a spaced stop', async (t) => {
  const { gladys, server, app, store } = await setup(t);
  server.queue.push({ match: to.pools, status: 401, body: {} });
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true, 'renewed and read');
  server.queue.push({ match: to.pools, status: 401, body: {} });
  server.queue.push({ match: to.pools, status: 401, body: {} });
  await app.tick();
  assert.equal(app.blocked, 'session_refused');
  assert.equal(store.data.block.kind, 'session_refused');
  assert.match(message(gladys).fr, /de nouveau refusé la session/);
});

test('refused credentials stop the integration; one new try after 1 h, not before', async (t) => {
  const server = fakeFluidra();
  server.password = 'another';
  const { gladys, advance, store } = await setup(t, { server });
  assert.match(message(gladys).fr, /refusé l'e-mail ou le mot de passe/);
  assert.equal(store.data.block.kind, 'refused');
  await advance(50 * MINUTE, MINUTE);
  assert.equal(server.signIns().length, 1);
  await advance(15 * MINUTE, MINUTE);
  assert.equal(server.signIns().length, 2);
});

test('a verification code asked: a stop, never retried by itself nor by a reconnection', async (t) => {
  const server = fakeFluidra({ challenge: 'SMS_MFA' });
  const { gladys, advance, app } = await setup(t, { server });
  assert.equal(app.blocked, 'two_factor');
  assert.match(message(gladys).fr, /code de vérification/);
  await advance(30 * HOUR, HOUR);
  await app.connected(CONFIG);
  assert.equal(server.signIns().length, 1, 'each sign-in could send a code');
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /code de vérification/);
  assert.equal(server.signIns().length, 2, 'the button tries once');
});

test('a 429: a pause of Retry-After for every path, kept across a restart and a reconnection', async (t) => {
  const store = memoryStore();
  const { gladys, server, app } = await setup(t, { store, config: ALLOW });
  server.queue.push({ match: to.pools, status: 429, body: {}, headers: { 'retry-after': '900' } });
  await app.tick();
  assert.equal(store.data.pause.kind, 'rate');
  assert.match(message(gladys).fr, /ralentir : pause de 15 min/);
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /pendant la pause/);
  await app.connected(ALLOW);
  const before = server.api().length;
  await app.tick();
  assert.equal(server.api().length, before, 'no read during the pause');
  const restarted = new FluidraApp({
    gladys,
    logger: recorder([]),
    transport: server.transport,
    store,
    cognitoUrl: COGNITO_URL,
    apiUrl: API_URL,
  });
  t.after(() => restarted.stop());
  app.stop();
  await restarted.start(ALLOW);
  assert.equal(server.api().length, before, 'the pause holds after a restart');
});

test('errors are never read again faster than the interval', async (t) => {
  const { server, app, advance } = await setup(t);
  server.down = true;
  await app.tick();
  const after = server.requests.length;
  await advance(55 * SECOND, SECOND);
  assert.equal(server.requests.length, after);
});

test('one device that fails is marked alone; the others are read', async (t) => {
  const { gladys, server, app } = await setup(t);
  server.queue.push({ match: to.bulk(IDS.pump), status: 503, body: {} });
  server.set(IDS.heatPump, 15, 290);
  await app.tick();
  assert.equal(last(gladys, IDS.heatPump, 'setpoint'), 29);
  assert.equal(badgeOf(gladys, IDS.pump).transport, 'unreachable');
  assert.equal(badgeOf(gladys, IDS.pump).degraded, true);
  assert.equal(badgeOf(gladys, IDS.heatPump).transport, 'cloud');
  assert.match(message(gladys).fr, /1 n'a pas pu être lu/);
});

test('the tree of the only pool failing: "unreachable", values kept, a backoff', async (t) => {
  const { gladys, server, app } = await setup(t);
  server.queue.push({ match: to.tree, status: 502, body: {} });
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /Fluidra est injoignable \(Fluidra indisponible, HTTP 502\)/);
  assert.equal(badgeOf(gladys, IDS.pump).transport, 'unreachable');
  assert.equal(app.pauseKind, 'backoff');
  assert.equal(last(gladys, IDS.pump, 'speed'), 'medium');
});

test('a device the cloud says disconnected twice gets a degraded badge', async (t) => {
  const { gladys, server, app } = await setup(t);
  server.tree[1].type = 'disconnected';
  await app.tick();
  assert.equal(badgeOf(gladys, IDS.pump).transport, 'cloud', 'one report is not enough');
  await app.tick();
  assert.equal(badgeOf(gladys, IDS.pump).degraded, true);
});

test('without the bulk call, the components are read one by one', async (t) => {
  const server = fakeFluidra({ bulk: false });
  const { gladys } = await setup(t, { server });
  assert.equal(gladys.fake.discoveredDevices.length, 4);
  assert.equal(last(gladys, IDS.chlorinator, 'ph'), 7.21);
  assert.equal(last(gladys, IDS.heatPump, 'setpoint'), 28);
  assert.equal(last(gladys, IDS.pump, 'speed'), 'medium');
});

test('the status and the Discovery list are sent again at each reconnection', async (t) => {
  const { gladys, app, server } = await setup(t);
  server.queue.push({ match: to.pools, status: 429, body: {}, headers: { 'retry-after': '3600' } });
  await app.tick();
  const statuses = gladys.fake.connectionStatuses.length;
  const published = [];
  const publish = gladys.publishDiscoveredDevices.bind(gladys);
  gladys.publishDiscoveredDevices = async (devices) => {
    published.push(devices.length);
    return publish(devices);
  };
  await app.connected(CONFIG);
  assert.ok(gladys.fake.connectionStatuses.length > statuses);
  assert.deepEqual(published, [4]);
  assert.ok(app.hardPaused, 'the 429 pause holds');
});

// --- Commands ------------------------------------------------------------------

test('commands are off by default: refused, nothing read nor sent', async (t) => {
  const { gladys, server } = await setup(t);
  const before = server.api().length;
  for (const [id, role, value] of [
    [IDS.light, 'light', 1],
    [IDS.heatPump, 'setpoint', 30],
    [IDS.pump, 'speed', 'high'],
  ]) {
    const ack = await set(gladys, id, role, value);
    assert.equal(ack.success, false);
    assert.match(ack.error, /commandes depuis Gladys sont désactivées/);
  }
  assert.equal(server.api().length, before);
  assert.deepEqual(server.writes(), []);
});

test('the light: a fresh read, then "1" on component 11', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  const before = server.api().length;
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.api().length, before + 2, 'one read, one write');
  assert.deepEqual(server.writes(), [{ id: IDS.light, component: 11, desiredValue: '1' }]);
  // Already on: nothing sent.
  const again = await set(gladys, IDS.light, 'light', 1);
  assert.equal(again.success, true);
  assert.equal(server.writes().length, 1);
  const bad = await set(gladys, IDS.light, 'light', 2);
  assert.equal(bad.success, false);
});

test('the heat pump setpoint: checked strictly, capped at 35 °C, ×10 on its component', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  for (const value of [36, 29.5, null, '', true, 14]) {
    const ack = await set(gladys, IDS.heatPump, 'setpoint', value);
    assert.equal(ack.success, false, String(value));
    assert.match(ack.error, /Consigne inattendue/);
  }
  assert.deepEqual(server.writes(), []);
  const ack = await set(gladys, IDS.heatPump, 'setpoint', '30');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.writes(), [{ id: IDS.heatPump, component: 15, desiredValue: 300 }]);
});

test('the pump speed: a level on a running pump, a stop, a start then a level', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  assert.equal((await set(gladys, IDS.pump, 'speed', 'high')).success, true);
  assert.equal((await set(gladys, IDS.pump, 'speed', 'off')).success, true);
  const start = await set(gladys, IDS.pump, 'speed', 'low');
  assert.equal(start.success, true, start.error);
  assert.deepEqual(
    server.writes().map((w) => [w.component, w.desiredValue]),
    [
      [11, 2],
      [9, 0],
      [9, 1],
      [11, 0],
    ],
  );
  const auto = await set(gladys, IDS.pump, 'speed', 'auto');
  assert.equal(auto.success, false);
  assert.match(auto.error, /mode automatique se règle/);
});

test('the pump speed is refused while the schedule drives the pump', async (t) => {
  const server = fakeFluidra();
  const { gladys, app } = await setup(t, { server, config: ALLOW });
  server.set(IDS.pump, 10, 1);
  const ack = await set(gladys, IDS.pump, 'speed', 'high');
  assert.equal(ack.success, false);
  assert.match(ack.error, /suit sa programmation/);
  assert.deepEqual(server.writes(), []);
  assert.equal(last(gladys, IDS.pump, 'speed'), 'auto', 'the fresh read was published');
  assert.ok(app);
});

test('a command decides on a fresh read, never on memory', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  // Turned on from the app since the last read: the fresh read says so.
  server.set(IDS.light, 11, '1');
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, true);
  assert.deepEqual(server.writes(), [], 'already on');
  server.queue.push({ match: to.bulk(IDS.light), status: 503, body: {} });
  const failed = await set(gladys, IDS.light, 'light', 0);
  assert.equal(failed.success, false);
  assert.match(failed.error, /n'a pas pu être relu/);
  server.set(IDS.light, 11, null);
  const unknown = await set(gladys, IDS.light, 'light', 0);
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /n'a pas donné la valeur/);
  assert.deepEqual(server.writes(), []);
});

test('the option is checked again right before sending', async (t) => {
  const { gladys, server, app } = await setup(t, { config: ALLOW });
  server.queue.push({ match: to.bulk(IDS.light), before: () => app.configUpdated(CONFIG) });
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /désactivées/);
  assert.deepEqual(server.writes(), []);
});

test('a command that cannot be sent within 3.5 s is refused, nothing sent', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  server.queue.push({ match: to.bulk(IDS.light), before: () => t.mock.timers.tick(3_600) });
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /trop tard/);
  assert.deepEqual(server.writes(), []);
});

test('a write without an answer is "sent, without confirmation", then read again', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: ALLOW });
  server.queue.push({ match: to.write, throws: new FluidraError('timeout', 'no answer') });
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Commande envoyée, sans confirmation de Fluidra/);
  const reads = server.api().length;
  await advance(6 * SECOND, SECOND);
  assert.ok(server.api().length > reads, 'a follow-up read');
});

test('a write refused by Fluidra says so', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  server.queue.push({ match: to.write, status: 403, body: {} });
  const ack = await set(gladys, IDS.heatPump, 'setpoint', 30);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Fluidra a refusé la commande \(refusé, HTTP 403\)/);
});

test('a pump start whose speed cannot follow says the pump was started', async (t) => {
  const server = fakeFluidra();
  const { gladys } = await setup(t, { server, config: ALLOW });
  server.set(IDS.pump, 9, 0);
  server.queue.push({
    match: (r) => to.write(r) && r.path.endsWith('/11'),
    throws: new FluidraError('timeout', 'no answer'),
  });
  const ack = await set(gladys, IDS.pump, 'speed', 'high');
  assert.equal(ack.success, false);
  assert.match(
    ack.error,
    /La pompe a été démarrée ; sa vitesse : Commande envoyée, sans confirmation/,
  );
  assert.equal(server.components[IDS.pump][9], 1);
});

test('the commands of one device run one at a time', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  const gate = hold(server, to.bulk(IDS.light));
  const first = set(gladys, IDS.light, 'light', 1);
  await settle();
  const second = set(gladys, IDS.light, 'light', 0);
  await settle();
  assert.equal(server.writes().length, 0);
  gate.release();
  assert.equal((await first).success, true);
  assert.equal((await second).success, true);
  assert.deepEqual(
    server.writes().map((w) => w.desiredValue),
    ['1', '0'],
  );
});

test('a command with a token about to expire is refused and the token renewed', async (t) => {
  const { gladys, server, app } = await setup(t, { config: ALLOW });
  app.client.tokens = { ...app.client.tokens, expiresAt: Date.now() + 30 * SECOND };
  const refreshes = server.refreshes().length;
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /renouvellement/);
  await settle();
  assert.equal(server.refreshes().length, refreshes + 1);
  assert.deepEqual(server.writes(), []);
});

test('the ack never waits for Gladys: a failing publication does not fail the command', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  gladys.publishChangedStates = async () => {
    throw new Error('Gladys is restarting');
  };
  const ack = await set(gladys, IDS.light, 'light', 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.writes().length, 1);
});
