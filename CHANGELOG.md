# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.3] - 2026-11-08

### Changed

- When the portal still asks to sign in right after a successful sign-in, the log now says on which
  page it sent the integration and why it looks signed out (page address without its parameters).

## [1.1.2] - 2026-11-08

### Fixed

- **Test the connection and read now** showed a failure (expired cookie, refused password…) in
  green: it now fails, so Gladys shows the message in red.

## [1.1.1] - 2026-11-08

### Fixed

- 1.1.0 could not read the indexes ("no index form"): the index page is now opened through its
  menu entry, as the portal expects; opened directly it has no form.

## [1.1.0] - 2026-11-08

### Fixed

- No reading came in ("Unknown format" status): the consumption page the
  integration asked for answers HTML on the current portal. The readings now
  come from the portal's "index à la demande" page, the one the portal shows
  under "Index à la demande": the water meters (cold and hot), each with its
  index, dated with its reading date. Checked against pages shared by a
  resident.

### Changed

- Water meters are named after their number (`— no. …`), and are no longer
  marked unverified. Heating (heat cost allocators) uses the heating tab of the
  same page, only when the portal offers it: still unverified, and its failure
  no longer stops the water readings.
- One reading per run at most, at the latest date the portal offers, instead
  of a catch-up over the last 7 days.

## [1.0.2] - 2026-10-13

### Added

- The documentation in German and Spanish.

### Changed

- Quieter logs: a normal reading writes nothing at the default level, and a
  failure that repeats at every retry is logged once when it starts and once
  when it ends. The details stay available with `LOG_LEVEL=debug`.

## [1.0.1] - 2026-10-13

### Added

- Readings of the ista Web'conso resident portal (France): one "ista
  dwelling" device with the index of each heat cost allocator, the heating
  units of the day, and the water meters when the portal provides them.
- Sign-in with the e-mail and password of the resident space, renewed
  automatically; a pasted browser session cookie as a fallback.
- Readings dated with their own day, the last 7 days caught up at each run and
  sent again to a device created later.
- A reading every 12 hours by default, adjustable from 3 to 24 hours.
- A "Test the connection and read now" action and an "ista consumption"
  dashboard widget.
- Every text in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-ista/compare/v1.1.3...HEAD
[1.1.3]: https://github.com/guim31/gladys-ista/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/guim31/gladys-ista/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/guim31/gladys-ista/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/guim31/gladys-ista/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/guim31/gladys-ista/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-ista/releases/tag/v1.0.1
