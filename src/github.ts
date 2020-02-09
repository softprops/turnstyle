import { Octokit } from "@octokit/rest";

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
  constructor(githubToken: string) {
    Octokit.plugin(require("@octokit/plugin-throttling"));
    this.octokit = new Octokit({
      auth: githubToken,
      throttle: {
        onRateLimit: (retryAfter, options) => {
          console.warn(
            `Request quota exhausted for request ${options.method} ${options.url}`
          );

          if (options.request.retryCount === 0) {
            // only retries once
            console.debug(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onAbuseLimit: (retryAfter, options) => {
          // does not retry, only logs a warning
          console.debug(
            `Abuse detected for request ${options.method} ${options.url}`
          );
        }
      }
    });
  }

  workflows = async (owner: string, repo: string) =>
    this.octokit.paginate(
      this.octokit.actions.listRepoWorkflows.endpoint.merge({
        owner,
        repo
      })
    );

  runs = async (
    owner: string,
    repo: string,
    branch: string | undefined,
    workflow_id: number
  ) =>
    this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns.endpoint.merge({
        owner,
        repo,
        branch,
        workflow_id,
        status: "in_progress"
      })
    );
}
