// -----------------------------------------------------------------------------
// The hostile scenarios of the milestone 1 review (H1-H13, B1, I1-I3, M2-M12),
// turned into regression tests: the same fake Gladys, Cognito and Fluidra API
// as test/app.test.js.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FluidraApp } from '../src/app.js';
import { ACTIONS } from '../src/constants.js';
import { classify, decode, identify, writable } from '../src/fluidra.js';
import { registerHandlers } from '../src/handlers.js';
import { FluidraError } from '../src/http.js';
import { normalizeMemory } from '../src/store.js';
import { MINUTE, NOW, PASSWORD, SECOND, USERNAME } from './fixtures/fluidra.js';
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
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

async function setup(t, { config = CONFIG, store = memoryStore(), server = fakeFluidra() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new FluidraApp({
    gladys,
    logger: quiet,
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
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await settle();
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  return { gladys, app, server, store, advance };
}

const deviceOf = (gladys, id) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === dev(id));
const profileParam = (gladys, id) =>
  deviceOf(gladys, id)?.params.find((p) => p.name === 'profile')?.value;
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const badgeOf = (gladys, id) =>
  gladys.fake.transports.filter((b) => b.device_external_id === dev(id)).at(-1);

/** A command on a feature id, whether Gladys shows that feature or not. */
async function command(gladys, id, role, value) {
  try {
    return await gladys.fake.setValue(
      deviceOf(gladys, id) ?? { external_id: dev(id), features: [] },
      { external_id: `${dev(id)}:${role}` },
      value,
    );
  } catch (err) {
    return { success: false, error: err.message };
  }
}

const writesTo = (server, id) => server.writes().filter((w) => w.id === id);

// --- B1: identification -------------------------------------------------------

test('H1 an nhpp "Eco Elyo R290" is not taken for an LG: no profile, nothing written', async (t) => {
  const server = fakeFluidra();
  const id = 'NH25001234';
  server.tree.push({
    id,
    type: 'connected',
    info: { name: 'Eco Elyo R290', family: 'Heat Pumps' },
    thingType: 'nhpp',
  });
  server.components[id] = { 7: 'NHPPX', 10: 1, 12: 270, 13: 275, 14: 0, 15: 300, 44: 180 };
  const { gladys } = await setup(t, { server, config: ALLOW });
  assert.equal(profileParam(gladys, id), undefined, 'never read under the LG layout');
  const ack = await command(gladys, id, 'setpoint', 32);
  assert.equal(ack.success, false);
  assert.deepEqual(writesTo(server, id), []);
});

test('H2 a PX50 Pro Elyo (proelyo) stays unsupported: no profile, nothing written', async (t) => {
  const server = fakeFluidra();
  const id = 'QS23361258.nn_9';
  server.tree.push({
    id,
    type: 'connected',
    info: { name: 'PX50 Pro Elyo', family: 'Heat Pumps' },
    thingType: 'proelyo',
  });
  server.components[id] = { 13: 1, 15: 260, 19: 251 };
  const { gladys } = await setup(t, { server, config: ALLOW });
  assert.equal(profileParam(gladys, id), undefined);
  assert.equal((await command(gladys, id, 'setpoint', 30)).success, false);
  assert.deepEqual(writesTo(server, id), []);
});

test('H3 a tecnoLC2 chlorinator named "Sel eco" stays a chlorinator: the family before the name', () => {
  const entry = {
    id: 'CC25999999.nn_1',
    name: 'Sel eco',
    family: 'Chlorinators',
    thingType: 'tecnoLC2',
  };
  assert.equal(classify(entry.family, entry.name), 'chlorinator');
  assert.equal(identify(entry)?.key, 'tecnolc2');
  // Without a family id either, the family label still rules the LG profile out.
  const unknown = { ...entry, thingType: '' };
  assert.notEqual(identify(unknown)?.kind, 'heat_pump');
});

test('H4 a Victoria (mppvs) with an LE* serial is a Victoria (read only), never an E30iQ', async (t) => {
  const server = fakeFluidra();
  const id = 'LE25000001';
  server.tree.push({
    id,
    type: 'connected',
    info: { name: 'Victoria Smart Connect VS', family: 'Filtration Pumps' },
    thingType: 'mppvs',
  });
  server.components[id] = { 9: 0, 10: 0, 11: 0, 14: 'RUNNING', 21: 75, 22: 600 };
  const { gladys } = await setup(t, { server, config: ALLOW });
  assert.equal(profileParam(gladys, id), 'victoria');
  assert.equal((await command(gladys, id, 'speed', 'high')).success, false);
  assert.deepEqual(writesTo(server, id), []);
});

test('B1 a name, a model or a family alone shows the values but never unlocks a command', async (t) => {
  const server = fakeFluidra();
  const id = 'XX24000001';
  server.tree.push({
    id,
    type: 'connected',
    info: { name: 'Z550iQ+', family: 'Heat Pumps' },
  });
  server.components[id] = { 15: 280, 16: 0, 21: 1, 37: 251, 40: 194 };
  const { gladys } = await setup(t, { server, config: ALLOW });
  assert.equal(profileParam(gladys, id), 'z550iq', 'identified by its name: read');
  const ack = await command(gladys, id, 'setpoint', 30);
  assert.equal(ack.success, false);
  assert.match(ack.error, /reconnu que par son nom ou sa famille/);
  assert.deepEqual(writesTo(server, id), []);
  // The fixture heat pump (LD* serial, thingType zs500) still takes it.
  assert.equal((await command(gladys, IDS.heatPump, 'setpoint', 30)).success, true);
});

test('B1 writable(): a strong signal of the profile itself, nothing contradicting it', () => {
  const lg = { id: 'LG2400', name: 'Heat pump', family: 'Heat Pumps', thingType: '' };
  const lgProfile = identify(lg);
  assert.equal(lgProfile.key, 'lg-eco-elyo');
  assert.equal(writable(lgProfile, lg), true, 'its LG serial');
  assert.equal(writable(lgProfile, { ...lg, thingType: 'amt' }), true);
  assert.equal(
    writable(lgProfile, { ...lg, thingType: 'nhpp' }),
    false,
    'a contradicting thingType',
  );
  assert.equal(
    writable(lgProfile, { ...lg, family: 'Chlorinators' }),
    false,
    'a contradicting family',
  );
  const named = { id: 'X1', name: 'Eco Elyo', family: 'Heat Pumps', thingType: '' };
  assert.equal(identify(named)?.key, 'lg-eco-elyo');
  assert.equal(writable(identify(named), named), false, 'a name alone');
  const signed = new Map([[7, { reported: 'BXWAA' }]]);
  assert.equal(writable(identify(named, signed), named, signed), true, 'its c7 signature');
  // HPGIC: its LG serial or its CXWAB signature; never its name alone.
  const hpgic = { id: 'XY1', name: 'HPGIC 9', family: '', thingType: '' };
  assert.equal(identify(hpgic)?.key, 'hpgic');
  assert.equal(writable(identify(hpgic), hpgic), false);
  assert.equal(writable(identify(hpgic), { ...hpgic, id: 'LG25363734' }), true);
  // LumiPlus: LWM or its name, never the light family alone.
  assert.equal(
    identify({ id: 'A1', name: 'Pool light', family: 'Lights', thingType: '' }),
    undefined,
  );
  const lumi = { id: 'A1', name: 'LumiPlus Connect', family: 'Lights', thingType: '' };
  assert.equal(writable(identify(lumi), lumi), true);
  assert.equal(
    identify({ ...lumi, thingType: 'RGBW2' }),
    undefined,
    'a known thingType other than LWM',
  );
  // The other families: their thingType or nothing.
  for (const [entry, key] of [
    [{ id: 'ZB1', name: '', family: 'Heat Pumps', thingType: 'zs500' }, 'z550iq'],
    [{ id: 'LD1', name: '', family: 'Heat Pumps', thingType: 'hpc' }, 'z350iq'],
    // An E30* serial with the Victoria family id is a Victoria (read only).
    [{ id: 'E30IQ1', name: '', family: 'Filtration Pumps', thingType: 'mppvs' }, 'victoria'],
  ]) {
    assert.equal(identify(entry)?.key, key, JSON.stringify(entry));
  }
  // A Chlorinators entry is never a heat pump, whatever its serial or name.
  assert.equal(
    identify({ id: 'LG2401', name: 'Eco', family: 'Chlorinators', thingType: '' }),
    undefined,
  );
});

// --- I1: disconnected ---------------------------------------------------------

test('H5 a device the last tree says disconnected gets no command, with a message of its own', async (t) => {
  const { gladys, server, app } = await setup(t, { config: ALLOW });
  server.tree[1].type = 'disconnected';
  await app.tick();
  const before = server.api().length;
  const ack = await command(gladys, IDS.pump, 'speed', 'high');
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'est pas connecté : commande refusée \(rien n'a été envoyé\)/);
  assert.equal(server.api().length, before, 'not even read');
  assert.deepEqual(server.writes(), []);
  server.tree[1].type = 'connected';
  await app.tick();
  assert.equal((await command(gladys, IDS.pump, 'speed', 'high')).success, true);
});

