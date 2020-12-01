import { GitHub } from "./github";
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

    if (
      this.input.abortAfterSeconds &&
      (secondsSoFar || 0) >= this.input.abortAfterSeconds
    ) {
      this.info(`🛑Exceeded wait seconds. Aborting...`);
      throw new Error(`Aborted after waiting ${secondsSoFar} seconds`);
    }

    const runs = await this.githubClient.runs(
      this.input.owner,
      this.input.repo,
      this.input.sameBranchOnly ? this.input.branch : undefined,
      this.workflowId
    );

    const sortedRuns = runs.sort((a, b) => b.id - a.id);
    const currentRunIndex = sortedRuns.findIndex(
      ({ id }) => id === this.input.runId
    );

    const previousRun = sortedRuns[currentRunIndex + 1];
    if (!previousRun) {
      return;
    }

    if (this.input.abortOnNewerRun && currentRunIndex > 0) {
      const newerRun = sortedRuns[currentRunIndex - 1];
      this.info(`🛑Newer run ${newerRun.html_url} detected. Aborting...`);
      throw new Error(
        `Aborted because newer run ${newerRun.html_url} was detected.`
      );
    }

    this.info(`✋Awaiting run ${previousRun.html_url} ...`);
    await new Promise(resolve =>
      setTimeout(resolve, this.input.pollIntervalSeconds * 1000)
    );
    return this.wait((secondsSoFar || 0) + this.input.pollIntervalSeconds);
  };
}
