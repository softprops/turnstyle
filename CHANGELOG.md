## Unreleased

### Bug fixes 🐛

- Enforce `continue-after-seconds` and `abort-after-seconds` as total elapsed-time deadlines starting before the first Actions API read and covering workflow discovery, job and step reads, initial waiting, and polling.
- Keep the `initial-wait-seconds` discovery window anchored to workflow-run discovery so repository workflow lookup does not consume its retry opportunity, while still bounding it by the action deadline.
- Safely chunk long timer delays and check the monotonic boundary before follow-up discovery reads, pagination pages, and retries so timer overflow or delayed callbacks cannot shorten or extend the configured deadline.
- Cancel queued GitHub API retry backoffs when the shared deadline expires or an ordinary terminal API failure ends the action, instead of allowing their timers to keep the step running.
- Keep configured 5xx retries independent from the one primary-rate-limit retry, and avoid retrying primary limits with missing or malformed reset headers.

## 3.3.2

### Bug fixes 🐛

- Update the bundled `undici` dependency to the patched 6.27.0 release.

### Other Changes 🔄

- Update the Node 24 development toolchain and GitHub Actions/npm dependencies, including TypeScript 7 in https://github.com/softprops/turnstyle/pull/155.
- Improve internal type safety, test coverage, test type-checking, and failure reporting in https://github.com/softprops/turnstyle/pull/156.

## 3.3.1

### Bug fixes 🐛

- Limit workflow run discovery to active runs, use repo-level active run lookup for `queue-name`, and surface rate-limit throttling in default logs to avoid excessive API usage in busy repositories. Fixes https://github.com/softprops/turnstyle/issues/146

## 3.3.0

### Exciting New Features 🎉

- Add configurable `retries` input to retry transient GitHub API 5xx errors with exponential backoff (defaults to 0, preserving the existing no-retry behavior), originally contributed by @mateusz-krainski-revoize in https://github.com/softprops/turnstyle/pull/148 and merged via https://github.com/softprops/turnstyle/pull/150
- Document reusable workflow usage and queue naming behavior by @chenrui333 in https://github.com/softprops/turnstyle/pull/143
- Allow same-branch filtering to target an explicit branch by @chenrui333 in https://github.com/softprops/turnstyle/pull/144
- Expose previous run ID and URL outputs by @chenrui333 in https://github.com/softprops/turnstyle/pull/145

## 3.2.4

### Bug fixes 🐛

- Fix runtime input parsing and GitHub API throttling by @chenrui333 in https://github.com/softprops/turnstyle/pull/140
- Resolve workflows by ref path for more reliable workflow discovery by @chenrui333 in https://github.com/softprops/turnstyle/pull/141
- Improve workflow run discovery and rerun ordering so active predecessors are not missed in busy repositories by @chenrui333 in https://github.com/softprops/turnstyle/pull/142

## 3.2.3

maintenance release with updated dependencies

## 3.2.2

maintenance release with updated dependencies

## 3.2.1

maintenance release with updated dependencies

## 3.2.0

### Exciting New Features 🎉

- feat: filter grouping of multiple workflows by queue-name by @cdiaz-nex in https://github.com/softprops/turnstyle/pull/120

### Other Changes 🔄

- chore(deps): bump the npm group with 5 updates by @dependabot[bot] in https://github.com/softprops/turnstyle/pull/122

## 3.1.0

- feat: filter workflows by queue-name by @cdiaz-nex in https://github.com/softprops/turnstyle/pull/117

## 3.0.0

- Upgrade Node.js version to 24 in action. Make sure your runner is on version v2.327.1 or later to ensure compatibility with this release. [Release Notes](https://github.com/actions/runner/releases/tag/v2.327.1)

## 2.4.0

- Migrate from jest to vitest
- Bump to use Node.js 24
- Dependency updates

## 2.3.2

maintenance release with updated dependencies

## 2.3.1

maintenance release with updated dependencies

## 2.3.0

### Exciting New Features 🎉

- Adding support for waiting on specific job/step completion in turnstyle by @selecsosi in https://github.com/softprops/turnstyle/pull/98

## 2.2.3

fix lockfile issue

## 2.2.2

maintenance release with updated dependencies

## 2.2.1

maintenance release with updated dependencies

## 2.2.0

### Exciting New Features 🎉

- feat: support GitHub Enterprise by @zachwhaley in https://github.com/softprops/turnstyle/pull/62
- feat: wait for "waiting" runs as well as "in_progress" and "queued" by @zachwhaley in https://github.com/softprops/turnstyle/pull/63
- feat: get github.token as default input by @qoomon in https://github.com/softprops/turnstyle/pull/61

## 2.1.0

### Exciting New Features 🎉

- feature: fetch 100 results per page by @anomiex in https://github.com/softprops/turnstyle/pull/39
- feature: wait for queued runs and an option to refresh runs from GitHub API by @vigneshmsft in https://github.com/softprops/turnstyle/pull/31

### Bug fixes 🐛

- fix: ignore inconsistent runs with status in_progress but conclusion success by @gustaff-weldon in https://github.com/softprops/turnstyle/pull/50

## 2.0.0

- Explain required GITHUB_TOKEN permissions by @chadxzs in https://github.com/softprops/turnstyle/pull/40
- Upgrade dependencies, add debug logs by @roryabraham in https://github.com/softprops/turnstyle/pull/46
- feat: bump action to use node20 runtime by @chenrui333 in https://github.com/softprops/turnstyle/pull/55

## 0.1.5

- Added feature to set the output `force_continued=true` when using `continue-after-seconds` so that only a subset of future steps can be skipped.

## 0.1.4

- Introduce `abort-after-seconds` input. This behaves much the way `continue-after-seconds` does but aborts from the workflow step rather than pushing onward. [#19](https://github.com/softprops/turnstyle/pull/19)
- Fix branch monitoring issue with `same-branch-only` when defaults inputs are provided [#20](https://github.com/softprops/turnstyle/pull/20)

## 0.1.3

- Introduce `same-branch-only` input, used to explicitly control whether a workflow runs should be synchronized across branches. The default remains `true` but can now be overridden to `false` [#7](https://github.com/softprops/turnstyle/pull/7)
- Favor `GITHUB_HEAD_REF` for branch name when present, typically the case for `pull_request` triggers [#8](https://github.com/softprops/turnstyle/pull/8)

## 0.1.2

- Query for previous runs at every iteration of the Waiter [#3](https://github.com/softprops/turnstyle/pull/4)

## 0.1.1

- Fix bug where `poll-interval-seconds` and `continue-after-seconds` were not getting parsed correctly as action inputs [#2](https://github.com/softprops/turnstyle/pull/2)

## 0.1.0

- Initial release
