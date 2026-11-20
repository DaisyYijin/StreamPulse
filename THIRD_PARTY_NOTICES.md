# Third-Party Notices

StreamPulse's own application code is licensed under the MIT License in
[LICENSE](LICENSE).

The native 115 and 123 cloud clients are TypeScript implementations written for
StreamPulse. They are not vendored copies of another project's client library,
and StreamPulse does not call OpenList for native 115/123 accounts.

## Protocol references

### 115driver

- Project: https://github.com/SheltonZhu/115driver
- License: MIT (Copyright (c) 2022-2024 SheltonZhu)
- Used as a protocol reference for 115 endpoints, QR login flow, file
  operations, and the m115 RSA/XOR encoding used for 115 download URLs.
- The TypeScript m115-compatible crypto section in `src/server/p115.ts` is an
  adaptation of that algorithm. The upstream MIT notice and the upstream
  special policy notice are retained here by reference:
  https://github.com/SheltonZhu/115driver/blob/master/LICENSE

### OpenList

- Project: https://github.com/OpenListTeam/OpenList
- License: AGPL-3.0
- Used as a protocol reference for 123 API endpoints, request headers, query
  parameters and response field names.
- The 123 client in `src/server/p123.ts` is a separate TypeScript implementation;
  no Go source files from OpenList are included in this repository.

## Other runtime dependencies

- `sharp` — image processing for library covers.
- `yaml` — YAML parsing for organizer rules.
- `qrcode` — QR image generation for 115/123 login.

See `package.json` for the complete dependency list.
