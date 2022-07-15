<h1 align="center">
  🎟️
  <br/>
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

GitHub Actions is an event-oriented system. Your workflows run in response to events and are triggered independently and without coordination. In a shared repository, if two or more people merge pull requests, each will trigger workflows without regard to one another.

This can be problematic for workflows used as part of a continuous deployment process. You might want to let an in-flight deployment complete before progressing further with the next workflow. This is the usecase turnstyle action targets.

## 🤸 Usage

The typical setup for turnstyle involves adding job step using `softprops/turnstyle@v1`.

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
+       uses: softprops/turnstyle@v1
+       env:
+         GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
        run: sleep 30
```

### Timing out

To avoid waiting prolonged periods of time, you may wish to bail on a run or continuing a workflow run regardless of the status of the previous run.

You can bail from a run using the built-in GitHub Actions [`jobs.<job_id>.timeout-minutes`](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes) setting

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
        uses: softprops/turnstyle@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
        run: sleep 30
```

You can also limit how long you're willing to wait before moving on with `jobs.<job_id>.steps.with.continue-after-seconds`

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
        uses: softprops/turnstyle@v1
        with:
+         continue-after-seconds: 180
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
        run: sleep 30
```

or before aborting the step with `jobs.<job_id>.steps.with.abort-after-seconds`


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
        uses: softprops/turnstyle@v1
        with:
+         abort-after-seconds: 180
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
        run: sleep 30
```

Finally, you can use the `force_continued` output to skip only a subset of steps
by setting `continue-after-seconds` and conditioning future steps with
`if: ! steps.<step id>.outputs.force_continued`


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
        id: turnstyle
        uses: softprops/turnstyle@v1
        with:
+         continue-after-seconds: 180
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Deploy
+       if: ! steps.turnstyle.outputs.force_continued
        run: sleep 30
```

#### inputs

| Name                    | Type    | Description                                                                                                                    |
|-------------------------|---------|--------------------------------------------------------------------------------------------------------------------------------|
| `continue-after-seconds`| number  | Maximum number of seconds to wait before moving forward (unbound by default). Mutually exclusive with abort-after-seconds      |
| `abort-after-seconds`   | number  | Maximum number of seconds to wait before aborting the job (unbound by default). Mutually exclusive with continue-after-seconds |
| `poll-interval-seconds` | number  | Number of seconds to wait in between checks for previous run completion (defaults to 60)                                       |
| `same-branch-only`      | boolean | Only wait on other runs from the same branch (defaults to true)                                                                |

#### outputs

| Name                    | Type     | Description                                                                                     |
|-------------------------|----------|-------------------------------------------------------------------------------------------------|
| `force_continued`       | boolean  | True if continue-after-seconds is used and the step using turnstyle continued. False otherwise. |

#### environment variables

The following are *required* as `step.env` keys

| Name           | Description                          |
|----------------|--------------------------------------|
| `GITHUB_TOKEN` | GITHUB_TOKEN as provided by `secrets`|

## required permissions

Because this application leverages the `GITHUB_TOKEN` to make API requests, the
permissions granted to the token must be sufficient to make the API requests.
By default, the token has wide enough permissions to allow all API requests
made by this action. If you are customizing your token permissions, you must
explicitly specify all permissions, including those that you need that would
otherwise be granted by the defaults. See ["Permissions for the
GITHUB_TOKEN"](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token)
In the GitHub Actions documentation.

If you need to specify explicit permissions for the API requests made by this
action, the permissions required are:

- `actions:read` - this permission is required for the [listWorkflowRunsForRepo](https://octokit.github.io/rest.js/v18#actions-list-workflow-runs-for-repo)
API request.

## cost of coordination

At this time there is no way to coordinate between workflow runs beyond waiting. For those using private repositories, [you are charged based on the time your workflow spends running](https://github.com/features/actions#pricing-details). Waiting within one workflow run for another to complete will incur the cost of the time spent waiting.

Doug Tangren (softprops) 2020
