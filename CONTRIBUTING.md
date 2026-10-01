# Contributing to ZweTag

Thank you for helping. ZweTag is small on purpose: it draws racks, connects
ports and prints labels. Changes that keep it simple and predictable are
welcome; larger features are best discussed in an issue first.

## Before you write code

- Open an issue for anything beyond a typo, and describe the problem before
  the solution.
- The label format is a specification (`spec/tag-format.md`). A change to it
  needs new test vectors in `spec/tag-vectors.json` and a new format version.
- The project file format (`spec/project-format.md`) stays readable by older
  files: new fields get defaults, and a format change bumps `version`.

## Language

Code, comments, commit messages, issues and documentation are in English.

## Developer Certificate of Origin (DCO)

Every commit must be signed off:

    git commit -s -m "connect: keep both ends when the rack changes"

The `Signed-off-by: Your Name <you@example.com>` trailer certifies the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the change or otherwise have the right to submit it under this
project's license. Pull requests without a sign-off on every commit are
rejected by CI.

## Contribution terms

ZweTag is licensed under the Apache License, Version 2.0. As section 5 of the
license says, a contribution you submit is licensed under the same terms. You
keep the copyright to your contribution. The names and the logo are not part
of the license (see `NOTICE`).

## Coding rules

- `gates/gate.sh` must pass: gofmt, go vet for Linux and Windows,
  `go test -race`, the interface tests (`node --test`), English-only text, no
  outside addresses in the interface, the license check.
- Go: standard library first. No new dependency without discussion.
- Interface: plain JavaScript modules in `web/assets/`. No npm packages, no
  bundler, no framework, and nothing loaded from other sites (fonts included).
  No inline script or style: the page runs under a strict
  Content-Security-Policy.
- Every model rule has a test in `test/`; every API behavior has a Go test.
- Keep the text on screen short.

## Commit messages

`area: imperative summary` (`print: fit the font to the widest line`). The
body explains *why* when it is not obvious. Sign-off trailer required.
