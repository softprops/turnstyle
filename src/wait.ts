import { setOutput } from '@actions/core';
import { OctokitGitHub as GitHub } from './github';
import { Input } from './input';

export interface Wait {
  wait(secondsSoFar?: number): Promise<number>;
}

export class Waiter implements Wait {
  private readonly info: (msg: string) => void;
  private readonly debug: (msg: string) => void;
  private input: Input;
  private githubClient: GitHub;
  private readonly workflowId: any;

  constructor(
    workflowId: any,
    githubClient: GitHub,
    input: Input,
    info: (msg: string) => void,
    debug: (msg: string) => void,
  ) {
    this.workflowId = workflowId;
    this.input = input;
    this.githubClient = githubClient;
    this.info = info;
    this.debug = debug;
  }

  wait = async (secondsSoFar?: number) => {
    if (this.input.continueAfterSeconds && (secondsSoFar || 0) >= this.input.continueAfterSeconds) {
      this.info(`🤙Exceeded wait seconds. Continuing...`);
      setOutput('force_continued', '1');
      return secondsSoFar || 0;
    }

    if (this.input.abortAfterSeconds && (secondsSoFar || 0) >= this.input.abortAfterSeconds) {
      this.info(`🛑Exceeded wait seconds. Aborting...`);
      setOutput('force_continued', '');
      throw new Error(`Aborted after waiting ${secondsSoFar} seconds`);
    }

    this.debug(`Fetching workflow runs for workflow ID: ${this.workflowId}`);
    const runs = await this.githubClient.runs(
      this.input.owner,
      this.input.repo,
      this.input.sameBranchOnly ? this.input.branch : undefined,
      this.workflowId,
    );

    this.debug(`Found ${runs.length} ${this.workflowId} runs`);

    const queueName = this.input.queueName;
    let filteredRuns = runs;

    if (queueName) {
      this.info(`Filtering runs for queue name: ${queueName}`);
      filteredRuns = runs.filter((run) => {
        const matchesQueue =
          run.display_title?.includes(queueName) || run.name?.includes(queueName);

        if (matchesQueue) {
          this.debug(`Run ${run.id} matches queue name: ${queueName}`);
        }

        return matchesQueue;
      });

      this.debug(`After queue filtering: ${filteredRuns.length} runs match queue "${queueName}"`);
    }

    const previousRuns = filteredRuns
      .filter((run) => run.id < this.input.runId)
      .filter((run) => {
        const isSuccessful: boolean = run.conclusion === 'success';

        if (isSuccessful) {
          this.debug(
            `Skipping run ${run.id}, status: ${run.status}, conclusion: ${run.conclusion}`,
          );
        }

        return !isSuccessful;
      })
      .sort((a, b) => b.id - a.id);
    if (!previousRuns || !previousRuns.length) {
      setOutput('force_continued', '');
      if (
        this.input.initialWaitSeconds > 0 &&
        (secondsSoFar || 0) < this.input.initialWaitSeconds
      ) {
        this.info(
          `🔎 Waiting for ${this.input.initialWaitSeconds} seconds before checking for runs again...`,
        );
        await new Promise((resolve) => setTimeout(resolve, this.input.initialWaitSeconds * 1000));
        return this.wait((secondsSoFar || 0) + this.input.initialWaitSeconds);
      }
      return;
    } else {
      this.debug(`Found ${previousRuns.length} previous runs`);
    }

    const previousRun = previousRuns[0];
    // Handle if we are checking for a specific job / step to wait for
    if (this.input.jobToWaitFor) {
      this.debug(`Fetching jobs for run ${previousRun.id}`);
      const jobs = await this.githubClient.jobs(this.input.owner, this.input.repo, previousRun.id);
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
          this.info(`Step ${this.input.stepToWaitFor} completed from run ${previousRun.html_url}`);
          return;
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
        return;
      } else {
        this.info(
          `Job ${this.input.jobToWaitFor} not found in run ${previousRun.id}, awaiting full run for safety`,
        );
      }
    }

    this.info(`✋Awaiting run ${previousRun.html_url} ...`);
    return this.pollAndWait(secondsSoFar);
  };

  pollAndWait = async (secondsSoFar?: number) => {
    await new Promise((resolve) => setTimeout(resolve, this.input.pollIntervalSeconds * 1000));
    return this.wait((secondsSoFar || 0) + this.input.pollIntervalSeconds);
  };
}
