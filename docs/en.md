# Fluidra Pool

Unofficial integration, not affiliated with Fluidra. It brings into Gladys the
pool equipment linked to the **Fluidra Pool** app (AstralPool, Zodiac and the
other brands of the Fluidra group), through the Fluidra cloud the app uses.

> **Warning: unofficial API, this integration has never been tested with a
> real account nor a real device.** It was written from the Fluidra-pool Home
> Assistant integration (foXaCe) and tested against a fake Fluidra cloud
> only. Fluidra may change its API at any time. Feedback is welcome.

## What you get

Fluidra gives no model: every device exposes numbered registers whose meaning
changes with the family. The integration only reads the families whose
registers were checked by users of the Home Assistant integration. **An
equipment it does not recognize is counted in the status of the integration
but never read**: no value is ever shown under a wrong name.

| Equipment                                                                            | Features                                                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| tecnoLC2 chlorinators (Energy Connect, Clear Connect, Ei2 iQ, GenSalt OE iQ, iSalt…) | Water temperature, pH, ORP (redox), salinity (g/L), chlorination setpoint (%); free chlorine and real production on a few units |
| domoticS2 chlorinators (Elite Connect, Neolysis…), eXO iQ, eXPERT (tecno2)           | Depending on the family: temperature, pH, ORP, salinity, setpoint and production (%)                                            |
| Blue Connect analysers (Silver, Gold)                                                | Temperature, pH, ORP; salinity on the Gold                                                                                      |
| E30iQ filtration pump (and Inari VS, Verdon VS)                                      | Running, automatic mode (schedule), **speed** (off, low, medium, high, automatic)                                               |
| Victoria Smart Connect VS pump                                                       | Running, speed (%), power (W)                                                                                                   |
| Z250iQ, Z260iQ, Z350iQ, Z550iQ(+), Z650iQ, Eco Elyo (LG), Gre HPGIC heat pumps       | Running, water temperature, air temperature (depending on the model), **setpoint**, mode (text)                                 |
| LumiPlus Connect lights                                                              | **Light** (on/off)                                                                                                              |

An absent probe (no ORP, no free chlorine) creates no feature: it only shows
once a real value was read. A pH, ORP or salinity of 0 is taken as "no
reading". Free chlorine (mg/L) and the real production (%) of a tecnoLC2 are
read only on the units whose owners showed those registers to the Home
Assistant integration (Ducere 21 LC24008202, Clear Connect CC24018202,
CC24042517, CC24058902; production on the bridged Energy Connect CC24054221
and CC24041107): on the others the same registers may hold nothing, so they
are not shown. On a domoticS2, the setpoint shown is the one asked (the
register the app writes); its read-back and production registers differ
from one unit to another, so they are not shown.

**Commands only for a well identified device.** The pump speed, the light
and the setpoint can be sent only to a device identified by its serial
number, its Fluidra family id (`thingType`) or the signature the heat pump
reports, never by its name, its model or its family alone, and never when
what Fluidra says contradicts it (for example a family id of another model).
Such a device is shown with all its features, but its setpoint, speed and
light are read only (no command is sent to it).

The badge of each device shows "cloud", or "unreachable" (with an orange dot)
when that device could not be read, or when Fluidra says it is disconnected
two reads in a row.

## Installation

1. Your equipment must work in the **Fluidra Pool** app.
2. In Gladys, install the Fluidra Pool integration, enter the **e-mail** and
   the **password** of the Fluidra Pool app, then save.
3. Add the equipment from the **Discovery** tab.

The two-step sign-in (a code by SMS or e-mail) is not handled: turn it off in
the app if it is on.

## Commands and safety

Commands are **off by default**: everything is shown, nothing is changed. Turn
**Allow commands from Gladys** on to allow:

- the **speed of the E30iQ pump** (a list: off, low, medium, high). Choosing
  a speed on a stopped pump starts it, then sets the speed. Refused while the
  pump follows its schedule (automatic mode): that mode is set in the app;
- the LumiPlus **light** (on, off);
- the **heat pump setpoint**, within the range of its model and **35 °C at
  most**, by steps of 1 °C (0.5 °C on the Z650iQ).

**No chemical dosing command** (pH, chlorine, chlorinator production, boost):
wrong dosing puts the bathers at risk, and the integration has never been
tested on a real device. Those values are only shown.

