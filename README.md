<div align="center" style="font-size:2em">
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

GitHub actions is event-oriented. Your workflows are run in response to events independently and without coordination. For example, in a shared repository if two or more different
people merge pull requests those will each trigger workflows each without regard to one another.

This can be problematic for workflows used as part of a continuous deployment process. For example, you might want to let an in-flight deployment complete before progressing further with the next workflow. This is the use case turnstyle action targets.

## 🤸 Usage

The typical setup for diffset involves adding job step using `softprops/turnstyle@master`.

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

#### inputs

None.


#### outputs

None.

#### environment variables

The following are *required* as `step.env` keys

| Name           | Description                          |
|----------------|--------------------------------------|
| `GITHUB_TOKEN` | GITHUB_TOKEN as provided by `secrets`|

Doug Tangren (softprops) 2020
