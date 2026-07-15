import { setOutput } from '@actions/core';
import {
  ActionDeadline,
  DeadlineReached,
  handleDeadline,
  systemDeadlineTiming,
  type DeadlineTiming,
} from './deadline';
import type {
  GitHubRequestOptions,
  WorkflowJob,
  WorkflowRun,
  WorkflowRunFilters,
  WorkflowStep,
} from './github';
import type { Input } from './input';

const ACTIVE_RUN_STATUSES = new Set(['in_progress', 'queued', 'waiting']);
const MAX_PREVIOUS_WORKFLOW_RUNS = 500;

const parseTimestamp = (value: string | null | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
};

const runTimestamp = (run: WorkflowRun): number | undefined =>
  parseTimestamp(run.run_started_at) || parseTimestamp(run.created_at);

const runStartedTimestamp = (run: WorkflowRun): number | undefined =>
  parseTimestamp(run.run_started_at);

const runCreatedTimestamp = (run: WorkflowRun): number | undefined =>
  parseTimestamp(run.created_at);

const isRerunAttempt = (run: WorkflowRun): boolean => (run.run_attempt || 1) > 1;

const isActiveRun = (run: WorkflowRun) => ACTIVE_RUN_STATUSES.has(run.status || '');

const isRunOnSameBranch = (run: WorkflowRun, input: Input) =>
  !input.sameBranchOnly || run.head_branch === input.branch;

const filterEligibleRuns = (runs: WorkflowRun[], input: Input) =>
  runs.filter(isActiveRun).filter((run) => isRunOnSameBranch(run, input));

const findCurrentRun = (runs: WorkflowRun[], input: Input) =>
  runs.find((run) => run.id === input.runId && run.run_attempt === input.runAttempt) ||
  runs.find((run) => run.id === input.runId);

const isPreviousRun = (run: WorkflowRun, input: Input, currentRunStartedAt: number | undefined) => {
  if (run.id === input.runId) {
    return false;
  }

  if (isRerunAttempt(run)) {
    const startedAt = runStartedTimestamp(run);
    if (currentRunStartedAt === undefined || startedAt === undefined) {
      return false;
    }

    return (
      startedAt < currentRunStartedAt || (startedAt === currentRunStartedAt && run.id < input.runId)
    );
  }

  if (input.runAttempt <= 1 || currentRunStartedAt === undefined) {
    return run.id < input.runId;
  }

  if (run.id < input.runId) {
    return true;
  }

  const createdAt = runCreatedTimestamp(run);
  if (createdAt !== undefined && createdAt < currentRunStartedAt) {
    return true;
  }

  const startedAt = runTimestamp(run);
  if (startedAt === undefined) {
    return false;
  }

  return (
    startedAt < currentRunStartedAt || (startedAt === currentRunStartedAt && run.id < input.runId)
  );
};

const compareRunsNewestFirst = (a: WorkflowRun, b: WorkflowRun) => {
  const aTimestamp = runTimestamp(a);
  const bTimestamp = runTimestamp(b);

  if (aTimestamp !== undefined && bTimestamp !== undefined && aTimestamp !== bTimestamp) {
    return bTimestamp - aTimestamp;
  }

  return b.id - a.id;
};

