import { debug, warning } from '@actions/core';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import { Endpoints } from '@octokit/types';

const ThrottledOctokit = Octokit.plugin(throttling);
const MAX_WORKFLOW_RUNS = 500;

export type WorkflowRun =
  Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['response']['data']['workflow_runs'][number];

export class OctokitGitHub {
  private readonly octokit: InstanceType<typeof ThrottledOctokit>;

  constructor(githubToken: string) {
    this.octokit = new ThrottledOctokit({
      baseUrl: process.env['GITHUB_API_URL'] || 'https://api.github.com',
      auth: githubToken,
      throttle: {
        onRateLimit: (retryAfter, options, octokit, retryCount) => {
          warning(`Request quota exhausted for request ${options.method} ${options.url}`);

          if (retryCount < 1) {
            // only retries once
            debug(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onSecondaryRateLimit: (retryAfter, options) => {
          // does not retry, only logs a warning
          debug(`Secondary rate limit detected for request ${options.method} ${options.url}`);
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

  runs = async (owner: string, repo: string, workflow_id: number): Promise<WorkflowRun[]> => {
    const options: Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['parameters'] =
      {
        owner,
        repo,
        workflow_id,
        per_page: 100,
      };

    let fetchedRuns = 0;
    const runs = await this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns,
      options,
      (response, done) => {
        fetchedRuns += response.data.length;
        if (fetchedRuns >= MAX_WORKFLOW_RUNS) {
          done();
        }
        return response.data;
      },
    );
    return runs.slice(0, MAX_WORKFLOW_RUNS);
  };

  jobs = async (owner: string, repo: string, run_id: number) => {
    const options: Endpoints['GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs']['parameters'] =
      {
        owner,
        repo,
        run_id,
        per_page: 100,
      };

    return this.octokit.paginate(this.octokit.actions.listJobsForWorkflowRun, options);
  };

  steps = async (owner: string, repo: string, job_id: number) => {
    const options: Endpoints['GET /repos/{owner}/{repo}/actions/jobs/{job_id}']['parameters'] = {
      owner,
      repo,
      job_id,
    };
    const { data: job } = await this.octokit.actions.getJobForWorkflowRun(options);
    return job.steps || [];
  };
}
