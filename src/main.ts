import { setFailed, debug, warning, info } from "@actions/core";
import { env } from "process";
import { Octokit } from "@octokit/rest";

export interface Config {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  workflowName: string;
  runId: number;
}

export interface Workflow {
  id: string;
  name: string;
}

export interface Run {
  id: string;
  status: string;
}

export interface GitHub {
  workflows: (owner: string, repo: string) => Promise<Array<Workflow>>;
  runs: (
    owner: string,
    repo: string,
    branch: string,
    workflow_id: number
  ) => Promise<Array<Run>>;
}

export class OctokitGitHub implements GitHub {
  private readonly octokit: Octokit;
  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  workflows = async (owner: string, repo: string) => {
    const listWorkFlowsOptions = this.octokit.actions.listRepoWorkflows.endpoint.merge(
      {
        owner,
        repo
      }
    );
    return this.octokit.paginate(listWorkFlowsOptions);
  };

  runs = async (
    owner: string,
    repo: string,
    branch: string | undefined,
    workflow_id: number
  ) => {
    const runOptions = this.octokit.actions.listWorkflowRuns.endpoint.merge({
      owner,
      repo,
      branch,
      workflow_id
    });
    return this.octokit.paginate(runOptions);
  };
}

export const parseConfig = (
  env: Record<string, string | undefined>
): Config => {
  const githubToken = env.GITHUB_TOKEN || "";
  const [owner, repo] = (env.GITHUB_REPOSITORY || "").split("/");
  const workflowName = env.GITHUB_WORKFLOW || "";
  const branch = env.GITHUB_REF?.substring(11) || "master";
  const runId = parseInt(env.GITHUB_RUN_ID || "0", 10);
  return {
    githubToken,
    owner,
    repo,
    branch,
    workflowName,
    runId
  };
};

async function run() {
  try {
    const {
      githubToken,
      owner,
      repo,
      branch,
      workflowName,
      runId
    } = parseConfig(env);
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
    const workflow_id =
      workflows.find(workflow => workflow.name == workflowName)?.id || 0;
    info(`workflow named ${workflowName}`);
    info(workflow_id);
    const runs = await github.runs(owner, repo, branch, workflow_id);
    info(`runs for workflow ${workflow_id} on branch ${branch} ${runs}`);
    const previousRun = runs
      .filter(run => run.id < runId)
      .sort((a, b) => a.id - b.id)[0];
    info("previous run");
    info(previousRun);
  } catch (error) {
    setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}
