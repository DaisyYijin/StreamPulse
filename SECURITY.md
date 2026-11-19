# Security Policy

## Supported versions

Only the latest `main` build and the latest tagged release receive security
fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report them
privately through GitHub Security Advisories:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include reproduction steps, affected version, and impact.

You can expect an initial response within 72 hours.

## Deployment notes

- StreamPulse stores the administrator username, password hash, source credentials,
  and per-source stream keys in `/data/streampulse.json` (mode 0600). Protect and
  encrypt the host volume; do not expose `/data` over the network.
- Application logs live in `/logs` and contain source names/paths and errors, but
  never source tokens or passwords. Protect the log volume accordingly.
- 115 and other cloud-drive accounts should be configured inside OpenList/AList.
  StreamPulse stores only the resulting OpenList credentials.
- Put the web UI behind HTTPS when it is reachable from the internet.
- Set `TRUST_PROXY=true` only when a trusted reverse proxy terminates TLS.
- Set `STREAMPULSE_PASSWORD` for automated deployments, or complete the
  first-run setup immediately after exposing the service.
- STRM files contain StreamPulse 302 URLs with a per-source stream key. Anyone
  with read access to the output directory can use those URLs to resolve media
  paths from that source; protect the output directory.
- The 302 service on port 2048 is intentionally unauthenticated so media players
  can use it. Expose it only on trusted networks or behind your own access
  control; it does not expose the admin API.
