import { info } from "@actions/core";
import { GitHub } from "./github";

export interface Wait {
  wait(secondsSoFar: number): Promise<void>;
}

export class Waiter implements Wait {
  private readonly github: GitHub;
  private readonly owner: string;
  private readonly repo: string;
  private readonly run_id: number;
  private readonly pollIntervalSeconds: number;
  private readonly continueAfterSeconds: number | undefined;
  constructor(
    github: GitHub,
    owner: string,
    repo: string,
    run_id: number,
    pollIntervalSeconds: number,
    continueAfterSeconds: number | undefined
  ) {
    this.github = github;
    this.owner = owner;
    this.repo = repo;
    this.run_id = run_id;
    this.pollIntervalSeconds = pollIntervalSeconds;
    this.continueAfterSeconds = continueAfterSeconds;
  }

  wait = async (secondsSoFar: number) => {
    if (
      this.continueAfterSeconds &&
      secondsSoFar >= this.continueAfterSeconds
    ) {
      info(`🤙Exceeded wait seconds. Continuing...`);
      return;
    }
    const run = await this.github.run(this.owner, this.repo, this.run_id);
    if (run.status === "completed") {
      info(`👍 Run ${run.html_url} complete.`);
      return;
    }
    info(`✋Awaiting run ${run.html_url}...`);
    await new Promise(resolve =>
      setTimeout(resolve, this.pollIntervalSeconds * 1000)
    );
    return this.wait(secondsSoFar + this.pollIntervalSeconds);
  };
}

export async function waitForIt(
  github: GitHub,
  owner: string,
  repo: string,
  run_id: number,
  secondsSoFar: number,
  pollIntervalSeconds: number,
  continueAfterSeconds: number | undefined
) {
  if (continueAfterSeconds && secondsSoFar >= continueAfterSeconds) {
    info(`🤙Exceeded wait seconds. Continuing...`);
  }
  const run = await github.run(owner, repo, run_id);
  if (run.status === "completed") {
    info(`👍 Run ${run.html_url} complete.`);
    return;
  }
  info(`✋Awaiting run ${run.html_url}...`);
  await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
  return waitForIt(
    github,
    owner,
    repo,
    run_id,
    secondsSoFar + pollIntervalSeconds,
    pollIntervalSeconds,
    continueAfterSeconds
  );
}
