import { setFailed, info } from "@actions/core";
import { env } from "process";
import { parseInput } from "./input";
import { GitHub, OctokitGitHub, Run } from "./github";

async function waitForIt(
  minutes: number,
  github: GitHub,
  owner: string,
  repo: string,
  run_id: number
) {
  const run = await github.run(owner, repo, run_id);
  if (run.status === "completed") {
    info("ready. moving forward");
    return;
  } else {
    info(`awaiting run ${run.html_url}...`);
    return new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));
  }
}

async function run() {
  try {
    const {
      githubToken,
      owner,
      repo,
      branch,
      workflowName,
      runId
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
        info("previous run");
        info(JSON.stringify(previousRun, null, 2));
        await waitForIt(1, github, owner, repo, runId);
      }
    }
  } catch (error) {
    setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}
