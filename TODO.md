# TODO — Fluidra Pool v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session.

## Status

- [x] **Milestone 1 — core** (2026-10-18): Cognito `USER_PASSWORD_AUTH`
      sign-in, access token as the bearer, refresh token renewal by a timer,
      tokens in `/data` (0600); pools, device tree (bridges replaced by their
      children), bulk components with a component-by-component fallback;
      profiles ported from foXaCe/Fluidra-pool (chlorinators and analysers,
      E30iQ and Victoria pumps, seven heat pump families, LumiPlus); features
      and states; commands (pump speed, light, heat pump setpoint) behind
      `allow_commands`, on a fresh read, option checked again before sending,
      one at a time per device, 3.5 s deadline, "sent, without confirmation";
      stops and pauses persisted and capped; badges; test button; en/fr;
      docs; cover. Tested against a fake cloud only (Node 22 and 24). No
      Docker on this PC: the image build is left to the CI.
- [x] **Milestone 1 fixes — review** (2026-10-19): commands only on a strong
      identification nothing contradicts; no command to a disconnected
      device; backoff kept in `/data`; the 403 filtering notice; token margin
      a tenth of a short lifetime; per-serial free chlorine and production;
      Victoria PRIMING; follow-up reads replaced; the code-asked stop kept
      with the account (see "Decisions").
