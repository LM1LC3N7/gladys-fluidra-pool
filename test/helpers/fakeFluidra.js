// -----------------------------------------------------------------------------
// A fake AWS Cognito and a fake Fluidra EMEA API behind the transport the
// integration is given (no network): USER_PASSWORD_AUTH and refresh tokens,
// the pools, the device tree, the components (bulk and one by one) and their
// writes. Records every request.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { COGNITO } from '../../src/constants.js';
import { FluidraError } from '../../src/http.js';
import { HOUR, IDS, PASSWORD, POOL_ID, USERNAME, components, tree } from '../fixtures/fluidra.js';

export const COGNITO_URL = 'https://cognito.test/';
export const API_URL = 'https://api.test';

const json = (status, body, headers = {}) => ({
  status,
  headers,
  body: body === undefined ? '' : JSON.stringify(body),
});
const cognitoError = (type, message, status = 400) => json(status, { __type: type, message });

export function fakeFluidra({ lifetime = HOUR, challenge, bulk = true } = {}) {
  const server = {
    username: USERNAME,
    password: PASSWORD,
    lifetime,
    /** A Cognito challenge instead of tokens (e.g. 'SMS_MFA'), or none. */
    challenge,
    /** false: the bulk component call answers 404 (read one by one). */
    bulk,
    pools: [{ id: POOL_ID, name: 'Ma piscine' }],
    tree: tree(),
    components: components(),
    requests: [],
    access: new Map(),
    refresh: new Set(),
    /** Every token ever made, to check none reaches the logs. */
    secrets: [],
    down: false,
    /** One-shot answers: { match(request), status, body, headers, before(), throws } */
    queue: [],
    signIns() {
      return this.requests.filter((r) => r.flow === 'USER_PASSWORD_AUTH');
    },
    refreshes() {
      return this.requests.filter((r) => r.flow === 'REFRESH_TOKEN_AUTH');
    },
    api() {
      return this.requests.filter((r) => r.host === 'api.test');
    },
    writes() {
      return this.requests
        .filter((r) => r.method === 'PUT')
        .map((r) => ({
          id: r.path.split('/')[3],
          component: Number(r.path.split('/')[5]),
          ...r.body,
        }));
    },
    issue() {
      const access = `access-${randomBytes(8).toString('hex')}`;
      const refresh = `refresh-${randomBytes(8).toString('hex')}`;
      this.access.set(access, Date.now() + this.lifetime);
      this.refresh.add(refresh);
      this.secrets.push(access, refresh);
      return { access, refresh };
    },
    revoke() {
      this.access.clear();
      this.refresh.clear();
    },
    set(id, component, value) {
      this.components[id][component] = value;
    },
  };

  const result = ({ access, refresh }, withRefresh = true) => {
    const id = `id-${randomBytes(8).toString('hex')}`;
    server.secrets.push(id);
    return {
      AuthenticationResult: {
        AccessToken: access,
        IdToken: id,
        ...(withRefresh ? { RefreshToken: refresh } : {}),
        ExpiresIn: Math.round(server.lifetime / 1000),
        TokenType: 'Bearer',
      },
      ChallengeParameters: {},
    };
  };

  function cognito(request) {
    const body = request.body ?? {};
    if (body.ClientId !== COGNITO.clientId) {
      return cognitoError('ResourceNotFoundException', 'User pool client does not exist.');
    }
    if (request.target === 'InitiateAuth' && body.AuthFlow === 'USER_PASSWORD_AUTH') {
      const { USERNAME: name, PASSWORD: password } = body.AuthParameters ?? {};
      if (name !== server.username || password !== server.password) {
        return cognitoError('NotAuthorizedException', 'Incorrect username or password.');
      }
      if (server.challenge) {
        const session = `session-${randomBytes(8).toString('hex')}`;
        server.secrets.push(session);
        return json(200, {
          ChallengeName: server.challenge,
          Session: session,
          ChallengeParameters: {},
        });
      }
      return json(200, result(server.issue()));
    }
    if (request.target === 'InitiateAuth' && body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
      const { REFRESH_TOKEN } = body.AuthParameters ?? {};
      if (!server.refresh.has(REFRESH_TOKEN)) {
        return cognitoError('NotAuthorizedException', 'Refresh Token has expired');
      }
      const issued = server.issue();
      server.refresh.delete(issued.refresh);
      return json(200, result(issued, false));
    }
    return cognitoError('InvalidParameterException', 'unexpected request');
  }

  const componentOf = (id, c) => ({
    id: c,
    reportedValue: server.components[id][c],
    desiredValue: server.components[id][c],
    ts: 1_787_767_038,
  });

  function api(request) {
    const token = String(request.headers.Authorization ?? '').replace(/^Bearer /, '');
    const exp = server.access.get(token);
    if (exp === undefined || Date.now() >= exp) {
      return json(401, { message: 'Unauthorized' });
    }
    const { method, path, query } = request;
    if (method === 'GET' && path === '/generic/users/me/pools') {
      return json(200, server.pools);
    }
    if (method === 'GET' && path === '/generic/devices') {
      if (query.get('poolId') !== POOL_ID || query.get('format') !== 'tree') {
        return json(404, { message: 'Not found' });
      }
      return json(200, server.tree);
    }
    let match = /^\/generic\/devices\/([^/]+)\/components$/.exec(path);
    if (method === 'GET' && match) {
      const id = decodeURIComponent(match[1]);
      if (!server.components[id] || !server.bulk || query.get('details') !== 'true') {
        return json(404, { message: 'Not found' });
      }
      return json(
        200,
        Object.keys(server.components[id]).map((c) => componentOf(id, Number(c))),
      );
    }
    match = /^\/generic\/devices\/([^/]+)\/components\/(\d+)$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const c = Number(match[2]);
      if (!server.components[id] || query.get('deviceType') !== 'connected') {
        return json(404, { message: 'Not found' });
      }
      if (method === 'GET') {
        return c in server.components[id]
          ? json(200, componentOf(id, c))
          : json(404, { message: 'Not found' });
      }
      if (method === 'PUT') {
        server.components[id][c] = request.body?.desiredValue;
        return json(200, componentOf(id, c));
      }
    }
    return json(404, { message: 'Not found' });
  }

  server.transport = async (url, { method = 'GET', headers = {}, body, timeout } = {}) => {
    const target = new URL(url);
    const parsed = body === undefined ? undefined : JSON.parse(body);
    const request = {
      method,
      host: target.host,
      path: target.pathname,
      query: target.searchParams,
      headers,
      body: parsed,
      timeout,
      target: headers['X-Amz-Target']?.replace('AWSCognitoIdentityProviderService.', ''),
      flow: parsed?.AuthFlow,
    };
    server.requests.push(request);
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      const [entry] = server.queue.splice(forced, 1);
      await entry.before?.();
      if (entry.throws) {
        throw entry.throws;
      }
      if (entry.status) {
        return json(entry.status, entry.body, entry.headers);
      }
    }
    if (server.down) {
      throw new FluidraError('network', 'connection refused');
    }
    if (target.host === 'cognito.test') {
      return cognito(request);
    }
    if (target.host === 'api.test') {
      return api(request);
    }
    return json(404, {});
  };

  return server;
}

/** Matches a request to the components of a device (bulk or one), or a write. */
export const to = {
  pools: (r) => r.path === '/generic/users/me/pools',
  tree: (r) => r.path === '/generic/devices',
  bulk: (id) => (r) =>
    r.method === 'GET' && r.path === `/generic/devices/${encodeURIComponent(id)}/components`,
  write: (r) => r.method === 'PUT',
  cognito: (r) => r.host === 'cognito.test',
};

export { IDS };

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
