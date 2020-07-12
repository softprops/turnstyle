## 0.1.3

* Introduce `same-branch-only` input, used to explicitly control whether a workflow runs should be synchronized across branches. The default remains `true` but can not be overridden to `false` [#17](https://github.com/softprops/turnstyle/pull/7)
* Favour `GITHUB_HEAD_REF` for branch name when present, typically the case for `pull_request` triggers [https://github.com/softprops/turnstyle/pull/8](#8)

## 0.1.2

* Query for previous runs at every iteration of the Waiter [#3](https://github.com/softprops/turnstyle/pull/4)

## 0.1.1

* Fix bug where `poll-interval-seconds` and `continue-after-seconds` where not getting parsed correctly as action inputs [#2](https://github.com/softprops/turnstyle/pull/2)

## 0.1.0

* Initial release