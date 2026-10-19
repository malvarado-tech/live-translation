# Contributing

Issues and pull requests are welcome.

## Development setup

Follow the [Quick start](README.md#quick-start) in the README. Before opening a pull request, run:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

`npm test` runs the unit tests with the Node test runner. `npm run test:e2e` runs the Playwright tests against the production build from `npm run build`; install the browser once with `npx playwright install chromium`. The end-to-end tests expect no LiveKit credentials in the environment.

The build must pass with every environment variable empty. `npm run lint` currently reports three existing `react-hooks/set-state-in-effect` errors; a change should not add new findings.

Keep long-lived keys inside route handlers under `app/api/`. Never move a secret into a `NEXT_PUBLIC_` variable or into client code.

## Reporting a bug

Open an issue with:

- what happened and what was expected;
- the steps to reproduce it;
- the browser and device of the operator and, if relevant, of the listener;
- whether LiveKit was in use or the dashboard ran without rooms;
- the relevant lines from the browser console or the server log, with keys, tokens and IP addresses removed.

## Security

The API routes have no authentication (see [Limitations](README.md#limitations-and-roadmap)). To report a vulnerability, do not open a public issue; contact the maintainer through the email on their GitHub profile.
