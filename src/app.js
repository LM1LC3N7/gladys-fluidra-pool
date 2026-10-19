// -----------------------------------------------------------------------------
// The integration: the Fluidra account (e-mail, password), one read of the
// account per cycle (60 s by default: its pools, the device tree of each pool,
// the components of each supported device), the Gladys devices and their
// states, the transport badges and the commands, under these rules:
//
// - the commands (pump speed, pool light, heat pump setpoint) are off until
//   the user turns `allow_commands` on; no chemical dosing command at all;
// - a command reads the device again (its components) just before acting,
//   never decides on a state in memory, and is refused when that read fails
//   or lacks the value; the option is checked again right before sending;
// - the commands of one device run one at a time (a promise chain per device);
// - a command not sent 3.5 s after it arrived is refused (Gladys shows a
//   failure after 5 s: nothing must happen after that); one that may have
//   reached Fluidra is answered "sent, without confirmation", never "not sent";
// - a command goes only to a device identified by a strong signal (serial,
//   thingType, component-7 signature) that nothing contradicts, and never to
//   one the last device tree says disconnected.
//
// The pauses (429, 403: every path; the 5xx/network backoff: the reads only)
// and the stops (refused credentials, a code asked) are kept in /data. A
// pause of the Fluidra API does not stop the token renewals (one of Cognito
// does). index.js only wires the SDK handlers to this class.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { FluidraClient } from './client.js';
import { normalizeConfig } from './config.js';
import { GLADYS, PUMP_LEVELS, PUMP_SPEEDS, SETPOINT_CEILING, TIMINGS } from './constants.js';
import {
  COMMAND_ROLES,
  buildDevice,
  deviceIds,
  parseFeatureId,
  shortId,
  statesOf,
} from './devices.js';
import {
  classify,
  componentsOf,
  decode,
  identify,
  latestTs,
  profileOf,
  setpointRange,
  writable,
} from './fluidra.js';
import { FluidraError, errorReason } from './http.js';
import { T, age, join, reasonOf, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors after which Fluidra did not answer usefully: every device is unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable']);

/** Errors of one pool or one device only: the others are still read. */
const PER_ITEM = new Set([
  'not_found',
  'forbidden',
  'bad_response',
  'size',
  'http',
  'unavailable',
  'timeout',
]);

/** Per-item errors that say nothing about the device itself (the cloud did not answer). */
const TRANSIENT = new Set(['unavailable', 'timeout', 'http']);

/** Answers after which the bulk component call is not used again for a device. */
const NO_BULK = new Set(['not_found', 'bad_response', 'http']);

/** Stops retried by themselves, spaced (1 h, 6 h, then every 24 h). */
const SPACED = new Set(['refused', 'new_password', 'session_refused']);

/**
 * Stops never retried by themselves (each sign-in could send a code, or meet
 * the same unknown step): only the test button, or new credentials, lift them.
 */
const NO_AUTO_RETRY = new Set(['two_factor', 'unsupported_challenge']);

/** Command errors after which Fluidra may have executed it anyway. */
const MAYBE_SENT = new Set(['timeout', 'network', 'unavailable', 'bad_response', 'size']);

/** Coarse types whose profile may need the components to be known. */
const NEEDS_COMPONENTS = new Set(['heat_pump', 'chlorinator']);

/** A refusal shown in the ack of the command (Gladys shows the message). */
class Refusal extends Error {}

/** The end of a serial, for the logs (never the whole cloud id). */
const short = (id) => `…${shortId(id)}`;

/** The role a profile accepts a command on. */
const commandRoleOf = (profile) =>
  profile.key === 'e30iq'
    ? 'speed'
    : profile.kind === 'heat_pump'
      ? 'setpoint'
      : profile.kind === 'light'
        ? 'light'
        : undefined;

export class FluidraApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'fluidra' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
    cognitoUrl,
    apiUrl,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new FluidraClient({
      transport,
      now,
      cognitoUrl,
      apiUrl,
      onChange: () => this.persist(),
    });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** cloud id -> { entry, profile, values, seen, offline } of a supported device */
    this.devices = new Map();
    /** cloud id -> the profile key found this session (a device keeps its profile). */
    this.profiles = new Map();
    /** cloud ids whose bulk component call failed: read component by component. */
    this.noBulk = new Set();
    /** cloud id -> the kind of the error of its last read, while it fails */
    this.unreadable = new Map();
    /** How many devices of the account no profile supports (last read). */
    this.unsupported = 0;
    /** The unsupported families already logged (once each). */
    this.loggedUnsupported = new Set();
    this.readAt = undefined;
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.badges = new Map();
    this.timer = undefined;
    this.renewTimer = undefined;
    this.followUpTimers = new Set();
    this.running = undefined;
    this.generation = 0;
    /** undefined | a stop kind (BLOCK_KINDS of src/store.js). */
    this.blocked = undefined;
    this.blockDetail = undefined;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    /** The 403s on the account in a row, each with a fresh token (kept in /data). */
    this.forbiddenCount = 0;
    this.pausedUntil = 0;
    /** 'rate' (429), 'forbidden' (403): every path waits; 'backoff': the polling only. */
    this.pauseKind = undefined;
    /** 'api' | 'cognito': where the current 429 pause comes from. */
    this.pauseSource = undefined;
    /** cloud id -> tail of its command chain: one command at a time per device */
    this.commandChains = new Map();
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    this.lastRenewAt = -Infinity;
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user changed the credentials, the stops are lifted. */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (!this.config.username || !this.config.password) {
      // Nothing is read without credentials, and /data is left as it is: the
      // stop of the account (a code asked) is still there when they come back.
      this.client.configure({ username: this.config.username, password: '', tokens: null });
      this.publisher.start();
      await this.setStatus(false, T.noCredentials);
      return;
    }
    const { account } = this.config;
    if (this.memory.account !== account) {
      // Another account: its tokens, its stops and its 403s are not this one's. A pause stays.
      this.memory = { ...this.memory, account, tokens: null, block: null, forbidden: 0 };
    }
    if (fresh) {
      // New credentials lift the stops, but a code asked for this same account:
      // each sign-in could send one, only the test button tries again.
      if (this.memory.block?.kind !== 'two_factor') {
        this.memory.block = null;
      }
      this.memory.tokens = null;
    }
    const { pause, block } = this.memory;
    if (pause && pause.until > this.now()) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
      this.pauseSource = pause.source;
      if (pause.kind === 'backoff') {
        this.failures = pause.failures;
      }
    }
    this.forbiddenCount = this.memory.forbidden ?? 0;
    if (block) {
      this.blocked = block.kind;
      this.blockDetail = block.detail;
      this.retries = block.retries;
      this.retryAt = block.retryAt ?? 0;
    }
    this.client.configure({
      username: this.config.username,
      password: this.config.password,
      tokens: this.memory.tokens,
    });
    await this.saveMemory();
    this.publisher.start();
    this.scheduleRenew();
    if (this.blocked) {
      await this.setStatus(false, this.blockedMessage());
      this.scheduleNext();
      return;
    }
    await this.setStatus(false, this.pauseMessage({ backoff: true }) ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.clearRenewTimer();
    for (const handle of this.followUpTimers) {
      this.timers.clearTimeout(handle);
    }
    this.followUpTimers.clear();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  clearRenewTimer() {
    if (this.renewTimer) {
      this.timers.clearTimeout(this.renewTimer);
      this.renewTimer = undefined;
    }
  }

  get configured() {
    return this.client.hasCredentials;
  }

  /** A 429 or 403 pause holds now (every path waits). */
  get hardPaused() {
    return (
      (this.pauseKind === 'rate' || this.pauseKind === 'forbidden') && this.now() < this.pausedUntil
    );
  }

  /** A 429 of Cognito itself holds now: the renewals wait for its end. */
  get cognitoPaused() {
    return this.pauseKind === 'rate' && this.pauseSource === 'cognito' && this.hardPaused;
  }

  /**
   * The renewal of the token, at its expiry minus the margin, whatever the
   * poll interval: a command never meets an expired token. It waits for the
   * end of a Cognito 429 pause and never runs during a stop.
   */
  scheduleRenew(delay) {
    this.clearRenewTimer();
    const renewAt = this.client.renewAt;
    if (!this.configured || this.blocked || renewAt === undefined) {
      return;
    }
    let at = delay === undefined ? renewAt : this.now() + delay;
    // A floor: a token shorter than the margin, or a host clock ahead, would
    // otherwise renew at once again and again.
    at = Math.max(at, this.lastRenewAt + TIMINGS.renewRetry);
    if (this.cognitoPaused) {
      at = Math.max(at, this.pausedUntil);
    }
    const generation = this.generation;
    this.renewTimer = this.timers.setTimeout(
      () => {
        this.renewTimer = undefined;
        if (generation !== this.generation || this.blocked) {
          return;
        }
        if (this.cognitoPaused || this.now() < (this.client.renewAt ?? Infinity) - 1_000) {
          this.scheduleRenew();
          return;
        }
        // A success persists the new tokens, which schedules the next renewal.
        this.lastRenewAt = this.now();
        this.client
          .token({ force: true, signIn: false })
          .catch((err) => this.renewFailed(err, generation));
      },
      Math.max(0, at - this.now()),
    );
  }

  /** A renewal outside a read failed: a pause, or a new try later; never a sign-in. */
  async renewFailed(err, generation = this.generation) {
    if (generation !== this.generation) {
      return;
    }
    this.logger.info(`Fluidra: token renewal failed (${errorReason(err)})`);
    if (err.kind === 'rate_limited') {
      this.pause(err);
      await this.persist();
      return;
    }
    if (err.kind === 'unauthorized') {
      // The refresh token was refused: the next read signs in.
      return;
    }
    this.scheduleRenew(Math.max(TIMINGS.renewRetry, this.config.pollInterval * 1000));
  }

  /** Forgets the devices and the failures: a new account, or a restart. A 429 pause stays. */
  reset() {
    this.devices.clear();
    this.profiles.clear();
    this.noBulk.clear();
    this.unreadable.clear();
    this.unsupported = 0;
    this.readAt = undefined;
    this.published = undefined;
    this.badges.clear();
    this.blocked = undefined;
    this.blockDetail = undefined;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    this.forbiddenCount = 0;
    if (this.pauseKind !== 'rate' || this.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
      this.pauseSource = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges). The pauses, the stops and the tokens stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishBadges();
  }

  /** New credentials restart (and lift the stops); the rest applies at once. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.username !== previous.username || next.password !== previous.password) {
      return this.start(raw, { fresh: true });
    }
    this.config = next;
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.scheduleNext();
    }
    if (next.language !== previous.language) {
      this.published = undefined;
      await this.publishDevices();
      this.queueAll();
      await this.flush();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The message of the last status (multi-language), or undefined. */
  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  /** The tokens, the pause, the 403s in a row and the stop, with the account they belong to. */
  async persist() {
    this.memory.account = this.config.account;
    this.memory.tokens = this.client.tokens ? { ...this.client.tokens } : null;
    // The backoff too (5xx, network): a restart does not read again at once.
    this.memory.pause =
      this.pauseKind && this.now() < this.pausedUntil
        ? {
            kind: this.pauseKind,
            until: this.pausedUntil,
            source: this.pauseSource ?? 'api',
            ...(this.pauseKind === 'backoff' ? { failures: this.failures } : {}),
          }
        : null;
    this.memory.forbidden = this.forbiddenCount;
    this.memory.block = this.blocked
      ? {
          kind: this.blocked,
          retries: this.retries,
          retryAt: this.retryAt || undefined,
          detail: this.blockDetail,
        }
      : null;
    await this.saveMemory();
    // New tokens, a new pause or a stop: the renewal follows.
    this.scheduleRenew();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** The next read: after the pause or the spaced retry, else the interval. */
  scheduleNext() {
    this.clearTimer();
    if (!this.configured) {
      return;
    }
    const now = this.now();
    let delay;
    if (NO_AUTO_RETRY.has(this.blocked)) {
      return;
    } else if (this.blocked) {
      delay = Math.max(this.retryAt, this.pausedUntil) - now;
    } else if (now < this.pausedUntil) {
      // Never read again faster than the interval, a pause included.
      delay = Math.max(this.pausedUntil - now, this.config.pollInterval * 1000);
    } else {
      delay = this.config.pollInterval * 1000;
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`Fluidra refresh failed: ${err.message}`));
        }
      },
      Math.max(0, delay),
    );
  }

  /** One run at a time: a tick during a run joins it. `quick`: for a button. */
  tick({ quick = false } = {}) {
    if (!this.running) {
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    if (!this.configured) {
      return;
    }
    if (this.blocked && SPACED.has(this.blocked) && this.now() >= this.retryAt) {
      // The spaced new try: one sign-in at most.
      this.logger.info(`Fluidra: trying again after a stop (${this.blocked})`);
      this.blocked = undefined;
    }
    if (this.blocked || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    this.client.beginCycle();
    this.client.setTimeoutMs(quick ? TIMINGS.quickTimeout : undefined);
    try {
      const { read, total, transient } = await this.readAll(generation);
      if (generation !== this.generation) {
        return;
      }
      if (read === 0 && transient) {
        // No device answered at all: Fluidra is unreachable, the backoff follows.
        throw transient;
      }
      this.readAt = this.now();
      await this.publishDevices();
      const hadStop = this.retries > 0 || this.pauseKind !== undefined || this.forbiddenCount > 0;
      this.failures = 0;
      this.forbiddenCount = 0;
      this.retries = 0;
      this.retryAt = 0;
      this.offline = false;
      // A 429 met meanwhile by a command (its read) still holds.
      if (this.pauseKind === 'backoff' || this.now() >= this.pausedUntil) {
        this.pauseKind = undefined;
        this.pausedUntil = 0;
      }
      if (hadStop || this.memory.block || this.memory.pause) {
        await this.persist();
      }
      if (total === 0) {
        await this.setStatus(true, T.noDevice(this.unsupported));
      } else {
        await this.setStatus(true, T.connected(read, total, this.unsupported));
      }
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    } finally {
      this.client.setTimeoutMs(undefined);
    }
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /**
   * The pools, the device tree of each pool, the components of each
   * supported device. An error of one pool or one device (404, 403, 5xx, a
   * timeout, a bad answer) marks only it; any other error (network, 429, the
   * session, a 403 on the account) ends the cycle.
   */
  async readAll(generation) {
    const pools = await this.client.pools();
    let read = 0;
    let transient;
    let unsupported = 0;
    const listed = new Set();
    const failedPools = new Set();
    for (const pool of pools) {
      let entries;
      try {
        entries = await this.client.tree(pool.id);
      } catch (err) {
        if (!PER_ITEM.has(err.kind)) {
          throw err;
        }
        if (TRANSIENT.has(err.kind)) {
          transient = err;
        }
        failedPools.add(pool.id);
        // Its devices were not read this time: their badges say so.
        for (const [id, device] of this.devices) {
          if (device.entry.poolId === pool.id) {
            this.unreadable.set(id, err.kind);
          }
        }
        this.logger.warn(
          `Fluidra: the equipment of a pool could not be read (${errorReason(err)})`,
        );
        continue;
      }
      if (generation !== this.generation) {
        return { read, total: 0 };
      }
      for (const entry of entries) {
        listed.add(entry.id);
        const outcome = await this.readDevice(entry, generation);
        if (generation !== this.generation) {
          return { read, total: 0 };
        }
        if (outcome === 'unsupported') {
          unsupported += 1;
        } else if (outcome === 'read') {
          read += 1;
        } else if (outcome?.kind && TRANSIENT.has(outcome.kind)) {
          transient = outcome;
        }
      }
    }
    // A device gone from a pool read in full is forgotten (Gladys keeps it).
    for (const [id, device] of this.devices) {
      if (!listed.has(id) && !failedPools.has(device.entry.poolId)) {
        this.devices.delete(id);
        this.unreadable.delete(id);
      }
    }
    this.unsupported = unsupported;
    const total = this.devices.size;
    return { read, total, transient: read === 0 ? transient : undefined };
  }

  /**
   * One device of the tree: its profile, its components, its values.
   * Resolves 'read', 'unsupported', or the per-device error.
   */
  async readDevice(entry, generation) {
    const known = this.profiles.get(entry.id);
    let profile = known ? profileOf(known) : identify(entry);
    if (!profile && !NEEDS_COMPONENTS.has(classify(entry.family, entry.name))) {
      this.logUnsupported(entry);
      return 'unsupported';
    }
    let components;
    try {
      components = await this.readComponents(entry.id, componentsOf(profile));
      if (!profile) {
        profile = identify(entry, components);
        if (profile && this.noBulk.has(entry.id)) {
          // Read component by component: the components of the profile found.
          const more = componentsOf(profile).filter((c) => !components.has(c));
          for (const [id, value] of await this.readComponents(entry.id, more)) {
            components.set(id, value);
          }
        }
      }
    } catch (err) {
      if (!PER_ITEM.has(err.kind)) {
        throw err;
      }
      if (profile && this.devices.has(entry.id)) {
        if (!this.unreadable.has(entry.id)) {
          this.logger.warn(`Fluidra device ${short(entry.id)}: ${errorReason(err)}`);
        }
        this.unreadable.set(entry.id, err.kind);
        const device = this.devices.get(entry.id);
        device.entry = entry;
        // Nothing read this time corroborates a "disconnected" report.
        device.live = false;
        return err;
      }
      if (!profile) {
        // Not identified yet and not readable: counted as not supported for now.
        this.logger.warn(`Fluidra device ${short(entry.id)}: ${errorReason(err)}`);
        return 'unsupported';
      }
      this.unreadable.set(entry.id, err.kind);
      this.devices.set(entry.id, { entry, profile, values: {}, seen: new Set(), offline: 0 });
      this.profiles.set(entry.id, profile.key);
      return err;
    }
    if (generation !== this.generation) {
      return undefined;
    }
    if (!profile) {
      this.logUnsupported(entry);
      return 'unsupported';
    }
    this.profiles.set(entry.id, profile.key);
    this.unreadable.delete(entry.id);
    this.ingest(entry, profile, components);
    return 'read';
  }

  /**
   * Logs an unsupported family once: what a profile would match on, never the
   * serial nor the name (a name can be the user's own words).
   */
  logUnsupported(entry) {
    const key = `${entry.family}|${entry.thingType}`;
    if (!this.loggedUnsupported.has(key)) {
      this.loggedUnsupported.add(key);
      this.logger.info(
        `Fluidra: equipment not supported yet (family "${entry.family}", thingType "${entry.thingType}")`,
      );
    }
  }

  /**
   * The components of a device: one bulk request (the app's own call), or,
   * once that failed with a 404, a 4xx or a bad answer for this device, one
   * request per component of `ids` (an absent component is skipped).
   */
  async readComponents(id, ids, options = {}) {
    if (!this.noBulk.has(id)) {
      try {
        return await this.client.components(id, options);
      } catch (err) {
        if (!NO_BULK.has(err.kind)) {
          throw err;
        }
        this.noBulk.add(id);
        this.logger.info(
          `Fluidra device ${short(id)}: bulk read refused (${errorReason(err)}), reading component by component`,
        );
      }
    }
    const components = new Map();
    for (const component of ids) {
      try {
        components.set(component, await this.client.component(id, component, options));
      } catch (err) {
        if (err.kind !== 'not_found') {
          throw err;
        }
      }
    }
    if (components.size === 0 && ids.length > 0) {
      throw new FluidraError('not_found', 'no component could be read');
    }
    return components;
  }

  /**
   * The values of one device as read: kept, and its states queued. A poll
   * also decides whether the device takes commands (writable()) and how many
   * "disconnected" reports in a row it has; `command` (the read just before a
   * command) changes neither.
   */
  ingest(entry, profile, components, created = this.createdFeatures(), { command = false } = {}) {
    const previous = this.devices.get(entry.id);
    const values = decode(profile, components);
    const seen = previous?.seen ?? new Set();
    for (const key of Object.keys(values)) {
      seen.add(key);
    }
    let { offline = 0, live = false, ts, canWrite = false } = previous ?? {};
    if (!command) {
      const latest = latestTs(components);
      // A bridged child can report "disconnected" on every read while its data
      // is live (foXaCe sensor/chlorinator.py): a component `ts` that moved
      // since the last read corroborates it; a missing or unchanged one does not.
      live =
        entry.online === false &&
        entry.parentId !== undefined &&
        latest !== undefined &&
        ts !== undefined &&
        latest !== ts;
      ts = latest;
      offline = entry.online === false && !live ? offline + 1 : 0;
      canWrite = writable(profile, entry, components);
    }
    const device = {
      entry,
      profile,
      values,
      seen,
      offline,
      live,
      ts,
      canWrite,
      readAt: this.now(),
    };
    this.devices.set(entry.id, device);
    this.queue(device, created);
    return device;
  }

  /** What devices.js reads of a device. */
  view(device) {
    return {
      id: device.entry.id,
      name: device.entry.name,
      profile: device.profile,
      values: device.values,
      seen: device.seen,
    };
  }

  /** The message of a stop. */
  blockedMessage() {
    const wait = age(Math.max(TIMINGS.rateLimitMin, this.retryAt - this.now()));
    switch (this.blocked) {
      case 'two_factor':
        return T.twoFactor;
      case 'new_password':
        return T.newPassword;
      case 'unsupported_challenge':
        return T.unsupportedChallenge(this.blockDetail);
      case 'session_refused':
        return T.sessionRefused(wait);
      default:
        return T.refused(wait);
    }
  }

  /** A failure: a stop, a pause, or a backoff. Never a dead integration but for a code. */
  async failed(err) {
    const reason = errorReason(err);
    if (err.kind === 'no_credentials') {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    if (NO_AUTO_RETRY.has(err.kind)) {
      this.blocked = err.kind;
      this.blockDetail = err.challenge;
      this.retryAt = 0;
      this.logger.warn(`Fluidra asks for a sign-in step (${err.challenge ?? '?'}): stopped`);
      await this.persist();
      await this.setStatus(false, this.blockedMessage());
      return;
    }
    if (SPACED.has(err.kind)) {
      const wait = TIMINGS.refusedRetry[Math.min(this.retries, TIMINGS.refusedRetry.length - 1)];
      this.retries += 1;
      this.blocked = err.kind;
      this.blockDetail = err.challenge;
      this.retryAt = this.now() + wait;
      this.logger.warn(
        `Fluidra stopped: ${reason}; one new try in ${Math.round(wait / 60_000)} min`,
      );
      await this.persist();
      await this.setStatus(false, this.blockedMessage());
      return;
    }
    let wait;
    let message;
    if (err.kind === 'rate_limited') {
      wait = this.pause(err);
      message = T.rateLimited(age(wait));
    } else if (err.kind === 'forbidden') {
      wait = this.forbid();
      this.forbiddenCount += 1;
      this.offline = true;
      message = this.forbiddenMessage(age(wait));
    } else {
      // Never read again faster than the poll interval.
      wait = Math.max(
        this.config.pollInterval * 1000,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = 'backoff';
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      this.offline = OFFLINE.has(err.kind) || err.kind === 'unauthorized' || this.offline;
      message = T.unreachable(reasonOf(err), age(wait));
    }
    this.failures += 1;
    await this.persist();
    const connected = err.kind === 'rate_limited' && this.readAt !== undefined;
    await this.setStatus(connected, message);
    this.logger.warn(`Fluidra: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  /** 429: a pause of Retry-After, between 60 s and 6 h, for every path (kept in /data). */
  pause(err) {
    const asked = err.retryAfter ?? TIMINGS.rateLimitDefault;
    const wait = Math.max(TIMINGS.rateLimitMin, Math.min(TIMINGS.rateLimitMax, asked));
    if (this.pauseKind !== 'rate' || this.now() + wait > this.pausedUntil) {
      this.pauseSource = err.source === 'cognito' ? 'cognito' : 'api';
    }
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.pauseKind = 'rate';
    return wait;
  }

  /**
   * The message of a 403 pause: after a few in a row (each with a fresh
   * token), it says Fluidra may be filtering this client.
   */
  forbiddenMessage(wait) {
    return this.forbiddenCount >= TIMINGS.forbiddenNotice
      ? T.filtered(wait, this.forbiddenCount)
      : T.forbidden(wait);
  }

  /** The account endpoint refused a fresh token (403): a 30-minute pause; a 429 pause stays. */
  forbid() {
    const wait = TIMINGS.forbiddenPause;
    if (!(this.pauseKind === 'rate' && this.pausedUntil > this.now() + wait)) {
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      this.pauseKind = 'forbidden';
      this.pauseSource = 'api';
    }
    return wait;
  }

  // --- Gladys ----------------------------------------------------------------

  /** The roles of the device already created in Gladys for a cloud id. */
  createdRoles(id) {
    const externalId = deviceIds(this.gladys, id).device;
    const device = (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
    return new Set(
      (device?.features ?? [])
        .map((f) => parseFeatureId(this.gladys, f.external_id)?.role)
        .filter((role) => role !== undefined),
    );
  }

  async publishDevices() {
    if (this.readAt === undefined && this.devices.size === 0) {
      return;
    }
    const devices = [...this.devices.values()]
      .map((device) =>
        buildDevice(
          this.gladys,
          this.view(device),
          this.config.language,
          this.createdRoles(device.entry.id),
        ),
      )
      // A water analyser with no reading yet has no feature to offer.
      .filter((device) => device.features.length > 0);
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** Queues the states of one device (the features created in Gladys only). */
  queue(device, created = this.createdFeatures()) {
    const ids = deviceIds(this.gladys, device.entry.id);
    for (const { role, ...value } of statesOf(this.view(device), this.config.language)) {
      const id = ids.feature(role);
      if (created.has(id)) {
        this.publisher.push(id, value);
      }
    }
  }

  queueAll(created = this.createdFeatures()) {
    for (const device of this.devices.values()) {
      this.queue(device, created);
    }
  }

  badge(id) {
    if (this.blocked || this.offline) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (this.unreadable.has(id)) {
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: TRANSIENT.has(this.unreadable.get(id)) ? T.deviceNoAnswer : T.deviceUnreadable,
      };
    }
    // The cloud misreports a healthy device as disconnected for one read now
    // and then (foXaCe OFFLINE_GRACE_POLLS): two reads in a row are needed.
    if ((this.devices.get(id)?.offline ?? 0) >= 2) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.deviceOffline };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishBadges() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entries = [];
    for (const id of this.devices.keys()) {
      const externalId = deviceIds(this.gladys, id).device;
      if (!created.has(externalId)) {
        continue;
      }
      const entry = { external_id: externalId, ...this.badge(id) };
      const json = JSON.stringify(entry);
      if (this.badges.get(externalId) !== json) {
        entries.push([externalId, json, entry]);
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries.map(([, , entry]) => entry));
      for (const [externalId, json] of entries) {
        this.badges.set(externalId, json);
      }
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badges.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueAll(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    this.badges.delete(device?.external_id);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: a fresh read if the last one is old enough. */
  async scan() {
    if (
      this.configured &&
      !this.blocked &&
      this.now() >= this.pausedUntil &&
      (this.readAt === undefined || this.now() - this.readAt >= TIMINGS.testCooldown)
    ) {
      await this.tick({ quick: true });
      return;
    }
    await this.publishDevices();
  }

  // --- Commands --------------------------------------------------------------

  refusal(text, cause) {
    return new Refusal(word(text, this.config.language), cause ? { cause } : undefined);
  }

  /**
   * The value of a command, strictly: null, '', ' ', false or [] are never
   * read as a number. Throws a refusal when it is not valid.
   */
  commandValue(role, value, profile) {
    if (role === 'speed') {
      if (value === 'auto') {
        throw this.refusal(T.denied.autoSpeed);
      }
      if (typeof value !== 'string' || !PUMP_SPEEDS.includes(value)) {
        throw this.refusal(T.denied.badSpeed);
      }
      return value;
    }
    if (role === 'light') {
      if (value === GLADYS.ON || value === '1') {
        return GLADYS.ON;
      }
      if (value === GLADYS.OFF || value === '0') {
        return GLADYS.OFF;
      }
      throw this.refusal(T.denied.badLight);
    }
    const range = setpointRange(profile, SETPOINT_CEILING);
    const number =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(value)
          ? Number(value.trim().replace(',', '.'))
          : NaN;
    const steps = number / range.step;
    if (
      !Number.isFinite(number) ||
      number < range.min ||
      number > range.max ||
      Math.abs(steps - Math.round(steps)) > 1e-9
    ) {
      throw this.refusal(T.denied.badSetpoint(range.min, range.max, range.step));
    }
    return Math.round(steps) * range.step;
  }

  async setValue(_gladysDevice, feature, value) {
    // The ack deadline counts from the arrival of the command, before any wait.
    const receivedAt = this.now();
    const target = parseFeatureId(this.gladys, feature?.external_id);
    if (!target || !COMMAND_ROLES.includes(target.role)) {
      throw new Error(`${feature?.external_id} cannot be set`);
    }
    const device = this.devices.get(target.id);
    if (!device || commandRoleOf(device.profile) !== target.role) {
      throw this.refusal(T.denied.unknownDevice);
    }
    if (!device.canWrite) {
      // Recognized by a name, a model or a family only, or contradicted by
      // what the cloud says: shown, never written to (src/fluidra.js writable()).
      throw this.refusal(T.denied.notWritable);
    }
    const checked = this.commandValue(target.role, value, device.profile);
    return this.serialized(target.id, () =>
      this.command(target.id, target.role, checked, receivedAt),
    );
  }

  /** Runs `task` after the previous task of the same key (a promise chain per key). */
  serialized(key, task) {
    const previous = this.commandChains.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    this.commandChains.set(key, tail);
    tail.then(() => {
      if (this.commandChains.get(key) === tail) {
        this.commandChains.delete(key);
      }
    });
    return run;
  }

  /** Time left before the deadline of a command that arrived at `receivedAt`. */
  remaining(receivedAt) {
    return receivedAt + TIMINGS.commandDeadline - this.now();
  }

  /** The checks every command shares, before its read. */
  checkCommand(id, receivedAt, generation) {
    if (!this.config.allowCommands) {
      throw this.refusal(T.denied.commands);
    }
    if (!this.client.hasCredentials) {
      throw this.refusal(T.denied.noConfig);
    }
    const device = this.devices.get(id);
    if (!device) {
      throw this.refusal(T.denied.unknownDevice);
    }
    if (device.entry.online === false && !device.live) {
      // The last device tree says it is not connected (and nothing read says otherwise).
      throw this.refusal(T.denied.disconnected);
    }
    if (this.blocked) {
      throw this.refusal(T.denied.stopped);
    }
    if (this.hardPaused) {
      throw this.refusal(this.pauseKind === 'forbidden' ? T.denied.forbidden : T.denied.paused);
    }
    // Valid 60 s more (less for a short-lived token, never under the command's own span).
    const validity = Math.max(
      TIMINGS.commandAnswerBy + 1_000,
      Math.min(TIMINGS.commandTokenValidity, this.client.margin),
    );
    if (!this.client.tokenValidFor(validity)) {
      // A renewal inside the 3.5 s would leave too little time: renewed now, refused.
      this.client
        .token({ signIn: false, validity })
        .catch((err) => this.renewFailed(err, generation));
      throw this.refusal(T.denied.session);
    }
    if (this.remaining(receivedAt) <= TIMINGS.minRequestTimeout) {
      throw this.refusal(T.denied.late);
    }
  }

  /** Still allowed right before sending: the option, the account, the pauses. */
  checkBeforeSend(generation) {
    if (generation !== this.generation || this.blocked || !this.config.allowCommands) {
      throw this.refusal(this.config.allowCommands ? T.denied.stopped : T.denied.commands);
    }
    if (this.hardPaused) {
      throw this.refusal(this.pauseKind === 'forbidden' ? T.denied.forbidden : T.denied.paused);
    }
  }

  /** One command: a fresh read, the decision on it, then the write(s). */
  async command(id, role, value, receivedAt) {
    const generation = this.generation;
    this.checkCommand(id, receivedAt, generation);
    const { profile } = this.devices.get(id);
    // The state just before acting, never the one in memory.
    const fresh = await this.readFresh(id, profile, receivedAt);
    if (this.remaining(receivedAt) <= 0) {
      throw this.refusal(T.denied.late);
    }
    if (role === 'speed') {
      return this.setSpeed(id, fresh.values, value, receivedAt, generation);
    }
    if (role === 'setpoint') {
      if (fresh.values.setpoint === undefined) {
        throw this.refusal(T.denied.unknown);
      }
      if (fresh.values.setpoint === value) {
        return;
      }
      this.checkBeforeSend(generation);
      await this.send(id, profile.layout.setpoint, Math.round(value * 10), receivedAt);
      this.logger.info(`Fluidra device ${short(id)}: setpoint sent`);
      return;
    }
    if (fresh.values.light === undefined) {
      throw this.refusal(T.denied.unknown);
    }
    if (fresh.values.light === value) {
      return;
    }
    this.checkBeforeSend(generation);
    // LumiPlus takes its power as a string, "1" or "0" (foXaCe light.py).
    await this.send(id, 11, String(value), receivedAt);
    this.logger.info(`Fluidra device ${short(id)}: light ${value ? 'on' : 'off'} sent`);
  }

  /**
   * The E30iQ speed: refused while the schedule drives the pump (auto mode);
   * "off" writes c9 = 0; a speed on a running pump writes c11; a speed on a
   * stopped pump writes c9 = 1 then c11 (foXaCe select/pump.py), the second
   * only within the deadline.
   */
  async setSpeed(id, values, speed, receivedAt, generation) {
    if (values.running === undefined || values.auto === undefined) {
      throw this.refusal(T.denied.unknown);
    }
    if (values.auto === 1) {
      throw this.refusal(T.denied.pumpAuto);
    }
    if (speed === 'off') {
      if (values.running === 0) {
        return;
      }
      this.checkBeforeSend(generation);
      await this.send(id, 9, 0, receivedAt);
      this.logger.info(`Fluidra device ${short(id)}: pump stop sent`);
      return;
    }
    const level = PUMP_LEVELS[speed];
    if (values.running === 1) {
      if (values.level === level) {
        return;
      }
      this.checkBeforeSend(generation);
      await this.send(id, 11, level, receivedAt);
      this.logger.info(`Fluidra device ${short(id)}: pump speed sent`);
      return;
    }
    this.checkBeforeSend(generation);
    try {
      await this.send(id, 9, 1, receivedAt);
    } catch (err) {
      const cause = err.cause ?? err;
      if (MAYBE_SENT.has(cause.kind)) {
        // The start may have reached Fluidra; the speed was never sent.
        throw new Error(word(T.startMaybeSent(reasonOf(cause)), this.config.language), {
          cause: err,
        });
      }
      throw err;
    }
    this.logger.info(`Fluidra device ${short(id)}: pump start sent`);
    try {
      this.checkBeforeSend(generation);
      await this.send(id, 11, level, receivedAt, { followUp: false });
      this.logger.info(`Fluidra device ${short(id)}: pump speed sent`);
    } catch (err) {
      // The pump was started: the message says so, and what became of the speed.
      const cause = err.cause ?? err;
      const text = MAYBE_SENT.has(cause.kind)
        ? join(T.speedStarted, T.maybeSent(reasonOf(cause)))
        : cause.kind === 'late' || err instanceof Refusal
          ? T.speedNotSent
          : join(T.speedStarted, T.commandFailed(reasonOf(cause)));
      throw new Error(word(text, this.config.language), { cause: err });
    }
  }

  /**
   * The components of a device within the command deadline (2.5 s at most),
   * decoded with its profile; a refusal on any failure.
   */
  async readFresh(id, profile, receivedAt) {
    let components;
    try {
      components = await this.readComponents(id, componentsOf(profile, { command: true }), {
        retry: false,
        signIn: false,
        validity: TIMINGS.commandAnswerBy,
        startBy: receivedAt + TIMINGS.commandDeadline - TIMINGS.minRequestTimeout,
        timeout: () =>
          Math.max(
            TIMINGS.minRequestTimeout,
            Math.min(TIMINGS.commandReadTimeout, this.remaining(receivedAt)),
          ),
      });
    } catch (err) {
      if (err.kind === 'late') {
        throw this.refusal(T.denied.late, err);
      }
      if (err.kind === 'rate_limited') {
        this.pause(err);
        await this.persist();
      }
      this.logger.info(
        `Fluidra device ${short(id)}: no state before the command (${errorReason(err)})`,
      );
      throw this.refusal(T.denied.unreadable, err);
    }
    const device = this.devices.get(id);
    const fresh = this.ingest(device.entry, profile, components, undefined, { command: true });
    this.unreadable.delete(id);
    // The ack never waits for Gladys: the states go on their own.
    this.flush();
    return fresh;
  }

  /**
   * `PUT …/components/{c}` within the deadline, then follow-up reads. A
   * command that may have reached Fluidra is "sent, without confirmation".
   */
  async send(id, component, value, receivedAt, { followUp = true } = {}) {
    try {
      await this.client.setComponent(id, component, value, {
        // Sent 3.4 s after the arrival at the latest; answered by 4.6 s after it.
        startBy: receivedAt + TIMINGS.commandStartBy,
        validity: TIMINGS.commandAnswerBy,
        timeout: () =>
          Math.max(TIMINGS.minRequestTimeout, receivedAt + TIMINGS.commandAnswerBy - this.now()),
      });
    } catch (err) {
      if (err.kind === 'late') {
        throw this.refusal(T.denied.late, err);
      }
      if (err.kind === 'unauthorized') {
        // Renewed at once for the next command (never inside this one).
        const generation = this.generation;
        this.client
          .token({ force: true, signIn: false })
          .catch((renewal) => this.renewFailed(renewal, generation));
        throw this.refusal(T.denied.session, err);
      }
      if (err.kind === 'rate_limited') {
        this.pause(err);
        await this.persist();
      }
      if (MAYBE_SENT.has(err.kind)) {
        this.followUp();
        throw new Error(word(T.maybeSent(reasonOf(err)), this.config.language), { cause: err });
      }
      throw new Error(word(T.commandFailed(reasonOf(err)), this.config.language), { cause: err });
    }
    if (followUp) {
      this.followUp();
    }
  }

  /**
   * A few reads after a command, to show its effect. A new command replaces
   * the follow-up reads of the previous one (never three per command).
   */
  followUp() {
    for (const handle of this.followUpTimers) {
      this.timers.clearTimeout(handle);
    }
    this.followUpTimers.clear();
    const generation = this.generation;
    for (const delay of TIMINGS.followUps) {
      const handle = this.timers.setTimeout(() => {
        this.followUpTimers.delete(handle);
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.warn(`Fluidra refresh failed: ${err.message}`));
        }
      }, delay);
      this.followUpTimers.add(handle);
    }
  }

  // --- Configuration button --------------------------------------------------

  /**
   * A 429 or 403 pause holds for every path, the button included; `backoff`:
   * the message of a backoff kept across a restart too (the button is not
   * held by it).
   */
  pauseMessage({ backoff = false } = {}) {
    const left = this.pausedUntil - this.now();
    if (left <= 0) {
      return undefined;
    }
    if (this.pauseKind === 'rate') {
      return T.rateLimited(age(left));
    }
    if (this.pauseKind === 'forbidden') {
      return this.forbiddenMessage(age(left));
    }
    return backoff && this.pauseKind === 'backoff' ? T.backoffKept(age(left)) : undefined;
  }

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    // At most one read (and one sign-in) per 30 s from this button.
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last ? join(T.test.cooldown, last) : T.test.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // The button is how a stopped account is retried at once.
    this.blocked = undefined;
    this.blockDetail = undefined;
    this.retryAt = 0;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    await this.tick({ quick: true });
    return this.lastMessage ?? T.noCredentials;
  }
}
