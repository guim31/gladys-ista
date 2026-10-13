# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-ista/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-ista/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-ista/releases/tag/v1.0.1
