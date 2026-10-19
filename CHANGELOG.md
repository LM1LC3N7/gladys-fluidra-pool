# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-19

### Added

- Fluidra Pool equipment through the Fluidra cloud (unofficial API, ported
  from foXaCe/Fluidra-pool): every pool of the account, its device tree,
  bridges replaced by the devices behind them.
- Sign-in with the e-mail and the password through AWS Cognito, as the app;
  the token is renewed from the refresh token by a timer, without a new
  sign-in at each read; the tokens are kept in `/data` (0600) so a restart
  does not sign in again.
- Profiles checked by the users of the Home Assistant integration only: an
  unknown equipment is counted in the status, never read.
- Chlorinators and water analysers (tecnoLC2, domoticS2, eXO iQ, tecno2, Blue
  Connect): water temperature, pH, ORP, salinity, chlorination setpoint, and
  free chlorine and real production where the unit has them; a probe that
  reads nothing adds no feature.
- E30iQ pump: running, automatic mode, speed (a select); Victoria Smart
  Connect: running, speed (%), power (W).
- Heat pumps (Z250iQ, Z260iQ, Z350iQ, Z550iQ, Z650iQ, LG Eco Elyo, Gre
  HPGIC): running, water and air temperatures, setpoint, mode.
- LumiPlus light: on/off.
- Pump speed, light and heat pump setpoint from Gladys, off by default
  (`allow_commands`); the setpoint is capped at 35 °C; no chemical dosing
  command. Each command reads the device again just before acting, checks the
  option again right before sending, runs one at a time per device, is
  refused when it cannot be sent within 3.5 s, and is answered "sent, without
  confirmation" when Fluidra does not answer.
- Read every 60 s (60 to 900); refused credentials stop the integration with
  a new try after 1 h, 6 h, then every 24 h; a verification code asked stops
  it until the user acts; a 429 pauses every path for 60 s to 6 h, kept across
  restarts; one unreadable device only gets a degraded badge.
- "Test the connection" button; the status and the Discovery list are sent
  again at each reconnection to Gladys.
- Feature names and texts in French or English.
- Commands only to a device identified by its serial, its Fluidra family id
  or its component-7 signature, never by a name, a model or a family alone,
  and never when the family id or the family label contradicts the profile;
  refused when the last device tree says the device is disconnected.
- The backoff after Fluidra errors is kept across restarts (15 min at most);
  after 3 refusals (HTTP 403) in a row with a fresh session, the status says
  Fluidra may be filtering this client (the integration never imitates the
  app).
- Free chlorine and real production of tecnoLC2 chlorinators only on the
  units known to have them; a Victoria pump priming counts as running.

[Unreleased]: https://github.com/LM1LC3N7/gladys-fluidra-pool/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-fluidra-pool/releases/tag/v0.1.1
