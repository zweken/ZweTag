# Code signing policy

The release files of ZweTag are not code-signed yet. We intend to sign the Windows program through
a free code signing program for open source projects; this page will then name the service and the
certificate, and Windows will show the signer in the file's properties.

Until then, every release file is listed in `SHA256SUMS` on its release page and carries a build
provenance attestation, which shows that it was built from this repository by its release workflow:

    gh attestation verify ZweTag.exe --owner zweken

## What is signed

Only release files of this repository, built from the tagged source by the
[release workflow](.github/workflows/build.yml) on GitHub-hosted runners. Nothing is built, changed
or uploaded by hand, and no file made elsewhere is signed.

## Team roles

- Committers and reviewers: [Zweken Technology](https://github.com/zweken). Contributions from
  outside are reviewed before they are merged; see [CONTRIBUTING.md](CONTRIBUTING.md).
- Approvers: [Zweken Technology](https://github.com/zweken). Every release is approved by hand.

## Privacy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it.

ZweTag talks only to itself on `127.0.0.1`, and the online version runs entirely in your browser.
The two outside links in the program, to this repository and to zweken.com, open only when you
click them.

## What ZweTag leaves on your computer

ZweTag installs nothing and changes no system settings. It writes:

- your project, `zwetag.json`, and its previous version, `zwetag.json.bak`, next to the program
  (or where `--file` points);
- the CSV files you export, in an `exports` folder next to the project;
- on Windows, the data of its window in `%APPDATA%\ZweTag.exe` (the folder takes the name of the
  program file).

To remove ZweTag, delete the program, those files and that folder.
