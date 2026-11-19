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

- StreamPulse stores source credentials in `/data/streampulse.json` (mode 0600).
  Protect and encrypt the host volume; do not expose `/data` over the network.
- Put the web UI behind HTTPS when it is reachable from the internet.
- Set `TRUST_PROXY=true` only when a trusted reverse proxy terminates TLS.
- Set `STREAMPULSE_PASSWORD` for automated deployments, or complete the
  first-run setup immediately after exposing the service.
- STRM files contain direct media URLs. Anyone with read access to the output
  directory can see those URLs.