const outputPreviousRun = (run: WorkflowRun | undefined) => {
  setOutput('previous_run_id', run ? String(run.id) : '');
  setOutput('previous_run_url', run?.html_url || '');
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface WaiterGitHubClient {
  run(
    owner: string,
    repo: string,
    runId: number,
    requestOptions?: GitHubRequestOptions,
  ): Promise<WorkflowRun>;
  runs(
    owner: string,
    repo: string,
    workflowId: number,
    filters?: WorkflowRunFilters,
    requestOptions?: GitHubRequestOptions,
  ): Promise<WorkflowRun[]>;
  activeRunsForRepo(
    owner: string,
    repo: string,
    filters?: WorkflowRunFilters,
    requestOptions?: GitHubRequestOptions,
  ): Promise<WorkflowRun[]>;
  jobs(
    owner: string,
    repo: string,
    runId: number,
    requestOptions?: GitHubRequestOptions,
  ): Promise<WorkflowJob[]>;
  steps(
    owner: string,
    repo: string,
    jobId: number,
    requestOptions?: GitHubRequestOptions,
  ): Promise<WorkflowStep[]>;
}

export interface Wait {
  wait(secondsSoFar?: number): Promise<number | undefined>;
}

export class Waiter implements Wait {
  private readonly info: (msg: string) => void;
  private readonly debug: (msg: string) => void;
  private readonly input: Input;
  private readonly githubClient: WaiterGitHubClient;
  private readonly workflowId: number;
  private readonly timing: DeadlineTiming;
  private readonly sharedDeadline: ActionDeadline | undefined;
  private previousRunOutput: WorkflowRun | undefined;
  private deadline: ActionDeadline | undefined;

  constructor(
    workflowId: number,
    githubClient: WaiterGitHubClient,
    input: Input,
    info: (msg: string) => void,
    debug: (msg: string) => void,
    timing: DeadlineTiming = systemDeadlineTiming,
    deadline?: ActionDeadline,
  ) {
    this.workflowId = workflowId;
    this.input = input;
    this.githubClient = githubClient;
    this.info = info;
    this.debug = debug;
    this.timing = timing;
    this.sharedDeadline = deadline;
  }

  private setPreviousRunOutput = (run: WorkflowRun) => {
    if (this.previousRunOutput && compareRunsNewestFirst(run, this.previousRunOutput) >= 0) {
      return;
    }

    this.previousRunOutput = run;
    outputPreviousRun(run);
  };

  private clearPreviousRunOutput = () => {
    if (!this.previousRunOutput) {
      outputPreviousRun(undefined);
    }
  };

  private withDeadline = async <T>(
    operation: (signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> => {
    const deadline = this.deadline;
    if (!deadline) {
      throw new Error('Wait deadline has not been initialized');
    }

    return deadline.race(operation);
  };

  private discoverRuns = async (): Promise<{
    currentRun: WorkflowRun | undefined;
    filteredRuns: WorkflowRun[];
  }> => {
    this.debug(`Fetching workflow runs for workflow ID: ${this.workflowId}`);
    const queueName = this.input.queueName;
    return this.withDeadline(async (signal) => {
      const requestOptions = signal ? { signal } : undefined;
      let currentRun: WorkflowRun | undefined;
      try {
        currentRun = requestOptions
          ? await this.githubClient.run(
              this.input.owner,
              this.input.repo,
              this.input.runId,
              requestOptions,
            )
          : await this.githubClient.run(this.input.owner, this.input.repo, this.input.runId);
      } catch (error: unknown) {
        signal?.throwIfAborted();
        this.debug(`Failed to fetch current run ${this.input.runId}: ${errorMessage(error)}`);
      }
      signal?.throwIfAborted();

      const runFilters = {
        branch: this.input.sameBranchOnly ? this.input.branch : undefined,
      };
      const runs = requestOptions
        ? await this.githubClient.runs(
            this.input.owner,
            this.input.repo,
            this.workflowId,
            runFilters,
            requestOptions,
          )
        : await this.githubClient.runs(
            this.input.owner,
            this.input.repo,
            this.workflowId,
            runFilters,
          );

      this.debug(`Found ${runs.length} ${this.workflowId} runs`);

      currentRun = currentRun || findCurrentRun(runs, this.input);
      let filteredRuns = filterEligibleRuns(runs, this.input);

      if (queueName) {
        this.debug(`Searching active workflow runs across repository for queue name: ${queueName}`);
        signal?.throwIfAborted();
        const queueRuns = requestOptions
          ? await this.githubClient.activeRunsForRepo(
              this.input.owner,
              this.input.repo,
              runFilters,
              requestOptions,
            )
          : await this.githubClient.activeRunsForRepo(
              this.input.owner,
              this.input.repo,
              runFilters,
            );

        currentRun = currentRun || findCurrentRun(queueRuns, this.input);
        filteredRuns = filterEligibleRuns(queueRuns, this.input).filter((run) => {
          const matchesQueue =
            run.display_title?.includes(queueName) || run.name?.includes(queueName);
          if (matchesQueue) {
            this.debug(
              `Run ${run.id} (${run.display_title || run.name}) matches queue: "${queueName}"`,
            );
          }
          return matchesQueue;
        });

        this.debug(`After queue filtering: ${filteredRuns.length} runs match queue "${queueName}"`);
      }

      return { currentRun, filteredRuns };
    });
  };

  private waitForCompletion = async (): Promise<void> => {
    while (true) {
      const { currentRun, filteredRuns } = await this.discoverRuns();

      const currentRunStartedAt = currentRun ? runTimestamp(currentRun) : undefined;
      if (currentRunStartedAt !== undefined) {
        this.debug(
          'Found current run ' +
            this.input.runId +
            ' attempt ' +
            this.input.runAttempt +
            ' at ' +
            new Date(currentRunStartedAt).toISOString(),
        );
      }

      const previousRuns = filteredRuns
        .filter((run) => isPreviousRun(run, this.input, currentRunStartedAt))
        .filter((run) => {
          const isSuccessful: boolean = run.conclusion === 'success';

          if (isSuccessful) {
            this.debug(
              `Skipping run ${run.id}, status: ${run.status}, conclusion: ${run.conclusion}`,
            );
          }

          return !isSuccessful;
        })
        .sort(compareRunsNewestFirst)
        .slice(0, MAX_PREVIOUS_WORKFLOW_RUNS);
      if (previousRuns.length === 0) {
        setOutput('force_continued', '');
        this.clearPreviousRunOutput();
        const deadline = this.deadline;
        if (!deadline) {
          throw new Error('Wait deadline has not been initialized');
        }
        if (!deadline.hasElapsedSeconds(this.input.initialWaitSeconds)) {
          this.info(
            `🔎 Waiting until the ${this.input.initialWaitSeconds}-second initial discovery window expires before checking again...`,
          );
          await deadline.sleepUntilElapsedSeconds(this.input.initialWaitSeconds);
          continue;
        }
        return;
      } else {
        this.debug(`Found ${previousRuns.length} previous runs`);
      }

      // Handle if we are checking for a specific job / step to wait for
      if (this.input.jobToWaitFor) {
        let shouldPoll = false;
        for (const previousRun of previousRuns) {
          this.debug(`Fetching jobs for run ${previousRun.id}`);
          const jobs = await this.withDeadline((signal) =>
            signal
              ? this.githubClient.jobs(this.input.owner, this.input.repo, previousRun.id, {
                  signal,
                })
              : this.githubClient.jobs(this.input.owner, this.input.repo, previousRun.id),
          );
          const job = jobs.find((job) => job.name === this.input.jobToWaitFor);
          // Now handle if we are checking for a specific step
          if (this.input.stepToWaitFor && job) {
            this.debug(`Fetching steps for job ${job.id}`);
            const steps = await this.withDeadline((signal) =>
              signal
                ? this.githubClient.steps(this.input.owner, this.input.repo, job.id, { signal })
                : this.githubClient.steps(this.input.owner, this.input.repo, job.id),
            );
            const step = steps.find((step) => step.name === this.input.stepToWaitFor);
            if (step && step.status !== 'completed') {
              this.setPreviousRunOutput(previousRun);
              this.info(`✋Awaiting step completion from job ${job.html_url} ...`);
              shouldPoll = true;
              break;
            } else if (step) {
              this.info(
                `Step ${this.input.stepToWaitFor} completed from run ${previousRun.html_url}`,
              );
              continue;
            }
            this.info(
              `Step ${this.input.stepToWaitFor} not found in job ${job.id}, awaiting job completion for safety`,
            );
          }

          if (job && job.status !== 'completed') {
            this.setPreviousRunOutput(previousRun);
            this.info(`✋Awaiting job run completion from job ${job.html_url} ...`);
            shouldPoll = true;
            break;
          } else if (job) {
            this.info(`Job ${this.input.jobToWaitFor} completed from run ${previousRun.html_url}`);
            continue;
          } else {
            this.info(
              `Job ${this.input.jobToWaitFor} not found in run ${previousRun.id}, awaiting full run for safety`,
            );
          }

          this.setPreviousRunOutput(previousRun);
          this.info(`✋Awaiting run ${previousRun.html_url} ...`);
          shouldPoll = true;
          break;
        }

        if (!shouldPoll) {
          this.clearPreviousRunOutput();
          return;
        }
      } else {
        const previousRun = previousRuns[0];
        this.setPreviousRunOutput(previousRun);
        this.info(`✋Awaiting run ${previousRun.html_url} ...`);
      }

      await this.pollAndWait();
    }
  };

  wait = async (secondsSoFar: number = 0): Promise<number | undefined> => {
    const deadline =
      this.sharedDeadline || ActionDeadline.fromInput(this.input, this.timing, secondsSoFar);
    const ownsDeadline = !this.sharedDeadline;
    this.deadline = deadline;

    try {
      deadline.throwIfReached();
      await this.waitForCompletion();
      deadline.throwIfReached();
      return undefined;
    } catch (error: unknown) {
      if (error instanceof DeadlineReached) {
        return handleDeadline(error, this.info, this.clearPreviousRunOutput);
      }
      throw error;
    } finally {
      if (ownsDeadline) {
        deadline.dispose();
      }
      this.deadline = undefined;
    }
  };

  pollAndWait = async (): Promise<void> => {
    const deadline = this.deadline;
    if (!deadline) {
      throw new Error('Wait deadline has not been initialized');
    }
    await deadline.sleepSeconds(this.input.pollIntervalSeconds);
  };
}
