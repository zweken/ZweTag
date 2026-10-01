# Changelog

All notable changes to ZweTag are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-01

### Added
- Racks in rooms; devices placed by their top rack unit, several identical
  devices at once, moved with their cables.
- Connect: two racks side by side, click one port and then the other, or
  connect a whole panel in one step. Patch panels have a front and a rear.
- A label for both ends of every cable in the ANSI/TIA-606 identifier style
  (`A01-40:12 → A02-38:12`), with the format and its test vectors in `spec/`.
- Label tracking: mark cables as labeled; a cable whose address changes asks
  for a new label.
- Printing on A4 and Letter label sheets, single labels for label printers or
  a custom layout; rack and device labels; a cable schedule.
- CSV export of cables and of label text.
- Undo and redo, light and dark themes.
- One program for Windows (its own window), Linux and macOS (the default
  browser), and the same interface online, storing the project in the browser.

[Unreleased]: https://github.com/zweken/ZweTag/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zweken/ZweTag/releases/tag/v1.0.0
