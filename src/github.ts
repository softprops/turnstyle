import { Octokit } from "@octokit/rest";
import { Endpoints } from "@octokit/types";
import { debug, warning } from "@actions/core";

export class OctokitGitHub {
  private readonly octokit: Octokit;
  constructor(githubToken: string) {
    Octokit.plugin(require("@octokit/plugin-throttling"));
    this.octokit = new Octokit({
      baseUrl: process.env["GITHUB_API_URL"] || "https://api.github.com",
      auth: githubToken,
      throttle: {
        onRateLimit: (retryAfter, options) => {
          warning(
            `Request quota exhausted for request ${options.method} ${options.url}`,
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
      per_page: 100,
    });

  runs = async (
    owner: string,
    repo: string,
    branch: string | undefined,
    workflow_id: number,
  ) => {
    const options: Endpoints["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"]["parameters"] =
      {
        owner,
        repo,
        workflow_id,
        per_page: 100,
      };

    if (branch) {
      options.branch = branch;
    }

    const in_progress_options = {
      ...options,
      status: "in_progress" as const,
    };
    const queued_options = {
      ...options,
      status: "queued" as const,
    };
    const waiting_options = {
      ...options,
      status: "waiting" as const,
    };

    const in_progress_runs = this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns,
      in_progress_options,
    );

    const queued_runs = this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns,
      queued_options,
    );

    const waiting_runs = this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns,
      waiting_options,
    );

    return Promise.all([in_progress_runs, queued_runs, waiting_runs]).then(
      (values) => values.flat(),
    );
  };
}