test('M9 a bridged child "disconnected" with a moving ts is live; without it, degraded', async (t) => {
  const { gladys, server, app } = await setup(t);
  server.tree[0].devices[0].type = 'disconnected';
  for (let i = 0; i < 3; i += 1) {
    server.ts += 60;
    await app.tick();
  }
  assert.equal(badgeOf(gladys, IDS.chlorinator).transport, 'cloud', 'fresh data each read');
  await app.tick();
  await app.tick();
  assert.equal(badgeOf(gladys, IDS.chlorinator).degraded, true, 'the ts stopped');
  // A device that is not bridged is not corroborated by its ts.
  server.tree[1].type = 'disconnected';
  server.ts += 60;
  await app.tick();
  server.ts += 60;
  await app.tick();
  assert.equal(badgeOf(gladys, IDS.pump).degraded, true);
});

// --- I2: backoff kept ---------------------------------------------------------

test('H10 a 5xx backoff is kept in /data: a restart does not read at once', async (t) => {
  const store = memoryStore();
  const { gladys, server, app, advance } = await setup(t, { store, config: ALLOW });
  server.queue.push({ match: to.pools, status: 503, body: {} });
  await app.tick();
  assert.equal(app.pauseKind, 'backoff');
  assert.equal(store.data.pause.kind, 'backoff');
  assert.equal(store.data.pause.failures, 1);
  // It holds the reads only: a command still goes.
  assert.equal((await command(gladys, IDS.light, 'light', 1)).success, true);
  const before = server.api().length;
  const restarted = new FluidraApp({
    gladys,
    logger: quiet,
    transport: server.transport,
    now: () => Date.now(),
    store,
    cognitoUrl: COGNITO_URL,
    apiUrl: API_URL,
  });
  t.after(() => restarted.stop());
  app.stop();
  await restarted.start(ALLOW);
  assert.equal(server.api().length, before, 'no read inside the backoff');
  assert.match(message(gladys).fr, /injoignable aux derniers essais/);
  await advance(2 * MINUTE, 10 * SECOND);
  assert.ok(server.api().length > before, 'read once the backoff is over');
  assert.equal(store.data.pause, null);
});

