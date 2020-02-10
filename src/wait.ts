import { info } from "@actions/core";
import { GitHub, Run } from "./github";

export interface Wait {
  wait(secondsSoFar?: number): Promise<void>;
}

export class Waiter implements Wait {
  private readonly getRun: () => Promise<Run>;
  private readonly pollIntervalSeconds: number;
  private readonly continueAfterSeconds: number | undefined;
  constructor(
    getRun: () => Promise<Run>,
    pollIntervalSeconds: number,
    continueAfterSeconds: number | undefined
  ) {
    this.getRun = getRun;
    this.pollIntervalSeconds = pollIntervalSeconds;
    this.continueAfterSeconds = continueAfterSeconds;
  }

  wait = async (secondsSoFar?: number) => {
    if (
      this.continueAfterSeconds &&
      (secondsSoFar || 0) >= this.continueAfterSeconds
    ) {
      info(`🤙Exceeded wait seconds. Continuing...`);
      return;
    }
    const run = await this.getRun();
    if (run.status === "completed") {
      info(`👍 Run ${run.html_url} complete.`);
      return;
    }
    info(`✋Awaiting run ${run.html_url}...`);
    await new Promise(resolve =>
      setTimeout(resolve, this.pollIntervalSeconds * 1000)
    );
    return this.wait((secondsSoFar || 0) + this.pollIntervalSeconds);
  };
}
