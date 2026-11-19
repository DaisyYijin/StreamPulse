# Contributing to StreamPulse

Thanks for taking the time to improve StreamPulse.

## Development setup

```bash
npm ci
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` to the
API server on `http://localhost:8080`. Use `DATA_DIR` / `OUTPUT_DIR` to keep
local test data out of the repository:

```bash
DATA_DIR=/tmp/streampulse-dev OUTPUT_DIR=/tmp/streampulse-dev/strm npm run dev
```

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

Please keep changes focused. For UI changes, include a screenshot at 1440px
wide if possible. For scanner/runner changes, add or update unit tests under
`src/server/**/*.test.ts`.

## Code style

- TypeScript strict mode, ESM.
- No runtime dependency on a database or external service.
- Keep source credentials out of API responses and logs.
- Paths derived from remote data must go through the helpers in
  `src/server/core/paths.ts`.
- New URL template variables must be added to the shared constant, the renderer,
  and the README table.

## Commit messages

Conventional prefixes are appreciated: `feat:`, `fix:`, `docs:`, `test:`,
`chore:`.
