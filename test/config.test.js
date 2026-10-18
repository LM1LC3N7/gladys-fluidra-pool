import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, accountKey, normalizeConfig } from '../src/config.js';

test('normalizeConfig: the defaults, commands off', () => {
  const config = normalizeConfig();
  assert.equal(config.allowCommands, false);
  assert.equal(config.pollInterval, DEFAULTS.poll_interval);
  assert.equal(config.language, 'fr');
  assert.equal(config.account, '');
});

test('normalizeConfig: types forced, interval bounded, password kept as typed', () => {
  const config = normalizeConfig({
    username: '  me@example.com ',
    password: ' secret ',
    allow_commands: 'true',
    poll_interval: '5',
    language: 'EN',
  });
  assert.equal(config.username, 'me@example.com');
  assert.equal(config.password, ' secret ');
  assert.equal(config.allowCommands, true);
  assert.equal(config.pollInterval, 60);
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, 900);
  assert.equal(normalizeConfig({ allow_commands: 'false' }).allowCommands, false);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
});

test('accountKey is a hash, never the e-mail', () => {
  const key = accountKey('me@example.com');
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.ok(!key.includes('example'));
  assert.equal(accountKey(''), '');
});
