# Repository Instructions

## Project Shape

- This repository is a TypeScript GitHub Action.
- The runtime in [action.yml](action.yml) is Node 24.
- The checked-in action entrypoint is [dist/index.js](dist/index.js), generated from [src/main.ts](src/main.ts).

## Build And Validation

- Use `npm run build` to regenerate `dist/index.js`; keep the generated file in the same change when source or action metadata changes.
- Use `npm run typecheck`, `npm run test`, and `npm run fmtcheck` for code changes before pushing.
- For docs-only changes, no npm validation is required unless the docs describe action inputs, outputs, or runtime behavior that should be checked against code.

## Bundling

- Keep bundling on esbuild through the existing `npm run build` script.
- Do not reintroduce `@vercel/ncc` for routine builds; the current dependency set relies on package exports that ncc has previously failed to bundle correctly.
- Keep the esbuild target aligned with the action runtime in `action.yml`.

## Wait Deadlines

- Create the shared `continue-after-seconds` or `abort-after-seconds` deadline in `main.ts` after parsing inputs and before the first Actions API read.
- Treat the limit as a monotonic total-elapsed-time deadline across repository workflow lookup, workflow-run discovery, job and step reads, and sleeps.
- Start the separate `initial-wait-seconds` window when workflow-run discovery begins; do not let repository workflow lookup consume it, and keep its sleep bounded by the shared action deadline.
- Propagate the shared deadline signal through every potentially blocking Actions API read.
- Keep GitHub API retry backoffs on the shared abortable, chunk-safe scheduler so a deadline does not leave an Octokit retry timer running.
- On an ordinary terminal failure, cancel the shared signal before reporting the original error; keep cancellation separate from deadline expiration and timer disposal.
- Schedule long deadlines and sleeps in bounded timer chunks; never pass a delay above Node's timer maximum directly to `setTimeout`.
- Use fake timers for deadline regression tests; do not add real sleeps.

## Docs

- Keep README inputs and outputs aligned with `action.yml` and the source input parsing.
- Add changelog entries for user-facing behavior that has merged to `master` but has not been released yet.
- Use repository-relative links in tracked docs.
