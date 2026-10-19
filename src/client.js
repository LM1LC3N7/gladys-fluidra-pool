// -----------------------------------------------------------------------------
// The Fluidra account: the Cognito tokens (src/cognito.js), renewed from the
// refresh token before they expire (never a new sign-in at each cycle), and
// the calls of the Fluidra EMEA API the integration needs (foXaCe
// fluidra_api/_devices.py and _components.py): the pools of the account, the
// device tree of a pool, the components of a device, and a component write.
// -----------------------------------------------------------------------------

import { CognitoClient } from './cognito.js';
import { API, TIMINGS } from './constants.js';
import { parseComponents, parsePools, parseTree } from './fluidra.js';
import { FluidraError, httpRequest, parseJson, parseRetryAfter } from './http.js';

/** The error of a Fluidra API answer, or undefined when it is a success. */
export function apiError({ status, headers = {} }, now) {
  if (status >= 200 && status < 300) {
    return undefined;
  }
  if (status === 401) {
    return new FluidraError('unauthorized', 'token refused', { status });
  }
  if (status === 429) {
    return new FluidraError('rate_limited', 'too many requests', {
      status,
      retryAfter: parseRetryAfter(headers['retry-after'], now),
    });
  }
  if (status === 403) {
    return new FluidraError('forbidden', 'request refused', { status });
  }
  if (status === 404) {
    return new FluidraError('not_found', 'not found', { status });
  }
  if (status >= 500) {
    return new FluidraError('unavailable', 'Fluidra is unavailable', { status });
  }
  return new FluidraError('http', 'request failed', { status });
}

const CONNECTED = { deviceType: 'connected' };
const path = (...parts) => parts.map((p) => encodeURIComponent(String(p))).join('/');

export class FluidraClient {
  constructor({
    transport = httpRequest,
    now = Date.now,
    cognitoUrl,
    apiUrl = API.url,
    onChange,
  } = {}) {
    this.transport = transport;
    this.now = now;
    this.apiUrl = apiUrl;
    this.cognito = new CognitoClient({ transport, now, url: cognitoUrl });
    /** Called after the tokens changed (persist them; never throws). */
    this.onChange = onChange;
    this.username = '';
    this.password = '';
    /** { accessToken, refreshToken, expiresAt } | null */
    this.tokens = null;
    this.renewing = undefined;
    /** One new sign-in or forced renewal per cycle at most (beginCycle resets it). */
    this.renewedThisCycle = false;
    this.signedInThisCycle = false;
    /** Per-request timeout; undefined = TIMINGS.requestTimeout (shorter for the buttons). */
    this.timeout = undefined;
  }

  configure({ username, password, tokens = null }) {
    this.username = username;
    this.password = password;
    this.tokens = tokens?.accessToken || tokens?.refreshToken ? tokens : null;
    this.beginCycle();
  }

  get hasCredentials() {
    return this.username !== '' && this.password !== '';
  }

  beginCycle() {
    this.renewedThisCycle = false;
    this.signedInThisCycle = false;
  }

  async changed() {
    try {
      await this.onChange?.();
    } catch {
      // Persisting is best effort: the tokens still work in memory.
    }
  }

  /** A shorter timeout for the buttons (undefined: the default again). */
  setTimeoutMs(value) {
    this.timeout = value;
    this.cognito.timeout = value;
  }

  /** The token is valid for `ms` more. */
  tokenValidFor(ms) {
    return Boolean(this.tokens?.accessToken) && this.tokens.expiresAt - ms > this.now();
  }

  /**
   * How long before its end the token is renewed: 5 minutes, or a tenth of
   * its lifetime when that is shorter (a 5-minute token is not renewed
   * before every request).
   */
  get margin() {
    const lifetime = this.tokens?.lifetime ?? TIMINGS.tokenLifetime;
    return Math.min(TIMINGS.tokenMargin, Math.max(1_000, Math.floor(lifetime / 10)));
  }

  /** When the token should be renewed (its expiry minus the margin), or undefined. */
  get renewAt() {
    return this.tokens?.accessToken && this.tokens.refreshToken
      ? this.tokens.expiresAt - this.margin
      : undefined;
  }

  /** A full sign-in with the password. */
  async signIn() {
    if (!this.hasCredentials) {
      throw new FluidraError('no_credentials', 'no e-mail or password');
    }
    const { username } = this;
    const tokens = await this.cognito.signIn(username, this.password);
    if (this.username !== username) {
      throw new FluidraError('network', 'the account changed during the sign-in');
    }
    this.tokens = tokens;
    await this.changed();
    return tokens;
  }

  /**
   * A valid token: the current one, else renewed from the refresh token,
   * else (once per cycle) a new sign-in. One renewal at a time.
   */
  token({ force = false, signIn = true, validity, timeout } = {}) {
    if (!force && this.tokenValidFor(validity ?? this.margin)) {
      return Promise.resolve(this.tokens.accessToken);
    }
    if (!this.renewing) {
      this.renewing = this.renew({ signIn, timeout }).finally(() => {
        this.renewing = undefined;
      });
    }
    return this.renewing;
  }

