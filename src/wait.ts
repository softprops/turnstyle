import { OctokitGitHub as GitHub } from "./github";
import { Input } from "./input";
import { setOutput } from "@actions/core";

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
    debug: (msg: string) => void
  ) {
    this.workflowId = workflowId;
    this.input = input;
    this.githubClient = githubClient;
    this.info = info;
    this.debug = debug;
  }

  wait = async (secondsSoFar?: number) => {
    if (
      this.input.continueAfterSeconds &&
      (secondsSoFar || 0) >= this.input.continueAfterSeconds
    ) {
      this.info(`🤙Exceeded wait seconds. Continuing...`);
      setOutput("force_continued", "1");
      return secondsSoFar || 0;
    }

    if (
      this.input.abortAfterSeconds &&
      (secondsSoFar || 0) >= this.input.abortAfterSeconds
    ) {
      this.info(`🛑Exceeded wait seconds. Aborting...`);
      setOutput("force_continued", "");
      throw new Error(`Aborted after waiting ${secondsSoFar} seconds`);
    }

    this.debug(`Fetching workflow runs for workflow ID: ${this.workflowId}`);
    const runs = await this.githubClient.runs(
      this.input.owner,
      this.input.repo,
      this.input.sameBranchOnly ? this.input.branch : undefined,
      this.workflowId
    );

    this.debug(`Found ${runs.length} ${this.workflowId} runs`);
    const previousRuns = runs
      .filter((run) => run.id < this.input.runId)
      .sort((a, b) => b.id - a.id);
    if (!previousRuns || !previousRuns.length) {
      setOutput("force_continued", "");
      return;
    } else {
      this.debug(`Found ${previousRuns.length} previous runs`);
    }

    const previousRun = previousRuns[0];
    this.info(`✋Awaiting run ${previousRun.html_url} ...`);
    await new Promise((resolve) =>
      setTimeout(resolve, this.input.pollIntervalSeconds * 1000)
    );
    return this.wait((secondsSoFar || 0) + this.input.pollIntervalSeconds);
  };
}
