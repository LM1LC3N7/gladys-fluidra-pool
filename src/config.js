// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  // Pump speed, pool lights and heat pump setpoint from Gladys: off until the
  // user turns them on.
  allow_commands: false,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A checkbox may arrive as a boolean or as a string from a form; absent = its default. */
const flag = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
};

/**
 * The key of an account in /data: a hash of the e-mail, never the e-mail
 * itself. Only tells whether what is kept there belongs to this account.
 */
export const accountKey = (username) =>
  username
    ? createHash('sha256').update(`fluidra:${username}`, 'utf8').digest('hex').slice(0, 32)
    : '';

export function normalizeConfig(raw = {}) {
  const given = raw?.poll_interval;
  const interval = given === undefined || given === null || given === '' ? NaN : Number(given);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  // The e-mail is kept as typed but for the spaces around it.
  const username = String(raw?.username ?? '').trim();
  // The password is kept as typed: spaces may be part of it.
  const password = typeof raw?.password === 'string' ? raw.password : String(raw?.password ?? '');
  return {
    username,
    password,
    account: accountKey(username),
    allowCommands: flag(raw?.allow_commands, DEFAULTS.allow_commands),
    pollInterval: Number.isFinite(interval)
      ? Math.round(Math.max(POLL_INTERVAL.min, Math.min(POLL_INTERVAL.max, interval)))
      : DEFAULTS.poll_interval,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
