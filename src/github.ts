import { Octokit } from "@octokit/rest";
import { Endpoints } from "@octokit/types";
import { debug, warning } from "@actions/core";

export class OctokitGitHub {
  private readonly octokit: Octokit;
  constructor(githubToken: string) {
    Octokit.plugin(require("@octokit/plugin-throttling"));
    this.octokit = new Octokit({
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
          debug(`Abuse detected for request ${options.method} ${options.url}`);
        },
      },
    });
  }

  workflows = async (owner: string, repo: string) =>
    this.octokit.paginate(this.octokit.actions.listRepoWorkflows, {
      owner,
      repo,
    });

  runs = async (
    owner: string,
    repo: string,
    branch: string | undefined,
    workflow_id: number
  ) => {
    const options: Endpoints["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"]["parameters"] =
      {
        owner,
        repo,
        workflow_id,
        status: "in_progress",
      };

    if (branch) {
      options.branch = branch;
    }

    return this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns,
      options
    );
  };
}
