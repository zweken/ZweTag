# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on <https://github.com/zweken/ZweTag>.
Do not open a public issue for anything that could be a security problem.

We acknowledge reports within 7 days and publish a fix or a mitigation with a
GitHub Security Advisory. There is no bug bounty.

## Supported versions

Only the latest release receives security fixes.

## Threat model (short version)

ZweTag is a local program with no account and no server of ours. The desktop
program is a small web server for its own window; the online version is a
static page that keeps everything in the browser.

| Asset | Threat | Control |
|---|---|---|
| Local server | Another machine connects | It listens on 127.0.0.1 only and refuses any other listen address. |
| Local server | A web page in your browser calls it (cross-site requests, DNS rebinding) | The `Host` header must be `127.0.0.1` or `localhost` with the right port, a foreign `Origin` is refused, and every API call needs the `X-ZweTag` header, which another site cannot send without a preflight the server never approves. |
| Project file | A save overwrites changes made elsewhere | Each save names the version it is based on (`If-Match`); a file changed on disk is not overwritten without asking. Writes are atomic and the previous version stays in `zwetag.json.bak`. |
| Exports | Writing outside the exports folder | File names are limited to letters, digits, dot, dash and underscore; "Show in folder" only opens paths inside `exports/`. |
| Links | Opening arbitrary addresses | The program opens only its two fixed links. |
| Interface | Injected script, outside requests | `Content-Security-Policy: default-src 'self'`; no inline script or style; nothing is loaded from other sites. |
| Downloads | A tampered binary | Releases carry `SHA256SUMS` and a build provenance attestation (see the README). The Windows program is not code-signed. |