test('I2 a backoff read back from /data is capped at 15 minutes', () => {
  const memory = normalizeMemory(
    { account: 'a', pause: { kind: 'backoff', until: NOW + 10 * 3_600_000, failures: 99 } },
    NOW,
  );
  assert.deepEqual(memory.pause, {
    kind: 'backoff',
    source: 'api',
    until: NOW + 15 * MINUTE,
    failures: 10,
  });
});

// --- I3: 403 on the account ---------------------------------------------------

test('I3 403s in a row with a fresh token: "possible filtering", one renewal per try, no loop', async (t) => {
  const store = memoryStore();
  const { gladys, server, app, advance } = await setup(t, { store });
  const refreshes = server.refreshes().length;
  const refuse = () => {
    server.queue.push({ match: to.pools, status: 403, body: {} });
    server.queue.push({ match: to.pools, status: 403, body: {} });
  };
  refuse();
  await app.tick();
  assert.match(message(gladys).fr, /refuse les requêtes \(HTTP 403\) : pause de 30 min/);
  for (let i = 0; i < 2; i += 1) {
    refuse();
    await advance(31 * MINUTE, MINUTE);
  }
  assert.equal(store.data.forbidden, 3);
  assert.match(message(gladys).fr, /filtrage possible de ce client par Fluidra/);
  assert.match(message(gladys).en, /does not pretend to be the app/);
  assert.equal(server.signIns().length, 1, 'never a new sign-in');
  assert.ok(server.refreshes().length - refreshes <= 5, 'one renewal per try (and the timer)');
  assert.ok(app.hardPaused, 'the 30-minute pause holds');
  await advance(31 * MINUTE, MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.forbidden, 0, 'a good read resets the count');
});

