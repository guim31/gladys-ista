# ista Web'conso (France)

Brings into Gladys the readings that **ista** takes remotely in your building:
your **water meters** and, when the portal offers them, the **heat cost
allocators** on your radiators. The data comes from the ista resident portal
[ista-webconso.fr](https://www.ista-webconso.fr) ("Mon espace résident").

> **Not affiliated with ista.** ista and Web'conso are trademarks of their
> owners. This integration is an independent project.
>
> **Water checked on a real account, heating not yet.** The water readings
> follow pages a resident shared in November 2026; the heating readings have
> not been seen working yet. It is the most fragile kind of integration: there
> is no public API, so it reads the portal the way your browser does, and it
> can stop working the day ista changes its website.

## What you get

One device, **ista dwelling**, with:

| Feature                                             | Gladys type | Unit | What it is                                                                                |
| --------------------------------------------------- | ----------- | ---- | ----------------------------------------------------------------------------------------- |
| Heating units of the day                            | Counter     | none | The units of all your radiators over the latest day read. **Unverified**, see the limits. |
| Radiator _room_ — no. _serial_ (each)               | Counter     | none | The index shown on that radiator's allocator. **Unverified**, see the limits.             |
| Cold water / Hot water _room_ — no. _number_ (each) | Volume      | m³   | The cumulative index of that meter, as the portal reads it (real or estimated).           |
| Cold water — total / Hot water — total              | Volume      | m³   | The sum of the indexes, when the dwelling has several meters of that fluid.               |

Heating units have **no physical unit**: an allocator does not measure
energy, it only shares the building's heating bill out between dwellings. So
they are shown as plain counters, without kWh.

Each reading is **dated with its reading date**, which is usually a few days
old: the Gladys charts show the index on the day it was read, not on the day
it was fetched. When the device is created, the recent readings already
fetched are sent to it.

A **dashboard widget**, "ista consumption", shows the heating units of the
latest day, the water indexes, a bar chart of the heating units per day and
the date of the latest reading.

## Configuration

1. Install the integration, open its **Configuration** tab.
2. Leave **Sign-in method** on **E-mail and password**, and enter the e-mail
   and password of your resident space.
3. Pick the **language of the feature names** (Gladys does not tell an
   integration your language; names are fixed when the device is created).
4. Save, then click **Test the connection and read now**. The message under
   the button says how many allocators and meters were found and the date of
   the latest reading.
5. Open the **Discovery** tab and add the **ista dwelling** device.

### When the e-mail and password do not work: the session cookie

If the status says the portal asks for a captcha or a second factor, or the
login page is not recognized, you can give the integration the session of
your own browser instead. It is a fallback: the session **expires** (when you
sign out, or after some time without activity), and you must paste a new one.

1. On a computer, sign in at [ista-webconso.fr](https://www.ista-webconso.fr)
   and open the consumption page of your dwelling.
2. Open the developer tools (**F12**), **Network** tab, and reload the page.
3. Click a request to `ista-webconso.fr`. Under **Request headers**, copy the
   whole value of the **Cookie** line. (Or, in **Application** / **Storage** →
   **Cookies**, copy the value of `JSESSIONID`.)
4. Do **not** click "Se déconnecter" in the portal afterwards: that would end
   the session. Just close the tab.
5. In Gladys: **Sign-in method** → **Session cookie**, paste the text in
   **Session cookie**, save, and click **Test the connection and read now**.

The indexes are cumulative: after an expired cookie, the next reading catches
up on the consumption; only the days in between have no point in the charts.

## How often the portal is read

The portal is read every **12 hours** by default, adjustable from **3 to 24
hours** (**Reading interval**). ista updates the readings **once a day at
most**, usually with a delay of a few days: reading more often brings nothing
and only loads the portal. Each run opens the portal's **index on demand**
page and, when it offers a newer reading date, asks for the indexes of that
date: two small requests (three with heating), only one when nothing is new.

## Limits

- **Sign-in verified.** The portal sends the browser to ista's sign-in page
  (`login.ista.com`); the integration follows the same steps. A resident
  signed in with it in November 2026, with the password and with the cookie.
- **Heating not verified.** The heating readings use the heating tab of the
  same page, known from the portal's script only: nobody has seen it answer
  yet. If heating is listed for your dwelling but does not show up, the logs
  say so: please report it.
- **Estimated indexes.** The portal marks some indexes as estimated (a meter
  that did not answer the radio reading); they are published as the portal
  shows them, and the next real reading takes over.
- **One dwelling per account.** An account with several dwellings shows their
  meters in one device.
- **Index reset.** Allocators usually restart from zero at the yearly reading:
  the index chart then drops, the daily units do not.
- **Names are fixed** when the device is created (a Gladys rule): renaming in
  the portal does not rename the features.

## Troubleshooting

The **Configuration** screen shows the connection status:

| Message                                   | What to do                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| The portal refused the e-mail or password | Check them by signing in at ista-webconso.fr.                                |
| Captcha / second factor                   | Use the session cookie mode (above).                                         |
| Sign in once in a browser                 | The portal asks for something (new password, terms): do it, then test again. |
| Login page not recognized                 | The portal changed: use the session cookie mode, and report it.              |
| The session cookie has expired            | Paste a new one.                                                             |
| Unknown format                            | The portal changed: report it with the logs.                                 |
| The portal cannot be reached              | Retried within the hour, nothing to do.                                      |

To report a problem, open an issue on
[GitHub](https://github.com/guim31/gladys-ista/issues) with the integration
logs (Gladys → integration → **Logs**). The logs never contain your e-mail,
your password or your cookie; when the portal answers in an unknown format
they show its **structure** (field names, no values), which is what is needed
to adapt the integration.

## Privacy

Your e-mail, password or cookie stay in the Gladys configuration. The
integration keeps the portal session and the recent readings in its own
volume (`/data`), and talks to nothing but ista's portal and sign-in page.
