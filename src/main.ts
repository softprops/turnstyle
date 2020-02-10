import { setFailed, info } from "@actions/core";
import { env } from "process";
import { parseInput } from "./input";
import { OctokitGitHub } from "./github";
import { Waiter } from "./wait";

async function run() {
  try {
    const {
      githubToken,
      owner,
      repo,
      branch,
      workflowName,
      runId,
      continueAfterSeconds,
      pollIntervalSeconds
    } = parseInput(env);
    const github = new OctokitGitHub(githubToken);
    const workflows = await github.workflows(owner, repo);
    const workflow_id = workflows.find(
      workflow => workflow.name == workflowName
    )?.id;
    if (workflow_id) {
      const runs = await github.runs(owner, repo, branch, workflow_id);
      const previousRun = runs
        .filter(run => run.id < runId)
        .sort((a, b) => a.id - b.id)[0];
      if (previousRun) {
        await new Waiter(
          github,
          owner,
          repo,
          previousRun.id,
          pollIntervalSeconds,
          continueAfterSeconds
        ).wait(0);
      }
    }
  } catch (error) {
    setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}