// --- M2: token margin ---------------------------------------------------------

test('H9 a 5-minute token is renewed a tenth of its life before its end, not before each request', async (t) => {
  const server = fakeFluidra({ lifetime: 5 * MINUTE });
  const { app, advance } = await setup(t, { server });
  const before = server.refreshes().length;
  await app.tick();
  assert.equal(server.refreshes().length, before, 'no renewal inside a cycle');
  await advance(10 * MINUTE, 10 * SECOND);
  const renewed = server.refreshes().length - before;
  assert.ok(renewed >= 1 && renewed <= 3, `renewals in 10 min: ${renewed}`);
  assert.equal(server.signIns().length, 1);
  assert.equal(app.client.margin, 30 * SECOND);
});

// --- M4, M12: saving the configuration ----------------------------------------

test('H12 saving the same credentials after a refusal does not retry, and the status says so', async (t) => {
  const server = fakeFluidra();
  server.password = 'changed in the app';
  const { gladys, app } = await setup(t, { server });
  assert.equal(app.blocked, 'refused');
  assert.match(message(gladys).fr, /enregistrer un e-mail ou un mot de passe modifié/);
  const signIns = server.signIns().length;
  await app.configUpdated(CONFIG);
  await settle();
  assert.equal(server.signIns().length, signIns);
});

test('M12 a code-asked stop stays with the account: emptied, then saved again, no sign-in', async (t) => {
  const store = memoryStore();
  const server = fakeFluidra({ challenge: 'SMS_MFA' });
  const { gladys, app } = await setup(t, { server, store });
  assert.equal(app.blocked, 'two_factor');
  await app.configUpdated({ username: '', password: '' });
  assert.equal(store.data.block.kind, 'two_factor', '/data is left as it is');
  await app.configUpdated(CONFIG);
  await app.configUpdated({ ...CONFIG, password: 'another one' });
  await settle();
  assert.equal(server.signIns().length, 1, 'no code sent again');
  assert.equal(app.blocked, 'two_factor');
  assert.match(message(gladys).fr, /code de vérification/);
  await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(server.signIns().length, 2, 'only the button tries');
});

// --- M5: follow-up reads --------------------------------------------------------

test('H13 a new command replaces the follow-up reads of the previous one', async (t) => {
  const { gladys, server, app } = await setup(t, { config: ALLOW });
  for (let i = 0; i < 6; i += 1) {
    await command(gladys, IDS.light, 'light', (i + 1) % 2);
  }
  assert.equal(server.writes().length, 6);
  assert.equal(app.followUpTimers.size, 3);
});

// --- M6, M7: values -----------------------------------------------------------

