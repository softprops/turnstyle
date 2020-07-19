import { GitHub, Job } from "./github";
import { Input } from "./input";

export interface Wait {
  wait(secondsSoFar?: number): Promise<number>;
}

export class Waiter implements Wait {
  private readonly info: (msg: string) => void;
  private input: Input;
  private githubClient: GitHub;
  private workflowId: any;

  constructor(
    workflowId: any,
    githubClient: GitHub,
    input: Input,
    info: (msg: string) => void
  ) {
    this.workflowId = workflowId;
    this.input = input;
    this.githubClient = githubClient;
    this.info = info;
  }

  wait = async (secondsSoFar?: number) => {
    if (
      this.input.continueAfterSeconds &&
      (secondsSoFar || 0) >= this.input.continueAfterSeconds
    ) {
      this.info(`🤙Exceeded wait seconds. Continuing...`);
      return secondsSoFar || 0;
    }

    const runs = await this.githubClient.runs(
      this.input.owner,
      this.input.repo,
      this.input.sameBranchOnly ? this.input.branch : undefined,
      this.workflowId
    );
    const previousRuns = runs
      .filter(run => run.id < this.input.runId)
      .sort((a, b) => b.id - a.id);
    if (!previousRuns || !previousRuns.length) {
      return;
    }

    const previousRun = previousRuns[0];
    let previousJob: Job | undefined;

    if (this.input.waitForJob) {
      const jobs = await this.githubClient.jobs(
        this.input.owner,
        this.input.repo,
        previousRun.id
      );
      previousJob = jobs.find(j => j.name === this.input.waitForJob);
      if (previousJob?.status === "completed") return;
    }

    this.info(
      previousJob
        ? `✋Awaiting job ${previousJob.html_url}...`
        : `✋Awaiting run ${previousRun.html_url}...`
    );
    await new Promise(resolve =>
      setTimeout(resolve, this.input.pollIntervalSeconds * 1000)
    );
    return this.wait((secondsSoFar || 0) + this.input.pollIntervalSeconds);
  };
}
