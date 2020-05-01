import { Run, OctokitGitHub, GitHub } from "./github";
import { Input, parseInput } from "./input";

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
    const runs = await this.githubClient.runs(
      this.input.owner,
      this.input.repo,
      this.input.branch,
      this.workflowId
    );
    const previousRun = runs
      .filter(run => run.id < this.input.runId)
      .sort((a, b) => b.id - a.id)[0];

    if (
      this.input.continueAfterSeconds &&
      (secondsSoFar || 0) >= this.input.continueAfterSeconds
    ) {
      this.info(`🤙Exceeded wait seconds. Continuing...`);
      return secondsSoFar || 0;
    }

    const run = await this.githubClient.run(
      this.input.owner,
      this.input.repo,
      previousRun.id
    );
    if (run.status === "completed") {
      this.info(`👍 Run ${run.html_url} complete.`);
      return secondsSoFar || 0;
    }

    this.info(`✋Awaiting run ${run.html_url}...`);
    await new Promise(resolve =>
      setTimeout(resolve, this.input.pollIntervalSeconds * 1000)
    );
    return this.wait((secondsSoFar || 0) + this.input.pollIntervalSeconds);
  };
}
