import { debug, warning } from '@actions/core';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import { Endpoints } from '@octokit/types';

const ThrottledOctokit = Octokit.plugin(throttling);
const MAX_ELIGIBLE_WORKFLOW_RUNS = 500;
const ACTIVE_RUN_STATUSES = new Set(['in_progress', 'queued', 'waiting']);

export type WorkflowRun =
  Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['response']['data']['workflow_runs'][number];

export interface WorkflowRunFilters {
  branch?: string;
  queueName?: string;
}

const matchesWorkflowRunFilters = (run: WorkflowRun, filters: WorkflowRunFilters) => {
  if (!ACTIVE_RUN_STATUSES.has(run.status || '')) {
    return false;
  }

  if (filters.branch && run.head_branch && run.head_branch !== filters.branch) {
    return false;
  }

  if (
    filters.queueName &&
    !run.display_title?.includes(filters.queueName) &&
    !run.name?.includes(filters.queueName)
  ) {
    return false;
  }

  return true;
};

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

  run = async (owner: string, repo: string, run_id: number): Promise<WorkflowRun> => {
    const { data } = await this.octokit.actions.getWorkflowRun({
      owner,
      repo,
      run_id,
    });
    return data as WorkflowRun;
  };

  runs = async (
    owner: string,
    repo: string,
    workflow_id: number,
    filters: WorkflowRunFilters = {},
  ): Promise<WorkflowRun[]> => {
    const options: Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['parameters'] =
      {
        owner,
        repo,
        workflow_id,
        per_page: 100,
      };

    let eligibleRuns = 0;
    const runs = await this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns,
      options,
      (response, done) => {
        const filteredRuns = response.data.filter((run) => matchesWorkflowRunFilters(run, filters));
        eligibleRuns += filteredRuns.length;
        if (eligibleRuns >= MAX_ELIGIBLE_WORKFLOW_RUNS) {
          done();
        }
        return filteredRuns;
      },
    );
    return runs.slice(0, MAX_ELIGIBLE_WORKFLOW_RUNS);
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
