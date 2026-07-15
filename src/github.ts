import { warning } from '@actions/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import type { EndpointDefaults, Endpoints, RequestParameters } from '@octokit/types';
import { retryRequest } from './retry';

const ThrottledOctokit = Octokit.plugin(throttling, retry);
const MAX_WORKFLOW_RUN_PAGES = 50;
const ACTIVE_RUN_STATUSES = ['in_progress', 'queued', 'waiting'] as const;
const ACTIVE_RUN_STATUS_SET = new Set<string>(ACTIVE_RUN_STATUSES);
type ThrottleRequestOptions = Pick<Required<EndpointDefaults>, 'method' | 'url'>;

export const createThrottleOptions = (retryThroughPlugin: boolean = true) => ({
  onRateLimit: (
    retryAfter: number,
    options: ThrottleRequestOptions,
    _octokit: unknown,
    retryCount: number,
  ): true | undefined => {
    warning(`Request quota exhausted for request ${options.method} ${options.url}`);

    if (retryCount < 1) {
      // only retries once
      warning(`Retrying after ${retryAfter} seconds!`);
      return retryThroughPlugin ? true : undefined;
    }

    return undefined;
  },
  onSecondaryRateLimit: (_retryAfter: number, options: ThrottleRequestOptions) => {
    // does not retry, only logs a warning
    warning(`Secondary rate limit detected for request ${options.method} ${options.url}`);
  },
});

export type WorkflowRun =
  Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['response']['data']['workflow_runs'][number];
export type WorkflowJob =
  Endpoints['GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs']['response']['data']['jobs'][number];
export type WorkflowStep = NonNullable<WorkflowJob['steps']>[number];

export interface WorkflowRunFilters {
  branch?: string;
  queueName?: string;
}

export interface GitHubRequestOptions {
  signal?: AbortSignal;
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

  constructor(githubToken: string, retries: number = 0) {
    this.octokit = new ThrottledOctokit({
      baseUrl: process.env['GITHUB_API_URL'] || 'https://api.github.com',
      auth: githubToken,
      // Turnstyle installs its equivalent request hook below so a shared
      // action signal can cancel 5xx backoff. Disable plugin-retry's private
      // Bottleneck timer while retaining the plugin dependency and API shape.
      retry: {
        enabled: false,
      },
      // The callback keeps the existing warning behavior but declines the
      // plugin's private retry timer. The request hook below applies the same
      // retry policy through Turnstyle's abortable scheduler.
      throttle: createThrottleOptions(false),
    });

    this.octokit.hook.wrap('request', (request, options) => {
      return retryRequest(
        (retryCount) =>
          Promise.resolve(
            request({
              ...options,
              request: {
                ...options.request,
                retryCount,
              },
            }),
          ),
        retries,
        options.request.signal,
      );
    });
  }

  workflows = async (owner: string, repo: string, requestOptions: GitHubRequestOptions = {}) =>
    this.octokit.paginate(this.octokit.actions.listRepoWorkflows, {
      owner,
      repo,
      per_page: 100,
      ...(requestOptions.signal ? { request: { signal: requestOptions.signal } } : {}),
    });

  run = async (
    owner: string,
    repo: string,
    run_id: number,
    requestOptions: GitHubRequestOptions = {},
  ): Promise<WorkflowRun> => {
    const { data } = await this.octokit.actions.getWorkflowRun({
      owner,
      repo,
      run_id,
      ...(requestOptions.signal ? { request: { signal: requestOptions.signal } } : {}),
    });
    return data as WorkflowRun;
  };

  private listActiveRuns = async (
    listRuns:
      | typeof this.octokit.actions.listWorkflowRuns
      | typeof this.octokit.actions.listWorkflowRunsForRepo,
    baseOptions: Record<string, unknown>,
    filters: WorkflowRunFilters,
    requestOptions: GitHubRequestOptions = {},
  ): Promise<WorkflowRun[]> => {
    const runsById = new Map<number, WorkflowRun>();
    type WorkflowRunPaginator = (
      listRuns:
        | typeof this.octokit.actions.listWorkflowRuns
        | typeof this.octokit.actions.listWorkflowRunsForRepo,
      options: Record<string, unknown>,
      map: (response: { data: WorkflowRun[] }, done: () => void) => WorkflowRun[],
    ) => Promise<WorkflowRun[]>;
    const paginateWorkflowRuns = this.octokit.paginate as unknown as WorkflowRunPaginator;

    await Promise.all(
      ACTIVE_RUN_STATUSES.map(async (status) => {
        let pagesScanned = 0;
        const runs = await paginateWorkflowRuns(
          listRuns,
          {
            ...baseOptions,
            ...(filters.branch ? { branch: filters.branch } : {}),
            status,
            ...(requestOptions.signal ? { request: { signal: requestOptions.signal } } : {}),
          },
          (response: { data: WorkflowRun[] }, done: () => void) => {
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

        for (const run of runs) {
          runsById.set(run.id, run);
        }
      }),
    );
    return [...runsById.values()];
  };

  runs = async (
    owner: string,
    repo: string,
    workflow_id: number,
    filters: WorkflowRunFilters = {},
    requestOptions: GitHubRequestOptions = {},
  ): Promise<WorkflowRun[]> => {
    type ListWorkflowRunsOptions = RequestParameters &
      Endpoints['GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs']['parameters'];
    const baseOptions: ListWorkflowRunsOptions = {
      owner,
      repo,
      workflow_id,
      per_page: 100,
    };

    return this.listActiveRuns(
      this.octokit.actions.listWorkflowRuns,
      baseOptions,
      filters,
      requestOptions,
    );
  };

  activeRunsForRepo = async (
    owner: string,
    repo: string,
    filters: WorkflowRunFilters = {},
    requestOptions: GitHubRequestOptions = {},
  ): Promise<WorkflowRun[]> => {
    type ListWorkflowRunsForRepoOptions = RequestParameters &
      Endpoints['GET /repos/{owner}/{repo}/actions/runs']['parameters'];
    const baseOptions: ListWorkflowRunsForRepoOptions = {
      owner,
      repo,
      per_page: 100,
    };

    return this.listActiveRuns(
      this.octokit.actions.listWorkflowRunsForRepo,
      baseOptions,
      filters,
      requestOptions,
    );
  };

  jobs = async (
    owner: string,
    repo: string,
    run_id: number,
    requestOptions: GitHubRequestOptions = {},
  ) => {
    const options: Endpoints['GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs']['parameters'] =
      {
        owner,
        repo,
        run_id,
        per_page: 100,
        ...(requestOptions.signal ? { request: { signal: requestOptions.signal } } : {}),
      };

    return this.octokit.paginate(this.octokit.actions.listJobsForWorkflowRun, options);
  };

  steps = async (
    owner: string,
    repo: string,
    job_id: number,
    requestOptions: GitHubRequestOptions = {},
  ) => {
    const options: Endpoints['GET /repos/{owner}/{repo}/actions/jobs/{job_id}']['parameters'] = {
      owner,
      repo,
      job_id,
      ...(requestOptions.signal ? { request: { signal: requestOptions.signal } } : {}),
    };
    const { data: job } = await this.octokit.actions.getJobForWorkflowRun(options);
    return job.steps || [];
  };
}
