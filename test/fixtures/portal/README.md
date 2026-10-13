# Portal fixtures

Reconstructed, anonymized answers of the ista Web'conso resident portal. No
real account was used: the structure (field names, nesting) follows what the
public projects credited in the main README read from the portal, and every
value (counting point numbers, serials, rooms, indexes) is invented.

- `heating-day.json`: the heating consumption page for one day, three heat cost
  allocators.
- `heating-day-pending.json`: the same page for a day the portal has not filled
  in yet (`is_null`).
- `cold-water-day.json`: a water answer of the same shape. **Hypothetical**:
  nobody has seen a real water answer yet (see `DISPATCHES` in
  `src/ista/client.js`).
- `login-page.html`: a Keycloak login form like the one of `login.ista.com`.
- `login-error.html`, `login-otp.html`, `login-captcha.html`: the same page
  after a refused password, asking for a second factor, with a captcha.