Before each command, the integration **reads the device again** in the
cloud: the command is refused when that read fails or lacks the value, and
nothing is sent when the device is already in the asked state. The permission
is checked again right before sending. The commands of one device run one at
a time. A command that cannot be sent within **3.5 seconds** of its arrival
is refused (Gladys shows a failure after 5 seconds). When Fluidra does not
answer in time, Gladys shows "The command was sent, without a confirmation
from Fluidra": check the device, it is read again within seconds. A command
is refused, nothing sent, when the last list of the equipment says the
device is not connected.

A success only means that the Fluidra cloud accepted the request, not that
the device applied it: the reads after the command (5, 20 and 60 seconds)
show its real state. In particular, an account with which the pool is
**shared** (a guest of the owner's account) may be read only on Fluidra's
side: Fluidra may answer a command with a success while nothing changes. Use
the owner's account for commands.

Once allowed, a scene or a dashboard can send these commands while nobody is
there: stopping the filtration, for one, also stops the water flow to the
chlorinator and the heat pump.

## Password, tokens and privacy

- The password is **kept by Gladys in its database, never shown again, and
  sent only to Fluidra** (its AWS Cognito sign-in service, over HTTPS), as the
  app does.
- Signing in gives tokens: the access token (about one hour) is renewed with
  the refresh token, without the password, 5 minutes before it ends (a
  tenth of its lifetime when that is shorter). The
  tokens are kept in the `/data` volume of the integration (a file readable
  by the container user only) so a restart does not sign in again. On the
  Gladys host, that volume is the folder
  `<Gladys base folder>/external-integrations/<selector>`, **not in the Gladys
  backups**, deleted when the integration is uninstalled. **The refresh token
  gives access to the account** while it is valid: protect that host. The
  e-mail and the password are never written there; another e-mail, or an
  e-mail or password emptied in the configuration, erases the tokens (a
  "verification code" stop stays with the account).
- Nothing reaches the logs: no password, token, e-mail nor whole serial
  number (its last 4 characters only).
- Everything goes over HTTPS to `cognito-idp.eu-west-1.amazonaws.com` (the
  sign-in) and `api.fluidra-emea.com` (the equipment). The integration says it
  is "gladys-fluidra-pool": it does not pretend to be the app.

## Refresh

The account is read every 60 seconds by default (60 to 900): the list of the
pools, the equipment of each pool, then the registers of each recognized
equipment (one request each). Three reads follow a command (after 5, 20 and
60 seconds); a new command replaces the reads still due for the previous
one.

## Errors

- **Password refused** (or account not confirmed): the integration stops; one
  new try after 1 h, 6 h, then every 24 h, or at once when you save a
  **changed** e-mail or password, or click **Test the connection** (saving
  the same e-mail and password again does not try again).
- **A verification code, or any other sign-in step** (but a new password):
  not handled. The integration stops and never signs in again by itself (each
  sign-in could send a code); click **Test the connection** once the two-step
  sign-in is off. For a verification code, the stop stays with the account:
  emptying the configuration, or typing the same e-mail with another
  password, does not lift it; only the button does.
- **Fluidra asks to slow down** (429): a pause of at least 1 minute
  (Retry-After when given, 6 h at most), for every read and command, kept
  across restarts.
- **HTTP 403 on the account** despite a fresh token: a 30-minute pause (one
  renewal of the token per try at most, never a loop). After 3 in a row, the
  status says that **Fluidra may be filtering this client**: the integration
  says who it is ("gladys-fluidra-pool") and never imitates the app nor goes
  around a block. Check that the account works in the app; if it does, report
  it (the Fluidra API is unofficial and may refuse other clients).
- **One device in error** (403, 404, 5xx, timeout): only its badge turns
  "unreachable", the others are read.
- **Fluidra unreachable** (network error, 5xx): new try after 1, 2, 5, 10 then
  every 15 minutes, never faster than the refresh interval. That wait is kept
  across a restart (15 minutes at most); it holds the reads only, and the
  **Test the connection** button tries at once.

## Limits

- Never tested with a real account: the registers come from the Home
  Assistant integration, checked by its users on their devices.
- Not supported yet: generic pumps, PX50, Pro Elyo, Z950iQ heat pumps and the
  other families with unknown registers, robots, valves, plugs, dosing pumps,
  Command Connect cabinets, schedules.
- The account must be in the Europe (EMEA) region of Fluidra.

## Credits

- [Fluidra-pool](https://github.com/foXaCe/Fluidra-pool) by foXaCe (MIT): the
  cloud API, the sign-in, the equipment families and their registers are
  ported to JavaScript.
- See `THIRD_PARTY_NOTICES.md`.

Fluidra, AstralPool and Zodiac are trademarks of their owners; this project
is not affiliated with Fluidra.
