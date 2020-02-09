import { setFailed, debug, warning, info } from "@actions/core";
import { env } from "process";
import { Octokit } from "@octokit/rest";
import { parseInput } from "./input";
import { OctokitGitHub } from "./github";

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
    Octokit.plugin(require("@octokit/plugin-throttling"));
    const github = new OctokitGitHub(
      new Octokit({
        auth: githubToken,
        throttle: {
          onRateLimit: (retryAfter, options) => {
            warning(
              `Request quota exhausted for request ${options.method} ${options.url}`
            );

            if (options.request.retryCount === 0) {
              // only retries once
              debug(`Retrying after ${retryAfter} seconds!`);
              return true;
            }
          },
          onAbuseLimit: (retryAfter, options) => {
            // does not retry, only logs a warning
            debug(
              `Abuse detected for request ${options.method} ${options.url}`
            );
          }
        }
      })
    );
    const workflows = await github.workflows(owner, repo);
    const workflow_id = workflows.find(
      workflow => workflow.name == workflowName
    )?.id;
    if (workflow_id) {
      const runs = await github.runs(owner, repo, branch, workflow_id);
      info(
        `runs for workflow ${workflow_id} on branch ${branch} ${JSON.stringify(
          runs,
          null,
          2
        )}`
      );
      const previousRun = runs
        .filter(run => run.id < runId)
        .sort((a, b) => a.id - b.id)[0];
      if (previousRun) {
        info("previous run");
        info(JSON.stringify(previousRun, null, 2));
      }
    }
  } catch (error) {
    setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}