  async renew({ signIn, timeout }) {
    if (this.tokens?.refreshToken) {
      const before = this.tokens;
      try {
        const tokens = await this.cognito.refresh(before, { timeout });
        if (this.tokens === before) {
          this.tokens = tokens;
          await this.changed();
        }
        if (!this.tokens?.accessToken) {
          throw new FluidraError('network', 'the account changed during the renewal');
        }
        return this.tokens.accessToken;
      } catch (err) {
        if (err.kind !== 'refresh_refused') {
          throw err;
        }
        // Never renewed again with a refused refresh token: the password signs in.
        if (this.tokens === before) {
          this.tokens = null;
          await this.changed();
        }
      }
    }
    if (!signIn) {
      throw new FluidraError('unauthorized', 'no valid token');
    }
    if (this.signedInThisCycle) {
      throw new FluidraError('session_refused', 'the session was refused after a new sign-in');
    }
    this.signedInThisCycle = true;
    const tokens = await this.signIn();
    return tokens.accessToken;
  }

  /** One request to the Fluidra API with a given token. */
  async send(method, route, token, { query, payload, timeout, startBy } = {}) {
    if (startBy !== undefined && this.now() > startBy) {
      throw new FluidraError('late', 'the command deadline passed');
    }
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': API.userAgent,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const search = query ? `?${new URLSearchParams(query)}` : '';
    const answer = await this.transport(`${this.apiUrl}/${route}${search}`, {
      method,
      headers,
      body,
      timeout:
        (typeof timeout === 'function' ? timeout() : timeout) ??
        this.timeout ??
        TIMINGS.requestTimeout,
    });
    const error = apiError(answer, this.now());
    if (error) {
      throw error;
    }
    return parseJson(answer.body);
  }

  /**
   * An authenticated call. A refused token (401; also 403 on the account
   * endpoint, `account`) is renewed once (refresh token first) and the call
   * tried once more; refused again it is `session_refused` (401) or
   * `forbidden` (403: a block, not the token) and the caller stops or pauses.
   * `retry: false` (commands): a refused token is never retried, the command
   * is refused.
   */
  async call(
    method,
    route,
    { retry = true, signIn = true, validity, account = false, ...options } = {},
  ) {
    const refusedToken = (err) =>
      err.kind === 'unauthorized' || (account && err.kind === 'forbidden');
    const token = await this.token({ signIn, validity });
    try {
      return await this.send(method, route, token, options);
    } catch (err) {
      if (!refusedToken(err) || !retry) {
        if (err.kind === 'unauthorized' && this.tokens?.accessToken === token) {
          // The next call renews it first.
          this.tokens = { ...this.tokens, expiresAt: 0 };
        }
        throw err;
      }
      if (this.renewedThisCycle) {
        throw err.kind === 'forbidden'
          ? err
          : new FluidraError('session_refused', 'the token was refused again', {
              status: err.status,
            });
      }
    }
    this.renewedThisCycle = true;
    const renewed = await this.token({ force: true, signIn });
    try {
      return await this.send(method, route, renewed, options);
    } catch (err) {
      if (err.kind === 'unauthorized') {
        throw new FluidraError('session_refused', 'the token was refused again', {
          status: err.status,
        });
      }
      throw err;
    }
  }

  /** The pools of the account (`GET /generic/users/me/pools`). */
  async pools(options = {}) {
    const pools = parsePools(
      await this.call('GET', 'generic/users/me/pools', { account: true, ...options }),
    );
    if (!pools) {
      throw new FluidraError('bad_response', 'Fluidra sent no pool list');
    }
    return pools;
  }

  /** The devices of one pool (`GET /generic/devices?poolId=…&format=tree`). */
  async tree(poolId, options = {}) {
    const devices = parseTree(
      await this.call('GET', 'generic/devices', {
        query: { poolId, format: 'tree' },
        ...options,
      }),
      poolId,
    );
    if (!devices) {
      throw new FluidraError('bad_response', 'Fluidra sent no device list');
    }
    return devices;
  }

  /** Every component of a device in one request (the app's own call). */
  async components(deviceId, options = {}) {
    const components = parseComponents(
      await this.call('GET', `generic/devices/${path(deviceId)}/components`, {
        query: { ...CONNECTED, details: 'true' },
        ...options,
      }),
    );
    if (!components) {
      throw new FluidraError('bad_response', 'Fluidra sent no component');
    }
    return components;
  }

  /** One component of a device: `{ reported, desired }`. */
  async component(deviceId, componentId, options = {}) {
    const data = await this.call(
      'GET',
      `generic/devices/${path(deviceId)}/components/${path(componentId)}`,
      { query: CONNECTED, ...options },
    );
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new FluidraError('bad_response', 'Fluidra sent no component');
    }
    const value = { reported: data.reportedValue, desired: data.desiredValue };
    if (Number.isFinite(data.ts) && data.ts > 0) {
      value.ts = data.ts;
    }
    return value;
  }

  /** Writes a component (`PUT …/components/{id}` `{ desiredValue }`): never retried. */
  async setComponent(deviceId, componentId, value, options = {}) {
    return this.call('PUT', `generic/devices/${path(deviceId)}/components/${path(componentId)}`, {
      retry: false,
      signIn: false,
      query: CONNECTED,
      payload: { desiredValue: value },
      ...options,
    });
  }
}
