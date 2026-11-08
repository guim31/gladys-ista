# ista Web'conso (France) for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that
reads, from the ista resident portal [ista-webconso.fr](https://www.ista-webconso.fr),
the **water meters** and the **heat cost allocators** (one per radiator) ista
reads remotely in French apartment buildings.

> **Not affiliated with ista.** ista and Web'conso are trademarks of their
> owners; this is an independent, unofficial project.
>
> **Water checked on a real account, heating not yet.** The portal has no
> public API: the integration signs in and reads the portal the way a browser
> does. Sign-in and the water pages were checked with a resident's account in
> November 2026; the heating page has not been seen answering. Expect it to be
> fragile, and to break when ista changes the website. Please report what you
> see.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) (Gladys
shows it from the integration's Configuration screen).

## What it does

- **One device per account**, "ista dwelling", with:
  - per radiator, the index of its allocator: `counter-sensor`/`integer`,
    **no unit**. Allocator units have no physical dimension (they only share
    the heating bill out), so no kWh is claimed;
  - the **heating units of the day**, the sum of the radiators' units over a
    one-day period: `counter-sensor`/`integer` (unverified);
  - per water meter, its cumulative index: `volume-sensor`/`decimal`, `m³`,
    and a total per fluid when there are several meters.
- Every reading is published **dated with its reading date** (`created_at`),
  so the Gladys charts show the index on the right day even when the portal
  publishes it days late. The core deduplicates a state re-sent for the same
  instant.
- A container timer reads the portal every **12 h** (3 to 24 h): devices are
  published with `should_poll: false`. Each run opens the index page and, when
  it offers a newer reading date, searches the indexes of that date: two
  requests (three with heating), one when nothing is new.
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
   the `Cookie` header of their own browser. It expires; the indexes being cumulative, the next
   reading after a fresh cookie catches up on the consumption. The documentation has the steps.
3. **Readings: the "index à la demande" page** (checked on a live account,
   2026-11-08). `GET /espace-client-v2/occupant/ficheIndexDemande.do` renders
   one form, `ficheIndexDemandeOccupantForm`, whose hidden fields say what the
   dwelling has (`logement.eauDisponible`, `indexDemandeEauDisponible`,
   `logement.chauffageDisponible`, `indexDemandeChauffageRfcDisponible`), the
   range of reading dates (`dateMinIndex` / `dateMaxIndex`, `YYYYMMDD`) and a
   `_csrf` token. The search posts that same form back, every field as the
   browser sends it, with `dispatch=voirIndexDemande`, `dateIndexDemande` (the
   reading date, `DD/MM/YYYY`, here `dateMaxIndex`) and `dateDebutPeriodeIndex`
   (the day before). The answer is the same page with one `div.le-compteur`
   per meter: "EAU FROIDE" / "EAU CHAUDE", the period, then `key` / `value`
   lines (meter number, location, index read, real or estimated,
   consumption).
   - Heating: `dispatch=voirIndexDemandeChauffageRfc` with the heating tab's
     own date fields, used only when the page offers it. Read in the page
     script (`ficheIndexDemandeOccupant.js`), **never seen answering**: its
     failure is logged once and does not stop the water readings.
   - The JSON consumption page used by 1.0.x
     (`ficheLogement.do?dispatch=calculeConsommation…`) answers HTML on the
     current portal; it is gone.

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
src/sync.js                       timer, latest reading date, dated states, connection status
src/ista/client.js                portal client: sign-in, session, index page search
src/ista/cookies.js               cookie jar, pasted cookie parsing
src/ista/parse.js                 index page form and meter blocks -> meters
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
