## 2.4.0

- Migrate from jest to vitest
- Bump to use node 24
- Dependency updates

## 2.3.2

maintenance release with updated dependencies

## 2.3.1

maintenance release with updated dependencies

## 2.3.0

## What's Changed

### Exciting New Features 🎉
* Adding support for waiting on specific job/step completion in turnstyle by @selecsosi in https://github.com/softprops/turnstyle/pull/98

## 2.2.3

fix lockfile issue

## 2.2.2

maintenance release with updated dependencies

## 2.2.1

maintenance release with updated dependencies

## 2.2.0

### Exciting New Features 🎉

- feature: support GitHub Enterprise by @zachwhaley in https://github.com/softprops/turnstyle/pull/62
- feat: wait for "waiting" runs as well as "in_progress" and "queued" by @zachwhaley in https://github.com/softprops/turnstyle/pull/63
- feat: get github.token as default input by @qoomon in https://github.com/softprops/turnstyle/pull/61

## 2.1.0

### Exciting New Features 🎉

- feature: fetch 100 results per page by @anomiex in https://github.com/softprops/turnstyle/pull/39
- feature: wait for queued runs and an option to refresh runs from GitHub API by @vigneshmsft in https://github.com/softprops/turnstyle/pull/31

### Bug fixes 🐛

- fix: ignore inconsistent runs that have a status set to 'in_progress' but conclusion is 'success' by @gustaff-weldon in https://github.com/softprops/turnstyle/pull/50

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
- Favour `GITHUB_HEAD_REF` for branch name when present, typically the case for `pull_request` triggers [#8](https://github.com/softprops/turnstyle/pull/8)

## 0.1.2

- Query for previous runs at every iteration of the Waiter [#3](https://github.com/softprops/turnstyle/pull/4)

## 0.1.1

- Fix bug where `poll-interval-seconds` and `continue-after-seconds` where not getting parsed correctly as action inputs [#2](https://github.com/softprops/turnstyle/pull/2)

## 0.1.0

- Initial release
