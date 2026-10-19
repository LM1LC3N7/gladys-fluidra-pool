// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never the e-mail nor the password:
//   - the Cognito tokens (access and refresh) with the account they belong to
//     (a hash of the e-mail): a restart does not sign in again;
//   - the pauses (429, 403, the backoff after 5xx and network errors), the
//     403s in a row, and the stops (refused credentials and their next try, a
//     code asked), bounded when read back.
// The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { TIMINGS } from './constants.js';
import { parseJson } from './http.js';

export const STATE_FILE = '/data/fluidra-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return parseJson(await readFile(path, 'utf8')) ?? null;
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        // Written and flushed to the disk before the rename: a power cut never
        // leaves an empty or half-written file in place of the tokens.
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);
const text = (value) =>
  typeof value === 'string' && value !== '' && value.length < 16384 ? value : undefined;

/**
 * 'rate' (429) and 'forbidden' (403) hold every path; 'backoff' (Fluidra
 * unreachable, 5xx) holds the reads only. Each is capped when read back.
 */
const PAUSE_CAPS = {
  rate: TIMINGS.rateLimitMax,
  forbidden: TIMINGS.forbiddenPause,
  backoff: TIMINGS.backoff.at(-1),
};
const PAUSE_KINDS = Object.keys(PAUSE_CAPS);
export const BLOCK_KINDS = [
  'refused',
  'two_factor',
  'new_password',
  'unsupported_challenge',
  'session_refused',
];

/**
 * The persisted state, repaired; the end of a pause or of a stop is capped
 * from `now`, so a clock jump or a hand-edited file never stops for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const account = typeof raw?.account === 'string' ? raw.account : '';
  const t = raw?.tokens;
  const tokens =
    account && t && (text(t.accessToken) || text(t.refreshToken))
      ? {
          accessToken: text(t.accessToken),
          refreshToken: text(t.refreshToken),
          expiresAt: time(t.expiresAt) ?? 0,
          lifetime: time(t.lifetime) ? Math.min(t.lifetime, 24 * 3600 * 1000) : undefined,
        }
      : null;
  const p = raw?.pause;
  const pause =
    PAUSE_KINDS.includes(p?.kind) && time(p.until)
      ? {
          kind: p.kind,
          source: p.source === 'cognito' ? 'cognito' : 'api',
          until: Math.min(p.until, now + PAUSE_CAPS[p.kind]),
          // The backoff step reached (1, 2, 5, 10, 15 min): the next failure goes on from it.
          ...(p.kind === 'backoff'
            ? {
                failures:
                  Number.isInteger(p.failures) && p.failures >= 0 ? Math.min(p.failures, 10) : 1,
              }
            : {}),
        }
      : null;
  // The 403s on the account in a row, a fresh token each time (the filtering notice).
  const forbidden =
    Number.isInteger(raw?.forbidden) && raw.forbidden > 0 ? Math.min(raw.forbidden, 100) : 0;
  const b = raw?.block;
  const block =
    account && BLOCK_KINDS.includes(b?.kind)
      ? {
          kind: b.kind,
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          retryAt: time(b.retryAt)
            ? Math.min(b.retryAt, now + TIMINGS.refusedRetry.at(-1))
            : undefined,
          detail:
            typeof b.detail === 'string' && /^[A-Z_]{1,40}$/.test(b.detail) ? b.detail : undefined,
        }
      : null;
  return { account, tokens, pause, block, forbidden };
}
