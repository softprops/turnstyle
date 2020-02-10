import { setFailed, info } from "@actions/core";
import { env } from "process";
import { parseInput } from "./input";
import { GitHub, OctokitGitHub, Run } from "./github";

async function waitForIt(
  github: GitHub,
  owner: string,
  repo: string,
  run_id: number,
  secondsSoFar: number,
  pollIntervalSeconds: number,
  continueAfterSeconds: number | undefined
) {
  if (continueAfterSeconds && secondsSoFar >= continueAfterSeconds) {
    info(`🤙Exceeded wait seconds. Continuing...`);
  }
  const run = await github.run(owner, repo, run_id);
  if (run.status === "completed") {
    info(`👍 Run ${run.html_url} complete.`);
    return;
  }
  info(`✋Awaiting run ${run.html_url}...`);
  await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
  return waitForIt(
    github,
    owner,
    repo,
    run_id,
    secondsSoFar + pollIntervalSeconds,
    pollIntervalSeconds,
    continueAfterSeconds
  );
}

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
        await waitForIt(
          github,
          owner,
          repo,
          previousRun.id,
          0,
          pollIntervalSeconds,
          continueAfterSeconds
        );
      }
    }
  } catch (error) {
    setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}
