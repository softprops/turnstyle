import { Run } from "./github";

export interface Wait {
  wait(secondsSoFar?: number): Promise<number>;
}

export class Waiter implements Wait {
  private readonly info: (msg: string) => void;
  private readonly getRun: () => Promise<Run>;
  private readonly pollIntervalSeconds: number;
  private readonly continueAfterSeconds: number | undefined;
  constructor(
    getRun: () => Promise<Run>,
    pollIntervalSeconds: number,
    continueAfterSeconds: number | undefined,
    info: (msg: string) => void
  ) {
    this.getRun = getRun;
    this.pollIntervalSeconds = pollIntervalSeconds;
    this.continueAfterSeconds = continueAfterSeconds;
    this.info = info;
  }

  wait = async (secondsSoFar?: number) => {
    if (
      this.continueAfterSeconds &&
      (secondsSoFar || 0) >= this.continueAfterSeconds
    ) {
      this.info(`🤙Exceeded wait seconds. Continuing...`);
      return secondsSoFar || 0;
    }
    const run = await this.getRun();
    if (run.status === "completed") {
      this.info(`👍 Run ${run.html_url} complete.`);
      return secondsSoFar || 0;
    }
    this.info(`✋Awaiting run ${run.html_url}...`);
    await new Promise(resolve =>
      setTimeout(resolve, this.pollIntervalSeconds * 1000)
    );
    return this.wait((secondsSoFar || 0) + this.pollIntervalSeconds);
  };
}
