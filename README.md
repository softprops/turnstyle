<div align="center" size="2em">
  🎟️
</div>

<h1 align="center">
  turnstyle
</h1>

<p align="center">
   A GitHub Action for serializing workflow runs
</p>

<div align="center">
  <a href="https://github.com/softprops/turnstyle/actions">
		<img src="https://github.com/softprops/turnstyle/workflows/Main/badge.svg"/>
	</a>
</div>

<br />

## 🤔 why bother

GitHub Actions is and event-oriented system. Your workflows run in response to events triggered independently and without coordination. In a shared repository, if two or more people merge pull requests those will each trigger workflows each without regard to one another.

This can be problematic for workflows used as part of a continuous deployment process. You might want to let an in-flight deployment complete before progressing further with the next workflow. This is the usecase turnstyle action targets.

## 🤸 Usage

The typical setup for turnstyle involves adding job step using `softprops/turnstyle@master`.

```diff
name: Main

on: push

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
+     - name: Turnstyle
+       uses: softprops/turnstyle@master
+       env:
+         GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
        run: sleep 30
```

### Timing out

To avoid waiting prolonged periods of time, you may wish to bail on a run or continuing a workflow run regardless of the status of the previous run.

You can bail from a run using the built in GitHub actions [`jobs.<job_id>.timeout-minutes`](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes)

```diff
name: Main

on: push

jobs:
  main:
+   timeout-minutes: 5
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
      - name: Turnstyle
        uses: softprops/turnstyle@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
        run: sleep 30
```

You can also limit how long a you're willing to wait before going again and progressing a workflow run with `jobs.<job_id>.steps.with.timeout-seconds`

```diff
name: Main

on: push

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
      - name: Turnstyle
        uses: softprops/turnstyle@master
        with:
+         continue-after-seconds: 180 
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
        run: sleep 30
```

#### inputs

| Name        | Type    | Description                                                     |
|-------------|---------|-----------------------------------------------------------------|
| `continue-after-seconds`   | number  | Maximum number of seconds to wait before moving forward (unbound by default)                          |
| `poll-interval-seconds`      | number  | Number of seconds to wait in between checks for previous run completion (defaults to 60)                |

#### outputs

None.

#### environment variables

The following are *required* as `step.env` keys

| Name           | Description                          |
|----------------|--------------------------------------|
| `GITHUB_TOKEN` | GITHUB_TOKEN as provided by `secrets`|

Doug Tangren (softprops) 2020.
