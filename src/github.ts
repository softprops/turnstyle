import { debug, warning } from '@actions/core';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import { Endpoints } from '@octokit/types';

const ThrottledOctokit = Octokit.plugin(throttling);
const MAX_WORKFLOW_RUN_PAGES = 50;
const ACTIVE_RUN_STATUSES = ['in_progress', 'queued', 'waiting'] as const;
const ACTIVE_RUN_STATUS_SET = new Set<string>(ACTIVE_RUN_STATUSES);

export type WorkflowRun =
  Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['response']['data']['workflow_runs'][number];

export interface WorkflowRunFilters {
  branch?: string;
  queueName?: string;
}

const matchesWorkflowRunFilters = (run: WorkflowRun, filters: WorkflowRunFilters) => {
  if (!ACTIVE_RUN_STATUS_SET.has(run.status || '')) {
    return false;
  }

  if (filters.branch && run.head_branch !== filters.branch) {
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
    type ListWorkflowRunsOptions =
      Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['parameters'];
    const baseOptions: ListWorkflowRunsOptions = {
      owner,
      repo,
      workflow_id,
      per_page: 100,
    };

    const listRuns = async (options: ListWorkflowRunsOptions) => {
      let pagesScanned = 0;
      const runs = await this.octokit.paginate(
        this.octokit.actions.listWorkflowRuns,
        options,
        (response, done) => {
          pagesScanned += 1;
          const filteredRuns = response.data.filter((run) =>
            matchesWorkflowRunFilters(run, filters),
          );
          if (pagesScanned >= MAX_WORKFLOW_RUN_PAGES) {
            done();
          }
          return filteredRuns;
        },
      );
      return runs;
    };

    // Combine unfiltered discovery for stale status-filter safety with active status queries so
    // completed history cannot consume GitHub's search caps.
    const unfilteredRuns = await listRuns(baseOptions);
    const statusFilteredRuns = await Promise.all(
      ACTIVE_RUN_STATUSES.map((status) =>
        listRuns({
          ...baseOptions,
          ...(filters.branch ? { branch: filters.branch } : {}),
          status,
        }),
      ),
    );

    const runsById = new Map<number, WorkflowRun>();
    for (const run of [unfilteredRuns, ...statusFilteredRuns].flat()) {
      runsById.set(run.id, run);
    }
    return [...runsById.values()];
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