test('M6 Victoria: PRIMING is running, the state trimmed and in any case', () => {
  const victoria = identify({ id: 'V1', name: '', family: '', thingType: 'mppvs' });
  const state = (value) => decode(victoria, new Map([[14, { reported: value }]])).running;
  assert.equal(state(' priming '), 1);
  assert.equal(state('Running'), 1);
  assert.equal(state('not running '), 0);
  assert.equal(state('STOP'), 0);
  assert.equal(state('PUMP CALIBRATION'), undefined);
  assert.equal(state(1), undefined);
});

test('M7 free chlorine and production only on the serials foXaCe maps them on', () => {
  const comps = new Map(
    Object.entries({ 10: 80, 154: 0, 165: 721, 172: 260, 178: 0, 183: 250, 164: 50, 4: 70 }).map(
      ([k, v]) => [Number(k), { reported: v }],
    ),
  );
  const at = (fields) => decode(identify({ name: '', family: 'Chlorinators', ...fields }), comps);
  const generic = at({ id: 'CC25000001.nn_1', thingType: 'tecnoLC2' });
  assert.equal(generic.freeChlorine, undefined, 'never "0 mg/L" without a known probe');
  assert.equal(generic.production, undefined);
  const ducere = at({ id: 'LC24008202.nn_1', thingType: 'tecnoLC2' });
  assert.deepEqual([ducere.freeChlorine, ducere.production], [0, 0]);
  const evo = at({ id: 'CC24042517.nn_1', thingType: 'tecnoLC2' });
  assert.deepEqual([evo.freeChlorine, evo.production], [0, undefined]);
  const domotic = at({ id: 'DM24000001.nn_1', thingType: 'domoticS2' });
  assert.deepEqual(
    [domotic.freeChlorine, domotic.production, domotic.level],
    [undefined, undefined, 70],
  );
});

// --- M10, M11: commands ---------------------------------------------------------

test('M10 the read before a command asks only the components of the profile', async (t) => {
  const server = fakeFluidra({ bulk: false });
  const { gladys } = await setup(t, { server, config: ALLOW });
  const before = server.requests.length;
  assert.equal((await command(gladys, IDS.light, 'light', 1)).success, true);
  assert.deepEqual(
    server.requests.slice(before).map((r) => `${r.method} ${r.path.split('/').slice(4).join('/')}`),
    ['GET components/11', 'PUT components/11'],
  );
});

test('M11 a start without an answer: "sent, without confirmation", and the speed not sent', async (t) => {
  const { gladys, server } = await setup(t, { config: ALLOW });
  server.set(IDS.pump, 9, 0);
  server.queue.push({
    match: (r) => to.write(r) && r.path.endsWith('/9'),
    throws: new FluidraError('timeout', 'no answer'),
  });
  const ack = await command(gladys, IDS.pump, 'speed', 'high');
  assert.equal(ack.success, false);
  assert.match(
    ack.error,
    /Démarrage de la pompe envoyé, sans confirmation de Fluidra \(pas de réponse à temps\) ; sa vitesse n'a pas été envoyée/,
  );
  assert.deepEqual(
    server.writes().map((w) => w.component),
    [9],
    'c11 never sent',
  );
});

// --- Regressions kept from the review (no defect found) -------------------------

test('H7 Z650iQ: 0.5 steps on c12, capped at 35', async (t) => {
  const server = fakeFluidra();
  const id = 'ZB25000001';
  server.tree.push({
    id,
    type: 'connected',
    info: { name: 'Z650iQ', family: 'Heat Pumps' },
    thingType: 'nhpp',
  });
  server.components[id] = { 10: 1, 12: 270, 13: 275, 14: 0, 44: 180 };
  const { gladys } = await setup(t, { server, config: ALLOW });
  assert.equal(profileParam(gladys, id), 'z650iq');
  assert.equal((await command(gladys, id, 'setpoint', '34,5')).success, true);
  assert.equal((await command(gladys, id, 'setpoint', 35.5)).success, false);
  assert.equal((await command(gladys, id, 'setpoint', 27.25)).success, false);
  assert.deepEqual(writesTo(server, id), [{ id, component: 12, desiredValue: 345 }]);
});
