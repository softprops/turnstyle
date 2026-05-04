import { setOutput } from '@actions/core';
import { OctokitGitHub as GitHub, WorkflowRun } from './github';
import { Input } from './input';

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

export interface Wait {
  wait(secondsSoFar?: number): Promise<number>;
}

export class Waiter implements Wait {
  private readonly info: (msg: string) => void;
  private readonly debug: (msg: string) => void;
  private input: Input;
  private githubClient: GitHub;
  private readonly workflowId: any;
  private readonly allWorkflows: any[];

  constructor(
    workflowId: any,
    githubClient: GitHub,
    input: Input,
    info: (msg: string) => void,
    debug: (msg: string) => void,
    allWorkflows: any[] = [],
  ) {
    this.workflowId = workflowId;
    this.input = input;
    this.githubClient = githubClient;
    this.info = info;
    this.debug = debug;
    this.allWorkflows = allWorkflows;
  }

  wait = async (secondsSoFar?: number) => {
    const elapsedSeconds = secondsSoFar || 0;

    if (
      this.input.continueAfterSeconds !== undefined &&
      elapsedSeconds >= this.input.continueAfterSeconds
    ) {
      this.info(`🤙Exceeded wait seconds. Continuing...`);
      setOutput('force_continued', '1');
      return elapsedSeconds;
    }

    if (
      this.input.abortAfterSeconds !== undefined &&
      elapsedSeconds >= this.input.abortAfterSeconds
    ) {
      this.info(`🛑Exceeded wait seconds. Aborting...`);
      setOutput('force_continued', '');
      throw new Error(`Aborted after waiting ${elapsedSeconds} seconds`);
    }

    this.debug(`Fetching workflow runs for workflow ID: ${this.workflowId}`);
    let currentRun: WorkflowRun | undefined;
    try {
      currentRun = await this.githubClient.run(this.input.owner, this.input.repo, this.input.runId);
    } catch (error: any) {
      this.debug(`Failed to fetch current run ${this.input.runId}: ${error.message}`);
    }

    const runFilters = {
      branch: this.input.sameBranchOnly ? this.input.branch : undefined,
    };
    const runs = await this.githubClient.runs(
      this.input.owner,
      this.input.repo,
      this.workflowId,
      runFilters,
    );

    this.debug(`Found ${runs.length} ${this.workflowId} runs`);

    const queueName = this.input.queueName;
    currentRun = currentRun || findCurrentRun(runs, this.input);
    let filteredRuns = filterEligibleRuns(runs, this.input);
    const allWorkflowsSize = this.allWorkflows.length;

    if (queueName && allWorkflowsSize > 0) {
      this.debug(`Searching across ${allWorkflowsSize} workflows for queue name: ${queueName}`);
      const BATCH_SIZE = 10;
      const allRuns: WorkflowRun[] = [];
      for (let i = 0; i < allWorkflowsSize; i += BATCH_SIZE) {
        const batch = this.allWorkflows.slice(i, i + BATCH_SIZE);
        this.debug(
          `Processing workflow batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allWorkflowsSize / BATCH_SIZE)}`,
        );
        const getRunsPromises = batch.map((workflow) =>
          this.githubClient.runs(this.input.owner, this.input.repo, workflow.id, {
            ...runFilters,
            queueName,
          }),
        );
        const batchResults = await Promise.allSettled(getRunsPromises);
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            allRuns.push(...result.value);
            return;
          }
          const workflowId = batch[index].id;
          this.debug(`Failed to fetch runs for workflow ${workflowId}: ${result.reason}`);
        });
      }

      currentRun = currentRun || findCurrentRun(allRuns, this.input);
      filteredRuns = filterEligibleRuns(allRuns, this.input).filter((run) => {
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
    if (!previousRuns || !previousRuns.length) {
      setOutput('force_continued', '');
      if (this.input.initialWaitSeconds > 0 && elapsedSeconds < this.input.initialWaitSeconds) {
        this.info(
          `🔎 Waiting for ${this.input.initialWaitSeconds} seconds before checking for runs again...`,
        );
        await new Promise((resolve) => setTimeout(resolve, this.input.initialWaitSeconds * 1000));
        return this.wait(elapsedSeconds + this.input.initialWaitSeconds);
      }
      return;
    } else {
      this.debug(`Found ${previousRuns.length} previous runs`);
    }

    // Handle if we are checking for a specific job / step to wait for
    if (this.input.jobToWaitFor) {
      for (const previousRun of previousRuns) {
        this.debug(`Fetching jobs for run ${previousRun.id}`);
        const jobs = await this.githubClient.jobs(
          this.input.owner,
          this.input.repo,
          previousRun.id,
        );
        const job = jobs.find((job) => job.name === this.input.jobToWaitFor);
        // Now handle if we are checking for a specific step
        if (this.input.stepToWaitFor && job) {
          this.debug(`Fetching steps for job ${job.id}`);
          const steps = await this.githubClient.steps(this.input.owner, this.input.repo, job.id);
          const step = steps.find((step) => step.name === this.input.stepToWaitFor);
          if (step && step.status !== 'completed') {
            this.info(`✋Awaiting step completion from job ${job.html_url} ...`);
            return this.pollAndWait(secondsSoFar);
          } else if (step) {
            this.info(
              `Step ${this.input.stepToWaitFor} completed from run ${previousRun.html_url}`,
            );
            continue;
          } else {
            this.info(
              `Step ${this.input.stepToWaitFor} not found in job ${job.id}, awaiting full run for safety`,
            );
          }
        }

        if (job && job.status !== 'completed') {
          this.info(`✋Awaiting job run completion from job ${job.html_url} ...`);
          return this.pollAndWait(secondsSoFar);
        } else if (job) {
          this.info(`Job ${this.input.jobToWaitFor} completed from run ${previousRun.html_url}`);
          continue;
        } else {
          this.info(
            `Job ${this.input.jobToWaitFor} not found in run ${previousRun.id}, awaiting full run for safety`,
          );
        }

        this.info(`✋Awaiting run ${previousRun.html_url} ...`);
        return this.pollAndWait(secondsSoFar);
      }
      return;
    }

    const previousRun = previousRuns[0];
    this.info(`✋Awaiting run ${previousRun.html_url} ...`);
    return this.pollAndWait(secondsSoFar);
  };

  pollAndWait = async (secondsSoFar?: number) => {
    await new Promise((resolve) => setTimeout(resolve, this.input.pollIntervalSeconds * 1000));
    return this.wait((secondsSoFar || 0) + this.input.pollIntervalSeconds);
  };
}
