# gladys-fluidra-pool

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Fluidra Pool** equipment (AstralPool, Zodiac…), through the Fluidra cloud
(the unofficial API of the Fluidra Pool app): chlorinators and water
analysers (water temperature, pH, ORP, salinity, free chlorine, production),
filtration pumps (running, speed), heat pumps (water temperature, setpoint,
mode) and pool lights. The pump speed, the lights and the heat pump setpoint
stay read only until the user allows commands; no chemical dosing command.
Unofficial, not affiliated with Fluidra.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Unofficial API, tested against a fake
> Fluidra cloud only, never with a real account or device.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (FluidraApp) ⇄ src/client.js ⇄ api.fluidra-emea.com
                                   │                           └─ src/cognito.js ⇄ cognito-idp.eu-west-1
                                   ├─ src/fluidra.js    answers, profiles, decoding (pure)
                                   ├─ src/devices.js    -> Gladys devices and states (pure)
                                   ├─ src/store.js      /data: tokens, pauses, stops
                                   └─ src/publisher.js  300 states/min
```

- **Sign-in** (as foXaCe/Fluidra-pool): AWS Cognito `USER_PASSWORD_AUTH` on
  the public app client of the Fluidra Pool app, over HTTPS. The bearer of the
  API is the **access token**, renewed 5 minutes before it expires with
  `REFRESH_TOKEN_AUTH` by a timer of its own; a refused refresh token is
  dropped and the password signs in once. Any challenge (a code, a new
  password, another step) stops the integration; a code challenge is never
  retried by itself. A 429 of the Fluidra API never stops the renewals; one of
  Cognito does. Tokens are kept in `/data/fluidra-state.json` (0600) with a
  hash of the e-mail. The User-Agent is `gladys-fluidra-pool/0.1`: no
  impersonation of the app, no TLS fingerprinting.
- **Reading**, every 60 s (60 to 900): `GET /generic/users/me/pools`, then
  `GET /generic/devices?poolId=…&format=tree` per pool, then
  `GET /generic/devices/{id}/components?deviceType=connected&details=true` per
  supported device (component by component when that call is refused for a
  device). A 401 (or a 403 on the pools) renews the token once and retries
  once (again: `session_refused`, spaced new tries, or a 30-minute pause on a
  403). An error on one pool or one device marks only it. 429: a pause of
  Retry-After between 60 s and 6 h for every path; pauses and stops are kept
  in `/data` and capped when read back. Network errors: 1, 2, 5, 10, 15 min,
  never under the interval.
- **Profiles** (`src/fluidra.js`, from foXaCe `device_registry`): the
  serial, the Fluidra family id (`thingType`), the name, the family label and
  the component-7 signature pick a profile; the tecnoLC2 register signature
  catches a chlorinator without a family id. No profile, no read: never a
  value under a guessed meaning. Each value is range-checked; pH, ORP and
  salinity at 0 mean "no reading".
- **Devices**: `ext:<selector>:fluidra:<cloud id>`. Features by role:
  `water-temperature`, `ph`, `orp`, `free-chlorine`, `salinity`, `level`,
  `production` (chlorinators, those seen with a value), `running`,
  `auto-mode`, `speed` (text/select, writable) on the E30iQ, `speed-percent`
  and `power` on the Victoria, `running`, `water-temperature`,
  `air-temperature`, `setpoint` (thermostat, writable), `mode` (text) on the
  heat pumps, `light` (light/binary, writable). A republished device keeps
  the features it was created with.
- **Commands** (`PUT /generic/devices/{id}/components/{c}` `{ desiredValue }`),
  behind `allow_commands`: a fresh read of the device first (refused when it
  fails or lacks the value; nothing sent when already in the asked state), the
  option checked again right before sending, one at a time per device, every
  request sent by 3.4 s after the arrival and answered by 4.6 s; a write
  without an answer is "sent, without confirmation", then read again after 5,
  20 and 60 s. Pump: refused in automatic mode; off = c9 0, a level = c11, a
  level on a stopped pump = c9 1 then c11. Light: c11 `"1"`/`"0"`. Setpoint:
  ×10 on the profile's register, 35 °C at most.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/fluidra.js` holds a made-up account shaped like what
foXaCe/Fluidra-pool reads; `test/helpers/fakeFluidra.js` is a fake Cognito and
a fake Fluidra API behind the transport. `node scripts/cover.mjs cover.png`
draws the store cover.

## Credits

- [foXaCe/Fluidra-pool](https://github.com/foXaCe/Fluidra-pool) (MIT): the
  API, the Cognito client, the device tree, the profiles and their registers
  are ported to JavaScript.
- Notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the ported logic is MIT
(foXaCe/Fluidra-pool), see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Fluidra, AstralPool and Zodiac are trademarks of their owners; this project is
not affiliated with Fluidra.
