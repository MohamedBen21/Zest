# Contributing to Zest

Thanks for helping. Zest is a small project, so a quick issue before a big change saves everyone time.

## Reporting a bug
Open an issue and include: Windows version, Zest version, what you did, what you expected, and what happened. If it involves the wheel or bubble, attach `%APPDATA%\Zest\logs\wheel.log`. Please remove any private file names from it first.

## Suggesting a feature
Describe the problem you want solved before the solution. Offline-only and no-telemetry are core promises, so features that need a network connection will not be accepted.

## Running it
```powershell
npm ci
npx electron .
```
Tests: `node test/run-tests.js`, `npm run test:radial`, `npm run test:bubble` (the last two need xvfb on Linux).

## Pull requests
- Keep each PR focused and describe what you tested.
- Run the tests above. Add a test for new behaviour where it is practical.
- Do not add dependencies with network calls or telemetry.
- By contributing you agree your work is released under the project's MIT licence.