- [ ] **Milestone 2 — real account**: run against a real account, compare
      with the Fluidra Pool app (see "To check"); turn the answers
      (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: the profiles foXaCe adds or verifies later
      (generic pumps, PX50/Pro Elyo/Z950iQ heat pumps, tecnoS3, dosing pumps
      read only, Command Connect cabinet), heat pump on/off and mode commands
      (behind the option, with a no-flow check), light brightness, the
      Victoria quick functions, the realtime WebSocket channel (opt-in).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## Not in v1, on purpose

- **No chemical dosing command** (pH setpoint, ORP setpoint, chlorination
  level, boost, chlorinator mode): bathers' safety. A wrong pH or chlorine
  dose from an automation (or a register misread on an unverified unit) can
  harm the people in the water, and this integration has never run on a real
  device. These values are read only. To reconsider only with a real
  account, a verified profile, and a separate option with hard limits.

## To check on a real account

- The sign-in: `USER_PASSWORD_AUTH` on client `g3njunelkcbtefosqm9bdhhq1`
  (eu-west-1) with the e-mail as typed; the token lifetime; that the API takes
  the **access token**; whether an account with MFA answers `SMS_MFA` /
  `SOFTWARE_TOKEN_MFA` (a stop here).
- **The User-Agent**: the reference sends the Android app's own User-Agent;
  this integration sends `gladys-fluidra-pool/0.1` and **never imitates the
  app** (no workaround of any kind). If the API refuses it (403s in a row
  with fresh tokens), the status says "Fluidra may be filtering this client"
  after 3 of them, the 30-minute pause holds, and the decision goes to the
  maintainer.
- The answers: `users/me/pools` (a list or `{ pools }`), the tree (bridged
  children, `thingType` on children, `type` connected/disconnected), the bulk
  components (shape, `details=true`, the `ts` of each component), whether a
  shared/viewer account gets a 403 or a 200 without effect on a write (the
  docs say commands may be accepted without effect on a shared account).
- The writes: the answer of a `PUT`, how long a change takes to show
  (follow-up reads at 5, 20 and 60 s), the E30iQ start-then-speed sequence
  (foXaCe's speed select writes c9 then c11 without a pause, like this
  integration; its 1 s delay is only in its `start_pump` and
  `enable_auto_mode` helpers), the LumiPlus power as a string.
- **domoticS2**: the generic profile reads the chlorination setpoint on c4
  (the register the app writes). foXaCe reads it back on c164 on the
  Neolysis DM24008702 and on c263 on the Cell Guard LS12 DM24086706, where
  c164 is the real production: until a unit is checked, no production and no
  read-back are shown for the family.
- The `thingType` of each heat pump family (AMT = `amt`, Z650iQ = `nhpp`,
  Z350iQ = `hpc`, Z550iQ = `zs500`) and of the pumps and lights (`eppvs`,
  `mppvs`, `LWM`): a unit whose `thingType` differs is not identified.
  **HPGIC in particular**: foXaCe gives no `thingType` for the Gre HPGIC; it
  is assumed to share the AMT one (`amt`) or to have none. If a real HPGIC
  reports another `thingType`, it is no longer read at all (no profile):
  check it on a real unit and add its value to the profile's `thingTypes`.
- The setpoint ranges (the families' ones, capped at 35 °C) and steps.
- Rate limits: foXaCe met 429s polling every 30 s component by component;
  here one bulk call per device every 60 s.

## Decisions

- **Not a duplicate** (lot 8, reserved in post 275 of the forum thread 10385
  on 2026-10-18): no Fluidra service in the Gladys core nor in the store.
- **Reference reused: foXaCe/Fluidra-pool** (MIT, maintained Home Assistant
  integration, last commit 2026-10-15). Checked: MIT, not GPL. Cloned read
  only in `_ref/fluidra-pool` (its `select/aux.py` cannot be checked out on
  Windows: the tree was exported file by file to `_ref/fluidra-pool-src`).
  Ported, not copied; credited in the README and `THIRD_PARTY_NOTICES.md`
  (full MIT notice, copied into the image). Only runtime dependency: the SDK.
- **The API is the official app's**: AWS Cognito (eu-west-1) with the public
  app client of the Fluidra Pool app, then `api.fluidra-emea.com`, the hosts
  the app uses. No bot-detection bypass and no TLS fingerprinting in the
  reference nor here; the reference sends the app's User-Agent string, this
  integration sends its own (honest) one — to verify (see "To check").
- **Neighbour module**: LM1LC3N7/gladys-edilkamin (Cognito, persisted pauses
  and stops, command safety) and gladys-iaqualink (pool features).
- **Profiles: only what foXaCe's users checked.** Fluidra gives no model and
  the same component means different things per family. The identification
  is foXaCe's scoring (serial 50, `thingType` 25, name 30, family 20, model
  20 against the name, coarse type 10, component-7 signature 100 for LG and
  Z260iQ, the tecnoLC2 c8/c172 signature). Left out on purpose: foXaCe's
  catch-all profiles (`generic_pump`, `generic_heat_pump`, the legacy
  `chlorinator` layout), the `amt` and `nhpp` heat pump families (foXaCe
  leaves them undeclared), the serial-specific chlorinator list (the
  tecnoLC2 `thingType` and signature cover the standard layout; the two
  serials whose layout differs, CC24058902 and the bridged Energy Connect
  CC24054221/CC24041107, have their own profile). An equipment without a
  profile is counted in the status and logged once (family and `thingType`
  only), never read.
- **Contradictions and strong signals (review, milestone 1 fixes).** A
  profile is never used when the `thingType` contradicts it (AMT layout:
  `amt` or none; Z650iQ: `nhpp`; Z350iQ: `hpc`; Z550iQ: `zs500`; E30iQ:
  `eppvs`; Victoria: `mppvs`; LumiPlus: `LWM`) or when the family label is of
  another coarse type (a Chlorinators entry is never a heat pump); `classify`
  reads the family first, the name only when the family says nothing. A
  command (setpoint, speed, light) needs a strong signal of the profile
  itself: its serial, its `thingType`, its component-7 signature (LG
  BXWAA/BXWAB, HPGIC CXWAB with its LG serial, Z260iQ BXWAD), or for
  LumiPlus `LWM` or a "lumiplus" name; a name, a model or a family alone
  leaves the device read only. The LumiPlus family pattern ("light") was
  dropped. Free chlorine (c178) and production (c154) only on the serials
  foXaCe maps them on.
- **No command to a device the last tree says disconnected** (a dedicated
  refusal). A bridged child reported disconnected whose component `ts` moved
  since the last read is taken as live (foXaCe sensor/chlorinator.py); a
  missing or unchanged `ts` is not.
- **The backoff** after 5xx and network errors is kept in `/data`
  (`{ kind: 'backoff', until, failures }`), capped at 15 minutes when read
  back; it holds the reads only (commands and the test button are not held).
- **403s in a row on the account** (each with a fresh token) are counted in
  `/data`; from 3, the status says Fluidra may be filtering this client. One
  renewal per try, the 30-minute pause kept, never a refresh loop.
- **Token margin**: 5 minutes, or a tenth of the token lifetime when that is
  shorter (Cognito may give short tokens).
- **A verification code stop stays with the account hash**: a configuration
  without credentials erases the tokens from `/data` but keeps the account
  hash, the stop and the pause; new credentials for the same account do not
  lift it; only the test button tries again.
- **Weakly identified devices**: all their roles are published, the
  setpoint, speed and light with `read_only: true` (`!canWrite`; not part of
  the core's structure signature, so no feature is lost); `canWrite` is
  checked when the command arrives and again after its wait in the queue.
- **Follow-up reads**: a new command replaces those of the previous one.
- **A device keeps the profile found first in a session** (features and
  their meaning must not change between two reads); a restart identifies
  again.
- **Values checked**: numbers only (null, '', true are not 0), ranges per
  quantity; pH, ORP and salinity at 0 are "no reading" (foXaCe
  `_ZERO_IS_NOT_A_REAL_READING`); a chlorinator feature exists only once a
  value was seen, and a republished device keeps the features it was created
  with (read from `gladys.devices`).
- **Units**: celsius (temperature-sensor, thermostat), ph (ph-sensor),
  millivolt (orp-sensor), watt (energy-sensor/power): the only ones the core
  lists. Salinity (g/L), free chlorine (mg/L) and the percentages are
  `unknown/unknown` without a unit (none listed): the unit is in the name.
- **Commands behind one option** `allow_commands` (off by default, brief):
  refused before any request when off, checked again right before sending.
  Pump speed is a `text/select` (off, low, medium, high, auto shown only);
  the light is `light/binary` as the brief asks for a switch (a pool light
  turned on or off by an "everything on/off" is harmless; the pump is never a
  switch, so no "everything off" stops the filtration); the setpoint is a
  `thermostat/target-temperature` without any thermostat mode feature.
- **Pump**: refused while the auto mode (c10) is on (the schedule would fight
  Gladys); "off" = c9 0; a level on a running pump = c11; a level on a
  stopped pump = c9 1 then c11 within the same deadline; if the second write
  fails, the message says the pump was started and what became of the speed.
  Victoria pumps (schedule-driven) are read only.
- **Setpoint**: the family's range (foXaCe climate_behaviors), capped at
  35 °C (a pool, not a hot tub: lesson "hot water ceiling"), the family's
  step; strict values; ×10 on the family's setpoint register.
- **Command safety** (lessons): a fresh read of the device before acting
  (bulk or component by component, 2.5 s at most), never a decision on
  memory; refused when the value is missing; nothing sent when already in the
  asked state (absolute values, no toggle, so no guard is needed); one
  command at a time per device; a command not sent 3.4 s after its arrival is
  refused; a write without an answer is "sent, without confirmation" plus
  follow-up reads; a refused write says so; the ack never waits for Gladys
  (the publication is not awaited). The token must be valid 60 s more for a
  command, renewed by the timer 5 minutes before its end.
- **Errors**: 401 renews once and retries once; on the account endpoint a
  403 does too (expired token), and a 403 again with a fresh token is a
  30-minute pause (WAF); a 403/404/5xx/timeout on one pool or device marks
  only it (degraded badge); no device answering is "unreachable" (backoff 1,
  2, 5, 10, 15 min, never under the interval); 429 = Retry-After between 60 s
  and 6 h (5 min when absent) for every path, persisted and capped; refused
  credentials = stop with a new try after 1 h, 6 h, then every 24 h; any
  Cognito challenge = stop (a code challenge is never retried by itself:
  each sign-in could send a code); a reconnection to Gladys keeps the pauses,
  the stops and the tokens.
- **Status and Discovery at each `connected`**: the deduplication caches are
  cleared and sent again.
- **Offline**: the cloud misreports a healthy device as disconnected now and
  then (foXaCe `OFFLINE_GRACE_POLLS`): two reports in a row before a degraded
  badge; the values are still published (they are the cloud's last ones).
- **Answers bounded**: 1 MB read at most, JSON depth 12, `__proto__`,
  `constructor`, `prototype` keys dropped, 10 pools, 50 devices, 600
  components, ids checked (`[A-Za-z0-9._-]`, 64 characters), texts 120
  characters without control characters.
- **Logs**: never a password, token, e-mail, whole serial (last 4 characters)
  nor device name.
- **Region**: EMEA only, as the reference (its multi-region design is not
  done).
- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag: the one-time exception to "versions
  belong to the Release workflow"; the first patch release gives 0.1.1.
- **LICENSE**: the standard Apache-2.0 text (appendix placeholder, no
  personal name), copied into the image with `THIRD_PARTY_NOTICES.md`.
- **The app's Cognito client id** is in `src/constants.js`, as in the
  reference: a public constant of the app, not a secret of the user.
- **Demo files of the template** (devices, scenes, widgets, weather and their
  tests) removed.
