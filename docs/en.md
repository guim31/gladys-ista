# ista Web'conso (France)

Brings into Gladys the readings that **ista** takes remotely in your building:
the **heat cost allocators** on your radiators and, when the portal provides
them, your **water meters**. The data comes from the ista resident portal
[ista-webconso.fr](https://www.ista-webconso.fr) ("Mon espace résident").

> **Not affiliated with ista.** ista and Web'conso are trademarks of their
> owners. This integration is an independent project.
>
> **Developed without an account: feedback welcome.** Nobody has tested it
> against a real Web'conso account yet. It is the most fragile kind of
> integration: there is no public API, so it reads the portal the way your
> browser does, and it can stop working the day ista changes its website.

## What you get

One device, **ista dwelling**, with:

| Feature                                | Gladys type | Unit | What it is                                                                                        |
| -------------------------------------- | ----------- | ---- | ------------------------------------------------------------------------------------------------- |
| Heating units of the day               | Counter     | none | The units of all your radiators for the day, weighted by each radiator's coefficient (as billed). |
| Radiator _room_ — no. _serial_ (each)  | Counter     | none | The index shown on that radiator's allocator.                                                     |
| Cold water / Hot water _room_ (each)   | Volume      | m³   | The cumulative index of that meter. **Unverified**, see the limits.                               |
| Cold water — total / Hot water — total | Volume      | m³   | The sum of the indexes, when the dwelling has several meters of that fluid.                       |

Heating units have **no physical unit**: an allocator does not measure
energy, it only shares the building's heating bill out between dwellings. So
they are shown as plain counters, without kWh.

Each reading is **dated with its own day**, even when the portal publishes it
several days late: the Gladys charts show the consumption on the day it
happened, not on the day it was fetched. When the device is created, the last
7 days already read are sent to it.

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

Since each run catches up on the last 7 days, pasting a fresh cookie once a
week is enough to keep the history complete.

## How often the portal is read

The portal is read every **12 hours** by default, adjustable from **3 to 24
hours** (**Reading interval**). ista updates the readings **once a day at
most**, and many buildings are only read **once a week**: reading more often
brings nothing and only loads the portal. Each run asks only for the days not
read yet, one small request per day and per fluid, with a pause between them.

## Limits

- **Sign-in partly verified.** The portal sends the browser to ista's sign-in
  page (`login.ista.com`). The integration follows the same steps, and this
  was checked on the live portal up to the refusal of a made-up account (no
  captcha). A successful sign-in with a real account has not been seen yet.
- **Water not verified.** The heating page is known from a public project
  that read it in 2025. The water pages are a guess: when the portal refuses
  them, no water feature appears, and the connection test counts 0 water meters. If your water does not
  show up, please report it.
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
