# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below. The ported parts were rewritten
in JavaScript; they are changed from the originals (another language, another
structure, only what this integration needs). None of the original code is
copied as is.

## Fluidra-pool

- Project: [foXaCe/Fluidra-pool](https://github.com/foXaCe/Fluidra-pool),
  the Home Assistant integration for the Fluidra Pool app, by foXaCe (commit
  `a21aac3`, 2026-10-15).
- What is ported (in `src/constants.js`, `src/cognito.js`, `src/client.js`
  and `src/fluidra.js`): the AWS Cognito app client of the Fluidra Pool app
  and its sign-in (`USER_PASSWORD_AUTH`, `REFRESH_TOKEN_AUTH`, the access
  token as the bearer), the base URL and the endpoints of the Fluidra EMEA API
  (pools, device tree, components, component write), the reading of the
  device tree (bridges and their children), the coarse classification of a
  device, the identification of a device profile (serial, `thingType`, name,
  family, component-7 signature, the tecnoLC2 register signature) and the
  register maps of the profiles used here (tecnoLC2, domoticS2, eXO iQ,
  tecno2, Blue Connect, E30iQ, Victoria Smart Connect, the Z250iQ, Z260iQ,
  Z350iQ, Z550iQ, Z650iQ, LG Eco Elyo and Gre HPGIC heat pumps, LumiPlus), the
  value scales and the heat pump modes.
- Licence: MIT. Its full notice:

```text
MIT License

Copyright (c) 2024 foXaCe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
