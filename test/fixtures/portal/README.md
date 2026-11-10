# Portal fixtures

Reconstructed, anonymized pages of the ista Web'conso resident portal. Every
value (meter numbers, locations, indexes, dates, address, tokens) is invented.

- `index-page.html`: the "index à la demande" page (`ficheIndexDemande.do`),
  written by hand after the structure of live pages a resident shared on
  2026-11-08 (the form, its hidden fields, the layout of the tags). A template:
  `test/helpers/fakePortal.js` fills its `{{…}}` placeholders (CSRF token, what
  the dwelling has, dates, search results).
- `index-water-meters.html`: the meter blocks of a water search, same origin:
  one cold water meter (real index), one hot water meter (estimated index).
- `index-heating-tab.html`, `index-heating-meters.html`: the heating tab and a
  heating search. **Hypothetical**: ids and dispatch from the page script, the
  rest assumed like the water tab; nobody has seen them yet.
- `public-home.html`: the portal's public home page, where the bare resident
  space URL lands. It has no form, only a "Se connecter" link
  (`home.do?dispatch=authenticate`) that redirects to the login form.
- `login-page.html`: a Keycloak login form like the one of `login.ista.com`
  (`username`, `password`, an empty hidden `credentialId`, no captcha, as seen
  on the live portal on 2026-10-13 without credentials).
- `login-error.html`, `login-otp.html`, `login-captcha.html`: the same page
  after a refused password, asking for a second factor, with a captcha.
- `callback-error.html`: what the sign-in callback (`public/loginIpmp.do?dispatch=loginTenant`)
  answers, HTTP 200, when it fails: the portal's "Une erreur interne est survenue" page (seen live
  with a made-up code on 2026-11-10, shortened).
- `callback-bounce.html`: what it may answer when it works. **Hypothetical**: nobody has seen it
  yet; a page whose script goes on to the dashboard.
