# ista Web'conso (France) for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that
reads, from the ista resident portal [ista-webconso.fr](https://www.ista-webconso.fr),
the **heat cost allocators** (one per radiator) and the **water meters** ista
reads remotely in French apartment buildings.

> **Not affiliated with ista.** ista and Web'conso are trademarks of their
> owners; this is an independent, unofficial project.
>
> **Developed without an account: feedback welcome.** The portal has no public
> API. The integration signs in and reads the portal the way a browser does,
> and nobody has run it against a real account yet. Expect it to be fragile,
> and to break when ista changes the website. Please report what you see.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) (Gladys
shows it from the integration's Configuration screen).

## What it does

- **One device per account**, "ista dwelling", with:
  - per radiator, the index of its allocator: `counter-sensor`/`integer`,
    **no unit**. Allocator units have no physical dimension (they only share
    the heating bill out), so no kWh is claimed;
  - the **heating units of the day**, weighted by each radiator's coefficient
    (what the bill uses): `counter-sensor`/`integer`;
  - per water meter, its cumulative index: `volume-sensor`/`decimal`, `m³`,
    and a total per fluid when there are several meters.
- Every reading is published **dated with its day** (`created_at`), so the
  Gladys charts show the consumption on the right day even when the portal
  publishes it days late. The core deduplicates a state re-sent for the same
  instant.
- A container timer reads the portal every **12 h** (3 to 24 h): devices are
  published with `should_poll: false`. Each run asks only for the days not
  read yet (7 days back at most), one request per day and per fluid, with a
  pause between requests.
- A dashboard **widget**: heating units of the latest day, water indexes, a
  bar chart of the heating units per day, latest reading and portal status.
- A **Test the connection and read now** action.
- No scene trigger: nothing in a meter reading is an event worth one.

## How the portal is read

1. **Sign-in.** The "Se connecter" link of the portal's public home page
   (`https://ista-webconso.fr/espace-client-v2/public/home.do?dispatch=authenticate`)
   redirects to ista's identity server, a Keycloak realm
   (`login.ista.com/realms/dsp-webconso-fr`); the bare resident space URL only
   lands on that home page, which has no form, so a page that only carries the
   link is followed. Checked on the live portal (without credentials) up to the
   refusal of a fake account; a successful sign-in is not verified yet. The
   client follows the redirects by hand with its own cookie jar, fills the
   login form it finds there (Keycloak's `username`/`password`, or the older
   `login`/`pwd`), and comes back to the portal with its `JSESSIONID`. The
   session is kept in `/data/session.json`, and renewed by signing in again
   when the portal sends the client back to the login page.
2. **Fallback: a pasted session cookie.** When the sign-in fails (captcha,
   second factor, a form the client does not recognize), the user can paste
   the `Cookie` header of their own browser. It expires; since each run
   catches up on 7 days, a fresh cookie once a week keeps the history
   complete. The documentation has the steps.
3. **Readings.** `GET /espace-client-v2/occupant/ficheLogement.do?dispatch=…&start=YYYY-MM-DD&end=YYYY-MM-DD`
   answers JSON: `response[].pointsComptage[]`, each with `metadata`
   (counting point number, allocator serial, room) and `consommation` (raw and
   coefficient-weighted units, `indexDernierJourPeriode`, `is_null` for a day
   not filled in yet).
   - Heating: `dispatch=calculeConsommationChauffageRfcPourLogement`, seen in
     use against the live portal in 2025.
   - Water: `calculeConsommationEauFroidePourLogement` and
     `calculeConsommationEauChaudePourLogement` are **unverified guesses** on
     the same pattern. A refused page hides the water features, probed once
     per start, never once per day.

Nothing is logged that could identify the user or open their account: no
e-mail, password, cookie, nor the query of a login redirect (it carries
one-time codes). An unexpected answer is logged as its **structure** (keys and
types, no values), which is what a bug report needs. `test/secrets.test.js`
checks it.

## Credits

- [vlebourl/pyista](https://github.com/vlebourl/pyista) (MIT, © 2022 Vincent
  Le Bourlot), "Ista Webconso Python Wrapper API", was the intended reference.
  Its repository only holds a project skeleton (an HTTP helper and an empty
  class, no request to the portal), so nothing could be ported from it; it is
  credited for the base URL and the idea.
- [odoucet/ista-webconsofr](https://github.com/odoucet/ista-webconsofr) (no
  license) was **read, not copied**, to understand the protocol: the identity
  server, the heating consumption page and the shape of its JSON answer. No
  line of its code is in this repository.
- [T0ytoy/ISTA_webconso_fr](https://github.com/T0ytoy/ISTA_webconso_fr) (no
  license): its repository was empty when this integration was written.
- Started from the official
  [integration template](https://github.com/GladysAssistant/integration-template-js),
  with the [integration SDK](https://github.com/GladysAssistant/integration-sdk-js).

## Project structure

```
index.js                          SDK wiring only
src/app.js                        handlers (scan, action, widget, config, lifecycle)
src/sync.js                       timer, days to read, dated states, connection status
src/ista/client.js                portal client: sign-in, session, consumption pages
src/ista/cookies.js               cookie jar, pasted cookie parsing
src/ista/parse.js                 JSON answers -> counting points
src/devices/dwelling.js           the Gladys device and its features
src/widgets.js                    dashboard widget
src/i18n.js                       every text sent to Gladys, in en/fr/de/es
src/config.js                     defaults (mirror the manifest) + normalization
src/store.js                      /data files (session, state)
test/                             node --test, fake Gladys of the SDK + fake portal
test/fixtures/portal/             reconstructed, anonymized portal answers
```

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store .   # store admission checks
```

Tests never touch the network: `test/helpers/fakePortal.js` plays the portal
and its identity server, `createFakeGladys()` (SDK) plays Gladys.
`test/gladys-rules.test.js` checks the published features against the core's
category/type/unit table, `test/i18n.test.js` the four languages.

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="ista" \
ISTA_DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

## Releasing

Versions belong to the **Release** workflow (Actions → Release): describe the
change under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), run the
workflow, and it bumps `package.json`, the manifest `version` and the
`docker_image` tag, builds the multi-arch image to `ghcr.io`, and publishes
the GitHub Release. A hand-pushed `vX.Y.Z` tag builds too, but then bump
those three by hand, together, before tagging.

## License

Apache-2.0, as declared in `package.json`.
